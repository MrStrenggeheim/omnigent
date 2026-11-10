"""Explicit native-agent attachments: upload bytes read under the caller's OS permissions."""

from __future__ import annotations

import mimetypes
from pathlib import Path

import httpx

MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024


def read_attachment(path: Path) -> bytes:
    import os
    import stat

    descriptor = os.open(path, os.O_RDONLY | os.O_NONBLOCK)
    with os.fdopen(descriptor, "rb") as stream:
        if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
            raise ValueError("Attachments must be regular files")
        content = stream.read(MAX_ATTACHMENT_BYTES + 1)
    if len(content) > MAX_ATTACHMENT_BYTES:
        raise ValueError("Attachment exceeds 50 MB")
    return content


async def upload_attachment(
    client: httpx.AsyncClient,
    session_id: str,
    *,
    filename: str,
    content: bytes,
    source_id: str | None = None,
) -> dict:
    from urllib.parse import quote

    if len(content) > MAX_ATTACHMENT_BYTES:
        raise ValueError("Attachment exceeds 50 MB")
    response = await client.post(
        f"/v1/sessions/{quote(session_id, safe='')}/attachments",
        files={
            "file": (
                filename,
                content,
                mimetypes.guess_type(filename)[0] or "application/octet-stream",
            )
        },
        headers={"Idempotency-Key": source_id} if source_id else {},
    )
    response.raise_for_status()
    return response.json()
