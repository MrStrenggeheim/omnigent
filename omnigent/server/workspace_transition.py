"""Recoverable same-machine workspace changes using normal runner cold-resume."""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from typing import Any

import httpx
from fastapi import HTTPException, Request

from omnigent.db.workspace_cache import WorkspaceScopedCache
from omnigent.errors import ErrorCode, OmnigentError
from omnigent.runtime import session_stream
from omnigent.server.auth import LEVEL_OWNER
from omnigent.server.routes._auth_helpers import require_access, require_user
from omnigent.server.routes._host_launch import resolve_host_launch
from omnigent.server.routes._workspace_validation import (
    WorkspaceValidationError,
    validate_workspace,
)
from omnigent.server.workbench_workspace_service import WorkbenchWorkspaceService
from omnigent.stores.workspace_transition_store import (
    WorkspaceTransitionConflict,
    WorkspaceTransitionStore,
)

_logger = logging.getLogger(__name__)

_admitting: WorkspaceScopedCache[str, bool] = WorkspaceScopedCache()


def require_workspace_ready(session_id: str, conversation: Any = None) -> None:
    state = getattr(conversation, "workspace_transition", None)
    if _admitting.get(session_id) or (state and state.get("blocked")):
        raise OmnigentError(
            "Workspace change in progress. Wait for it to finish or recover it before sending.",
            code=ErrorCode.CONFLICT,
        )


def require_workspace_write_context(conversation: Any, body: dict[str, Any]) -> None:
    """Refuse delayed legacy writes rather than interpreting them in another root."""
    require_workspace_ready(conversation.id, conversation)
    expected = body.get("workspace_root")
    if expected is not None and (
        not isinstance(expected, str)
        or (conversation.workspace is not None and expected != conversation.workspace)
    ):
        raise HTTPException(409, "Workspace changed. Reopen the file before saving.")
    if conversation.workspace_transition and expected is None:
        raise HTTPException(409, "Workspace changed. Reopen files before writing to this chat.")


class WorkspaceTransitionService:
    def __init__(
        self, workspaces: WorkbenchWorkspaceService, runner_router: Any, initializer: Any = None
    ):
        self.workspaces = workspaces
        self.conversations = workspaces.conversation_store
        self.runner_router = runner_router
        self.initializer = initializer
        self.store = WorkspaceTransitionStore(self.conversations.storage_location)
        self.jobs: WorkspaceScopedCache[str, asyncio.Task[None]] = WorkspaceScopedCache()

    async def conversation(self, request: Request, session_id: str):
        user = require_user(request, self.workspaces.auth_provider)
        await require_access(
            user, session_id, LEVEL_OWNER, self.workspaces.permission_store, self.conversations
        )
        conv = await asyncio.to_thread(self.conversations.get_conversation, session_id)
        if conv is None:
            raise HTTPException(404, "Chat not found")
        return conv

    async def snapshot(self, request: Request, session_id: str) -> dict[str, Any]:
        conv = await self.conversation(request, session_id)
        state = conv.workspace_transition
        return {
            "workspace": conv.workspace,
            "host_id": conv.host_id,
            "runner_id": conv.runner_id,
            "operation": state,
            "can_recover": bool(
                state
                and state.get("blocked")
                and (state.get("phase") == "failed" or time.time() - state["updated_at"] > 45)
            ),
        }

    async def change(self, request: Request, session_id: str, body: Any) -> dict[str, Any]:
        from omnigent.server.routes._sessions.helpers import (
            _relaunch_locks,
            _session_status_from_cache,
        )
        from omnigent.server.routes._sessions.orchestration import _session_is_starting
        from omnigent.server.routes.hosts import _resolve_agent_spec_cwd

        conv = await self.conversation(request, session_id)
        if conv.workspace_transition and conv.workspace_transition.get("id") == body.request_id:
            return await self.snapshot(request, session_id)
        if body.expected_host_id is not None and body.expected_host_id != conv.host_id:
            raise HTTPException(
                409, "The chat's machine changed; refresh before switching workspace"
            )
        if not conv.host_id or not conv.workspace:
            raise HTTPException(409, "Resume this chat on a machine before changing its workspace")
        if conv.parent_conversation_id is not None:
            raise HTTPException(409, "Change the parent chat's workspace instead")
        if self.workspaces.host_store is None:
            raise HTTPException(409, "Host workspace switching is unavailable")
        if not (conv.workspace_transition and conv.workspace_transition.get("blocked")):
            original = await self.workspaces.resolve_session(
                request, session_id, allow_missing_root=True
            )
            if original.target_kind not in {"host", "sandbox"}:
                raise HTTPException(
                    409, "This environment requires a new chat to change workspace"
                )
        user = require_user(request, self.workspaces.auth_provider)
        target = await asyncio.to_thread(
            resolve_host_launch,
            user_id=user,
            host_id=conv.host_id,
            session_id=session_id,
            host_store=self.workspaces.host_store,
            host_registry=self.workspaces.host_registry,
            conversation_store=self.conversations,
            permission_store=self.workspaces.permission_store,
        )
        from omnigent.harness_availability import harness_launch_availability
        from omnigent.host.frames import CAP_REFRESH_HARNESSES
        from omnigent.server.routes.hosts import _proxy_refresh_harnesses, _resolve_agent_harness

        harness = await _resolve_agent_harness(
            conv, self.workspaces.agent_store, self.workspaces.agent_cache
        )
        readiness = target.host.configured_harnesses
        if CAP_REFRESH_HARNESSES in target.conn.hello.capabilities:
            refreshed = await _proxy_refresh_harnesses(
                host_registry=self.workspaces.host_registry, host_conn=target.conn
            )
            readiness = refreshed.get("configured_harnesses")
        if harness and harness_launch_availability(harness, readiness)[0] is False:
            raise OmnigentError(
                "Configure this agent harness on the machine before changing workspace",
                code=ErrorCode.HARNESS_NOT_CONFIGURED,
            )
        spec_cwd = await _resolve_agent_spec_cwd(
            conv, self.workspaces.agent_store, self.workspaces.agent_cache
        )
        try:
            folder = await validate_workspace(
                host_registry=self.workspaces.host_registry,
                host_id=conv.host_id,
                workspace=body.workspace,
                spec_cwd=spec_cwd,
            )
        except WorkspaceValidationError as exc:
            raise HTTPException(400, exc.message) from exc
        lock = _relaunch_locks.setdefault(session_id, asyncio.Lock())
        async with lock:
            if _admitting.get(session_id):
                raise HTTPException(409, "A workspace change is already starting")
            _admitting[session_id] = True
            try:
                conv = await self.conversation(request, session_id)
                previous = conv.workspace_transition
                recovery = bool(
                    previous
                    and body.recover_operation_id == previous.get("id")
                    and (
                        previous.get("phase") == "failed"
                        or time.time() - previous["updated_at"] > 45
                    )
                )
                if _session_is_starting(session_id) or (
                    not recovery
                    and _session_status_from_cache(session_id, conv.live_status) == "running"
                ):
                    raise HTTPException(409, "Wait for the current agent turn to finish")
                if conv.runner_id:
                    bound = await asyncio.to_thread(
                        self.conversations.list_conversations_by_runner_id, conv.runner_id
                    )
                    for other in bound:
                        if other.id == conv.id:
                            continue
                        child = (
                            other.parent_conversation_id == conv.id
                            or other.root_conversation_id == conv.id
                        )
                        if not child:
                            raise HTTPException(
                                409,
                                "Runner shared with another chat; resume it separately first",
                            )
                        if (
                            _session_status_from_cache(other.id, other.live_status) == "running"
                            or _session_is_starting(other.id)
                            or (other.pending_elicitation_count or 0)
                        ):
                            raise HTTPException(
                                409, "Wait for child agents and their approvals to finish"
                            )
                if conv.workspace == folder and not (previous and previous.get("blocked")):
                    return {**(await self.snapshot(request, session_id)), "unchanged": True}
                try:
                    state = await asyncio.to_thread(
                        self.store.begin,
                        session_id,
                        operation_id=body.request_id,
                        host_id=target.host.host_id,
                        expected_workspace=body.expected_workspace,
                        expected_runner_id=body.expected_runner_id,
                        target=folder,
                        recover_operation_id=body.recover_operation_id,
                        validate_only=body.validate_only,
                    )
                except WorkspaceTransitionConflict as exc:
                    raise HTTPException(409, str(exc)) from exc
                if body.validate_only:
                    return {
                        **(await self.snapshot(request, session_id)),
                        "validated_workspace": folder,
                        "unchanged": False,
                    }
                state = await asyncio.to_thread(
                    self.store.update,
                    session_id,
                    body.request_id,
                    previous_runner_online=(
                        self.runner_router.runner_is_online(conv.runner_id)
                        if self.runner_router is not None and conv.runner_id
                        else True
                    ),
                )
                self.publish(session_id, state)

                async def execute() -> None:
                    await self.run(session_id, state, target.conn)

                task = asyncio.create_task(execute())
                self.jobs[session_id] = task
                from omnigent.server.routes.hosts import _track_runner_launch_cleanup

                _track_runner_launch_cleanup(task)
                task.add_done_callback(
                    lambda done: (
                        self.jobs.pop(session_id, None)
                        if self.jobs.get(session_id) is done
                        else None
                    )
                )
            finally:
                if session_id not in self.jobs:
                    _admitting.pop(session_id, None)
        await asyncio.shield(task)
        return await self.snapshot(request, session_id)

    @staticmethod
    def publish(session_id: str, state: dict[str, Any]) -> None:
        session_stream.publish(
            session_id,
            {
                "type": "session.workspace",
                "conversation_id": session_id,
                "switching": state.get("blocked", False),
                "operation_id": state["id"],
                "phase": state["phase"],
            },
        )

    async def phase(self, session_id: str, operation_id: str, **patch: Any) -> dict[str, Any]:
        state = await asyncio.to_thread(self.store.update, session_id, operation_id, **patch)
        if not state.get("blocked"):
            _admitting.pop(session_id, None)
        self.publish(session_id, state)
        return state

    async def root_ready(self, session_id: str, workspace: str) -> None:
        from omnigent.server.routes._sessions.helpers import _get_runner_client

        deadline = time.monotonic() + 45
        while time.monotonic() < deadline:
            client = await _get_runner_client(session_id, self.runner_router)
            if client is not None:
                try:
                    response = await client.get(
                        f"/v1/sessions/{session_id}/resources/environments/default", timeout=5
                    )
                    if response.status_code == 200:
                        root = response.json().get("metadata", {}).get("root")
                        if root != workspace:
                            raise RuntimeError("Agent connected in a different working directory")
                        fresh = await asyncio.to_thread(
                            self.conversations.get_conversation, session_id
                        )
                        if fresh is not None and fresh.agent_id:
                            from omnigent.server.routes._sessions.orchestration import (
                                _ensure_native_terminal_ready,
                                _ensure_runner_relay_ready,
                                _ensure_runner_session_initialized,
                                _is_native_terminal_session,
                            )

                            await _ensure_runner_session_initialized(
                                session_id,
                                fresh,
                                client,
                                self.conversations,
                                initializer=self.initializer,
                                suppress_recovery_turn=True,
                                require_success=True,
                                trigger="workspace_change",
                            )
                            if _is_native_terminal_session(fresh):
                                outcome = await _ensure_native_terminal_ready(
                                    client,
                                    session_id,
                                    fresh,
                                    persist_resource_event=False,
                                    runner_router=self.runner_router,
                                )
                                if outcome.error is not None:
                                    raise RuntimeError(outcome.error.message)
                                await _ensure_runner_relay_ready(
                                    session_id,
                                    fresh.runner_id,
                                    client,
                                    self.conversations,
                                    conversation=fresh,
                                )
                        return
                except (ConnectionError, OSError, httpx.HTTPError):
                    pass
            await asyncio.sleep(0.25)
        raise RuntimeError("The agent did not reconnect in time")

    async def run(self, session_id: str, state: dict[str, Any], conn: Any) -> dict[str, Any]:
        from omnigent.server.routes._host_worktree import WORKTREE_ROOT_LABEL_KEY
        from omnigent.server.routes._sessions.helpers import (
            _launch_runner_on_host_locked,
            _relaunch_locks,
            _stop_session_host_runner,
        )

        operation_id = state["id"]

        async def heartbeat():
            while True:
                await asyncio.sleep(10)
                await asyncio.to_thread(self.store.update, session_id, operation_id)

        pulse = asyncio.create_task(heartbeat())
        lock = _relaunch_locks.setdefault(session_id, asyncio.Lock())
        async with lock:
            target_launch_started = False
            recovery_error = None
            try:
                conv = await asyncio.to_thread(self.conversations.get_conversation, session_id)
                if conv is None or conv.host_id is None:
                    raise RuntimeError("Chat binding disappeared during the workspace change")
                # Give idle children their original host/root before their shared runner ends.
                if state["previous_runner_id"]:
                    related = await asyncio.to_thread(
                        self.conversations.list_conversations_by_runner_id,
                        state["previous_runner_id"],
                    )
                    for child in related:
                        if child.id != session_id and (
                            child.parent_conversation_id == session_id
                            or child.root_conversation_id == session_id
                        ):
                            await asyncio.to_thread(
                                self.conversations.set_host_id,
                                child.id,
                                conv.host_id,
                                child.workspace or state["previous_workspace"],
                                child.git_branch,
                            )
                if state["previous_runner_id"]:
                    stopped = await _stop_session_host_runner(
                        session_id,
                        conv.host_id,
                        state["previous_runner_id"],
                        self.workspaces.host_registry,
                    )
                    if not stopped and state.get("previous_runner_online", True):
                        raise RuntimeError(
                            "Could not confirm the old agent stopped; "
                            "reconnect its machine and retry"
                        )
                await self.phase(session_id, operation_id, phase="starting")
                target_launch_started = True
                attempt = await _launch_runner_on_host_locked(
                    conv, self.conversations, self.workspaces.host_registry, conn
                )
                await self.phase(
                    session_id, operation_id, phase="connecting", new_runner_id=attempt.runner_id
                )
                if attempt.error:
                    raise RuntimeError(attempt.error)
                await self.root_ready(session_id, state["target_workspace"])
                from omnigent.server.routes._sessions.orchestration import (
                    _publish_runner_recovered_status,
                )

                await _publish_runner_recovered_status(session_id, self.conversations)
                await asyncio.to_thread(
                    self.conversations.delete_label, session_id, WORKTREE_ROOT_LABEL_KEY
                )
                boundary = await asyncio.to_thread(
                    self.conversations.list_items, session_id, limit=1, order="desc"
                )
                return await self.phase(
                    session_id,
                    operation_id,
                    phase="completed",
                    blocked=False,
                    error=None,
                    history_boundary=boundary.data[0].id if boundary.data else None,
                )

            except Exception as exc:
                _logger.exception("Workspace change failed for chat %s", session_id)
                # An uncertain launch must be stopped before restoring the original binding.
                current = await asyncio.to_thread(self.conversations.get_conversation, session_id)
                restored = False
                if current is not None and current.host_id is not None:
                    stopped = (
                        not target_launch_started
                        or not current.runner_id
                        or await _stop_session_host_runner(
                            session_id,
                            current.host_id,
                            current.runner_id,
                            self.workspaces.host_registry,
                            expect_already_stopped=True,
                        )
                    )
                    if stopped:
                        await asyncio.to_thread(
                            self.store.restore, session_id, operation_id, current.runner_id
                        )
                        restored = True
                        original = await asyncio.to_thread(
                            self.conversations.get_conversation, session_id
                        )
                        if original is not None:
                            try:
                                resumed = await _launch_runner_on_host_locked(
                                    original,
                                    self.conversations,
                                    self.workspaces.host_registry,
                                    conn,
                                )
                                if resumed.error:
                                    recovery_error = resumed.error
                                else:
                                    await self.root_ready(session_id, state["previous_workspace"])
                            except (RuntimeError, ConnectionError, httpx.HTTPError) as recovery:
                                recovery_error = str(recovery)
                return await self.phase(
                    session_id,
                    operation_id,
                    phase="failed",
                    blocked=not restored,
                    error=str(exc),
                    restored=restored,
                    recovery_error=recovery_error,
                )
            finally:
                _admitting.pop(session_id, None)
                pulse.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await pulse
