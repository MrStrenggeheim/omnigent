"""Attachment IDs in forks always address the fork's authorized file namespace."""

import json

from omnigent.stores.conversation_store.sqlalchemy_store import _remap_item_file_references


def test_native_and_tool_attachments_remap_to_fork_owned_files():
    native = {
        "item": {
            "type": "image_generation_call",
            "omnigent_attachments": [{"file_id": "old", "filename": "chart.png"}],
        }
    }
    tool = {
        "output": json.dumps(
            {
                "file_id": "old",
                "filename": "chart.png",
                "url": "/v1/sessions/source/resources/files/old/content",
            }
        )
    }
    for record in (native, tool):
        assert _remap_item_file_references(record, {"old": "new"}, "fork")
    assert native["item"]["omnigent_attachments"][0]["file_id"] == "new"
    assert json.loads(tool["output"])["url"] == "/v1/sessions/fork/resources/files/new/content"
