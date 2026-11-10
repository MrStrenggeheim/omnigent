"""Workspace transitions reuse the existing authorized host/runner stack."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest

from omnigent.errors import OmnigentError
from omnigent.server.routes._sessions import helpers
from omnigent.server.routes.session_workspace import create_session_workspace_router
from omnigent.server.workspace_transition import (
    WorkspaceTransitionService,
    require_workspace_ready,
)
from omnigent.stores.workspace_transition_store import (
    WorkspaceTransitionConflict,
    WorkspaceTransitionStore,
)
from tests.server.routes.test_workbench_workspaces import (
    ALICE,
    BOB,
    HOST,
)
from tests.server.routes.test_workbench_workspaces import (
    workspace_stack as workspace_stack,
)


@pytest.fixture
async def changing_chat(workspace_stack, monkeypatch):
    make_app, root, conversations, permissions, _, _, _ = workspace_stack
    target = root / "new folder"
    target.mkdir()
    conv = conversations.create_conversation(
        host_id=HOST,
        workspace=str(root),
        runner_id="original-runner",
        title="Keep my chat",
        model_override="kept-model",
        terminal_launch_args=["--example"],
    )
    conversations.set_external_session_id(conv.id, "native-thread-kept")
    permissions.grant("alice", conv.id, 4)
    app, workspaces = make_app()
    service = WorkspaceTransitionService(workspaces, None)
    app.include_router(create_session_workspace_router(service), prefix="/v1")
    stops = AsyncMock(return_value=True)
    launches = []

    async def launch(chat, store, _registry, _conn):
        launches.append(chat.workspace)
        runner_id = f"replacement-{len(launches)}"
        store.replace_runner_id(chat.id, runner_id)
        return SimpleNamespace(runner_id=runner_id, error=None)

    monkeypatch.setattr(helpers, "_stop_session_host_runner", stops)
    monkeypatch.setattr(helpers, "_launch_runner_on_host_locked", launch)
    service.root_ready = AsyncMock()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test", headers=ALICE
    ) as client:
        yield SimpleNamespace(
            client=client,
            service=service,
            conv=conv,
            root=root,
            target=target,
            conversations=conversations,
            permissions=permissions,
            stops=stops,
            launches=launches,
            url=f"/v1/sessions/{conv.id}/workspace",
            body={
                "request_id": "first-change",
                "workspace": str(target),
                "expected_workspace": str(root),
                "expected_runner_id": conv.runner_id,
            },
        )


async def test_workspace_change_preserves_chat_native_identity_and_preferences(changing_chat):
    c = changing_chat
    response = await c.client.post(c.url, json=c.body)
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["workspace"] == str(c.target)
    assert data["operation"]["phase"] == "completed"
    assert data["operation"]["blocked"] is False
    assert c.launches == [str(c.target)]
    chat = c.conversations.get_conversation(c.conv.id)
    assert chat.external_session_id == "native-thread-kept"
    assert chat.title == "Keep my chat"
    assert chat.model_override == "kept-model"
    assert chat.terminal_launch_args == ["--example"]
    again = await c.client.post(c.url, json=c.body)
    assert again.status_code == 200
    assert c.launches == [str(c.target)]
    assert (await c.client.get(c.url)).json()["operation"]["id"] == "first-change"


@pytest.mark.parametrize("status,pending", [("running", 0), ("waiting", 0), ("idle", 1)])
async def test_busy_or_approval_blocked_chat_is_unchanged(changing_chat, status, pending):
    c = changing_chat
    c.conversations.set_session_live_status(c.conv.id, status)
    c.conversations.set_pending_elicitation_count(c.conv.id, pending)
    result = await c.client.post(c.url, json=c.body)
    assert result.status_code == 409, result.text
    assert c.conversations.get_conversation(c.conv.id).workspace == str(c.root)
    assert not c.launches
    c.stops.assert_not_awaited()


@pytest.mark.parametrize(
    "patch",
    [
        {"expected_workspace": "/stale"},
        {"expected_runner_id": "stale-runner"},
        {"workspace": "/does-not-exist"},
    ],
)
async def test_preflight_failures_do_not_stop_the_agent(changing_chat, patch):
    c = changing_chat
    result = await c.client.post(c.url, json={**c.body, **patch})
    assert result.status_code in {400, 409}, result.text
    assert c.conversations.get_conversation(c.conv.id).workspace == str(c.root)
    c.stops.assert_not_awaited()


async def test_other_user_cannot_switch_or_read_private_recovery_state(changing_chat):
    c = changing_chat
    assert (await c.client.post(c.url, json=c.body, headers=BOB)).status_code == 404
    assert (await c.client.get(c.url, headers=BOB)).status_code == 404
    c.stops.assert_not_awaited()


async def test_same_canonical_directory_is_a_noop(changing_chat):
    c = changing_chat
    result = await c.client.post(c.url, json={**c.body, "workspace": str(c.root / ".")})
    assert result.status_code == 200, result.text
    assert result.json()["workspace"] == str(c.root)
    assert result.json()["unchanged"] is True
    c.stops.assert_not_awaited()


async def test_launch_failure_restores_original_workspace(changing_chat):
    c = changing_chat
    c.service.root_ready.side_effect = [RuntimeError("New runner failed to connect"), None]
    result = await c.client.post(c.url, json=c.body)
    assert result.status_code == 200, result.text
    data = result.json()
    assert data["operation"]["phase"] == "failed"
    assert data["operation"]["restored"] is True
    assert data["operation"]["blocked"] is False
    assert data["workspace"] == str(c.root)
    assert c.launches == [str(c.target), str(c.root)]
    assert c.conversations.get_conversation(c.conv.id).external_session_id == "native-thread-kept"


async def test_uncertain_stop_keeps_the_changed_binding_blocked_for_recovery(changing_chat):
    c = changing_chat
    c.service.root_ready.side_effect = RuntimeError("Lost contact after launch")
    c.stops.side_effect = [True, False]
    result = await c.client.post(c.url, json=c.body)
    data = result.json()
    assert data["workspace"] == str(c.target)
    assert data["operation"]["phase"] == "failed"
    assert data["operation"]["blocked"] is True
    assert data["can_recover"] is True
    current = c.conversations.get_conversation(c.conv.id)
    with pytest.raises(OmnigentError, match="Workspace change"):
        require_workspace_ready(current.id, current)
    c.stops.side_effect = None
    c.stops.return_value = True
    c.service.root_ready.side_effect = None
    restored = await c.client.post(
        c.url,
        json={
            **c.body,
            "request_id": "recover",
            "workspace": str(c.root),
            "expected_workspace": str(c.target),
            "expected_runner_id": current.runner_id,
            "recover_operation_id": data["operation"]["id"],
        },
    )
    assert restored.status_code == 200, restored.text
    assert restored.json()["workspace"] == str(c.root)
    assert restored.json()["operation"]["blocked"] is False


async def test_server_admission_is_fenced_while_restart_is_pending(changing_chat):
    c = changing_chat
    entered, release = asyncio.Event(), asyncio.Event()

    async def stop(*_args, **_kwargs):
        entered.set()
        await release.wait()
        return True

    c.stops.side_effect = stop
    task = asyncio.create_task(c.client.post(c.url, json=c.body))
    try:
        await asyncio.wait_for(entered.wait(), timeout=5)
        current = c.conversations.get_conversation(c.conv.id)
        with pytest.raises(OmnigentError, match="Workspace change"):
            require_workspace_ready(current.id, current)
        duplicate = await c.client.post(c.url, json=c.body)
        assert duplicate.json()["operation"]["blocked"] is True
    finally:
        release.set()
        await task
    require_workspace_ready(c.conv.id, c.conversations.get_conversation(c.conv.id))


async def test_interrupted_change_requires_explicit_recovery(changing_chat):
    c = changing_chat
    state = c.service.store.begin(
        c.conv.id,
        operation_id="interrupted",
        host_id=c.conv.host_id,
        expected_workspace=str(c.root),
        expected_runner_id=c.conv.runner_id,
        target=str(c.target),
    )
    reopened = WorkspaceTransitionStore(c.conversations.storage_location)
    with pytest.raises(WorkspaceTransitionConflict, match="Recover"):
        reopened.begin(
            c.conv.id,
            operation_id="unrelated",
            host_id=c.conv.host_id,
            expected_workspace=str(c.target),
            expected_runner_id=c.conv.runner_id,
            target=str(c.root),
        )
    # A failed operation is immediately recoverable; no fake success on reload.
    reopened.update(c.conv.id, state["id"], phase="failed", error="Server restarted")
    snapshot = (await c.client.get(c.url)).json()
    assert snapshot["can_recover"] is True
    result = await c.client.post(
        c.url,
        json={
            **c.body,
            "request_id": "recovery",
            "expected_workspace": str(c.target),
            "workspace": str(c.root),
            "recover_operation_id": state["id"],
        },
    )
    assert result.status_code == 200, result.text
    assert result.json()["workspace"] == str(c.root)
    assert result.json()["operation"]["phase"] == "completed"


async def test_active_child_blocks_but_idle_child_keeps_its_old_folder(changing_chat):
    c = changing_chat
    child = c.conversations.create_conversation(
        parent_conversation_id=c.conv.id, runner_id=c.conv.runner_id, title="Child agent"
    )
    c.conversations.set_session_live_status(child.id, "running")
    refused = await c.client.post(c.url, json=c.body)
    assert refused.status_code == 409, refused.text
    c.stops.assert_not_awaited()
    c.conversations.set_session_live_status(child.id, "idle")
    result = await c.client.post(c.url, json=c.body)
    assert result.status_code == 200, result.text
    saved = c.conversations.get_conversation(child.id)
    assert saved.workspace == str(c.root)
    assert saved.host_id == c.conv.host_id


async def test_context_is_not_changed_when_another_client_won_the_race(changing_chat):
    c = changing_chat
    c.conversations.set_host_id(c.conv.id, c.conv.host_id, str(c.target))
    result = await c.client.post(c.url, json={**c.body, "workspace": str(c.root)})
    assert result.status_code == 409, result.text
    assert c.conversations.get_conversation(c.conv.id).workspace == str(c.target)
    c.stops.assert_not_awaited()


async def test_legacy_write_requires_the_captured_root_after_a_switch(changing_chat):
    from fastapi import HTTPException

    from omnigent.server.workspace_transition import require_workspace_write_context

    c = changing_chat
    assert (await c.client.post(c.url, json=c.body)).status_code == 200
    current = c.conversations.get_conversation(c.conv.id)
    for body in ({"content": "old"}, {"workspace_root": str(c.root), "content": "old"}):
        with pytest.raises(HTTPException) as failure:
            require_workspace_write_context(current, body)
        assert failure.value.status_code == 409
    require_workspace_write_context(current, {"workspace_root": str(c.target), "content": "new"})


async def test_validate_only_does_not_restart_or_change_the_chat(changing_chat):
    c = changing_chat
    result = await c.client.post(c.url, json={**c.body, "validate_only": True})
    assert result.status_code == 200, result.text
    assert result.json()["validated_workspace"] == str(c.target)
    assert c.conversations.get_conversation(c.conv.id).workspace == str(c.root)
    assert c.conversations.get_conversation(c.conv.id).workspace_transition is None
    c.stops.assert_not_awaited()


async def test_missing_old_directory_and_disconnected_runner_can_be_recovered(changing_chat):
    c = changing_chat
    # The destination is outside the removed root; the host still owns both locations.
    destination = c.root.parent / "recovery"
    destination.mkdir()
    import shutil

    shutil.rmtree(c.root)
    c.service.runner_router = SimpleNamespace(runner_is_online=lambda _id: False)
    c.stops.return_value = False
    response = await c.client.post(c.url, json={**c.body, "workspace": str(destination)})
    assert response.status_code == 200, response.text
    assert response.json()["operation"]["phase"] == "completed"
    assert response.json()["workspace"] == str(destination)
