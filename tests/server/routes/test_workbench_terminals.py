"""Owner ACL, offline evidence and the canonical manual terminal WS relay."""

from __future__ import annotations

import base64
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from omnigent.host.frames import (
    CAP_WORKBENCH_TERMINALS,
    HostTerminalRequestFrame,
    HostTerminalResultFrame,
    HostTerminalStreamFrame,
    decode_host_frame,
)
from omnigent.server.accounts_config import AccountsConfig
from omnigent.server.auth import UnifiedAuthProvider
from omnigent.server.oidc import mint_session_token
from omnigent.server.routes.workbench_terminals import create_workbench_terminals_router
from omnigent.server.workbench_workspace_service import WorkbenchWorkspaceService


@pytest.fixture
def terminal_api(tmp_path: Path):
    workspace = SimpleNamespace(
        id="workspace-a",
        owner_user_id="owner@example.test",
        host_id="host",
        root=str(tmp_path),
        target_kind="host",
        generation="1:external",
    )
    host = SimpleNamespace(
        user_id=workspace.owner_user_id,
        sandbox_provider=None,
        created_at=1,
        account_generation=None,
    )
    conn = SimpleNamespace(
        host_id="host",
        owner=workspace.owner_user_id,
        account_generation=None,
        hello=SimpleNamespace(
            capabilities=[CAP_WORKBENCH_TERMINALS], interactive_shells=["/bin/bash"]
        ),
        pending_terminals={},
        terminal_channels={},
    )
    record = {
        "id": "terminal-a",
        "workspace_id": workspace.id,
        "name": "bash",
        "session": "s1",
        "state": "running",
        "created_at": 1,
        "output": "retained output",
    }
    sent = []

    def send_text(connection, wire):
        frame = decode_host_frame(wire)
        sent.append(frame)
        if isinstance(frame, HostTerminalRequestFrame):
            payload = {"terminals": [record]} if frame.op == "list" else {"terminal": record}
            future = connection.pending_terminals.pop(frame.request_id)
            future.set_result(HostTerminalResultFrame(frame.request_id, payload))
            if frame.op == "attach":
                channel_id = frame.params["channel_id"]
                connection.terminal_channels[channel_id].put_nowait(
                    HostTerminalStreamFrame(
                        channel_id, "bytes", base64.b64encode(b"attached output").decode()
                    )
                )
        elif isinstance(frame, HostTerminalStreamFrame) and frame.event == "bytes":
            connection.terminal_channels[frame.channel_id].put_nowait(frame)

    registry = SimpleNamespace(get=Mock(return_value=conn), send_text=send_text)
    store = SimpleNamespace(
        get=lambda wid, owner: (
            workspace if wid == workspace.id and owner == workspace.owner_user_id else None
        )
    )
    service = WorkbenchWorkspaceService(
        store=store,
        host_store=SimpleNamespace(get_host=lambda _: host),
        host_registry=registry,
        conversation_store=Mock(),
        agent_store=Mock(),
        agent_cache=Mock(),
        auth_provider=UnifiedAuthProvider(
            source="header", local_single_user=False, header_name="X-Forwarded-Email"
        ),
    )
    app = FastAPI()
    app.include_router(
        create_workbench_terminals_router(service, cache_dir=tmp_path / "cache"), prefix="/v1"
    )
    with TestClient(app) as client:
        yield client, registry, conn, sent, service


@pytest.mark.parametrize(
    "method,path,body",
    [
        ("GET", "", None),
        ("GET", "/options", None),
        ("POST", "", {"terminal": "shell"}),
        ("GET", "/terminal-a", None),
        ("POST", "/terminal-a/stop", None),
        ("DELETE", "/terminal-a", None),
    ],
)
def test_every_manual_terminal_operation_checks_workspace_owner(terminal_api, method, path, body):
    client, _, _, sent, _ = terminal_api
    response = client.request(
        method,
        "/v1/workbench-workspaces/workspace-a/terminals" + path,
        json=body,
        headers={"X-Forwarded-Email": "other@example.test"},
    )
    assert response.status_code == 404
    assert not sent


def test_websocket_rejects_other_owner_before_host_contact(terminal_api):
    client, _, _, sent, _ = terminal_api
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect(
            "/v1/workbench-workspaces/workspace-a/terminals/terminal-a/attach",
            headers={"X-Forwarded-Email": "other@example.test"},
        ):
            pass
    assert exc.value.code == 4404
    assert not sent


def test_offline_list_keeps_last_lifecycle_and_output(terminal_api):
    client, registry, _, _, _ = terminal_api
    url = "/v1/workbench-workspaces/workspace-a/terminals"
    headers = {"X-Forwarded-Email": "owner@example.test"}
    live = client.get(url, headers=headers).json()
    assert live["data"][0]["running"]
    registry.get.return_value = None
    offline = client.get(url, headers=headers).json()
    record = offline["data"][0]
    assert not offline["available"]
    assert record["state"] == "running"
    assert record["connectivity"] == "disconnected"
    assert not record["running"]
    assert record["metadata"]["output"] == "retained output"
    assert client.delete(url + "/terminal-a", headers=headers).status_code == 503


def test_canonical_attach_relays_binary_without_conversation_ownership(terminal_api):
    client, _, conn, sent, _ = terminal_api
    with client.websocket_connect(
        "/v1/workbench-workspaces/workspace-a/terminals/terminal-a/attach",
        headers={"X-Forwarded-Email": "owner@example.test"},
    ) as ws:
        assert ws.receive_bytes() == b"attached output"
        ws.send_bytes(b"echo hi\n")
        assert ws.receive_bytes() == b"echo hi\n"
    assert not conn.terminal_channels
    requests = [frame for frame in sent if isinstance(frame, HostTerminalRequestFrame)]
    assert requests[0].workspace_id == "workspace-a"
    assert requests[0].op == "attach"


def test_host_disconnect_wakes_attached_viewer(terminal_api):
    client, _, conn, _, _ = terminal_api
    with client.websocket_connect(
        "/v1/workbench-workspaces/workspace-a/terminals/terminal-a/attach",
        headers={"X-Forwarded-Email": "owner@example.test"},
    ) as ws:
        assert ws.receive_bytes() == b"attached output"
        from omnigent.server.host_registry import _fail_pending_terminals

        client.portal.call(_fail_pending_terminals, conn)
        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_bytes()
        assert exc.value.code == 1013


@pytest.mark.parametrize("credential", ["cookie", "bearer"])
def test_websocket_uses_real_cookie_and_bearer_auth(terminal_api, credential):
    client, _, _, _, service = terminal_api
    config = AccountsConfig(
        cookie_secret=b"t" * 32,
        session_ttl_hours=1,
        base_url="http://testserver",
        init_admin_password=None,
        invite_ttl_seconds=60,
        magic_ttl_seconds=60,
    )
    service.auth_provider = UnifiedAuthProvider(source="accounts", accounts_config=config)
    token = mint_session_token("owner@example.test", config.cookie_secret, 60, "accounts")
    headers = (
        {"Cookie": f"{config.session_cookie_name}={token}"}
        if credential == "cookie"
        else {"Authorization": f"Bearer {token}"}
    )
    path = "/v1/workbench-workspaces/workspace-a/terminals/terminal-a/attach"
    with client.websocket_connect(path, headers=headers) as ws:
        assert ws.receive_bytes() == b"attached output"
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect(path, headers={"Authorization": "Bearer invalid"}):
            pass
    assert exc.value.code == 4403


@pytest.mark.parametrize(
    "changed", ["host_owner", "tunnel_owner", "generation", "tunnel_generation"]
)
def test_terminal_host_target_is_revalidated_before_rpc(terminal_api, changed):
    client, _, conn, sent, service = terminal_api
    if changed == "host_owner":
        service.host_store.get_host("host").user_id = "other@example.test"
    elif changed == "tunnel_owner":
        conn.owner = "other@example.test"
    elif changed == "generation":
        service.host_store.get_host("host").created_at = 2
    else:
        conn.account_generation = "replacement-account"
    response = client.post(
        "/v1/workbench-workspaces/workspace-a/terminals",
        json={"terminal": "shell"},
        headers={"X-Forwarded-Email": "owner@example.test"},
    )
    assert response.status_code in {403, 409}
    assert not sent
