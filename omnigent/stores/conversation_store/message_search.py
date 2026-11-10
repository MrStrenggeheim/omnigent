"""Bounded message-search results and query-bound keyset cursors."""

from __future__ import annotations

import base64
import binascii
import hashlib
import json
import re
import sqlite3
import time
from collections.abc import Iterator
from contextlib import contextmanager
from itertools import islice
from typing import Any

from pydantic import BaseModel

MAX_SEARCH_TEXT = 32_768
MAX_SEARCH_QUERY = 512
MAX_SEARCH_OCCURRENCES = 1024


class MessageSearchRange(BaseModel):
    """Half-open UTF-16 offsets into a result's text."""

    start: int
    end: int


class MessageSearchHit(BaseModel):
    session_id: str
    title: str | None
    item_id: str
    role: str
    created_at: int
    text: str
    content_hash: str
    snippet: str
    snippet_start: int
    ranges: list[MessageSearchRange]
    occurrence_count: int
    text_start: int
    text_truncated: bool


class MessageSearchPage(BaseModel):
    data: list[MessageSearchHit]
    has_more: bool
    next_cursor: str | None


def literal_matcher(query: str) -> re.Pattern[str]:
    """Use literal Unicode case-insensitive matching without query syntax."""
    return re.compile(re.escape(query), re.IGNORECASE)


@contextmanager
def sqlite_message_search(
    connection: sqlite3.Connection, matcher: re.Pattern[str], timeout_ms: int
) -> Iterator[None]:
    """Bound SQLite scans and keep Unicode matching identical to result ranges."""
    deadline = time.monotonic() + timeout_ms / 1000

    def matches(value: str | None) -> int:
        if not value:
            return 0
        # SQLite cannot run its progress handler inside a Python UDF.
        # Overlap windows so a literal query can span a chunk boundary.
        for start in range(0, len(value), MAX_SEARCH_TEXT):
            if time.monotonic() >= deadline:
                connection.interrupt()
                return 0
            found = matcher.search(value, start, start + MAX_SEARCH_TEXT + MAX_SEARCH_QUERY - 1)
            if time.monotonic() >= deadline:
                connection.interrupt()
                return 0
            if found is not None:
                return 1
        return 0

    connection.create_function("omnigent_message_matches", 1, matches)
    connection.set_progress_handler(lambda: int(time.monotonic() >= deadline), 10_000)
    try:
        yield
    finally:
        connection.set_progress_handler(None, 0)
        connection.create_function("omnigent_message_matches", 1, None)


def utf16_length(text: str) -> int:
    """Count JavaScript string offsets without splitting astral characters."""
    return len(text.encode("utf-16-le")) // 2


def build_message_hit(
    *,
    source: str,
    matcher: re.Pattern[str],
    session_id: str,
    title: str | None,
    item_id: str,
    role: str,
    created_at: int,
) -> MessageSearchHit | None:
    """Retain raw block-joined source and locate every match in a bounded window."""
    first = matcher.search(source)
    if first is None:
        return None
    start = max(0, first.start() - 60) if len(source) > MAX_SEARCH_TEXT else 0
    bounded = source[start : start + MAX_SEARCH_TEXT]
    matches = list(islice(matcher.finditer(bounded), MAX_SEARCH_OCCURRENCES + 1))
    if len(matches) > MAX_SEARCH_OCCURRENCES:
        bounded = bounded[: matches[MAX_SEARCH_OCCURRENCES].start()]
        matches = matches[:MAX_SEARCH_OCCURRENCES]
    # One prefix map also handles thousands of repeated matches in linear time.
    offsets = [0]
    for character in bounded:
        offsets.append(offsets[-1] + (2 if ord(character) > 0xFFFF else 1))
    ranges = [MessageSearchRange(start=offsets[m.start()], end=offsets[m.end()]) for m in matches]
    snippet_start = max(0, matches[0].start() - 60)
    snippet_end = min(len(bounded), snippet_start + 240)
    return MessageSearchHit(
        session_id=session_id,
        title=title,
        item_id=item_id,
        role=role,
        created_at=created_at,
        text=bounded,
        content_hash=hashlib.sha256(bounded.encode("utf-8")).hexdigest(),
        snippet=bounded[snippet_start:snippet_end],
        snippet_start=offsets[snippet_start],
        ranges=ranges,
        occurrence_count=len(ranges),
        text_start=utf16_length(source[:start]),
        text_truncated=start > 0 or len(bounded) < len(source),
    )


def search_fingerprint(scope: dict[str, Any]) -> str:
    """Bind pagination to query, authority, workspace, server and filters."""
    return hashlib.sha256(json.dumps(scope, sort_keys=True).encode()).hexdigest()


def encode_search_cursor(
    fingerprint: str, session_id: str, position: int, item_id: str, created_at: int
) -> str:
    payload = [1, fingerprint, session_id, position, item_id, created_at]
    return base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")


def decode_search_cursor(cursor: str, fingerprint: str) -> tuple[str, int, str, int]:
    """Validate cursors before using their keyset; ACLs are reapplied on every page."""
    try:
        if len(cursor) > 1024:
            raise ValueError
        payload = json.loads(
            base64.b64decode(cursor + "=" * (-len(cursor) % 4), altchars=b"-_", validate=True)
        )
        version, scope, session_id, position, item_id, created_at = payload
        if version != 1 or scope != fingerprint:
            raise ValueError
        for identifier in (session_id, item_id):
            if not isinstance(identifier, str) or not re.fullmatch(r"[0-9a-f]{32}", identifier):
                raise ValueError
        if (
            type(position) is not int
            or not 0 <= position <= 2**31 - 1
            or type(created_at) is not int
            or not -(2**31) <= created_at <= 2**31 - 1
        ):
            raise ValueError
        return session_id, position, item_id, created_at
    except (ValueError, TypeError, binascii.Error, UnicodeError) as exc:
        raise ValueError("Invalid message search cursor or changed search scope") from exc
