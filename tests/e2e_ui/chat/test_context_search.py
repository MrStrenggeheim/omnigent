"""Contextual Search through the real server, persisted messages and host workspace."""

from __future__ import annotations

import re
import uuid
from pathlib import Path
from urllib.parse import urlsplit

import pytest
from playwright.sync_api import Page, expect

from tests.e2e_ui.files.test_workbench_ownership import Ownership
from tests.e2e_ui.files.test_workbench_ownership import ownership as ownership

QUERY = "needle✓"


def append_message(owner: Ownership, index: int, role: str, text: str) -> None:
    response_id = "search-seed-" + uuid.uuid4().hex
    payload = (
        {
            "type": "external_assistant_message",
            "data": {"agent": "hello_world", "text": text, "response_id": response_id},
        }
        if role == "assistant"
        else {
            "type": "external_conversation_item",
            "data": {
                "item_type": "message",
                "item_data": {"role": role, "content": [{"type": "input_text", "text": text}]},
                "response_id": response_id,
            },
        }
    )
    response = owner.client.post(f"/v1/sessions/{owner.chats[index]}/events", json=payload)
    assert response.is_success, response.text[:1000]


def active_range(page: Page) -> dict:
    return page.evaluate(
        """query => {
            const ranges = globalThis.CSS?.highlights?.get('chat-search-active');
            const range = ranges ? [...ranges][0] : null;
            if(!range) return {};
            const element = range.startContainer.parentElement;
            const root = element.closest('.message-markdown, [data-chat-plain-text]');
            const before = document.createRange();
            before.selectNodeContents(root);
            before.setEnd(range.startContainer, range.startOffset);
            return {text:range.toString(),
                row:element.closest('[data-message-id]')?.dataset.messageId,
                priorMatches:before.toString().split(query).length - 1};
        }""",
        QUERY,
    )


@pytest.mark.parametrize("mobile", [False, True], ids=["desktop", "phone"])
def test_context_search_navigates_exact_history_and_preserves_views(
    page: Page, ownership: Ownership, mobile: bool, output_path: str
) -> None:
    # The first prompt is absent from the initial 100-item page and collapsed when loaded.
    append_message(
        ownership, 0, "user", "😀" * 35_000 + f" Oldest reference {QUERY} then {QUERY}."
    )
    append_message(ownership, 0, "assistant", f"Rich reference: **{QUERY}** and `{QUERY}`.")
    for index in range(143):
        append_message(ownership, 0, "assistant", f"Ordinary intervening message {index}.")
    append_message(ownership, 0, "assistant", "Recent context anchor.")
    append_message(ownership, 1, "assistant", f"Other conversation reference {QUERY}.")
    expected = ownership.client.get(
        "/v1/sessions/search/messages", params={"query": QUERY, "session_id": ownership.chats[0]}
    )
    expected.raise_for_status()
    old = next(hit for hit in expected.json()["data"] if "Oldest reference" in hit["text"])
    assert old["text_start"] > 0 and len(old["ranges"]) == 2
    history: list[str] = []
    page.on(
        "request",
        lambda request: (
            history.append(request.url) if f"/{ownership.chats[0]}/items?" in request.url else None
        ),
    )
    page.set_viewport_size({"width": 390 if mobile else 1600, "height": 900})
    page.goto(f"{ownership.base}/c/{ownership.chats[0]}")
    composer = page.get_by_label("Message the agent", exact=True)
    expect(composer).to_be_visible(timeout=30_000)
    composer.fill("Keep this unsent draft.")
    sidebar = page.get_by_role("complementary", name="Conversations", include_hidden=True)
    if sidebar.get_attribute("aria-hidden") == "false":
        page.keyboard.press("ControlOrMeta+b")
    expect(sidebar).to_have_attribute("aria-hidden", "true")
    # Focus in the composer selects the chat region; hover does not change ownership.
    composer.click()
    page.keyboard.press("ControlOrMeta+f")
    search = page.get_by_role("region", name="Chat search")
    # section's explicit aria-label makes it a named region.
    expect(search).to_be_visible()
    query = search.get_by_label("Search chats", exact=True)
    expect(search.get_by_role("button", name="Current chat", exact=True)).to_have_attribute(
        "aria-pressed", "true"
    )
    query.fill(QUERY)
    bar = page.get_by_test_id("context-search-bar")
    expect(bar.get_by_role("status")).to_have_text(re.compile(r"1 of 4\+?"), timeout=30_000)
    page.wait_for_function("CSS.highlights.get('chat-search-active')?.size === 1")
    first = active_range(page)
    assert first == {"text": QUERY, "row": old["item_id"], "priorMatches": 0}
    expect(query).to_be_focused()
    assert sum("after=" in url or "before=" in url for url in history) >= 2, history
    query.press("Enter")
    expect(bar.get_by_role("status")).to_have_text(re.compile(r"2 of 4\+?"))
    page.wait_for_function(
        """query => {
        const range = [...(CSS.highlights.get('chat-search-active') ?? [])][0];
        if(!range) return false;
        const root=range.startContainer.parentElement.closest(
            '.message-markdown, [data-chat-plain-text]');
        const prefix=document.createRange();
        prefix.selectNodeContents(root);prefix.setEnd(range.startContainer,range.startOffset);
        return prefix.toString().includes(query);
    }""",
        arg=QUERY,
    )
    assert active_range(page)["priorMatches"] == 1
    bar.get_by_role("button", name="Next match", exact=True).click()
    expect(bar.get_by_role("status")).to_have_text(re.compile(r"3 of 4\+?"))
    page.wait_for_function(
        """old => {
            const range = [...(CSS.highlights.get('chat-search-active') ?? [])][0];
            return range && range.startContainer.parentElement.closest('[data-message-id]')
                ?.dataset.messageId !== old;
        }""",
        arg=old["item_id"],
    )
    page.screenshot(
        path=str(Path(output_path) / "context-search-active.png"), animations="disabled"
    )
    if mobile:
        expect(sidebar).to_have_attribute("aria-hidden", "true")
        bar.get_by_role("button", name="Edit search query", exact=True).click()
    # All-chat typing only changes results, never the selected conversation.
    search.get_by_role("button", name="All chats", exact=True).click()
    expect(
        search.get_by_role("button").filter(has_text="Other conversation reference")
    ).to_be_visible(timeout=30_000)
    assert urlsplit(page.url).path.endswith("/c/" + ownership.chats[0])
    expect(composer).to_have_value("Keep this unsent draft.")
    search.get_by_role("button").filter(has_text="Other conversation reference").click()
    expect(page).to_have_url(re.compile(rf"/c/{ownership.chats[1]}(?:\?|$)"))
    expect(bar.get_by_role("status")).to_have_text("1 of 1", timeout=30_000)
    if mobile:
        expect(sidebar).to_have_attribute("aria-hidden", "true")
        bar.get_by_role("button", name="Edit search query", exact=True).click()
    expect(query).to_have_value(QUERY)
    expect(search.get_by_role("button", name="All chats", exact=True)).to_have_attribute(
        "aria-pressed", "true"
    )
    search.get_by_role("button").filter(has_text="Oldest reference").click()
    expect(page).to_have_url(re.compile(rf"/c/{ownership.chats[0]}(?:\?|$)"))
    expect(composer).to_have_value("Keep this unsent draft.")
    expect(bar.get_by_role("status")).to_have_text(re.compile(r"1 of 4\+?"), timeout=30_000)
    # Escape from a bar button closes Search even if its read-only tooltip is visible.
    close = bar.get_by_role("button", name="Close search", exact=True)
    close.focus()
    close.press("Escape")
    expect(bar).to_have_count(0)
    expect(sidebar).to_have_attribute("aria-hidden", "true")
    assert active_range(page) == {}
    expect(composer).to_have_value("Keep this unsent draft.")


def test_context_find_routes_file_explorer_and_plain_chat_text(
    page: Page, ownership: Ownership
) -> None:
    append_message(ownership, 0, "assistant", "Plain chat text selects the chat find region.")
    page.set_viewport_size({"width": 1600, "height": 900})
    page.goto(f"{ownership.base}/c/{ownership.chats[0]}?view=explore")
    explorer = page.locator('[data-context-search-region="explorer"]').filter(visible=True)
    expect(explorer).to_be_visible(timeout=30_000)
    explorer.get_by_label("Search all files", exact=True).click()
    page.keyboard.press("ControlOrMeta+f")
    expect(page.get_by_role("region", name="Content search", exact=True)).to_be_visible()
    expect(page.get_by_test_id("context-search-sidebar")).to_have_count(0)
    page.goto(f"{ownership.base}/c/{ownership.chats[0]}?file=same.txt")
    viewer = page.get_by_test_id("file-viewer").filter(visible=True)
    expect(viewer).to_be_visible(timeout=30_000)
    viewer.locator(".view-lines").click()
    page.keyboard.press("ControlOrMeta+f")
    expect(viewer.locator(".find-widget")).to_be_visible()
    expect(page.get_by_test_id("context-search-sidebar")).to_have_count(0)
    # Plain message text is not focusable, so this specifically checks pointer ownership.
    page.get_by_text("Plain chat text selects the chat find region.", exact=True).click()
    page.keyboard.press("ControlOrMeta+f")
    search = page.get_by_test_id("context-search-sidebar")
    expect(search).to_be_visible()
    expect(search.get_by_role("button", name="Current chat", exact=True)).to_have_attribute(
        "aria-pressed", "true"
    )
    expect(search.get_by_label("Search chats", exact=True)).to_be_focused()
