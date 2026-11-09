"""Git status and explicit comparisons through the real Explorer and runner."""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from playwright.sync_api import Page, Route, expect

from tests.e2e_ui.files.test_explorer_file_operations import _entry
from tests.e2e_ui.files.test_file_autosave import _seed_file


def _git(directory: Path, *arguments: str) -> str:
    return subprocess.check_output(
        [
            "git",
            "-c",
            "user.name=Explorer Test",
            "-c",
            "user.email=explorer@example.test",
            *arguments,
        ],
        cwd=directory,
        text=True,
        stderr=subprocess.PIPE,
    ).strip()


def _seed_repositories(base: str, session_id: str, metadata: Path) -> tuple[str, str, str, Path]:
    prefix = f"repository-{session_id[:8]}"
    _seed_file(base, session_id, f"{prefix}/keep.txt", "alpha committed\n")
    _seed_file(base, session_id, f"{prefix}/deleted.txt", "tracked deletion\n")
    _seed_file(base, session_id, f"{prefix}/nested/inner.txt", "inner committed\n")
    response = httpx.get(
        f"{base}/v1/sessions/{session_id}/resources/environments/default", timeout=15
    )
    response.raise_for_status()
    workspace = Path(response.json()["metadata"]["root"])
    repository = workspace / prefix
    assert repository.is_dir()
    _git(repository, "init", "-q")
    _git(repository, "add", "keep.txt", "deleted.txt")
    _git(repository, "commit", "-qm", "Initial fixture")
    first = _git(repository, "rev-parse", "HEAD")
    _seed_file(base, session_id, f"{prefix}/keep.txt", "beta committed\n")
    _git(repository, "add", "keep.txt")
    _git(repository, "commit", "-qm", "Second fixture")
    second = _git(repository, "rev-parse", "HEAD")
    nested = repository / "nested"
    _git(nested, "init", "-q", "--separate-git-dir", str(metadata))
    _git(nested, "add", "inner.txt")
    _git(nested, "commit", "-qm", "Nested fixture")
    _seed_file(base, session_id, f"{prefix}/keep.txt", "gamma working tree\n")
    _seed_file(base, session_id, f"{prefix}/nested/inner.txt", "inner working tree\n")
    (repository / "deleted.txt").unlink()
    temporary = repository / "temporary"
    temporary.mkdir()
    (temporary / "created.txt").write_text("never committed\n")
    (temporary / "created.txt").unlink()
    temporary.rmdir()
    return first, second, prefix, repository


@pytest.mark.parametrize("mobile", [False, True], ids=["desktop", "phone"])
def test_shared_comparison_keeps_files_live_and_gates_mixed_revisions(
    page: Page,
    seeded_session: tuple[str, str],
    tmp_path: Path,
    request: pytest.FixtureRequest,
    mobile: bool,
) -> None:
    base, session_id = seeded_session
    _, _, prefix, repository = _seed_repositories(base, session_id, tmp_path / "nested-git")

    def legacy_history(route: Route) -> None:
        route.fulfill(
            json={
                "object": "list",
                "source": "agent",
                "data": [
                    {
                        "path": "vanished/dead.txt",
                        "name": "dead.txt",
                        "status": "deleted",
                        "bytes": None,
                        "modified_at": None,
                    }
                ],
                "has_more": False,
            }
        )

    page.route(re.compile(r"/environments/default/changes(?:\?|$)"), legacy_history)
    pending_git: list[Route] = []

    def delay_nested_status(route: Route) -> None:
        params = parse_qs(urlsplit(route.request.url).query)
        directories = json.loads(params.get("directories", ["[]"])[0])
        if not pending_git and any(path.endswith("/nested") for path in directories):
            pending_git.append(route)
        else:
            route.continue_()

    page.route(re.compile(r"/environments/default/git\?"), delay_nested_status)
    try:
        if mobile:
            page.set_viewport_size({"width": 390, "height": 844})
        page.goto(f"{base}/c/{session_id}?view=explore")
        panel = page.get_by_role("complementary", name="Workspace")
        if mobile:
            page.get_by_role("button", name="Open workspace").click()
            panel = page.get_by_test_id("files-panel-drawer")
        expect(_entry(panel, prefix)).to_be_visible(timeout=30_000)
        expect(_entry(panel, "vanished")).to_have_count(0)
        _entry(panel, prefix).locator("button[aria-expanded]").click()
        expect(
            _entry(panel, f"{prefix}/keep.txt").get_by_title("Modified", exact=True)
        ).to_be_visible(timeout=30_000)
        expect(_entry(panel, f"{prefix}/deleted.txt")).to_have_count(0)
        expect(_entry(panel, f"{prefix}/temporary")).to_have_count(0)
        with page.expect_request(
            lambda request: "/git?" in request.url and "nested" in request.url
        ):
            _entry(panel, f"{prefix}/nested").locator("button[aria-expanded]").click()
        expect(
            _entry(panel, f"{prefix}/keep.txt").get_by_title("Modified", exact=True)
        ).to_be_visible()
        assert len(pending_git) == 1
        pending_git[0].continue_()
        expect(
            _entry(panel, f"{prefix}/nested/inner.txt").get_by_title("Modified", exact=True)
        ).to_be_visible(timeout=30_000)
        expect(panel.get_by_role("button", name="Reveal active file")).to_have_count(0)
        expect(
            panel.get_by_role("button", name="Search folder contents", exact=True)
        ).to_have_count(0)
        comparison = panel.get_by_role("button", name="Diff comparison", exact=True)
        comparison.click()
        since = page.get_by_role("menuitem", name=re.compile("^Since"))
        expect(since).to_have_attribute("aria-disabled", "true")
        since.hover()
        expect(page.get_by_role("tooltip")).to_contain_text("Select a repository root")
        page.get_by_role("menuitem", name=re.compile("^Chat")).click()
        expect(comparison).to_contain_text("Chat")
        expect(_entry(panel, "vanished")).to_have_count(0)
        tabs = panel.get_by_role("tablist", name="Workspace") if mobile else panel
        tabs.get_by_role("tab", name=re.compile("^Changes")).click()
        expect(panel.get_by_text("dead.txt", exact=True)).to_be_visible(timeout=15_000)
        comparison.click()
        page.get_by_role("menuitem", name=re.compile("^Git")).click()
        expect(panel.get_by_text("dead.txt", exact=True)).to_have_count(0)
        expect(panel.get_by_text("deleted.txt", exact=True)).to_be_visible(timeout=15_000)
        tabs.get_by_role("tab", name="Files", exact=True).click()
        expect(_entry(panel, "vanished")).to_have_count(0)
        expect(_entry(panel, f"{prefix}/deleted.txt")).to_have_count(0)
        page.screenshot(
            path=str(
                Path(request.config.getoption("output"))
                / f"shared-comparison-{'phone' if mobile else 'desktop'}.png"
            ),
            animations="disabled",
        )
    finally:
        shutil.rmtree(repository)


def test_shared_comparison_selects_repository_revisions(
    page: Page,
    seeded_session: tuple[str, str],
    tmp_path: Path,
) -> None:
    base, session_id = seeded_session
    first, second, prefix, repository = _seed_repositories(
        base, session_id, tmp_path / "nested-git"
    )
    try:
        page.goto(f"{base}/c/{session_id}?view=explore")
        panel = page.get_by_role("complementary", name="Workspace")
        expect(_entry(panel, prefix)).to_be_visible(timeout=30_000)
        _entry(panel, prefix).locator("button[aria-expanded]").dblclick()
        comparison = panel.get_by_role("button", name="Diff comparison", exact=True)
        comparison.click()
        since = page.get_by_role("menuitem", name=re.compile("^Since"))
        expect(since).not_to_have_attribute("aria-disabled", "true")
        since.click()
        dialog = page.get_by_role("dialog")
        dialog.get_by_role("textbox", name="Commit revision", exact=True).fill(first)
        dialog.get_by_role("button", name="Compare", exact=True).click()
        expect(comparison).to_contain_text("Since")
        # The same selected scope and baseline survives switching to Changes.
        panel.get_by_role("tab", name=re.compile("^Changes")).click()
        expect(panel.get_by_text("deleted.txt", exact=True)).to_be_visible(timeout=20_000)
        expect(comparison).to_contain_text("Since")
        panel.get_by_text("keep.txt", exact=True).click()
        viewer = page.get_by_test_id("file-viewer")
        expect(viewer).to_be_visible()
        diff_button = viewer.get_by_role("button", name="Show diff", exact=True)
        if diff_button.is_visible():
            diff_button.click()
        else:
            viewer.get_by_role("button", name="More actions", exact=True).click()
            page.get_by_role("menuitem", name="Show diff", exact=True).click()
        selector = viewer.get_by_role("button", name="Diff comparison", exact=True)
        expect(selector).to_contain_text("Since")
        selector.click()
        page.get_by_role("menuitem", name=re.compile("^Revisions")).click()
        dialog = page.get_by_role("dialog")
        dialog.get_by_role("textbox", name="Base revision", exact=True).fill(first)
        dialog.get_by_role("textbox", name="Target revision", exact=True).fill(second)
        with page.expect_response(
            lambda response: (
                "/git?" in response.url
                and f"base={first}" in response.url
                and "operation=diff" in response.url
            )
        ) as compared:
            dialog.get_by_role("button", name="Compare", exact=True).click()
        result = compared.value.json()
        assert compared.value.ok, result
        assert result["before"] == "alpha committed\n"
        assert result["after"] == "beta committed\n"
        # Return to the list: it must use the same committed range, not live dirt.
        panel.get_by_role("tab", name=re.compile("^Changes")).click()
        expect(panel.get_by_role("button", name="Diff comparison", exact=True)).to_contain_text(
            "Revisions"
        )
        expect(panel.get_by_text("deleted.txt", exact=True)).to_have_count(0)
    finally:
        shutil.rmtree(repository)


def test_wide_workspace_keeps_explorer_beside_stable_file_viewer(
    page: Page,
    seeded_session: tuple[str, str],
    tmp_path: Path,
    request: pytest.FixtureRequest,
) -> None:
    base, session_id = seeded_session
    _, _, prefix, repository = _seed_repositories(base, session_id, tmp_path / "nested-git")
    extra = ["long_component_reference_one.txt", "long_component_reference_two.txt"]
    for name in extra:
        _seed_file(base, session_id, f"{prefix}/{name}", "Workspace overflow fixture\n")
    try:
        page.set_viewport_size({"width": 1440, "height": 960})
        page.goto(f"{base}/c/{session_id}?view=explore&file={prefix}/keep.txt")
        panel = page.get_by_role("complementary", name="Workspace")
        viewer = page.get_by_test_id("file-viewer")
        expect(viewer).to_be_visible(timeout=30_000)
        expect(viewer).to_contain_text("gamma working tree", timeout=30_000)
        expect(page.get_by_role("region", name="File explorer", exact=True)).to_have_count(0)
        # Keep an identity marker on the real viewer DOM across the split threshold.
        viewer.evaluate("element => element.dataset.resizeIdentity = 'same-viewer'")
        panel.get_by_role("button", name="Full screen", exact=True).click()
        explorer = page.get_by_role("region", name="File explorer", exact=True)
        expect(explorer).to_be_visible(timeout=15_000)
        expect(viewer).to_have_attribute("data-resize-identity", "same-viewer")
        assert (
            explorer.bounding_box()["x"] + explorer.bounding_box()["width"]
            <= viewer.bounding_box()["x"] + 1
        )
        divider = explorer.get_by_role("separator", name="Resize file explorer")
        before_width = explorer.bounding_box()["width"]
        handle = divider.bounding_box()
        page.mouse.move(handle["x"] + handle["width"] / 2, handle["y"] + 150)
        page.mouse.down()
        page.mouse.move(handle["x"] + 100, handle["y"] + 150, steps=8)
        page.mouse.up()
        assert explorer.bounding_box()["width"] > before_width + 80
        expect(viewer).to_have_attribute("data-resize-identity", "same-viewer")
        headers = panel.locator(".workspace-control-header")
        for header in headers.all():
            if header.is_visible():
                assert header.bounding_box()["height"] == 48
        divider.press("ArrowLeft")
        assert explorer.bounding_box()["width"] > before_width + 50
        explorer_header = explorer.locator(".workspace-control-header").first
        viewer_header = viewer.locator(".workspace-control-header").first
        for row in (explorer_header, viewer_header):
            assert row.bounding_box()["height"] == 48
        explorer_bounds = explorer_header.bounding_box()
        viewer_bounds = viewer_header.bounding_box()
        assert abs(explorer_bounds["y"] - viewer_bounds["y"]) < 0.5
        assert (
            abs(
                explorer_bounds["y"]
                + explorer_bounds["height"]
                - viewer_bounds["y"]
                - viewer_bounds["height"]
            )
            < 0.5
        )
        divider.press("Home")
        assert explorer.bounding_box()["width"] == 180
        expect(explorer.get_by_role("button", name="New file", exact=True)).to_be_hidden()
        overflow = explorer.get_by_role("button", name="More file actions", exact=True)
        expect(overflow).to_be_in_viewport()
        overflow.click()
        expect(page.get_by_role("menuitem", name="New file", exact=True)).to_be_visible()
        expect(page.get_by_role("menuitem", name="Refresh files", exact=True)).to_be_visible()
        page.keyboard.press("Escape")
        divider.press("ArrowRight")
        assert explorer.bounding_box()["width"] == 200
        folder = _entry(explorer, prefix)
        expect(folder).to_be_visible(timeout=15_000)
        if folder.locator("button[aria-expanded]").get_attribute("aria-expanded") != "true":
            folder.locator("button[aria-expanded]").click()
        nested = _entry(explorer, f"{prefix}/nested").locator("button[aria-expanded]")
        if nested.get_attribute("aria-expanded") != "true":
            nested.click()
        _entry(explorer, f"{prefix}/nested/inner.txt").locator("button").first.click()
        expect(viewer).to_contain_text("inner.txt")
        expect(viewer).to_contain_text("inner working tree", timeout=30_000)
        expect(explorer).to_be_visible()
        for name in extra:
            _entry(explorer, f"{prefix}/{name}").locator("button").first.click()
        expect(panel.get_by_role("button", name="Select panel", exact=True)).to_have_count(0)
        expect(viewer).to_contain_text("Workspace overflow fixture", timeout=30_000)
        page.mouse.move(800, 800)
        output = Path(request.config.getoption("output"))
        page.screenshot(path=str(output / "wide-explorer-file-split.png"), animations="disabled")
        panel.get_by_role("button", name="Exit full screen", exact=True).click()
        expect(explorer).to_have_count(0)
        expect(viewer).to_be_visible()
        expect(viewer).to_have_attribute("data-resize-identity", "same-viewer")
        expect(panel.get_by_role("button", name="Select panel", exact=True)).to_be_visible()
        panel.get_by_role("button", name="Full screen", exact=True).click()
        expect(panel.get_by_role("button", name="Select panel", exact=True)).to_have_count(0)
    finally:
        shutil.rmtree(repository)
