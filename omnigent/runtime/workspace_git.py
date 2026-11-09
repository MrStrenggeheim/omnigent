"""Read-only Git inspection shared with filesystem sandbox scripts."""

from __future__ import annotations

import inspect


def inspect_workspace_git(root: str, params: dict) -> dict:
    """Inspect explicitly browsed repositories without recursively discovering them.

    Relative paths stay within the workspace, including directory symlinks.
    Absolute paths are authorized by the caller and may be outside the workspace.
    Diff revision labels are returned unchanged; content uses resolved commit IDs.
    All imports and helpers live here so the source executes without Omnigent.
    """
    import os
    import stat
    import subprocess
    import tempfile
    import time
    from pathlib import Path
    from typing import NoReturn

    deadline = time.monotonic() + 20
    max_content = 10 * 1024 * 1024
    max_records = 10_000

    class InspectionError(Exception):
        def __init__(self, status: int, code: str, message: str):
            self.status = status
            self.code = code
            super().__init__(message)

    def fail(status: int, code: str, message: str) -> NoReturn:
        raise InspectionError(status, code, message)

    def check_deadline():
        if time.monotonic() >= deadline:
            fail(500, "git_timeout", "Git inspection exceeded its 20 second budget")

    def run_git(repository: Path, *args: str, allowed=(0,), limit=64 * 1024 * 1024):
        check_deadline()
        # Spool output to disk so large status/error output cannot exhaust memory.
        with tempfile.TemporaryFile() as output, tempfile.TemporaryFile() as errors:
            try:
                result = subprocess.run(
                    [
                        "git",
                        "-c",
                        "core.fsmonitor=false",
                        "-c",
                        "core.untrackedCache=false",
                        *args,
                    ],
                    cwd=repository,
                    env=env,
                    stdin=subprocess.DEVNULL,
                    stdout=output,
                    stderr=errors,
                    timeout=min(5, max(0.001, deadline - time.monotonic())),
                    check=False,
                )
            except subprocess.TimeoutExpired:
                fail(500, "git_timeout", f"Git inspection timed out in {repository}")
            if result.returncode not in allowed:
                errors.seek(0)
                detail = errors.read(4096).decode("utf-8", errors="replace").strip()
                fail(500, "git_failed", f"Git failed in {repository}: {detail}")
            if output.tell() > limit:
                fail(400, "limit_exceeded", "Git output exceeds the inspection limit")
            output.seek(0)
            return result.returncode, output.read()

    def path_value(value, field: str) -> str:
        if not isinstance(value, str) or "\0" in value:
            fail(400, "invalid_params", f"{field} must be a path string without NUL bytes")
        if ".." in Path(value).parts:
            fail(400, "invalid_path", f"{field} must not contain '..'")
        return value

    def requested_path(value: str, *, directory: bool = False) -> Path:
        entry = Path(value)
        absolute = entry.is_absolute()
        entry = entry if absolute else workspace / entry
        # Keep a final file symlink as an entry; resolve all directory components.
        resolved = (
            entry.resolve() if directory or entry.is_dir() else entry.parent.resolve() / entry.name
        )
        if not absolute and not resolved.is_relative_to(workspace):
            fail(400, "invalid_path", "A relative path escapes the workspace through a symlink")
        return resolved

    def display_path(entry: Path) -> str:
        return str(entry.relative_to(workspace)) if entry.is_relative_to(workspace) else str(entry)

    roots: dict[Path, Path | None] = {}

    def nearest_repository(entry: Path) -> Path | None:
        try:
            is_directory = stat.S_ISDIR(entry.lstat().st_mode)
        except FileNotFoundError:
            is_directory = False
        directory = entry if is_directory else entry.parent
        visited = []
        repository = None
        while True:
            check_deadline()
            if directory in roots:
                repository = roots[directory]
                break
            visited.append(directory)
            marker = directory / ".git"
            try:
                marker_stat = marker.stat()
            except FileNotFoundError:
                marker_stat = None
            if marker_stat is not None:
                git_dir = None
                if stat.S_ISDIR(marker_stat.st_mode):
                    git_dir = marker
                elif stat.S_ISREG(marker_stat.st_mode):
                    with marker.open("rb") as stream:
                        gitfile = stream.read(65537)
                    if len(gitfile) <= 65536 and gitfile.startswith(b"gitdir: "):
                        git_dir = directory / os.fsdecode(gitfile[8:].rstrip(b"\r\n"))
                if git_dir is not None:
                    try:
                        head_stat = (git_dir / "HEAD").stat()
                    except FileNotFoundError:
                        head_stat = None
                    if head_stat is not None and stat.S_ISREG(head_stat.st_mode):
                        # Ignore empty stray .git directories; report real metadata failures.
                        with (git_dir / "HEAD").open("rb") as stream:
                            stream.read(4096)
                        _, output = run_git(directory, "rev-parse", "--show-toplevel")
                        repository = Path(os.fsdecode(output.removesuffix(b"\n"))).resolve()
                        if not directory.is_relative_to(repository):
                            fail(500, "git_failed", f"Unexpected repository root for {directory}")
                        break
            if directory == directory.parent:
                break
            directory = directory.parent
        for directory in visited:
            roots[directory] = repository
        return repository

    def revision(value, field: str) -> str:
        if (
            not isinstance(value, str)
            or not value
            or len(value) > 1024
            or value.startswith("-")
            or any(character.isspace() or ord(character) < 32 for character in value)
        ):
            fail(400, "invalid_revision", f"{field} must be a Git commit revision")
        return value

    def resolve_revision(repository: Path, value: str, unborn=False) -> str | None:
        code, output = run_git(
            repository,
            "rev-parse",
            "--verify",
            "--quiet",
            "--end-of-options",
            value + "^{commit}",
            allowed=(0, 1),
        )
        if code == 0:
            return output.decode("ascii").strip()
        if unborn:
            code, symbolic = run_git(repository, "symbolic-ref", "--quiet", "HEAD", allowed=(0, 1))
            if code == 0:
                code, _ = run_git(
                    repository,
                    "show-ref",
                    "--verify",
                    "--quiet",
                    os.fsdecode(symbolic).strip(),
                    allowed=(0, 1),
                )
                if code == 1:
                    return None
        raise InspectionError(
            400, "invalid_revision", f"Revision {value!r} does not resolve to a commit"
        )

    def committed_content(repository: Path, commit: str | None, relative: str) -> str | None:
        if commit is None:
            return None
        _, output = run_git(
            repository, "ls-tree", "-z", "-l", commit, "--", ":(literal)" + relative
        )
        if not output:
            return None
        metadata, name = output.rstrip(b"\0").split(b"\t", 1)
        _mode, kind, _oid, size = metadata.split()
        if os.fsdecode(name) != relative or kind != b"blob":
            fail(400, "invalid_path", "Diff requires a file, not a directory or gitlink")
        if int(size) > max_content:
            fail(400, "file_too_large", "Diff content exceeds the 10 MiB file limit")
        _, content = run_git(
            repository,
            "show",
            "--no-ext-diff",
            "--no-textconv",
            commit + ":" + relative,
            "--",
            limit=max_content,
        )
        return content.decode("utf-8", errors="replace")

    def comparison_commits(repository: Path, base: str, target: str):
        after = None if target == "WORKTREE" else resolve_revision(repository, target)
        if after is not None and base == target + "^":
            _, parents = run_git(
                repository,
                "--shallow-file",
                os.devnull,
                "rev-list",
                "--parents",
                "--max-count=1",
                after,
                "--",
            )
            before = (
                None
                if parents.split() == [after.encode("ascii")]
                else resolve_revision(repository, after + "^")
            )
        else:
            before = resolve_revision(repository, base, unborn=base == "HEAD")
        return before, after

    def diff_arguments(repository: Path, before: str | None, after: str | None) -> list[str]:
        # Git's empty tree is read-only; hash-object without -w stores nothing.
        if before is None and after is not None:
            _, empty = run_git(repository, "hash-object", "-t", "tree", "--stdin")
            return [empty.decode("ascii").strip(), after]
        return (["--cached"] if before is None else [before]) + ([after] if after else [])

    def numstat_counts(
        repository: Path, arguments: list[str]
    ) -> dict[str, tuple[int | None, int | None]]:
        _, output = run_git(
            repository,
            "diff",
            "--numstat",
            "-z",
            "--no-ext-diff",
            "--no-textconv",
            "--find-renames",
            *arguments,
            "--",
        )
        counts: dict[str, tuple[int | None, int | None]] = {}
        fields = iter(output.split(b"\0"))
        record_count = 0
        for field in fields:
            check_deadline()
            if not field:
                continue
            parts = field.split(b"\t", 2)
            if len(parts) != 3:
                fail(500, "git_failed", "Malformed Git numstat output")
            added, removed, path = parts
            if not path:
                # With -z, renames carry separate source and destination fields.
                source, path = next(fields, b""), next(fields, b"")
                if not source or not path:
                    fail(500, "git_failed", "Missing rename path in Git numstat output")
            record_count += 1
            if record_count > max_records:
                fail(400, "limit_exceeded", "Git numstat exceeds the 10000 record limit")
            if added == removed == b"-":
                counts[os.fsdecode(path)] = (None, None)
            elif added.isdigit() and removed.isdigit():
                counts[os.fsdecode(path)] = (int(added), int(removed))
            else:
                fail(500, "git_failed", "Malformed Git numstat line counts")
        return counts

    def worktree_content(entry: Path) -> str | None:
        try:
            metadata = entry.lstat()
        except FileNotFoundError:
            return None
        if stat.S_ISLNK(metadata.st_mode):
            content = os.fsencode(os.readlink(entry))
        elif stat.S_ISREG(metadata.st_mode):
            flags = os.O_RDONLY | getattr(os, "O_NONBLOCK", 0) | getattr(os, "O_NOFOLLOW", 0)
            with os.fdopen(os.open(entry, flags), "rb") as stream:
                metadata = os.fstat(stream.fileno())
                if not stat.S_ISREG(metadata.st_mode):
                    fail(400, "invalid_path", "Diff requires a regular file or symlink")
                if metadata.st_size > max_content:
                    fail(400, "file_too_large", "Diff content exceeds the 10 MiB file limit")
                content = stream.read(max_content + 1)
        else:
            fail(400, "invalid_path", "Diff requires a regular file or symlink")
        if len(content) > max_content:
            fail(400, "file_too_large", "Diff content exceeds the 10 MiB file limit")
        return content.decode("utf-8", errors="replace")

    try:
        if not isinstance(root, str) or not root or "\0" in root:
            fail(400, "invalid_params", "root must be a nonempty path string")
        workspace = Path(root).resolve()
        if not workspace.is_dir():
            fail(404, "not_found", "The workspace directory does not exist")
        if not isinstance(params, dict):
            fail(400, "invalid_params", "params must be an object")
        if set(params) - {"operation", "path", "directories", "base", "target", "scope"}:
            fail(400, "invalid_params", "Unknown Git inspection parameters")
        operation = params.get("operation")
        if operation not in ("changes", "diff", "repository"):
            fail(
                400, "unsupported_operation", "operation must be 'changes', 'diff' or 'repository'"
            )
        scope = requested_path(path_value(params.get("path", ""), "path"))
        directories = params.get("directories", [])
        if not isinstance(directories, list) or len(directories) > 128:
            fail(400, "invalid_params", "directories must be a list of at most 128 paths")
        browsed = [
            requested_path(path_value(value, "directories"), directory=True)
            for value in directories
        ]
        existing_browsed = []
        for directory in browsed:
            try:
                metadata = directory.stat()
            except FileNotFoundError:
                # Expanded directories can disappear between background refreshes.
                continue
            if not stat.S_ISDIR(metadata.st_mode):
                fail(400, "invalid_path", f"Browsed path is not a directory: {directory}")
            existing_browsed.append(directory)
        browsed = existing_browsed
        env = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
        env.update(GIT_OPTIONAL_LOCKS="0", GIT_TERMINAL_PROMPT="0", GIT_NO_LAZY_FETCH="1")
        if operation == "repository":
            repository = nearest_repository(scope)
            return {
                "root_is_repository": repository == scope,
                "repositories": [str(repository)] if repository else [],
            }

        if operation == "diff":
            if not params.get("path") or scope.is_dir() or ".git" in scope.parts:
                fail(400, "invalid_path", "Diff requires a file path outside Git metadata")
            base = revision(params.get("base", "HEAD"), "base")
            target = revision(params.get("target", "WORKTREE"), "target")
            repository = nearest_repository(scope)
            if repository is None:
                fail(404, "not_a_repository", f"No Git repository contains {scope}")
            if "scope" in params:
                panel = requested_path(path_value(params["scope"], "scope"))
                if base != "HEAD" or target != "WORKTREE":
                    if nearest_repository(panel) != panel or not panel.is_dir():
                        fail(
                            400,
                            "invalid_repository_root",
                            "Historical diff scope must be exactly a repository root",
                        )
                    if repository != panel or not scope.is_relative_to(panel):
                        fail(
                            400,
                            "repository_mismatch",
                            "File belongs to a different repository than the comparison scope",
                        )
            relative = scope.relative_to(repository).as_posix()
            before_commit, after_commit = comparison_commits(repository, base, target)
            before = committed_content(repository, before_commit, relative)
            after = (
                worktree_content(scope)
                if target == "WORKTREE"
                else committed_content(repository, after_commit, relative)
            )
            if before is None and after is not None and before_commit is not None:
                _, renamed = run_git(
                    repository,
                    "diff",
                    "--name-status",
                    "-z",
                    "--find-renames",
                    "--no-ext-diff",
                    "--no-textconv",
                    *diff_arguments(repository, before_commit, after_commit),
                    "--",
                )
                fields = iter(renamed.split(b"\0"))
                for status in fields:
                    if not status:
                        continue
                    source = next(fields, b"")
                    if status.startswith((b"R", b"C")):
                        destination = next(fields, b"")
                        if os.fsdecode(destination) == relative:
                            before = committed_content(
                                repository, before_commit, os.fsdecode(source)
                            )
                            break
            if before is None and after is None:
                fail(404, "not_found", f"File {relative!r} is absent from both revisions")
            check_deadline()
            return {
                "object": "session.environment.filesystem.file_diff",
                "path": display_path(scope),
                "before": before,
                "after": after,
                "repository": str(repository),
                "base": base,
                "target": target,
            }

        base = revision(params.get("base", "HEAD"), "base")
        target = revision(params.get("target", "WORKTREE"), "target")
        historical = base != "HEAD" or target != "WORKTREE"
        root_repository = nearest_repository(scope)
        if historical and (root_repository != scope or not scope.is_dir()):
            fail(
                400,
                "invalid_repository_root",
                "Historical changes require path to be exactly a repository root",
            )
        repositories = set()
        for entry in [scope, *browsed]:
            repository = nearest_repository(entry)
            if repository is not None:
                if historical and repository != scope:
                    fail(
                        400,
                        "invalid_repository_root",
                        "Historical changes cannot compare multiple repositories",
                    )
                repositories.add(repository)
        data = []
        record_count = 0
        for repository in sorted(repositories):
            before_commit, after_commit = comparison_commits(repository, base, target)
            arguments = diff_arguments(repository, before_commit, after_commit)
            if historical:
                _, output = run_git(
                    repository,
                    "diff",
                    "--name-status",
                    "-z",
                    "--find-renames",
                    "--no-ext-diff",
                    "--no-textconv",
                    *arguments,
                    "--",
                )
                names = iter(output.split(b"\0"))
                records = []
                for status in names:
                    if not status:
                        continue
                    name = next(names, b"")
                    if status.startswith((b"R", b"C")):
                        source, name = name, next(names, b"")
                    else:
                        source = None
                    if not name:
                        fail(500, "git_failed", "Malformed Git name-status output")
                    records.append((status[:1] + b" ", name, source))
                if target == "WORKTREE":
                    _, untracked = run_git(
                        repository, "ls-files", "--others", "--exclude-standard", "-z"
                    )
                    by_name = {name: (status, name, source) for status, name, source in records}
                    for name in untracked.split(b"\0"):
                        if name:
                            by_name[name] = (b"M " if name in by_name else b"??", name, None)
                    records = list(by_name.values())
            else:
                _, output = run_git(
                    repository,
                    "status",
                    "--porcelain=v1",
                    "-z",
                    "--untracked-files=all",
                    "--ignore-submodules=none",
                )
                fields = iter(output.split(b"\0"))
                records = []
                for field in fields:
                    if not field:
                        continue
                    if len(field) < 4 or field[2:3] != b" ":
                        fail(500, "git_failed", "Malformed Git status output")
                    status = field[:2]
                    source = next(fields, b"") if b"R" in status or b"C" in status else None
                    if source == b"":
                        fail(500, "git_failed", "Missing source path in Git status output")
                    records.append((status, field[3:], source))
            counts = numstat_counts(repository, arguments)
            for status, name, source in records:
                check_deadline()
                record_count += 1
                if record_count > max_records:
                    fail(400, "limit_exceeded", "Git inspection exceeds the 10000 record limit")
                relative = Path(os.fsdecode(name).rstrip("/"))
                if relative.is_absolute() or ".." in relative.parts:
                    fail(500, "git_failed", "Git returned a path outside its repository")
                entry = repository / relative
                if entry != scope and not entry.is_relative_to(scope):
                    continue
                # A replaced directory symlink must not expose another directory's files.
                if entry.parent.resolve() != entry.parent:
                    continue
                if nearest_repository(entry) != repository:
                    continue
                change = (
                    "deleted"
                    if b"D" in status
                    else ("created" if status == b"??" or status[:1] == b"A" else "modified")
                )
                size = modified_at = None
                if change != "deleted" and target == "WORKTREE":
                    try:
                        metadata = entry.lstat()
                    except FileNotFoundError:
                        continue
                    size, modified_at = metadata.st_size, int(metadata.st_mtime)
                added, removed = (
                    (None, None)
                    if status == b"??"
                    else counts.get(relative.as_posix(), (None, None))
                )
                data.append(
                    {
                        "object": "session.environment.filesystem.entry",
                        "path": display_path(entry),
                        "name": entry.name,
                        "status": change,
                        "bytes": size,
                        "modified_at": modified_at,
                        "lines_added": added,
                        "lines_removed": removed,
                        "repository": str(repository),
                        **(
                            {"previous_path": display_path(repository / os.fsdecode(source))}
                            if source
                            else {}
                        ),
                    }
                )
        return {
            "object": "list",
            "data": sorted(data, key=lambda record: record["path"]),
            "has_more": False,
            "repositories": [str(repository) for repository in sorted(repositories)],
            "root_is_repository": root_repository == scope,
            "base": base,
            "target": target,
        }
    except InspectionError as exc:
        return {"error": {"code": exc.code, "message": str(exc)}, "status": exc.status}
    except (OSError, RuntimeError, ValueError) as exc:
        return {"error": {"code": "git_failed", "message": str(exc)}, "status": 500}


WORKSPACE_GIT_SCRIPT = inspect.getsource(inspect_workspace_git)
