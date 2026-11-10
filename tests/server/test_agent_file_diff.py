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


def test_persisted_choices_scope_and_explicit_previous_turn_selection() -> None:
    from omnigent.server.agent_file_diff import recorded_agent_changes

    old_patch = (
        "diff --git a/inside/a b/inside/a\n--- a/inside/a\n+++ b/inside/a\n"
        "@@ -1 +1 @@\n-old\n+new\n"
    )
    new_patch = (
        "diff --git a/outside/b b/outside/b\n--- a/outside/b\n+++ /dev/null\n"
        "@@ -1 +0,0 @@\n-gone\n"
    )
    items = [*_turn("new", new_patch), *_turn("old", old_patch)]
    latest = recorded_agent_changes(items, "inside", "/workspace")
    assert latest["source"] == "agent" and latest["data"] == []
    assert [turn["id"] for turn in latest["turns"]] == ["new", "old"]
    assert all(turn["finished"] for turn in latest["turns"])
    selected = recorded_agent_changes(items, "inside", "/workspace", turn_id="old")
    assert [row["path"] for row in selected["data"]] == ["inside/a"]
    assert selected["data"][0]["lines_added"] == selected["data"][0]["lines_removed"] == 1
    assert recorded_turn_file_diff(items, "inside/a", "/workspace", "old")["patch"] == old_patch
    assert recorded_turn_file_diff(items, "inside/a", "/workspace", "new") is None
    assert recorded_agent_changes(items, "inside", "/workspace", turn_id="current")["data"] == []
    assert recorded_agent_changes([], "", "/workspace")["warning"].startswith("No captured")


def test_persisted_history_pagination_is_bounded_and_follows_descending_cursor() -> None:
    from types import SimpleNamespace

    from omnigent.server.agent_file_diff import read_recorded_turn_items

    class Store:
        def __init__(self):
            self.calls = []

        def list_items(self, session_id, *, limit, after, order):
            self.calls.append((session_id, limit, after, order))
            number = len(self.calls)
            return SimpleNamespace(
                data=_turn(str(number), "patch"), has_more=True, last_id=str(number)
            )

    store = Store()
    items, truncated = read_recorded_turn_items(store, "session")
    assert truncated and len(store.calls) == 8 and len(items) == 16
    assert store.calls[0] == ("session", 512, None, "desc")
    assert store.calls[-1] == ("session", 512, "7", "desc")


def test_recorded_turns_stop_at_the_workspace_boundary_without_relabeling_old_patches():
    from types import SimpleNamespace

    from omnigent.server.agent_file_diff import read_recorded_turn_items, recorded_agent_changes

    patch = (
        "diff --git a/same.txt b/same.txt\n--- a/same.txt\n+++ b/same.txt\n"
        "@@ -1 +1 @@\n-old\n+new\n"
    )
    current = _turn("current-root", patch)
    boundary = _turn("old-root", patch)
    store = SimpleNamespace(
        list_items=lambda *_args, **_kwargs: SimpleNamespace(
            data=[*current, *boundary], has_more=False, last_id=boundary[-1].id
        )
    )
    items, truncated = read_recorded_turn_items(store, "chat", after_item_id=boundary[0].id)
    assert items == current
    assert truncated is False
    changes = recorded_agent_changes(items, "", "/new-root", "session")
    assert [turn["id"] for turn in changes["turns"]] == ["current-root"]
    assert recorded_turn_file_diff(items, "same.txt", "/new-root", "old-root") is None
