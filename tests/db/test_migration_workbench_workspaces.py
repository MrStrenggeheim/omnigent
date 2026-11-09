"""Existing databases gain workspace identity and independent chat references."""

import sqlalchemy as sa
from alembic import command

from omnigent.db.utils import _build_alembic_config, get_or_create_engine
from omnigent.stores.workbench_workspace_store import WorkbenchWorkspaceStore


def test_workspace_migration_and_persisted_identity(tmp_path):
    uri = f"sqlite:///{tmp_path / 'migration.db'}"
    engine = get_or_create_engine(uri)
    config = _build_alembic_config(uri)
    with engine.begin() as connection:
        config.attributes["connection"] = connection
        command.downgrade(config, "9f71b6c2d480")
        assert "workbench_workspaces" not in sa.inspect(connection).get_table_names()
        command.upgrade(config, "head")
        assert "workbench_workspace_sessions" in sa.inspect(connection).get_table_names()
    store = WorkbenchWorkspaceStore(uri)
    workspace = store.resolve(
        owner_user_id=None,
        host_id="1" * 32,
        target_kind="host",
        target_id="1" * 32,
        generation="original",
        root="/project",
    )
    assert WorkbenchWorkspaceStore(uri).get(workspace.id, None) == workspace
    different_generation = store.resolve(
        owner_user_id=None,
        host_id="1" * 32,
        target_kind="host",
        target_id="1" * 32,
        generation="replacement",
        root="/project",
    )
    assert different_generation.id != workspace.id
