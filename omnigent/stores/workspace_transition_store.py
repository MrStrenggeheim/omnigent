"""Atomic workspace-change admission and durable recovery state."""

from __future__ import annotations

import json
import time
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from omnigent.db.db_models import SqlConversationMetadata, current_workspace_id
from omnigent.db.enum_codecs import decode_session_live_status
from omnigent.db.utils import (
    get_or_create_engine,
    make_named_managed_session_maker,
    run_write_transaction,
)


class WorkspaceTransitionConflict(ValueError):
    """The chat changed or became busy before the requested switch."""


class WorkspaceTransitionStore:
    def __init__(self, storage_location: str):
        engine = get_or_create_engine(storage_location)
        self.session = make_named_managed_session_maker(
            engine, query_name_prefix="omnigent.workspace_transition", immediate=True
        )

    @staticmethod
    def _row(session: Session, session_id: str) -> SqlConversationMetadata:
        row = session.scalar(
            select(SqlConversationMetadata)
            .where(
                SqlConversationMetadata.workspace_id == current_workspace_id(),
                SqlConversationMetadata.id == session_id,
            )
            .with_for_update()
        )
        if row is None:
            raise WorkspaceTransitionConflict("Chat no longer exists")
        return row

    def begin(
        self,
        session_id: str,
        *,
        operation_id: str,
        host_id: str,
        expected_workspace: str,
        expected_runner_id: str | None,
        target: str,
        recover_operation_id: str | None = None,
        validate_only: bool = False,
    ) -> dict[str, Any]:
        def write(session: Session):
            row = self._row(session, session_id)
            previous = json.loads(row.workspace_transition) if row.workspace_transition else None
            if previous and previous["id"] == operation_id:
                return previous
            recovery = bool(
                previous
                and previous.get("id") == recover_operation_id
                and (
                    previous.get("phase") == "failed" or time.time() - previous["updated_at"] > 45
                )
            )
            if previous and previous.get("blocked") and not recovery:
                raise WorkspaceTransitionConflict(
                    "Recover the current workspace change before starting another"
                )
            if (
                row.host_id != host_id
                or row.workspace != expected_workspace
                or row.runner_id != expected_runner_id
            ):
                raise WorkspaceTransitionConflict(
                    "The chat binding changed; refresh before switching"
                )
            if (
                not recovery
                and row.live_status is not None
                and decode_session_live_status(row.live_status) in {"running", "waiting"}
            ) or (row.pending_elicitation_count or 0):
                raise WorkspaceTransitionConflict(
                    "Wait for the agent and pending approvals to finish"
                )
            state = {
                "id": operation_id,
                "previous_workspace": previous["previous_workspace"]
                if recovery and previous is not None
                else row.workspace,
                "target_workspace": target,
                "previous_git_branch": previous["previous_git_branch"]
                if recovery and previous is not None
                else row.git_branch,
                "previous_runner_id": row.runner_id,
                "history_boundary": previous.get("history_boundary") if previous else None,
                "phase": "stopping",
                "blocked": True,
                "error": None,
                "updated_at": time.time(),
            }
            if validate_only:
                return state
            row.workspace_transition = json.dumps(state)
            row.workspace = target
            row.git_branch = None
            return state

        return run_write_transaction(self.session, "begin", write)

    def update(self, session_id: str, operation_id: str, **patch: Any) -> dict[str, Any]:
        def write(session: Session):
            row = self._row(session, session_id)
            state = json.loads(row.workspace_transition) if row.workspace_transition else {}
            if state.get("id") != operation_id:
                raise WorkspaceTransitionConflict("Workspace operation was superseded")
            state.update(patch, updated_at=time.time())
            row.workspace_transition = json.dumps(state)
            return state

        return run_write_transaction(self.session, "update", write)

    def restore(self, session_id: str, operation_id: str, expected_runner_id: str | None) -> None:
        def write(session: Session):
            row = self._row(session, session_id)
            state = json.loads(row.workspace_transition) if row.workspace_transition else {}
            if state.get("id") != operation_id or row.runner_id != expected_runner_id:
                raise WorkspaceTransitionConflict("Chat binding changed during recovery")
            row.workspace = state["previous_workspace"]
            row.git_branch = state["previous_git_branch"]

        run_write_transaction(self.session, "restore", write)
