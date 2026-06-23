"""add llm_evaluation_scores table and is_researcher flag to users

Revision ID: a1b2c3d4e5f6
Revises: 589efd07c9b9
Create Date: 2026-06-22 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, Sequence[str], None] = '589efd07c9b9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Add is_researcher flag to users table
    # Simple boolean flag - not a new role, just a per-user research access toggle
    # Defaults to False so existing users are unaffected
    op.add_column(
        'users',
        sa.Column('is_researcher', sa.Boolean(), nullable=False, server_default='false')
    )

    # Create llm_evaluation_scores table
    # Stores D5 (professional tone) manual scores per scorer per letter
    # D1-D4 scores are automated and stored in the JSON file - not in this table
    op.create_table(
        'llm_evaluation_scores',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('case_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('label', sa.String(20), nullable=False),
        sa.Column('scorer_user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.user_id'), nullable=False),
        sa.Column('d5_professional_tone', sa.Integer(), nullable=True),
        sa.Column('scored_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.UniqueConstraint('case_id', 'label', 'scorer_user_id', name='uq_evaluation_score'),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('llm_evaluation_scores')
    op.drop_column('users', 'is_researcher')
