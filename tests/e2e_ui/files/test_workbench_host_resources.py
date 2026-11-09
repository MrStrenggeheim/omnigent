"""Reuse Explorer journeys on a real host independently of the active chat's runner."""

import os

import httpx
from playwright.sync_api import Page

from tests._helpers.host import isolated_host
from tests._helpers.session import post_session_bundle
from tests.e2e_ui.conftest import _build_hello_world_bundle
from tests.e2e_ui.files.test_explorer_file_operations import (
    test_explorer_manages_files_transfers_and_recovery as explorer_journey,
)
from tests.e2e_ui.files.test_explorer_file_operations import (
    test_workspace_search_replace_preview_and_undo as replacement_journey,
)


def test_host_workspace_explorer_and_replacement(
    page: Page, seeded_session, tmp_path, monkeypatch
):
    base, _ = seeded_session
    root = tmp_path / "independent-files"
    root.mkdir()
    with (
        isolated_host(tmp_path / "host", base, base_env={"PATH": os.environ["PATH"]}) as host,
        httpx.Client(base_url=base) as client,
    ):
        host.wait_online(client)
        response = post_session_bundle(
            client.post,
            "/v1/sessions",
            _build_hello_world_bundle(),
            metadata={"host_id": host.host_id, "workspace": str(root)},
        )
        response.raise_for_status()
        session_id = response.json()["session_id"]
        resolved = client.post("/v1/workbench-workspaces/resolve", json={"session_id": session_id})
        resolved.raise_for_status()
        workspace = resolved.json()
        assert workspace["root"] == str(root)
        assert workspace["available"] is True
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
        explorer_journey(page, (base, session_id), tmp_path)
        replacement_journey(page, (base, session_id), mobile=False)
        replacement_journey(page, (base, session_id), mobile=True)
        assert any(target in url and "filesystem-operations" in url for url in observed)
        assert any(target in url and "content-replace" in url for url in observed)
        assert (root / "search.txt").read_text() == "alpha fox alpha\nuntouched\n"
