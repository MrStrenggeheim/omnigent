"""Workspace terminal RPCs and bounded last-observed output for offline hosts."""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import uuid
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from omnigent.host.frames import (
    CAP_WORKBENCH_TERMINALS,
    HostTerminalRequestFrame,
    encode_host_frame,
)
from omnigent.server.host_registry import HostConnection
from omnigent.server.workbench_workspace_service import WorkbenchWorkspaceService
from omnigent.stores.workbench_workspace_store import WorkbenchWorkspace


class WorkbenchTerminalService:
    def __init__(self, service: WorkbenchWorkspaceService, cache_dir: Path):
        self.workspace_service = service
        self.cache_dir = cache_dir

    def _cache_path(self, workspace: WorkbenchWorkspace) -> Path:
        return self.cache_dir / (hashlib.sha256(workspace.id.encode()).hexdigest() + ".json")

    def _cached(self, workspace: WorkbenchWorkspace) -> list[dict[str, Any]]:
        path = self._cache_path(workspace)
        if not path.exists():
            return []
        return json.loads(path.read_text())

    def _save(self, workspace: WorkbenchWorkspace, records: list[dict[str, Any]]) -> None:
        path = self._cache_path(workspace)
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        temporary = path.with_suffix(".tmp")
        with open(temporary, "w", opener=lambda p, flags: os.open(p, flags, 0o600)) as stream:
            json.dump(records, stream)
        temporary.replace(path)

    async def connection(self, workspace: WorkbenchWorkspace) -> HostConnection:
        conn = await self.workspace_service.host_connection(workspace)
        if CAP_WORKBENCH_TERMINALS not in conn.hello.capabilities:
            raise HTTPException(409, "Host does not support workspace terminals; update the host")
        return conn

    async def rpc(
        self,
        workspace: WorkbenchWorkspace,
        op: str,
        params: dict[str, Any] | None = None,
        *,
        conn: HostConnection | None = None,
    ) -> dict[str, Any]:
        conn = conn or await self.connection(workspace)
        request_id = uuid.uuid4().hex
        future = asyncio.get_running_loop().create_future()
        conn.pending_terminals[request_id] = future
        try:
            frame = HostTerminalRequestFrame(
                request_id, workspace.id, workspace.root, op, params or {}
            )
            self.workspace_service.host_registry.send_text(conn, encode_host_frame(frame))
            reply = await asyncio.wait_for(future, timeout=20)
            if reply.error is not None:
                raise HTTPException(reply.error_status, reply.error)
            result = reply.payload
            if op == "list":
                self._save(workspace, result["terminals"])
            elif "terminal" in result:
                record = result["terminal"]
                records = [r for r in self._cached(workspace) if r["id"] != record["id"]]
                records.append(record)
                records.sort(key=lambda r: r["created_at"], reverse=True)
                # Host retains at most 128 retired and 32 running records per workspace.
                self._save(workspace, records[:160])
            return result
        except TimeoutError as exc:
            raise HTTPException(504, "Workspace host terminal operation timed out") from exc
        except ConnectionError as exc:
            raise HTTPException(503, "Workspace host disconnected") from exc
        finally:
            conn.pending_terminals.pop(request_id, None)

    async def list(self, workspace: WorkbenchWorkspace) -> tuple[list[dict[str, Any]], bool]:
        try:
            result = await self.rpc(workspace, "list")
            return result["terminals"], True
        except HTTPException as exc:
            if exc.status_code not in {503, 504}:
                raise
            return self._cached(workspace), False


def terminal_resource(record: dict[str, Any], *, connected: bool = True) -> dict[str, Any]:
    """Use the existing terminal resource projection without inventing a chat owner."""
    workspace_id, terminal_id = record["workspace_id"], record["id"]
    metadata = {
        **record,
        "terminal_name": record["name"],
        "session_key": record["session"],
        "running": connected and record["state"] == "running",
        "connectivity": "connected" if connected else "disconnected",
    }
    metadata["attachPath"] = (
        f"/v1/workbench-workspaces/{workspace_id}/terminals/{terminal_id}/attach"
    )
    return {
        "id": terminal_id,
        "type": "terminal",
        "name": record["name"],
        "session": record["session"],
        "running": metadata["running"],
        "workspace_id": workspace_id,
        "state": record["state"],
        "connectivity": metadata["connectivity"],
        "metadata": metadata,
        "attachPath": metadata["attachPath"],
    }
