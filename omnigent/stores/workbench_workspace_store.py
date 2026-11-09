"""Persist owner-scoped filesystem identities without borrowing chat access."""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from omnigent.db.account_authority import account_generation, require_active_account
from omnigent.db.db_models import (
    SqlWorkbenchWorkspace,
    SqlWorkbenchWorkspaceSession,
    current_workspace_id,
)
from omnigent.db.utils import (
    get_or_create_engine,
    make_named_managed_session_maker,
    now_epoch,
    run_write_transaction,
)


@dataclass(frozen=True)
class WorkbenchWorkspace:
    id: str
    owner_user_id: str | None
    account_generation: str | None
    host_id: str | None
    target_kind: str
    target_id: str
    generation: str
    root: str
    source_session_id: str | None
    created_at: int
    source_environment_id: str | None = None


def _entity(row: SqlWorkbenchWorkspace) -> WorkbenchWorkspace:
    return WorkbenchWorkspace(
        **{field: getattr(row, field) for field in WorkbenchWorkspace.__dataclass_fields__}
    )


class WorkbenchWorkspaceStore:
    def __init__(self, storage_location: str) -> None:
        self._engine = get_or_create_engine(storage_location)
        self._session = make_named_managed_session_maker(
            self._engine, query_name_prefix="omnigent.workbench_workspace_store"
        )
        self._session_immediate = make_named_managed_session_maker(
            self._engine, query_name_prefix="omnigent.workbench_workspace_store", immediate=True
        )

    def get(self, workspace_id: str, owner_user_id: str | None) -> WorkbenchWorkspace | None:
        with self._session("lookup_workspace") as session:
            row = session.execute(
                select(SqlWorkbenchWorkspace).where(
                    SqlWorkbenchWorkspace.workspace_id == current_workspace_id(),
                    SqlWorkbenchWorkspace.id == workspace_id,
                    SqlWorkbenchWorkspace.owner_user_id == owner_user_id,
                    SqlWorkbenchWorkspace.account_generation
                    == (account_generation(owner_user_id) if owner_user_id else None),
                )
            ).scalar_one_or_none()
            return _entity(row) if row else None

    def list(self, owner_user_id: str | None) -> list[WorkbenchWorkspace]:
        with self._session("list_owned_workspaces") as session:
            rows = session.scalars(
                select(SqlWorkbenchWorkspace)
                .where(
                    SqlWorkbenchWorkspace.workspace_id == current_workspace_id(),
                    SqlWorkbenchWorkspace.owner_user_id == owner_user_id,
                    SqlWorkbenchWorkspace.account_generation
                    == (account_generation(owner_user_id) if owner_user_id else None),
                )
                .order_by(SqlWorkbenchWorkspace.created_at.desc(), SqlWorkbenchWorkspace.id)
            )
            return [_entity(row) for row in rows]

    def resolve(
        self,
        *,
        owner_user_id: str | None,
        host_id: str | None,
        target_kind: str,
        target_id: str,
        generation: str,
        root: str,
        source_session_id: str | None = None,
        source_environment_id: str | None = None,
    ) -> WorkbenchWorkspace:
        owner_generation = account_generation(owner_user_id) if owner_user_id else None
        identity = [
            current_workspace_id(),
            owner_user_id,
            owner_generation,
            target_kind,
            target_id,
            generation,
            root,
            source_environment_id,
        ]
        workspace_id = hashlib.sha256(json.dumps(identity).encode()).hexdigest()[:32]
        workspace = WorkbenchWorkspace(
            workspace_id,
            owner_user_id,
            owner_generation,
            host_id,
            target_kind,
            target_id,
            generation,
            root,
            source_session_id,
            now_epoch(),
            source_environment_id,
        )

        def write(session: Session) -> None:
            require_active_account(session, owner_user_id)
            row = session.get(SqlWorkbenchWorkspace, (current_workspace_id(), workspace_id))
            if row is None:
                session.add(SqlWorkbenchWorkspace(**asdict(workspace)))
            if source_session_id:
                binding = session.get(
                    SqlWorkbenchWorkspaceSession, (current_workspace_id(), source_session_id)
                )
                if binding is None:
                    session.add(
                        SqlWorkbenchWorkspaceSession(
                            session_id=source_session_id, workbench_workspace_id=workspace_id
                        )
                    )
                else:
                    binding.workbench_workspace_id = workspace_id

        try:
            run_write_transaction(self._session_immediate, "resolve_workspace", write)
        except IntegrityError:
            # A concurrent resolve of the same identity may have inserted first.
            if self.get(workspace_id, owner_user_id) is None:
                raise
            run_write_transaction(self._session_immediate, "bind_existing_workspace", write)
        result = self.get(workspace_id, owner_user_id)
        assert result is not None
        return result
