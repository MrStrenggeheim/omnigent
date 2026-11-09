"""Recorded native-command projection through the real Activity panel."""

from __future__ import annotations

import json
from pathlib import Path

import httpx
import pytest
from playwright.sync_api import Page, expect

from tests._helpers.polling import poll_until


def test_activity_inspects_recorded_commands_without_attaching_a_terminal(
    page: Page, seeded_session: tuple[str, str], request: pytest.FixtureRequest
) -> None:
    base, session_id = seeded_session
    with httpx.Client(base_url=base, timeout=30) as client:
        for kind, data in (
            (
                "function_call",
                {
                    "agent": "codex-native-ui",
                    "name": "exec_command",
                    "call_id": "activity-proof",
                    "arguments": json.dumps({"cmd": "printf activity-proof"}),
                },
            ),
            (
                "function_call_output",
                {
                    "call_id": "activity-proof",
                    "output": json.dumps({"exit_code": 0, "stdout": "activity-proof-output"}),
                },
            ),
        ):
            response = client.post(
                f"/v1/sessions/{session_id}/events",
                json={
                    "type": "external_conversation_item",
                    "data": {
                        "item_type": kind,
                        "item_data": data,
                        "response_id": "activity-proof-response",
                    },
                },
            )
            assert response.status_code == 202, response.text
        poll_until(
            lambda: any(
                row["kind"] == "command" and row["state"] == "exited"
                for row in client.get(f"/v1/sessions/{session_id}/activity").json()["data"]
            ),
            timeout_s=15,
            interval_s=0.1,
        )
        response = client.get(f"/v1/sessions/{session_id}/activity")
        response.raise_for_status()
        recorded = next(row for row in response.json()["data"] if row["kind"] == "command")
        assert recorded["state"] == "exited"
        assert recorded["exit_status"] == 0
        assert not recorded.get("terminal_id")
    websockets: list[str] = []
    page.on("websocket", lambda connection: websockets.append(connection.url))
    page.goto(f"{base}/c/{session_id}?panel=agents")
    panel = page.get_by_role("complementary", name="Workspace")
    panel.get_by_role("group", name="Activity filter").get_by_role("button", name="Shells").click()
    panel.get_by_role("button", name="Past (1)", exact=True).click()
    panel.get_by_role("button", name="Inspect Commands without a terminal", exact=True).click()
    dialog = page.get_by_role("dialog", name="Commands without a terminal")
    expect(dialog).to_contain_text("activity-proof-output")
    expect(dialog).to_contain_text("Exit status")
    expect(dialog.locator(".xterm")).to_have_count(0)
    assert not any(recorded["id"] in url and "/terminals/" in url for url in websockets)
    page.screenshot(
        path=str(Path(request.config.getoption("output")) / "chat-activity-history.png"),
        animations="disabled",
    )
