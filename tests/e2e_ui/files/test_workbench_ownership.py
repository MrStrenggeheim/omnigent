"""Selected workspace ownership through the real SPA, server and isolated host."""

from __future__ import annotations

import os
import re
import shutil
import time
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

import httpx
import pytest
from playwright.sync_api import Locator, Page, Request, expect
from websockets.sync.client import connect

from tests._helpers.host import isolated_host
from tests._helpers.session import post_session_bundle
from tests.e2e_ui.conftest import _build_hello_world_bundle
from tests.e2e_ui.files.test_explorer_file_operations import _apply_name, _entry
from tests.e2e_ui.files.test_explorer_git_tracking import _git

_FILE = "same.txt"
_A_CONTENT = "workspace_a_original\n"
_B_CONTENT = "workspace_b_original\n"


@dataclass(frozen=True)
class Ownership:
    client: httpx.Client
    base: str
    chats: tuple[str, str]
    workspaces: tuple[str, str]
    roots: tuple[Path, Path]

    def resources(self, index: int) -> str:
        return f"/v1/workbench-workspaces/{self.workspaces[index]}/resources/environments/default"


@pytest.fixture
def ownership(live_server: str, tmp_path: Path) -> Iterator[Ownership]:
    roots = (tmp_path / "ownership-a", tmp_path / "ownership-b")
    for root, content in zip(roots, (_A_CONTENT, _B_CONTENT), strict=True):
        root.mkdir()
        (root / _FILE).write_text("committed baseline\n")
        (root / ".hidden-owner.txt").write_text(content)
        _git(root, "init", "-q")
        _git(root, "add", ".")
        _git(root, "commit", "-qm", "Ownership fixture")
        (root / _FILE).write_text(content)
    chats: list[str] = []
    workspaces: list[str] = []
    with (
        httpx.Client(base_url=live_server, trust_env=False, timeout=30) as client,
        isolated_host(
            tmp_path / "host", live_server, base_env={"PATH": os.environ["PATH"]}
        ) as host,
    ):
        host.wait_online(client)
        try:
            for root in roots:
                created = post_session_bundle(
                    client.post,
                    "/v1/sessions",
                    _build_hello_world_bundle(),
                    metadata={"host_id": host.host_id, "workspace": str(root), "title": root.name},
                )
                created.raise_for_status()
                chats.append(created.json()["session_id"])
                resolved = client.post(
                    "/v1/workbench-workspaces/resolve", json={"session_id": chats[-1]}
                )
                resolved.raise_for_status()
                assert resolved.json()["root"] == str(root)
                workspaces.append(resolved.json()["id"])
            assert workspaces[0] != workspaces[1]
            yield Ownership(
                client, live_server, (chats[0], chats[1]), (workspaces[0], workspaces[1]), roots
            )
        finally:
            for chat in chats:
                deleted = client.delete(f"/v1/sessions/{chat}")
                assert deleted.status_code in {200, 204, 404}, deleted.text


def _open(page: Page, ownership: Ownership) -> Locator:
    page.set_viewport_size({"width": 1440, "height": 1000})
    page.goto(f"{ownership.base}/c/{ownership.chats[0]}?view=explore")
    rail = page.get_by_role("complementary", name="Workspace")
    expect(rail.get_by_role("button", name="Select workspace", exact=True)).to_have_count(0)
    expect(_entry(rail, _FILE)).to_be_visible(timeout=30_000)
    return rail


def _switch_chat(page: Page, ownership: Ownership) -> None:
    page.evaluate("window.__ownershipDocument = 'original-document'")
    link = page.locator(f'a[href="/c/{ownership.chats[1]}"]').filter(visible=True).first
    expect(link).to_be_visible(timeout=15_000)
    link.click()
    expect(page).to_have_url(re.compile(rf"/c/{re.escape(ownership.chats[1])}(?:\?|$)"))
    assert page.evaluate("window.__ownershipDocument") == "original-document"
    expect(page.get_by_text("Chat uses another workspace", exact=True)).to_have_count(0)


def test_spa_chat_switch_follows_chat_workspace_for_editor_and_crud(
    page: Page, ownership: Ownership
) -> None:
    rail = _open(page, ownership)
    _entry(rail, _FILE).locator("button").first.click()
    viewer = page.get_by_test_id("file-viewer").filter(visible=True)
    expect(viewer.locator(".view-lines")).to_contain_text(_A_CONTENT.strip(), timeout=30_000)
    expect(rail.get_by_test_id("files-host-served-badge")).to_have_count(0)

    writes: list[Request] = []
    page.on("request", lambda request: writes.append(request) if request.method == "PUT" else None)
    viewer.locator(".view-lines").click()
    page.keyboard.press("ControlOrMeta+Home")
    with page.expect_response(
        lambda response: (
            response.request.method == "PUT" and response.url.endswith(f"/filesystem/{_FILE}")
        )
    ) as saved:
        page.keyboard.type("saved_on_workspace_a\n")
    assert saved.value.ok, saved.value.text()
    assert urlsplit(writes[-1].url).path == f"{ownership.resources(0)}/filesystem/{_FILE}"
    assert ownership.roots[0].joinpath(_FILE).read_text() == "saved_on_workspace_a\n" + _A_CONTENT
    assert ownership.roots[1].joinpath(_FILE).read_text() == _B_CONTENT

    _switch_chat(page, ownership)
    rail.get_by_role("tab", name="Files", exact=True).click()
    expect(_entry(rail, _FILE)).to_be_visible(timeout=30_000)
    _entry(rail, _FILE).locator("button").first.click()
    expect(viewer.locator(".view-lines")).to_contain_text(_B_CONTENT.strip(), timeout=30_000)

    rail.get_by_role("tab", name="Files", exact=True).click()
    with page.expect_response(
        lambda response: (
            response.request.method == "POST" and "/filesystem-operations" in response.url
        )
    ) as created:
        rail.get_by_role("button", name="New file", exact=True).click()
        _apply_name(page, "created-on-b.txt")
    assert created.value.ok, created.value.text()
    assert urlsplit(created.value.url).path == f"{ownership.resources(1)}/filesystem-operations"
    assert ownership.roots[1].joinpath("created-on-b.txt").is_file()
    assert not ownership.roots[0].joinpath("created-on-b.txt").exists()
    denied = ownership.client.post(
        f"{ownership.resources(1)}/filesystem-operations",
        json={"operation": "mkdir", "path": str(ownership.roots[0] / "must-not-exist")},
    )
    assert denied.status_code == 403, denied.text
    assert not ownership.roots[0].joinpath("must-not-exist").exists()

    content = ownership.client.get(f"{ownership.resources(0)}/filesystem/{_FILE}")
    content.raise_for_status()
    assert content.json()["content"] == "saved_on_workspace_a\n" + _A_CONTENT


def test_workspace_restores_search_and_hidden_controls_without_coupling_comparisons(
    page: Page, ownership: Ownership
) -> None:
    rail = _open(page, ownership)
    quick_search = rail.get_by_role("searchbox", name="Search all files", exact=True)
    expect(quick_search).to_be_visible()
    quick_controls = quick_search.locator("..").locator("..")
    expect(
        quick_controls.get_by_role("button", name="Filename include/exclude filters", exact=True)
    ).to_be_visible()
    hide_hidden = quick_controls.get_by_role("button", name="Hide hidden files", exact=True)
    expect(hide_hidden).to_be_visible()
    hide_hidden.click()
    expect(_entry(rail, ".hidden-owner.txt")).to_have_count(0)
    show_hidden = quick_controls.get_by_role("button", name="Show hidden files", exact=True)
    expect(show_hidden).to_be_visible()
    show_hidden.click()
    expect(_entry(rail, ".hidden-owner.txt")).to_be_visible()
    rail.get_by_role("button", name="More file actions", exact=True).click()
    page.get_by_role("menuitem", name="Select files…", exact=True).click()
    _entry(rail, _FILE).get_by_role("checkbox", name=f"Select {_FILE}", exact=True).click()
    _entry(rail, ".hidden-owner.txt").get_by_role("checkbox").click()
    expect(_entry(rail, _FILE)).to_have_attribute("aria-selected", "true")
    expect(_entry(rail, ".hidden-owner.txt")).to_have_attribute("aria-selected", "true")
    rail.get_by_role("button", name="More file actions", exact=True).click()
    expect(page.get_by_role("menuitem", name="Copy selected items", exact=True)).to_be_visible()
    page.get_by_role("menuitem", name="Done selecting", exact=True).click()
    expect(rail.get_by_role("checkbox")).to_have_count(0)
    rail.get_by_role("tab", name="Content search", exact=True).click()
    search = rail.get_by_role("region", name="Content search")
    search.get_by_role("button", name="Filter files", exact=True).click()
    search.get_by_label("Include", exact=True).fill(_FILE)
    search.get_by_label("Exclude", exact=True).fill("ignored/**")
    search.get_by_role("searchbox", name="Search file contents").fill("workspace_a_original")
    with page.expect_response(lambda response: "/content-search?" in response.url) as searched:
        search.get_by_role("button", name="Search", exact=True).click()
    assert searched.value.ok, searched.value.text()
    assert urlsplit(searched.value.url).path == f"{ownership.resources(0)}/content-search"
    expect(search.get_by_role("button", name="Open same.txt at line 1")).to_be_visible()
    _switch_chat(page, ownership)
    rail.get_by_role("tab", name="Content search", exact=True).click()
    expect(search.get_by_role("searchbox")).to_have_value("")
    page.locator(f'a[href="/c/{ownership.chats[0]}"]').filter(visible=True).first.click()
    rail.get_by_role("tab", name="Content search", exact=True).click()
    expect(search.get_by_role("searchbox")).to_have_value("workspace_a_original")
    expect(search.get_by_label("Include", exact=True)).to_have_value(_FILE)
    expect(search.get_by_label("Exclude", exact=True)).to_have_value("ignored/**")
    if not search.get_by_label("Include", exact=True).is_visible():
        search.get_by_role("button", name="Filter files", exact=True).click()
    expect(search.get_by_label("Include", exact=True)).to_be_visible()

    rail.get_by_role("tab", name="Files", exact=True).click()
    expect(_entry(rail, ".hidden-owner.txt")).to_be_visible()
    comparison = rail.get_by_role("button", name="Diff comparison", exact=True)
    expect(comparison).to_contain_text("Git")
    rail.get_by_role("tab", name=re.compile(r"^Changes")).click()
    expect(comparison).to_contain_text("Git")
    comparison.click()
    since = page.get_by_role("menuitem", name=re.compile(r"^Since"))
    expect(since).not_to_have_attribute("aria-disabled", "true", timeout=20_000)
    since.click()
    dialog = page.get_by_role("dialog", name="Changes since commit")
    dialog.get_by_role("textbox", name="Commit revision", exact=True).fill("HEAD")
    with page.expect_response(
        lambda response: "/git?" in response.url and "base=HEAD" in response.url
    ) as compared:
        dialog.get_by_role("button", name="Compare", exact=True).click()
    assert compared.value.ok, compared.value.text()
    assert urlsplit(compared.value.url).path == f"{ownership.resources(0)}/git"
    expect(comparison).to_contain_text("Since")
    rail.get_by_role("tab", name="Files", exact=True).click()
    expect(comparison).to_contain_text("Git")
    rail.get_by_role("tab", name=re.compile(r"^Changes")).click()
    expect(comparison).to_contain_text("Since")


@pytest.mark.skipif(shutil.which("tmux") is None, reason="tmux unavailable")
def test_browser_manual_shell_keeps_workspace_owner_after_chat_deletion(
    page: Page, ownership: Ownership, tmp_path: Path
) -> None:
    _open(page, ownership)
    rail = page.get_by_role("complementary", name="Workspace", exact=True, include_hidden=True)
    sidebar = page.get_by_role(
        "complementary", name="Conversations", exact=True, include_hidden=True
    )
    sidebar_was_hidden = sidebar.get_attribute("aria-hidden") == "true"
    page.keyboard.press("Control+b")
    expect(sidebar).to_have_attribute("aria-hidden", "false" if sidebar_was_hidden else "true")
    page.keyboard.press("Control+b")
    page.keyboard.press("Control+i")
    expect(rail).to_have_attribute("data-state", "closed")
    page.keyboard.press("Control+i")
    expect(rail).to_have_attribute("data-state", "open")
    _switch_chat(page, ownership)
    with page.expect_response(
        lambda response: (
            response.request.method == "POST"
            and response.url.endswith(f"/workbench-workspaces/{ownership.workspaces[0]}/terminals")
        )
    ) as created:
        page.keyboard.press("Control+j")
    assert created.value.ok, created.value.text()
    terminal = created.value.json()
    endpoint = f"/v1/workbench-workspaces/{ownership.workspaces[0]}/terminals/{terminal['id']}"
    try:
        assert terminal["workspace_id"] == ownership.workspaces[0]
        assert terminal["metadata"]["root"] == str(ownership.roots[0])
        expect(rail.locator(".xterm-screen")).to_be_visible(timeout=30_000)
        page.keyboard.press("Control+j")
        listed = ownership.client.get(endpoint.rsplit("/", 1)[0])
        listed.raise_for_status()
        assert len([row for row in listed.json()["data"] if row["running"]]) == 1

        deleted = ownership.client.delete(f"/v1/sessions/{ownership.chats[0]}")
        assert deleted.status_code in {200, 204}, deleted.text
        detail = ownership.client.get(endpoint)
        detail.raise_for_status()
        assert detail.json()["running"] is True
        attach_url = ownership.base.replace("http://", "ws://").replace("https://", "wss://")
        expected = f"OWNERSHIP-SURVIVED:{ownership.roots[0]}".encode()
        output = bytearray()
        with connect(attach_url + terminal["attachPath"], open_timeout=10) as ws:
            ws.send(b"printf 'OWNERSHIP-SURVIVED:%s\\n' \"$PWD\"\n")
            deadline = time.monotonic() + 15
            while expected not in output and time.monotonic() < deadline:
                message = ws.recv(timeout=max(0.1, deadline - time.monotonic()))
                if isinstance(message, bytes):
                    output.extend(message)
        (tmp_path / "workspace-shell-output.txt").write_bytes(output)
        assert expected in output, output.decode(errors="replace")
        assert (
            ownership.client.get(f"{ownership.resources(0)}/filesystem/{_FILE}").json()["content"]
            == _A_CONTENT
        )
        assert ownership.roots[1].joinpath(_FILE).read_text() == _B_CONTENT
    finally:
        stopped = ownership.client.delete(endpoint)
        assert stopped.status_code == 200, stopped.text


def test_mobile_explorer_selection_is_explicit(page: Page, ownership: Ownership) -> None:
    page.set_viewport_size({"width": 390, "height": 844})
    page.goto(f"{ownership.base}/c/{ownership.chats[0]}")
    page.get_by_role("button", name="Open workspace", exact=True).click()
    panel = page.get_by_test_id("files-panel-drawer")
    expect(_entry(panel, _FILE)).to_be_visible(timeout=30_000)
    expect(panel.get_by_role("checkbox")).to_have_count(0)
    panel.get_by_role("button", name="More file actions", exact=True).click()
    page.get_by_role("menuitem", name="Select files…", exact=True).click()
    _entry(panel, _FILE).get_by_role("checkbox").click()
    _entry(panel, ".hidden-owner.txt").locator("button").first.click()
    expect(_entry(panel, _FILE)).to_have_attribute("aria-selected", "true")
    expect(_entry(panel, ".hidden-owner.txt")).to_have_attribute("aria-selected", "true")
    expect(page.get_by_test_id("file-viewer")).to_have_count(0)
    panel.get_by_role("button", name="More file actions", exact=True).click()
    expect(page.get_by_role("menuitem", name="Copy selected items", exact=True)).to_be_visible()
    page.get_by_role("menuitem", name="Done selecting", exact=True).click()
    expect(panel.get_by_role("checkbox")).to_have_count(0)
    plus = page.get_by_role("button", name="Open workspace panel", exact=True)
    expect(plus).to_be_visible()
    plus.click()
    expect(page.get_by_role("menuitem", name="New shell", exact=True)).to_be_enabled()
    page.keyboard.press("Escape")
    header = panel.locator(".workspace-control-header").first
    assert header.evaluate("element => getComputedStyle(element).overflowY") in {"hidden", "clip"}
    assert header.bounding_box()["height"] == 48


def test_explorer_modified_clicks_select_ranges_without_opening_folders(
    page: Page, ownership: Ownership
) -> None:
    folder = ownership.roots[0] / "selection-folder"
    folder.mkdir()
    (folder / "child.txt").write_text("folder child\n")
    (ownership.roots[0] / "z-selection.txt").write_text("range target\n")
    rail = _open(page, ownership)
    _entry(rail, _FILE).locator("button").first.click()
    viewer = page.get_by_test_id("file-viewer")
    expect(viewer).to_contain_text(_A_CONTENT.strip(), timeout=30_000)
    show = viewer.get_by_role("button", name="Show file explorer", exact=True)
    if show.is_visible():
        show.click()
    explorer = page.get_by_role("region", name="File explorer", exact=True)
    last = _entry(explorer, "z-selection.txt")
    expect(last).to_be_visible(timeout=30_000)
    last.locator("button").first.click(modifiers=["Shift"])
    expect(_entry(explorer, _FILE)).to_have_attribute("aria-selected", "true")
    expect(last).to_have_attribute("aria-selected", "true")
    directory = _entry(explorer, "selection-folder")
    button = directory.locator("button[aria-expanded]")
    expect(button).to_have_attribute("aria-expanded", "false")
    button.click(modifiers=["Control"])
    expect(directory).to_have_attribute("aria-selected", "true")
    expect(button).to_have_attribute("aria-expanded", "false")
    _entry(explorer, _FILE).locator("button").first.click(modifiers=["Control"])
    expect(_entry(explorer, _FILE)).to_have_attribute("aria-selected", "false")
    expect(last).to_have_attribute("aria-selected", "true")
    expect(directory).to_have_attribute("aria-selected", "true")
    _entry(explorer, _FILE).locator("button").first.click(modifiers=["Control"])
    expect(_entry(explorer, _FILE)).to_have_attribute("aria-selected", "true")
    button.click(modifiers=["Shift"])
    expect(button).to_have_attribute("aria-expanded", "false")
    button.click()
    expect(button).to_have_attribute("aria-expanded", "true")
    expect(_entry(explorer, "selection-folder/child.txt")).to_be_visible(timeout=15_000)
    tree = explorer.get_by_role("tree", name="Workspace files")
    bounds = tree.bounding_box()
    tree.click(position={"x": bounds["width"] / 2, "y": bounds["height"] - 5})
    expect(explorer.locator('[aria-selected="true"]')).to_have_count(0)


@pytest.mark.parametrize("mobile", [False, True], ids=["desktop", "phone"])
def test_panel_folder_scopes_files_changes_search_and_pr(
    page: Page, ownership: Ownership, mobile: bool
) -> None:
    root = ownership.roots[0]
    nested = root / "nested"
    nested.mkdir()
    (nested / "scoped.txt").write_text("nested scope sentinel\n")
    rail = _open(page, ownership)
    if mobile:
        page.set_viewport_size({"width": 390, "height": 844})
        page.get_by_role("button", name="Open workspace", exact=True).click()
    panel = page.get_by_test_id("files-panel-drawer").filter(visible=True) if mobile else rail
    _entry(panel, "nested").locator("button[aria-expanded]").dblclick()
    expect(_entry(panel, "nested/scoped.txt")).to_be_visible(timeout=30_000)
    expect(_entry(panel, _FILE)).to_have_count(0)
    tabs = (
        page.get_by_role("tablist", name="Workspace").filter(visible=True)
        if mobile
        else rail.get_by_role("toolbar", name="Workspace tabs")
    )
    tabs.get_by_role("tab", name=re.compile("^Changes")).click()
    expect(page.get_by_text("scoped.txt", exact=True)).to_be_visible(timeout=20_000)
    expect(page.get_by_text(_FILE, exact=True).filter(visible=True)).to_have_count(0)
    tabs.get_by_role("tab", name="Search" if mobile else "Content search", exact=True).click()
    search = page.get_by_role("region", name="Content search").filter(visible=True)
    search.get_by_role("searchbox", name="Search file contents").fill("nested scope sentinel")
    with page.expect_response(lambda response: "/content-search?" in response.url) as result:
        search.get_by_role("button", name="Search", exact=True).click()
    assert result.value.ok, result.value.text()
    assert "path=nested" in result.value.url
    with page.expect_response(lambda response: "/resources/github" in response.url) as pr:
        tabs.get_by_role("tab", name="Pull Requests", exact=True).click()
    assert pr.value.ok, pr.value.text()
    assert "folder=nested" in pr.value.url
    assert f"/workbench-workspaces/{ownership.workspaces[0]}/resources/github" in pr.value.url
    expect(page.get_by_role("button", name="Select workspace", exact=True)).to_have_count(0)
    if not mobile:
        with page.expect_response(
            lambda response: (
                response.request.method == "POST" and response.url.endswith("/terminals")
            )
        ) as created:
            page.keyboard.press("ControlOrMeta+j")
        assert created.value.ok, created.value.text()
        terminal = created.value.json()
        try:
            assert created.value.request.post_data_json["cwd"] == "nested"
            assert terminal["workspace_id"] == ownership.workspaces[0]
            assert terminal["metadata"]["cwd"] == str(nested)
        finally:
            stopped = ownership.client.delete(
                f"/v1/workbench-workspaces/{ownership.workspaces[0]}/terminals/{terminal['id']}"
            )
            assert stopped.is_success, stopped.text


def test_chat_workspace_switch_guards_unsaved_file_edits(page: Page, ownership: Ownership) -> None:
    rail = _open(page, ownership)
    page.route(
        f"**/workbench-workspaces/{ownership.workspaces[0]}/resources/environments/default/filesystem/{_FILE}*",
        lambda route: (
            route.fulfill(status=503, json={"detail": "Paused save for navigation proof"})
            if route.request.method == "PUT"
            else route.continue_()
        ),
    )
    _entry(rail, _FILE).locator("button").first.click()
    viewer = page.get_by_test_id("file-viewer").filter(visible=True)
    expect(viewer.locator(".view-lines")).to_contain_text(_A_CONTENT.strip(), timeout=30_000)
    viewer.locator(".view-lines").click()
    page.keyboard.press("ControlOrMeta+Home")
    page.keyboard.type("unsaved-workspace-draft")
    _switch_chat(page, ownership)
    prompt = page.get_by_role("dialog", name="Unsaved changes", exact=True)
    expect(prompt).to_be_visible(timeout=20_000)
    expect(viewer.locator(".view-lines")).to_contain_text("unsaved-workspace-draft")
    prompt.get_by_role("button", name="Keep editing", exact=True).click()
    expect(page).to_have_url(re.compile(rf"/c/{ownership.chats[0]}(?:\?|$)"))
    expect(viewer.locator(".view-lines")).to_contain_text("unsaved-workspace-draft")
    _switch_chat(page, ownership)
    prompt.get_by_role("button", name="Discard changes", exact=True).click()
    rail.get_by_role("tab", name="Files", exact=True).click()
    _entry(rail, _FILE).locator("button").first.click()
    expect(viewer.locator(".view-lines")).to_contain_text(_B_CONTENT.strip(), timeout=20_000)
    assert ownership.roots[0].joinpath(_FILE).read_text() == _A_CONTENT
    assert ownership.roots[1].joinpath(_FILE).read_text() == _B_CONTENT
