"""Runner activity transport uses runner auth and retained launch IDs."""

from pathlib import Path
from typing import cast

import httpx
import pytest

from omnigent.runner.app import create_runner_app
from omnigent.terminals.history import ActivityEntry, TerminalHistory
from omnigent.terminals.registry import TerminalRegistry
from tests.runner.helpers import NullServerClient


@pytest.mark.asyncio
async def test_runner_activity_auth_and_disconnected_history(tmp_path: Path) -> None:
    history = TerminalHistory(tmp_path / "history.sqlite3")
    history.record(
        ActivityEntry(
            id="old-launch",
            session_id="chat",
            terminal_id="terminal_bash_main",
            name="bash",
            owner_id="chat",
            state="exited",
            exit_status=4,
            ended_at=2,
            output="done",
        )
    )
    history.record(
        ActivityEntry(
            id="lost-launch",
            session_id="chat",
            name="bash",
            owner_id="chat",
            state="running",
        )
    )
    app = create_runner_app(
        server_client=cast(httpx.AsyncClient, NullServerClient()),
        terminal_registry=TerminalRegistry(history=history),
        auth_token="test-token",
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://runner"
    ) as client:
        assert (await client.get("/v1/sessions/chat/activity")).status_code == 401
        response = await client.get(
            "/v1/sessions/chat/activity", headers={"Authorization": "Bearer test-token"}
        )
        assert response.status_code == 200
        rows = {row["id"]: row for row in response.json()["data"]}
        assert rows["old-launch"]["exit_status"] == 4
        assert rows["old-launch"]["output"] == "done"
        assert rows["lost-launch"]["state"] == "disconnected"
        assert "ended_at" not in rows["lost-launch"]
        other = await client.get(
            "/v1/sessions/other/activity", headers={"Authorization": "Bearer test-token"}
        )
        assert other.json()["data"] == []
