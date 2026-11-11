"""Authorized, bounded inspection of peer outbox messages and destination receipts."""

import asyncio
from typing import Any

from fastapi import APIRouter, Query, Request

from omnigent.entities.conversation import MessageData
from omnigent.errors import OmnigentError
from omnigent.server.auth import LEVEL_READ, AuthProvider
from omnigent.server.routes._auth_helpers import get_user_id, require_access_and_level
from omnigent.server.session_orchestration import peer_acknowledgement
from omnigent.stores.conversation_store import ConversationStore
from omnigent.stores.permission_store import PermissionStore


def register_peer_message_routes(
    router: APIRouter,
    *,
    conversation_store: ConversationStore,
    permission_store: PermissionStore | None,
    auth_provider: AuthProvider | None,
) -> None:
    @router.get("/sessions/{session_id}/peer-messages", response_model=None)
    async def list_peer_messages(
        request: Request,
        session_id: str,
        limit: int = Query(default=100, ge=1, le=200),
        after: str | None = Query(default=None),
    ) -> dict[str, Any]:
        """Inspect a bounded transcript page; continue via last_id even on empty pages."""
        user_id = get_user_id(request, auth_provider)
        await require_access_and_level(
            user_id, session_id, LEVEL_READ, permission_store, conversation_store
        )
        page = await asyncio.to_thread(
            conversation_store.list_items,
            session_id,
            limit=limit,
            after=after,
            order="desc",
            type="message",
        )
        data = []
        for item in page.data:
            origin = item.data.communication if isinstance(item.data, MessageData) else None
            if (
                origin is None
                or origin.kind != "peer"
                or origin.source_conversation_id != session_id
            ):
                continue
            wire = item.to_api_dict()
            wire["communication"]["delivery_state"] = "unknown"
            try:
                await require_access_and_level(
                    user_id,
                    origin.destination_conversation_id,
                    LEVEL_READ,
                    permission_store,
                    conversation_store,
                )
            except OmnigentError as exc:
                if exc.http_status not in (403, 404):
                    raise
            else:
                delivered = await asyncio.to_thread(
                    conversation_store.get_item,
                    origin.destination_conversation_id,
                    origin.message_id,
                )
                if (
                    delivered is not None
                    and isinstance(delivered.data, MessageData)
                    and delivered.data.communication is not None
                    and delivered.data.communication.source_conversation_id == session_id
                ):
                    receipt = peer_acknowledgement(delivered)
                    wire["communication"].update(
                        delivery_state=receipt["delivery_state"],
                        receipt=receipt["receipt"],
                    )
            data.append(wire)
        return {
            "object": "list",
            "data": data,
            "first_id": page.first_id,
            "last_id": page.last_id,
            "has_more": page.has_more,
        }
