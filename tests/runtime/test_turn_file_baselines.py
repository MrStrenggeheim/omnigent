"""Prospective baselines preserve uncertainty and turn boundaries."""

from pathlib import Path

import pytest

from omnigent.runtime.turn_file_baselines import TurnFileBaselines


def test_successive_turns_keep_distinct_turn_and_session_preimages(tmp_path: Path) -> None:
    history = TurnFileBaselines(tmp_path)
    history.begin("session", "one")
    history.capture("session", "file", "A", known=True)
    assert history.lookup("session", "file", last_turn=True) is None
    history.record("session", "file", "modified")
    history.capture("session", "file", "B", known=True)
    history.record("session", "file", "modified")
    history.finish("session")
    history.begin("session", "two")
    history.capture("session", "file", "B", known=True)
    history.record("session", "file", "modified")
    current = history.lookup("session", "file", last_turn=True)
    session = history.lookup("session", "file", last_turn=False)
    assert current is not None and session is not None
    assert (current["before"], current["turn_id"], current["finished"]) == ("B", "two", False)
    assert (session["before"], session["turn_id"]) == ("A", "one")
    assert current["coverage"] == "observed_tools"
    history.finish("session")
    assert history.lookup("session", "file", True)["finished"] is True


def test_no_implicit_turn_and_empty_turn_does_not_inherit_changes(tmp_path: Path) -> None:
    history = TurnFileBaselines(tmp_path)
    history.capture("session", "file", "old", True)
    history.record("session", "file", "modified")
    assert history.lookup("session", "file", True) is None
    history.begin("session", "one")
    history.record("session", "file", "created")
    history.begin("session", "two")
    assert history.lookup("session", "file", True) is None
    assert history.lookup("session", "file", False)["known"] is True


def test_begin_replays_and_late_capture_do_not_reset_completed_turn(tmp_path: Path) -> None:
    history = TurnFileBaselines(tmp_path)
    history.begin("session", "one")
    history.capture("session", "file", "before", True)
    history.record("session", "file", "modified")
    history.begin("session", "one")
    history.finish("session")
    history.begin("session", "one")
    history.capture("session", "file", "after", True)
    history.record("session", "other", "created")
    result = history.lookup("session", "file", True)
    assert result is not None and result["before"] == "before" and result["finished"]
    assert history.lookup("session", "other", True) is None


@pytest.mark.parametrize("operation", ["modified", "deleted"])
def test_missing_preimage_stays_unknown_after_later_capture(
    tmp_path: Path, operation: str
) -> None:
    history = TurnFileBaselines(tmp_path)
    history.begin("session", "one")
    history.record("session", "file", operation)
    history.capture("session", "file", "too late", True)
    result = history.lookup("session", "file", True)
    assert result is not None
    assert (result["known"], result["before"], result["reason"]) == (
        False,
        None,
        "preimage_unavailable",
    )
    history.begin("session", "two")
    history.capture("session", "file", "new preimage", True)
    history.record("session", "file", "modified")
    assert history.lookup("session", "file", True)["known"] is True
    assert history.lookup("session", "file", False)["known"] is False


@pytest.mark.parametrize("explicit_unknown", [False, True])
def test_creation_proves_absence_only_without_explicit_capture(
    tmp_path: Path, explicit_unknown: bool
) -> None:
    history = TurnFileBaselines(tmp_path)
    history.begin("session", "one")
    if explicit_unknown:
        history.capture("session", "file", None, False)
    history.record("session", "file", "created")
    history.capture("session", "file", "new file", True)
    history.record("session", "file", "deleted")
    result = history.lookup("session", "file", True)
    assert result is not None
    assert result["before"] is None and result["known"] is not explicit_unknown
    assert result["operation"] == "deleted"


def test_failed_attempt_is_invisible_and_retry_captures_fresh_content(tmp_path: Path) -> None:
    history = TurnFileBaselines(tmp_path)
    history.begin("session", "one")
    history.capture("session", "file", "failed attempt", True)
    history.capture("session", "file", "fresh retry", True)
    history.record("session", "file", "modified")
    history.capture("session", "failed", "not changed", True)
    history.finish("session")
    assert history.lookup("session", "file", True)["before"] == "fresh retry"
    assert history.lookup("session", "failed", True) is None
    assert history.lookup("session", "failed", False) is None


def test_normalization_workspace_and_session_isolation(tmp_path: Path) -> None:
    left = TurnFileBaselines(tmp_path / "left")
    right = TurnFileBaselines(tmp_path / "right")
    for history, text in [(left, "left"), (right, "right")]:
        history.begin("same-session", "turn")
        history.capture("same-session", "dir/../file", text, True)
        history.record("same-session", str(history.workspace_root / "file"), "modified")
        assert history.lookup("same-session", "file", True)["before"] == text
        assert history.lookup("different-session", "file", True) is None
        assert history.lookup("same-session", "../file", True) is None
    left.forget("same-session")
    assert left.lookup("same-session", "file", True) is None
    assert right.lookup("same-session", "file", True)["before"] == "right"


def test_byte_limits_preserve_unknown_without_truncation(tmp_path: Path) -> None:
    history = TurnFileBaselines(tmp_path, max_file_bytes=4, max_session_bytes=6)
    history.begin("session", "one")
    for path, text in [("first", "1234"), ("large", "ééé"), ("total", "123")]:
        history.capture("session", path, text, True)
        history.record("session", path, "modified")
    assert history.lookup("session", "first", True)["before"] == "1234"
    for path, reason in [("large", "file_limit"), ("total", "session_limit")]:
        result = history.lookup("session", path, True)
        assert result is not None
        assert (result["known"], result["before"], result["reason"]) == (False, None, reason)


def test_two_turn_retention_releases_unreferenced_contents(tmp_path: Path) -> None:
    history = TurnFileBaselines(tmp_path, max_file_bytes=4, max_session_bytes=12)
    for number, text in enumerate(["AAAA", "BBBB", "CCCC", "DDDD"], 1):
        history.begin("session", str(number))
        history.capture("session", "file", text, True)
        history.record("session", "file", "modified")
        assert history.lookup("session", "file", True)["before"] == text
    assert history.lookup("session", "file", False)["before"] == "AAAA"


def test_session_and_path_caps_bound_metadata(tmp_path: Path) -> None:
    history = TurnFileBaselines(tmp_path, max_sessions=1, max_paths=1)
    history.begin("old", "one")
    history.record("old", "file", "created")
    history.begin("new", "one")
    history.record("new", "file", "created")
    history.record("new", "overflow", "created")
    assert history.lookup("old", "file", True) is None
    assert history.lookup("new", "file", True) is not None
    assert history.lookup("new", "overflow", True) is None


def test_invalid_operation_does_not_record_a_mutation(tmp_path: Path) -> None:
    history = TurnFileBaselines(tmp_path)
    history.begin("session", "one")
    with pytest.raises(ValueError, match="Unsupported file operation"):
        history.record("session", "file", "renamed")
    assert history.lookup("session", "file", True) is None


def test_last_turn_after_image_is_frozen_across_external_edits_and_later_turns(
    tmp_path: Path,
) -> None:
    history = TurnFileBaselines(tmp_path)
    file = tmp_path / "file"
    history.begin("session", "one")
    history.capture("session", "file", "A", True)
    file.write_text("B")
    history.record("session", "file", "modified")
    history.finish("session")
    file.write_text("external")
    first = history.lookup("session", "file", True)
    assert first is not None
    assert (first["before"], first["after"], first["after_known"]) == ("A", "B", True)
    history.begin("session", "two")
    history.capture("session", "file", "external", True)
    file.write_text("C")
    history.record("session", "file", "modified")
    history.finish("session")
    file.write_text("later")
    second = history.lookup("session", "file", True)
    assert second is not None
    assert (second["before"], second["after"], second["after_known"]) == ("external", "C", True)
    assert first["after"] == "B"
    session = history.lookup("session", "file", False)
    assert session is not None and session["before"] == "A" and session["after_known"] is False


def test_repeated_success_updates_after_until_finish_and_deletion_is_known_absent(
    tmp_path: Path,
) -> None:
    history = TurnFileBaselines(tmp_path)
    history.begin("session", "one")
    file = tmp_path / "file"
    file.write_text("created")
    history.record("session", "file", "created")
    file.write_text("edited")
    history.record("session", "file", "modified")
    assert history.lookup("session", "file", True)["after"] == "edited"
    file.unlink()
    history.record("session", "file", "deleted")
    history.finish("session")
    result = history.lookup("session", "file", True)
    assert result is not None
    assert (result["known"], result["before"], result["after_known"], result["after"]) == (
        True,
        None,
        True,
        None,
    )


@pytest.mark.parametrize("kind", ["symlink", "directory", "binary", "large"])
def test_unsafe_or_unrepresentable_after_image_is_explicitly_unknown(
    tmp_path: Path, kind: str
) -> None:
    history = TurnFileBaselines(tmp_path, max_file_bytes=4)
    file = tmp_path / "file"
    if kind == "symlink":
        (tmp_path / "target").write_text("safe")
        file.symlink_to("target")
    elif kind == "directory":
        file.mkdir()
    elif kind == "binary":
        file.write_bytes(b"\xff")
    else:
        file.write_text("12345")
    history.begin("session", "one")
    history.capture("session", "file", "old", True)
    history.record("session", "file", "modified")
    result = history.lookup("session", "file", True)
    assert result is not None
    assert result["after_known"] is False and result["after"] is None
    assert result["after_reason"] is not None


def test_after_image_counts_toward_session_budget_and_is_replaced_not_accumulated(
    tmp_path: Path,
) -> None:
    history = TurnFileBaselines(tmp_path, max_file_bytes=4, max_session_bytes=6)
    history.begin("session", "one")
    file = tmp_path / "file"
    history.capture("session", "file", "1234", True)
    file.write_text("123")
    history.record("session", "file", "modified")
    assert history.lookup("session", "file", True)["after_reason"] == "after_session_limit"
    file.write_text("12")
    history.record("session", "file", "modified")
    assert history.lookup("session", "file", True)["after"] == "12"
    file.write_text("34")
    history.record("session", "file", "modified")
    assert history.lookup("session", "file", True)["after"] == "34"


@pytest.mark.parametrize(
    ("known", "before", "operations", "expected"),
    [
        (True, None, ["created", "modified"], "created"),
        (True, None, ["created", "deleted"], None),
        (True, "old", ["deleted"], "deleted"),
        (True, "", ["deleted", "created"], "modified"),
        (False, None, ["modified", "created"], "created"),
        (False, None, ["created", "deleted"], "deleted"),
    ],
)
def test_agent_listing_uses_first_session_baseline_and_last_operation(
    tmp_path: Path, known: bool, before: str | None, operations: list[str], expected: str | None
) -> None:
    history = TurnFileBaselines(tmp_path)
    for index, operation in enumerate(operations):
        history.begin("session", str(index))
        if index == 0:
            history.capture("session", "dir/file", before, known)
        history.record("session", "dir/file", operation)
        history.finish("session")
    rows = history.list_files("session")
    assert [row["status"] for row in rows] == ([] if expected is None else [expected])
    if rows:
        assert rows[0]["path"] == "dir/file" and rows[0]["name"] == "file"
        assert rows[0]["lines_added"] is None and rows[0]["lines_removed"] is None
    assert history.list_files("other-session") == []


def test_agent_listing_metadata_is_recorded_and_sorted_without_rechecking_disk(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from omnigent.runtime import turn_file_baselines

    history = TurnFileBaselines(tmp_path)
    history.begin("session", "one")
    history.capture("session", "pending", "failed attempt", True)
    for timestamp, path, text in [
        (10, "first", "one"),
        (20, "second", "two"),
        (30, "first", "new"),
    ]:
        (tmp_path / path).write_text(text)
        monkeypatch.setattr(
            turn_file_baselines.time, "time", lambda timestamp=timestamp: timestamp
        )
        history.record("session", path, "modified")
    history.finish("session")
    (tmp_path / "first").write_text("unattributed external edit")
    rows = history.list_files("session")
    assert [(row["path"], row["modified_at"], row["bytes"]) for row in rows] == [
        ("first", 30, 3),
        ("second", 20, 3),
    ]
    rows[0]["status"] = "deleted"
    assert history.list_files("session")[0]["status"] == "modified"
