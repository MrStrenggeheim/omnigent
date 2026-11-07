"""Project archive migration defaults and preservation on fresh and existing SQLite."""

from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic import command
from sqlalchemy.exc import IntegrityError

from omnigent.db.utils import _build_alembic_config

_PRE_ARCHIVE_REVISION = "b2e4f6a8c013"
_ARCHIVE_REVISION = "9f71b6c2d480"


@pytest.mark.parametrize("existing", [False, True])
def test_project_archived_migration(tmp_path: Path, existing: bool) -> None:
    uri = f"sqlite:///{tmp_path / 'archive.db'}"
    config = _build_alembic_config(uri)
    engine = sa.create_engine(uri)
    project_id = bytes.fromhex("a" * 32)
    insert_project = sa.text(
        "INSERT INTO projects (id, name, user_id, created_at, updated_at, config) "
        "VALUES (:id, 'Work', 'alice', 123, 456, :config)"
    )
    payload = {"id": project_id, "config": b"stored config"}
    try:
        with engine.begin() as connection:
            config.attributes["connection"] = connection
            if existing:
                command.upgrade(config, _PRE_ARCHIVE_REVISION)
                connection.execute(insert_project, payload)
            command.upgrade(config, "head")
            assert connection.scalar(sa.text("SELECT version_num FROM alembic_version")) == (
                _ARCHIVE_REVISION
            )
            if not existing:
                connection.execute(insert_project, payload)

        columns = {column["name"]: column for column in sa.inspect(engine).get_columns("projects")}
        assert isinstance(columns["archived"]["type"], sa.Boolean)
        assert columns["archived"]["nullable"] is False
        assert columns["archived"]["default"] is not None
        with engine.begin() as connection:
            assert connection.execute(
                sa.text(
                    "SELECT name, user_id, created_at, updated_at, config, archived FROM projects"
                )
            ).one() == ("Work", "alice", 123, 456, payload["config"], 0)
            connection.execute(sa.text("UPDATE projects SET archived = 1"))
            assert connection.scalar(sa.text("SELECT archived FROM projects")) == 1
        with pytest.raises(IntegrityError), engine.begin() as connection:
            connection.execute(sa.text("UPDATE projects SET archived = NULL"))

        with engine.begin() as connection:
            config.attributes["connection"] = connection
            command.downgrade(config, _PRE_ARCHIVE_REVISION)
        assert "archived" not in {c["name"] for c in sa.inspect(engine).get_columns("projects")}
        with engine.begin() as connection:
            assert connection.execute(
                sa.text("SELECT id, name, user_id, created_at, updated_at, config FROM projects")
            ).one() == (project_id, "Work", "alice", 123, 456, payload["config"])
            config.attributes["connection"] = connection
            command.upgrade(config, "head")
            assert connection.scalar(sa.text("SELECT archived FROM projects")) == 0
    finally:
        engine.dispose()
