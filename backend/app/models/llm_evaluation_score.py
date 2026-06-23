# backend/app/models/llm_evaluation_score.py
#
# Stores D5 (professional tone) manual scores for the LLM comparison study.
# One row per scorer per letter (case_id + label + scorer_user_id = unique).
# D1-D4 scores are automated and stored in the JSON file at
# backend/app/data/llm_evaluation_scores.json - not in this table.
# Only D5 requires human judgment and is stored here.

import uuid
from datetime import datetime
from sqlalchemy import Column, String, Integer, Boolean, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID

from app.db.database import Base


class LLMEvaluationScore(Base):
    __tablename__ = "llm_evaluation_scores"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # Which letter this score is for - matches case_id + label in the JSON
    case_id = Column(UUID(as_uuid=True), nullable=False)
    label = Column(String(20), nullable=False)  # "Letter A", "Letter B", etc.

    # Which user submitted this score
    scorer_user_id = Column(UUID(as_uuid=True), ForeignKey("users.user_id"), nullable=False)

    # D5 score - 1 = professional, 0 = not professional, NULL = not yet scored
    d5_professional_tone = Column(Integer, nullable=True)

    scored_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Prevent duplicate scores - one score per scorer per letter
    __table_args__ = (
        UniqueConstraint("case_id", "label", "scorer_user_id", name="uq_evaluation_score"),
    )
