"""Bounded, prospective baselines for observed file tools, independent of Git.

Use the resolved registry's ``turn_history`` for both lifecycle and lookup.
``last_turn=True`` selects the latest completed turn unless an ID is supplied;
``False`` selects the first observed mutation during this store's session lifetime.
Neither view is a complete filesystem snapshot, and neither survives a restart.
"""

from __future__ import annotations

import os
import stat
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class _Baseline:
    before: str | None
    known: bool
    size: int = 0
    reason: str | None = None


@dataclass
class _File:
    baseline: _Baseline
    turn_id: str
    operation: str | None = None
    after: _Baseline = field(default_factory=lambda: _Baseline(None, False))
    bytes: int | None = None
    modified_at: float | None = None
    partial: bool = False
    pending_gap: bool = False


@dataclass
class _Turn:
    turn_id: str
    finished: bool = False
    files: dict[str, _File] = field(default_factory=dict)
    created_at: float = field(default_factory=time.time)


@dataclass
class _Session:
    turns: list[_Turn] = field(default_factory=list)
    files: dict[str, _File] = field(default_factory=dict)

    def content_bytes(self) -> int:
        # Session and turn entries can share the same immutable preimage.
        baselines = {id(f.baseline): f.baseline for f in self.files.values()}
        for turn in self.turns:
            baselines.update((id(f.baseline), f.baseline) for f in turn.files.values())
            baselines.update((id(f.after), f.after) for f in turn.files.values())
        baselines.update((id(f.after), f.after) for f in self.files.values())
        return sum(b.size for b in baselines.values())


class TurnFileBaselines:
    """Thread-safe history bound to one resolved workspace root.

    Call ``begin`` before execution and ``finish`` at execution completion.
    Capture preimages before writes (or from native original-file payloads),
    then call ``record`` only for successful mutations.
    Captures without a successful record are invisible and discarded on finish.
    """

    def __init__(
        self,
        workspace_root: Path,
        *,
        max_file_bytes: int = 10 * 1024 * 1024,
        max_session_bytes: int = 32 * 1024 * 1024,
        max_sessions: int = 100,
        max_paths: int = 1024,
        max_turns: int = 20,
    ) -> None:
        if min(max_file_bytes, max_session_bytes, max_sessions, max_paths, max_turns) <= 0:
            raise ValueError("Baseline limits must be positive")
        self.workspace_root = workspace_root.resolve()
        self._max_file_bytes = max_file_bytes
        self._max_session_bytes = max_session_bytes
        self._max_sessions = max_sessions
        self._max_paths = max_paths
        self._max_turns = max_turns
        self._sessions: OrderedDict[str, _Session] = OrderedDict()
        self._lock = threading.Lock()

    def _path(self, path: str) -> str | None:
        # Reuse the registry's symlink and workspace-boundary normalization.
        from omnigent.runtime.filesystem_registry import _normalize_path

        return _normalize_path(path, self.workspace_root)

    def _read_after(self, path: str, norm: str) -> _Baseline:
        """Read bounded UTF-8 through directory descriptors without following symlinks."""
        if not hasattr(os, "O_NOFOLLOW") or os.open not in os.supports_dir_fd:
            return _Baseline(None, False, reason="after_read_unsupported")
        absolute = Path(os.path.abspath(self.workspace_root / path))
        if absolute != self.workspace_root / norm:
            return _Baseline(None, False, reason="after_symlink")
        descriptor: int | None = None
        try:
            descriptor = os.open(self.workspace_root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            parts = Path(norm).parts
            if not parts:
                return _Baseline(None, False, reason="after_not_regular")
            for part in parts[:-1]:
                child = os.open(
                    part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=descriptor
                )
                os.close(descriptor)
                descriptor = child
            child = os.open(
                parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=descriptor
            )
            os.close(descriptor)
            descriptor = child
            metadata = os.fstat(descriptor)
            if not stat.S_ISREG(metadata.st_mode):
                return _Baseline(None, False, reason="after_not_regular")
            if metadata.st_size > self._max_file_bytes:
                return _Baseline(None, False, reason="after_file_limit")
            with os.fdopen(descriptor, "rb") as stream:
                descriptor = None
                raw = stream.read(self._max_file_bytes + 1)
                after_metadata = os.fstat(stream.fileno())
            if len(raw) > self._max_file_bytes:
                return _Baseline(None, False, reason="after_file_limit")
            if (metadata.st_size, metadata.st_mtime_ns, metadata.st_ctime_ns) != (
                after_metadata.st_size,
                after_metadata.st_mtime_ns,
                after_metadata.st_ctime_ns,
            ):
                return _Baseline(None, False, reason="after_changed_during_read")
            return _Baseline(raw.decode("utf-8"), True, len(raw))
        except FileNotFoundError:
            return _Baseline(None, True)
        except UnicodeError:
            return _Baseline(None, False, reason="after_not_utf8")
        except OSError:
            return _Baseline(None, False, reason="after_unavailable")
        finally:
            if descriptor is not None:
                os.close(descriptor)

    @staticmethod
    def _finish(session: _Session) -> None:
        if session.turns:
            turn = session.turns[-1]
            turn.files = {p: f for p, f in turn.files.items() if f.operation is not None}
            turn.finished = True

    def begin(self, session_id: str, turn_id: str) -> None:
        """Start a turn once; repeated retained IDs never reset its baseline."""
        if not session_id or not turn_id:
            raise ValueError("Session and turn IDs must be nonempty")
        with self._lock:
            session = self._sessions.setdefault(session_id, _Session())
            self._sessions.move_to_end(session_id)
            if any(t.turn_id == turn_id for t in session.turns):
                return
            self._finish(session)
            session.turns.append(_Turn(turn_id))
            del session.turns[: -self._max_turns]
            while len(self._sessions) > self._max_sessions:
                self._sessions.popitem(last=False)

    def finish(self, session_id: str) -> None:
        """Close the active turn without discarding its recorded preimages."""
        with self._lock:
            if session := self._sessions.get(session_id):
                self._finish(session)

    def capture(self, session_id: str, path: str, before: str | None, known: bool) -> None:
        """Capture a candidate preimage; known None explicitly means absent.

        Until success is recorded, a retry may replace a failed attempt's candidate.
        After the first successful mutation, even an unknown baseline is immutable.
        """
        norm = self._path(path)
        if norm is None:
            return
        with self._lock:
            session = self._sessions.get(session_id)
            if session is None or not session.turns or session.turns[-1].finished:
                return
            turn = session.turns[-1]
            previous = turn.files.get(norm)
            if previous is not None and previous.operation is not None:
                previous.pending_gap = not (
                    previous.after.known and known and previous.after.before == before
                )
                return
            if previous is None and len(turn.files) >= self._max_paths:
                return
            size = len(before.encode("utf-8", errors="surrogatepass")) if known and before else 0
            reason = None if known else "preimage_unavailable"
            if size > self._max_file_bytes:
                known, reason = False, "file_limit"
            elif (
                session.content_bytes() - (previous.baseline.size if previous else 0) + size
                > self._max_session_bytes
            ):
                known, reason = False, "session_limit"
            baseline = _Baseline(before if known else None, known, size if known else 0, reason)
            turn.files[norm] = _File(baseline, turn.turn_id)

    def record(self, session_id: str, path: str, operation: str) -> None:
        """Record success and capture its after-image; uncaptured creates prove prior absence."""
        if operation not in {"created", "modified", "deleted"}:
            raise ValueError(f"Unsupported file operation: {operation!r}")
        norm = self._path(path)
        if norm is None:
            return
        with self._lock:
            session = self._sessions.get(session_id)
            if session is None or not session.turns or session.turns[-1].finished:
                return
            turn = session.turns[-1]
            entry = turn.files.get(norm)
            if entry is None:
                if len(turn.files) >= self._max_paths:
                    return
                known = operation == "created"
                baseline = _Baseline(None, known, reason=None if known else "preimage_unavailable")
                entry = turn.files[norm] = _File(baseline, turn.turn_id)
            first = session.files.get(norm)
            session_gap = False
            if entry.operation is None and first is not None:
                session_gap = not (
                    first.after.known
                    and entry.baseline.known
                    and first.after.before == entry.baseline.before
                )
            entry.partial = entry.partial or entry.pending_gap or not entry.baseline.known
            entry.pending_gap = False
            entry.operation = operation
            entry.after = _Baseline(None, False)
            if first is not None:
                first.after = _Baseline(None, False)
            after = self._read_after(path, norm)
            if session.content_bytes() + after.size > self._max_session_bytes:
                after = _Baseline(None, False, reason="after_session_limit")
            entry.after = after
            entry.partial = entry.partial or not after.known
            entry.bytes = after.size if after.known and after.before is not None else None
            entry.modified_at = time.time()
            if first is None and len(session.files) < self._max_paths:
                first = session.files[norm] = _File(entry.baseline, turn.turn_id, operation)
            elif first is not None:
                first.operation = operation
            if first is not None:
                first.after = entry.after
                first.partial = first.partial or entry.partial or session_gap
                first.bytes = entry.bytes
                first.modified_at = entry.modified_at

    @staticmethod
    def _selected_turn(session: _Session, turn_id: str | None) -> _Turn | None:
        if turn_id == "current":
            return session.turns[-1] if session.turns else None
        return next(
            (
                turn
                for turn in reversed(session.turns)
                if (
                    turn.turn_id == turn_id
                    if turn_id
                    else turn.finished
                    and any(f.operation is not None for f in turn.files.values())
                )
            ),
            None,
        )

    def _entries(self, session: _Session, baseline: str, turn_id: str | None):
        turn = self._selected_turn(session, turn_id)
        if baseline == "last_turn":
            return (turn.files if turn else {}), turn
        if turn_id is None:
            return session.files, turn
        entries = {}
        if turn is not None:
            for candidate in session.turns:
                for path, entry in candidate.files.items():
                    if entry.operation is not None:
                        entries[path] = _File(
                            session.files.get(path, entry).baseline,
                            entry.turn_id,
                            entry.operation,
                            entry.after,
                            entry.bytes,
                            entry.modified_at,
                            session.files.get(path, entry).partial,
                        )
                if candidate is turn:
                    break
        return entries, turn

    def comparison_metadata(
        self,
        session_id: str,
        baseline: str = "session",
        turn_id: str | None = None,
    ) -> dict[str, Any]:
        """Describe bounded captures without claiming complete attribution."""
        with self._lock:
            session = self._sessions.get(session_id)
            turns = (
                [
                    turn
                    for turn in session.turns
                    if not turn.finished
                    or any(f.operation is not None for f in turn.files.values())
                ]
                if session
                else []
            )
            selected = self._selected_turn(session, turn_id) if session else None
            partial = session and any(f.partial for f in session.files.values())
            return {
                "source": "agent",
                "turns": [
                    {
                        "id": t.turn_id,
                        "label": f"Captured tool turn {t.turn_id}",
                        "finished": t.finished,
                        "created_at": t.created_at,
                    }
                    for t in reversed(turns)
                ],
                "turn_id": selected.turn_id if selected else None,
                "coverage": "partial" if partial else "observed_tools" if turns else "unavailable",
                "warning": (
                    "Only captured tool mutations are included. Shell effects, external edits "
                    "and uncaptured content are unknown. Recent turns are bounded. "
                    + (
                        "Capture continuity is incomplete or external edits were interleaved. "
                        if partial
                        else ""
                    )
                    if turns
                    else "No captured agent history is available for this session."
                ),
            }

    def list_files(
        self,
        session_id: str,
        baseline: str = "session",
        turn_id: str | None = None,
        scope: str = "",
    ) -> list[dict[str, Any]]:
        """List recorded agent mutations, independent of Git or current disk status."""
        with self._lock:
            session = self._sessions.get(session_id)
            if session is None:
                return []
            records = []
            entries, _turn = self._entries(session, baseline, turn_id)
            scope_path = Path(scope) if Path(scope).is_absolute() else self.workspace_root / scope
            scope_path = Path(os.path.abspath(scope_path))
            for path, entry in entries.items():
                if not (self.workspace_root / path).is_relative_to(scope_path):
                    continue
                status = entry.operation
                if status is None:
                    continue
                if entry.baseline.known:
                    if entry.baseline.before is None:
                        if status == "deleted":
                            continue
                        status = "created"
                    else:
                        status = "deleted" if status == "deleted" else "modified"
                records.append(
                    {
                        "path": path,
                        "name": Path(path).name,
                        "status": status,
                        "bytes": entry.bytes,
                        "modified_at": entry.modified_at,
                        "lines_added": None,
                        "lines_removed": None,
                        "coverage": "partial" if entry.partial else "observed_tools",
                        "before_known": entry.baseline.known,
                        "after_known": entry.after.known,
                    }
                )
            return sorted(
                records, key=lambda row: (row["modified_at"] or 0, row["path"]), reverse=True
            )

    def lookup(
        self,
        session_id: str,
        path: str,
        last_turn: bool,
        turn_id: str | None = None,
    ) -> dict[str, Any] | None:
        """Return a baseline only for recorded mutations, never a Git fallback.

        ``turn_id`` identifies the turn that supplied this baseline.
        Last-turn after-images are captured on record, never read during lookup.
        Session comparisons use the latest captured postimage as well.
        """
        norm = self._path(path)
        if norm is None:
            return None
        with self._lock:
            session = self._sessions.get(session_id)
            if session is None or not session.turns:
                return None
            entries, turn = self._entries(
                session, "last_turn" if last_turn else "session", turn_id
            )
            entry = entries.get(norm)
            if entry is None or entry.operation is None:
                return None
            return {
                "workspace_root": str(self.workspace_root),
                "path": norm,
                "before": entry.baseline.before,
                "known": entry.baseline.known,
                "reason": entry.baseline.reason,
                "after": entry.after.before,
                "after_known": entry.after.known,
                "after_reason": entry.after.reason,
                "turn_id": entry.turn_id,
                "coverage": "partial" if entry.partial else "observed_tools",
                "warning": (
                    "Capture continuity is incomplete or external edits were interleaved; "
                    "these file images cannot be attributed exclusively to the agent."
                    if entry.partial
                    else "Captured tool mutations only; unobserved edits and gaps are unknown."
                ),
                "baseline": "last_turn" if last_turn else "session",
                "finished": turn.finished if turn else False,
                "operation": entry.operation,
            }

    def forget(self, session_id: str) -> None:
        """Release session baselines on registry teardown."""
        with self._lock:
            self._sessions.pop(session_id, None)
