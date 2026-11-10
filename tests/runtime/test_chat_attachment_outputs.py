"""Generated output persistence at the runtime/store boundary, without provider calls."""

from __future__ import annotations

import base64
from unittest.mock import Mock

import pytest

from omnigent.db.db_models import workspace_scope
from omnigent.entities.conversation import (
    ConversationItem,
    MessageData,
    NativeToolData,
    NewConversationItem,
)
from omnigent.runtime import _globals
from omnigent.runtime import chat_attachments as outputs
from omnigent.runtime.prompt import history_to_input_items
from omnigent.stores.artifact_store.local import LocalArtifactStore
from omnigent.stores.conversation_store.sqlalchemy_store import SqlAlchemyConversationStore
from omnigent.stores.file_store.sqlalchemy_store import SqlAlchemyFileStore
from tests._image_fixtures import _TINY_JPEG_BASE64, _TINY_PNG_BASE64, _TINY_WEBP_BASE64

SESSION = "79b22ebd2309e48fdeb450c65611d51b"
OTHER_SESSION = "c" * 32
TEXT = {"type": "output_text", "text": "The assistant's explanation survives."}


@pytest.fixture
def stores(db_uri, tmp_path, monkeypatch):
    # Real stores exercise ownership and publication order; only injected faults are mocked.
    files = SqlAlchemyFileStore(db_uri)
    artifacts = LocalArtifactStore(str(tmp_path / "generated"))
    monkeypatch.setattr(_globals, "_file_store", files)
    monkeypatch.setattr(_globals, "_artifact_store", artifacts)
    return files, artifacts


def _message(*blocks, role="assistant"):
    return NewConversationItem(
        type="message",
        response_id="turn",
        stable_id="b" * 32,
        data=MessageData(role=role, agent="assistant", content=list(blocks)),
    )


def _inline(data=b"original bytes", mime="application/octet-stream", filename="original.bin"):
    return {
        "type": "output_file",
        "file_data": f"data:{mime};base64,{base64.b64encode(data).decode()}",
        "filename": filename,
    }


def _native(payload=_TINY_PNG_BASE64, **extra):
    return NewConversationItem(
        type="native_tool",
        response_id="turn",
        data=NativeToolData(
            item={
                "type": "image_generation_call",
                "id": "ig_original",
                "status": "completed",
                "result": payload,
                **extra,
            }
        ),
    )


def _persisted(item):
    return ConversationItem(
        id="a" * 32,
        created_at=1,
        **item.model_dump(exclude={"stable_id", "replaces_pending_id"}),
    )


@pytest.mark.parametrize(
    "mime,data,filename,block_type",
    [
        ("image/png", base64.b64decode(_TINY_PNG_BASE64), "chart ü.png", "output_image"),
        ("image/jpeg", base64.b64decode(_TINY_JPEG_BASE64), "photo.jpg", "input_image"),
        (
            "image/svg+xml",
            b'<svg xmlns="http://www.w3.org/2000/svg"/>',
            "chart.svg",
            "output_file",
        ),
        ("application/pdf", b"%PDF-original", "report.pdf", "output_file"),
        ("text/plain;charset=utf-8", "Original ü\n".encode(), "notes.txt", "input_file"),
        ("application/octet-stream", bytes(range(256)), "original.bin", "output_file"),
        ("text/plain", b"", "empty.txt", "output_file"),
    ],
    ids=["png", "jpeg", "svg", "pdf", "text", "binary", "empty"],
)
def test_inline_outputs_keep_original_bytes_mime_and_text(
    stores, mime, data, filename, block_type
):
    files, artifacts = stores
    block = _inline(data, mime, filename)
    block["type"] = block_type
    if "image" in block_type:
        block["image_url"] = block.pop("file_data")
    original = _message(TEXT, block, TEXT)
    result = outputs.persist_generated_outputs(SESSION, [original])[0]
    assert result.stable_id == original.stable_id
    assert result.data.content[0] == result.data.content[2] == TEXT
    attached = result.data.content[1]
    record = files.get(attached["file_id"], session_id=SESSION)
    assert record is not None
    assert (record.filename, record.content_type, record.bytes) == (filename, mime, len(data))
    assert record.source_metadata == {"original": True, "delivery": "display"}
    assert artifacts.get(record.blob_key or record.id) == data
    assert files.get(record.id, session_id=OTHER_SESSION) is None
    assert original.data.content == [TEXT, block, TEXT]
    assert outputs.persist_generated_outputs(SESSION, [result]) == [result]
    replay = history_to_input_items([_persisted(result)])[0]["content"]
    assert replay == [TEXT, {"type": "output_text", "text": f"[Attached file: {filename}]"}, TEXT]


def test_ids_are_deterministic_for_canonical_session_and_workspace(stores):
    files, artifacts = stores
    original = _message(_inline())

    def attached(session_id):
        return outputs.persist_generated_outputs(session_id, [original])[0].data.content[0]

    first = attached(SESSION)
    assert attached(SESSION) == first
    dashed = "79b22ebd-2309-e48f-deb4-50c65611d51b"
    assert attached(dashed) == first
    assert len(files.list(SESSION).data) == 1
    assert attached(OTHER_SESSION)["file_id"] != first["file_id"]
    with workspace_scope(25):
        other_workspace = attached(SESSION)
        assert other_workspace["file_id"] != first["file_id"]
        assert files.get(first["file_id"], session_id=SESSION) is None
    assert artifacts.get(other_workspace["file_id"]) == b"original bytes"


@pytest.mark.parametrize(
    "uri,reason",
    [
        ("data:image/png;base64", "base64 data URI"),
        ("data:image/png,hello", "base64 data URI"),
        ("data:image/png;base64,%%%%", "invalid base64"),
        ("data:image/png;base64,ü", "invalid base64"),
        ("data:;base64,AAAA", "invalid MIME"),
        (None, "base64 data URI"),
        (42, "base64 data URI"),
        ("data:text/plain;charset=\x00;base64,AAAA", "invalid MIME"),
        ("data:image/png\r\nx-injected:yes;base64,AAAA", "invalid MIME"),
        ("data:" + "a" * 257 + ";base64,AAAA", "invalid MIME"),
    ],
)
def test_bad_inline_output_becomes_visible_text_and_other_attachments_survive(stores, uri, reason):
    files, _ = stores
    result = outputs.persist_generated_outputs(
        SESSION,
        [_message(TEXT, {"type": "output_image", "image_url": uri}, _inline(), TEXT)],
    )[0]
    blocks = result.data.content
    assert blocks[0] == blocks[3] == TEXT
    assert blocks[1]["type"] == "output_text"
    assert blocks[1]["text"].startswith("Attachment error:")
    assert reason in blocks[1]["text"]
    assert "file_id" in blocks[2]
    assert len(files.list(SESSION).data) == 1


@pytest.mark.parametrize("data", [b"12345", b"1234567"])
def test_decoded_and_encoded_limits_reject_without_publishing_rows(stores, monkeypatch, data):
    files, _ = stores
    monkeypatch.setattr(outputs, "_MAX_OUTPUT_BYTES", 4)
    result = outputs.persist_generated_outputs(SESSION, [_message(TEXT, _inline(data))])[0]
    assert result.data.content[0] == TEXT
    assert "exceeds 50 MB" in result.data.content[1]["text"]
    assert files.list(SESSION).data == []


@pytest.mark.parametrize("missing_store", ["_file_store", "_artifact_store"])
def test_missing_storage_has_visible_error_instead_of_retaining_inline_bytes(
    stores, monkeypatch, missing_store
):
    monkeypatch.setattr(_globals, missing_store, None)
    result = outputs.persist_generated_outputs(SESSION, [_message(TEXT, _inline())])[0]
    assert result.data.content[0] == TEXT
    assert "storage is unavailable" in result.data.content[1]["text"]
    assert "file_data" not in result.data.content[1]


@pytest.mark.parametrize("failure_point", ["put", "create", "get"])
def test_store_failures_preserve_text_without_unusable_rows(stores, monkeypatch, failure_point):
    files, artifacts = stores
    target = artifacts if failure_point == "put" else files
    monkeypatch.setattr(
        target, failure_point, Mock(side_effect=OSError("private storage path or credential"))
    )
    result = outputs.persist_generated_outputs(SESSION, [_message(TEXT, _inline(), TEXT)])[0]
    assert result.data.content[0] == result.data.content[2] == TEXT
    error = result.data.content[1]
    assert error["type"] == "output_text"
    assert "could not be saved" in error["text"]
    assert "private" not in error["text"]
    assert files.list(SESSION).data == []


def test_file_metadata_is_published_after_blob_and_concurrent_create_is_reused(
    stores, monkeypatch
):
    files, artifacts = stores
    create = files.create

    def raced_create(**kwargs):
        assert artifacts.get(kwargs["file_id"]) == b"original bytes"
        create(**kwargs)
        raise RuntimeError("Another append created this deterministic row")

    monkeypatch.setattr(files, "create", raced_create)
    result = outputs.persist_generated_outputs(SESSION, [_message(_inline())])[0]
    assert "file_id" in result.data.content[0]
    assert len(files.list(SESSION).data) == 1


def test_retry_repairs_missing_artifact_before_reusing_row(stores):
    files, artifacts = stores
    original = _message(_inline())
    first = outputs.persist_generated_outputs(SESSION, [original])[0]
    record = files.get(first.data.content[0]["file_id"], session_id=SESSION)
    artifacts.delete(record.blob_key)
    assert outputs.persist_generated_outputs(SESSION, [original])[0] == first
    assert artifacts.get(record.blob_key) == b"original bytes"


@pytest.mark.parametrize(
    "payload,mime,filename",
    [
        (_TINY_PNG_BASE64, "image/png", "generated-image.png"),
        (_TINY_JPEG_BASE64, "image/jpeg", "generated-image.jpg"),
        (_TINY_WEBP_BASE64, "image/webp", "generated-image.webp"),
    ],
    ids=["png", "jpeg", "webp"],
)
def test_native_images_detect_actual_mime_and_strip_client_metadata_on_replay(
    stores, payload, mime, filename
):
    files, artifacts = stores
    original = _native(payload, revised_prompt="original metadata")
    result = outputs.persist_generated_outputs(SESSION, [original])[0]
    native = result.data.item
    attachment = native["omnigent_attachments"][0]
    record = files.get(attachment["file_id"], session_id=SESSION)
    assert record.content_type == mime
    assert record.filename == filename
    assert artifacts.get(record.blob_key) == base64.b64decode(payload)
    assert history_to_input_items([_persisted(result)]) == [original.data.item]
    assert "omnigent_attachments" not in original.data.item
    assert outputs.persist_generated_outputs(SESSION, [result]) == [result]
    assert len(files.list(SESSION).data) == 1


@pytest.mark.parametrize("payload", ["%%%%", "", None, 42, {"invalid": "shape"}, "aGVsbG8="])
def test_bad_native_images_keep_other_messages_and_return_error_card(stores, payload):
    files, _ = stores
    text = _message(TEXT)
    result = outputs.persist_generated_outputs(SESSION, [text, _native(payload), text])
    assert result[0] == result[2] == text
    native = result[1].data.item
    error = native["omnigent_attachments"][0]
    assert error["error"].startswith("Attachment error:")
    assert "file_id" not in error
    assert "result" not in native
    assert files.list(SESSION).data == []
    assert "omnigent_attachments" not in history_to_input_items([_persisted(result[1])])[0]
    assert outputs.persist_generated_outputs(SESSION, result) == result


def test_native_oversize_is_bounded_and_artifact_failure_leaves_no_row(stores, monkeypatch):
    files, artifacts = stores
    put = Mock(side_effect=OSError("storage unavailable"))
    monkeypatch.setattr(artifacts, "put", put)
    result = outputs.persist_generated_outputs(SESSION, [_native()])[0]
    assert "could not be saved" in result.data.item["omnigent_attachments"][0]["error"]
    assert files.list(SESSION).data == []
    put.reset_mock()
    monkeypatch.setattr(outputs, "_MAX_OUTPUT_BYTES", 4)
    result = outputs.persist_generated_outputs(SESSION, [_native()])[0]
    assert "exceeds 50 MB" in result.data.item["omnigent_attachments"][0]["error"]
    put.assert_not_called()


def test_user_content_urls_markdown_and_pending_native_outputs_are_not_imported(stores):
    files, _ = stores
    user = _message(_inline(), role="user")
    message = _message(
        {"type": "output_text", "text": "![secret](/etc/passwd)"},
        {"type": "output_image", "image_url": "https://example.test/image.png"},
        {"type": "output_file", "file_id": "already-stored"},
    )
    pending = _native(None, status="in_progress")
    search = _native("ignored", type="web_search_call")
    items = [user, message, pending, search]
    assert outputs.persist_generated_outputs(SESSION, items) == items
    assert files.list(SESSION).data == []


@pytest.mark.parametrize("filename", [42, [], "a" * 513, "bad\x00name"])
def test_invalid_filenames_are_visible_errors_without_rows(stores, filename):
    files, _ = stores
    result = outputs.persist_generated_outputs(SESSION, [_message(_inline(filename=filename))])[0]
    assert "invalid filename" in result.data.content[0]["text"]
    assert files.list(SESSION).data == []


def test_conversation_append_persists_text_error_and_original_native_image(stores, db_uri):
    files, artifacts = stores
    conversations = SqlAlchemyConversationStore(db_uri)
    conversation = conversations.create_conversation(workspace="/original-workspace")
    appended = conversations.append(
        conversation.id,
        [
            _message(TEXT, {"type": "output_image", "image_url": "data:bad"}, _inline()),
            _native(),
        ],
    )
    reloaded = [conversations.get_item(conversation.id, item.id) for item in appended]
    assert reloaded == appended
    assert reloaded[0].data.content[0] == TEXT
    assert "Attachment error:" in reloaded[0].data.content[1]["text"]
    assert reloaded[0].data.resource_scope["workspace"] == "/original-workspace"
    attached = reloaded[1].data.item["omnigent_attachments"][0]
    record = files.get(attached["file_id"], session_id=conversation.id)
    assert artifacts.get(record.blob_key) == base64.b64decode(_TINY_PNG_BASE64)
    assert "omnigent_attachments" not in history_to_input_items(reloaded)[1]
