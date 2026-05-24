# backend/app/schemas/screening_result.py
#
# Pydantic schemas for ScreeningResult endpoints.
# Defines what data the API returns for ML inference results.

from uuid import UUID
from datetime import datetime
from typing import Optional
from decimal import Decimal

from pydantic import BaseModel


class ScreeningResultResponse(BaseModel):
    # Full screening result data returned in API responses.
    screening_results_id: UUID
    screening_id: UUID
    model_used: str
    prediction: str
    confidence_score: Decimal
    threshold_used: Decimal
    gradcam_path: Optional[str] = None
    ohts_score: Optional[Decimal] = None
    ohts_tier: Optional[str] = None
    referral_letter: Optional[str] = None
    llm_used: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class ScreeningWithResults(BaseModel):
    # Combined screening and results - used for the clinical results page.
    screening_id: UUID
    patient_id: UUID
    eye_side: str
    status: str
    image_path: str
    created_at: datetime
    results: list[ScreeningResultResponse] = []

    model_config = {"from_attributes": True}