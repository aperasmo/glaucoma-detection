# backend/app/schemas/patient.py
#
# Pydantic schemas for Patient endpoints.
# Defines what data the API accepts (input) and returns (output).

from uuid import UUID 
from datetime import datetime, date
from typing import Optional # for optional fields

from pydantic import BaseModel, EmailStr # for email validation

class CreatePatient(BaseModel):
    # Required and optional fields when creating a new patient.
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
    # Safe patient data returned in API responses.
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
    # Safe patient data returned in API responses.
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

    model_config = {"from_attributes": True} # allows Pydantic to read from ORM models directly    
    


class UpdatePatient(BaseModel):
    # All fields optional - update one or all at a time.
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

