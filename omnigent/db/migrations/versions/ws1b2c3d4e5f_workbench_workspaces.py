"""Independent workbench filesystem identities and chat references.

Revision ID: ws1b2c3d4e5f
Revises: 9f71b6c2d480
"""

import sqlalchemy as sa
from alembic import op

from omnigent.db.db_models import Uuid16

revision = "ws1b2c3d4e5f"
down_revision = "9f71b6c2d480"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "workbench_workspaces",
        sa.Column("workspace_id", sa.BigInteger(), primary_key=True, server_default="0"),
        sa.Column("id", Uuid16(), primary_key=True),
        sa.Column("owner_user_id", sa.String(128), nullable=True),
        sa.Column("account_generation", sa.String(32), nullable=True),
        sa.Column("host_id", Uuid16(), nullable=True),
        sa.Column("target_kind", sa.String(16), nullable=False),
        sa.Column("target_id", sa.String(256), nullable=False),
        sa.Column("generation", sa.String(128), nullable=False),
        sa.Column("root", sa.Text(), nullable=False),
        sa.Column("source_session_id", Uuid16(), nullable=True),
        sa.Column("source_environment_id", sa.String(256), nullable=True),
        sa.Column("created_at", sa.Integer(), nullable=False),
    )
    op.create_index(
        "ix_workbench_workspaces_owner",
        "workbench_workspaces",
        ["workspace_id", "owner_user_id", "id"],
    )
    op.create_table(
        "workbench_workspace_sessions",
        sa.Column("workspace_id", sa.BigInteger(), primary_key=True, server_default="0"),
        sa.Column("session_id", Uuid16(), primary_key=True),
        sa.Column("workbench_workspace_id", Uuid16(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("workbench_workspace_sessions")
    op.drop_table("workbench_workspaces")
