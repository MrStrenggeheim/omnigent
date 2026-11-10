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


def _folder_action(page: Page, panel: Locator, name: str) -> None:
    button = panel.get_by_role("button", name=name, exact=True).filter(visible=True)
    if button.is_visible():
        button.click()
        return
    more = panel.get_by_role("button", name="More file actions", exact=True).filter(visible=True)
    expect(more).to_be_visible(timeout=30_000)
    more.click()
    page.get_by_role("menuitem", name=name, exact=True).click()


def _open_row_actions(panel: Locator, path: str) -> None:
    _entry(panel, path).hover()
    panel.get_by_role("button", name=f"Actions for {path}", exact=True).click()


def test_explorer_manages_files_transfers_and_recovery(
    page: Page, seeded_session: tuple[str, str], tmp_path: Path
) -> None:
    base_url, session_id = seeded_session
    _seed_file(base_url, session_id, "seed.txt", "original content\n")
    try:
        page.goto(f"{base_url}/c/{session_id}?view=explore")
        panel = page.get_by_role("complementary", name="Workspace")
        _folder_action(page, panel, "New folder")
        _apply_name(page, "library")
        expect(_entry(panel, "library")).to_be_visible()
        _folder_action(page, panel, "New file")
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

        _open_row_actions(panel, "renamed.txt")
        page.get_by_role("menuitem", name="Copy", exact=True).click()
        _open_row_actions(panel, "library")
        with page.expect_response(
            lambda response: (
                response.request.method == "POST" and "/filesystem-operations" in response.url
            )
        ) as copied:
            page.get_by_role("menuitem", name="Paste", exact=True).click()
        assert copied.value.ok
        assert _read_file(base_url, session_id, "library/renamed.txt") == ""

        _open_row_actions(panel, "duplicate.txt")
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
            page.get_by_role("button", name="Open workspace").click()
            _folder_action(page, page.get_by_test_id("files-panel-drawer"), "New file")
            _apply_name(page, "phone.txt")
            _open_row_actions(page.get_by_test_id("files-panel-drawer"), "phone.txt")
            page.get_by_role("menuitem", name="Rename…", exact=True).click()
            _apply_name(page, "phone-renamed.txt")
            assert _read_file(base_url, session_id, "phone-renamed.txt") == ""
        page.get_by_role("button", name="More file actions", exact=True).filter(
            visible=True
        ).click()
        page.get_by_role("menuitem", name="Search folder contents…", exact=True).click()
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


@pytest.mark.parametrize(
    "cancel,collapse,mobile",
    [(False, False, False), (True, False, False), (True, True, False), (True, True, True)],
    ids=["continue", "cancel", "cancel-from-center", "phone-center"],
)
def test_upload_continues_while_viewing_another_file(
    page: Page,
    seeded_session: tuple[str, str],
    cancel: bool,
    collapse: bool,
    mobile: bool,
    request: pytest.FixtureRequest,
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
        if mobile:
            page.set_viewport_size({"width": 390, "height": 844})
        page.goto(f"{base_url}/c/{session_id}?view=explore")
        panel = page.get_by_role("complementary", name="Workspace")
        if mobile:
            page.get_by_role("button", name="Open workspace").click()
            panel = page.get_by_test_id("files-panel-drawer")
        expect(panel.get_by_role("button", name="Choose files to upload")).to_be_visible(
            timeout=30_000
        )
        if collapse:
            page.clock.install()
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
        transfers = page.get_by_role("complementary", name="Notifications")
        expect(transfers.get_by_role("button", name="Cancel upload")).to_be_visible()
        assert len(held) == 1
        if mobile:
            panel.get_by_role("button", name="Notifications", exact=True).click()
            drawer_center = page.get_by_role("dialog", name="Notifications")
            expect(drawer_center.get_by_role("button", name="Cancel upload")).to_be_visible()
            page.screenshot(
                path=str(
                    Path(request.config.getoption("output")) / "notifications-files-drawer.png"
                ),
                animations="disabled",
            )
            drawer_center.get_by_role("button", name="Close notifications").click()
        _entry(panel, "navigation.txt").locator("button").first.click()
        expect(page.get_by_test_id("file-viewer")).to_be_visible(timeout=30_000)
        if not mobile:
            expect(transfers.get_by_role("button", name="Cancel upload")).to_be_visible()
        if collapse:
            page.clock.fast_forward(10_100)
            expect(transfers).not_to_be_visible()
            bell_surface = page.get_by_test_id("file-viewer") if mobile else page
            bell_surface.get_by_role("button", name="Notifications", exact=True).click()
            transfers = page.get_by_role("dialog", name="Notifications")
            expect(transfers.get_by_role("button", name="Cancel upload")).to_be_visible()
            expect(transfers.get_by_role("progressbar")).to_be_visible()
            output = Path(request.config.getoption("output"))
            page.screenshot(
                path=str(
                    output / f"notifications-activity-{'phone' if mobile else 'desktop'}.png"
                ),
                animations="disabled",
            )
            if mobile:
                bounds = transfers.bounding_box()
                assert bounds is not None and bounds["x"] >= 16
                assert bounds["x"] + bounds["width"] <= page.viewport_size["width"] - 16
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
        _entry(panel, "keyboard.txt").locator("button").first.click(modifiers=["ControlOrMeta"])
        _entry(panel, "b.txt").locator("button").first.click(modifiers=["ControlOrMeta"])
        expect(panel.get_by_text("2 selected", exact=True)).to_be_visible()
        panel.get_by_role("button", name="More file actions", exact=True).click()
        with page.expect_download(timeout=30_000) as pending:
            page.get_by_role("menuitem", name="Download selection as ZIP", exact=True).click()
        archive = tmp_path / "selection.zip"
        pending.value.save_as(archive)
        with zipfile.ZipFile(archive) as downloaded:
            assert set(downloaded.namelist()) == {"keyboard.txt", "b.txt"}
        transfers = page.get_by_role("complementary", name="Notifications")
        expect(transfers.get_by_text("Download complete", exact=True)).to_be_visible()
        transfers.get_by_role("status").filter(has_text="Download complete").get_by_role(
            "button", name="Hide notification", exact=True
        ).click()
        _entry(panel, "keyboard.txt").locator("button").first.click(modifiers=["ControlOrMeta"])
        _entry(panel, "b.txt").locator("button").first.click(modifiers=["ControlOrMeta"])
        _folder_action(page, panel, "Collapse all folders")
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
        _folder_action(page, panel, "Collapse all folders")
        expect(_entry(panel, "target/b.txt")).to_have_count(0)
        _entry(panel, "target").locator("button[aria-expanded]").click()
        expect(_entry(panel, "target/b.txt")).to_be_visible(timeout=15_000)
        _seed_file(base_url, session_id, "target/external.txt", "Changed outside the Explorer.\n")
        expect(_entry(panel, "target/external.txt")).to_be_visible(timeout=20_000)
    finally:
        _cleanup_session_workdir(session_id)


@pytest.mark.parametrize("preview", [False, True], ids=["files", "preview"])
def test_explorer_drop_into_collapsed_and_expanded_folders(
    page: Page, seeded_session: tuple[str, str], preview: bool, request: pytest.FixtureRequest
) -> None:
    base_url, session_id = seeded_session
    for path in ("source.txt", "preview.txt", "target/inner/kept.txt", "other/kept.txt"):
        _seed_file(base_url, session_id, path, f"Content of {path}\n")
    try:
        page.set_viewport_size({"width": 1440, "height": 1000})
        page.add_init_script("localStorage.setItem('omnigent:file-explorer-visible', 'true')")
        page.goto(f"{base_url}/c/{session_id}?view=explore")
        panel = page.get_by_role("complementary", name="Workspace")
        expect(_entry(panel, "source.txt")).to_be_visible(timeout=30_000)
        if preview:
            _entry(panel, "preview.txt").locator("button").first.click()
            expect(page.get_by_test_id("file-viewer")).to_be_visible()
        _folder_action(page, panel, "Collapse all folders")
        source = _entry(panel, "source.txt")
        target = _entry(panel, "target")
        source.hover()
        page.mouse.down()
        target.hover()
        target.hover()
        expect(target).to_have_attribute("data-drop-target", "true")
        expect(panel.get_by_test_id("file-drop-overlay")).to_contain_text("Move to target")
        page.screenshot(
            path=str(
                Path(request.config.getoption("output"))
                / f"folder-drop-{'preview' if preview else 'files'}.png"
            )
        )
        expect(target.locator("button[aria-expanded]")).to_have_attribute(
            "aria-expanded", "true", timeout=10_000
        )
        page.mouse.up()
        expect(_entry(panel, "source.txt")).to_have_count(0, timeout=20_000)
        expect(_entry(panel, "target/source.txt")).to_be_visible()
        _entry(panel, "other").locator("button[aria-expanded]").click()
        _entry(panel, "target/source.txt").drag_to(_entry(panel, "other"))
        expect(_entry(panel, "other/source.txt")).to_be_visible(timeout=20_000)
        assert _read_file(base_url, session_id, "other/source.txt") == "Content of source.txt\n"
        page.keyboard.down("ControlOrMeta")
        _entry(panel, "other/source.txt").drag_to(_entry(panel, "target"))
        page.keyboard.up("ControlOrMeta")
        expect(_entry(panel, "target/source.txt")).to_be_visible(timeout=20_000)
        expect(_entry(panel, "other/source.txt")).to_be_visible()
        transfer = page.evaluate_handle("""() => {
            const transfer = new DataTransfer();
            transfer.items.add(new File(
                ['uploaded into folder'], 'incoming.txt', {type: 'text/plain'}
            ));
            return transfer;
        }""")
        target_file = _entry(panel, "other/kept.txt")
        target_file.dispatch_event("dragenter", {"dataTransfer": transfer})
        target_file.dispatch_event("dragover", {"dataTransfer": transfer})
        expect(panel.get_by_test_id("file-drop-overlay")).to_contain_text("Upload to other")
        target_file.dispatch_event("drop", {"dataTransfer": transfer})
        dialog = page.get_by_role("dialog", name="Upload 1 file(s)")
        expect(dialog.get_by_role("textbox", name="Destination folder")).to_have_value("other")
        dialog.get_by_role("button", name="Upload", exact=True).click()
        expect(_entry(panel, "other/incoming.txt")).to_be_visible(timeout=20_000)
        assert _read_file(base_url, session_id, "other/incoming.txt") == "uploaded into folder"
        _entry(panel, "target").drag_to(_entry(panel, "target/inner"))
        error = page.get_by_role("alert").filter(has_text="File operation failed")
        expect(error).to_contain_text("inside itself", timeout=20_000)
        error.get_by_role("button", name="Hide notification", exact=True).click()
        expect(error).not_to_be_visible()
        page.get_by_role("button", name="Notifications", exact=True).filter(
            visible=True
        ).first.click()
        history = page.get_by_role("dialog", name="Notifications")
        expect(history).to_contain_text("inside itself")
        page.screenshot(
            path=str(
                Path(request.config.getoption("output"))
                / f"file-error-history-{'preview' if preview else 'files'}.png"
            )
        )
    finally:
        _cleanup_session_workdir(session_id)


def test_explorer_background_refresh_and_shared_hover_controls(
    page: Page, seeded_session: tuple[str, str]
) -> None:
    base_url, session_id = seeded_session
    for path in ("a.txt", "b.txt", "parent/nested/kept.txt"):
        _seed_file(base_url, session_id, path, "contents\n")
    held: list[Route] = []

    def delay_refresh(route: Route) -> None:
        held.append(route)

    endpoint = re.compile(
        rf"/(?:sessions/{session_id}|workbench-workspaces/[^/]+)/resources/environments/default/filesystem/parent/nested(?:\?|$)"
    )
    try:
        page.goto(f"{base_url}/c/{session_id}?view=explore")
        panel = page.get_by_role("complementary", name="Workspace")
        first = _entry(panel, "a.txt")
        expect(first).to_be_visible(timeout=30_000)
        search = panel.get_by_role("searchbox", name="Search all files")
        search.click()
        expect(first.locator("[data-file-size]")).to_be_visible()
        expect(first.get_by_role("checkbox")).to_have_count(0)
        menu = first.get_by_role("button", name="Actions for a.txt", exact=True)
        expect(menu).to_be_visible()
        assert first.locator("[data-explorer-action] button").evaluate_all(
            "buttons => buttons.map(button => button.getAttribute('aria-label'))"
        ) == ["Actions for a.txt"]
        actions_box = first.locator("[data-explorer-action]").bounding_box()
        assert actions_box is not None and actions_box["width"] < 104
        first.hover()
        expect(first.locator("[data-file-size]")).to_be_visible()
        expect(menu).to_be_visible()
        first.locator("button").first.click(modifiers=["ControlOrMeta"])
        expect(first).to_have_attribute("aria-selected", "true")
        search.click()
        second = _entry(panel, "b.txt")
        expect(second.get_by_role("checkbox")).to_have_count(0)
        expect(second.get_by_role("button", name="Actions for b.txt", exact=True)).to_be_visible()
        expect(second.locator("[data-file-size]")).to_be_visible()
        first.locator("button").first.click(modifiers=["ControlOrMeta"])
        expect(first).to_have_attribute("aria-selected", "false")
        _entry(panel, "parent").get_by_role("button", name="parent/", exact=True).click()
        nested = _entry(panel, "parent/nested")
        expect(nested).to_be_visible(timeout=15_000)
        nested.get_by_role("button", name="nested/", exact=True).click()
        kept = _entry(panel, "parent/nested/kept.txt")
        expect(kept).to_be_visible(timeout=15_000)
        page.route(endpoint, delay_refresh)
        # The existing poll must update the same queries, retaining nested rows in flight.
        with page.expect_request(
            lambda request: bool(endpoint.search(request.url)), timeout=20_000
        ):
            search.click()
        expect(kept).to_be_visible()
        expect(nested.get_by_role("button", name="nested/", exact=True)).to_have_attribute(
            "aria-expanded", "true"
        )
        assert len(held) == 1
        held.pop().continue_()
        page.unroute(endpoint, delay_refresh)
        expect(kept).to_be_visible()
        files = page.evaluate_handle("""() => {
            const transfer = new DataTransfer();
            transfer.items.add(new File(['dropped'], 'drop.txt', {type: 'text/plain'}));
            return transfer;
        }""")
        first.dispatch_event("dragenter", {"dataTransfer": files})
        overlay = panel.get_by_test_id("file-drop-overlay")
        expect(overlay).to_be_visible()
        expect(overlay.locator(".border-dashed")).to_have_count(1)
        first.dispatch_event("drop", {"dataTransfer": files})
        expect(overlay).not_to_be_visible()
        expect(page.get_by_role("dialog", name="Upload 1 file(s)")).to_be_visible()
        page.get_by_role("dialog").get_by_role("button", name="Cancel", exact=True).click()
    finally:
        for route in held:
            route.continue_()
        _cleanup_session_workdir(session_id)
