"""Persistent in-chat files and captured local Markdown paths through the real app."""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import pytest
from playwright.sync_api import Page, expect

from tests.e2e_ui.conftest import switch_markdown_view_mode
from tests.e2e_ui.files.test_workbench_ownership import Ownership, _open
from tests.e2e_ui.files.test_workbench_ownership import ownership as ownership


def _image_bytes():
    import io

    from PIL import Image, ImageDraw

    image = Image.new("RGB", (320, 180), "#f5f5f5")
    draw = ImageDraw.Draw(image)
    draw.text((20, 14), "Persistent chat attachment", fill="#252525")
    for left, top, right, bottom, color in [
        (30, 105, 80, 155, "#5577aa"),
        (110, 65, 160, 155, "#6688bb"),
        (190, 40, 240, 155, "#88aadd"),
    ]:
        draw.rectangle((left, top, right, bottom), fill=color)
    output = io.BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


_PNG = _image_bytes()


def _say(ownership: Ownership, text: str):
    response = ownership.client.post(
        f"/v1/sessions/{ownership.chats[0]}/events",
        json={
            "type": "external_assistant_message",
            "data": {"agent": "hello_world", "text": text},
        },
    )
    response.raise_for_status()


@pytest.mark.parametrize("mobile", [False, True], ids=["desktop", "phone"])
def test_chat_attachments_preview_download_and_persist(
    page: Page, ownership: Ownership, tmp_path: Path, mobile: bool
):
    chat = ownership.chats[0]
    source = tmp_path / "generated ü.png"
    source.write_bytes(_PNG)
    isolated = tmp_path / "cli-config"
    isolated.mkdir()
    env = {**os.environ, "OMNIGENT_CONFIG_HOME": str(isolated), "OMNIGENT_DATA_DIR": str(isolated)}
    cli = subprocess.run(
        [
            str(Path.cwd() / ".venv/bin/omnigent"),
            "attach-file",
            str(source),
            "--session",
            chat,
            "--server",
            ownership.base,
        ],
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert cli.returncode == 0, cli.stderr
    attached = json.loads(cli.stdout.strip().splitlines()[-1])
    source.unlink()
    uploaded = ownership.client.post(
        f"/v1/sessions/{chat}/resources/files?presentation=true",
        files={"file": ("uploaded notes.txt", b"Uploaded text remains readable", "text/plain")},
    )
    uploaded.raise_for_status()
    mirror = ownership.client.post(
        f"/v1/sessions/{chat}/events",
        json={
            "type": "external_conversation_item",
            "data": {
                "item_type": "message",
                "item_data": {
                    "role": "user",
                    "content": [
                        {
                            "type": "input_file",
                            "file_id": uploaded.json()["id"],
                            "filename": "uploaded notes.txt",
                        }
                    ],
                },
                "response_id": "attachment-test",
            },
        },
    )
    mirror.raise_for_status()
    html = ownership.client.post(
        f"/v1/sessions/{chat}/attachments",
        files={
            "file": (
                "isolated.html",
                b"<h1>Preview heading</h1><script>parent.attachmentPwned=true</script>",
                "text/html",
            )
        },
    )
    html.raise_for_status()
    _open(page, ownership)
    if mobile:
        page.set_viewport_size({"width": 390, "height": 844})
        page.keyboard.press("ControlOrMeta+b")
        page.keyboard.press("ControlOrMeta+i")
    image = page.get_by_role("img", name="generated ü.png", exact=True)
    expect(image).to_be_visible(timeout=30000)
    page.get_by_role("button", name="Zoom image: generated ü.png", exact=True).click()
    expect(page.get_by_role("dialog")).to_be_visible()
    page.keyboard.press("Escape")
    with page.expect_download() as download:
        page.get_by_role("button", name="Download generated ü.png", exact=True).click()
    assert Path(download.value.path()).read_bytes() == _PNG
    page.get_by_role("button", name="uploaded notes.txt", exact=True).click()
    expect(page.get_by_role("dialog")).to_contain_text("Uploaded text remains readable")
    page.keyboard.press("Escape")
    page.get_by_role("button", name="isolated.html", exact=True).click()
    frame = page.locator('iframe[title="isolated.html"]')
    expect(frame).to_have_attribute("sandbox", "")
    expect(
        page.frame_locator('iframe[title="isolated.html"]').get_by_role(
            "heading", name="Preview heading"
        )
    ).to_be_visible()
    assert page.evaluate("window.attachmentPwned") is None
    page.keyboard.press("Escape")
    page.reload()
    expect(page.get_by_role("img", name="generated ü.png", exact=True)).to_be_visible(
        timeout=30000
    )
    assert (
        ownership.client.get(
            f"/v1/sessions/{chat}/resources/files/{attached['file_id']}/content"
        ).content
        == _PNG
    )


def test_local_markdown_image_and_table_math_use_captured_workspace(
    page: Page, ownership: Ownership
):
    root = ownership.roots[0]
    path = root / "chart space ü.png"
    path.write_bytes(_PNG)
    text = "\n".join(
        [
            "![chart](chart%20space%20%C3%BC.png)",
            "",
            "| Choice | Meaning |",
            "| --- | --- |",
            r"| Absolute: $$|\hat y-y|$$ | Linear penalty |",
            r"| Squared: $$\frac12(\hat y-y)^2$$ | Larger penalties |",
        ]
    )
    _say(ownership, text)
    _open(page, ownership)
    expect(page.get_by_role("img", name=path.name, exact=True)).to_be_visible(timeout=30000)
    table = page.locator('[data-role="assistant"] table').filter(has_text="Absolute")
    expect(table.locator("tbody tr")).to_have_count(2)
    expect(table.locator("tbody tr").first.locator("td")).to_have_count(2)
    expect(table.locator(".katex")).to_have_count(2)
    assert "$$" not in table.inner_text()
    from tests.e2e_ui.files.test_chat_workspace_switch import _choose_workspace

    _choose_workspace(page, ownership.roots[1])
    path.unlink()
    page.reload()
    expect(page.get_by_role("img", name=path.name, exact=True)).to_be_visible(timeout=30000)
    assert (
        page.get_by_role("img", name=path.name, exact=True).evaluate("image => image.naturalWidth")
        == 320
    )


@pytest.mark.parametrize("mobile", [False, True], ids=["desktop", "phone"])
def test_preview_selection_comments_and_annotated_chat_draft(
    page: Page, ownership: Ownership, mobile: bool
):
    path = "review.md"
    raw = "# Preview review\n\nRepeated **target** first.\n\nRepeated **target** second.\n"
    (ownership.roots[0] / path).write_text(raw)
    page.set_viewport_size({"width": 390 if mobile else 1600, "height": 900})
    page.goto(f"{ownership.base}/c/{ownership.chats[0]}?file={path}")
    viewer = page.get_by_test_id("file-viewer").filter(visible=True)
    expect(viewer).to_be_visible(timeout=30000)
    expect(viewer.get_by_text("Preview review", exact=True)).to_be_visible()
    switch_markdown_view_mode(page, viewer, "Preview")
    preview = viewer.locator(".markdown-preview")
    expect(preview).to_be_visible()
    target = preview.locator("strong").last
    target.select_text()
    page.mouse.up()
    page.get_by_role("menuitem", name="Ask in chat", exact=True).click()
    if mobile:
        page.get_by_role("button", name="Close file viewer", exact=True).click()
    expect(page.locator(".chat-composer-form")).to_contain_text("Annotation from review.md")
    expect(page.locator(".chat-composer-form")).to_contain_text("target")
    # Ask only prepares a draft; it never sends the selected text automatically.
    items = ownership.client.get(f"/v1/sessions/{ownership.chats[0]}/items").json()["data"]
    assert not any(item.get("role") == "user" and "Annotation from" in str(item) for item in items)
    if mobile:
        page.goto(f"{ownership.base}/c/{ownership.chats[0]}?file={path}")
        viewer = page.get_by_test_id("file-viewer").filter(visible=True)
        switch_markdown_view_mode(page, viewer, "Preview")
        preview = viewer.locator(".markdown-preview")
    preview.locator("strong").last.select_text()
    page.mouse.up()
    page.get_by_role("menuitem", name="Add comment", exact=True).click()
    editor = viewer.get_by_placeholder("Add a comment…")
    editor.fill("Review the second occurrence.")
    viewer.get_by_role("button", name="Add Comment", exact=True).click()
    comments = ownership.client.get(
        f"/v1/sessions/{ownership.chats[0]}/comments", params={"path": path}
    ).json()
    assert comments[0]["start_index"] == raw.rfind("target")
    assert comments[0]["anchor_content"] == "target"


@pytest.mark.timeout(240)
def test_codex_viewed_image_becomes_a_persistent_chat_attachment(
    page: Page, live_server: str, mock_llm_server_url: str, tmp_path: Path
):
    import shutil

    import httpx

    from tests._helpers.host import isolated_host
    from tests._helpers.native_session import create_native_session
    from tests.e2e_ui.conftest import (
        _CODEX_MOCK_MODEL,
        configure_mock_llm,
        reset_mock_llm,
        set_fallback_mock_llm,
    )
    from tests.e2e_ui.messages.test_message_render_parity import (
        _ASSISTANT,
        _ensure_chat_view,
        _send,
    )

    if shutil.which("codex") is None:
        pytest.skip("Codex CLI required")
    root = tmp_path / "native-workspace"
    root.mkdir()
    image = root / "native-chart.png"
    image.write_bytes(_PNG)
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
            tmp_path / "native-host",
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
            metadata={"host_id": host.host_id, "workspace": str(root)},
        )
        chat = session["session_id"]
        try:
            page.goto(f"{live_server}/c/{chat}?view=chat")
            _ensure_chat_view(page)
            reset_mock_llm(mock_llm_server_url)
            set_fallback_mock_llm(mock_llm_server_url, _CODEX_MOCK_MODEL, "")
            marker = "NATIVEATTACHMENTPROOF"
            configure_mock_llm(
                mock_llm_server_url,
                [
                    {
                        "tool_calls": [
                            {
                                "call_id": "view-native-file",
                                "name": "view_image",
                                "arguments": json.dumps({"path": str(image)}),
                            }
                        ]
                    },
                    {"text": "Native attachment complete"},
                ],
                key=marker,
                match=marker,
                required_tools=["view_image"],
            )
            _send(page, f"Look at the local image and reply Native attachment complete. {marker}")
            expect(
                page.locator(_ASSISTANT, has_text="Native attachment complete").first
            ).to_be_visible(timeout=180000)
            expect(page.get_by_role("img", name="native-chart.png", exact=True)).to_be_visible(
                timeout=30000
            )
            image.unlink()
            page.reload()
            expect(page.get_by_role("img", name="native-chart.png", exact=True)).to_be_visible(
                timeout=30000
            )
            files = client.get(f"/v1/sessions/{chat}/resources/files").json()["data"]
            stored = next(record for record in files if record["name"] == "native-chart.png")
            assert (
                client.get(f"/v1/sessions/{chat}/resources/files/{stored['id']}/content").content
                == _PNG
            )
        finally:
            client.delete(f"/v1/sessions/{chat}")
