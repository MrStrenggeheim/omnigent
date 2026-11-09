"""E2E: responsive Web UI workflow at a phone-sized viewport.

``AppShell.test.tsx`` already covers the mobile session-menu state
machine in jsdom — but jsdom does not apply the Tailwind ``md:`` media
queries, so it cannot prove the responsive *layout* contract. These
tests run a real browser at a 390×844 (phone) viewport and assert the
behaviors only real CSS can produce:

  - the desktop workspace rail (``md:flex``) is collapsed off-screen;
  - chat actions and workspace navigation use separate header buttons;
  - the desktop right-panel toggle (``hidden md:inline-flex``) is gone;
  - each rail surface (Changes/Files/Agents) is reachable through the
    Workspace tabs and opens a full-screen drawer;
  - the chat composer is usable and streams a response on a phone.

Files are seeded via the filesystem PUT endpoint so the navigation
tests are deterministic (no LLM); the final chat test exercises the
real streaming path the same way ``test_smoke`` does.
"""

from __future__ import annotations

import re
import shutil
from collections.abc import Iterator
from pathlib import Path

import httpx
import pytest
from playwright.sync_api import Page, ViewportSize, expect

from tests.e2e_ui.conftest import configure_mock_llm

# iPhone-12-class portrait viewport — comfortably below the Tailwind
# ``md`` breakpoint (768px) so every ``md:`` rule resolves to its
# mobile branch.
_MOBILE_VIEWPORT: ViewportSize = {"width": 390, "height": 844}

_SEEDED_FILE_PATH = "mobile_workflow.txt"
_SEEDED_FILE_CONTENT = "File body opened through the mobile Changes drawer."

_REPO_ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def mobile_session_with_file(
    seeded_session: tuple[str, str],
) -> Iterator[tuple[str, str]]:
    """Seed one file and clean up the per-session workdir on teardown.

    The agent spec's ``os_env.cwd: .`` makes filesystem PUTs land in
    ``<repo-root>/<session_id>/``; remove it after the test so no
    untracked files are left behind.
    """
    base_url, session_id = seeded_session
    resp = httpx.put(
        f"{base_url}/v1/sessions/{session_id}"
        f"/resources/environments/default/filesystem/{_SEEDED_FILE_PATH}",
        json={"content": _SEEDED_FILE_CONTENT, "encoding": "utf-8"},
        timeout=10.0,
    )
    resp.raise_for_status()
    try:
        yield (base_url, session_id)
    finally:
        shutil.rmtree(_REPO_ROOT / session_id, ignore_errors=True)


def test_mobile_collapses_rail_and_surfaces_kebab(
    page: Page,
    seeded_session: tuple[str, str],
) -> None:
    """Phone layout exposes separate chat and workspace controls."""
    base_url, session_id = seeded_session
    page.set_viewport_size(_MOBILE_VIEWPORT)
    page.goto(f"{base_url}/c/{session_id}")

    # The composer renders, confirming the chat surface is the primary
    # mobile view (no rail competing for space).
    expect(page.get_by_placeholder("Send a message…")).to_be_visible()

    # Desktop rail is in the DOM but collapsed off-screen (hidden md:flex).
    # A DOM-scoped locator makes not_to_be_visible() genuinely assert
    # display:none rather than passing on a 0-match accessibility locator.
    expect(page.locator('aside[aria-label="Workspace"]')).not_to_be_visible()

    # Kebab present; desktop right-panel toggle present-but-hidden.
    expect(page.get_by_role("button", name="Conversation actions")).to_be_visible()
    expect(page.get_by_role("button", name="Open workspace")).to_be_visible()
    expect(page.get_by_role("button", name="Open session menu")).to_have_count(0)
    expect(
        page.locator(
            'button[aria-label="Collapse right panel"], button[aria-label="Expand right panel"]'
        )
    ).not_to_be_visible()


@pytest.fixture
def mobile_session_with_child_agent(
    seeded_session: tuple[str, str],
) -> Iterator[tuple[str, str]]:
    """Seed one sub-agent (child) session under the parent.

    The Agents surface is gated on ``childSessions.length > 0`` — the
    root having at least one child (so "main + child" is genuinely
    multi-agent). A real spawn needs an LLM run, which is slow and
    non-deterministic; instead we create the child directly via the
    JSON ``POST /v1/sessions`` contract with ``parent_session_id`` set,
    reusing the parent's bound ``agent_id``. That makes the server
    record a ``kind="sub_agent"`` conversation, which
    ``GET /sessions/{id}/child_sessions`` then lists even with no
    tasks. Cleaned up by deleting the child on teardown.
    """
    base_url, session_id = seeded_session
    parent = httpx.get(
        f"{base_url}/v1/sessions/{session_id}",
        timeout=10.0,
    )
    parent.raise_for_status()
    agent_id = parent.json()["agent_id"]

    child = httpx.post(
        f"{base_url}/v1/sessions",
        json={
            "agent_id": agent_id,
            "parent_session_id": session_id,
            "sub_agent_name": "researcher",
            "title": "researcher:auth",
        },
        timeout=30.0,
    )
    child.raise_for_status()
    # JSON POST /v1/sessions returns a SessionResponse (id), unlike the
    # multipart bundled create used by seeded_session (session_id).
    child_id = child.json()["id"]
    try:
        yield (base_url, session_id)
    finally:
        httpx.delete(
            f"{base_url}/v1/sessions/{child_id}",
            timeout=10.0,
        )


@pytest.mark.parametrize(
    "width,dark", [(320, False), (390, True), (700, False)], ids=["small", "phone-dark", "tablet"]
)
def test_mobile_workspace_keeps_chat_actions_separate(
    page: Page,
    seeded_session: tuple[str, str],
    request: pytest.FixtureRequest,
    width: int,
    dark: bool,
) -> None:
    """Tools stay reachable as tabs and reopening retains the last workspace page."""
    base_url, session_id = seeded_session
    page.set_viewport_size({"width": width, "height": 844})
    if dark:
        page.emulate_media(color_scheme="dark")
    page.goto(f"{base_url}/c/{session_id}")
    chat = page.get_by_role("button", name="Conversation actions", exact=True)
    workspace = page.get_by_role("button", name="Open workspace", exact=True)
    expect(chat).to_be_visible()
    expect(workspace).to_be_visible()
    bell = page.get_by_role("button", name="Notifications", exact=True)
    assert chat.bounding_box()["x"] < bell.bounding_box()["x"] < workspace.bounding_box()["x"]
    left = page.get_by_role("button", name="Open sidebar", exact=True)
    left_bounds = left.bounding_box()
    left.click()
    close_left = page.get_by_role("button", name="Close sidebar", exact=True).filter(
        has=page.locator('[data-panel-side="left"]')
    )
    expect(close_left).to_be_visible()
    assert abs(close_left.bounding_box()["x"] - left_bounds["x"]) < 2
    assert abs(close_left.bounding_box()["y"] - left_bounds["y"]) < 2
    close_left.click()
    chat.click()
    expect(page.get_by_role("menuitem", name="Rename", exact=True)).to_be_visible()
    expect(
        page.get_by_role(
            "menuitem", name=re.compile("^(Files|Changes|Agents|Shells|Pull Requests)$")
        )
    ).to_have_count(0)
    page.keyboard.press("Escape")
    output = Path(request.config.getoption("output"))
    page.screenshot(path=str(output / f"mobile-header-{width}.png"), animations="disabled")
    workspace_bounds = workspace.bounding_box()
    workspace.click()
    close_workspace = page.get_by_role("button", name="Close workspace", exact=True)
    expect(close_workspace).to_be_visible()
    assert abs(close_workspace.bounding_box()["x"] - workspace_bounds["x"]) < 2
    assert abs(close_workspace.bounding_box()["y"] - workspace_bounds["y"]) < 2
    tabs = page.get_by_role("tablist", name="Workspace", exact=True)
    expect(tabs.get_by_role("tab", name="Files", exact=True)).to_have_attribute(
        "aria-selected", "true"
    )
    expect(tabs.get_by_role("tab", name="Shells", exact=True)).to_have_count(0)
    # Opening the left drawer preserves Workspace underneath; revealing Workspace dismisses it.
    left.click()
    conversations = page.get_by_role("complementary", name="Conversations", exact=True)
    expect(close_left).to_be_visible()
    expect(page.get_by_test_id("files-panel-drawer")).to_have_attribute("data-state", "open")
    page.wait_for_function(
        """element => {
          const r=element.getBoundingClientRect();
          return r.x >= 0 && element.contains(
            document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));
        }""",
        arg=conversations.element_handle(),
    )
    scrim = page.get_by_test_id("sidebar-scrim")
    assert scrim.evaluate(
        """element => {
          const r=element.getBoundingClientRect();
          return document.elementFromPoint(r.right-10,r.y+r.height/2)===element;
        }"""
    )
    page.get_by_role("button", name="Open workspace", exact=True).click()
    expect(close_left).to_have_count(0)
    expect(page.get_by_test_id("files-panel-drawer")).to_have_attribute("data-state", "open")
    expect(tabs.get_by_role("tab", name="Files", exact=True)).to_have_attribute(
        "aria-selected", "true"
    )
    tabs.get_by_role("tab", name="Changes", exact=True).click()
    expect(
        page.get_by_test_id("files-panel-drawer").get_by_role("tree", name="Changed files")
    ).to_be_visible()
    tabs.get_by_role("tab", name="Search", exact=True).click()
    expect(page.get_by_test_id("content-search-panel-drawer")).to_have_attribute(
        "data-state", "open"
    )
    tabs.get_by_role("tab", name="Agents", exact=True).click()
    agents = page.get_by_test_id("subagents-panel-drawer")
    expect(agents).to_have_attribute("data-state", "open")
    expect(page.get_by_test_id("content-search-panel-drawer")).to_have_attribute(
        "data-state", "closed"
    )
    expect(tabs.get_by_role("tab", name="Agents", exact=True)).to_be_focused()
    page.screenshot(path=str(output / f"mobile-workspace-{width}.png"), animations="disabled")
    page.get_by_role("button", name="Close workspace", exact=True).click()
    workspace.click()
    expect(agents).to_have_attribute("data-state", "open")
    expect(tabs.get_by_role("tab", name="Agents", exact=True)).to_have_attribute(
        "aria-selected", "true"
    )
    tabs.get_by_role("tab", name="Pull Requests", exact=True).click()
    expect(page.get_by_test_id("github-panel-drawer")).to_have_attribute("data-state", "open")
    tabs.get_by_role("tab", name="Files", exact=True).click()
    expect(page.get_by_test_id("files-panel-drawer")).to_have_attribute("data-state", "open")


def test_mobile_shells_drawer_exposes_new_shell_before_shells_exist(
    page: Page,
    terminal_session: tuple[str, str],
) -> None:
    """Shell-capable agents expose the mobile Shells drawer at zero shells.

    Mobile has no tab-strip "+" menu, so the Shells drawer is the create entry
    point: when the session agent declares a ``terminals:`` block, Workspace lists
    Shells before any user shell exists, and selecting it opens the full-screen
    drawer carrying a "+ New shell" row. (On desktop the create affordance lives
    in the tab strip's "+" menu and the rail's Shells tab only lists existing
    shells — see AppShell.test.tsx.)
    """
    base_url, session_id = terminal_session
    page.set_viewport_size(_MOBILE_VIEWPORT)
    page.goto(f"{base_url}/c/{session_id}")

    page.get_by_role("button", name="Open workspace").click()

    shells_entry = page.get_by_role("tablist", name="Workspace").get_by_role(
        "tab", name="Shells", exact=True
    )
    expect(shells_entry).to_be_visible(timeout=10_000)
    shells_entry.click()

    drawer = page.get_by_test_id("shells-panel-drawer")
    expect(drawer).to_have_attribute("data-state", "open")
    expect(drawer.get_by_role("button", name="New shell")).to_be_visible()


def test_mobile_kebab_shows_agents_entry_when_child_agents_exist(
    page: Page,
    mobile_session_with_child_agent: tuple[str, str],
) -> None:
    """The Agents entry appears once the session has a child agent.

    Counterpart to the omits-absent-ones test: with one sub-agent
    seeded under the parent, the multi-agent gate
    (``childSessions.length > 0``) is satisfied, so Workspace now lists
    Agents alongside Files. Selecting it opens the agents drawer.
    """
    base_url, session_id = mobile_session_with_child_agent
    page.set_viewport_size(_MOBILE_VIEWPORT)
    page.goto(f"{base_url}/c/{session_id}")

    page.get_by_role("button", name="Open workspace").click()

    agents_entry = page.get_by_role("tablist", name="Workspace").get_by_role(
        "tab", name="Agents", exact=True
    )
    # 10s budget: the rail fetches child_sessions on load, so the entry
    # can take a fetch cycle (plus cold-start latency) to appear.
    expect(agents_entry).to_be_visible(timeout=10_000)
    expect(
        page.get_by_role("tablist", name="Workspace").get_by_role("tab", name="Files", exact=True)
    ).to_be_visible()

    # Selecting Agents opens the agents (sub-agents) drawer.
    agents_entry.click()
    drawer = page.get_by_test_id("subagents-panel-drawer")
    expect(drawer).to_have_attribute("data-state", "open")


def test_mobile_files_drawer_opens_seeded_file(
    page: Page,
    mobile_session_with_file: tuple[str, str],
) -> None:
    """Open Files from Workspace and view the seeded file.

    The full chain a phone user hits: Workspace → Files → full-screen files
    drawer → tap a file → full-screen file viewer with real content.
    Uses the Files (folder-tree) surface rather than Changes: the
    session workspace isn't a git repo, so the changed-files diff is
    empty, but the directory listing always includes the seeded file.
    Failure means the mobile drawer routing or the mobile FileViewer
    push-panel regressed.
    """
    base_url, session_id = mobile_session_with_file
    page.set_viewport_size(_MOBILE_VIEWPORT)
    page.goto(f"{base_url}/c/{session_id}")

    page.get_by_role("button", name="Open workspace").click()

    drawer = page.get_by_test_id("files-panel-drawer")
    expect(drawer).to_have_attribute("data-state", "open")

    # The PUT-seeded file appears in the working-folder directory listing.
    # Anchor the name to the filename so the row button is matched, not the
    # sibling "Download <file>" action button. 30s budget: the panel polls
    # the workspace listing endpoint on an interval, so the seeded file can
    # take a poll cycle (plus cold-start latency) to surface.
    file_button = page.get_by_role("button", name=re.compile(rf"^{re.escape(_SEEDED_FILE_PATH)}"))
    expect(file_button).to_be_visible(timeout=30_000)
    file_button.click()

    # Selecting a file closes the drawer and opens the mobile FileViewer
    # push-panel. ``:visible`` targets the on-screen instance (the desktop
    # inline viewer carries the same testid but is display:none here).
    file_viewer = page.locator('[data-testid="file-viewer"]:visible')
    expect(file_viewer).to_contain_text(_SEEDED_FILE_PATH)
    expect(file_viewer.get_by_text(_SEEDED_FILE_CONTENT).first).to_be_visible(timeout=20_000)
    file_viewer.get_by_role("tablist", name="Workspace").get_by_role(
        "tab", name="Agents", exact=True
    ).click()
    agents = page.get_by_test_id("subagents-panel-drawer")
    expect(agents).to_have_attribute("data-state", "open")
    agents.get_by_role("tab", name="Files", exact=True).click()
    expect(drawer).to_have_attribute("data-state", "open")
    expect(
        drawer.get_by_role("button", name=re.compile(rf"^{re.escape(_SEEDED_FILE_PATH)}"))
    ).to_be_visible()


# The agent turn is dispatched to the in-process harness, which
# occasionally produces no assistant output on the first turn (the
# runner goes idle after dispatch — a nondeterministic harness
# scheduling stall, not a real-LLM artifact since this drives the mock
# LLM). Rerun on failure rather than widen the already-generous 60s
# wait, which a stalled turn would never satisfy.
@pytest.mark.flaky(reruns=2, reruns_delay=5)
def test_mobile_chat_send_and_response(
    page: Page,
    seeded_session: tuple[str, str],
    mock_llm_server_url: str,
) -> None:
    """The composer streams an assistant reply at a phone viewport.

    Mirrors ``test_smoke`` but at 390px wide, confirming the composer
    and message list stay usable on a phone (no rail stealing layout).
    """
    base_url, session_id = seeded_session
    prompt = "Say 'mobile-pong-e2e' in one word."
    configure_mock_llm(
        mock_llm_server_url,
        [{"text": "mobile-pong-e2e"}],
        key="mobile-chat-send-and-response",
        match=prompt,
    )
    page.set_viewport_size(_MOBILE_VIEWPORT)
    page.goto(f"{base_url}/c/{session_id}")

    composer = page.get_by_placeholder("Send a message…")
    expect(composer).to_be_visible()
    composer.fill(prompt)
    page.get_by_role("button", name="Send", exact=True).click()

    assistant = page.locator('[data-testid="message-bubble"][data-role="assistant"]').first
    expect(assistant).to_be_visible(timeout=60_000)
    expect(assistant).to_contain_text("mobile-pong-e2e", timeout=60_000)
