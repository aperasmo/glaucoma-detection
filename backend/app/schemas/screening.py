# request/response shapes for the screening endpoints

from uuid import UUID
from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class CreateScreening(BaseModel):
    patient_id: UUID
    eye_side: str
    remarks: Optional[str] = None

    from pydantic import field_validator

    @field_validator("eye_side")
    @classmethod
    def eye_side_must_be_valid(cls, value):
        if value not in ["left", "right"]:
            raise ValueError("eye_side must be 'left' or 'right'.")
        return value


class ScreeningResponse(BaseModel):
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
    # internal use - the ML pipeline calls this to move status along
    status: str

    from pydantic import field_validator

    @field_validator("status")
    @classmethod
    def status_must_be_valid(cls, value):
        valid = ["pending", "processing", "complete", "failed"]
        if value not in valid:
            raise ValueError(f"status must be one of: {', '.join(valid)}")
        return value