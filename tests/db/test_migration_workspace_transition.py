"""An existing chat gains nullable, durable workspace recovery state."""

import sqlalchemy as sa
from alembic import command

from omnigent.db.utils import _build_alembic_config, get_or_create_engine
from omnigent.stores.conversation_store.sqlalchemy_store import SqlAlchemyConversationStore
from omnigent.stores.workspace_transition_store import WorkspaceTransitionStore


def test_workspace_transition_migration_keeps_existing_chat(tmp_path):
    uri = f"sqlite:///{tmp_path / 'migration.db'}"
    engine = get_or_create_engine(uri)
    store = SqlAlchemyConversationStore(uri)
    chat = store.create_conversation(host_id="1" * 32, workspace="/old", title="Existing history")
    config = _build_alembic_config(uri)
    with engine.begin() as connection:
        config.attributes["connection"] = connection
        command.downgrade(config, "ws1b2c3d4e5f")
        assert "workspace_transition" not in {
            column["name"]
            for column in sa.inspect(connection).get_columns("omnigent_conversation_metadata")
        }
        command.upgrade(config, "head")
    assert store.get_conversation(chat.id).title == "Existing history"
    assert store.get_conversation(chat.id).workspace_transition is None
    WorkspaceTransitionStore(uri).begin(
        chat.id,
        operation_id="change",
        host_id=chat.host_id,
        expected_workspace="/old",
        expected_runner_id=None,
        target="/new",
    )
    reloaded = SqlAlchemyConversationStore(uri).get_conversation(chat.id)
    assert reloaded.workspace == "/new"
    assert reloaded.workspace_transition["blocked"] is True
