"""Explicit host placement updates resume hints; ordinary creation stays immutable."""

import importlib

import pytest

from omnigent.native.launch_directory import record_host_launch_directory


@pytest.mark.parametrize("family", ["claude_native", "codex_native", "opencode_native"])
def test_host_redirect_keeps_cli_resume_in_the_selected_directory(tmp_path, monkeypatch, family):
    for name in ("claude_native", "codex_native", "opencode_native"):
        module = importlib.import_module(f"omnigent.harnesses.{name}.state")
        monkeypatch.setattr(module, f"_{name}_state_root", lambda name=name: tmp_path / name)
    state = importlib.import_module(f"omnigent.harnesses.{family}.state")
    session_id = "1" * 32
    first, second = str(tmp_path / "first"), str(tmp_path / "second")
    state.write_launch_state(session_id, first)
    state.write_launch_state(session_id, second)
    assert state.read_launch_state(session_id).working_directory == first
    record_host_launch_directory(family.replace("_", "-"), session_id, second)
    assert state.read_launch_state(session_id).working_directory == second
