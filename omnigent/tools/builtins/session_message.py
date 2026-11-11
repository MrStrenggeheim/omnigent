"""Ordinary messages between independent sessions owned by the same user."""

from typing import Any

from omnigent.tools.base import Tool


class SysSessionMessageTool(Tool):
    @classmethod
    def name(cls) -> str:
        return "sys_session_message"

    @classmethod
    def description(cls) -> str:
        return (
            "Send work to another session owned by the same user. Requires session "
            "orchestration enabled and a private, non-scheduled sending session, including "
            "its side-chat source chain. The receiver "
            "may be shared: its readers will see your message. It uses safe turn-boundary queue "
            "behavior without changing parentage or forwarding replies. A queued result "
            "means accepted, not executed; destination policy may still deny it during "
            "startup replay. Reuse message_id only to reconcile an uncertain send; "
            "reply_to_message_id addresses the sender of a received message. Check results with "
            "sys_session_get_info/sys_session_get_history. Do not automatically retry an "
            "uncertain delivery."
        )

    def get_schema(self) -> dict[str, Any]:
        return {
            "type": "function",
            "function": {
                "name": self.name(),
                "description": self.description(),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "session_id": {"type": "string", "description": "Destination session ID."},
                        "message": {"type": "string", "minLength": 1, "maxLength": 8000},
                        "message_id": {
                            "type": "string",
                            "description": "Stable UUID for deduplication and reconciliation.",
                        },
                        "reply_to_message_id": {
                            "type": "string",
                            "description": "ID of the received peer message being answered.",
                        },
                        "task_id": {"type": "string", "maxLength": 256},
                    },
                    "required": ["session_id", "message"],
                    "additionalProperties": False,
                },
            },
        }
