"""The file menu copies the current unsaved Markdown buffer as source."""

from __future__ import annotations

from pathlib import Path

import httpx
import pytest
from playwright.sync_api import Page, expect

from tests.e2e_ui.files.test_file_autosave import _seed_file


def test_markdown_copy_content_in_menu_includes_unsaved_edits(
    page: Page, seeded_session: tuple[str, str], request: pytest.FixtureRequest
) -> None:
    base, session_id = seeded_session
    path = "menu-copy.md"
    original = "# Copy document\n\nOriginal **bold** text.\n"
    _seed_file(base, session_id, path, original)
    page.context.grant_permissions(["clipboard-read", "clipboard-write"], origin=base)
    # Retain a genuine unsaved buffer without changing the source on disk.
    page.route(
        "**/filesystem/menu-copy.md*",
        lambda route: (
            route.fulfill(status=503, json={"detail": "Autosave paused for clipboard proof"})
            if route.request.method == "PUT"
            else route.continue_()
        ),
    )
    page.goto(f"{base}/c/{session_id}?file={path}&view=explore")
    viewer = page.get_by_test_id("file-viewer")
    editor = viewer.locator('[contenteditable="true"]').first
    expect(editor).to_contain_text("Copy document", timeout=30_000)
    expect(viewer.get_by_role("button", name="Copy", exact=True)).to_have_count(0)
    editor.click()
    page.keyboard.press("Control+End")
    page.keyboard.type(" unsaved-menu-copy")
    menu = viewer.get_by_role("button", name="View settings", exact=True)
    if not menu.is_visible():
        menu = viewer.get_by_role("button", name="More actions", exact=True)
    menu.click()
    copy = page.get_by_role("menuitem", name="Copy file content", exact=True)
    expect(copy).to_be_visible()
    page.screenshot(
        path=str(Path(request.config.getoption("output")) / "markdown-copy-file-menu.png"),
        animations="disabled",
    )
    copy.click()
    expect(page.get_by_text("File content copied", exact=True)).to_be_visible()
    copied = page.evaluate("navigator.clipboard.readText()")
    assert "unsaved-menu-copy" in copied
    assert "**bold**" in copied
    assert "# Copy document" in copied
    response = httpx.get(
        f"{base}/v1/sessions/{session_id}/resources/environments/default/filesystem/{path}",
        timeout=15,
    )
    response.raise_for_status()
    assert response.json()["content"] == original
