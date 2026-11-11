"""Durable branch provenance, independent of delegated-agent parentage."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Literal

from pydantic import BaseModel, Field, ValidationError

BRANCH_LABEL_PREFIX = "omnigent.branch."


class ConversationBranch(BaseModel):
    """A frozen transcript boundary; IDs carry no ancestor titles or grants."""

    source_conversation_id: str
    root_conversation_id: str | None = None
    source_item_id: str | None = None
    source_response_id: str | None = None
    inherited_item_count: int | None = Field(default=None, ge=0)
    inherited_last_item_id: str | None = None
    reference_boundary_item_id: str | None = None
    created_at: int | None = None
    reference_only: bool = False
    recovery: Literal["replay", "legacy_unknown", "unavailable"] = "legacy_unknown"


def conversation_branch(
    labels: Mapping[str, str], *, parent_conversation_id: str | None = None
) -> ConversationBranch | None:
    """Read current provenance or project only facts evidenced by legacy labels.

    Legacy records are not rewritten: absent boundaries and roots remain unknown.
    A delegated child is a branch only with explicit side-chat evidence.
    """
    encoded = {
        key.removeprefix(BRANCH_LABEL_PREFIX): value
        for key, value in labels.items()
        if key.startswith(BRANCH_LABEL_PREFIX)
    }
    if encoded:
        try:
            return ConversationBranch.model_validate(encoded)
        except ValidationError:
            # A malformed legacy label cannot make existing history unreadable.
            pass
    source = labels.get("omnigent.side_chat.source_id") or labels.get("omnigent.fork.source_id")
    native_side = labels.get("omnigent.codex_native.agent_nickname") == "Side chat"
    if native_side:
        source = parent_conversation_id or source
    if not source:
        return None
    return ConversationBranch(source_conversation_id=source, reference_only=native_side)


def branch_labels(branch: ConversationBranch) -> dict[str, str]:
    """Encode provenance into existing transactional labels (256 bytes per value)."""
    return {
        BRANCH_LABEL_PREFIX + key: str(value).lower() if isinstance(value, bool) else str(value)
        for key, value in branch.model_dump(exclude_none=True).items()
    }
