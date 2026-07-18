# request/response shapes for the patient endpoints - kept separate from
# the ORM model so we control exactly what goes in and out of the API

from uuid import UUID
from datetime import datetime, date
from typing import Optional

from pydantic import BaseModel, EmailStr

class CreatePatient(BaseModel):
    # what's needed (and what's optional) to register a new patient
    last_name: str
    first_name: str
    dob: Optional[date] = None
    gender: Optional[str] = None
    contact_person: Optional[str] = None
    email: Optional[EmailStr] = None
    landline_number: Optional[str] = None
    mobile_number: Optional[str] = None
    iop: Optional[float] = None
    cct: Optional[float] = None
    remarks: Optional[str] = None

class ResponsePatient(BaseModel):
    # what we send back for a patient - no sensitive stuff here
    patient_id: UUID
    patient_code: str
    last_name: str
    first_name: str
    dob: Optional[date] = None
    gender: Optional[str] = None
    contact_person: Optional[str] = None
    email: Optional[str] = None
    landline_number: Optional[str] = None
    mobile_number: Optional[str] = None
    is_active: bool
    iop: Optional[float] = None
    cct: Optional[float] = None
    remarks: Optional[str] = None
    created_at: datetime
    created_by: Optional[UUID] = None
    
class LatestScreeningResultResponse(BaseModel):
    screening_results_id: UUID
    model_used: str
    prediction: str
    confidence_score: float | None = None
    threshold_used: float | None = None
    cdr: float | None = None
    ohts_score: float | None = None
    ohts_tier: str | None = None

class LatestScreeningResponse(BaseModel):
    screening_id: UUID
    eye_side: str | None = None
    status: str | None = None
    created_at: datetime | None = None
    result: LatestScreeningResultResponse | None = None    


class ResponsePatient(BaseModel):
    # what we send back for a patient - no sensitive stuff here
    patient_id: UUID
    patient_code: str
    last_name: str
    first_name: str
    dob: Optional[date] = None
    gender: Optional[str] = None
    contact_person: Optional[str] = None
    email: Optional[str] = None
    landline_number: Optional[str] = None
    mobile_number: Optional[str] = None
    is_active: bool
    iop: Optional[float] = None
    cct: Optional[float] = None
    remarks: Optional[str] = None
    created_at: datetime
    created_by: Optional[UUID] = None
    latest_screening: Optional[LatestScreeningResponse] = None

    model_config = {"from_attributes": True}  # lets pydantic build this straight from the ORM object
    


class UpdatePatient(BaseModel):
    # everything optional so callers can PATCH just the fields they want to change
    last_name: Optional[str] = None
    first_name: Optional[str] = None
    dob: Optional[date] = None
    gender: Optional[str] = None
    contact_person: Optional[str] = None
    email: Optional[EmailStr] = None
    landline_number: Optional[str] = None
    mobile_number: Optional[str] = None
    iop: Optional[float] = None
    cct: Optional[float] = None
    remarks: Optional[str] = None

