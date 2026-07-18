# D5 (professional tone) is the one score in the LLM comparison study that
# needs an actual human, so that's what this table holds - one row per
# scorer per letter (case_id + label + scorer_user_id has to stay unique).
# D1-D4 are automated and just live in the JSON file at
# backend/app/data/llm_evaluation_scores.json instead.

import uuid
from datetime import datetime
from sqlalchemy import Column, String, Integer, Boolean, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID

from app.db.database import Base


class LLMEvaluationScore(Base):
    __tablename__ = "llm_evaluation_scores"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # matches case_id + label over in the JSON file
    case_id = Column(UUID(as_uuid=True), nullable=False)
    label = Column(String(20), nullable=False)  # "Letter A", "Letter B", etc.

    # who submitted the score
    scorer_user_id = Column(UUID(as_uuid=True), ForeignKey("users.user_id"), nullable=False)

    # 1 = professional, 0 = not professional, NULL = hasn't been scored yet
    d5_professional_tone = Column(Integer, nullable=True)

    scored_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # stops the same scorer from double-scoring the same letter
    __table_args__ = (
        UniqueConstraint("case_id", "label", "scorer_user_id", name="uq_evaluation_score"),
    )
