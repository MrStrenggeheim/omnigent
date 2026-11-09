"""Owner-authorized manual terminals addressed independently of conversations."""

from __future__ import annotations

import asyncio
import base64
import contextlib
import uuid
from pathlib import Path
from typing import Any, cast

from fastapi import APIRouter, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, ConfigDict, Field

from omnigent.errors import OmnigentError
from omnigent.host.frames import HostTerminalStreamFrame, encode_host_frame
from omnigent.process_logging import data_dir
from omnigent.server.workbench_terminal_service import WorkbenchTerminalService, terminal_resource
from omnigent.server.workbench_workspace_service import WorkbenchWorkspaceService


class CreateManualTerminal(BaseModel):
    model_config = ConfigDict(extra="forbid")

    terminal: str = Field(default="shell", max_length=256)
    session_key: str | None = Field(default=None, max_length=128)
    usage_session_id: str | None = Field(default=None, max_length=128)


def create_workbench_terminals_router(
    service: WorkbenchWorkspaceService, *, cache_dir: Path | None = None
) -> APIRouter:
    router = APIRouter(prefix="/workbench-workspaces/{workspace_id}/terminals")
    terminals = WorkbenchTerminalService(
        service, cache_dir or data_dir() / "workbench-terminal-cache"
    )

    @router.get("")
    async def list_terminals(request: Request, workspace_id: str) -> dict[str, Any]:
        workspace = await service.require_workspace(request, workspace_id)
        records, connected = await terminals.list(workspace)
        return {
            "data": [terminal_resource(record, connected=connected) for record in records],
            "object": "list",
            "has_more": False,
            "available": connected,
        }

    @router.get("/options")
    async def terminal_options(request: Request, workspace_id: str) -> dict[str, Any]:
        workspace = await service.require_workspace(request, workspace_id)
        conn = await terminals.connection(workspace)
        shells = conn.hello.interactive_shells or []
        return {
            "data": [{"name": Path(shell).name, "command": shell} for shell in shells],
            "default": "shell",
        }

    @router.post("")
    async def create_terminal(
        request: Request, workspace_id: str, body: CreateManualTerminal
    ) -> dict[str, Any]:
        workspace = await service.require_workspace(request, workspace_id, write=True)
        # usage_session_id is a client provenance hint, never ownership or authority.
        result = await terminals.rpc(
            workspace, "create", {"terminal": body.terminal, "session_key": body.session_key}
        )
        return terminal_resource(result["terminal"])

    @router.get("/{terminal_id}")
    async def get_terminal(
        request: Request, workspace_id: str, terminal_id: str
    ) -> dict[str, Any]:
        workspace = await service.require_workspace(request, workspace_id)
        records, connected = await terminals.list(workspace)
        record = next((r for r in records if r["id"] == terminal_id), None)
        if record is None:
            raise HTTPException(404, "Terminal not found")
        return terminal_resource(record, connected=connected)

    async def stop(request: Request, workspace_id: str, terminal_id: str) -> dict[str, Any]:
        workspace = await service.require_workspace(request, workspace_id, write=True)
        result = await terminals.rpc(workspace, "stop", {"terminal_id": terminal_id})
        return terminal_resource(result["terminal"])

    router.add_api_route("/{terminal_id}/stop", stop, methods=["POST"])
    router.add_api_route("/{terminal_id}", stop, methods=["DELETE"])

    @router.websocket("/{terminal_id}/attach")
    async def attach(
        websocket: WebSocket,
        workspace_id: str,
        terminal_id: str,
        read_only: bool = Query(default=False),
    ) -> None:
        try:
            workspace = await service.require_workspace(
                cast(Request, websocket), workspace_id, write=not read_only
            )
            conn = await terminals.connection(workspace)
        except HTTPException as exc:
            await websocket.close(
                code=4403
                if exc.status_code in {401, 403}
                else 4404
                if exc.status_code == 404
                else 1013
            )
            return
        except OmnigentError:
            await websocket.close(code=4403)
            return
        await websocket.accept()
        channel_id = uuid.uuid4().hex
        queue: asyncio.Queue[HostTerminalStreamFrame] = asyncio.Queue(maxsize=128)
        conn.terminal_channels[channel_id] = queue

        def send(frame: HostTerminalStreamFrame) -> None:
            service.host_registry.send_text(conn, encode_host_frame(frame))

        async def output() -> None:
            while True:
                frame = await queue.get()
                if frame.event == "bytes":
                    await websocket.send_bytes(base64.b64decode(frame.data, validate=True))
                elif frame.event == "text":
                    await websocket.send_text(frame.data)
                else:
                    await websocket.close(code=frame.code, reason=frame.data[:120])
                    return

        async def input_() -> None:
            while True:
                message = await websocket.receive()
                if message["type"] == "websocket.disconnect":
                    return
                if message.get("bytes") is not None and not read_only:
                    data = message["bytes"]
                    for offset in range(0, len(data), 48 * 1024):
                        send(
                            HostTerminalStreamFrame(
                                channel_id,
                                "bytes",
                                base64.b64encode(data[offset : offset + 48 * 1024]).decode(),
                            )
                        )
                elif message.get("text") is not None:
                    if len(message["text"]) > 100_000:
                        await websocket.close(code=1009)
                        return
                    send(HostTerminalStreamFrame(channel_id, "text", message["text"]))

        tasks: list[asyncio.Task[None]] = []
        try:
            await terminals.rpc(
                workspace,
                "attach",
                {"terminal_id": terminal_id, "channel_id": channel_id, "read_only": read_only},
                conn=conn,
            )
            tasks = [asyncio.create_task(output()), asyncio.create_task(input_())]
            done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for task in done:
                task.result()
        except HTTPException as exc:
            await websocket.close(code=4404 if exc.status_code == 404 else 1013)
        except (ConnectionError, WebSocketDisconnect):
            with contextlib.suppress(RuntimeError, WebSocketDisconnect):
                await websocket.close(code=1013)
        finally:
            conn.terminal_channels.pop(channel_id, None)
            with contextlib.suppress(ConnectionError):
                send(HostTerminalStreamFrame(channel_id, "close"))
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)

    return router
