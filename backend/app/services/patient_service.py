# backend/app/services/patient_service.py
#
# Business logic for patient management.
# Handles patient creation, retrieval, update, and soft delete.
# Kept separate from routes so logic can be reused and tested independently.

import uuid
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_ # for complex queries

from app.models.patient import Patient
from app.schemas.patient import CreatePatient, UpdatePatient

from app.models.screening import Screening
from app.models.screening_result import ScreeningResult
from app.core.logger import get_logger

async def generate_patient_code(db: AsyncSession) -> str:
    # Generate the next sequential patient code e.g. PAT00001.
    # Counts existing patients and increments by 1.
    result = await db.execute(select(func.count()).select_from(Patient))
    count = result.scalar()
    return f"PAT{str(count + 1).zfill(5)}"


async def get_patient_by_id(db: AsyncSession, patient_id: uuid.UUID):
    # Fetch a single active patient by UUID.
    # Returns None if not found or inactive.
    result = await db.execute(
        select(Patient).where(
            Patient.patient_id == patient_id,
            Patient.is_active == True,
        )
    )
    return result.scalar_one_or_none()


#async def get_all_patients(db: AsyncSession, skip: int = 0, limit: int = 50):
    # Fetch all active patients with pagination.
    # skip and limit control the page size - default 50 per page.
    # Ordered by last_name for consistent display.
#    result = await db.execute(
#        select(Patient)
#        .where(Patient.is_active == True)
#        .order_by(Patient.last_name)
#        .offset(skip)
#        .limit(limit)
#    )
#    return result.scalars().all()

async def get_all_patients(db: AsyncSession, skip: int = 0, limit: int = 50):
    # Fetch all active patients with their latest screening event
    # and the ensemble prediction result for Patient List display.
    #
    # Patient -> Screening -> ScreeningResult
    # Uses LEFT JOIN so patients with no screening still appear.
    # Complex query with window function to get latest screening per patient.
    latest_screening_sq = ( #  Subquery to get latest screening per patient
        select(
            Screening.screening_id.label("screening_id"),
            Screening.patient_id.label("patient_id"),
            Screening.eye_side.label("eye_side"),
            Screening.status.label("status"),
            Screening.created_at.label("screening_created_at"),
            func.row_number() # Window function to rank screenings per patient by created_at
            .over(
                partition_by=Screening.patient_id,
                order_by=Screening.created_at.desc(),
            )
            .label("rn"), # We will filter for rn=1 in the outer query to get only the latest screening per patient
        )
        .subquery()
    )

    result = await db.execute(
        select(
            Patient,
            latest_screening_sq.c.screening_id,
            latest_screening_sq.c.eye_side,
            latest_screening_sq.c.status,
            latest_screening_sq.c.screening_created_at,
            ScreeningResult.screening_results_id,
            ScreeningResult.model_used,
            ScreeningResult.prediction,
            ScreeningResult.confidence_score,
            ScreeningResult.threshold_used,
            ScreeningResult.cdr,
            ScreeningResult.ohts_score,
            ScreeningResult.ohts_tier,
        )
        .outerjoin(
            latest_screening_sq,
            and_(
                Patient.patient_id == latest_screening_sq.c.patient_id,
                latest_screening_sq.c.rn == 1,
            ),
        )
        .outerjoin(
            ScreeningResult,
            and_(
                ScreeningResult.screening_id == latest_screening_sq.c.screening_id,
                ScreeningResult.model_used == "ensemble",
                ScreeningResult.llm_used.is_(None), # Ensure we only get the original ensemble result, not the LLM referral letter result
            ),
        )
        .where(Patient.is_active == True)
        .order_by(Patient.last_name)
        .offset(skip)
        .limit(limit)
    )

    rows = result.all()

    patients = []

    for (
        patient,
        screening_id,
        eye_side,
        status,
        screening_created_at,
        screening_results_id,
        model_used,
        prediction,
        confidence_score,
        threshold_used,
        cdr,
        ohts_score,
        ohts_tier,
    ) in rows:
        patients.append({
            "patient_id": patient.patient_id,
            "patient_code": patient.patient_code,
            "last_name": patient.last_name,
            "first_name": patient.first_name,
            "dob": patient.dob,
            "gender": patient.gender,
            "contact_person": patient.contact_person,
            "email": patient.email,
            "landline_number": patient.landline_number,
            "mobile_number": patient.mobile_number,
            "is_active": patient.is_active,
            "iop": patient.iop,
            "cct": patient.cct,
            "remarks": patient.remarks,
            "created_at": patient.created_at,
            "created_by": patient.created_by,

            "latest_screening": None if screening_id is None else {
                "screening_id": screening_id,
                "eye_side": eye_side,
                "status": status,
                "created_at": screening_created_at,
                "result": None if screening_results_id is None else {
                    "screening_results_id": screening_results_id,
                    "model_used": model_used,
                    "prediction": prediction,
                    "confidence_score": float(confidence_score) if confidence_score is not None else None,
                    "threshold_used": float(threshold_used) if threshold_used is not None else None,
                    "cdr": float(cdr) if cdr is not None else None,
                    "ohts_score": float(ohts_score) if ohts_score is not None else None,
                    "ohts_tier": ohts_tier,
                },
            },
        })

    return patients


async def create_patient(
    db: AsyncSession,
    patient_data: CreatePatient,
    created_by: uuid.UUID,
) -> Patient:
    # Create a new patient record.
    # Generates patient code automatically.
    # Returns the created Patient object.

    patient_code = await generate_patient_code(db)

    new_patient = Patient(
        patient_code=patient_code,
        last_name=patient_data.last_name,
        first_name=patient_data.first_name,
        dob=patient_data.dob,
        gender=patient_data.gender,
        contact_person=patient_data.contact_person,
        email=patient_data.email,
        landline_number=patient_data.landline_number,
        mobile_number=patient_data.mobile_number,
        iop=patient_data.iop,
        cct=patient_data.cct,
        remarks=patient_data.remarks,
        is_active=True,
        created_by=created_by,
        updated_by=created_by,
    )
    db.add(new_patient)
    await db.flush()

    return new_patient


async def update_patient(
    db: AsyncSession,
    patient_id: uuid.UUID,
    patient_data: UpdatePatient,
    updated_by: uuid.UUID,
) -> Patient:
    # Update an existing patient record.
    # Only updates fields that are provided - skips None values.
    # Returns the updated Patient object.

    patient = await get_patient_by_id(db, patient_id)
    if not patient:
        raise ValueError("Patient not found.")

    # Only update fields that were actually provided
    update_data = patient_data.model_dump(exclude_none=True)
    for field, value in update_data.items():
        setattr(patient, field, value)

    patient.updated_by = updated_by
    patient.updated_at = datetime.utcnow()

    return patient


async def delete_patient(
    db: AsyncSession,
    patient_id: uuid.UUID,
    updated_by: uuid.UUID,
) -> Patient:
    # Soft delete a patient by setting is_active=False.
    # Data is never permanently deleted - important for clinical audit trail.
    # Returns the deactivated Patient object.

    patient = await get_patient_by_id(db, patient_id)
    if not patient:
        raise ValueError("Patient not found.")

    patient.is_active = False
    patient.updated_by = updated_by
    patient.updated_at = datetime.utcnow()

    return patient