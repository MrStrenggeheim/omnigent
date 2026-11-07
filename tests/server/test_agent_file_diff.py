"""Recorded turn diffs remain distinct from current files and older turns."""

from omnigent.entities import ConversationItem
from omnigent.server.agent_file_diff import recorded_turn_file_diff


def _turn(response: str, patch: str) -> list[ConversationItem]:
    call = f"codex_turn_diff_{response}"
    return [
        ConversationItem(
            id=f"out_{response}",
            type="function_call_output",
            status="completed",
            response_id=response,
            created_at=1,
            data={"call_id": call, "output": patch},
        ),
        ConversationItem(
            id=f"call_{response}",
            type="function_call",
            status="completed",
            response_id=response,
            created_at=1,
            data={"agent": "codex", "name": "turn_diff", "call_id": call, "arguments": "{}"},
        ),
    ]


def test_recorded_patch_selects_one_file_and_preserves_turn_identity() -> None:
    first = "diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+new\n"
    second = (
        "diff --git a/b.txt b/b.txt\n--- a/b.txt\n+++ b/b.txt\n@@ -1 +1 @@\n-other\n+changed\n"
    )
    record = recorded_turn_file_diff(_turn("turn2", first + second), "a.txt", "/workspace")
    assert record is not None
    assert record["patch"] == first
    assert record["turn_id"] == "turn2"
    assert record["before"] is record["after"] is None
    assert recorded_turn_file_diff(_turn("turn2", second), "a.txt", "/workspace") is None


def test_newer_turn_without_patch_does_not_reuse_an_older_turn() -> None:
    old = _turn("old", "diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-a\n+b\n")
    newer = ConversationItem(
        id="newcall",
        type="function_call",
        status="completed",
        response_id="new",
        created_at=2,
        data={
            "agent": "codex",
            "name": "commandExecution",
            "call_id": "newcall",
            "arguments": "{}",
        },
    )
    assert recorded_turn_file_diff([newer, *old], "a", "/workspace") is None


def test_quoted_paths_work_and_hunk_content_is_not_a_header() -> None:
    patch = (
        'diff --git "a/with space.txt" "b/with space.txt"\n'
        '--- "a/with space.txt"\n+++ "b/with space.txt"\n'
        "@@ -1 +1 @@\n--- other.txt\n+after\n"
    )
    record = recorded_turn_file_diff(_turn("t", patch), "/workspace/with space.txt", "/workspace")
    assert record is not None and record["patch"] == patch
    assert recorded_turn_file_diff(_turn("t", patch), "other.txt", "/workspace") is None


def test_new_user_turn_does_not_display_the_previous_patch() -> None:
    user = ConversationItem(
        id="new-user",
        type="message",
        status="completed",
        response_id="request",
        created_at=2,
        data={"role": "user", "content": [{"type": "input_text", "text": "Next"}]},
    )
    old = _turn("old", "diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-a\n+b\n")
    assert recorded_turn_file_diff([user, *old], "a", "/workspace") is None


def test_rename_only_patch_remains_available_for_the_new_path() -> None:
    patch = (
        "diff --git a/old.txt b/new.txt\nsimilarity index 100%\n"
        "rename from old.txt\nrename to new.txt\n"
    )
    result = recorded_turn_file_diff(_turn("t", patch), "new.txt", "/workspace")
    assert result is not None and result["patch"] == patch
