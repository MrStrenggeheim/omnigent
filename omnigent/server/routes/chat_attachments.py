"""Read local Markdown references through the message's captured filesystem scope."""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import mimetypes
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Request, Response

from omnigent.db.db_models import current_workspace_id
from omnigent.entities.conversation import MessageData
from omnigent.server.auth import LEVEL_OWNER
from omnigent.server.routes._auth_helpers import require_access, require_user
from omnigent.server.workbench_resources import HostWorkspaceResources, relative_path
from omnigent.server.workbench_workspace_service import WorkbenchWorkspaceService
from omnigent.stores.artifact_store import ArtifactStore


def create_chat_attachments_router(
    service: WorkbenchWorkspaceService,
    artifact_store: ArtifactStore | None = None,
) -> APIRouter:
    router = APIRouter(prefix="/sessions/{session_id}/attachments")

    @router.get("/references/{item_id}")
    async def reference(request: Request, session_id: str, item_id: str, path: str):
        user = require_user(request, service.auth_provider)
        await require_access(
            user, session_id, LEVEL_OWNER, service.permission_store, service.conversation_store
        )
        item = await asyncio.to_thread(service.conversation_store.get_item, session_id, item_id)
        if item is None or not isinstance(item.data, MessageData):
            raise HTTPException(404, "Source message not found")
        scope = item.data.resource_scope
        if not scope or not scope.get("workspace"):
            raise HTTPException(
                409, "This message has no captured workspace; attach the file explicitly"
            )
        # Reference snapshots stay private to the reader; they must not turn a
        # private workspace path into a file shared with every chat participant.
        snapshot_id = (
            "chat-reference-"
            + hashlib.sha256(
                json.dumps([current_workspace_id(), user, session_id, item_id, path]).encode()
            ).hexdigest()
        )

        def stored_response(filename, mime, content):
            return Response(
                content,
                media_type=mime or "application/octet-stream",
                headers={
                    "Content-Disposition": "attachment; filename*=UTF-8''"
                    + quote(filename, safe=""),
                    "X-Content-Type-Options": "nosniff",
                    "Cache-Control": "private, no-store",
                },
            )

        if artifact_store is not None and await asyncio.to_thread(
            artifact_store.exists, snapshot_id
        ):
            cached = json.loads(await asyncio.to_thread(artifact_store.get, snapshot_id))
            return stored_response(
                cached["filename"],
                cached["mime"],
                base64.b64decode(cached["content"], validate=True),
            )
        workspace = await service.resolve_session(request, session_id, captured=scope)
        if scope.get("generation") and workspace.generation != scope["generation"]:
            raise HTTPException(409, "The original workspace generation is no longer available")
        path = relative_path(workspace, path)
        if not path:
            raise HTTPException(400, "A file path is required")
        if workspace.target_kind == "runneronly":
            # Keep the runner's original identity; never fall back to the host.
            from starlette.requests import Request as StarletteRequest

            from omnigent.server.workbench_resources import RunnerWorkspaceResources

            scope_copy = dict(request.scope, query_string=b"download=true")
            response = await RunnerWorkspaceResources(service, workspace).dispatch(
                StarletteRequest(scope_copy),
                "environments/default/filesystem/" + path,
                {},
            )
            response.headers["Content-Disposition"] = "attachment; filename*=UTF-8''" + quote(
                path.replace("\\", "/").split("/")[-1], safe=""
            )
            response.headers["X-Content-Type-Options"] = "nosniff"
            response.headers["Cache-Control"] = "private, no-store"
        else:
            adapter = HostWorkspaceResources(service, workspace)
            response = await adapter.download_file(path, max_bytes=50 * 1024 * 1024)
            response.headers["Content-Type"] = (
                mimetypes.guess_type(path)[0] or "application/octet-stream"
            )
            response.headers["X-Content-Type-Options"] = "nosniff"
            response.headers["Cache-Control"] = "private, no-store"
        if artifact_store is None or response.status_code >= 400:
            return response
        if hasattr(response, "body_iterator"):
            data = bytearray()
            iterator = response.body_iterator.__aiter__()
            try:
                async for chunk in iterator:
                    data.extend(chunk.encode() if isinstance(chunk, str) else chunk)
                    if len(data) > 50 * 1024 * 1024:
                        raise HTTPException(413, "Attachment exceeds 50 MB")
            finally:
                close = getattr(iterator, "aclose", None)
                if close is not None:
                    await close()
            content = bytes(data)
        else:
            content = bytes(response.body)
        if len(content) > 50 * 1024 * 1024:
            raise HTTPException(413, "Attachment exceeds 50 MB")
        filename = path.replace("\\", "/").split("/")[-1]
        mime = response.headers.get("Content-Type", "application/octet-stream")
        cached = {
            "filename": filename,
            "mime": mime,
            "content": base64.b64encode(content).decode("ascii"),
        }
        await asyncio.to_thread(artifact_store.put, snapshot_id, json.dumps(cached).encode())
        return stored_response(filename, mime, content)

    return router
