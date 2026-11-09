"""Typed Explorer operations shared by sandboxed runners and authorized hosts."""

from __future__ import annotations

import inspect
import json
import os
from typing import TYPE_CHECKING, Any

from omnigent.entities.environment_filesystem import ResourceError
from omnigent.runner.environment_filesystem import CallerProcessFilesystem, _python_script_command

if TYPE_CHECKING:
    from omnigent.inner.os_env import OSEnvironment


def operation_paths(request: dict[str, Any]) -> list[tuple[str, bool]]:
    """Return every client path and whether its operation requires write access."""
    operation = request.get("operation")
    supported = {
        "mkdir",
        "create_file",
        "edit_file",
        "move",
        "copy",
        "trash",
        "trash_list",
        "restore",
        "archive",
        "archive_begin",
        "archive_chunk",
        "archive_cancel",
        "download_begin",
        "download_read",
        "download_cancel",
        "upload",
        "upload_begin",
        "upload_chunk",
        "upload_finish",
        "upload_cancel",
        "delete",
    }
    if operation not in supported:
        raise ValueError("Unknown filesystem operation")
    paths: list[tuple[str, bool]] = []
    if operation in {"move", "copy"}:
        entries = request.get("entries")
        if not isinstance(entries, list) or not 1 <= len(entries) <= 200:
            raise ValueError("Choose between 1 and 200 entries")
        for entry in entries:
            if not isinstance(entry, dict):
                raise ValueError("Invalid filesystem entry")
            source, destination = entry.get("source"), entry.get("destination")
            if not isinstance(source, str) or not isinstance(destination, str):
                raise ValueError("Invalid source or destination")
            paths.extend([(source, operation == "move"), (destination, True)])
    elif operation in {
        "archive",
        "archive_begin",
        "archive_chunk",
        "archive_cancel",
        "download_begin",
        "download_read",
        "download_cancel",
        "delete",
        "trash",
    }:
        selected = request.get("paths")
        if not isinstance(selected, list) or not 1 <= len(selected) <= 200:
            raise ValueError("Choose between 1 and 200 paths")
        paths.extend(
            (path, not operation.startswith(("archive", "download"))) for path in selected
        )
        if operation == "trash":
            paths.append((request.get("path", ""), True))
    else:
        paths.append((request.get("path", ""), operation != "trash_list"))
    for path, _write in paths:
        if (
            not isinstance(path, str)
            or len(path) > 8192
            or "\x00" in path
            or ".." in path.split("/")
        ):
            raise ValueError("Invalid filesystem path")
        if any(
            part in {".omnigent-trash", ".omnigent-transfers"}
            or part.startswith(".omnigent-upload-")
            for part in path.split("/")
        ):
            raise ValueError("Internal Explorer storage cannot be operated on directly")
    return paths


def run_filesystem_operation(workspace: str, request: dict[str, Any]) -> dict[str, Any]:
    """Execute a validated operation; this function is also shipped into the sandbox."""
    import base64
    import contextlib
    import errno
    import hashlib
    import io
    import json
    import os
    import re
    import shutil
    import stat
    import tempfile
    import time
    import uuid
    import zipfile

    root = os.path.realpath(workspace)
    operation = request["operation"]
    result = {"operation": operation, "affected_paths": [], "moved": []}
    owner = hashlib.sha256(str(request.get("_owner", "session")).encode()).hexdigest()[:24]
    opened = []

    def absolute(path):
        if not isinstance(path, str) or "\x00" in path or ".." in path.split("/"):
            raise ValueError("Invalid filesystem path")
        return os.path.normpath(path if os.path.isabs(path) else os.path.join(root, path))

    def display(path):
        return os.path.relpath(path, root) if path.startswith(root + os.sep) else path

    def parent(path, create=False):
        full = absolute(path)
        if full == os.path.sep:
            raise ValueError("The filesystem root cannot be changed")
        descriptor = os.open(os.path.sep, os.O_RDONLY | os.O_DIRECTORY)
        try:
            for part in os.path.dirname(full).split(os.sep):
                if not part:
                    continue
                if create:
                    with contextlib.suppress(FileExistsError):
                        os.mkdir(part, 0o755, dir_fd=descriptor)
                child = os.open(
                    part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=descriptor
                )
                os.close(descriptor)
                descriptor = child
            opened.append(descriptor)
            return descriptor, os.path.basename(full)
        except BaseException:
            os.close(descriptor)
            raise

    def leaf(path, create=False, allow_link=False):
        descriptor, name = parent(path, create)
        try:
            info = os.stat(name, dir_fd=descriptor, follow_symlinks=False)
        except FileNotFoundError:
            return descriptor, name, None
        if stat.S_ISLNK(info.st_mode) and not allow_link:
            raise ValueError("Explorer operations do not follow symbolic links")
        return descriptor, name, info

    def fingerprint(info):
        return [info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns] if info else None

    def data_bytes(value, limit=65536):
        if not isinstance(value, str) or len(value) > (limit + 2) // 3 * 4:
            raise ValueError("Upload chunk is too large")
        data = base64.b64decode(value, validate=True)
        if len(data) > limit:
            raise ValueError("Upload chunk is too large")
        return data

    def write_json(descriptor, name, value):
        fd = os.open(
            name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=descriptor
        )
        with os.fdopen(fd, "w") as stream:
            json.dump(value, stream)

    def read_json(descriptor, name):
        fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=descriptor)
        with os.fdopen(fd) as stream:
            raw = stream.read(65537)
        if len(raw) > 65536:
            raise ValueError("Explorer metadata is too large")
        return json.loads(raw)

    def remove(descriptor, name):
        info = os.stat(name, dir_fd=descriptor, follow_symlinks=False)
        if stat.S_ISDIR(info.st_mode):
            if not shutil.rmtree.avoids_symlink_attacks:
                raise ValueError("Safe recursive removal is unavailable on this platform")
            shutil.rmtree(name, dir_fd=descriptor)
        else:
            os.unlink(name, dir_fd=descriptor)

    def check_target(descriptor, name, overwrite):
        try:
            info = os.stat(name, dir_fd=descriptor, follow_symlinks=False)
        except FileNotFoundError:
            return None
        if stat.S_ISLNK(info.st_mode):
            raise ValueError("Destination is a symbolic link")
        if not overwrite:
            raise FileExistsError(
                "Destination already exists; choose another name or enable overwrite"
            )
        if not stat.S_ISREG(info.st_mode):
            raise ValueError("Existing folders are never overwritten")
        return info

    def rename_entry(source_fd, source_name, target_fd, target_name, overwrite=False):
        if overwrite:
            os.rename(source_name, target_name, src_dir_fd=source_fd, dst_dir_fd=target_fd)
            return
        info = os.stat(source_name, dir_fd=source_fd, follow_symlinks=False)
        if not stat.S_ISDIR(info.st_mode):
            os.link(
                source_name,
                target_name,
                src_dir_fd=source_fd,
                dst_dir_fd=target_fd,
                follow_symlinks=False,
            )
            os.unlink(source_name, dir_fd=source_fd)
            return
        import ctypes

        library = ctypes.CDLL(None, use_errno=True)
        atomic_rename = getattr(library, "renameat2", None)
        if atomic_rename is None:
            raise ValueError("Atomic folder moves are unavailable on this platform")
        atomic_rename.argtypes = [
            ctypes.c_int,
            ctypes.c_char_p,
            ctypes.c_int,
            ctypes.c_char_p,
            ctypes.c_uint,
        ]
        atomic_rename.restype = ctypes.c_int
        if atomic_rename(
            source_fd, os.fsencode(source_name), target_fd, os.fsencode(target_name), 1
        ):
            error = ctypes.get_errno()
            raise OSError(error, os.strerror(error))

    def copy_entry(source_fd, source_name, target_fd, target_name, budget):
        info = os.stat(source_name, dir_fd=source_fd, follow_symlinks=False)
        budget[0] += 1
        if budget[0] > 50000:
            raise ValueError("Operation exceeds 50,000 entries")
        if stat.S_ISDIR(info.st_mode):
            os.mkdir(target_name, 0o700, dir_fd=target_fd)
            child_source = os.open(
                source_name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=source_fd
            )
            child_target = os.open(
                target_name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=target_fd
            )
            try:
                for child in os.listdir(child_source):
                    if child in {".omnigent-trash", ".omnigent-transfers"} or child.startswith(
                        ".omnigent-upload-"
                    ):
                        continue
                    copy_entry(child_source, child, child_target, child, budget)
                os.fchmod(child_target, stat.S_IMODE(info.st_mode))
            finally:
                os.close(child_source)
                os.close(child_target)
        elif stat.S_ISREG(info.st_mode):
            source = os.open(source_name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=source_fd)
            try:
                target = os.open(
                    target_name,
                    os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                    stat.S_IMODE(info.st_mode),
                    dir_fd=target_fd,
                )
                with (
                    os.fdopen(target, "wb") as output,
                    os.fdopen(source, "rb", closefd=False) as input_stream,
                ):
                    shutil.copyfileobj(input_stream, output, 1024 * 1024)
            finally:
                os.close(source)
        elif stat.S_ISLNK(info.st_mode):
            os.symlink(os.readlink(source_name, dir_fd=source_fd), target_name, dir_fd=target_fd)
        else:
            raise ValueError("Copy supports regular files, folders and symbolic links")

    def tree_fingerprint(descriptor, name, budget):
        info = os.stat(name, dir_fd=descriptor, follow_symlinks=False)
        budget[0] += 1
        if budget[0] > 50000:
            raise ValueError("Operation exceeds 50,000 entries")
        digest = hashlib.sha256(repr((fingerprint(info), info.st_mode)).encode())
        if stat.S_ISDIR(info.st_mode):
            child = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=descriptor)
            try:
                for entry in sorted(os.listdir(child)):
                    if entry in {".omnigent-trash", ".omnigent-transfers"} or entry.startswith(
                        ".omnigent-upload-"
                    ):
                        raise ValueError(
                            "Move recovery storage separately before crossing filesystems"
                        )
                    digest.update(os.fsencode(entry))
                    digest.update(tree_fingerprint(child, entry, budget))
            finally:
                os.close(child)
        elif stat.S_ISLNK(info.st_mode):
            digest.update(os.fsencode(os.readlink(name, dir_fd=descriptor)))
        return digest.digest()

    def cross_filesystem_move(entry, source_fd, source_name, target_fd, target_name):
        temporary = ".omnigent-upload-" + owner + "-move-" + uuid.uuid4().hex
        before = tree_fingerprint(source_fd, source_name, [0])
        published = False
        try:
            copy_entry(source_fd, source_name, target_fd, temporary, [0])
            if tree_fingerprint(source_fd, source_name, [0]) != before:
                raise ValueError("Source changed while copying; move was not applied")
            check_target(target_fd, target_name, request.get("overwrite", False))
            rename_entry(
                target_fd, temporary, target_fd, target_name, request.get("overwrite", False)
            )
            published = True
            result["affected_paths"].append(entry["destination"])
            if tree_fingerprint(source_fd, source_name, [0]) != before:
                raise ValueError(
                    "Destination created; source changed and was retained. Review both copies"
                )
            try:
                remove(source_fd, source_name)
            except OSError as exc:
                raise ValueError(
                    "Destination created; source cleanup failed. Both locations may remain: "
                    + str(exc)
                ) from exc
            result["affected_paths"].append(entry["source"])
            result["moved"].append(entry)
        finally:
            if not published:
                with contextlib.suppress(FileNotFoundError):
                    remove(target_fd, temporary)

    try:
        if operation == "edit_file":
            path = request["path"]
            old_text, new_text = request.get("old_text"), request.get("new_text")
            if not isinstance(old_text, str) or not old_text or not isinstance(new_text, str):
                raise ValueError("Expected nonempty old_text and string new_text")
            descriptor, name, info = leaf(path)
            if info is None:
                raise FileNotFoundError(path)
            if not stat.S_ISREG(info.st_mode):
                raise ValueError("Text edits require a regular file")
            fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=descriptor)
            with os.fdopen(fd, "r", encoding="utf-8") as stream:
                original = stream.read()
            if original.count(old_text) != 1:
                raise ValueError("old_text must match exactly one location")
            updated = original.replace(old_text, new_text, 1).encode("utf-8")
            temporary = ".omnigent-upload-" + owner + "-edit-" + uuid.uuid4().hex
            try:
                fd = os.open(
                    temporary,
                    os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                    stat.S_IMODE(info.st_mode),
                    dir_fd=descriptor,
                )
                with os.fdopen(fd, "wb") as stream:
                    stream.write(updated)
                current = os.stat(name, dir_fd=descriptor, follow_symlinks=False)
                if fingerprint(current) != fingerprint(info):
                    raise FileExistsError("File changed during edit; edit was not applied")
                os.replace(temporary, name, src_dir_fd=descriptor, dst_dir_fd=descriptor)
            finally:
                with contextlib.suppress(FileNotFoundError):
                    os.unlink(temporary, dir_fd=descriptor)
            result.update(
                replacements=1,
                bytes_before=len(original.encode("utf-8")),
                bytes_after=len(updated),
            )
            result["affected_paths"].append(path)
        elif operation in {"mkdir", "create_file", "upload"}:
            path = request["path"]
            descriptor, name, info = leaf(path, create=True)
            if info is not None:
                if operation == "mkdir" and request.get("exist_ok") and stat.S_ISDIR(info.st_mode):
                    return result
                raise FileExistsError("Destination already exists")
            if operation == "mkdir":
                os.mkdir(name, 0o755, dir_fd=descriptor)
            else:
                data = data_bytes(request.get("content_base64", ""))
                fd = os.open(
                    name,
                    os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                    0o644,
                    dir_fd=descriptor,
                )
                with os.fdopen(fd, "wb") as stream:
                    stream.write(data)
            result["affected_paths"].append(path)
        elif operation in {"move", "copy"}:
            entries = request["entries"]
            prepared = []
            destinations = set()
            for entry in entries:
                source_path, destination_path = (
                    absolute(entry["source"]),
                    absolute(entry["destination"]),
                )
                if destination_path == source_path or destination_path.startswith(
                    source_path + os.sep
                ):
                    raise ValueError("A file or folder cannot be placed inside itself")
                if source_path == root:
                    raise ValueError("The workspace root cannot be moved or copied")
                if destination_path in destinations:
                    raise ValueError("Each destination must be unique")
                destinations.add(destination_path)
                source_fd, source_name, info = leaf(source_path, allow_link=True)
                if info is None:
                    raise FileNotFoundError(source_path)
                target_fd, target_name, _ = leaf(destination_path)
                check_target(target_fd, target_name, request.get("overwrite", False))
                prepared.append((entry, source_fd, source_name, target_fd, target_name))
            for entry, source_fd, source_name, target_fd, target_name in prepared:
                if operation == "move":
                    try:
                        rename_entry(
                            source_fd,
                            source_name,
                            target_fd,
                            target_name,
                            request.get("overwrite", False),
                        )
                    except OSError as exc:
                        if exc.errno != errno.EXDEV:
                            raise
                        cross_filesystem_move(
                            entry, source_fd, source_name, target_fd, target_name
                        )
                        continue
                    result["moved"].append(entry)
                else:
                    temporary = ".omnigent-upload-copy-" + uuid.uuid4().hex
                    try:
                        copy_entry(source_fd, source_name, target_fd, temporary, [0])
                        check_target(target_fd, target_name, request.get("overwrite", False))
                        rename_entry(
                            target_fd,
                            temporary,
                            target_fd,
                            target_name,
                            request.get("overwrite", False),
                        )
                    except BaseException:
                        with contextlib.suppress(FileNotFoundError):
                            remove(target_fd, temporary)
                        raise
                result["affected_paths"].extend([entry["source"], entry["destination"]])
        elif operation in {"trash", "trash_list", "restore"}:
            base = absolute(request.get("path", ""))
            base_parent, base_name = parent(base)
            base_fd = os.open(
                base_name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=base_parent
            )
            opened.append(base_fd)
            if operation == "trash_list":
                try:
                    trash_fd = os.open(
                        ".omnigent-trash",
                        os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                        dir_fd=base_fd,
                    )
                except FileNotFoundError:
                    return {**result, "items": []}
            else:
                with contextlib.suppress(FileExistsError):
                    os.mkdir(".omnigent-trash", 0o700, dir_fd=base_fd)
                trash_fd = os.open(
                    ".omnigent-trash", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=base_fd
                )
            opened.append(trash_fd)
            with contextlib.suppress(FileExistsError):
                os.mkdir(owner, 0o700, dir_fd=trash_fd)
            owner_fd = os.open(
                owner, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=trash_fd
            )
            opened.append(owner_fd)
            if operation == "trash":
                selected = sorted(set(request["paths"]), key=len)
                selected = [
                    path
                    for i, path in enumerate(selected)
                    if not any(
                        absolute(path).startswith(absolute(parent_path) + os.sep)
                        for parent_path in selected[:i]
                    )
                ]
                result["items"] = []
                for path in selected:
                    full = absolute(path)
                    if full == base or not full.startswith(base + os.sep):
                        raise ValueError("Trash selections must be inside the browsed folder")
                    descriptor, name, info = leaf(path, allow_link=True)
                    if info is None:
                        raise FileNotFoundError(path)
                    item_id = uuid.uuid4().hex
                    metadata = {
                        "id": item_id,
                        "original_path": display(full),
                        "trashed_at": time.time(),
                        "type": "directory" if stat.S_ISDIR(info.st_mode) else "file",
                    }
                    write_json(owner_fd, item_id + ".json", metadata)
                    try:
                        rename_entry(descriptor, name, owner_fd, item_id)
                    except BaseException:
                        os.unlink(item_id + ".json", dir_fd=owner_fd)
                        raise
                    result["items"].append(metadata)
                    result["affected_paths"].append(path)
            elif operation == "trash_list":
                items = []
                for name in os.listdir(owner_fd):
                    if re.fullmatch(r"[a-f0-9]{32}\.json", name):
                        item = read_json(owner_fd, name)
                        if os.path.lexists(
                            os.path.join(base, ".omnigent-trash", owner, item["id"])
                        ):
                            items.append(item)
                result["items"] = sorted(items, key=lambda item: item["trashed_at"], reverse=True)[
                    :200
                ]
            else:
                ids = request.get("ids")
                if not isinstance(ids, list) or not 1 <= len(ids) <= 200:
                    raise ValueError("Choose between 1 and 200 trash items")
                for item_id in ids:
                    if not isinstance(item_id, str) or not re.fullmatch(r"[a-f0-9]{32}", item_id):
                        raise ValueError("Invalid trash item")
                    item = read_json(owner_fd, item_id + ".json")
                    original = absolute(item["original_path"])
                    if not original.startswith(base + os.sep):
                        raise ValueError("Trash metadata is outside the browsed folder")
                    target_fd, target_name, _ = leaf(original, create=True)
                    check_target(target_fd, target_name, False)
                    rename_entry(owner_fd, item_id, target_fd, target_name)
                    os.unlink(item_id + ".json", dir_fd=owner_fd)
                    result["affected_paths"].append(item["original_path"])
        elif operation.startswith("upload_"):
            path = request["path"]
            descriptor, name, info = leaf(path, create=operation == "upload_begin")
            if operation == "upload_begin":
                size = request.get("size")
                if (
                    not isinstance(size, int)
                    or isinstance(size, bool)
                    or not 0 <= size <= 1024 * 1024 * 1024
                ):
                    raise ValueError("Uploads must be at most 1 GiB")
                check_target(descriptor, name, request.get("overwrite", False))
                stale_prefix = ".omnigent-upload-" + owner + "-"
                for entry in os.listdir(descriptor):
                    if not entry.startswith(stale_prefix):
                        continue
                    item = os.stat(entry, dir_fd=descriptor, follow_symlinks=False)
                    if stat.S_ISREG(item.st_mode) and time.time() - item.st_mtime > 24 * 60 * 60:
                        os.unlink(entry, dir_fd=descriptor)
                upload_id = uuid.uuid4().hex
                temporary = ".omnigent-upload-" + owner + "-" + upload_id
                metadata = {
                    "path": absolute(path),
                    "size": size,
                    "original": fingerprint(info),
                    "overwrite": bool(request.get("overwrite")),
                    "created_at": time.time(),
                }
                write_json(descriptor, temporary + ".json", metadata)
                fd = os.open(
                    temporary,
                    os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                    0o600,
                    dir_fd=descriptor,
                )
                os.close(fd)
                result.update({"upload_id": upload_id, "chunk_size": 65536})
            else:
                upload_id = request.get("upload_id")
                if not isinstance(upload_id, str) or not re.fullmatch(r"[a-f0-9]{32}", upload_id):
                    raise ValueError("Invalid upload identifier")
                temporary = ".omnigent-upload-" + owner + "-" + upload_id
                metadata = read_json(descriptor, temporary + ".json")
                if metadata["path"] != absolute(path):
                    raise ValueError("Upload destination does not match")
                if operation == "upload_cancel":
                    os.unlink(temporary, dir_fd=descriptor)
                    os.unlink(temporary + ".json", dir_fd=descriptor)
                elif operation == "upload_chunk":
                    data = data_bytes(request.get("content_base64"))
                    offset = request.get("offset")
                    if not isinstance(offset, int) or isinstance(offset, bool) or offset < 0:
                        raise ValueError("Invalid upload offset")
                    fd = os.open(temporary, os.O_WRONLY | os.O_NOFOLLOW, dir_fd=descriptor)
                    with os.fdopen(fd, "r+b") as stream:
                        import fcntl

                        fcntl.flock(stream.fileno(), fcntl.LOCK_EX)
                        current = os.fstat(stream.fileno()).st_size
                        if current != offset or current + len(data) > metadata["size"]:
                            raise ValueError("Upload offset or size does not match")
                        stream.seek(offset)
                        stream.write(data)
                        result["bytes_written"] = current + len(data)
                elif operation == "upload_finish":
                    fd = os.open(temporary, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=descriptor)
                    try:
                        if os.fstat(fd).st_size != metadata["size"]:
                            raise ValueError("Upload is incomplete")
                        os.fchmod(fd, stat.S_IMODE(info.st_mode) if info else 0o644)
                    finally:
                        os.close(fd)
                    if fingerprint(info) != metadata["original"]:
                        raise FileExistsError(
                            "Destination changed during upload; upload was not applied"
                        )
                    if info is None:
                        os.link(
                            temporary,
                            name,
                            src_dir_fd=descriptor,
                            dst_dir_fd=descriptor,
                            follow_symlinks=False,
                        )
                        os.unlink(temporary, dir_fd=descriptor)
                    else:
                        os.replace(temporary, name, src_dir_fd=descriptor, dst_dir_fd=descriptor)
                    os.unlink(temporary + ".json", dir_fd=descriptor)
                    result["affected_paths"].append(path)
        elif operation == "delete":
            for path in request["paths"]:
                if absolute(path) == root:
                    raise ValueError("The workspace root cannot be removed")
                descriptor, name, info = leaf(path, allow_link=True)
                if info is None:
                    raise FileNotFoundError(path)
                if stat.S_ISDIR(info.st_mode) and not request.get("recursive", False):
                    os.rmdir(name, dir_fd=descriptor)
                else:
                    remove(descriptor, name)
                result["affected_paths"].append(path)
        elif operation.startswith(("archive", "download")):
            paths = sorted({absolute(path) for path in request["paths"]})
            paths = [
                path
                for path in paths
                if not any(path.startswith(other + os.sep) for other in paths if other != path)
            ]
            transfer_fd = None
            archive_id = ""
            if operation != "archive":
                transfer_directory = os.path.join(
                    tempfile.gettempdir(),
                    "omnigent-explorer-"
                    + str(os.getuid())
                    + "-"
                    + owner
                    + "-"
                    + hashlib.sha256(root.encode()).hexdigest()[:16],
                )
                temp_parent, temp_name = parent(transfer_directory)
                with contextlib.suppress(FileExistsError):
                    os.mkdir(temp_name, 0o700, dir_fd=temp_parent)
                transfer_fd = os.open(
                    temp_name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=temp_parent
                )
                opened.append(transfer_fd)
                transfer_info = os.fstat(transfer_fd)
                if (
                    transfer_info.st_uid != os.getuid()
                    or stat.S_IMODE(transfer_info.st_mode) & 0o077
                ):
                    raise ValueError("Transfer storage must be private to this user")
                archive_id = request.get("download_id", request.get("archive_id"))
                if operation in {"archive_begin", "download_begin"}:
                    archive_id = uuid.uuid4().hex
                    for name in os.listdir(transfer_fd):
                        if re.fullmatch(r"[a-f0-9]{32}(?:\.json|\.zip)", name):
                            item = os.stat(name, dir_fd=transfer_fd, follow_symlinks=False)
                            if time.time() - item.st_mtime > 24 * 60 * 60 and stat.S_ISREG(
                                item.st_mode
                            ):
                                os.unlink(name, dir_fd=transfer_fd)
                elif not isinstance(archive_id, str) or not re.fullmatch(
                    r"[a-f0-9]{32}", archive_id
                ):
                    raise ValueError("Invalid archive identifier")
                if operation.startswith("download"):
                    if len(paths) != 1:
                        raise ValueError("Raw downloads require one file")
                    if operation == "download_cancel":
                        metadata = read_json(transfer_fd, archive_id + ".json")
                        if metadata.get("kind") != "raw_download" or metadata["paths"] != paths:
                            raise ValueError("Download selection does not match")
                        os.unlink(archive_id + ".json", dir_fd=transfer_fd)
                        return result
                    descriptor, name, info = leaf(paths[0])
                    if info is None:
                        raise FileNotFoundError(paths[0])
                    if not stat.S_ISREG(info.st_mode):
                        raise ValueError("Raw downloads require a regular file")
                    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=descriptor)
                    with os.fdopen(fd, "rb") as stream:
                        current = os.fstat(stream.fileno())
                        if operation == "download_begin":
                            write_json(
                                transfer_fd,
                                archive_id + ".json",
                                {
                                    "kind": "raw_download",
                                    "paths": paths,
                                    "size": current.st_size,
                                    "fingerprint": fingerprint(current),
                                },
                            )
                            return {**result, "download_id": archive_id, "size": current.st_size}
                        metadata = read_json(transfer_fd, archive_id + ".json")
                        if metadata.get("kind") != "raw_download" or metadata["paths"] != paths:
                            raise ValueError("Download selection does not match")
                        if fingerprint(current) != metadata["fingerprint"]:
                            raise FileExistsError("Download source changed; restart the download")
                        offset = request.get("offset", 0)
                        if (
                            not isinstance(offset, int)
                            or isinstance(offset, bool)
                            or not 0 <= offset <= metadata["size"]
                        ):
                            raise ValueError("Invalid download offset")
                        stream.seek(offset)
                        data = stream.read(1024 * 1024)
                        if fingerprint(os.fstat(stream.fileno())) != metadata["fingerprint"]:
                            raise FileExistsError("Download source changed while reading")
                    return {
                        **result,
                        "content_base64": base64.b64encode(data).decode("ascii"),
                        "eof": offset + len(data) >= metadata["size"],
                    }
                if operation in {"archive_chunk", "archive_cancel"}:
                    metadata = read_json(transfer_fd, archive_id + ".json")
                    if metadata["paths"] != paths:
                        raise ValueError("Archive selection does not match")
                    if operation == "archive_cancel":
                        os.unlink(archive_id + ".zip", dir_fd=transfer_fd)
                        os.unlink(archive_id + ".json", dir_fd=transfer_fd)
                        return result
                    offset = request.get("offset", 0)
                    if (
                        not isinstance(offset, int)
                        or isinstance(offset, bool)
                        or not 0 <= offset <= metadata["size"]
                    ):
                        raise ValueError("Invalid archive offset")
                    fd = os.open(
                        archive_id + ".zip", os.O_RDONLY | os.O_NOFOLLOW, dir_fd=transfer_fd
                    )
                    with os.fdopen(fd, "rb") as stream:
                        stream.seek(offset)
                        data = stream.read(1024 * 1024)
                    return {
                        **result,
                        "content_base64": base64.b64encode(data).decode("ascii"),
                        "eof": offset + len(data) >= metadata["size"],
                    }
                output = os.fdopen(
                    os.open(
                        archive_id + ".zip",
                        os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                        0o600,
                        dir_fd=transfer_fd,
                    ),
                    "w+b",
                )
            else:
                output = io.BytesIO()
            total = [0, 0]
            names = set()

            def add_archive(archive, descriptor, name, archive_name):
                info = os.stat(name, dir_fd=descriptor, follow_symlinks=False)
                total[0] += 1
                if total[0] > 50000:
                    raise ValueError("Archive exceeds 50,000 entries")
                if stat.S_ISDIR(info.st_mode):
                    archive.writestr(archive_name + "/", b"")
                    child = os.open(
                        name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=descriptor
                    )
                    try:
                        for entry in os.listdir(child):
                            if entry in {
                                ".omnigent-trash",
                                ".omnigent-transfers",
                            } or entry.startswith(".omnigent-upload-"):
                                continue
                            add_archive(archive, child, entry, archive_name + "/" + entry)
                    finally:
                        os.close(child)
                elif stat.S_ISREG(info.st_mode):
                    input_limit = (1024 if operation == "archive_begin" else 64) * 1024 * 1024
                    if total[1] + info.st_size > input_limit:
                        raise ValueError(
                            "Archive input exceeds its size limit; download smaller selections"
                        )
                    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=descriptor)
                    with os.fdopen(fd, "rb") as stream, archive.open(archive_name, "w") as target:
                        while True:
                            chunk = stream.read(65536)
                            if not chunk:
                                break
                            total[1] += len(chunk)
                            if total[1] > input_limit:
                                raise ValueError("Archive input exceeds its size limit")
                            target.write(chunk)
                else:
                    if not stat.S_ISLNK(info.st_mode):
                        raise ValueError(
                            "Archive supports regular files, folders and symbolic links"
                        )
                    link = zipfile.ZipInfo(archive_name)
                    link.create_system = 3
                    link.external_attr = (stat.S_IFLNK | 0o777) << 16
                    archive.writestr(link, os.fsencode(os.readlink(name, dir_fd=descriptor)))
                if operation == "archive" and output.tell() > 2 * 1024 * 1024:
                    raise ValueError(
                        "ZIP exceeds 2 MiB; download smaller selections or individual files"
                    )

            filename = (os.path.basename(paths[0]) if len(paths) == 1 else "selection") + ".zip"
            try:
                with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                    for path in paths:
                        descriptor, name, info = leaf(path, allow_link=True)
                        if info is None:
                            raise FileNotFoundError(path)
                        archive_name = name
                        if archive_name in names:
                            raise ValueError(
                                "Selected paths have duplicate names; download their parent folder"
                            )
                        names.add(archive_name)
                        add_archive(archive, descriptor, name, archive_name)
                if operation == "archive_begin":
                    size = output.tell()
                    write_json(transfer_fd, archive_id + ".json", {"paths": paths, "size": size})
                    result.update(
                        {
                            "archive_id": archive_id,
                            "size": size,
                            "filename": filename,
                            "chunk_size": 1024 * 1024,
                        }
                    )
                else:
                    if output.tell() > 2 * 1024 * 1024:
                        raise ValueError("ZIP exceeds 2 MiB; download smaller selections")
                    output.seek(0)
                    result.update(
                        {
                            "content_base64": base64.b64encode(output.read()).decode("ascii"),
                            "filename": filename,
                            "mime_type": "application/zip",
                        }
                    )
            except BaseException:
                if transfer_fd is not None:
                    with contextlib.suppress(FileNotFoundError):
                        os.unlink(archive_id + ".zip", dir_fd=transfer_fd)
                    with contextlib.suppress(FileNotFoundError):
                        os.unlink(archive_id + ".json", dir_fd=transfer_fd)
                raise
            finally:
                output.close()
        return result
    except FileExistsError as exc:
        return {"error": str(exc), "status": 409, **result}
    except FileNotFoundError as exc:
        return {"error": str(exc), "status": 404, **result}
    except PermissionError as exc:
        return {"error": str(exc), "status": 403, **result}
    except (ValueError, OSError) as exc:
        return {"error": str(exc), "status": 400, **result}
    finally:
        for descriptor in opened:
            os.close(descriptor)


async def filesystem_operation(
    environment: OSEnvironment, request: dict[str, Any]
) -> dict[str, Any]:
    """Validate grants and execute typed operations inside the environment sandbox."""
    fs = CallerProcessFilesystem(environment)
    paths = operation_paths(request)
    for path, write in paths:
        try:
            fs._resolve(path, need_write=write)
        except ResourceError:
            if not is_link_entry(request, path, str(environment.cwd)):
                raise
            absolute = path if os.path.isabs(path) else os.path.join(str(environment.cwd), path)
            fs._resolve(os.path.dirname(absolute), need_write=write)
    source = inspect.getsource(run_filesystem_operation)
    script = (
        "from __future__ import annotations\nimport json\n"
        + source
        + f"\nprint(json.dumps(run_filesystem_operation({str(environment.cwd)!r}, {request!r})))\n"
    )
    response = await environment.shell(
        _python_script_command(script), timeout=120, max_output=4 * 1024 * 1024
    )
    if response.get("error") or response.get("exit_code"):
        return {
            "error": response.get("error")
            or response.get("stderr")
            or "Filesystem operation could not run",
            "status": 400,
        }
    try:
        return json.loads(response.get("stdout", ""))
    except json.JSONDecodeError:
        return {"error": "Filesystem operation returned an incomplete response", "status": 502}


def host_filesystem_operation(workspace: str, request: dict[str, Any]) -> dict[str, Any]:
    """Recheck server-issued grants on the host before serving an idle session."""
    import os
    from pathlib import Path

    from omnigent.entities.environment_filesystem import ResourceError
    from omnigent.inner.sandbox import ReachableRoot
    from omnigent.runner.environment_filesystem import resolve_browse_target

    roots = [
        ReachableRoot(
            path=Path(root["path"]), access=root["access"], origin="server", kind=root["kind"]
        )
        for root in request.get("_roots", [])
    ]
    try:
        for path, write in operation_paths(request):
            absolute = path if os.path.isabs(path) else os.path.join(workspace, path)
            try:
                resolve_browse_target(
                    absolute,
                    roots,
                    unconfined=request.get("_unconfined") is True,
                    need_write=write,
                )
            except ResourceError:
                if not is_link_entry(request, path, workspace):
                    raise
                resolve_browse_target(
                    os.path.dirname(absolute),
                    roots,
                    unconfined=request.get("_unconfined") is True,
                    need_write=write,
                )
    except ResourceError as exc:
        return {"error": exc.message, "status": 403}
    return run_filesystem_operation(workspace, request)


def is_link_entry(request: dict[str, Any], path: str, workspace: str) -> bool:
    """Whether a source entry can be preserved without opening its link target."""
    operation = request["operation"]
    source = (
        operation.startswith("archive")
        or operation in {"trash", "delete"}
        or (
            operation in {"copy", "move"}
            and any(entry["source"] == path for entry in request["entries"])
        )
    )
    return source and os.path.islink(
        path if os.path.isabs(path) else os.path.join(workspace, path)
    )
