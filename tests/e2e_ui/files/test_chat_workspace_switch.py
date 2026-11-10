"""Composer workspace changes restart a real isolated host runner."""

from __future__ import annotations

import json
import os
import shutil
import uuid
from pathlib import Path

import httpx
import pytest
from playwright.sync_api import Page, expect

from tests._helpers.host import isolated_host
from tests._helpers.native_session import create_native_session
from tests.e2e_ui.conftest import (
    _CODEX_MOCK_MODEL,
    configure_mock_llm,
    reset_mock_llm,
    set_fallback_mock_llm,
)
from tests.e2e_ui.files.test_workbench_ownership import Ownership, _open
from tests.e2e_ui.files.test_workbench_ownership import ownership as ownership
from tests.e2e_ui.messages.test_message_render_parity import (
    _ASSISTANT,
    _WORKING,
    _ensure_chat_view,
    _send,
)


def _choose_workspace(page: Page, target: Path) -> None:
    page.get_by_test_id("composer-workspace-dir").click()
    dialog = page.get_by_role("dialog", name="Change workspace", exact=True)
    expect(dialog).to_be_visible()
    dialog.locator('input[role="combobox"]').fill(str(target))
    dialog.get_by_role("button", name="Change workspace", exact=True).click()
    expect(dialog).not_to_be_visible(timeout=120_000)


@pytest.mark.parametrize("mobile", [False, True], ids=["desktop", "phone"])
def test_composer_switch_restarts_agent_and_panel_in_selected_folder(
    page: Page, ownership: Ownership, mobile: bool, request: pytest.FixtureRequest
) -> None:
    rail = _open(page, ownership)
    old = ownership.client.get(f"/v1/sessions/{ownership.chats[0]}").json()
    shell_url = None
    if not mobile:
        shells = f"/v1/workbench-workspaces/{ownership.workspaces[0]}/terminals"
        shell = ownership.client.post(shells, json={"terminal": "shell"})
        shell.raise_for_status()
        shell_url = f"{shells}/{shell.json()['id']}"
        request.addfinalizer(lambda: ownership.client.delete(shell_url))

    if mobile:
        page.set_viewport_size({"width": 390, "height": 844})
        page.keyboard.press("ControlOrMeta+b")
    with page.expect_response(
        lambda response: (
            response.request.method == "POST"
            and response.url.endswith("/workspace")
            and not response.request.post_data_json.get("validate_only")
        ),
        timeout=120_000,
    ) as changed:
        _choose_workspace(page, ownership.roots[1])
    assert changed.value.ok, changed.value.text()
    result = changed.value.json()
    assert result["operation"]["phase"] == "completed", result
    assert result["workspace"] == str(ownership.roots[1])
    assert result["runner_id"] != old["runner_id"]
    after = ownership.client.get(f"/v1/sessions/{ownership.chats[0]}").json()
    assert after["id"] == old["id"]
    assert after["title"] == old["title"]
    assert after["agent_id"] == old["agent_id"]
    if shell_url:
        assert ownership.client.get(shell_url).json()["running"] is True

    expect(page.get_by_test_id("composer-workspace-dir")).to_contain_text(ownership.roots[1].name)
    page.reload()
    expect(page.get_by_test_id("composer-workspace-dir")).to_contain_text(
        ownership.roots[1].name, timeout=30_000
    )
    if mobile:
        page.get_by_role("button", name="Open workspace", exact=True).click()
        panel = page.get_by_test_id("files-panel-drawer").filter(visible=True)
    else:
        panel = rail
    expect(panel.get_by_role("button", name="Select workspace", exact=True)).to_have_count(0)
    resolved = ownership.client.post(
        "/v1/workbench-workspaces/resolve", json={"session_id": ownership.chats[0]}
    )
    assert resolved.json()["root"] == str(ownership.roots[1])
    assert ownership.roots[0].joinpath("same.txt").read_text() == "workspace_a_original\n"
    assert ownership.roots[1].joinpath("same.txt").read_text() == "workspace_b_original\n"


@pytest.mark.skipif(shutil.which("codex") is None, reason="Codex CLI required")
@pytest.mark.timeout(360)
def test_codex_cold_resume_keeps_thread_and_runs_tools_in_new_workspace(
    page: Page, live_server: str, mock_llm_server_url: str, tmp_path: Path
) -> None:
    first, second = tmp_path / "native-first", tmp_path / "native-second"
    first.mkdir()
    second.mkdir()
    config = {
        "providers": {
            "mock-codex": {
                "kind": "key",
                "default": ["openai"],
                "openai": {
                    "base_url": mock_llm_server_url + "/v1",
                    "api_key": "mock-key",
                    "wire_api": "responses",
                    "models": {"default": _CODEX_MOCK_MODEL},
                },
            }
        }
    }
    with (
        isolated_host(
            tmp_path / "host",
            live_server,
            base_env={"PATH": os.environ["PATH"]},
            env={"CODEX_HOME": str(tmp_path / "codex-home")},
            config=config,
        ) as host,
        httpx.Client(base_url=live_server, timeout=120) as client,
    ):
        host.wait_online(client)
        session = create_native_session(
            client,
            live_server,
            harness="codex",
            model=_CODEX_MOCK_MODEL,
            metadata={"host_id": host.host_id, "workspace": str(first)},
        )
        session_id = session["session_id"]
        try:
            page.goto(f"{live_server}/c/{session_id}?view=chat")
            _ensure_chat_view(page)
            reset_mock_llm(mock_llm_server_url)
            set_fallback_mock_llm(mock_llm_server_url, _CODEX_MOCK_MODEL, "")
            boot = "WSBOOT-" + uuid.uuid4().hex[:8]
            configure_mock_llm(
                mock_llm_server_url,
                [{"text": "WORKSPACE_BOOT_OK"}, {"text": "WORKSPACE_BOOT_OK"}],
                key=boot,
                match=boot,
            )
            _send(page, f"Say WORKSPACE_BOOT_OK. {boot}")
            expect(page.locator(_ASSISTANT, has_text="WORKSPACE_BOOT_OK").first).to_be_visible(
                timeout=180_000
            )
            expect(page.locator(_WORKING)).to_have_count(0, timeout=180_000)
            before = client.get(f"/v1/sessions/{session_id}").json()
            assert before["external_session_id"]
            _choose_workspace(page, second)
            after = client.get(f"/v1/sessions/{session_id}").json()
            assert after["external_session_id"] == before["external_session_id"]
            assert after["workspace"] == str(second)
            reset_mock_llm(mock_llm_server_url)
            marker = "WSSWITCH-" + uuid.uuid4().hex[:8]
            configure_mock_llm(
                mock_llm_server_url,
                [
                    {
                        "tool_calls": [
                            {
                                "call_id": "pwd-" + marker,
                                "name": "exec_command",
                                "arguments": json.dumps({"cmd": "pwd"}),
                            }
                        ]
                    },
                    {"text": "WORKSPACE_SWITCH_DONE"},
                ],
                key=marker,
                match=marker,
                required_tools=["exec_command"],
            )
            _send(page, f"Run pwd, then say WORKSPACE_SWITCH_DONE. {marker}")
            expect(page.locator(_ASSISTANT, has_text="WORKSPACE_SWITCH_DONE").first).to_be_visible(
                timeout=180_000
            )
            expect(page.locator(_WORKING)).to_have_count(0, timeout=180_000)
            items = client.get(
                f"/v1/sessions/{session_id}", params={"include_items": "true"}
            ).json()

            def tool_outputs(value):
                if isinstance(value, dict):
                    for key, child in value.items():
                        if key == "output" and isinstance(child, str):
                            yield child
                        else:
                            yield from tool_outputs(child)
                elif isinstance(value, list):
                    for child in value:
                        yield from tool_outputs(child)

            assert any(str(second) in output for output in tool_outputs(items)), items
            assert "WORKSPACE_BOOT_OK" in json.dumps(items)
        finally:
            client.delete(f"/v1/sessions/{session_id}")


def test_workspace_change_preserves_a_draft_when_file_navigation_is_cancelled(
    page: Page, ownership: Ownership
) -> None:
    from tests.e2e_ui.files.test_explorer_file_operations import _entry

    rail = _open(page, ownership)
    page.route(
        f"**/workbench-workspaces/{ownership.workspaces[0]}/resources/environments/default/filesystem/same.txt*",
        lambda route: (
            route.fulfill(status=503, json={"detail": "Save paused for dirty guard proof"})
            if route.request.method == "PUT"
            else route.continue_()
        ),
    )
    _entry(rail, "same.txt").locator("button").first.click()
    editor = page.get_by_test_id("file-viewer").locator(".view-lines")
    expect(editor).to_contain_text("workspace_a_original", timeout=30_000)
    editor.click()
    page.keyboard.press("ControlOrMeta+Home")
    page.keyboard.type("unsaved-workspace-change")
    page.get_by_test_id("composer-workspace-dir").click()
    dialog = page.get_by_role("dialog", name="Change workspace", exact=True)
    dialog.locator('input[role="combobox"]').fill(str(ownership.roots[1]))
    dialog.get_by_role("button", name="Change workspace", exact=True).click()
    prompt = page.get_by_role("dialog", name="Unsaved changes", exact=True)
    expect(prompt).to_be_visible(timeout=30_000)
    prompt.get_by_role("button", name="Keep editing", exact=True).click()
    expect(dialog).not_to_be_visible()
    expect(editor).to_contain_text("unsaved-workspace-change")
    current = ownership.client.get(f"/v1/sessions/{ownership.chats[0]}").json()
    assert current["workspace"] == str(ownership.roots[0])
    assert current["workspace_switching"] is False
