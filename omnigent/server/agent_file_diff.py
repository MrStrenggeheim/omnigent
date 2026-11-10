"""Read bounded persisted turn patches without inventing full historical files."""

from __future__ import annotations

import ast
import contextlib
import os
from pathlib import Path
from typing import Any

from omnigent.entities import ConversationItem


def _patch_sections(output: str, workspace: str | None):
    def normalized(value: str, *, strip_prefix: bool = True) -> str | None:
        value = value.split("\t", 1)[0]
        if value.startswith('"'):
            try:
                value = ast.literal_eval(value)
                if not isinstance(value, str):
                    return None
                with contextlib.suppress(UnicodeError, ValueError):
                    value = value.encode("latin1").decode("utf-8")
            except (ValueError, SyntaxError):
                return None
        if value == "/dev/null":
            return None
        if strip_prefix and value.startswith(("a/", "b/")):
            value = value[2:]
        return os.path.normpath(os.path.join(workspace, value) if workspace else value)

    sections: list[list[str]] = []
    for line in output.splitlines(keepends=True):
        if line.startswith("diff --git ") or not sections:
            sections.append([])
        sections[-1].append(line)
    for lines in sections[:10_000]:
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
        if names:
            yield names, "".join(lines)


def _turn_outputs(items: list[ConversationItem]) -> dict[str, str]:
    calls = {
        (item.response_id, getattr(item.data, "call_id", ""))
        for item in items
        if item.type == "function_call" and getattr(item.data, "name", None) == "turn_diff"
    }
    outputs = {}
    for item in items:
        key = (item.response_id, getattr(item.data, "call_id", None))
        output = getattr(item.data, "output", None)
        if (
            item.type == "function_call_output"
            and item.status == "completed"
            and key in calls
            and item.response_id not in outputs
            and isinstance(output, str)
            and len(output.encode("utf-8")) <= 16 * 1024 * 1024
        ):
            outputs[item.response_id] = output
            if len(outputs) == 20:
                break
    return outputs


def recorded_turn_file_diff(
    items: list[ConversationItem],
    path: str,
    workspace: str | None,
    turn_id: str | None = None,
) -> dict[str, Any] | None:
    """Read an explicit turn, or the latest response without crossing a user boundary."""
    response_id = turn_id
    if response_id is None:
        for item in items:
            if item.type == "message" and getattr(item.data, "role", None) == "user":
                return None
            if item.response_id and (
                item.type in {"function_call", "function_call_output"}
                or (item.type == "message" and getattr(item.data, "role", None) == "assistant")
            ):
                response_id = item.response_id
                break
    output = _turn_outputs(items).get(response_id) if response_id is not None else None
    if output is None:
        return None
    wanted = os.path.normpath(os.path.join(workspace, path) if workspace else path)
    matching = [patch for names, patch in _patch_sections(output, workspace) if wanted in names]
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
        "source": "agent",
        "baseline": "last_turn",
        "finished": True,
        "warning": "Persisted patch only; full file images and attribution are unavailable.",
    }


def read_recorded_turn_items(
    store: Any, session_id: str, after_item_id: str | None = None
) -> tuple[list[ConversationItem], bool]:
    """Read at most eight pages, 4096 items and 32 MiB of tool output."""
    items = []
    cursor = None
    size = 0
    for _ in range(8):
        page = store.list_items(session_id, limit=512, after=cursor, order="desc")
        for item in page.data:
            if after_item_id is not None and item.id == after_item_id:
                return items, False
            output = getattr(item.data, "output", None)
            if isinstance(output, str):
                size += len(output.encode("utf-8"))
            if size > 32 * 1024 * 1024:
                return items, True
            items.append(item)
        if not page.has_more:
            return items, False
        if not page.last_id or page.last_id == cursor:
            return items, True
        cursor = page.last_id
    return items, True


def recorded_agent_changes(
    items: list[ConversationItem],
    scope: str,
    workspace: str | None,
    baseline: str = "last_turn",
    turn_id: str | None = None,
    *,
    truncated: bool = False,
) -> dict[str, Any]:
    """List completed Codex captures, including when their runner has restarted."""
    outputs = _turn_outputs(items)
    times = {
        item.response_id: item.created_at for item in items if item.type == "function_call_output"
    }
    turns = [
        {
            "id": response_id,
            "label": f"Codex turn {response_id}",
            "finished": True,
            "created_at": times.get(response_id, 0),
        }
        for response_id in outputs
    ]
    selected = turn_id or next(iter(outputs), None)
    selected_outputs = (
        list(outputs.items())
        if baseline == "session" and turn_id is None
        else [(selected, outputs[selected])]
        if selected in outputs
        else []
    )
    scope_path = Path(os.path.normpath(os.path.join(workspace, scope) if workspace else scope))
    data = {}
    for response_id, output in selected_outputs:
        for names, patch in _patch_sections(output, workspace):
            valid_names = [name for name in names if name is not None]
            if not valid_names:
                continue
            absolute = Path(valid_names[-1])
            if not absolute.is_relative_to(scope_path):
                continue
            path = (
                str(absolute.relative_to(workspace))
                if workspace and absolute.is_relative_to(workspace)
                else str(absolute)
            )
            if path in data:
                continue
            deletion = "+++ /dev/null" in patch or "deleted file mode " in patch
            creation = "--- /dev/null" in patch or "new file mode " in patch
            data[path] = {
                "object": "session.environment.filesystem.entry",
                "path": path,
                "name": absolute.name,
                "status": "deleted" if deletion else "created" if creation else "modified",
                "bytes": None,
                "modified_at": None,
                "lines_added": sum(
                    line.startswith("+") and not line.startswith("+++")
                    for line in patch.splitlines()
                ),
                "lines_removed": sum(
                    line.startswith("-") and not line.startswith("---")
                    for line in patch.splitlines()
                ),
                "coverage": "recorded-turn-diff",
                "turn_id": response_id,
            }
    return {
        "object": "list",
        "data": sorted(data.values(), key=lambda row: row["path"]),
        "has_more": False,
        "source": "agent",
        "baseline": baseline,
        "turns": turns,
        "turn_id": selected,
        "coverage": "recorded-turn-diff" if turns else "unavailable",
        "history_truncated": truncated,
        "warning": (
            "At most 20 persisted turn patches; full images and attribution gaps are unknown."
            if turns
            else "No captured agent history is available for this session."
        )
        + (" Transcript scan limit reached." if truncated else ""),
    }
