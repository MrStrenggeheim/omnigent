"""Read Git ignore annotations for browsed paths without changing repositories."""

from __future__ import annotations

import inspect


def git_ignored_paths(paths: list[str]) -> dict[str, bool]:
    """Batch paths by their nearest repository; missing keys mean unknown.

    Kept stdlib-only so the same function can run inside filesystem sandboxes.
    Git's default check excludes tracked files, even when an ignore rule matches.
    """
    import logging
    import os
    import subprocess
    import time
    from pathlib import Path

    logger = logging.getLogger("omnigent.runtime.git_ignore")
    groups: dict[Path, list[tuple[str, str]]] = {}
    roots: dict[Path, Path | None] = {}
    result: dict[str, bool] = {}
    for path in paths:
        entry = Path(path)
        try:
            parent = entry.parent.resolve()
        except (OSError, RuntimeError) as exc:
            logger.warning("Git ignore path unavailable: %s", exc)
            continue
        if parent not in roots:
            roots[parent] = next(
                (
                    root
                    for root in (parent, *parent.parents)
                    if (root / ".git/HEAD").is_file() or (root / ".git").is_file()
                ),
                None,
            )
        root = roots[parent]
        if root is not None:
            relative = (parent / entry.name).relative_to(root).as_posix()
            groups.setdefault(root, []).append((path, relative))

    # Ignore inherited repository redirection/config injection, but retain HOME
    # so the user's normal global excludes still apply. Never refresh the index.
    env = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
    env["GIT_OPTIONAL_LOCKS"] = "0"
    deadline = time.monotonic() + 5
    for root, entries in groups.items():
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            logger.warning("Git ignore annotations exceeded their time budget")
            break
        try:
            checked = subprocess.run(
                ["git", "-c", "core.fsmonitor=false", "check-ignore", "-z", "--stdin"],
                cwd=root,
                env=env,
                input=b"".join(os.fsencode(relative) + b"\0" for _, relative in entries),
                capture_output=True,
                timeout=min(2, remaining),
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            logger.warning("Git ignore annotations unavailable: %s", exc)
            break
        if checked.returncode not in (0, 1):
            logger.warning(
                "Git ignore annotations failed in %s (exit %d)", root, checked.returncode
            )
            continue
        ignored = set(checked.stdout.split(b"\0"))
        for path, relative in entries:
            result[path] = os.fsencode(relative) in ignored
    return result


# Filesystem helpers execute this same code under the environment's permissions.
GIT_IGNORE_SCRIPT = inspect.getsource(git_ignored_paths)
