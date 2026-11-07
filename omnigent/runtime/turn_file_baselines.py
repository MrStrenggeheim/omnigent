"""Bounded, prospective baselines for observed file tools, independent of Git.

Use the resolved registry's ``turn_history`` for both lifecycle and lookup.
``last_turn=True`` selects the latest started turn, including an active one;
``False`` selects the first observed mutation during this store's session lifetime.
Neither view is a complete filesystem snapshot, and neither survives a restart.
"""

from __future__ import annotations

import os
import stat
import threading
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


@dataclass
class _Turn:
    turn_id: str
    finished: bool = False
    files: dict[str, _File] = field(default_factory=dict)


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
    ) -> None:
        if min(max_file_bytes, max_session_bytes, max_sessions, max_paths) <= 0:
            raise ValueError("Baseline limits must be positive")
        self.workspace_root = workspace_root.resolve()
        self._max_file_bytes = max_file_bytes
        self._max_session_bytes = max_session_bytes
        self._max_sessions = max_sessions
        self._max_paths = max_paths
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
            del session.turns[:-2]
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
            entry.operation = operation
            entry.after = _Baseline(None, False)
            after = self._read_after(path, norm)
            if session.content_bytes() + after.size > self._max_session_bytes:
                after = _Baseline(None, False, reason="after_session_limit")
            entry.after = after
            first = session.files.get(norm)
            if first is None and len(session.files) < self._max_paths:
                session.files[norm] = _File(entry.baseline, turn.turn_id, operation)
            elif first is not None:
                first.operation = operation

    def lookup(self, session_id: str, path: str, last_turn: bool) -> dict[str, Any] | None:
        """Return a baseline only for recorded mutations, never a Git fallback.

        ``turn_id`` identifies the turn that supplied this baseline.
        Last-turn after-images are captured on record, never read during lookup.
        Session comparison callers read current contents separately.
        """
        norm = self._path(path)
        if norm is None:
            return None
        with self._lock:
            session = self._sessions.get(session_id)
            if session is None or not session.turns:
                return None
            turn = session.turns[-1]
            entry = (turn.files if last_turn else session.files).get(norm)
            if entry is None or entry.operation is None:
                return None
            return {
                "workspace_root": str(self.workspace_root),
                "path": norm,
                "before": entry.baseline.before,
                "known": entry.baseline.known,
                "reason": entry.baseline.reason,
                "after": entry.after.before if last_turn else None,
                "after_known": entry.after.known if last_turn else False,
                "after_reason": entry.after.reason if last_turn else "current_contents_required",
                "turn_id": entry.turn_id,
                "coverage": "observed_tools",
                "baseline": "last_turn" if last_turn else "session",
                "finished": turn.finished,
                "operation": entry.operation,
            }

    def forget(self, session_id: str) -> None:
        """Release session baselines on registry teardown."""
        with self._lock:
            self._sessions.pop(session_id, None)
