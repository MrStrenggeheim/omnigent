"""Host-owned manual terminals, independent of runners and conversation cleanup."""

from __future__ import annotations

import asyncio
import base64
import contextlib
import json
import logging
import os
import time
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, cast

from fastapi import WebSocket

from omnigent.host.frames import HostTerminalRequestFrame, HostTerminalStreamFrame
from omnigent.inner.datamodel import OSEnvSpec, TerminalEnvSpec
from omnigent.inner.terminal import TerminalInstance, create_terminal_instance
from omnigent.terminals.control_bridge import bridge_tmux_control_to_websocket
from omnigent.terminals.ws_common import WS_CLOSE_TERMINAL_NOT_FOUND

logger = logging.getLogger(__name__)
OUTPUT_BYTES = 64 * 1024
HISTORY_LIMIT = 128
ACTIVE_LIMIT = 32
STREAM_CHUNK_BYTES = 48 * 1024


@dataclass
class ManualTerminal:
    """Durable lifecycle evidence; a lost host connection never means exit."""

    id: str
    workspace_id: str
    root: str
    name: str
    session: str
    created_at: float
    state: str = "running"
    exited_at: float | None = None
    exit_code: int | None = None
    output: str = ""
    socket_path: str = ""
    private_dir: str = ""
    cwd: str | None = None

    def public(self) -> dict[str, Any]:
        value = asdict(self)
        value.pop("socket_path")
        value.pop("private_dir")
        value["running"] = self.state == "running"
        value["connectivity"] = "connected"
        return value


class TerminalChannel:
    """Adapt the shared tmux WS bridge to one host-tunnel channel."""

    def __init__(
        self,
        channel_id: str,
        send: Callable[[HostTerminalStreamFrame], Awaitable[None]],
        final_snapshot: Callable[[], str | None] | None = None,
    ):
        self.id = channel_id
        self.send = send
        self.queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=128)
        self.closed = False
        self.final_snapshot = final_snapshot

    async def receive(self) -> dict[str, Any]:
        return await self.queue.get()

    def feed(self, frame: HostTerminalStreamFrame) -> None:
        if self.closed:
            return
        if frame.event == "close":
            message = {"type": "websocket.disconnect", "code": frame.code}
        elif frame.event == "bytes":
            message = {
                "type": "websocket.receive",
                "bytes": base64.b64decode(frame.data, validate=True),
            }
        else:
            message = {"type": "websocket.receive", "text": frame.data}
        try:
            self.queue.put_nowait(message)
        except asyncio.QueueFull:
            # Detach a slow client without blocking the shared host control tunnel.
            self.queue.get_nowait()
            self.queue.put_nowait({"type": "websocket.disconnect", "code": 1013})
            self.closed = True

    async def send_bytes(self, data: bytes) -> None:
        for offset in range(0, len(data), STREAM_CHUNK_BYTES):
            await self.send(
                HostTerminalStreamFrame(
                    self.id,
                    "bytes",
                    base64.b64encode(data[offset : offset + STREAM_CHUNK_BYTES]).decode(),
                )
            )

    async def send_text(self, data: str) -> None:
        if len(data) > 100_000:
            raise ValueError("terminal control message too large")
        await self.send(HostTerminalStreamFrame(self.id, "text", data))

    async def close(self, code: int = 1000, reason: str = "") -> None:
        self.closed = True
        if code == WS_CLOSE_TERMINAL_NOT_FOUND and self.final_snapshot is not None:
            snapshot = self.final_snapshot()
            if snapshot:
                # Exit cleanup can beat control-mode delivery of a short-lived command's tail.
                await self.send_bytes(b"\x1b[0m\x1b[2J\x1b[H" + snapshot.encode())
        await self.send(HostTerminalStreamFrame(self.id, "close", reason[:120], code))


class HostWorkbenchTerminals:
    """One registry per host daemon; neither chat nor runner teardown can reach it."""

    def __init__(self, path: Path, shells: list[str]):
        self.path = path
        self.shells = shells
        self.records: dict[str, ManualTerminal] = {}
        self.instances: dict[str, TerminalInstance] = {}
        self.channels: dict[str, TerminalChannel] = {}
        self._channel_tasks: dict[str, asyncio.Task[None]] = {}
        self._lock = asyncio.Lock()
        self._monitor: asyncio.Task[None] | None = None
        if path.exists():
            for raw in json.loads(path.read_text()):
                record = ManualTerminal(**raw)
                # Previous daemon shutdown may have been abrupt; preserve uncertainty.
                if record.state == "running":
                    record.state = "unknown"
                self.records[record.id] = record

    def _persist(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        retired = [r for r in self.records.values() if r.state != "running"]
        by_workspace: dict[str, list[ManualTerminal]] = {}
        for record in retired:
            by_workspace.setdefault(record.workspace_id, []).append(record)
        for records in by_workspace.values():
            for record in sorted(records, key=lambda r: r.created_at, reverse=True)[
                HISTORY_LIMIT:
            ]:
                self.records.pop(record.id, None)
        temporary = self.path.with_suffix(".tmp")
        with open(temporary, "w", opener=lambda p, flags: os.open(p, flags, 0o600)) as stream:
            json.dump([asdict(r) for r in self.records.values()], stream)
        temporary.replace(self.path)

    async def _refresh(self, record: ManualTerminal) -> None:
        instance = self.instances.get(record.id)
        if instance is None:
            return
        if await instance.is_alive():
            result = await instance.read(scrollback=2000)
            output = result.get("screen")
            if isinstance(output, str):
                record.output = output.encode()[-OUTPUT_BYTES:].decode(errors="ignore")
        else:
            record.output = (
                (instance.last_exit_text() or instance.last_pane_text() or record.output)
                .encode()[-OUTPUT_BYTES:]
                .decode(errors="ignore")
            )
            record.state = "exited"
            record.exit_code = instance.last_exit_status()
            record.exited_at = time.time()
            self._persist()
            await instance.close()
            self.instances.pop(record.id, None)

    async def _watch(self) -> None:
        while True:
            await asyncio.sleep(1)
            try:
                async with self._lock:
                    for record in list(self.records.values()):
                        await self._refresh(record)
            except Exception:
                logger.exception("Manual terminal lifecycle polling failed")

    async def request(self, frame: HostTerminalRequestFrame) -> dict[str, Any]:
        if self._monitor is None:
            self._monitor = asyncio.create_task(self._watch())
        async with self._lock:
            root = str(Path(frame.workspace).expanduser().resolve())
            matching = [r for r in self.records.values() if r.workspace_id == frame.workspace_id]
            if any(r.root != root for r in matching):
                raise ValueError("workspace target changed")
            if frame.op == "create":
                if not Path(root).is_dir():
                    raise FileNotFoundError("workspace directory is missing")
                if sum(r.state == "running" for r in matching) >= ACTIVE_LIMIT:
                    raise ValueError("workspace terminal limit reached")
                requested_cwd = frame.params.get("cwd", "")
                if not isinstance(requested_cwd, str) or "\x00" in requested_cwd:
                    raise ValueError("invalid terminal working directory")
                cwd = (Path(root) / requested_cwd).resolve()
                if not cwd.is_relative_to(Path(root)):
                    raise ValueError("terminal working directory is outside the workspace")
                if not cwd.is_dir():
                    raise FileNotFoundError("terminal working directory is missing")
                shell = frame.params.get("terminal")
                if shell in (None, "", "$SHELL", "shell"):
                    preferred = os.environ.get("SHELL", "")
                    shell = next(
                        (
                            s
                            for s in self.shells
                            if s == preferred or Path(s).name == Path(preferred).name
                        ),
                        self.shells[0] if self.shells else "bash",
                    )
                shell = next((s for s in self.shells if s == shell or Path(s).name == shell), None)
                if shell is None:
                    raise ValueError("shell is not installed on the target host")
                terminal_id = uuid.uuid4().hex
                session = frame.params.get("session_key") or terminal_id[:8]
                if not isinstance(session, str) or len(session) > 128:
                    raise ValueError("invalid session key")
                created = create_terminal_instance(
                    "manual",
                    terminal_id,
                    TerminalEnvSpec(
                        command=shell,
                        os_env=OSEnvSpec(cwd=str(cwd)),
                        keep_alive_after_exit=True,
                        scrollback=2000,
                    ),
                )
                record = ManualTerminal(
                    terminal_id,
                    frame.workspace_id,
                    root,
                    Path(shell).name,
                    session,
                    time.time(),
                    socket_path=str(created.instance.socket_path),
                    private_dir=str(created.instance.private_dir),
                    cwd=str(cwd),
                )
                try:
                    await created.instance.launch(cwd=created.cwd)
                    self.instances[terminal_id] = created.instance
                    self.records[terminal_id] = record
                    await self._refresh(record)
                    self._persist()
                except BaseException:
                    self.instances.pop(terminal_id, None)
                    self.records.pop(terminal_id, None)
                    await created.instance.close()
                    raise
                return {"terminal": record.public()}
            if frame.op == "list":
                for record in matching:
                    await self._refresh(record)
                return {"terminals": [r.public() for r in matching], "shells": self.shells}
            terminal_id = frame.params.get("terminal_id")
            record = self.records.get(str(terminal_id))
            if record is None or record.workspace_id != frame.workspace_id:
                raise FileNotFoundError("terminal not found")
            await self._refresh(record)
            if frame.op == "stop":
                instance = self.instances.get(record.id)
                if instance is not None:
                    # Retain the last screen before explicit termination removes tmux.
                    self._persist()
                    await instance.close()
                    record.state = "stopped"
                    record.exited_at = time.time()
                    self._persist()
                    self.instances.pop(record.id, None)
                elif record.state == "unknown":
                    raise ConnectionError("terminal process state is unknown")
            elif frame.op not in {"get", "attach"}:
                raise ValueError("unsupported terminal operation")
            return {"terminal": record.public()}

    async def attach(
        self,
        frame: HostTerminalRequestFrame,
        send: Callable[[HostTerminalStreamFrame], Awaitable[None]],
    ) -> None:
        terminal_id = str(frame.params.get("terminal_id"))
        channel_id = str(frame.params["channel_id"])
        record = self.records[terminal_id]
        channel = TerminalChannel(
            channel_id, send, lambda: record.output if record.state == "exited" else None
        )
        self.channels[channel_id] = channel
        task = asyncio.current_task()
        if task is not None:
            self._channel_tasks[channel_id] = task
        try:
            instance = self.instances.get(terminal_id)
            if instance is None:
                await channel.send_bytes(record.output.encode())
                await channel.close(
                    code=1000 if record.state in {"stopped", "exited"} else 1013,
                    reason=record.state,
                )
                return
            await bridge_tmux_control_to_websocket(
                cast(WebSocket, channel),
                socket_path=str(instance.socket_path),
                tmux_target=instance.tmux_target,
                read_only=bool(frame.params.get("read_only", False)),
            )
        finally:
            self.channels.pop(channel_id, None)
            self._channel_tasks.pop(channel_id, None)

    async def detach_all(self) -> None:
        tasks = list(self._channel_tasks.values())
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    async def shutdown(self) -> None:
        await self.detach_all()
        if self._monitor is not None:
            self._monitor.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._monitor
        async with self._lock:
            for record in list(self.records.values()):
                if record.id in self.instances:
                    await self._refresh(record)
                    instance = self.instances.get(record.id)
                    if instance is not None:
                        self._persist()
                        await instance.close()
                        record.state = "stopped"
                        record.exited_at = time.time()
                        self._persist()
            self.instances.clear()
            self._persist()
