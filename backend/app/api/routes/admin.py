# backend/app/api/routes/admin.py
#
# Admin utility endpoints.
# Database reset and bulk screening seed for development and demo purposes.
# All endpoints are admin-only and require explicit confirmation.

import os
import random
import shutil
import uuid
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.core.config import settings
from app.core.dependencies import require_role
from app.core.logger import get_logger
from app.db.database import get_db, AsyncSessionLocal
from app.models.user import User

logger = get_logger(__name__)

router = APIRouter(prefix="/admin", tags=["Admin"])


# --- NZ realistic name pool ---
NZ_FIRST_NAMES_MALE = [
    "James", "William", "Oliver", "Jack", "Noah", "Lucas", "Mason", "Liam",
    "Ethan", "Logan", "Henry", "Samuel", "Daniel", "Benjamin", "Alexander"
]
NZ_FIRST_NAMES_FEMALE = [
    "Charlotte", "Olivia", "Isabella", "Sophie", "Amelia", "Grace", "Isla",
    "Emma", "Mia", "Aria", "Hannah", "Lily", "Zoe", "Chloe", "Ruby"
]
NZ_LAST_NAMES = [
    "Smith", "Jones", "Williams", "Brown", "Taylor", "Wilson", "Johnson",
    "Anderson", "Thompson", "Walker", "Martin", "White", "Harris", "Clark",
    "Lewis", "Robinson", "Young", "Hall", "Allen", "King", "Tane", "Parata",
    "Ngata", "Heke", "Waititi", "Tamaki", "Reweti", "Ngai", "Poa", "Tūhoe"
]
NZ_AREA_CODES = ["021", "022", "027"]


def generate_nz_patient() -> dict:
    # Generate a realistic NZ patient record with random demographics.
    gender = random.choice(["male", "female"])
    first_name = random.choice(
        NZ_FIRST_NAMES_MALE if gender == "male" else NZ_FIRST_NAMES_FEMALE
    )
    last_name = random.choice(NZ_LAST_NAMES)

    # Age between 40 and 80 - typical glaucoma screening age range
    age = random.randint(40, 80)
    dob = date.today() - timedelta(days=age * 365 + random.randint(0, 364))

    # IOP range 18-32 mmHg - clinically relevant range
    iop = round(random.uniform(18.0, 32.0), 1)

    # CCT range 480-600 micrometres
    cct = round(random.uniform(480.0, 600.0), 1)

    mobile = f"{random.choice(NZ_AREA_CODES)}{random.randint(1000000, 9999999)}"

    return {
        "first_name": first_name,
        "last_name": last_name,
        "gender": gender,
        "dob": dob,
        "iop": iop,
        "cct": cct,
        "mobile_number": mobile,
        "email": f"{first_name.lower()}.{last_name.lower()}@email.com",
    }


@router.post("/reset-database", status_code=status.HTTP_200_OK)
async def reset_database(
    confirm: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    # Reset the database - clears all data except system_settings and SYS00001 user.
    # Requires confirm="RESET" to prevent accidental execution.
    # Resets patient and screening sequences back to 1.

    if confirm != "RESET":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Confirmation required. Pass confirm=RESET to proceed."
        )

    logger.info(f"Database reset initiated by {current_user.user_code}")

    try:
        # Delete in order respecting foreign key constraints
        await db.execute(text("DELETE FROM screening_results"))
        await db.execute(text("DELETE FROM screenings"))
        await db.execute(text("DELETE FROM user_tokens"))
        await db.execute(text("DELETE FROM patients"))
        await db.execute(
            text("DELETE FROM users WHERE user_code NOT LIKE 'SYS%'")
        )
        await db.commit()

        logger.info("Database reset complete.")

        return {
            "message": "Database reset successfully.",
            "cleared_tables": [
                "screening_results",
                "screenings",
                "user_tokens",
                "patients",
                "users (except SYS accounts)",
            ],
            "preserved": [
                "system_settings",
                "users where user_code starts with SYS",
            ],
        }

    except Exception as e:
        logger.error(f"Database reset failed: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Reset failed: {str(e)}"
        )


@router.post("/seed-screenings", status_code=status.HTTP_200_OK)
async def seed_screenings(
    background_tasks: BackgroundTasks,
    count: int = 10,
    current_user: User = Depends(require_role("admin")),
):
    # Seed the database with realistic screenings from the test images folder.
    # Creates a new patient per image, runs full inference pipeline.
    # Moves processed images to done/ folder after screening.
    # Runs as a background task - returns immediately.

    if count < 1 or count > 100:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Count must be between 1 and 100."
        )

    # Check test images folder exists
    test_dir = settings.TEST_IMAGES_DIR
    if not os.path.exists(test_dir):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Test images folder not found: {test_dir}"
        )

    # Get available images
    valid_extensions = {".jpg", ".jpeg", ".png"}
    available_images = [
        f for f in os.listdir(test_dir)
        if os.path.splitext(f)[-1].lower() in valid_extensions
    ]

    if not available_images:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No images found in test images folder."
        )

    actual_count = min(count, len(available_images))

    # Select images to process
    selected_images = random.sample(available_images, actual_count)

    logger.info(
        f"Seed screenings started by {current_user.user_code}. "
        f"Processing {actual_count} images."
    )

    # Run in background
    background_tasks.add_task(
        run_seed_screenings,
        selected_images=selected_images,
        test_dir=test_dir,
        created_by=current_user.user_id,
    )

    return {
        "message": f"Seeding {actual_count} screenings in background.",
        "count": actual_count,
        "note": "Check logs for progress. Images will be moved to done/ after processing.",
    }


async def run_seed_screenings(
    selected_images: list,
    test_dir: str,
    created_by: uuid.UUID,
):
    # Background task - processes each image one by one.
    # Creates patient, runs inference, moves image to done/.

    from app.models.patient import Patient
    from app.models.screening import Screening
    from app.ml_inference.inference import run_inference_pipeline
    from app.services.patient_service import generate_patient_code

    done_dir = settings.TEST_IMAGES_DONE_DIR
    os.makedirs(done_dir, exist_ok=True)

    success_count = 0
    failed_count = 0

    # Seed inference mode alternation:
    # - We check the most recent screening mode in the database.
    # - The first seeded record becomes the opposite of the last saved mode.
    # - This keeps alternation continuous across multiple seed runs.
    #
    # Example:
    #   Last DB mode = clinical
    #   New seed batch = research, clinical, research, clinical...
    #
    # If there are no previous screenings, default last_mode to "research"
    # so the first seeded record becomes "clinical".
    last_mode = "research"  # Default if no previous mode found or on error

    # try:
    #     async with AsyncSessionLocal() as db:
    #         last_mode_result = await db.execute(
    #             text("""
    #                 SELECT inference_mode::text
    #                 FROM screenings
    #                 WHERE inference_mode IS NOT NULL
    #                 ORDER BY created_at DESC
    #                 LIMIT 1
    #             """)
    #         )

    #         db_last_mode = last_mode_result.scalar_one_or_none()

    #         if db_last_mode in {"clinical", "research"}:
    #             last_mode = db_last_mode

    #     logger.info("[seed] Last saved inference mode: %s", last_mode)

    # except Exception as e:
    #     # Do not stop seeding if this lookup fails.
    #     # We fall back to last_mode = "research", making the first seed clinical.
    #     logger.warning(
    #         "[seed] Could not read last inference mode. Falling back to first seed as clinical. Error: %s",
    #         str(e),
    #     )

    for index, filename in enumerate(selected_images):
        image_path = os.path.join(test_dir, filename)

        # Example if last_mode starts as "research":
        #   1st = clinical
        #   2nd = research
        #   3rd = clinical
        current_mode = "clinical" if last_mode == "research" else "research"
        last_mode = current_mode

        try:
            async with AsyncSessionLocal() as db:

                # Step 1 - Generate realistic patient
                patient_data = generate_nz_patient()
                patient_code = await generate_patient_code(db)

                new_patient = Patient(
                    patient_code=patient_code,
                    first_name=patient_data["first_name"],
                    last_name=patient_data["last_name"],
                    dob=patient_data["dob"],
                    gender=patient_data["gender"],
                    email=patient_data["email"],
                    mobile_number=patient_data["mobile_number"],
                    iop=patient_data["iop"],
                    cct=patient_data["cct"],
                    is_active=True,
                    created_by=created_by,
                    updated_by=created_by,
                )
                db.add(new_patient)
                await db.flush()

                # Step 2 - Create screening record
                screening_id = uuid.uuid4()
                eye_side = random.choice(["left", "right"])

                # Copy image to uploads folder
                upload_path = os.path.join(
                    "uploads/screenings",
                    f"{screening_id}{os.path.splitext(filename)[-1]}"
                )
                shutil.copy2(image_path, upload_path)

                new_screening = Screening(
                    screening_id=screening_id,
                    patient_id=new_patient.patient_id,
                    screened_by=created_by,
                    image_path=upload_path,
                    eye_side=eye_side,
                    status="pending",
                    inference_mode=current_mode,
                    created_by=created_by,
                    updated_by=created_by,
                )
                db.add(new_screening)
                await db.commit()

                logger.info(
                    f"[seed] Patient {patient_code} created. "
                    f"Screening {screening_id} created. "
                    f"Mode: {current_mode}. Running inference..."
                )

            # Step 3 - Run full inference pipeline with current mode
            async with AsyncSessionLocal() as db:
                await run_inference_pipeline(
                    screening_id=screening_id,
                    image_path=upload_path,
                    db=db,
                    created_by=created_by,
                    mode=current_mode,
                )

            # Step 4 - Move image to done folder
            done_path = os.path.join(done_dir, filename)
            shutil.move(image_path, done_path)
            logger.info(f"[seed] Image moved to done: {filename}")

            success_count += 1

        except Exception as e:
            logger.error(
                f"[seed] Failed for image {filename}: {str(e)}",
                exc_info=True
            )
            failed_count += 1
            continue

    logger.info(
        f"[seed] Completed. Success: {success_count} Failed: {failed_count}"
    )