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
def test_git_tracking_ignores_agent_ghosts_and_persists_toggle(
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
            page.get_by_role("button", name="Conversation actions").click()
            page.get_by_role("menuitem", name="Files", exact=True).click()
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
        panel.get_by_role("button", name="More file actions", exact=True).click()
        toggle = page.get_by_role("menuitemcheckbox", name="Show agent changes", exact=True)
        expect(toggle).not_to_be_checked()
        toggle.click()
        expect(toggle).not_to_be_visible()
        expect(_entry(panel, "vanished")).to_be_visible(timeout=15_000)
        panel.get_by_role("button", name="More file actions", exact=True).click()
        page.get_by_role("menuitemcheckbox", name="Show agent changes", exact=True).click()
        expect(toggle).not_to_be_visible()
        expect(_entry(panel, "vanished")).to_have_count(0)
        if not mobile:
            changes = panel.get_by_role("tab", name=re.compile("^Changes"))
            expect(changes).to_have_accessible_name("Changes 3 changed")
            changes.click()
            expect(
                panel.get_by_role("button", name=f"deleted.txt {prefix}", exact=True)
            ).to_be_visible(timeout=15_000)
            panel.get_by_role("tab", name="Files", exact=True).click()
        page.screenshot(
            path=str(
                Path(request.config.getoption("output"))
                / f"git-explorer-{'phone' if mobile else 'desktop'}.png"
            ),
            animations="disabled",
        )
        page.reload()
        if mobile:
            page.get_by_role("button", name="Conversation actions").click()
            page.get_by_role("menuitem", name="Files", exact=True).click()
        panel.get_by_role("button", name="More file actions", exact=True).click()
        expect(
            page.get_by_role("menuitemcheckbox", name="Show agent changes", exact=True)
        ).not_to_be_checked()
    finally:
        shutil.rmtree(repository)


def test_diff_compares_explicit_commits_with_agent_tracking_off(
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
        _entry(panel, prefix).locator("button[aria-expanded]").click()
        _entry(panel, f"{prefix}/keep.txt").locator("button").first.click()
        viewer = page.get_by_test_id("file-viewer")
        expect(viewer).to_be_visible()
        diff_button = viewer.get_by_role("button", name="Show diff", exact=True)
        if diff_button.is_visible():
            diff_button.click()
        else:
            viewer.get_by_role("button", name="More actions", exact=True).click()
            page.get_by_role("menuitem", name="Show diff", exact=True).click()
        comparison = viewer.get_by_role("combobox", name="Diff comparison")
        comparison.click()
        page.get_by_role("option", name="Commit range", exact=True).click()
        viewer.get_by_role("textbox", name="Base revision", exact=True).fill(first)
        viewer.get_by_role("textbox", name="Target revision", exact=True).fill(second)
        with page.expect_response(
            lambda response: "/git?" in response.url and f"base={first}" in response.url
        ) as compared:
            viewer.get_by_role("button", name="Compare", exact=True).click()
        result = compared.value.json()
        assert compared.value.ok, result
        assert result["before"] == "alpha committed\n"
        assert result["after"] == "beta committed\n"
        comparison.click()
        page.get_by_role("option", name="Commit", exact=True).click()
        viewer.get_by_role("textbox", name="Commit revision", exact=True).fill(first)
        with page.expect_response(
            lambda response: "/git?" in response.url and f"target={first}" in response.url
        ) as initial:
            viewer.get_by_role("button", name="Compare", exact=True).click()
        assert initial.value.ok, initial.value.text()
        assert initial.value.json()["before"] is None
        assert initial.value.json()["after"] == "alpha committed\n"
    finally:
        shutil.rmtree(repository)
