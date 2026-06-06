"""add inference mode column to screenings

Revision ID: db6875339de1
Revises: 66b6f65656a1
Create Date: 2026-06-06 11:19:25.798264

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'db6875339de1'
down_revision: Union[str, Sequence[str], None] = '66b6f65656a1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""

    inference_modes = postgresql.ENUM(
        "clinical",
        "research",
        name="inference_modes",
    )
    inference_modes.create(op.get_bind(), checkfirst=True)

    op.add_column(
        "screenings",
        sa.Column(
            "inference_mode",
            inference_modes,
            nullable=False,
            server_default="clinical",
        ),
    )

    op.create_index(
        op.f("ix_screenings_inference_mode"),
        "screenings",
        ["inference_mode"],
        unique=False,
    )


def downgrade() -> None:
    """Downgrade schema."""

    op.drop_index(
        op.f("ix_screenings_inference_mode"),
        table_name="screenings",
    )

    op.drop_column("screenings", "inference_mode")

    inference_modes = postgresql.ENUM(
        "clinical",
        "research",
        name="inference_modes",
    )
    inference_modes.drop(op.get_bind(), checkfirst=True)

def downgrade() -> None:
    """Downgrade schema."""
    pass
