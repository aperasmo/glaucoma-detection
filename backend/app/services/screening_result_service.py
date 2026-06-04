# backend/app/services/screening_result_service.py
#
# Business logic for retrieving screening results.
# Results are written by the inference pipeline - this service reads them.

import uuid
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.models.screening import Screening
from app.models.screening_result import ScreeningResult


async def get_results_by_screening(
    db: AsyncSession,
    screening_id: uuid.UUID,
) -> list[ScreeningResult]:
    # Fetch all results for a single screening.
    # Returns all model results - frontend filters by mode.
    result = await db.execute(
        select(ScreeningResult)
        .where(ScreeningResult.screening_id == screening_id)
        .order_by(ScreeningResult.created_at)
    )
    return result.scalars().all()


async def get_ensemble_result(
    db: AsyncSession,
    screening_id: uuid.UUID,
) -> ScreeningResult:
    # Fetch only the ensemble result for a screening.
    # Used in Clinical Mode - ensemble is the authoritative output.
    result = await db.execute(
        select(ScreeningResult).where(
            ScreeningResult.screening_id == screening_id,
            ScreeningResult.model_used == "ensemble",
            ScreeningResult.llm_used == None,
        )
    )
    return result.scalar_one_or_none()


async def get_screening_with_results(
    db: AsyncSession,
    screening_id: uuid.UUID,
) -> dict:
    # Fetch a screening record together with all its results and patient details.
    # Used for the full clinical results page and referral letter print header.

    from app.models.patient import Patient

    screening_result = await db.execute(
        select(Screening, Patient)
        .join(Patient, Screening.patient_id == Patient.patient_id)
        .where(Screening.screening_id == screening_id)
    )
    row = screening_result.first()

    if not row:
        return None

    screening, patient = row

    results = await get_results_by_screening(db, screening_id)

    return {
        "screening_id": screening.screening_id,
        "patient_id": screening.patient_id,
        "patient_name": f"{patient.first_name} {patient.last_name}",
        "patient_code": patient.patient_code,
        "patient_dob": str(patient.dob) if patient.dob else None,
        "patient_gender": patient.gender,
        "eye_side": screening.eye_side,
        "status": screening.status,
        "image_path": screening.image_path,
        "created_at": screening.created_at,
        "results": results,
    }