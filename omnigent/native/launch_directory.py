"""Keep native CLI resume entry points aligned with an authorized host launch."""

from importlib import import_module


def record_host_launch_directory(harness: str | None, session_id: str, workspace: str) -> None:
    for family in ("claude-native", "codex-native", "opencode-native"):
        state = import_module(f"omnigent.harnesses.{family.replace('-', '_')}.state")
        if family == harness or state.read_launch_state(session_id) is not None:
            state.redirect_launch_state(session_id, workspace)
