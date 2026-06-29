"""create llm_evaluation_scores table manual

Revision ID: 509fc204a4c7
Revises: 25fee8d12ff7
Create Date: 2026-06-29

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = '509fc204a4c7'
down_revision: Union[str, Sequence[str], None] = '25fee8d12ff7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'llm_evaluation_scores',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('case_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('label', sa.String(20), nullable=False),
        sa.Column('scorer_user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.user_id'), nullable=False),
        sa.Column('d5_professional_tone', sa.Integer(), nullable=True),
        sa.Column('scored_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint('case_id', 'label', 'scorer_user_id', name='uq_evaluation_score'),
    )


def downgrade() -> None:
    op.drop_table('llm_evaluation_scores')