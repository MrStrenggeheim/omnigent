"""Global agent preference through Settings and the actual new-chat composer."""

from __future__ import annotations

import json
import os
import re
import uuid
from pathlib import Path

import httpx
import pytest
from playwright.sync_api import Page, expect

from tests._helpers.host import isolated_host
from tests.e2e_ui.sessions.test_project_settings_model_default import _resolve_builtin_agent


def test_global_agent_default_yields_to_project(
    page: Page, live_server: str, request: pytest.FixtureRequest, tmp_path: Path
) -> None:
    first = _resolve_builtin_agent(live_server, "claude-native-ui")
    second = _resolve_builtin_agent(live_server, "codex-native-ui")
    root = tmp_path / "workspace"
    root.mkdir()
    with (
        httpx.Client(base_url=live_server, timeout=30) as client,
        isolated_host(
            tmp_path / "host", live_server, base_env={"PATH": os.environ["PATH"]}
        ) as host,
    ):
        host.wait_online(client)
        page.add_init_script(
            f"localStorage.setItem('omnigent:last-host-choice', {json.dumps(host.host_id)});"
        )
        created = client.post(
            "/v1/projects",
            json={
                "name": f"agent-default-{uuid.uuid4().hex[:8]}",
                "config": {
                    "agent_id": second["id"],
                    "host_id": host.host_id,
                    "workspace": str(root),
                },
            },
        )
        created.raise_for_status()
        project = created.json()
        try:
            page.route(
                "**/v1/hosts/*/harnesses/claude-native/model-options",
                lambda route: route.fulfill(
                    json={
                        "models": [
                            {"id": "opus", "displayName": "Opus"},
                            {"id": "sonnet", "displayName": "Sonnet"},
                        ]
                    }
                ),
            )
            page.goto(f"{live_server}/settings/general")
            control = page.get_by_test_id("settings-default-agent")
            picker = control.get_by_test_id("new-chat-landing-agent-select")
            expect(picker).to_be_enabled(timeout=30_000)
            picker.click()
            page.get_by_test_id(f"new-chat-landing-agent-{first['id']}").click()
            assert (
                page.evaluate("localStorage.getItem('omnigent:default-agent-id')") == first["id"]
            )
            models = page.get_by_test_id("settings-default-models")
            models.get_by_role("combobox", name="Model default harness", exact=True).click()
            page.get_by_role("option", name="Claude Code", exact=True).click()
            models.get_by_role("combobox", name="Default model", exact=True).click()
            page.get_by_role("option", name="Opus", exact=True).click()
            saved_models = page.evaluate(
                "JSON.parse(localStorage.getItem('omnigent:default-model-by-harness'))"
            )
            assert saved_models["claude-native"] == "opus"
            models.get_by_role("combobox", name="Model default harness", exact=True).click()
            page.get_by_role("option", name="Codex", exact=True).click()
            expect(
                models.get_by_role("combobox", name="Default model", exact=True)
            ).to_contain_text("Use last selected model")
            assert (
                page.evaluate("localStorage.getItem('omnigent:default-agent-id')") == first["id"]
            )
            page.screenshot(
                path=str(Path(request.config.getoption("output")) / "global-agent-setting.png"),
                animations="disabled",
            )
            page.goto(live_server + "/")
            selected = page.get_by_test_id("new-chat-landing-agent-select")
            expect(selected).to_have_attribute("aria-label", re.compile("Claude"), timeout=30_000)
            page.goto(f"{live_server}/?project={project['name']}")
            expect(selected).to_have_attribute("aria-label", re.compile("Codex"), timeout=30_000)
            assert (
                page.evaluate("localStorage.getItem('omnigent:default-agent-id')") == first["id"]
            )
        finally:
            deleted = client.delete(f"/v1/projects/{project['id']}")
            assert deleted.status_code in {200, 204}, deleted.text
