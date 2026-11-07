"""Read recorded per-turn patches without substituting a session or Git baseline."""

from __future__ import annotations

import ast
import contextlib
import os
from typing import Any

from omnigent.entities import ConversationItem


def recorded_turn_file_diff(
    items: list[ConversationItem], path: str, workspace: str | None
) -> dict[str, Any] | None:
    """Find this file in the latest response's persisted turn-diff tool output."""
    response_id = None
    for item in items:
        if item.type == "message" and getattr(item.data, "role", None) == "user":
            return None
        if item.response_id and (
            item.type in {"function_call", "function_call_output"}
            or (item.type == "message" and getattr(item.data, "role", None) == "assistant")
        ):
            response_id = item.response_id
            break
    if response_id is None:
        return None
    calls = {
        getattr(item.data, "call_id", "")
        for item in items
        if item.response_id == response_id
        and item.type == "function_call"
        and getattr(item.data, "name", None) == "turn_diff"
    }
    output = next(
        (
            getattr(item.data, "output", None)
            for item in items
            if item.response_id == response_id
            and item.type == "function_call_output"
            and getattr(item.data, "call_id", None) in calls
        ),
        None,
    )
    if not isinstance(output, str) or len(output.encode("utf-8")) > 16 * 1024 * 1024:
        return None

    def normalized(value: str, *, strip_prefix: bool = True) -> str | None:
        value = value.split("\t", 1)[0]
        if value.startswith('"'):
            try:
                value = ast.literal_eval(value)
                if not isinstance(value, str):
                    return None
                # Git quotes non-ASCII path bytes with octal escapes.
                with contextlib.suppress(UnicodeError, ValueError):
                    value = value.encode("latin1").decode("utf-8")
            except (ValueError, SyntaxError):
                return None
        if value == "/dev/null":
            return None
        if strip_prefix and value.startswith(("a/", "b/")):
            value = value[2:]
        return os.path.normpath(os.path.join(workspace, value) if workspace else value)

    wanted = os.path.normpath(os.path.join(workspace, path) if workspace else path)
    sections: list[list[str]] = []
    for line in output.splitlines(keepends=True):
        if line.startswith("diff --git ") or not sections:
            sections.append([])
        sections[-1].append(line)
    matching = []
    for lines in sections:
        header = []
        for line in lines:
            if line.startswith(("@@", "GIT binary patch")):
                break
            header.append(line)
        names = [
            normalized(line[4:].rstrip("\r\n"))
            for line in header
            if line.startswith(("--- ", "+++ "))
        ]
        names.extend(
            normalized(line[len(prefix) :].rstrip("\r\n"), strip_prefix=False)
            for line in header
            for prefix in ("rename from ", "rename to ")
            if line.startswith(prefix)
        )
        if wanted in names:
            matching.append("".join(lines))
    if not matching:
        return None
    return {
        "object": "session.environment.filesystem.file_diff",
        "path": path,
        "before": None,
        "after": None,
        "patch": "".join(matching),
        "turn_id": response_id,
        "coverage": "recorded-turn-diff",
    }
