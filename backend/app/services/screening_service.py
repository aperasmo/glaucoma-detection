# backend/app/services/screening_service.py
#
# Business logic for screening management.
# Handles screening creation, image saving, and status updates.
# ML inference is triggered as a background task after image is saved.

import uuid
import os
import shutil
from datetime import datetime

from fastapi import UploadFile
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.screening import Screening
from app.schemas.screening import CreateScreening
from app.core.logger import get_logger

logger = get_logger(__name__)

# Local folder where uploaded fundus images are stored.
# In production this will be replaced with AWS S3.
UPLOAD_DIR = "uploads/screenings"


def ensure_upload_dir():
    # Create the upload directory if it does not exist.
    os.makedirs(UPLOAD_DIR, exist_ok=True)


def validate_image_file(file: UploadFile) -> None:
    # Validate the uploaded file is jpg or png.
    # Checks both the file extension and the MIME type.
    # Defence in depth - both checks must pass.

    allowed_extensions = {".jpg", ".jpeg", ".png"}
    allowed_mime_types = {"image/jpeg", "image/png"}

    # Check file extension
    filename = file.filename or ""
    ext = os.path.splitext(filename)[-1].lower()
    if ext not in allowed_extensions:
        raise ValueError("Only JPG and PNG images are accepted.")

    # Check MIME type
    if file.content_type not in allowed_mime_types:
        raise ValueError("Invalid file type. Only JPG and PNG images are accepted.")


async def save_image(file: UploadFile, screening_id: uuid.UUID) -> str:
    # Save the uploaded image to the local uploads folder.
    # Filename is the screening UUID to avoid collisions and guessing.
    # Returns the relative file path for storage in the database.

    ensure_upload_dir()

    filename = file.filename or "image.jpg"
    ext = os.path.splitext(filename)[-1].lower()

    # Use screening UUID as filename - prevents duplicate names and path traversal attacks
    save_path = os.path.join(UPLOAD_DIR, f"{screening_id}{ext}")

    with open(save_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    return save_path


async def get_screening_by_id(db: AsyncSession, screening_id: uuid.UUID):
    # Fetch a single screening by UUID.
    # Returns None if not found.
    result = await db.execute(
        select(Screening).where(Screening.screening_id == screening_id)
    )
    return result.scalar_one_or_none()


async def get_screenings_by_patient(db: AsyncSession, patient_id: uuid.UUID):
    # Fetch all screenings for a specific patient.
    # Ordered by created_at descending - most recent first.
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
    # Create a new screening record and save the uploaded image.
    # Steps:
    # 1. Validate the image file type
    # 2. Create the screening record with status=pending
    # 3. Save the image using the screening UUID as filename
    # 4. Return the screening object for background ML trigger

    # Step 1 - Validate image type before doing anything else
    validate_image_file(image_file)

    # Step 2 - Create screening record first to get the UUID
    new_screening = Screening(
        patient_id=screening_data.patient_id,
        screened_by=created_by,
        image_path="",  # Filled in after image is saved
        eye_side=screening_data.eye_side,
        status="pending",
        remarks=screening_data.remarks,
        created_by=created_by,
        updated_by=created_by,
    )
    db.add(new_screening)
    await db.flush()  # Get the screening_id before saving the image

    # Step 3 - Save the image using screening UUID as filename
    image_path = await save_image(image_file, new_screening.screening_id)
    new_screening.image_path = image_path

    return new_screening


async def update_screening_status(
    db: AsyncSession,
    screening_id: uuid.UUID,
    status: str,
    updated_by: uuid.UUID,
) -> Screening:
    # Update the status of a screening during the ML pipeline.
    # Called internally by the ML inference background task.

    screening = await get_screening_by_id(db, screening_id)
    if not screening:
        raise ValueError("Screening not found.")

    screening.status = status
    screening.updated_by = updated_by
    screening.updated_at = datetime.utcnow()

    return screening