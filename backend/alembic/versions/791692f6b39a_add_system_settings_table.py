"""add system_settings table

Revision ID: 791692f6b39a
Revises: 27197be5bd29
Create Date: 2026-05-21 20:36:57.948152

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '791692f6b39a'
down_revision: Union[str, Sequence[str], None] = '27197be5bd29'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'system_settings',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('category', sa.String(30), nullable=True),
        sa.Column('set_code', sa.String(30), nullable=False),
        sa.Column('set_name', sa.String(50), nullable=True),
        sa.Column('set_value', sa.String(500), nullable=True),
        sa.Column('remark', sa.Text(), nullable=True),
        sa.Column('status', sa.String(1), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.Column('created_by', sa.dialects.postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('updated_by', sa.dialects.postgresql.UUID(as_uuid=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_system_settings_id'), 'system_settings', ['id'], unique=False)
    op.create_index(op.f('ix_system_settings_set_code'), 'system_settings', ['set_code'], unique=True)


def downgrade() -> None:
    op.drop_table('system_settings')