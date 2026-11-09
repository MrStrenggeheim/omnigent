"""Reuse Explorer journeys on a real host independently of the active chat's runner."""

import os

import httpx
from playwright.sync_api import Page

from tests._helpers.host import isolated_host
from tests.e2e_ui.files.test_explorer_file_operations import (
    test_explorer_manages_files_transfers_and_recovery as explorer_journey,
)
from tests.e2e_ui.files.test_explorer_file_operations import (
    test_workspace_search_replace_preview_and_undo as replacement_journey,
)


def test_host_workspace_explorer_and_replacement(
    page: Page, seeded_session, tmp_path, monkeypatch
):
    base, session_id = seeded_session
    root = tmp_path / "independent-files"
    root.mkdir()
    with (
        isolated_host(tmp_path / "host", base, base_env={"PATH": os.environ["PATH"]}) as host,
        httpx.Client(base_url=base) as client,
    ):
        host.wait_online(client)
        response = client.post(
            "/v1/workbench-workspaces", json={"host_id": host.host_id, "root": str(root)}
        )
        response.raise_for_status()
        workspace = response.json()
        assert workspace["available"] is True
        assert workspace["source_session_id"] is None
        owner = workspace["owner_user_id"] or "local"
        page.add_init_script(
            "localStorage.setItem("
            + repr(f"omnigent:workbench-selection:{owner}")
            + ", "
            + repr(workspace["id"])
            + ")"
        )
        source = f"{base}/v1/sessions/{session_id}/resources/"
        target = f"{base}/v1/workbench-workspaces/{workspace['id']}/resources/"
        original_get, original_put = httpx.get, httpx.put

        def workspace_get(url, **kwargs):
            return original_get(url.replace(source, target), **kwargs)

        def workspace_put(url, **kwargs):
            return original_put(url.replace(source, target), **kwargs)

        # Existing journey setup/assertions address the selected workspace too.
        monkeypatch.setattr(httpx, "get", workspace_get)
        monkeypatch.setattr(httpx, "put", workspace_put)
        observed = []
        page.on("request", lambda request: observed.append(request.url))
        explorer_journey(page, seeded_session, tmp_path)
        replacement_journey(page, seeded_session, mobile=False)
        replacement_journey(page, seeded_session, mobile=True)
        assert any(target in url and "filesystem-operations" in url for url in observed)
        assert any(target in url and "content-replace" in url for url in observed)
        assert (root / "search.txt").read_text() == "alpha fox alpha\nuntouched\n"
