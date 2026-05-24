# backend/app/api/routes/patient.py
#
# Patient CRUD endpoints.
# All routes are protected - valid JWT token required.
# Role-based access control applied per endpoint.


from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession # for async DB access

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

router = APIRouter(prefix="/patients", tags=["Patients"]) # all routes start with /patients

@router.post("/", response_model=ResponsePatient, status_code=status.HTTP_201_CREATED)
async def register_patient(
    patient_data: CreatePatient,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("admin","nurse")), # only admin and nurse can create patients
):
    # Create a new patient.
    # Only admin and nurse can create patients.
    # Returns the created patient data.
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
    # Retrieve all active patients with pagination.
    # Accessible to all authenticated roles.
    return await get_all_patients(db, skip, limit)    # returns list of patients

@router.get("/{patient_id}", response_model=ResponsePatient, status_code=status.HTTP_200_OK)
async def get_patient(
    patient_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Retrieve a single patient by UUID.
    # Accessible to all authenticated roles.
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
    # Update an existing patient record.
    # Restricted to admin and nurse roles only.
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
    # Soft delete a patient - sets is_active=False.
    # Restricted to admin only.
    # Data is never permanently deleted.
    try:
        return await delete_patient(db, patient_id, current_user.user_id)
    except ValueError as e:
        logger.warning(f"Patient delete failed for {patient_id}: {e}")
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))