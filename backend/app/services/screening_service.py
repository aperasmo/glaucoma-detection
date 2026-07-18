# screening creation, image saving, status updates. ML inference kicks off
# as a background task once the image is on disk.

import uuid
import os
import shutil

from datetime import date, timedelta, datetime

from fastapi import UploadFile

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, cast, Date, extract, case

from app.schemas.screening import CreateScreening
from app.core.logger import get_logger

from app.models.screening import Screening
from app.models.patient import Patient
from app.models.screening_result import ScreeningResult


logger = get_logger(__name__)

# stores locally for now - swap for S3 when we move to production
UPLOAD_DIR = "uploads/screenings"


def ensure_upload_dir():
    os.makedirs(UPLOAD_DIR, exist_ok=True)


def validate_image_file(file: UploadFile) -> None:
    # checking both extension and MIME type since either one alone can be spoofed

    allowed_extensions = {".jpg", ".jpeg", ".png"}
    allowed_mime_types = {"image/jpeg", "image/png"}

    filename = file.filename or ""
    ext = os.path.splitext(filename)[-1].lower()
    if ext not in allowed_extensions:
        raise ValueError("Only JPG and PNG images are accepted.")

    if file.content_type not in allowed_mime_types:
        raise ValueError("Invalid file type. Only JPG and PNG images are accepted.")


async def save_image(file: UploadFile, screening_id: uuid.UUID) -> str:
    # returns the relative path so it can be stored on the screening record
    ensure_upload_dir()

    filename = file.filename or "image.jpg"
    ext = os.path.splitext(filename)[-1].lower()

    # naming the file after the screening UUID sidesteps collisions and path traversal
    save_path = os.path.join(UPLOAD_DIR, f"{screening_id}{ext}")

    with open(save_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    return save_path


async def get_screening_by_id(db: AsyncSession, screening_id: uuid.UUID):
    result = await db.execute(
        select(Screening).where(Screening.screening_id == screening_id)
    )
    return result.scalar_one_or_none()


async def get_screenings_by_patient(db: AsyncSession, patient_id: uuid.UUID):
    # newest first
    result = await db.execute(
        select(Screening)
        .where(Screening.patient_id == patient_id)
        .order_by(Screening.created_at.desc())
    )
    return result.scalars().all()


async def create_screening(
    db: AsyncSession,
    screening_data: CreateScreening,
    image_file: UploadFile,
    created_by: uuid.UUID,
) -> Screening:
    # reject bad files before we touch the DB at all
    validate_image_file(image_file)

    # create the row first so we've got a screening_id to name the image file after
    new_screening = Screening(
        patient_id=screening_data.patient_id,
        screened_by=created_by,
        image_path="",  # set once the image is actually saved below
        eye_side=screening_data.eye_side,
        status="pending",
        remarks=screening_data.remarks,
        created_by=created_by,
        updated_by=created_by,
    )
    db.add(new_screening)
    await db.flush()  # need the generated screening_id before we can save the image

    image_path = await save_image(image_file, new_screening.screening_id)
    new_screening.image_path = image_path

    return new_screening


async def update_screening_status(
    db: AsyncSession,
    screening_id: uuid.UUID,
    status: str,
    updated_by: uuid.UUID,
) -> Screening:
    # called by the ML background task as it moves through the pipeline
    screening = await get_screening_by_id(db, screening_id)
    if not screening:
        raise ValueError("Screening not found.")

    screening.status = status
    screening.updated_by = updated_by
    screening.updated_at = datetime.utcnow()

    return screening


async def get_all_screenings(
    db: AsyncSession,
    skip: int = 0,
    limit: int = 10,
    status: str = None,
) -> list:
    # every screening across all patients, with patient name + ensemble result
    # joined in; status filter is optional
    query = (
        select(
            Screening.screening_id,
            Screening.patient_id,
            Screening.eye_side,
            Screening.status,
            Screening.created_at,
            Patient.first_name,
            Patient.last_name,
            Patient.patient_code,
            ScreeningResult.prediction,
            ScreeningResult.confidence_score,
            ScreeningResult.ohts_tier,
            ScreeningResult.model_used,
        )
        .join(Patient, Screening.patient_id == Patient.patient_id)
        .outerjoin(
            ScreeningResult,
            (ScreeningResult.screening_id == Screening.screening_id)
            & (ScreeningResult.model_used == "ensemble")
            & (ScreeningResult.llm_used.is_(None)),
        )
        .order_by(Screening.created_at.desc())
        .offset(skip)
        .limit(limit)
    )

    if status:
        query = query.where(Screening.status == status)

    result = await db.execute(query)
    rows = result.fetchall()

    return [
        {
            "screening_id": row.screening_id,
            "patient_id": row.patient_id,
            "patient_name": f"{row.first_name} {row.last_name}",
            "patient_code": row.patient_code,
            "eye_side": row.eye_side,
            "status": row.status,
            "prediction": row.prediction,
            "confidence_score": float(row.confidence_score) if row.confidence_score else None,
            "ohts_tier": row.ohts_tier,
            "model_used": row.model_used,
            "created_at": row.created_at,
        }
        for row in rows
    ]


async def get_recent_screenings(db: AsyncSession, limit: int = 5) -> list:
    # feeds the dashboard's recent screenings panel
    query = (
        select(
            Screening.screening_id,
            Screening.eye_side,
            Screening.created_at,
            Patient.first_name,
            Patient.last_name,
            Patient.patient_code,
            ScreeningResult.prediction,
            ScreeningResult.confidence_score,
            ScreeningResult.model_used,
            ScreeningResult.ohts_tier,
        )
        .join(Patient, Screening.patient_id == Patient.patient_id)
        .join(
            ScreeningResult,
            (ScreeningResult.screening_id == Screening.screening_id)
            & (ScreeningResult.model_used == "ensemble")
            & (ScreeningResult.llm_used.is_(None)),
        )
        .where(Screening.status == "complete")
        .order_by(Screening.created_at.desc())
        .limit(limit)
    )

    result = await db.execute(query)
    rows = result.fetchall()

    return [
        {
            "screening_id": row.screening_id,
            "patient_name": f"{row.first_name} {row.last_name}",
            "patient_code": row.patient_code,
            "eye_side": row.eye_side,
            "prediction": row.prediction,
            "confidence_score": float(row.confidence_score),
            "model_used": row.model_used,
            "ohts_tier": row.ohts_tier,
            "created_at": row.created_at,
        }
        for row in rows
    ]


async def get_dashboard_stats(db: AsyncSession) -> dict:
    # one query per stat - simple, if a bit chatty on the DB

    from datetime import date

    total_patients = await db.execute(
        select(func.count()).select_from(Patient).where(Patient.is_active == True)
    )
    total_patients = total_patients.scalar()

    # ensemble only, not the per-model rows
    glaucoma_positive = await db.execute(
        select(func.count()).select_from(ScreeningResult).where(
            ScreeningResult.model_used == "ensemble",
            ScreeningResult.prediction == "glaucoma",
            ScreeningResult.llm_used.is_(None),
        )
    )
    glaucoma_positive = glaucoma_positive.scalar()

    screenings_today = await db.execute(
        select(func.count()).select_from(Screening).where(
            cast(Screening.created_at, Date) == date.today()
        )
    )
    screenings_today = screenings_today.scalar()

    # glaucoma-positive plus OHTS critical or possible
    high_risk_count = await db.execute(
        select(func.count()).select_from(ScreeningResult).where(
            ScreeningResult.model_used == "ensemble",
            ScreeningResult.prediction == "glaucoma",
            ScreeningResult.ohts_tier.in_(["critical", "possible"]),
            ScreeningResult.llm_used.is_(None),
        )
    )
    high_risk_count = high_risk_count.scalar()

    # Pending screenings
    pending_count = await db.execute(
        select(func.count()).select_from(Screening).where(
            Screening.status == "pending"
        )
    )
    pending_count = pending_count.scalar()

    # New patients this month
    new_this_month = await db.execute(
        select(func.count()).select_from(Patient).where(
            Patient.is_active == True,
            extract('month', Patient.created_at) == date.today().month,
            extract('year', Patient.created_at) == date.today().year,
        )
    )
    new_this_month = new_this_month.scalar()

    # Total complete screenings for percentage calculation
    total_screenings = await db.execute(
        select(func.count()).select_from(ScreeningResult).where(
            ScreeningResult.model_used == "ensemble",
            ScreeningResult.llm_used.is_(None),
        )
    )
    total_screenings = total_screenings.scalar()

    # Glaucoma percentage
    glaucoma_percent = (
        round((glaucoma_positive / total_screenings) * 100, 1)
        if total_screenings > 0 else 0.0
    )

    # Yesterday's screening count
    yesterday = date.today() - timedelta(days=1)
    screenings_yesterday = await db.execute(
        select(func.count()).select_from(Screening).where(
            cast(Screening.created_at, Date) == yesterday
        )
    )
    screenings_yesterday = screenings_yesterday.scalar()

    # Difference vs yesterday
    screenings_vs_yesterday = screenings_today - screenings_yesterday

# Average confidence score across all complete ensemble results
    avg_confidence = await db.execute(
        select(func.avg(ScreeningResult.confidence_score)).where(
            ScreeningResult.model_used == "ensemble",
            ScreeningResult.llm_used.is_(None),
        )
    )
    avg_confidence_score = round(float(avg_confidence.scalar() or 0), 4)

    # Average CDR across screenings that have CDR
    avg_cdr_result = await db.execute(
        select(func.avg(ScreeningResult.cdr)).where(
            ScreeningResult.model_used == "ensemble",
            ScreeningResult.llm_used.is_(None),
            ScreeningResult.cdr.isnot(None),
        )
    )
    avg_cdr = round(float(avg_cdr_result.scalar() or 0), 3)

    # OHTS tier counts
    possible_ohts = await db.execute(
        select(func.count()).select_from(ScreeningResult).where(
            ScreeningResult.model_used == "ensemble",
            ScreeningResult.llm_used.is_(None),
            ScreeningResult.ohts_tier == "possible",
        )
    )
    possible_ohts_count = possible_ohts.scalar()

    critical_ohts = await db.execute(
        select(func.count()).select_from(ScreeningResult).where(
            ScreeningResult.model_used == "ensemble",
            ScreeningResult.llm_used.is_(None),
            ScreeningResult.ohts_tier == "critical",
        )
    )
    critical_ohts_count = critical_ohts.scalar()

    # Failed screenings
    failed_count_result = await db.execute(
        select(func.count()).select_from(Screening).where(
            Screening.status == "failed"
        )
    )
    failed_count = failed_count_result.scalar()

    # Normal count
    normal_count_result = await db.execute(
        select(func.count()).select_from(ScreeningResult).where(
            ScreeningResult.model_used == "ensemble",
            ScreeningResult.llm_used.is_(None),
            ScreeningResult.prediction == "normal",
        )
    )
    normal_count = normal_count_result.scalar()


    return {
        "total_patients": total_patients,
        "glaucoma_positive": glaucoma_positive,
        "screenings_today": screenings_today,
        "high_risk_count": high_risk_count,
        "pending_count": pending_count,
        "new_this_month": new_this_month,
        "glaucoma_percent": glaucoma_percent,
        "screenings_vs_yesterday": screenings_vs_yesterday,
        "avg_confidence_score": avg_confidence_score,
        "avg_cdr": avg_cdr,
        "possible_ohts_count": possible_ohts_count,
        "critical_ohts_count": critical_ohts_count,
        "failed_count": failed_count,
        "normal_count": normal_count,
    }

async def get_analytics(
    db: AsyncSession,
    days: int = 30,
    start_date: str = None,
    end_date: str = None,
) -> dict:
    # Fetch analytics data for the Analytics Dashboard.
    # Accepts either days parameter or explicit start_date/end_date range.
    # All queries respect the same date range for consistency.

    from datetime import datetime, time
    from sqlalchemy import case

    # Resolve date range
    if start_date:
        start = datetime.strptime(start_date, "%Y-%m-%d").date()
    else:
        start = date.today() - timedelta(days=days)

    if end_date:
        end = datetime.strptime(end_date, "%Y-%m-%d").date()
    else:
        end = date.today()

    # Convert to datetime for comparison
    start_dt = datetime.combine(start, time.min)
    end_dt = datetime.combine(end, time.max)

    # --- Screenings over time ---
    daily_query = await db.execute(
        select(
            cast(Screening.created_at, Date).label("date"),
            func.count(Screening.screening_id).label("total"),
            func.sum(
                case(
                    (ScreeningResult.prediction == "glaucoma", 1),
                    else_=0
                )
            ).label("positive"),
        )
        .outerjoin(
            ScreeningResult,
            (ScreeningResult.screening_id == Screening.screening_id)
            & (ScreeningResult.model_used == "ensemble")
            & (ScreeningResult.llm_used.is_(None)),
        )
        .where(
            Screening.created_at >= start_dt,
            Screening.created_at <= end_dt,
        )
        .group_by(cast(Screening.created_at, Date))
        .order_by(cast(Screening.created_at, Date))
    )
    screenings_over_time = [
        {
            "date": str(row.date),
            "total": row.total,
            "positive": int(row.positive or 0),
        }
        for row in daily_query.fetchall()
    ]

    # --- OHTS distribution ---
    ohts_low = await db.execute(
        select(func.count()).select_from(ScreeningResult)
        .join(Screening, Screening.screening_id == ScreeningResult.screening_id)
        .where(
            ScreeningResult.model_used == "ensemble",
            ScreeningResult.llm_used.is_(None),
            ScreeningResult.ohts_tier == "low",
            Screening.created_at >= start_dt,
            Screening.created_at <= end_dt,
        )
    )
    ohts_possible = await db.execute(
        select(func.count()).select_from(ScreeningResult)
        .join(Screening, Screening.screening_id == ScreeningResult.screening_id)
        .where(
            ScreeningResult.model_used == "ensemble",
            ScreeningResult.llm_used.is_(None),
            ScreeningResult.ohts_tier == "possible",
            Screening.created_at >= start_dt,
            Screening.created_at <= end_dt,
        )
    )
    ohts_critical = await db.execute(
        select(func.count()).select_from(ScreeningResult)
        .join(Screening, Screening.screening_id == ScreeningResult.screening_id)
        .where(
            ScreeningResult.model_used == "ensemble",
            ScreeningResult.llm_used.is_(None),
            ScreeningResult.ohts_tier == "critical",
            Screening.created_at >= start_dt,
            Screening.created_at <= end_dt,
        )
    )
    ohts_distribution = {
        "low": ohts_low.scalar(),
        "possible": ohts_possible.scalar(),
        "critical": ohts_critical.scalar(),
    }

    # --- Status distribution ---
    status_counts = {}
    for s in ["complete", "pending", "failed", "processing"]:
        result = await db.execute(
            select(func.count()).select_from(Screening).where(
                Screening.status == s,
                Screening.created_at >= start_dt,
                Screening.created_at <= end_dt,
            )
        )
        status_counts[s] = result.scalar()

    # --- Mode usage ---
    clinical_mode = await db.execute(
        select(func.count(Screening.screening_id.distinct()))
        .where(
            Screening.created_at >= start_dt,
            Screening.created_at <= end_dt,
            ~Screening.screening_id.in_(
                select(ScreeningResult.screening_id).where(
                    ScreeningResult.model_used != "ensemble"
                )
            )
        )
    )
    research_mode = await db.execute(
        select(func.count(Screening.screening_id.distinct()))
        .where(
            Screening.created_at >= start_dt,
            Screening.created_at <= end_dt,
            Screening.screening_id.in_(
                select(ScreeningResult.screening_id).where(
                    ScreeningResult.model_used != "ensemble"
                )
            )
        )
    )
    model_usage = {
        "clinical_mode": clinical_mode.scalar(),
        "research_mode": research_mode.scalar(),
    }

    # --- High risk screenings ---
    high_risk = await db.execute(
        select(
            Screening.screening_id,
            Screening.eye_side,
            Screening.created_at,
            Patient.first_name,
            Patient.last_name,
            Patient.patient_code,
            Patient.dob,
            Patient.gender,
            ScreeningResult.prediction,
            ScreeningResult.confidence_score,
            ScreeningResult.ohts_tier,
            ScreeningResult.ohts_score,
            ScreeningResult.cdr,
            ScreeningResult.gradcam_path,
        )
        .join(Patient, Screening.patient_id == Patient.patient_id)
        .join(
            ScreeningResult,
            (ScreeningResult.screening_id == Screening.screening_id)
            & (ScreeningResult.model_used == "ensemble")
            & (ScreeningResult.llm_used.is_(None)),
        )
        .where(
            ScreeningResult.prediction == "glaucoma",
            Screening.created_at >= start_dt,
            Screening.created_at <= end_dt,
        )
        .order_by(Screening.created_at.desc())
    )
    high_risk_screenings = [
        {
            "screening_id": row.screening_id,
            "patient_name": f"{row.first_name} {row.last_name}",
            "patient_code": row.patient_code,
            "dob": str(row.dob) if row.dob else None,
            "gender": row.gender,
            "eye_side": row.eye_side,
            "prediction": row.prediction,
            "confidence_score": float(row.confidence_score),
            "ohts_tier": row.ohts_tier,
            "ohts_score": float(row.ohts_score) if row.ohts_score else None,
            "cdr": float(row.cdr) if row.cdr else None,
            "gradcam_path": row.gradcam_path,
            "created_at": row.created_at,
        }
        for row in high_risk.fetchall()
    ]

    return {
        "screenings_over_time": screenings_over_time,
        "ohts_distribution": ohts_distribution,
        "status_distribution": status_counts,
        "model_usage": model_usage,
        "high_risk_screenings": high_risk_screenings,
    }
