# backend/app/services/patient_service.py
#
# Business logic for patient management.
# Handles patient creation, retrieval, update, and soft delete.
# Kept separate from routes so logic can be reused and tested independently.

import uuid
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.models.patient import Patient
from app.schemas.patient import CreatePatient, UpdatePatient


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


async def get_all_patients(db: AsyncSession, skip: int = 0, limit: int = 50):
    # Fetch all active patients with pagination.
    # skip and limit control the page size - default 50 per page.
    # Ordered by last_name for consistent display.
    result = await db.execute(
        select(Patient)
        .where(Patient.is_active == True)
        .order_by(Patient.last_name)
        .offset(skip)
        .limit(limit)
    )
    return result.scalars().all()


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