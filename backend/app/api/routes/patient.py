# patient CRUD - every route here needs a valid JWT, plus role checks per endpoint

from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user, require_role
from app.db.database import get_db
from app.models.user import User
from app.schemas.patient import CreatePatient, UpdatePatient, ResponsePatient
from app.services.patient_service import (
    create_patient,
    get_all_patients,
    get_patient_by_id,
    update_patient,
    delete_patient
)
from app.core.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/patients", tags=["Patients"])

@router.post("/", response_model=ResponsePatient, status_code=status.HTTP_201_CREATED)
async def register_patient(
    patient_data: CreatePatient,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("admin","nurse")), # admin/nurse only
):
    try:
        return await create_patient(db, patient_data, current_user.user_id)
    except Exception as e:
        logger.error(f"Patient creation failed: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    
@router.get("/", response_model=list[ResponsePatient], status_code=status.HTTP_200_OK)
async def list_patients(
    skip: int = 0,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # any authenticated role can list patients
    return await get_all_patients(db, skip, limit)

@router.get("/{patient_id}", response_model=ResponsePatient, status_code=status.HTTP_200_OK)
async def get_patient(
    patient_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    patient = await get_patient_by_id(db, patient_id)
    if not patient:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found.")
    return patient

@router.put("/{patient_id}", response_model=ResponsePatient, status_code=status.HTTP_200_OK)
async def modify_patient(
    patient_id: UUID,
    patient_data: UpdatePatient,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("admin", "nurse")),
):
    try:
        return await update_patient(db, patient_id, patient_data, current_user.user_id)
    except ValueError as e:
        logger.warning(f"Patient update failed for {patient_id}: {e}")
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.delete("/{patient_id}", response_model=ResponsePatient, status_code=status.HTTP_200_OK)
async def remove_patient(
    patient_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    # soft delete only - flips is_active, never actually removes the row
    try:
        return await delete_patient(db, patient_id, current_user.user_id)
    except ValueError as e:
        logger.warning(f"Patient delete failed for {patient_id}: {e}")
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))