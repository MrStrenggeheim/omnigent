"""Persist recoverable agent workspace transitions.

Revision ID: wsc2d3e4f5a6
Revises: ws1b2c3d4e5f
"""

import sqlalchemy as sa
from alembic import op

revision = "wsc2d3e4f5a6"
down_revision = "ws1b2c3d4e5f"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "omnigent_conversation_metadata",
        sa.Column("workspace_transition", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("omnigent_conversation_metadata", "workspace_transition")
