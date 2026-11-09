"""Queued follow-ups and attachments survive a browser reload in FIFO order."""

from __future__ import annotations

import json
from pathlib import Path

import httpx
import pytest
from playwright.sync_api import Page, expect

from tests.e2e_ui.chat.test_always_steer import (
    _items_contain,
    _record_message_posts,
    _release_gate,
    _send,
    _wait_for,
    _wait_for_gate,
)


def test_queued_messages_survive_reload_with_attachment_and_delete(
    page: Page,
    paused_mid_turn_session: tuple[str, str, str],
    request: pytest.FixtureRequest,
) -> None:
    base, session_id, mock = paused_mid_turn_session
    posts = _record_message_posts(page, session_id)
    page.goto(f"{base}/c/{session_id}")
    expect(page.get_by_label("Message the agent")).to_be_visible(timeout=30_000)
    _send(page, "queue-reload-initial")
    _wait_for_gate(page, mock)
    page.locator('.chat-composer-form input[type="file"]').first.set_input_files(
        {
            "name": "queued-notes.txt",
            "mimeType": "text/plain",
            "buffer": b"durable attachment bytes",
        }
    )
    _send(page, "queue-reload-first")
    queue = page.get_by_test_id("composer-queued-strip")
    expect(queue).to_contain_text("queue-reload-first")
    expect(queue.get_by_test_id("queued-message-attachments")).to_contain_text("queued-notes.txt")
    _send(page, "queue-reload-second")
    _send(page, "queue-reload-removed")
    queue.get_by_role("button", name="Remove queued message", exact=True).last.click()
    expect(queue).not_to_contain_text("queue-reload-removed")
    assert posts == ["queue-reload-initial"]
    page.reload()
    expect(queue).to_contain_text("queue-reload-first", timeout=30_000)
    expect(queue).to_contain_text("queue-reload-second")
    expect(queue).not_to_contain_text("queue-reload-removed")
    expect(queue.get_by_test_id("queued-message-attachments")).to_contain_text("queued-notes.txt")
    assert posts == ["queue-reload-initial"]
    page.screenshot(
        path=str(Path(request.config.getoption("output")) / "restored-queued-messages.png"),
        animations="disabled",
    )
    _release_gate(mock)
    _wait_for(
        page,
        lambda: posts == ["queue-reload-initial", "queue-reload-first", "queue-reload-second"],
        timeout_s=90,
    )
    expect(queue).to_have_count(0, timeout=30_000)
    _wait_for(
        page,
        lambda: _items_contain(base, session_id, "queue-reload-first", "queue-reload-second"),
        timeout_s=30,
    )
    page.reload()
    expect(page.get_by_label("Message the agent")).to_be_visible(timeout=30_000)
    expect(queue).to_have_count(0)
    response = httpx.get(
        f"{base}/v1/sessions/{session_id}/items", params={"limit": 1000}, timeout=15
    )
    response.raise_for_status()
    items = response.json()["data"]
    for text in ("queue-reload-first", "queue-reload-second"):
        matching = [
            item for item in items if item.get("type") == "message" and text in json.dumps(item)
        ]
        assert len(matching) == 1, items
    assert "queue-reload-removed" not in json.dumps(items)
