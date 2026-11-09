"""Manual terminal lifetime through real server and host control tunnels."""

from __future__ import annotations

import os
import shutil
from pathlib import Path

import httpx
import pytest
from websockets.sync.client import connect

from omnigent.server.auth import LEVEL_OWNER
from omnigent.stores.conversation_store.sqlalchemy_store import SqlAlchemyConversationStore
from omnigent.stores.permission_store.sqlalchemy_store import SqlAlchemyPermissionStore
from tests._helpers.host import isolated_host
from tests._helpers.live_server import isolated_local_server
from tests._helpers.polling import poll_until


@pytest.mark.skipif(shutil.which("tmux") is None, reason="tmux unavailable")
def test_host_manual_terminal_survives_chat_delete_and_retains_exit(tmp_path: Path) -> None:
    # Distinct boundary: real control frames, daemon dispatch and tmux WS attachment.
    base_env = {"PATH": os.environ["PATH"]}
    root = tmp_path / "workspace"
    root.mkdir()
    server_root = tmp_path / "server"
    with (
        isolated_local_server(server_root, base_env=base_env) as base_url,
        httpx.Client(base_url=base_url, trust_env=False, timeout=30) as client,
        isolated_host(tmp_path / "host", base_url, base_env=base_env) as host,
    ):
        host.wait_online(client)
        response = client.post(
            "/v1/workbench-workspaces", json={"host_id": host.host_id, "root": str(root)}
        )
        assert response.status_code == 200, response.text
        workspace_id = response.json()["id"]
        url = f"/v1/workbench-workspaces/{workspace_id}/terminals"
        options = client.get(url + "/options")
        assert options.status_code == 200, options.text
        created = client.post(url, json={"terminal": "shell"})
        assert created.status_code == 200, created.text
        terminal = created.json()
        terminal_id = terminal["id"]
        database_uri = f"sqlite:///{server_root / 'chat.db'}"
        conversations = SqlAlchemyConversationStore(database_uri)
        permissions = SqlAlchemyPermissionStore(database_uri)
        conversation = conversations.create_conversation(host_id=host.host_id, workspace=str(root))
        permissions.ensure_user("local")
        permissions.grant("local", conversation.id, LEVEL_OWNER)
        ws_url = base_url.replace("http://", "ws://") + terminal["attachPath"]
        with connect(ws_url, open_timeout=10) as ws:
            deleted = client.delete(f"/v1/sessions/{conversation.id}")
            assert deleted.status_code in {200, 204}, deleted.text
            ws.send(b"printf 'survived-chat-deletion\\n'; exit 9\n")
            output = bytearray()
            while b"survived-chat-deletion" not in output:
                message = ws.recv(timeout=10)
                if isinstance(message, bytes):
                    output.extend(message)

        def exited():
            response = client.get(url + "/" + terminal_id)
            response.raise_for_status()
            return response.json()["state"] == "exited"

        poll_until(exited, timeout_s=10, interval_s=0.2)
        detail = client.get(url + "/" + terminal_id).json()
        assert detail["metadata"]["exit_code"] == 9
        assert "survived-chat-deletion" in detail["metadata"]["output"]
        assert not detail["running"]
        host.proc.terminate()
        host.proc.wait(timeout=10)
        poll_until(lambda: not client.get(url).json()["available"], timeout_s=10, interval_s=0.2)
        offline = client.get(url + "/" + terminal_id).json()
        assert offline["state"] == "exited"
        assert offline["connectivity"] == "disconnected"
        assert offline["metadata"]["exit_code"] == 9
