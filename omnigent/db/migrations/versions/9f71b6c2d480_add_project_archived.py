"""Add archive state to first-class projects.

Revision ID: 9f71b6c2d480
Revises: b2e4f6a8c013
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "9f71b6c2d480"
down_revision: str | None = "b2e4f6a8c013"
branch_labels: tuple[str, ...] | None = None
depends_on: tuple[str, ...] | None = None


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column("archived", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    with op.batch_alter_table("projects") as batch_op:
        batch_op.drop_column("archived")
