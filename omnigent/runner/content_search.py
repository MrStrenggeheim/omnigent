"""Bounded ripgrep searches executed inside the session's OS environment."""

from __future__ import annotations

import json
import subprocess
from typing import TYPE_CHECKING, Any

from omnigent.runner.environment_filesystem import _python_script_command, split_glob_list

if TYPE_CHECKING:
    from omnigent.inner.os_env import OSEnvironment


# This stdlib-only script runs in the environment helper, including its sandbox.
_SEARCH_SCRIPT = r"""
import base64
import json
import subprocess
import tempfile
import threading
import hashlib
import os
import stat
from pathlib import Path

root = globals().get("root", ".")
root_descriptor = os.open("/", os.O_RDONLY | os.O_DIRECTORY)
try:
    for part in Path(os.path.abspath(root)).parts[1:]:
        child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=root_descriptor)
        os.close(root_descriptor)
        root_descriptor = child
    os.fchdir(root_descriptor)
finally:
    os.close(root_descriptor)
whole_word = globals().get("whole_word", False)
use_ignore = globals().get("use_ignore", True)
path_prefix = globals().get("path_prefix", "")
args = [
    "rg",
    "--json",
    "--no-config",
    "--hidden",
    *glob_args,
    "--glob=!.git",
    "--glob=!.omnigent-*",
    "--color=never",
    "--",
    query,
    ".",
]
if whole_word:
    args.insert(1, "--word-regexp")
if not use_ignore:
    args.insert(1, "--no-ignore")
args[1:1] = ["--case-sensitive" if case_sensitive else "--ignore-case"]
if not regex:
    args.insert(1, "--fixed-strings")
else:
    args.insert(1, "--multiline")
matches = []
truncated = False
warning = None
snapshots = {}


def decode(value):
    if "text" in value:
        return value["text"]
    return base64.b64decode(value["bytes"]).decode("utf-8", "replace")


def utf16_length(value):
    return len(value.encode("utf-16-le")) // 2


with tempfile.TemporaryFile() as errors:
    try:
        process = subprocess.Popen(
            args, stdout=subprocess.PIPE, stderr=errors, stdin=subprocess.DEVNULL
        )
    except FileNotFoundError:
        print(json.dumps({"error": "Install ripgrep (rg) on the runner host to search contents."}))
        raise SystemExit
    expired = threading.Event()

    def expire():
        expired.set()
        process.kill()

    timer = threading.Timer(15, expire)
    timer.start()
    reached_end = False
    searched = False
    try:
        while True:
            # Bound even a single JSON record from a generated/minified file.
            record = process.stdout.readline(1024 * 1024)
            if not record:
                reached_end = True
                break
            if not record.endswith(b"\n"):
                warning = "Some very long matching lines were omitted."
                while record and not record.endswith(b"\n"):
                    record = process.stdout.readline(1024 * 1024)
                continue
            event = json.loads(record)
            if event["type"] == "summary":
                searched = True
            if event["type"] != "match":
                continue
            if len(matches) == limit:
                truncated = True
                break
            data = event["data"]
            path = decode(data["path"])
            content = data["lines"]
            raw = (
                content["text"].encode("utf-8")
                if "text" in content
                else base64.b64decode(content["bytes"])
            )
            line = raw.decode("utf-8", "replace")
            relative = path[2:] if path.startswith("./") else path
            digest = None
            descriptor = os.open(".", os.O_RDONLY | os.O_DIRECTORY)
            stream_descriptor = None
            try:
                parts = Path(relative).parts
                if Path(relative).is_absolute() or ".." in parts:
                    raise OSError("Invalid search result path")
                for part in parts[:-1]:
                    child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                                    dir_fd=descriptor)
                    os.close(descriptor)
                    descriptor = child
                stream_descriptor = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                                            dir_fd=descriptor)
                info = os.fstat(stream_descriptor)
                if stat.S_ISREG(info.st_mode) and info.st_size <= 10 * 1024 * 1024:
                    with os.fdopen(os.dup(stream_descriptor), "rb") as stream:
                        if relative not in snapshots:
                            snapshot_bytes = stream.read(10 * 1024 * 1024 + 1)
                            snapshots[relative] = (
                                hashlib.sha256(snapshot_bytes).hexdigest()
                                if len(snapshot_bytes) <= 10 * 1024 * 1024 else None
                            )
                        stream.seek(data["absolute_offset"])
                        if stream.read(len(raw)) == raw:
                            digest = snapshots[relative]
            except OSError:
                warning = "Some file snapshots are unreadable and cannot be replaced."
            finally:
                if stream_descriptor is not None:
                    os.close(stream_descriptor)
                os.close(descriptor)
            for submatch in data["submatches"]:
                if len(matches) == limit:
                    truncated = True
                    break
                start = len(raw[: submatch["start"]].decode("utf-8", "replace"))
                end = len(raw[: submatch["end"]].decode("utf-8", "replace"))
                line_start = line.rfind("\n", 0, start) + 1
                line_end = line.find("\n", max(start, end - 1))
                if line_end < 0:
                    line_end = len(line)
                if line_end > start and line[line_end - 1] == "\r":
                    line_end -= 1
                left = max(line_start, start - 80)
                right = min(line_end, left + 400)
                prefix = "…" if left > line_start else ""
                text = prefix + line[left:right] + ("…" if right < line_end else "")
                start_byte = data["absolute_offset"] + submatch["start"]
                end_byte = data["absolute_offset"] + submatch["end"]
                result_path = (
                    (path_prefix.rstrip("/") + "/" + relative) if path_prefix else relative
                )
                matches.append(
                    {
                        "id": relative + ":" + str(start_byte) + ":" + str(end_byte),
                        "path": result_path,
                        "relative_path": relative,
                        "line": data["line_number"] + raw[:submatch["start"]].count(b"\n"),
                        "column": utf16_length(line[line_start:start]) + 1,
                        "text": text,
                        "match_start": utf16_length(prefix + line[left:start]),
                        "match_end": utf16_length(prefix + line[left : min(end, right)]),
                        "start_byte": start_byte,
                        "end_byte": end_byte,
                        "sha256": digest,
                    }
                )
            if truncated:
                break
    finally:
        if not reached_end and process.poll() is None:
            process.kill()
        process.wait()
        timer.cancel()
        timer.join()
        process.stdout.close()
    errors.seek(0)
    error = errors.read(4096).decode("utf-8", "replace").strip()
    if expired.is_set():
        warning = "Search stopped after 15 seconds. Narrow your query and try again."
        truncated = True
    # A summary distinguishes a search with read errors from an invalid pattern.
    if (process.returncode == 2 and searched) or (error and truncated):
        truncated = True
        warning = ((warning + " ") if warning else "") + (
            "Some files or ignore rules could not be read. "
            "Results may be incomplete or include normally ignored files."
        )
    if process.returncode not in (0, 1) and not truncated:
        print(
            json.dumps(
                {
                    "error": error
                    or "ripgrep could not complete the search. Check workspace access."
                }
            )
        )
        raise SystemExit
print(
    json.dumps(
        {"matches": matches, "truncated": truncated, "warning": warning}, ensure_ascii=False
    )
)
"""


async def search_content(
    environment: OSEnvironment,
    query: str,
    *,
    case_sensitive: bool = False,
    regex: bool = False,
    include: str = "",
    exclude: str = "",
    limit: int = 500,
    whole_word: bool = False,
    use_ignore: bool = True,
    path: str = "",
) -> dict[str, Any]:
    """Search on-disk workspace text without bypassing the environment sandbox.

    :param environment: The session environment whose cwd is searched.
    :param query: A single-line literal or ripgrep regular expression.
    :param case_sensitive: Whether letter case must match.
    :param regex: Interpret the query as a regular expression.
    :param include: Comma-separated ripgrep globs; explicit includes override ignore rules.
    :param exclude: Comma-separated ripgrep globs to exclude, taking precedence over includes.
    :param limit: Maximum matching lines returned, from 1 to 500.
    :returns: Matches and partial-result metadata, or a user-facing error.
    """
    if not query.strip() or len(query) > 4096 or any(c in query for c in "\x00\r\n"):
        return {"error": "Enter a single-line search query of 1–4096 characters."}
    if not 1 <= limit <= 500:
        return {"error": "Search limit must be between 1 and 500."}
    from omnigent.runner.environment_filesystem import CallerProcessFilesystem

    root = CallerProcessFilesystem(environment)._resolve(path)
    glob_args = []
    for raw, prefix in ((include, ""), (exclude, "!")):
        if len(raw) > 4096 or any(c in raw for c in "\x00\r\n"):
            return {"error": "Enter single-line file filters of at most 4096 characters."}
        for pattern in split_glob_list(raw):
            if pattern.startswith("!"):
                return {"error": "Use the Include and Exclude fields instead of ! prefixes."}
            if pattern.endswith("/"):
                pattern += "**"
            glob_args.append(f"--glob={prefix}{pattern}")
    parameters = (
        f"query = {query!r}\ncase_sensitive = {case_sensitive!r}\n"
        f"regex = {regex!r}\nlimit = {limit!r}\nglob_args = {glob_args!r}\n"
        f"whole_word = {whole_word!r}\nuse_ignore = {use_ignore!r}\n"
        f"root = {str(root)!r}\npath_prefix = {path!r}\n"
    )
    # ponytail: one capped response; stream batches if large-workspace latency warrants it.
    result = await environment.shell(
        _python_script_command(parameters + _SEARCH_SCRIPT),
        timeout=20,
        max_output=4 * 1024 * 1024,
    )
    if result.get("error") or result.get("exit_code"):
        return {"error": "Content search could not run in this workspace. Try again."}
    try:
        return json.loads(result.get("stdout", ""))
    except json.JSONDecodeError:
        return {"error": "Content search could not run in this workspace. Try again."}


def search_content_local(workspace: str, params: dict[str, Any]) -> dict[str, Any]:
    """Run the same bounded search on an already authorized idle-host root."""
    from omnigent.runner.environment_filesystem import split_glob_list

    query = params.get("query", params.get("q", ""))
    if (
        not isinstance(query, str)
        or not query.strip()
        or len(query) > 4096
        or any(c in query for c in "\x00\r\n")
    ):
        return {"error": "Enter a single-line search query of 1–4096 characters."}
    glob_args = []
    for field, prefix in (("include", ""), ("exclude", "!")):
        value = params.get(field, "")
        if not isinstance(value, str) or len(value) > 4096 or any(c in value for c in "\x00\r\n"):
            return {"error": "Invalid file filters."}
        for pattern in split_glob_list(value):
            if pattern.startswith("!"):
                return {"error": "Use the Include and Exclude fields instead of ! prefixes."}
            glob_args.append(
                "--glob=" + prefix + pattern + ("**" if pattern.endswith("/") else "")
            )
    values = {
        "query": query,
        "case_sensitive": bool(params.get("case_sensitive", False)),
        "regex": bool(params.get("regex", False)),
        "limit": min(500, max(1, int(params.get("limit", 500)))),
        "whole_word": bool(params.get("whole_word", False)),
        "use_ignore": bool(params.get("use_ignore", True)),
        "root": workspace,
        "path_prefix": params.get("path_prefix", ""),
        "glob_args": glob_args,
    }
    script = (
        "\n".join(f"{key} = {value!r}" for key, value in values.items()) + "\n" + _SEARCH_SCRIPT
    )
    try:
        result = subprocess.run(
            ["python3", "-I", "-c", script],
            capture_output=True,
            text=True,
            timeout=20,
            check=False,
        )
        return json.loads(result.stdout)
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return {"error": "Content search could not run on this host. Try again."}
