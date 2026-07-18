# the inference pipeline writes screening results, this module just reads them back


import uuid
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select,text
from sqlalchemy.orm import selectinload

from app.models.screening import Screening
from app.models.screening_result import ScreeningResult



from app.core.logger import get_logger
logger = get_logger(__name__)

async def get_results_by_screening(
    db: AsyncSession,
    screening_id: uuid.UUID,
) -> list[ScreeningResult]:
    # returns every model's result - it's up to the frontend to filter by mode
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
    # Clinical Mode only cares about the ensemble output, not the individual models
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
    # pulls together screening + results + patient info for the full results
    # page and the referral letter print header
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

    # # DEBUG: comparing ORM value vs the raw DB value - leaving this here
    # # in case /results/{screening_id}/full acts up again
    # orm_inference_mode = getattr(screening, "inference_mode", None)

    # db_mode_result = await db.execute(
    #     text("""
    #         SELECT inference_mode::text
    #         FROM screenings
    #         WHERE screening_id = :screening_id
    #     """),
    #     {"screening_id": str(screening_id)},
    # )

    # db_inference_mode = db_mode_result.scalar_one_or_none()

    # logger.info(
    #     "DEBUG /full inference_mode | screening_id=%s | orm=%s | db=%s",
    #     screening_id,
    #     orm_inference_mode,
    #     db_inference_mode,
    # )


    return {
        "screening_id": screening.screening_id,
        "patient_id": screening.patient_id,
        "patient_name": f"{patient.first_name} {patient.last_name}",
        "patient_code": patient.patient_code,
        "patient_dob": str(patient.dob) if patient.dob else None,
        "patient_gender": patient.gender,
        "eye_side": screening.eye_side,
        "status": screening.status,
        "inference_mode": getattr(screening, "inference_mode", None) or "clinical", # older screenings predate this column
        #"inference_mode": db_inference_mode or orm_inference_mode or "clinical",
        "image_path": screening.image_path,
        "created_at": screening.created_at,
        "results": results,
    }