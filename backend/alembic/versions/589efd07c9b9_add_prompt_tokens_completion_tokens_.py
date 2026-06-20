"""add prompt_tokens completion_tokens total_tokens to screening_results

Revision ID: 589efd07c9b9
Revises: 5a6c3493af5b
Create Date: 2026-06-20 03:35:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '589efd07c9b9'
down_revision: Union[str, Sequence[str], None] = '5a6c3493af5b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('screening_results', sa.Column('prompt_tokens', sa.Integer(), nullable=True))
    op.add_column('screening_results', sa.Column('completion_tokens', sa.Integer(), nullable=True))
    op.add_column('screening_results', sa.Column('total_tokens', sa.Integer(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('screening_results', 'total_tokens')
    op.drop_column('screening_results', 'completion_tokens')
    op.drop_column('screening_results', 'prompt_tokens')