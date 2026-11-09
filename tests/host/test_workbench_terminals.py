"""Manual terminals retain host-owned lifecycle evidence across chat cleanup."""

from __future__ import annotations

import asyncio
import base64
import json
import shutil
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from omnigent.host.frames import (
    HostTerminalRequestFrame,
    HostTerminalResultFrame,
    HostTerminalStreamFrame,
    decode_host_frame,
    encode_host_frame,
)
from omnigent.host.workbench_terminals import (
    HISTORY_LIMIT,
    OUTPUT_BYTES,
    HostWorkbenchTerminals,
    ManualTerminal,
    TerminalChannel,
)
from omnigent.terminals.registry import TerminalRegistry
from tests._helpers.polling import poll_until_async


@pytest.mark.parametrize(
    "frame",
    [
        HostTerminalRequestFrame("req", "workspace", "/tmp", "list"),
        HostTerminalResultFrame("req", {"terminals": []}),
        HostTerminalStreamFrame("channel", "bytes", "aGk="),
    ],
)
def test_terminal_frames_round_trip_without_chat_owner(frame) -> None:
    wire = encode_host_frame(frame)
    assert decode_host_frame(wire) == frame
    assert "session_id" not in json.loads(wire)


@pytest.mark.parametrize(
    "event,data",
    [("bad", ""), ("text", "x" * 100_001)],
    ids=["invalid-event", "oversized-control"],
)
def test_invalid_terminal_stream_is_rejected(event: str, data: str) -> None:
    with pytest.raises(ValueError, match="invalid terminal stream"):
        decode_host_frame(encode_host_frame(HostTerminalStreamFrame("channel", event, data)))


async def test_terminal_channel_chunks_output_and_bounds_input() -> None:
    sent = []

    async def send(frame):
        sent.append(frame)

    channel = TerminalChannel("channel", send)
    data = b"x" * 150_000
    await channel.send_bytes(data)
    assert b"".join(base64.b64decode(frame.data) for frame in sent) == data
    assert all(decode_host_frame(encode_host_frame(frame)) == frame for frame in sent)
    for _ in range(130):
        channel.feed(HostTerminalStreamFrame("channel", "bytes", "eA=="))
    assert channel.closed
    messages = [await channel.receive() for _ in range(channel.queue.qsize())]
    assert messages[-1]["type"] == "websocket.disconnect"


async def test_terminal_channel_flushes_captured_exit_before_close() -> None:
    sent = []

    async def send(frame):
        sent.append(frame)

    channel = TerminalChannel("channel", send, final_snapshot=lambda: "final command output")
    await channel.close(code=4404)
    assert sent[-1].event == "close"
    assert b"final command output" in base64.b64decode(sent[-2].data)


@pytest.mark.skipif(shutil.which("tmux") is None, reason="tmux unavailable")
async def test_chat_cleanup_detach_and_real_shell_exit(tmp_path: Path) -> None:
    registry = HostWorkbenchTerminals(tmp_path / "terminals.json", ["bash"])

    def request(op, **params):
        return HostTerminalRequestFrame("req", "workspace-a", str(tmp_path), op, params)

    try:
        cwd = tmp_path / "nested"
        cwd.mkdir()
        response = await registry.request(request("create", terminal="shell", cwd="nested"))
        assert response["terminal"]["cwd"] == str(cwd)
        assert response["terminal"]["root"] == str(tmp_path)
        terminal_id = response["terminal"]["id"]
        instance = registry.instances[terminal_id]
        # The chat registry owns none of these instances, even if a chat used the shell.
        await TerminalRegistry().cleanup_conversation("chat-that-used-this-workspace")
        await registry.detach_all()
        assert await instance.is_alive()
        with pytest.raises(FileNotFoundError):
            await registry.request(
                HostTerminalRequestFrame(
                    "req", "workspace-b", str(tmp_path), "stop", {"terminal_id": terminal_id}
                )
            )
        await instance.send("pwd; printf 'manual-terminal-exit-marker\\n'; exit 7\n")
        await poll_until_async(
            lambda: registry.records[terminal_id].state == "exited", timeout_s=10
        )
        record = (await registry.request(request("get", terminal_id=terminal_id)))["terminal"]
        assert record["exit_code"] == 7
        assert "manual-terminal-exit-marker" in record["output"]
        assert str(cwd) in record["output"]
        assert len(record["output"].encode()) <= OUTPUT_BYTES
        assert terminal_id not in registry.instances
        assert not instance.socket_path.exists()
        restored = HostWorkbenchTerminals(registry.path, ["bash"])
        assert restored.records[terminal_id].state == "exited"
        assert restored.records[terminal_id].output == record["output"]
    finally:
        await registry.shutdown()


@pytest.mark.skipif(shutil.which("tmux") is None, reason="tmux unavailable")
async def test_explicit_stop_retains_record_and_running_restart_is_unknown(tmp_path: Path) -> None:
    registry = HostWorkbenchTerminals(tmp_path / "terminals.json", ["bash"])

    def request(op, **params):
        return HostTerminalRequestFrame("req", "workspace", str(tmp_path), op, params)

    try:
        record = (await registry.request(request("create", terminal="bash")))["terminal"]
        terminal_id = record["id"]
        restored = HostWorkbenchTerminals(registry.path, ["bash"])
        assert restored.records[terminal_id].state == "unknown"
        assert restored.records[terminal_id].exited_at is None
        stopped = (await registry.request(request("stop", terminal_id=terminal_id)))["terminal"]
        assert stopped["state"] == "stopped"
        assert not stopped["running"]
        assert stopped["exited_at"] is not None
        assert terminal_id not in registry.instances
        assert (await registry.request(request("list")))["terminals"][0]["id"] == terminal_id
    finally:
        await registry.shutdown()


async def test_host_allows_only_installed_shells(tmp_path: Path) -> None:
    registry = HostWorkbenchTerminals(tmp_path / "terminals.json", ["bash"])
    try:
        with pytest.raises(ValueError, match="not installed"):
            await registry.request(
                HostTerminalRequestFrame(
                    "req",
                    "workspace",
                    str(tmp_path),
                    "create",
                    {"terminal": "bash; touch /tmp/nope"},
                )
            )
    finally:
        await registry.shutdown()


@pytest.mark.skipif(shutil.which("tmux") is None, reason="tmux unavailable")
async def test_real_tmux_attachment_detaches_without_stopping_shell(tmp_path: Path) -> None:
    registry = HostWorkbenchTerminals(tmp_path / "terminals.json", ["bash"])
    output = bytearray()

    async def send(frame):
        if frame.event == "bytes":
            output.extend(base64.b64decode(frame.data))

    def request(op, **params):
        return HostTerminalRequestFrame("req", "workspace", str(tmp_path), op, params)

    try:
        record = (await registry.request(request("create")))["terminal"]
        terminal_id = record["id"]
        frame = request("attach", terminal_id=terminal_id, channel_id="channel", read_only=False)
        await registry.request(frame)
        attach = asyncio.create_task(registry.attach(frame, send))
        await poll_until_async(lambda: "channel" in registry.channels)
        registry.channels["channel"].feed(
            HostTerminalStreamFrame("channel", "text", '{"type":"resize","cols":100,"rows":24}')
        )
        registry.channels["channel"].feed(
            HostTerminalStreamFrame(
                "channel", "bytes", base64.b64encode(b"printf 'attachment-marker\\n'\n").decode()
            )
        )
        await poll_until_async(lambda: b"attachment-marker" in output)
        registry.channels["channel"].feed(HostTerminalStreamFrame("channel", "close"))
        await asyncio.wait_for(attach, timeout=5)
        assert await registry.instances[terminal_id].is_alive()
        assert not registry.channels
    finally:
        await registry.shutdown()


async def test_stop_failure_does_not_report_success(tmp_path: Path) -> None:
    registry = HostWorkbenchTerminals(tmp_path / "terminals.json", ["bash"])
    record = ManualTerminal("terminal", "workspace", str(tmp_path), "bash", "s1", 1)
    registry.records[record.id] = record
    instance = SimpleNamespace(
        is_alive=AsyncMock(return_value=True),
        read=AsyncMock(return_value={"screen": "last output"}),
        close=AsyncMock(side_effect=RuntimeError("close failed")),
    )
    registry.instances[record.id] = instance
    try:
        with pytest.raises(RuntimeError, match="close failed"):
            await registry.request(
                HostTerminalRequestFrame(
                    "req", "workspace", str(tmp_path), "stop", {"terminal_id": record.id}
                )
            )
        assert record.state == "running"
        assert record.exited_at is None
        assert record.output == "last output"
    finally:
        registry.instances.clear()
        await registry.shutdown()


def test_retention_caps_inactive_records_per_workspace(tmp_path: Path) -> None:
    registry = HostWorkbenchTerminals(tmp_path / "terminals.json", ["bash"])
    for number in range(HISTORY_LIMIT + 3):
        registry.records[str(number)] = ManualTerminal(
            str(number), "workspace", str(tmp_path), "bash", "s1", number, state="exited"
        )
    registry.records["live"] = ManualTerminal("live", "workspace", str(tmp_path), "bash", "s1", 0)
    registry._persist()
    assert len(registry.records) == HISTORY_LIMIT + 1
    assert "live" in registry.records
    assert "0" not in registry.records
