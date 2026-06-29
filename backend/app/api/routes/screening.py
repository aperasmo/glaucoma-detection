# backend/app/api/routes/screening.py
#
# Screening endpoints - image upload and screening management.
# Image upload triggers ML inference automatically as a background task.
# All routes are protected - valid JWT token required.

from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.dependencies import get_current_user, require_role
from app.db.database import get_db
from app.models.user import User
from app.schemas.screening import CreateScreening, ScreeningResponse
from app.core.config import settings as app_settings
from app.services.screening_service import (
    create_screening,
    get_screening_by_id,
    get_screenings_by_patient,
)

from app.db.database import AsyncSessionLocal
from app.ml_inference.inference import run_inference_pipeline
from app.core.logger import get_logger

from app.models.screening_result import ScreeningResult
from app.models.patient import Patient
from app.utils.settings_helper import get_setting
from app.models.screening import Screening
import time
from app.ml_inference.llm_referral import generate_referral_letters

from typing import Optional
import uuid
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
             created_by=current_user.user_id,
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
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.services.screening_service import get_analytics
    return await get_analytics(db, days, start_date, end_date)

@router.post("/{screening_id}/disagreement-letter", status_code=status.HTTP_200_OK)
async def generate_disagreement_letter(
    screening_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Generate a second opinion referral letter for a Clinical Mode screening
    # where model disagreement was detected (ensemble said normal but at least
    # one individual model crossed its own sensitivity threshold).
    #
    # Only available when:
    #   - Screening exists and belongs to a real patient
    #   - Ensemble predicted normal (disagreement only makes sense then)
    #   - has_model_disagreement = True on the ensemble result record
    #
    # Letter is saved with letter_type="disagreement" so it can be
    # distinguished from the regular clinical GPT-4o letter on redisplay.
    # Uses DEFAULT_CLINICAL_LLM setting - same LLM as regular clinical letter.
    # Only one disagreement letter per screening - returns existing one if
    # already generated rather than creating duplicates.

    try:
        print(f"[disagreement-letter] Request | screening_id={screening_id} | user={current_user.user_code}")

        # Fetch screening
        result = await db.execute(
            select(Screening).where(Screening.screening_id == screening_id)
        )
        screening = result.scalar_one_or_none()
        if not screening:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Screening not found.",
            )

        # Fetch patient
        result = await db.execute(
            select(Patient).where(Patient.patient_id == screening.patient_id)
        )
        patient = result.scalar_one_or_none()
        if not patient:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Patient not found.",
            )

        # Fetch ensemble result - confirm disagreement flag is set
        result = await db.execute(
            select(ScreeningResult).where(
                ScreeningResult.screening_id == screening_id,
                ScreeningResult.model_used == "ensemble",
                ScreeningResult.llm_used.is_(None),
            )
        )
        ensemble_record = result.scalar_one_or_none()
        if not ensemble_record:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Ensemble result not found for this screening.",
            )

        if not ensemble_record.has_model_disagreement:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No model disagreement detected for this screening. Disagreement letter not applicable.",
            )

        # Check if disagreement letter already exists - return it instead of
        # regenerating to avoid duplicate LLM calls and duplicate DB records.
        result = await db.execute(
            select(ScreeningResult).where(
                ScreeningResult.screening_id == screening_id,
                ScreeningResult.letter_type == "disagreement",
            )
        )
        existing_letter = result.scalar_one_or_none()
        if existing_letter:
            logger.info(f"[disagreement-letter] Returning existing letter | screening_id={screening_id}")
            return {
                "letter_type": "disagreement",
                "referral_letter": existing_letter.referral_letter,
                "llm_used": existing_letter.llm_used,
                "generation_time_ms": existing_letter.generation_time_ms,
                "already_existed": True,
            }

        # Get clinician details from settings
        clinician_name = await get_setting(
            db, "REFERRING_CLINICIAN_NAME", default="Dr. [Clinician Name]"
        )
        clinician_title = await get_setting(
            db, "REFERRING_CLINICIAN_TITLE", default="General Ophthalmologist"
        )

        # Get default LLM from settings
        default_llm = await get_setting(
            db, "DEFAULT_CLINICAL_LLM", default="gpt4o"
        )

        # Get OHTS data from ensemble record
        ohts_score = int(ensemble_record.ohts_score) if ensemble_record.ohts_score else None
        ohts_tier = ensemble_record.ohts_tier

        patient_name = f"{patient.first_name} {patient.last_name}"

        # Build disagreement-aware prompt - different from the standard clinical
        # prompt because this case has a normal ensemble result with dissenting
        # individual model(s). The letter should reflect the uncertainty rather
        # than a straightforward glaucoma-suspicious referral
        disagreement_prompt_override = f"""
        You are a clinical assistant helping a general ophthalmologist prepare a referral letter
        for a patient whose AI glaucoma screening produced a discordant, non-diagnostic result.

        Patient: {patient_name}
        Eye screened: {screening.eye_side.capitalize()} eye

        Primary screening result:
        - Model: {ensemble_record.model_used}
        - No glaucoma signs detected
        - Confidence: {float(ensemble_record.confidence_score):.1%}

        Disagreement finding:
        - Model: {ensemble_record.disagreement_model}
        - Detected possible glaucoma signs
        - Confidence: {float(ensemble_record.disagreement_confidence):.1%}

        Important interpretation:
        - The primary screening result is NOT glaucoma-suspicious.
        - This is NOT a confirmed positive glaucoma screening result.
        - The referral is being made only because the primary screening result and another model disagree.
        - Do not describe the patient as having glaucoma, confirmed glaucomatous findings, or a positive overall AI result.

        {
            "OHTS 5-year risk score: "
            + str(ohts_score)
            + " ("
            + ohts_tier.upper()
            + " tier)."
            if ohts_score is not None and ohts_tier
            else "OHTS risk score is unavailable."
        }

        Write a concise, professional referral letter of no more than 150 words from a general
        ophthalmologist to a glaucoma specialist. The letter must:

        1. State that the primary screening model found no glaucoma signs.
        2. State that one other model detected possible glaucoma signs.
        3. Mention the names and confidence scores of both models.
        4. State that this represents model disagreement and screening uncertainty.
        5. Include the OHTS score and tier if available, or state that it is unavailable.
        6. Request specialist review to clarify the discordant screening result.
        7. Explicitly state that this referral is based on AI screening uncertainty and does not
        constitute a definitive diagnosis.
        8. Avoid inventing symptoms, examination findings, treatment recommendations, or
        confirmed disease.

        Write only the body of the letter starting with "Dear Colleague,".
        Do not include a closing phrase, signature, clinician name, title, contact information,
        or placeholders such as [Your Name].
        """

        # Generate the letter using a direct LLM call with the custom
        # disagreement-aware prompt - NOT generate_referral_letters() which
        # uses the standard clinical prompt. The disagreement context
        # (which model disagreed, at what confidence) must be explicitly
        # included in the prompt so the letter reflects the uncertainty.
        

        start_time = time.time()
        letter_text = None
        prompt_tokens = None
        completion_tokens = None
        total_tokens = None

        try:
            if default_llm in ("gpt4o", "gpt4o_mini"):
                from openai import OpenAI
                client = OpenAI(api_key=app_settings.OPENAI_API_KEY)
                model_name = "gpt-4o" if default_llm == "gpt4o" else "gpt-4o-mini"
                response = client.chat.completions.create(
                    model=model_name,
                    messages=[{"role": "user", "content": disagreement_prompt_override}],
                    max_tokens=300,
                )
                letter_text = response.choices[0].message.content
                prompt_tokens = response.usage.prompt_tokens
                completion_tokens = response.usage.completion_tokens
                total_tokens = response.usage.total_tokens

            elif default_llm == "llama":
                from groq import Groq
                client = Groq(api_key=app_settings.GROQ_API_KEY)
                response = client.chat.completions.create(
                    model="openai/gpt-oss-120b",
                    messages=[{"role": "user", "content": disagreement_prompt_override}],
                    max_tokens=700,
                    reasoning_effort="low",
                )
                letter_text = response.choices[0].message.content
                prompt_tokens = response.usage.prompt_tokens
                completion_tokens = response.usage.completion_tokens
                total_tokens = response.usage.total_tokens

            elif default_llm == "gemini":
                from google import genai
                from google.genai import types
                client = genai.Client(api_key=app_settings.GEMINI_API_KEY)
                response = client.models.generate_content(
                    model="gemini-3.5-flash",
                    contents=[types.Part.from_text(text=disagreement_prompt_override)],
                )
                letter_text = response.text
                usage = response.usage_metadata
                prompt_tokens = usage.prompt_token_count
                completion_tokens = usage.candidates_token_count
                total_tokens = usage.total_token_count

            else:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Unsupported LLM: {default_llm}",
                )

        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"[disagreement-letter] LLM call failed: {e}", exc_info=True)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to generate disagreement letter. LLM call returned no result.",
            )

        generation_time_ms = round((time.time() - start_time) * 1000, 2)

        # Clean the letter body - strip any LLM-generated closing/signature
        from app.ml_inference.llm_referral import clean_referral_letter_body
        letter_text = clean_referral_letter_body(letter_text or "")
        letter_data = {
            "letter": letter_text,
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": total_tokens,
        }

        if not letter_text:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="LLM returned empty letter content.",
            )
        signed_by = f"{clinician_name}\n{clinician_title}"

        # Save the disagreement letter as a new screening_result record
        # letter_type="disagreement" distinguishes it from the regular clinical
        # letter on redisplay - frontend checks this field
        new_record = ScreeningResult(
            screening_id=screening_id,
            model_used="ensemble",
            prediction=ensemble_record.prediction,
            confidence_score=ensemble_record.confidence_score,
            threshold_used=ensemble_record.threshold_used,
            referral_letter=letter_data["letter"],
            signed_by=signed_by,
            llm_used=default_llm,
            letter_type="disagreement",
            generation_time_ms=generation_time_ms,
            prompt_tokens=letter_data.get("prompt_tokens"),
            completion_tokens=letter_data.get("completion_tokens"),
            total_tokens=letter_data.get("total_tokens"),
            ohts_score=ensemble_record.ohts_score,
            ohts_tier=ensemble_record.ohts_tier,
            has_model_disagreement=True,
            disagreement_model=ensemble_record.disagreement_model,
            disagreement_confidence=ensemble_record.disagreement_confidence,
            created_by=current_user.user_id,
            updated_by=current_user.user_id,
        )
        db.add(new_record)
        await db.commit()

        logger.info(
            f"[disagreement-letter] Generated and saved | "
            f"screening_id={screening_id} | llm={default_llm} | "
            f"time={generation_time_ms}ms"
        )

        return {
            "letter_type": "disagreement",
            "referral_letter": letter_data["letter"],
            "llm_used": default_llm,
            "generation_time_ms": generation_time_ms,
            "already_existed": False,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[disagreement-letter] Failed: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to generate disagreement letter.",
        )


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


async def run_ml_inference(screening_id: UUID, image_path: str, created_by: Optional[UUID] = None,):
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
                created_by=created_by,
            )
    except Exception as e:
        logger.error(f"ML inference pipeline failed for screening {screening_id}: {e}", exc_info=True)