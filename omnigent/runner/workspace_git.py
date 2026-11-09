"""Run repository inspection under the workspace's existing filesystem policy."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

from omnigent.runner.environment_filesystem import CallerProcessFilesystem, _python_script_command

if TYPE_CHECKING:
    from omnigent.inner.os_env import OSEnvironment


def parse_git_directories(value: str) -> list[str]:
    """Decode the bounded set of explicitly discovered directories."""
    parsed = json.loads(value)
    if (
        not isinstance(parsed, list)
        or len(parsed) > 128
        or any(not isinstance(path, str) or len(path) > 8192 or "\x00" in path for path in parsed)
    ):
        raise ValueError("Specify at most 128 directory paths")
    return parsed


async def inspect_git(environment: OSEnvironment, params: dict[str, Any]) -> dict[str, Any]:
    """Authorize the requested paths and execute the shared helper in the sandbox."""
    from omnigent.runtime.workspace_git import WORKSPACE_GIT_SCRIPT

    filesystem = CallerProcessFilesystem(environment)
    root = filesystem._resolve("")
    authorized = dict(params)
    filesystem._resolve(str(params.get("path", "")))
    if "scope" in params:
        filesystem._resolve(params["scope"])
    for directory in params.get("directories", []):
        filesystem._resolve(directory)
    script = WORKSPACE_GIT_SCRIPT + "\nimport json\n"
    script += f"print(json.dumps(inspect_workspace_git({str(root)!r}, {authorized!r})))"
    result = await environment.shell(
        _python_script_command(script), timeout=25, max_output=32 * 1024 * 1024
    )
    if result.get("error") or result.get("exit_code"):
        return {
            "status": 500,
            "error": {"code": "git_inspection_failed", "message": "Git inspection could not run."},
        }
    try:
        payload = json.loads(result.get("stdout", ""))
        if not isinstance(payload, dict):
            raise ValueError("Expected a Git inspection object")
        return payload
    except (ValueError, TypeError) as exc:
        raise RuntimeError("Git inspection returned invalid data") from exc
