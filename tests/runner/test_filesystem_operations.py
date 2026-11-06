"""Explorer operations preserve bytes, conflicts, grants and recoverable files."""

from __future__ import annotations

import base64
import errno
import io
import os
import stat
import zipfile
from pathlib import Path
from typing import Any

import pytest

from omnigent.runner.filesystem_operations import (
    host_filesystem_operation,
    operation_paths,
    run_filesystem_operation,
)


def test_create_copy_move_conflicts_and_recursive_delete(tmp_path: Path) -> None:
    def operate(operation: str, **parameters: Any) -> dict[str, Any]:
        body = {"operation": operation, **parameters}
        operation_paths(body)
        return run_filesystem_operation(str(tmp_path), body)

    assert "error" not in operate("mkdir", path="nested/empty")
    binary = bytes(range(256))
    assert "error" not in operate(
        "create_file", path="nested/bytes.bin", content_base64=base64.b64encode(binary).decode()
    )
    copied = operate("copy", entries=[{"source": "nested", "destination": "duplicate"}])
    assert copied["affected_paths"] == ["nested", "duplicate"]
    assert (tmp_path / "duplicate/bytes.bin").read_bytes() == binary
    assert (tmp_path / "duplicate/empty").is_dir()
    conflict = operate("move", entries=[{"source": "nested", "destination": "duplicate"}])
    assert conflict["status"] == 409
    assert (tmp_path / "nested").is_dir()
    moved = operate("move", entries=[{"source": "duplicate", "destination": "renamed"}])
    assert moved["moved"] == [{"source": "duplicate", "destination": "renamed"}]
    assert not (tmp_path / "duplicate").exists()
    assert operate("delete", paths=["renamed"], recursive=False)["status"] == 400
    assert "error" not in operate("delete", paths=["renamed"], recursive=True)
    assert not (tmp_path / "renamed").exists()


def test_trash_restore_namespace_and_collision(tmp_path: Path) -> None:
    (tmp_path / "folder").mkdir()
    (tmp_path / "folder/note.txt").write_text("recover me")
    trashed = run_filesystem_operation(
        str(tmp_path),
        {
            "operation": "trash",
            "path": "",
            "paths": ["folder", "folder/note.txt"],
            "_owner": "alice",
        },
    )
    assert len(trashed["items"]) == 1
    assert not (tmp_path / "folder").exists()
    other = run_filesystem_operation(str(tmp_path), {"operation": "trash_list", "_owner": "bob"})
    assert other["items"] == []
    mine = run_filesystem_operation(str(tmp_path), {"operation": "trash_list", "_owner": "alice"})
    assert mine["items"] == trashed["items"]
    item_id = mine["items"][0]["id"]
    (tmp_path / "folder").mkdir()
    conflict = run_filesystem_operation(
        str(tmp_path), {"operation": "restore", "ids": [item_id], "_owner": "alice"}
    )
    assert conflict["status"] == 409
    (tmp_path / "folder").rmdir()
    restored = run_filesystem_operation(
        str(tmp_path), {"operation": "restore", "ids": [item_id], "_owner": "alice"}
    )
    assert restored["affected_paths"] == ["folder"]
    assert (tmp_path / "folder/note.txt").read_text() == "recover me"
    assert (
        run_filesystem_operation(str(tmp_path), {"operation": "trash_list", "_owner": "alice"})[
            "items"
        ]
        == []
    )


def test_chunked_upload_atomic_cancel_conflict_and_owner(tmp_path: Path) -> None:
    binary = os.urandom(150000)
    begin = run_filesystem_operation(
        str(tmp_path),
        {
            "operation": "upload_begin",
            "path": "nested/data.bin",
            "size": len(binary),
            "_owner": "alice",
        },
    )
    assert not (tmp_path / "nested/data.bin").exists()
    common = {"path": "nested/data.bin", "upload_id": begin["upload_id"], "_owner": "alice"}
    incomplete = run_filesystem_operation(str(tmp_path), {**common, "operation": "upload_finish"})
    assert incomplete["status"] == 400
    wrong_owner = run_filesystem_operation(
        str(tmp_path), {**common, "operation": "upload_cancel", "_owner": "bob"}
    )
    assert wrong_owner["status"] == 404
    for offset in range(0, len(binary), begin["chunk_size"]):
        chunk = binary[offset : offset + begin["chunk_size"]]
        written = run_filesystem_operation(
            str(tmp_path),
            {
                **common,
                "operation": "upload_chunk",
                "offset": offset,
                "content_base64": base64.b64encode(chunk).decode(),
            },
        )
        assert written["bytes_written"] == offset + len(chunk)
    applied = run_filesystem_operation(str(tmp_path), {**common, "operation": "upload_finish"})
    assert applied["affected_paths"] == ["nested/data.bin"]
    assert (tmp_path / "nested/data.bin").read_bytes() == binary
    assert not list((tmp_path / "nested").glob(".omnigent-upload-*"))

    replacement = run_filesystem_operation(
        str(tmp_path),
        {"operation": "upload_begin", "path": "nested/data.bin", "size": 0, "overwrite": True},
    )
    (tmp_path / "nested/data.bin").write_text("external edit")
    common = {"path": "nested/data.bin", "upload_id": replacement["upload_id"]}
    stale = run_filesystem_operation(str(tmp_path), {**common, "operation": "upload_finish"})
    assert stale["status"] == 409
    assert (tmp_path / "nested/data.bin").read_text() == "external edit"
    assert "error" not in run_filesystem_operation(
        str(tmp_path), {**common, "operation": "upload_cancel"}
    )
    assert not list((tmp_path / "nested").glob(".omnigent-upload-*"))


def test_chunked_archive_preserves_structure_and_cleans(tmp_path: Path) -> None:
    (tmp_path / "folder/empty").mkdir(parents=True)
    payload = os.urandom(2500000)
    (tmp_path / "folder/data.bin").write_bytes(payload)
    (tmp_path / "folder/.omnigent-trash").mkdir()
    (tmp_path / "folder/.omnigent-trash/private.txt").write_text("excluded")
    common = {"paths": ["folder"], "_owner": "archive-owner"}
    begin = run_filesystem_operation(str(tmp_path), {**common, "operation": "archive_begin"})
    assert begin["size"] > 2 * 1024 * 1024
    data = bytearray()
    while len(data) < begin["size"]:
        chunk = run_filesystem_operation(
            str(tmp_path),
            {
                **common,
                "operation": "archive_chunk",
                "archive_id": begin["archive_id"],
                "offset": len(data),
            },
        )
        data.extend(base64.b64decode(chunk["content_base64"]))
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        assert archive.read("folder/data.bin") == payload
        assert "folder/empty/" in archive.namelist()
        assert not any(".omnigent-trash" in name for name in archive.namelist())
    altered = run_filesystem_operation(
        str(tmp_path),
        {
            **common,
            "paths": ["folder/data.bin"],
            "operation": "archive_chunk",
            "archive_id": begin["archive_id"],
            "offset": 0,
        },
    )
    assert altered["status"] == 400
    assert "error" not in run_filesystem_operation(
        str(tmp_path), {**common, "operation": "archive_cancel", "archive_id": begin["archive_id"]}
    )
    missing = run_filesystem_operation(
        str(tmp_path),
        {**common, "operation": "archive_chunk", "archive_id": begin["archive_id"], "offset": 0},
    )
    assert missing["status"] == 404


@pytest.mark.parametrize(
    "operation", ["mkdir", "create_file", "upload_begin", "move", "copy", "archive"]
)
def test_symlink_parent_never_writes_or_reads_outside(tmp_path: Path, operation: str) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "secret.txt").write_text("private")
    (workspace / "link").symlink_to(outside, target_is_directory=True)
    (workspace / "source.txt").write_text("new")
    body: dict[str, Any] = {"operation": operation, "path": "link/target.txt", "size": 0}
    if operation in {"move", "copy"}:
        body["entries"] = [{"source": "source.txt", "destination": "link/target.txt"}]
    if operation == "archive":
        body["paths"] = ["link/secret.txt"]
    response = run_filesystem_operation(str(workspace), body)
    assert response["status"] == 400
    assert not (outside / "target.txt").exists()
    assert (outside / "secret.txt").read_text() == "private"


@pytest.mark.parametrize(
    "body",
    [
        {"operation": "unknown"},
        {"operation": "mkdir", "path": "../escape"},
        {"operation": "delete", "paths": [".omnigent-trash/secret"]},
        {"operation": "copy", "entries": [{"source": "file"}]},
        {"operation": "archive", "paths": []},
        {"operation": "upload_begin", "path": "name\x00"},
    ],
)
def test_operation_validation_rejects_invalid_requests(body: dict[str, Any]) -> None:
    with pytest.raises(ValueError):
        operation_paths(body)


def test_idle_host_rechecks_read_only_grants(tmp_path: Path) -> None:
    body = {
        "operation": "mkdir",
        "path": "forbidden",
        "_roots": [{"path": str(tmp_path), "access": "read", "kind": "tree"}],
        "_unconfined": False,
    }
    assert host_filesystem_operation(str(tmp_path), body)["status"] == 403
    assert not (tmp_path / "forbidden").exists()
    body["_roots"][0]["access"] = "write"
    assert "error" not in host_filesystem_operation(str(tmp_path), body)
    assert (tmp_path / "forbidden").is_dir()


def test_copy_and_archive_preserve_links_without_reading_targets(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    outside = tmp_path / "private.txt"
    outside.write_text("secret contents must not enter a copy or archive")
    (workspace / "folder").mkdir()
    (workspace / "folder/link").symlink_to(outside)
    copied = run_filesystem_operation(
        str(workspace),
        {"operation": "copy", "entries": [{"source": "folder", "destination": "duplicate"}]},
    )
    assert "error" not in copied, copied
    assert (workspace / "duplicate/link").is_symlink()
    assert os.readlink(workspace / "duplicate/link") == str(outside)
    archived = run_filesystem_operation(
        str(workspace), {"operation": "archive", "paths": ["folder"]}
    )
    assert "error" not in archived, archived
    with zipfile.ZipFile(io.BytesIO(base64.b64decode(archived["content_base64"]))) as archive:
        assert archive.read("folder/link") == os.fsencode(outside)
        assert stat.S_ISLNK(archive.getinfo("folder/link").external_attr >> 16)
        assert not any(b"secret contents" in archive.read(name) for name in archive.namelist())
    direct = host_filesystem_operation(
        str(workspace),
        {
            "operation": "copy",
            "entries": [{"source": "folder/link", "destination": "link-copy"}],
            "_roots": [{"path": str(workspace), "access": "write", "kind": "tree"}],
            "_unconfined": False,
        },
    )
    assert "error" not in direct, direct
    assert (workspace / "link-copy").is_symlink()
    assert outside.read_text() == "secret contents must not enter a copy or archive"


@pytest.mark.parametrize("cleanup_failure", [False, True])
def test_cross_filesystem_file_move_preserves_partial_outcome(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, cleanup_failure: bool
) -> None:
    (tmp_path / "source.txt").write_bytes(b"moved bytes")
    original_link, original_unlink = os.link, os.unlink

    def cross_device_link(source, destination, **kwargs):
        if source == "source.txt":
            raise OSError(errno.EXDEV, "cross-device link")
        return original_link(source, destination, **kwargs)

    def unlink(source, **kwargs):
        if cleanup_failure and source == "source.txt":
            raise PermissionError("source is now read-only")
        return original_unlink(source, **kwargs)

    monkeypatch.setattr(os, "link", cross_device_link)
    monkeypatch.setattr(os, "unlink", unlink)
    result = run_filesystem_operation(
        str(tmp_path),
        {
            "operation": "move",
            "entries": [{"source": "source.txt", "destination": "destination.txt"}],
        },
    )
    assert (tmp_path / "destination.txt").read_bytes() == b"moved bytes"
    assert (tmp_path / "source.txt").exists() is cleanup_failure
    assert "destination.txt" in result["affected_paths"]
    assert not list(tmp_path.glob(".omnigent-upload-*"))
    if cleanup_failure:
        assert result["status"] == 400
        assert "source cleanup failed" in result["error"]
    else:
        assert result["moved"] == [{"source": "source.txt", "destination": "destination.txt"}]


def test_cross_filesystem_folder_move_preserves_links_and_contents(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import ctypes
    from types import SimpleNamespace

    (tmp_path / "source/empty").mkdir(parents=True)
    (tmp_path / "source/file.txt").write_text("kept")
    (tmp_path / "source/link").symlink_to("file.txt")
    original_library = ctypes.CDLL

    def library(*args, **kwargs):
        loaded = original_library(*args, **kwargs)
        original_rename = loaded.renameat2
        original_rename.argtypes = [
            ctypes.c_int,
            ctypes.c_char_p,
            ctypes.c_int,
            ctypes.c_char_p,
            ctypes.c_uint,
        ]
        original_rename.restype = ctypes.c_int

        def rename(source_fd, source, target_fd, target, flags):
            if source == b"source":
                ctypes.set_errno(errno.EXDEV)
                return -1
            return original_rename(source_fd, source, target_fd, target, flags)

        return SimpleNamespace(renameat2=rename)

    monkeypatch.setattr(ctypes, "CDLL", library)
    result = run_filesystem_operation(
        str(tmp_path),
        {"operation": "move", "entries": [{"source": "source", "destination": "destination"}]},
    )
    assert "error" not in result, result
    assert not (tmp_path / "source").exists()
    assert (tmp_path / "destination/empty").is_dir()
    assert (tmp_path / "destination/file.txt").read_text() == "kept"
    assert os.readlink(tmp_path / "destination/link") == "file.txt"


def test_archive_limits_actual_bytes_when_file_grows_after_stat(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = tmp_path / "growing.bin"
    with source.open("wb") as stream:
        stream.truncate(65 * 1024 * 1024)
    original_stat = os.stat

    def stat_before_growth(path, **kwargs):
        info = original_stat(path, **kwargs)
        if path == "growing.bin":
            values = list(info)
            values[6] = 0
            return os.stat_result(values)
        return info

    monkeypatch.setattr(os, "stat", stat_before_growth)
    result = run_filesystem_operation(
        str(tmp_path), {"operation": "archive", "paths": ["growing.bin"]}
    )
    assert result["status"] == 400
    assert "input exceeds its size limit" in result["error"]
