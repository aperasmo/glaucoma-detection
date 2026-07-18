# patient CRUD plus the joined query for the patient list page. kept out of
# the routes file so it's easier to test on its own.

import uuid
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_

from app.models.patient import Patient
from app.schemas.patient import CreatePatient, UpdatePatient

from app.models.screening import Screening
from app.models.screening_result import ScreeningResult
from app.core.logger import get_logger

async def generate_patient_code(db: AsyncSession) -> str:
    # just counts existing patients and bumps by one, e.g. PAT00001
    result = await db.execute(select(func.count()).select_from(Patient))
    count = result.scalar()
    return f"PAT{str(count + 1).zfill(5)}"


async def get_patient_by_id(db: AsyncSession, patient_id: uuid.UUID):
    # None if not found, or if the patient's been soft-deleted
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
    # patient list page needs each patient's latest screening + ensemble result
    # alongside them. Patient -> Screening -> ScreeningResult, left joined so
    # patients with no screenings yet still show up.
    latest_screening_sq = ( # rank screenings per patient so we can grab just the newest one
        select(
            Screening.screening_id.label("screening_id"),
            Screening.patient_id.label("patient_id"),
            Screening.eye_side.label("eye_side"),
            Screening.status.label("status"),
            Screening.created_at.label("screening_created_at"),
            func.row_number()
            .over(
                partition_by=Screening.patient_id,
                order_by=Screening.created_at.desc(),
            )
            .label("rn"), # rn=1 is filtered for below - that's the latest one
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
                ScreeningResult.llm_used.is_(None), # otherwise this would also match the LLM referral letter rows
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
    # code gets generated automatically, no need to pass one in
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
    patient = await get_patient_by_id(db, patient_id)
    if not patient:
        raise ValueError("Patient not found.")

    # skip anything the caller didn't actually send
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
    # soft delete only - we never hard-delete clinical records, need to keep the audit trail intact
    patient = await get_patient_by_id(db, patient_id)
    if not patient:
        raise ValueError("Patient not found.")

    patient.is_active = False
    patient.updated_by = updated_by
    patient.updated_at = datetime.utcnow()

    return patient