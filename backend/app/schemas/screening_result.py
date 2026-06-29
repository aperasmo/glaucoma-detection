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
    generation_time_ms: Optional[Decimal] = None
    prompt_tokens : Optional[int] = None
    completion_tokens: Optional[int] = None
    total_tokens: Optional[int] = None
    llm_used: Optional[str] = None
    created_at: datetime
    cdr: Optional[float] = None
    disc_radius: Optional[float] = None
    cup_radius: Optional[float] = None
    # Model disagreement fields - populated on ensemble result in Clinical Mode
    # when at least one individual model crossed its sensitivity threshold
    # while ensemble predicted normal
    has_model_disagreement: Optional[bool] = None
    disagreement_model: Optional[str] = None
    disagreement_confidence: Optional[float] = None
    letter_type: Optional[str] = None

    model_config = {"from_attributes": True}


class ScreeningWithResults(BaseModel):
    # Combined screening and results - used for the clinical results page.
    screening_id: UUID
    patient_id: UUID
    eye_side: str
    status: str
    inference_mode: str | None = None  # Backwards compatibility for old screenings without this field
    image_path: str
    created_at: datetime
    patient_name: Optional[str] = None
    patient_code: Optional[str] = None
    patient_dob: Optional[str] = None
    patient_gender: Optional[str] = None    
    results: list[ScreeningResultResponse] = []

    model_config = {"from_attributes": True}