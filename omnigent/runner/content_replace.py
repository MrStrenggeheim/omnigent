"""Preview, apply and undo bounded replacements against searched file snapshots."""

from __future__ import annotations

import base64
import json
import subprocess
import zlib
from typing import TYPE_CHECKING, Any

from omnigent.runner.environment_filesystem import CallerProcessFilesystem, _python_script_command

if TYPE_CHECKING:
    from omnigent.inner.os_env import OSEnvironment


_REPLACE_SCRIPT = r"""
import base64
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import stat
import tempfile
import time

MAX_BYTES = 10 * 1024 * 1024
root = Path(os.path.abspath(root))
if any(part == ".git" or part.startswith(".omnigent-") for part in root.parts):
    print(json.dumps({"error": "Internal application and Git folders cannot be replaced."}))
    raise SystemExit
action = body.get("action", "preview")
namespace = hashlib.sha256(
    (str(root) + ":" + session_id + ":" + str(body.get("_actor", "local"))).encode()
).hexdigest()


def digest(content):
    return hashlib.sha256(content).hexdigest()


def open_directory(path):
    descriptor = os.open("/", os.O_RDONLY | os.O_DIRECTORY)
    try:
        for part in Path(path).parts[1:]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=descriptor)
            os.close(descriptor)
            descriptor = child
        return descriptor
    except BaseException:
        os.close(descriptor)
        raise


root_fd = open_directory(root)


def target_for(relative):
    if (
        not isinstance(relative, str)
        or not relative
        or Path(relative).is_absolute()
        or ".." in Path(relative).parts
    ):
        raise ValueError("Invalid replacement path.")
    if any(part.startswith(".omnigent-") or part == ".git" for part in Path(relative).parts):
        raise ValueError("Internal application and Git files cannot be replaced.")
    return relative


def parent_for(relative):
    parts = Path(relative).parts
    descriptor = os.dup(root_fd)
    try:
        for part in parts[:-1]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=descriptor)
            os.close(descriptor)
            descriptor = child
        return descriptor, parts[-1]
    except BaseException:
        os.close(descriptor)
        raise


def read_descriptor(descriptor):
    info = os.fstat(descriptor)
    if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_BYTES:
        raise ValueError("Replacement requires a regular text file of at most 10 MiB.")
    os.lseek(descriptor, 0, os.SEEK_SET)
    with os.fdopen(os.dup(descriptor), "rb") as stream:
        data = stream.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES or b"\0" in data:
        raise ValueError("Replacement requires a text file of at most 10 MiB.")
    data.decode("utf-8")
    return data


def read_file(target):
    parent, name = parent_for(target)
    try:
        descriptor = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
        try:
            return read_descriptor(descriptor)
        finally:
            os.close(descriptor)
    finally:
        os.close(parent)


def write_checked(target, before, after):
    parent, name = parent_for(target)
    temporary = ".omnigent-replace-" + secrets.token_hex(16)
    original_fd = None
    created = False
    try:
        original_fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
        original = os.fstat(original_fd)
        if read_descriptor(original_fd) != before:
            raise ValueError("File changed while preparing replacement. Search again.")
        descriptor = os.open(
            temporary,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
            stat.S_IMODE(original.st_mode),
            dir_fd=parent,
        )
        created = True
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(after)
            stream.flush()
            os.fsync(stream.fileno())
        current = os.stat(name, dir_fd=parent, follow_symlinks=False)
        if (
            current.st_ino != original.st_ino
            or current.st_dev != original.st_dev
            or read_descriptor(original_fd) != before
        ):
            raise ValueError("File changed while preparing replacement. Search again.")
        os.replace(temporary, name, src_dir_fd=parent, dst_dir_fd=parent)
        created = False
    finally:
        if original_fd is not None:
            os.close(original_fd)
        if created:
            os.unlink(temporary, dir_fd=parent)
        os.close(parent)


@contextmanager
def history_handle(create=False):
    temporary_fd = open_directory(Path(tempfile.gettempdir()).resolve())
    base_name = "omnigent-search-" + str(os.getuid())
    base_fd = None
    history_fd = None
    try:
        if create:
            try:
                os.mkdir(base_name, 0o700, dir_fd=temporary_fd)
            except FileExistsError:
                pass
        base_fd = os.open(base_name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                          dir_fd=temporary_fd)
        if os.fstat(base_fd).st_uid != os.getuid():
            raise ValueError("Replacement history directory has a different owner.")
        os.fchmod(base_fd, 0o700)
        if create:
            try:
                os.mkdir(namespace, 0o700, dir_fd=base_fd)
            except FileExistsError:
                pass
        history_fd = os.open(namespace, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                             dir_fd=base_fd)
        if os.fstat(history_fd).st_uid != os.getuid():
            raise ValueError("Replacement history directory has a different owner.")
        os.fchmod(history_fd, 0o700)
        yield history_fd
    finally:
        if history_fd is not None:
            os.close(history_fd)
        if base_fd is not None:
            os.close(base_fd)
        os.close(temporary_fd)


def history_read(token):
    with history_handle() as descriptor:
        entry = os.open(token + ".json", os.O_RDONLY | os.O_NOFOLLOW, dir_fd=descriptor)
        with os.fdopen(entry, "r") as stream:
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_size > 48 * 1024 * 1024:
                raise ValueError("Invalid replacement history file.")
            if time.time() - info.st_mtime > 604800:
                raise ValueError("Replacement history has expired.")
            return json.load(stream)


def history_save(token, records):
    with history_handle(create=True) as descriptor:
        temporary = ".pending-" + secrets.token_hex(16)
        entry = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                        0o600, dir_fd=descriptor)
        try:
            with os.fdopen(entry, "w") as stream:
                json.dump(records, stream)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, token + ".json", src_dir_fd=descriptor, dst_dir_fd=descriptor)
        finally:
            try:
                os.unlink(temporary, dir_fd=descriptor)
            except FileNotFoundError:
                pass


def history_delete(token):
    with history_handle() as descriptor:
        os.unlink(token + ".json", dir_fd=descriptor)


def history_cleanup():
    with history_handle(create=True) as descriptor:
        entries = []
        for name in os.listdir(descriptor):
            if not re.fullmatch(r"[a-f0-9]{32}\.json", name):
                continue
            info = os.stat(name, dir_fd=descriptor, follow_symlinks=False)
            if stat.S_ISREG(info.st_mode):
                entries.append((info.st_mtime, name, info.st_size))
        entries.sort(reverse=True)
        retained_bytes = 48 * 1024 * 1024
        for index, (modified, name, size) in enumerate(entries):
            retained_bytes += size
            if index >= 9 or retained_bytes > 128 * 1024 * 1024 or time.time() - modified > 604800:
                os.unlink(name, dir_fd=descriptor)


def preserve_case(value, source):
    letters = "".join(character for character in source if character.isalpha())
    if letters and letters.isupper():
        return value.upper()
    if letters and letters.islower():
        return value.lower()
    if source.istitle():
        return value.title()
    return value


def replacement_for(text, start, end):
    replacement = body.get("replacement", "")
    if not isinstance(replacement, str) or len(replacement) > 65536:
        raise ValueError("Replacement text must be at most 65536 characters.")
    if body.get("regex", False):
        expression = re.sub(r"\(\?<([A-Za-z_]\w*)>", r"(?P<\1>", body.get("query", ""))
        pattern = re.compile(
            expression, re.MULTILINE | (0 if body.get("case_sensitive", False) else re.IGNORECASE)
        )
        match = pattern.match(text, start)
        if match is None or match.end() != end:
            raise ValueError(
                "Cannot expand this regex match safely; adjust the expression and search again."
            )

        def expand(token):
            key = token.group(1)
            if key == "$":
                return "$"
            key = key[1:-1] if key.startswith("{") else key
            try:
                return match.group(int(key) if key.isdigit() else key) or ""
            except (IndexError, KeyError):
                raise ValueError("Replacement refers to an unknown capture group.")

        replacement = re.sub(r"\$(\$|\d+|\{[A-Za-z_0-9]+\})", expand, replacement)
        replacement = replacement.replace(r"\n", "\n").replace(r"\t", "\t").replace(r"\r", "\r")
    if body.get("preserve_case", False):
        replacement = preserve_case(replacement, text[start:end])
    return replacement


def run():
    if action not in ("preview", "apply", "undo"):
        raise ValueError("Unknown replacement action.")
    if action == "undo":
        token = body.get("undo_id", "")
        if not isinstance(token, str) or not re.fullmatch(r"[a-f0-9]{32}", token):
            raise ValueError("Invalid replacement undo identifier.")
        try:
            records = history_read(token)
        except FileNotFoundError:
            raise ValueError("Replacement history is no longer available.")
        restored, errors = [], []
        for record in records:
            try:
                target = target_for(record["path"])
                current = read_file(target)
                if digest(current) != record["after_sha256"]:
                    raise ValueError(
                        "File changed after replacement; undo would overwrite newer edits."
                    )
                write_checked(target, current, base64.b64decode(record["before"]))
                restored.append(record["path"])
            except (OSError, ValueError) as error:
                errors.append({"path": record["path"], "error": str(error)})
        remaining = [record for record in records if record["path"] not in restored]
        if remaining:
            history_save(token, remaining)
        else:
            history_delete(token)
        return {"restored": restored, "errors": errors, "undo_id": token if remaining else None}
    matches = body.get("matches", [])
    if not isinstance(matches, list) or not 1 <= len(matches) <= 500:
        raise ValueError("Select between 1 and 500 search matches.")
    grouped = {}
    for match in matches:
        if not isinstance(match, dict):
            raise ValueError("Invalid match snapshot.")
        grouped.setdefault(match.get("relative_path", match.get("path")), []).append(match)
    previews, errors, prepared = [], [], []
    total_bytes = 0
    for path, selected in grouped.items():
        try:
            target = target_for(path)
            before = read_file(target)
            total_bytes += len(before)
            if total_bytes > 32 * 1024 * 1024:
                raise ValueError("Selected files exceed 32 MiB. Replace a smaller selection.")
            sha = digest(before)
            if any(match.get("sha256") != sha for match in selected):
                raise ValueError("File changed since search. Search again before replacing.")
            text = before.decode("utf-8")
            edits = []
            file_previews = []
            previous_end = -1
            for match in sorted(
                selected,
                key=lambda match: (match.get("start_byte", -1), match.get("end_byte", -1)),
            ):
                start, end = match.get("start_byte"), match.get("end_byte")
                if (
                    not isinstance(start, int)
                    or not isinstance(end, int)
                    or start < 0
                    or end < start
                    or end > len(before)
                    or start < previous_end
                ):
                    raise ValueError("Invalid or overlapping match offsets.")
                start_char, end_char = (
                    len(before[:start].decode("utf-8")),
                    len(before[:end].decode("utf-8")),
                )
                replacement = replacement_for(text, start_char, end_char)
                edits.append((start, end, replacement.encode("utf-8")))
                previous_end = end
                file_previews.append(
                    {
                        "id": match.get("id"),
                        "path": path,
                        "line": match.get("line"),
                        "before": text[start_char:end_char],
                        "after": replacement,
                    }
                )
            after = before
            for start, end, replacement in reversed(edits):
                after = after[:start] + replacement + after[end:]
            if len(after) > MAX_BYTES:
                raise ValueError("Replacement would exceed the 10 MiB file limit.")
            prepared.append((path, target, before, after))
            previews.extend(file_previews)
        except (OSError, ValueError, re.error, UnicodeError) as error:
            errors.append({"path": path, "error": str(error)})
    if action == "preview":
        if len(json.dumps(previews, ensure_ascii=False).encode()) > 2 * 1024 * 1024:
            raise ValueError("Replacement preview exceeds 2 MiB; select fewer matches.")
        return {
            "previews": previews,
            "errors": errors,
            "files": len(prepared),
            "matches": len(previews),
        }
    history_cleanup()
    token = secrets.token_hex(16)
    records, applied = [], []
    for path, target, before, after in prepared:
        try:
            record = {
                "path": path,
                "before": base64.b64encode(before).decode(),
                "after_sha256": digest(after),
            }
            # Persist recovery data before changing the file.
            records.append(record)
            history_save(token, records)
            write_checked(target, before, after)
            applied.append(path)
        except (OSError, ValueError) as error:
            records.pop()
            history_save(token, records)
            errors.append({"path": path, "error": str(error)})
    return {
        "applied": applied,
        "errors": errors,
        "undo_id": token if applied else None,
        "matches": sum(len(grouped[path]) for path in applied),
    }


try:
    print(json.dumps(run(), ensure_ascii=False))
except (OSError, ValueError, TypeError, KeyError, re.error) as error:
    print(json.dumps({"error": str(error)}))
"""


def _replacement_payload(body: dict[str, Any]) -> str:
    """Bound transport metadata and omit search snippets from write requests."""
    fields = (
        "action",
        "query",
        "replacement",
        "regex",
        "case_sensitive",
        "preserve_case",
        "undo_id",
        "_actor",
    )
    payload = {key: body[key] for key in fields if key in body}
    matches = body.get("matches", [])
    if not isinstance(matches, list) or len(matches) > 500:
        raise ValueError("Select at most 500 search matches.")
    match_fields = ("id", "relative_path", "path", "line", "start_byte", "end_byte", "sha256")
    if any(not isinstance(match, dict) for match in matches):
        raise ValueError("Invalid match snapshot.")
    payload["matches"] = [
        {key: match[key] for key in match_fields if key in match} for match in matches
    ]
    serialized = json.dumps(payload, ensure_ascii=False)
    if len(serialized.encode()) > 4 * 1024 * 1024:
        raise ValueError("Replacement metadata exceeds 4 MiB; select fewer matches.")
    return serialized


async def replace_content(
    environment: OSEnvironment, body: dict[str, Any], *, session_id: str, path: str = ""
) -> dict[str, Any]:
    """Execute replacement inside the environment after enforcing its write grants."""
    root = CallerProcessFilesystem(environment)._resolve(path, need_write=True)
    try:
        encoded = base64.b64encode(zlib.compress(_replacement_payload(body).encode())).decode()
    except (ValueError, TypeError) as error:
        return {"error": str(error)}
    parameters = (
        "import base64, json, zlib\n"
        f"body = json.loads(zlib.decompress(base64.b64decode({encoded!r})))\n"
        f"root = {str(root)!r}\nsession_id = {session_id!r}\n"
    )
    command = _python_script_command(parameters + _REPLACE_SCRIPT)
    if len(command.encode()) > 100_000:
        return {"error": "Replacement metadata is too large; select fewer files."}
    result = await environment.shell(
        command,
        timeout=30,
        max_output=4 * 1024 * 1024,
    )
    if result.get("error") or result.get("exit_code"):
        return {
            "error": "Replacement could not run in this workspace. Check write access and retry."
        }
    try:
        return json.loads(result.get("stdout", ""))
    except json.JSONDecodeError:
        return {"error": "Incomplete replacement result; refresh files before retrying."}


def replace_content_local(
    workspace: str, params: dict[str, Any], session_id: str
) -> dict[str, Any]:
    """Execute replacement on an already authorized idle-host search root."""
    root = params.get("root", workspace)
    body = params.get("body", params)
    parameters = (
        "import json, sys\nbody = json.load(sys.stdin)\n"
        f"root = {root!r}\nsession_id = {session_id!r}\n"
    )
    try:
        serialized = _replacement_payload(body)
    except (ValueError, TypeError) as error:
        return {"error": str(error)}
    try:
        result = subprocess.run(
            ["python3", "-I", "-c", parameters + _REPLACE_SCRIPT],
            capture_output=True,
            text=True,
            input=serialized,
            timeout=30,
            check=False,
        )
        return json.loads(result.stdout)
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return {
            "error": "Replacement could not run on this host. Refresh the files before retrying."
        }
