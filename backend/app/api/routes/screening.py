# backend/app/api/routes/screening.py
#
# Screening endpoints - image upload and screening management.
# Image upload triggers ML inference automatically as a background task.
# All routes are protected - valid JWT token required.

from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user, require_role
from app.db.database import get_db
from app.models.user import User
from app.schemas.screening import CreateScreening, ScreeningResponse
from app.services.screening_service import (
    create_screening,
    get_screening_by_id,
    get_screenings_by_patient,
)

from app.db.database import AsyncSessionLocal
from app.ml_inference.inference import run_inference_pipeline
from app.core.logger import get_logger

logger = get_logger(__name__)


router = APIRouter(prefix="/screenings", tags=["Screenings"])


@router.post("/", response_model=ScreeningResponse, status_code=status.HTTP_201_CREATED)
async def upload_screening(
    patient_id: UUID,
    eye_side: str,
    background_tasks: BackgroundTasks,
    image: UploadFile = File(...),    
    remarks: str = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("admin", "nurse")),
):
    # Upload a fundus image and create a new screening record.
    # Image is validated and saved immediately.
    # ML inference is triggered automatically as a background task.
    # Restricted to admin and nurse roles.

    from app.schemas.screening import CreateScreening

    screening_data = CreateScreening(
        patient_id=patient_id,
        eye_side=eye_side,
        remarks=remarks,
    )

    try:

        screening = await create_screening(
            db=db,
            screening_data=screening_data,
            image_file=image,
            created_by=current_user.user_id,
        )

        # Commit immediately so the background task can find the record
        await db.commit()
        await db.refresh(screening)

        # Trigger ML inference in the background
        background_tasks.add_task(
            run_ml_inference,
            screening_id=screening.screening_id,
            image_path=screening.image_path,
        )

        return screening

    except ValueError as e:
        logger.warning(f"Screening upload validation failed: {e}")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.get("/patient/{patient_id}", response_model=list[ScreeningResponse], status_code=status.HTTP_200_OK)
async def list_patient_screenings(
    patient_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Retrieve all screenings for a specific patient.
    # Ordered by most recent first.
    # Accessible to all authenticated roles.
    return await get_screenings_by_patient(db, patient_id)

@router.get("/", response_model=list, status_code=status.HTTP_200_OK)
async def list_all_screenings(
    skip: int = 0,
    limit: int = 10,
    status: str = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # List all screenings across all patients with pagination.
    # Optionally filter by status e.g. ?status=complete
    from app.services.screening_service import get_all_screenings
    return await get_all_screenings(db, skip, limit, status)


@router.get("/recent", response_model=list, status_code=status.HTTP_200_OK)
async def recent_screenings(
    limit: int = 5,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Return last N complete screenings with ensemble result data.
    # Used for Dashboard recent screenings panel.
    from app.services.screening_service import get_recent_screenings
    return await get_recent_screenings(db, limit)


@router.get("/stats", response_model=dict, status_code=status.HTTP_200_OK)
async def dashboard_stats(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Return dashboard summary statistics.
    # Powers the stats cards on the Dashboard page.
    from app.services.screening_service import get_dashboard_stats
    return await get_dashboard_stats(db)

@router.get("/analytics", status_code=status.HTTP_200_OK)
async def get_analytics(
    days: int = 30,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Return analytics data for the Analytics Dashboard.
    # days parameter controls the time range - default 30 days.
    from app.services.screening_service import get_analytics
    return await get_analytics(db, days)


@router.get("/{screening_id}", response_model=ScreeningResponse, status_code=status.HTTP_200_OK)
async def get_screening(
    screening_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Retrieve a single screening by UUID.
    # Accessible to all authenticated roles.
    screening = await get_screening_by_id(db, screening_id)
    if not screening:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Screening not found."
        )
    return screening


async def run_ml_inference(screening_id: UUID, image_path: str):
    # 1. Load the three models (EfficientNetB0, VGG16, EfficientNetV2)
    # 2. Run inference and ensemble
    # 3. Generate Grad-CAM++ heatmap
    # 4. Calculate OHTS risk score
    # 5. Generate LLM referral letter
    # 6. Save results to screening_results table
    # 7. Update screening status to complete


    try:
        async with AsyncSessionLocal() as db:
            await run_inference_pipeline(
                screening_id=screening_id,
                image_path=image_path,
                db=db,
                created_by=None,
            )
    except Exception as e:
        logger.error(f"ML inference pipeline failed for screening {screening_id}: {e}", exc_info=True)