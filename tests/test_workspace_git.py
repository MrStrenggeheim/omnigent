"""Real Git scenarios for the standalone, read-only workspace inspector."""

from __future__ import annotations

import inspect
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from omnigent.runtime.workspace_git import WORKSPACE_GIT_SCRIPT, inspect_workspace_git


def git(repository: Path, *args: str) -> str:
    env = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
    return subprocess.check_output(
        [
            "git",
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.com",
            "-c",
            "core.hooksPath=/dev/null",
            *args,
        ],
        cwd=repository,
        env=env,
        stderr=subprocess.PIPE,
        text=True,
    ).strip()


def init_repo(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    git(path, "init", "-b", "main")
    (path / "tracked.txt").write_text("original\n")
    git(path, "add", ".")
    git(path, "commit", "-m", "initial")
    return path


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    return init_repo(tmp_path / "repository")


def test_changes_current_status_and_disappearing_untracked_artifacts(repo: Path) -> None:
    (repo / "tracked.txt").write_text("modified\n")
    (repo / "new.txt").write_text("new\n")
    transient = repo / "transient"
    transient.mkdir()
    (transient / "gone.txt").write_text("gone\n")
    assert len(inspect_workspace_git(str(repo), {"operation": "changes"})["data"]) == 3
    (transient / "gone.txt").unlink()
    transient.rmdir()

    result = inspect_workspace_git(
        str(repo),
        {
            "operation": "changes",
            "path": str(repo),
            "directories": [],
            "base": "HEAD",
            "target": "WORKTREE",
        },
    )

    assert result["object"] == "list"
    assert result["has_more"] is False
    assert result["repositories"] == [str(repo)]
    assert [(record["path"], record["status"]) for record in result["data"]] == [
        ("new.txt", "created"),
        ("tracked.txt", "modified"),
    ]
    assert result["data"][0] == {
        "object": "session.environment.filesystem.entry",
        "path": "new.txt",
        "name": "new.txt",
        "status": "created",
        "bytes": 4,
        "modified_at": int((repo / "new.txt").stat().st_mtime),
        "lines_added": None,
        "lines_removed": None,
        "repository": str(repo),
    }
    assert (result["data"][1]["lines_added"], result["data"][1]["lines_removed"]) == (1, 1)
    (repo / "tracked.txt").unlink()
    deleted = inspect_workspace_git(str(repo), {"operation": "changes"})["data"][1]
    assert deleted["status"] == "deleted"
    assert deleted["bytes"] is deleted["modified_at"] is None
    assert (deleted["lines_added"], deleted["lines_removed"]) == (0, 1)


def test_staged_addition_deleted_in_worktree_is_deleted(repo: Path) -> None:
    (repo / "staged.txt").write_text("staged\n")
    git(repo, "add", "staged.txt")
    (repo / "staged.txt").unlink()
    assert git(repo, "status", "--porcelain") == "AD staged.txt"
    result = inspect_workspace_git(str(repo), {"operation": "changes"})
    assert [(record["path"], record["status"]) for record in result["data"]] == [
        ("staged.txt", "deleted"),
    ]


def test_nul_status_handles_renames_and_literal_filenames(repo: Path) -> None:
    (repo / "binary.bin").write_bytes(b"before\0")
    git(repo, "add", "binary.bin")
    git(repo, "commit", "-m", "binary baseline")
    renamed = 'renamed -> "name"\nü.txt'
    git(repo, "mv", "tracked.txt", renamed)
    (repo / "binary.bin").write_bytes(b"after\0")
    (repo / "untracked\nü.txt").write_text("untracked\n")
    result = inspect_workspace_git(str(repo), {"operation": "changes"})
    assert [(record["path"], record["status"]) for record in result["data"]] == [
        ("binary.bin", "modified"),
        (renamed, "modified"),
        ("untracked\nü.txt", "created"),
    ]
    by_path = {record["path"]: record for record in result["data"]}
    assert (by_path[renamed]["lines_added"], by_path[renamed]["lines_removed"]) == (0, 0)
    assert by_path["binary.bin"]["lines_added"] is by_path["binary.bin"]["lines_removed"] is None


def test_discovery_is_explicit_deduplicated_and_scoped(tmp_path: Path) -> None:
    first = init_repo(tmp_path / "first")
    second = init_repo(tmp_path / "second")
    (first / "tracked.txt").write_text("one\n")
    (second / "tracked.txt").write_text("two\n")
    undiscovered = inspect_workspace_git(str(tmp_path), {"operation": "changes"})
    assert undiscovered == {
        "object": "list",
        "data": [],
        "has_more": False,
        "repositories": [],
        "root_is_repository": False,
        "base": "HEAD",
        "target": "WORKTREE",
    }
    result = inspect_workspace_git(
        str(tmp_path),
        {
            "operation": "changes",
            "directories": ["first", str(first), "second"],
        },
    )
    assert result["repositories"] == [str(first), str(second)]
    assert [record["path"] for record in result["data"]] == [
        "first/tracked.txt",
        "second/tracked.txt",
    ]
    scoped = inspect_workspace_git(
        str(tmp_path),
        {
            "operation": "changes",
            "path": "first/tracked.txt",
            "directories": [str(second)],
        },
    )
    assert [record["path"] for record in scoped["data"]] == ["first/tracked.txt"]
    inside = inspect_workspace_git(str(first), {"operation": "changes", "path": "tracked.txt"})
    assert inside["data"][0]["path"] == "tracked.txt"
    outside = inspect_workspace_git(str(first), {"operation": "changes", "path": str(second)})
    assert outside["data"][0]["path"] == str(second / "tracked.txt")


def test_nested_repository_excludes_parent_status_effects(repo: Path) -> None:
    # The parent once tracked these files; replacing their directory with a repository
    # must not attribute the child's modifications/deletions to the parent.
    child = repo / "nested"
    child.mkdir()
    (child / "tracked.txt").write_text("parent\n")
    (child / "deleted.txt").write_text("parent\n")
    git(repo, "add", ".")
    git(repo, "commit", "-m", "parent files")
    (child / "deleted.txt").unlink()
    init_repo(child)
    (child / "tracked.txt").write_text("child edit\n")
    (repo / "tracked.txt").write_text("parent edit\n")

    parent_only = inspect_workspace_git(str(repo), {"operation": "changes"})
    assert [record["path"] for record in parent_only["data"]] == ["tracked.txt"]
    result = inspect_workspace_git(str(repo), {"operation": "changes", "directories": ["nested"]})
    records = {record["path"]: record for record in result["data"]}
    assert set(records) == {"tracked.txt", "nested/tracked.txt"}
    assert records["nested/tracked.txt"]["repository"] == str(child)
    diff = inspect_workspace_git(str(repo), {"operation": "diff", "path": "nested/tracked.txt"})
    assert (diff["before"], diff["after"], diff["repository"]) == (
        "original\n",
        "child edit\n",
        str(child),
    )


def test_linked_worktree_and_gitlink_directory_discover_nearest_repo(repo: Path) -> None:
    linked = repo.parent / "linked"
    git(repo, "worktree", "add", "-b", "linked", str(linked))
    assert (linked / ".git").is_file()
    (linked / "tracked.txt").write_text("linked edit\n")
    result = inspect_workspace_git(str(linked), {"operation": "changes"})
    assert result["repositories"] == [str(linked)]
    assert result["data"][0]["repository"] == str(linked)
    assert (
        inspect_workspace_git(
            str(linked),
            {
                "operation": "diff",
                "path": "tracked.txt",
            },
        )["before"]
        == "original\n"
    )

    child = init_repo(repo / "child")
    git(repo, "add", "child")
    git(repo, "commit", "-m", "gitlink")
    (child / "tracked.txt").write_text("dirty child\n")
    result = inspect_workspace_git(str(repo), {"operation": "changes", "directories": ["child"]})
    assert [record["path"] for record in result["data"]] == ["child/tracked.txt"]


def test_stray_git_directory_does_not_hide_an_enclosing_repo(repo: Path) -> None:
    (repo / "folder/.git").mkdir(parents=True)
    (repo / "folder/.git/HEAD").write_text("ref: refs/heads/main\n")
    (repo / "folder/new.txt").write_text("new\n")
    result = inspect_workspace_git(str(repo), {"operation": "changes", "path": "folder"})
    assert result["repositories"] == [str(repo)]
    assert [record["path"] for record in result["data"]] == ["folder/new.txt"]


def test_worktree_diff_added_deleted_and_unborn(repo: Path, tmp_path: Path) -> None:
    (repo / "new.txt").write_text("new\n")
    created = inspect_workspace_git(str(repo), {"operation": "diff", "path": "new.txt"})
    assert created == {
        "object": "session.environment.filesystem.file_diff",
        "path": "new.txt",
        "before": None,
        "after": "new\n",
        "repository": str(repo),
        "base": "HEAD",
        "target": "WORKTREE",
    }
    (repo / "tracked.txt").unlink()
    deleted = inspect_workspace_git(str(repo), {"operation": "diff", "path": "tracked.txt"})
    assert (deleted["before"], deleted["after"]) == ("original\n", None)
    empty = tmp_path / "unborn"
    empty.mkdir()
    git(empty, "init", "-b", "main")
    (empty / "new.txt").write_text("unborn\n")
    new = inspect_workspace_git(
        str(empty),
        {
            "operation": "diff",
            "path": "new.txt",
            "base": "HEAD",
            "target": "WORKTREE",
        },
    )
    assert (new["before"], new["after"]) == (None, "unborn\n")
    git(empty, "add", "new.txt")
    staged = inspect_workspace_git(str(empty), {"operation": "changes"})["data"][0]
    assert (staged["lines_added"], staged["lines_removed"]) == (1, 0)


def test_revision_diff_reads_commits_and_ignores_index_and_worktree(repo: Path) -> None:
    initial = git(repo, "rev-parse", "HEAD")
    (repo / "tracked.txt").write_text("committed\n")
    (repo / "added.txt").write_text("added\n")
    git(repo, "add", ".")
    git(repo, "commit", "-m", "second")
    (repo / "tracked.txt").write_text("committed\nstaged\n")
    git(repo, "add", ".")
    (repo / "tracked.txt").write_text("committed\nstaged\nunstaged\n")
    changed = inspect_workspace_git(str(repo), {"operation": "changes"})["data"][0]
    assert (changed["lines_added"], changed["lines_removed"]) == (2, 0)
    result = inspect_workspace_git(
        str(repo),
        {
            "operation": "diff",
            "path": "tracked.txt",
            "base": "HEAD~1",
            "target": "main",
        },
    )
    assert (result["before"], result["after"]) == ("original\n", "committed\n")
    current = inspect_workspace_git(str(repo), {"operation": "diff", "path": "tracked.txt"})
    assert (current["before"], current["after"]) == (
        "committed\n",
        "committed\nstaged\nunstaged\n",
    )
    added = inspect_workspace_git(
        str(repo),
        {
            "operation": "diff",
            "path": "added.txt",
            "base": initial,
            "target": "HEAD",
        },
    )
    assert (added["before"], added["after"]) == (None, "added\n")
    removed = inspect_workspace_git(
        str(repo),
        {
            "operation": "diff",
            "path": "added.txt",
            "base": "HEAD",
            "target": initial,
        },
    )
    assert (removed["before"], removed["after"]) == ("added\n", None)


def test_single_commit_diff_uses_empty_baseline_only_for_root_parent(repo: Path) -> None:
    root_commit = git(repo, "rev-parse", "HEAD")
    (repo / "tracked.txt").write_text("worktree edit\n")
    params = {
        "operation": "diff",
        "path": "tracked.txt",
        "base": root_commit + "^",
        "target": root_commit,
    }
    result = inspect_workspace_git(str(repo), params)
    assert result == {
        "object": "session.environment.filesystem.file_diff",
        "path": "tracked.txt",
        "before": None,
        "after": "original\n",
        "repository": str(repo),
        "base": root_commit + "^",
        "target": root_commit,
    }
    wrong_parent = inspect_workspace_git(str(repo), {**params, "base": root_commit + "~1"})
    assert (wrong_parent["status"], wrong_parent["error"]["code"]) == (400, "invalid_revision")
    missing = inspect_workspace_git(str(repo), {**params, "base": "missing^", "target": "missing"})
    assert (missing["status"], missing["error"]["code"]) == (400, "invalid_revision")
    git(repo, "add", "tracked.txt")
    git(repo, "commit", "-m", "second")
    second = inspect_workspace_git(str(repo), {**params, "base": "HEAD^", "target": "HEAD"})
    assert (second["before"], second["after"]) == ("original\n", "worktree edit\n")


@pytest.mark.parametrize("revision", ["--help", "missing", "HEAD:no-file", "HEAD@{bad}", "", None])
def test_invalid_revisions_fail_explicitly(repo: Path, revision) -> None:
    result = inspect_workspace_git(
        str(repo),
        {
            "operation": "diff",
            "path": "tracked.txt",
            "base": revision,
        },
    )
    assert result["status"] == 400
    assert result["error"]["code"] == "invalid_revision"


@pytest.mark.parametrize(
    "params",
    [
        None,
        [],
        {},
        {"operation": "write"},
        {"operation": "changes", "path": 7},
        {"operation": "changes", "directories": "folder"},
        {"operation": "changes", "directories": [None]},
        {"operation": "changes", "directories": [""] * 129},
        {"operation": "diff", "path": "../escape"},
        {"operation": "diff", "path": "\0bad"},
        {"operation": "diff", "path": ""},
    ],
)
def test_malformed_parameters(repo: Path, params) -> None:
    result = inspect_workspace_git(str(repo), params)
    assert result["status"] == 400
    assert set(result["error"]) == {"code", "message"}
    assert result["error"]["message"]


def test_diff_rejects_directories_missing_files_and_oversize_content(repo: Path) -> None:
    directory = repo / "folder"
    directory.mkdir()
    (directory / "file").write_text("file\n")
    large = repo / "large"
    with large.open("wb") as stream:
        stream.truncate(10 * 1024 * 1024 + 1)
    git(repo, "add", ".")
    git(repo, "commit", "-m", "directory and large blob")
    for path in ("folder", ".git/config", "large"):
        result = inspect_workspace_git(str(repo), {"operation": "diff", "path": path})
        assert result["status"] == 400
    (directory / "file").unlink()
    directory.rmdir()
    historical_directory = inspect_workspace_git(
        str(repo),
        {
            "operation": "diff",
            "path": "folder",
            "target": "HEAD",
        },
    )
    assert historical_directory["error"]["code"] == "invalid_path"
    missing = inspect_workspace_git(str(repo), {"operation": "diff", "path": "missing"})
    assert missing["status"] == 404
    # Check the filesystem bound independently of the committed-blob bound.
    (repo / "untracked-large").write_bytes(b"x" * (10 * 1024 * 1024 + 1))
    large_worktree = inspect_workspace_git(
        str(repo),
        {
            "operation": "diff",
            "path": "untracked-large",
        },
    )
    assert large_worktree["error"]["code"] == "file_too_large"


def test_symlink_directory_confinement_and_authorized_absolute_paths(repo: Path) -> None:
    outside = init_repo(repo.parent / "outside")
    (outside / "tracked.txt").write_text("outside\n")
    (repo / "escape").symlink_to(outside, target_is_directory=True)
    for operation in ("changes", "diff"):
        result = inspect_workspace_git(
            str(repo),
            {
                "operation": operation,
                "path": "escape/tracked.txt",
            },
        )
        assert result["error"]["code"] == "invalid_path"
    allowed = inspect_workspace_git(
        str(repo),
        {
            "operation": "diff",
            "path": str(outside / "tracked.txt"),
        },
    )
    assert allowed["path"] == str(outside / "tracked.txt")
    assert (allowed["before"], allowed["after"]) == ("original\n", "outside\n")
    (repo / "file-link").symlink_to(outside / "tracked.txt")
    symlink = inspect_workspace_git(str(repo), {"operation": "diff", "path": "file-link"})
    assert symlink["after"] == str(outside / "tracked.txt")
    changes = inspect_workspace_git(str(repo), {"operation": "changes"})
    assert changes["repositories"] == [str(repo)]
    assert [record["path"] for record in changes["data"]] == ["escape", "file-link"]


def test_read_only_environment_and_fsmonitor(repo: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    marker = repo.parent / "fsmonitor-ran"
    monitor = repo.parent / "monitor"
    monitor.write_text(f'#!/bin/sh\ntouch "{marker}"\n')
    monitor.chmod(0o755)
    git(repo, "config", "core.fsmonitor", str(monitor))
    metadata = repo / ".git"
    before = {
        str(path.relative_to(metadata)): (path.read_bytes(), path.stat().st_mtime_ns)
        for path in metadata.rglob("*")
        if path.is_file()
    }
    (repo / "tracked.txt").write_text("changed\n")
    monkeypatch.setenv("GIT_DIR", str(repo.parent / "nonexistent"))
    monkeypatch.setenv("GIT_WORK_TREE", str(repo.parent))
    monkeypatch.setenv("GIT_INDEX_FILE", str(repo.parent / "other-index"))
    monkeypatch.setenv("GIT_CONFIG_COUNT", "1")
    monkeypatch.setenv("GIT_CONFIG_KEY_0", "core.fsmonitor")
    monkeypatch.setenv("GIT_CONFIG_VALUE_0", str(monitor))
    monkeypatch.setenv("GIT_OPTIONAL_LOCKS", "1")
    assert (
        inspect_workspace_git(str(repo), {"operation": "changes"})["data"][0]["status"]
        == "modified"
    )
    assert (
        inspect_workspace_git(
            str(repo),
            {
                "operation": "diff",
                "path": "tracked.txt",
            },
        )["after"]
        == "changed\n"
    )
    after = {
        str(path.relative_to(metadata)): (path.read_bytes(), path.stat().st_mtime_ns)
        for path in metadata.rglob("*")
        if path.is_file()
    }
    assert before == after
    assert not marker.exists()
    assert not (repo.parent / "other-index").exists()


def test_unreadable_repo_and_git_timeout_are_errors(repo: Path, monkeypatch) -> None:
    original_stat = Path.stat

    def unreadable(path, *args, **kwargs):
        if path == repo / ".git":
            raise PermissionError("metadata denied")
        return original_stat(path, *args, **kwargs)

    with monkeypatch.context() as patch:
        patch.setattr(Path, "stat", unreadable)
        denied = inspect_workspace_git(str(repo), {"operation": "changes"})
    assert denied["status"] == 500
    assert "metadata denied" in denied["error"]["message"]

    def timeout(*args, **kwargs):
        assert 0 < kwargs["timeout"] <= 5
        raise subprocess.TimeoutExpired(args[0], kwargs["timeout"])

    monkeypatch.setattr(subprocess, "run", timeout)
    timed_out = inspect_workspace_git(str(repo), {"operation": "changes"})
    assert timed_out["error"]["code"] == "git_timeout"


def test_corrupt_index_is_not_a_successful_empty_changes_list(repo: Path) -> None:
    (repo / ".git/index").write_bytes(b"broken index")
    result = inspect_workspace_git(str(repo), {"operation": "changes"})
    assert result["status"] == 500
    assert result["error"]["code"] == "git_failed"


def test_total_budget_and_record_limit_are_explicit(repo: Path, monkeypatch) -> None:
    import time

    ticks = iter([0, 21])
    with monkeypatch.context() as patch:
        patch.setattr(time, "monotonic", lambda: next(ticks))
        result = inspect_workspace_git(str(repo), {"operation": "changes"})
    assert result["error"]["code"] == "git_timeout"
    original_run = subprocess.run

    def many_records(command, **kwargs):
        if "status" in command:
            kwargs["stdout"].write(b"?? file\0" * 10_001)
            return subprocess.CompletedProcess(command, 0)
        return original_run(command, **kwargs)

    monkeypatch.setattr(subprocess, "run", many_records)
    result = inspect_workspace_git(str(repo), {"operation": "changes"})
    assert result["error"]["code"] == "limit_exceeded"


def test_exported_source_executes_without_package_imports(repo: Path) -> None:
    assert inspect.getsource(inspect_workspace_git) == WORKSPACE_GIT_SCRIPT
    (repo / "tracked.txt").write_text("standalone\n")
    script = (
        WORKSPACE_GIT_SCRIPT
        + "\nimport json, sys\n"
        + ("print(json.dumps(inspect_workspace_git(sys.argv[1], json.loads(sys.argv[2]))))\n")
    )
    for params in ({"operation": "changes"}, {"operation": "diff", "path": "tracked.txt"}):
        output = subprocess.check_output(
            [sys.executable, "-I", "-S", "-c", script, str(repo), json.dumps(params)],
            text=True,
        )
        assert json.loads(output) == inspect_workspace_git(str(repo), params)


def test_historical_changes_include_renames_deletions_counts_and_ignore_disk(repo: Path) -> None:
    (repo / "deleted.txt").write_text("deleted\n")
    git(repo, "add", ".")
    git(repo, "commit", "-m", "before")
    base = git(repo, "rev-parse", "HEAD")
    git(repo, "mv", "tracked.txt", "renamed.txt")
    (repo / "deleted.txt").unlink()
    (repo / "added.txt").write_text("added\nsecond\n")
    git(repo, "add", ".")
    git(repo, "commit", "-m", "after")
    (repo / "added.txt").unlink()
    (repo / "manual.txt").write_text("manual\n")
    result = inspect_workspace_git(
        str(repo.parent),
        {
            "operation": "changes",
            "path": str(repo),
            "base": base,
            "target": "HEAD",
        },
    )
    assert result["root_is_repository"] is True
    assert result["repositories"] == [str(repo)]
    rows = {row["name"]: row for row in result["data"]}
    assert set(rows) == {"added.txt", "deleted.txt", "renamed.txt"}
    assert [
        (rows[name]["status"], rows[name]["lines_added"], rows[name]["lines_removed"])
        for name in ["added.txt", "deleted.txt", "renamed.txt"]
    ] == [
        ("created", 2, 0),
        ("deleted", 0, 1),
        ("modified", 0, 0),
    ]
    assert rows["renamed.txt"]["previous_path"] == "repository/tracked.txt"
    assert all(row["bytes"] is None for row in rows.values())
    diff = inspect_workspace_git(
        str(repo.parent),
        {
            "operation": "diff",
            "scope": str(repo),
            "path": str(repo / "renamed.txt"),
            "base": base,
            "target": "HEAD",
        },
    )
    assert (diff["before"], diff["after"]) == ("original\n", "original\n")
    disk = inspect_workspace_git(
        str(repo),
        {
            "operation": "changes",
            "base": base,
            "target": "WORKTREE",
        },
    )
    assert {row["path"]: row["status"] for row in disk["data"]} == {
        "deleted.txt": "deleted",
        "manual.txt": "created",
        "renamed.txt": "modified",
    }


def test_historical_changes_reject_mixed_scopes_and_diff_repo_mismatch(repo: Path) -> None:
    child = init_repo(repo / "child")
    (repo / "folder").mkdir()
    params = {"operation": "changes", "base": "HEAD", "target": "HEAD"}
    for path in [repo.parent, repo / "folder", repo / "missing", repo / "tracked.txt"]:
        result = inspect_workspace_git(str(repo), {**params, "path": str(path)})
        assert (result["status"], result["error"]["code"]) == (400, "invalid_repository_root")
    mixed = inspect_workspace_git(str(repo), {**params, "directories": [str(child)]})
    assert mixed["error"]["code"] == "invalid_repository_root"
    mismatch = inspect_workspace_git(
        str(repo),
        {
            "operation": "diff",
            "scope": str(repo),
            "path": "child/tracked.txt",
            "target": "HEAD",
        },
    )
    assert mismatch["error"]["code"] == "repository_mismatch"
    working = inspect_workspace_git(str(repo), {"operation": "diff", "path": "child/tracked.txt"})
    assert working["repository"] == str(child)
    child_comparison = inspect_workspace_git(str(repo), {**params, "path": "child"})
    assert child_comparison["root_is_repository"] is True
    assert child_comparison["repositories"] == [str(child)]


def test_historical_gitfile_worktree_root_and_config_unchanged(repo: Path) -> None:
    linked = repo.parent / "linked"
    git(repo, "worktree", "add", "-b", "linked", str(linked))
    (linked / "tracked.txt").write_text("changed\n")
    git(linked, "add", ".")
    git(linked, "commit", "-m", "worktree commit")
    metadata = {
        path: (path.read_bytes(), path.stat().st_mtime_ns)
        for path in (repo / ".git").rglob("*")
        if path.is_file()
    }
    for target in ["WORKTREE", "HEAD"]:
        result = inspect_workspace_git(
            str(repo.parent),
            {
                "operation": "changes",
                "path": str(linked),
                "base": "HEAD^",
                "target": target,
            },
        )
        assert result["root_is_repository"] is True
        assert result["data"][0]["path"] == "linked/tracked.txt"
        assert result["data"][0]["repository"] == str(linked)
    assert metadata == {path: (path.read_bytes(), path.stat().st_mtime_ns) for path in metadata}
    assert inspect_workspace_git(str(linked), {"operation": "repository"}) == {
        "root_is_repository": True,
        "repositories": [str(linked)],
    }


def test_deleted_discovered_directories_do_not_break_background_refresh(repo: Path) -> None:
    transient = repo / "transient"
    transient.mkdir()
    (transient / "new.txt").write_text("untracked\n")
    params = {"operation": "changes", "directories": [str(repo), str(transient)]}
    before = inspect_workspace_git(str(repo.parent), params)
    assert [row["path"] for row in before["data"]] == ["repository/transient/new.txt"]
    (transient / "new.txt").unlink()
    transient.rmdir()
    after = inspect_workspace_git(str(repo.parent), params)
    assert after["data"] == [] and after["repositories"] == [str(repo)]
    (repo / "transient").write_text("replaced with a file")
    replaced = inspect_workspace_git(str(repo.parent), params)
    assert replaced["error"]["code"] == "invalid_path"


def test_stale_discovery_retains_permission_and_symlink_policy_errors(
    repo: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    directory = repo / "denied"
    directory.mkdir()
    original = Path.stat

    def denied(path, *args, **kwargs):
        if path == directory:
            raise PermissionError("discovery denied")
        return original(path, *args, **kwargs)

    with monkeypatch.context() as patch:
        patch.setattr(Path, "stat", denied)
        result = inspect_workspace_git(
            str(repo), {"operation": "changes", "directories": ["denied"]}
        )
    assert result["error"]["code"] == "git_failed"
    assert "discovery denied" in result["error"]["message"]
    (repo / "escape").symlink_to(repo.parent, target_is_directory=True)
    escaped = inspect_workspace_git(
        str(repo), {"operation": "changes", "directories": ["escape/missing"]}
    )
    assert escaped["error"]["code"] == "invalid_path"
