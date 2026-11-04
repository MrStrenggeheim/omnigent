"""ASGI response ordering for handler-controlled gzip opt-outs."""

from __future__ import annotations

import copy

import pytest
from starlette.types import Message, Receive, Scope, Send

from omnigent.server.routes._gzip_route import SKIP_GZIP_STATE_KEY, _StateAwareGZipResponder


@pytest.mark.asyncio
@pytest.mark.parametrize("streaming", [False, True])
async def test_skipped_gzip_preserves_response_start_and_body(streaming: bool) -> None:
    """An opt-out forwards headers before every body, including streamed bodies."""
    body = b'{"encoding":"base64","content":"AA=="}'
    messages: list[Message] = [
        {
            "type": "http.response.start",
            "status": 200,
            "headers": [(b"content-type", b"application/json")],
        },
    ]
    if streaming:
        messages.append({"type": "http.response.body", "body": body[:10], "more_body": True})
        messages.append({"type": "http.response.body", "body": body[10:]})
    else:
        messages.append({"type": "http.response.body", "body": body})

    scope: Scope = {"type": "http", "state": {}}
    sent: list[Message] = []

    async def app(scope: Scope, _receive: Receive, send: Send) -> None:
        scope["state"][SKIP_GZIP_STATE_KEY] = True
        for message in messages:
            await send(copy.deepcopy(message))

    async def receive() -> Message:
        return {"type": "http.request", "body": b""}

    async def send(message: Message) -> None:
        sent.append(copy.deepcopy(message))

    responder = _StateAwareGZipResponder(app, 1024, 4, scope["state"])
    await responder(scope, receive, send)

    assert sent == messages
