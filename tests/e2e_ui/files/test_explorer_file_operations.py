"""Explorer actions and replacement through the real SPA, server and runner."""

from __future__ import annotations

import re
import zipfile
from pathlib import Path

import httpx
import pytest
from playwright.sync_api import Locator, Page, Route, expect

from tests.e2e_ui.files.test_file_autosave import (
    _cleanup_session_workdir,
    _read_file,
    _seed_file,
)


def _entry(panel: Locator, path: str) -> Locator:
    return panel.locator(f'[data-explorer-entry="{path}"]')


def _apply_name(page: Page, name: str) -> None:
    dialog = page.get_by_role("dialog")
    dialog.get_by_role("textbox", name="Name", exact=True).fill(name)
    dialog.get_by_role("button", name="Apply", exact=True).click()
    expect(dialog).not_to_be_visible(timeout=20_000)


def test_explorer_manages_files_transfers_and_recovery(
    page: Page, seeded_session: tuple[str, str], tmp_path: Path
) -> None:
    base_url, session_id = seeded_session
    _seed_file(base_url, session_id, "seed.txt", "original content\n")
    try:
        page.goto(f"{base_url}/c/{session_id}?view=explore")
        panel = page.get_by_role("complementary", name="Workspace")
        expect(panel.get_by_role("button", name="New file", exact=True)).to_be_visible(
            timeout=30_000
        )
        panel.get_by_role("button", name="New folder", exact=True).click()
        _apply_name(page, "library")
        expect(_entry(panel, "library")).to_be_visible()
        panel.get_by_role("button", name="New file", exact=True).click()
        _apply_name(page, "created.txt")
        assert _read_file(base_url, session_id, "created.txt") == ""

        _entry(panel, "created.txt").click(button="right")
        page.get_by_role("menuitem", name="Rename…", exact=True).click()
        _apply_name(page, "renamed.txt")
        expect(_entry(panel, "created.txt")).to_have_count(0)
        expect(_entry(panel, "renamed.txt")).to_be_visible()
        _entry(panel, "renamed.txt").click(button="right")
        page.get_by_role("menuitem", name="Duplicate…", exact=True).click()
        _apply_name(page, "duplicate.txt")
        expect(_entry(panel, "duplicate.txt")).to_be_visible()

        _entry(panel, "duplicate.txt").click(button="right")
        page.get_by_role("menuitem", name="Move to trash…", exact=True).click()
        page.get_by_role("dialog").get_by_role("button", name="Move to trash", exact=True).click()
        expect(_entry(panel, "duplicate.txt")).to_have_count(0)
        panel.get_by_role("button", name="More file actions", exact=True).click()
        page.get_by_role("menuitem", name="Restore deleted files…", exact=True).click()
        restore = page.get_by_role("dialog")
        expect(restore).to_contain_text("duplicate.txt")
        restore.get_by_role("button", name="Restore", exact=True).click()
        expect(restore).to_contain_text("Trash is empty.")
        page.keyboard.press("Escape")
        expect(_entry(panel, "duplicate.txt")).to_be_visible()

        panel.get_by_role("button", name="Actions for renamed.txt", exact=True).click()
        page.get_by_role("menuitem", name="Copy", exact=True).click()
        panel.get_by_role("button", name="Actions for library", exact=True).click()
        with page.expect_response(
            lambda response: (
                response.request.method == "POST" and "/filesystem-operations" in response.url
            )
        ) as copied:
            page.get_by_role("menuitem", name="Paste", exact=True).click()
        assert copied.value.ok
        assert _read_file(base_url, session_id, "library/renamed.txt") == ""

        panel.get_by_role("button", name="Actions for duplicate.txt", exact=True).click()
        page.get_by_role("menuitem", name="Move to…", exact=True).click()
        dialog = page.get_by_role("dialog")
        dialog.get_by_role("textbox", name="Destination folder").fill("library")
        dialog.get_by_role("button", name="Apply", exact=True).click()
        expect(dialog).not_to_be_visible(timeout=20_000)
        assert _read_file(base_url, session_id, "library/duplicate.txt") == ""
        expect(_entry(panel, "duplicate.txt")).to_have_count(0)

        incoming = tmp_path / "incoming"
        (incoming / "nested").mkdir(parents=True)
        (incoming / "nested" / "asset.bin").write_bytes(b"directory upload\x00\xff")
        panel.locator('input[type="file"][aria-label="Upload folder"]').set_input_files(incoming)
        with page.expect_response(
            lambda response: (
                response.request.method == "POST"
                and "/filesystem-operations" in response.url
                and response.request.post_data_json.get("operation") == "upload_finish"
            )
        ) as finished:
            page.get_by_role("dialog").get_by_role("button", name="Upload", exact=True).click()
        assert finished.value.ok
        expect(_entry(panel, "incoming")).to_be_visible(timeout=30_000)
        response = httpx.get(
            f"{base_url}/v1/sessions/{session_id}"
            "/resources/environments/default/filesystem/incoming/nested/asset.bin",
            params={"download": "true"},
            timeout=15,
        )
        response.raise_for_status()
        assert response.content == b"directory upload\x00\xff"

        payload = b"\x00\xff\x01uploaded binary\n"
        panel.locator('input[type="file"][aria-label="Upload files"]').set_input_files(
            {"name": "binary.dat", "mimeType": "application/octet-stream", "buffer": payload}
        )
        page.get_by_role("dialog").get_by_role("button", name="Upload", exact=True).click()
        expect(_entry(panel, "binary.dat")).to_be_visible(timeout=30_000)
        file_url = (
            f"{base_url}/v1/sessions/{session_id}"
            "/resources/environments/default/filesystem/binary.dat"
        )
        response = httpx.get(file_url, params={"download": "true"}, timeout=15)
        response.raise_for_status()
        assert response.content == payload

        _entry(panel, "binary.dat").click(button="right")
        with page.expect_download(timeout=30_000) as pending:
            page.get_by_role("menuitem", name="Download as ZIP", exact=True).click()
        archive = tmp_path / "download.zip"
        pending.value.save_as(archive)
        with zipfile.ZipFile(archive) as downloaded:
            assert downloaded.read("binary.dat") == payload
    finally:
        _cleanup_session_workdir(session_id)


@pytest.mark.parametrize("mobile", [False, True], ids=["desktop", "mobile"])
def test_workspace_search_replace_preview_and_undo(
    page: Page, seeded_session: tuple[str, str], mobile: bool
) -> None:
    base_url, session_id = seeded_session
    original = "alpha fox alpha\nuntouched\n"
    _seed_file(base_url, session_id, "search.txt", original)
    try:
        if mobile:
            page.set_viewport_size({"width": 390, "height": 844})
        page.goto(f"{base_url}/c/{session_id}?view=explore")
        if mobile:
            page.get_by_role("button", name="Conversation actions").click()
            page.get_by_role("menuitem", name="Files", exact=True).click()
            page.get_by_role("button", name="New file", exact=True).filter(visible=True).click()
            _apply_name(page, "phone.txt")
            page.get_by_role("button", name="Actions for phone.txt", exact=True).filter(
                visible=True
            ).click()
            page.get_by_role("menuitem", name="Rename…", exact=True).click()
            _apply_name(page, "phone-renamed.txt")
            assert _read_file(base_url, session_id, "phone-renamed.txt") == ""
        page.get_by_role("button", name="Search folder contents", exact=True).filter(
            visible=True
        ).click()
        panel = page.get_by_role("region", name="Content search").filter(visible=True)
        query = panel.get_by_role("searchbox", name="Search file contents")
        expect(query).to_be_visible(timeout=30_000)
        query.fill("alpha")
        expect(panel.get_by_role("button", name="Open search.txt at line 1")).to_have_count(
            2, timeout=20_000
        )
        panel.get_by_role("button", name="Replace", exact=True).click()
        panel.get_by_role("textbox", name="Replace with").fill("beta")
        panel.get_by_role("button", name=re.compile(r"Preview replacements \(2\)")).click()
        expect(panel.get_by_text("Review replacements", exact=True)).to_be_visible()
        assert _read_file(base_url, session_id, "search.txt") == original
        panel.get_by_role("button", name="Apply replacements", exact=True).click()
        expect(panel.get_by_text("Replaced 2 matches in 1 files.", exact=True)).to_be_visible(
            timeout=20_000
        )
        assert _read_file(base_url, session_id, "search.txt") == "beta fox beta\nuntouched\n"
        panel.get_by_role("button", name="Undo replacement", exact=True).click()
        expect(panel.get_by_text("Restored 1 files.", exact=True)).to_be_visible(timeout=20_000)
        assert _read_file(base_url, session_id, "search.txt") == original
    finally:
        _cleanup_session_workdir(session_id)


@pytest.mark.parametrize("cancel", [False, True], ids=["continue", "cancel"])
def test_upload_continues_while_viewing_another_file(
    page: Page, seeded_session: tuple[str, str], cancel: bool
) -> None:
    base_url, session_id = seeded_session
    _seed_file(base_url, session_id, "navigation.txt", "Keep browsing while uploading.\n")
    held: list[Route] = []

    def hold_first_chunk(route: Route) -> None:
        body = route.request.post_data_json
        if isinstance(body, dict) and body.get("operation") == "upload_chunk" and not held:
            held.append(route)
        else:
            route.continue_()

    page.route("**/filesystem-operations", hold_first_chunk)
    try:
        page.goto(f"{base_url}/c/{session_id}?view=explore")
        panel = page.get_by_role("complementary", name="Workspace")
        expect(panel.get_by_role("button", name="Choose files to upload")).to_be_visible(
            timeout=30_000
        )
        payload = bytes(range(256)) * 1024
        panel.locator('input[type="file"][aria-label="Upload files"]').set_input_files(
            {"name": "background.bin", "mimeType": "application/octet-stream", "buffer": payload}
        )
        with page.expect_request(
            lambda request: (
                request.method == "POST"
                and "/filesystem-operations" in request.url
                and request.post_data_json.get("operation") == "upload_chunk"
            )
        ):
            page.get_by_role("dialog").get_by_role("button", name="Upload", exact=True).click()
        transfers = page.get_by_role("complementary", name="File transfers")
        expect(transfers.get_by_role("button", name="Cancel upload")).to_be_visible()
        assert len(held) == 1
        _entry(panel, "navigation.txt").locator("button").first.click()
        expect(page.get_by_test_id("file-viewer")).to_be_visible(timeout=30_000)
        expect(transfers.get_by_role("button", name="Cancel upload")).to_be_visible()
        if cancel:
            transfers.get_by_role("button", name="Cancel upload").click()
            held[0].abort()
            expect(
                transfers.get_by_text("Upload cancelled. Completed files are kept.", exact=True)
            ).to_be_visible(timeout=30_000)
            response = httpx.get(
                f"{base_url}/v1/sessions/{session_id}"
                "/resources/environments/default/filesystem/background.bin",
                timeout=15,
            )
            assert response.status_code == 404
            return
        held[0].continue_()
        expect(transfers.get_by_text("Upload complete", exact=True)).to_be_visible(timeout=30_000)
        response = httpx.get(
            f"{base_url}/v1/sessions/{session_id}"
            "/resources/environments/default/filesystem/background.bin",
            params={"download": "true"},
            timeout=15,
        )
        response.raise_for_status()
        assert response.content == payload
    finally:
        _cleanup_session_workdir(session_id)


def test_explorer_keyboard_bulk_drag_reveal_and_external_refresh(
    page: Page, seeded_session: tuple[str, str], tmp_path: Path
) -> None:
    base_url, session_id = seeded_session
    for path in ("a.txt", "b.txt", "target/existing.txt"):
        _seed_file(base_url, session_id, path, f"Content of {path}\n")
    try:
        page.goto(f"{base_url}/c/{session_id}?view=explore")
        panel = page.get_by_role("complementary", name="Workspace")
        expect(_entry(panel, "a.txt")).to_be_visible(timeout=30_000)
        _entry(panel, "a.txt").focus()
        page.keyboard.press("F2")
        _apply_name(page, "keyboard.txt")
        expect(_entry(panel, "keyboard.txt")).to_be_visible()
        panel.get_by_role("checkbox", name="Select keyboard.txt", exact=True).check()
        panel.get_by_role("checkbox", name="Select b.txt", exact=True).check()
        expect(panel.get_by_text("2 selected", exact=True)).to_be_visible()
        panel.get_by_role("button", name="More file actions", exact=True).click()
        with page.expect_download(timeout=30_000) as pending:
            page.get_by_role("menuitem", name="Download as ZIP", exact=True).click()
        archive = tmp_path / "selection.zip"
        pending.value.save_as(archive)
        with zipfile.ZipFile(archive) as downloaded:
            assert set(downloaded.namelist()) == {"keyboard.txt", "b.txt"}
        transfers = page.get_by_role("complementary", name="File transfers")
        expect(transfers.get_by_text("Download complete", exact=True)).to_be_visible()
        transfers.get_by_role("button", name="Dismiss download status", exact=True).click()
        panel.get_by_role("checkbox", name="Select keyboard.txt", exact=True).uncheck()
        panel.get_by_role("checkbox", name="Select b.txt", exact=True).uncheck()
        panel.get_by_role("button", name="Collapse all folders", exact=True).click()
        source = _entry(panel, "b.txt")
        destination = _entry(panel, "target")
        source.hover()
        page.mouse.down()
        destination.hover()
        destination.hover()
        expect(destination.locator("button[aria-expanded]")).to_have_attribute(
            "aria-expanded", "true", timeout=10_000
        )
        page.mouse.up()
        expect(_entry(panel, "b.txt")).to_have_count(0, timeout=20_000)
        expect(_entry(panel, "target/b.txt")).to_be_visible()
        _entry(panel, "target/b.txt").locator("button").first.click()
        expect(page.get_by_test_id("file-viewer")).to_be_visible(timeout=30_000)
        panel.get_by_role("tab", name="Files", exact=True).click()
        panel.get_by_role("button", name="Collapse all folders", exact=True).click()
        expect(_entry(panel, "target/b.txt")).to_have_count(0)
        panel.get_by_role("button", name="Reveal active file", exact=True).click()
        expect(_entry(panel, "target/b.txt")).to_be_visible(timeout=15_000)
        _seed_file(base_url, session_id, "target/external.txt", "Changed outside the Explorer.\n")
        expect(_entry(panel, "target/external.txt")).to_be_visible(timeout=20_000)
    finally:
        _cleanup_session_workdir(session_id)
