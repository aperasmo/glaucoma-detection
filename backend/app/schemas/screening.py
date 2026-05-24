# backend/app/schemas/screening.py
#
# Pydantic schemas for Screening endpoints.
# Defines what data the API accepts (input) and returns (output).

from uuid import UUID
from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class CreateScreening(BaseModel):
    # Required fields when creating a new screening.
    patient_id: UUID
    eye_side: str
    remarks: Optional[str] = None

    from pydantic import field_validator

    @field_validator("eye_side")
    @classmethod
    def eye_side_must_be_valid(cls, value):
        # Only left or right eye accepted.
        if value not in ["left", "right"]:
            raise ValueError("eye_side must be 'left' or 'right'.")
        return value


class ScreeningResponse(BaseModel):
    # Screening data returned in API responses.
    screening_id: UUID
    patient_id: UUID
    screened_by: UUID
    image_path: str
    eye_side: str
    status: str
    remarks: Optional[str] = None
    created_at: datetime
    created_by: Optional[UUID] = None

    model_config = {"from_attributes": True}


class UpdateScreeningStatus(BaseModel):
    # Used internally to update screening status during ML pipeline.
    status: str

    from pydantic import field_validator

    @field_validator("status")
    @classmethod
    def status_must_be_valid(cls, value):
        valid = ["pending", "processing", "complete", "failed"]
        if value not in valid:
            raise ValueError(f"status must be one of: {', '.join(valid)}")
        return value