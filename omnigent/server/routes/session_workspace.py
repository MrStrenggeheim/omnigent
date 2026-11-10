"""Owner-only, same-machine agent workspace changes."""

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field

from omnigent.server.workspace_transition import WorkspaceTransitionService


class ChangeWorkspace(BaseModel):
    model_config = ConfigDict(extra="forbid")
    validate_only: bool = False
    request_id: str = Field(min_length=1, max_length=64)
    workspace: str = Field(min_length=1, max_length=2048)
    expected_host_id: str | None = Field(default=None, max_length=128)
    expected_workspace: str = Field(min_length=1, max_length=2048)
    expected_runner_id: str | None = Field(..., max_length=128)
    recover_operation_id: str | None = Field(default=None, max_length=64)


def create_session_workspace_router(service: WorkspaceTransitionService) -> APIRouter:
    router = APIRouter(prefix="/sessions/{session_id}/workspace")

    @router.get("")
    async def get_workspace(request: Request, session_id: str):
        return await service.snapshot(request, session_id)

    @router.post("")
    async def change_workspace(request: Request, session_id: str, body: ChangeWorkspace):
        return await service.change(request, session_id, body)

    return router
