# fills in a missing Gemini letter for a screening that already has its
# GPT-4o, GPT-4o-mini, and LLaMa letters - usually needed when Gemini hit a
# 429/503 during the original seeding run.
#
# doesn't re-run inference, doesn't touch patient/screening rows, doesn't
# move images. just: look up the existing screening + ensemble result,
# call Gemini with the same prompt the seeding pipeline uses, save it as a
# new ScreeningResult (llm_used="gemini"), and append it to the raw CSV.
#
# run with:
#   docker exec -it glaucoma_backend python -m scripts.retry_gemini_letter \
#       --screening-id 44e98325-2143-4537-92a9-18f7e71d5df8 \
#       --scenario 4
#
# --scenario only matters for the CSV row (which scenario to label it
# under) - it doesn't change which screening gets processed.

import os
import sys
import csv
import uuid
import argparse
import asyncio
import traceback
from pathlib import Path
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.logger import get_logger
from app.core.config import settings
from app.db.database import AsyncSessionLocal
from app.models.screening import Screening
from app.models.screening_result import ScreeningResult
from app.models.patient import Patient
from app.ml_inference.llm_referral import build_clinical_prompt, clean_referral_letter_body
from sqlalchemy import select

logger = get_logger(__name__)

OUTPUT_DIR = Path(__file__).parent / "output"
LLM_LETTERS_CSV_PATH = OUTPUT_DIR / "llm_comparison_letters_raw.csv"


def parse_args():
    parser = argparse.ArgumentParser(
        description="Retry a missing Gemini referral letter for an existing screening."
    )
    parser.add_argument(
        "--screening-id",
        type=str,
        required=True,
        help="The screening_id (UUID) of the existing screening missing its Gemini letter.",
    )
    parser.add_argument(
        "--scenario",
        type=int,
        required=True,
        choices=[1, 2, 3, 4, 5, 6, 7],
        help="Which scenario this screening belongs to (for CSV append only).",
    )
    return parser.parse_args()


async def main():
    args = parse_args()
    screening_id = uuid.UUID(args.screening_id)
    scenario = args.scenario

    try:
        print(f"[retry_gemini] Starting Gemini retry for screening_id={screening_id} scenario={scenario}")

        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(Screening).where(Screening.screening_id == screening_id)
            )
            screening = result.scalar_one_or_none()
            if not screening:
                raise RuntimeError(f"Screening {screening_id} not found in DB.")

            result = await db.execute(
                select(Patient).where(Patient.patient_id == screening.patient_id)
            )
            patient = result.scalar_one_or_none()
            if not patient:
                raise RuntimeError(f"Patient not found for screening {screening_id}.")

            # need the ensemble result for clinical context (OHTS, confidence, etc)
            result = await db.execute(
                select(ScreeningResult).where(
                    ScreeningResult.screening_id == screening_id,
                    ScreeningResult.model_used == "ensemble",
                    ScreeningResult.llm_used.is_(None),
                )
            )
            ensemble = result.scalar_one_or_none()
            if not ensemble:
                raise RuntimeError(f"Ensemble result not found for screening {screening_id}.")

            # bail if a Gemini letter already exists for this screening
            result = await db.execute(
                select(ScreeningResult).where(
                    ScreeningResult.screening_id == screening_id,
                    ScreeningResult.llm_used == "gemini",
                )
            )
            existing = result.scalar_one_or_none()
            if existing:
                print(f"[retry_gemini] Gemini letter already exists for this screening. Nothing to do.")
                return

            # normal predictions don't get a referral letter
            if ensemble.prediction != "glaucoma":
                raise RuntimeError(
                    f"Ensemble prediction is '{ensemble.prediction}' - "
                    f"no referral letter needed for non-glaucoma predictions."
                )

            patient_name = f"{patient.first_name} {patient.last_name}"
            confidence_score = float(ensemble.confidence_score)
            ohts_score = int(ensemble.ohts_score) if ensemble.ohts_score else None
            ohts_tier = ensemble.ohts_tier

            print(f"[retry_gemini] Patient: {patient_name} | Confidence: {confidence_score:.4f} | OHTS: {ohts_score} ({ohts_tier})")

            # same prompt-building logic as the seeding pipeline
            prompt = build_clinical_prompt(
                patient_name=patient_name,
                eye_side=screening.eye_side,
                confidence_score=confidence_score,
                ohts_score=ohts_score,
                ohts_tier=ohts_tier,
            )

            print(f"[retry_gemini] Calling gemini-3.5-flash...")
            import time
            from google import genai
            from google.genai import types

            client = genai.Client(api_key=settings.GEMINI_API_KEY)

            with open(screening.image_path, "rb") as f:
                image_bytes = f.read()

            start_time = time.time()
            response = client.models.generate_content(
                model="gemini-3.5-flash",
                contents=[
                    types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg"),
                    types.Part.from_text(text=prompt),
                ],
            )
            generation_time_ms = round((time.time() - start_time) * 1000, 2)

            letter_text = clean_referral_letter_body(response.text or "")
            usage = response.usage_metadata

            if not letter_text:
                raise RuntimeError("Gemini returned empty letter content.")

            print(f"[retry_gemini] Letter generated in {generation_time_ms}ms | tokens={usage.total_token_count}")

            from app.utils.settings_helper import get_setting
            clinician_name = await get_setting(db, "REFERRING_CLINICIAN_NAME", default="Dr. [Clinician Name]")
            clinician_title = await get_setting(db, "REFERRING_CLINICIAN_TITLE", default="General Ophthalmologist")
            signed_by = f"{clinician_name}\n{clinician_title}"

            from app.models.user import User
            result = await db.execute(select(User).where(User.user_code == "SYS00001"))
            system_user = result.scalar_one_or_none()
            if not system_user:
                raise RuntimeError("SYS00001 user not found.")

            new_record = ScreeningResult(
                screening_id=screening_id,
                model_used="ensemble",
                prediction=ensemble.prediction,
                confidence_score=ensemble.confidence_score,
                threshold_used=ensemble.threshold_used,
                referral_letter=letter_text,
                signed_by=signed_by,
                llm_used="gemini",
                letter_type="clinical",
                generation_time_ms=generation_time_ms,
                prompt_tokens=usage.prompt_token_count,
                completion_tokens=usage.candidates_token_count,
                total_tokens=usage.total_token_count,
                ohts_score=ensemble.ohts_score,
                ohts_tier=ensemble.ohts_tier,
                created_by=system_user.user_id,
                updated_by=system_user.user_id,
            )
            db.add(new_record)
            await db.commit()

            print(f"[retry_gemini] Letter saved to DB successfully.")

        # append the new letter to the raw CSV too
        keywords = ["ai screening", "screening system", "flagged", "confidence score", "%",
                    "suspicious", "suggestive of", "raises concern", "specialist review",
                    "further evaluation", "not a definitive diagnosis", "screening referral"]
        text_lower = letter_text.lower()
        completeness = sum(1 for kw in [
            any(k in text_lower for k in ["ai screening", "screening system", "flagged", "confidence score", "%"]),
            any(k in text_lower for k in ["suspicious", "suggestive of", "raises concern", "concerning"]),
            any(k in text_lower for k in ["specialist review", "further evaluation", "request your", "assess"]),
            any(k in text_lower for k in ["not a definitive diagnosis", "screening referral", "screening only"]),
        ] if kw)

        file_exists = LLM_LETTERS_CSV_PATH.exists()
        with open(LLM_LETTERS_CSV_PATH, "a", encoding="utf-8", newline="") as f:
            fieldnames = [
                "scenario", "screening_id", "patient_code", "llm_used", "referral_letter",
                "response_time_seconds", "prompt_tokens", "completion_tokens", "total_tokens",
                "completeness_score", "ai_prediction", "ai_confidence_score",
                "ohts_score", "ohts_tier",
            ]
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            if not file_exists:
                writer.writeheader()
            writer.writerow({
                "scenario": scenario,
                "screening_id": str(screening_id),
                "patient_code": f"{patient.first_name} {patient.last_name}",
                "llm_used": "gemini",
                "referral_letter": letter_text,
                "response_time_seconds": round(generation_time_ms / 1000, 3),
                "prompt_tokens": usage.prompt_token_count,
                "completion_tokens": usage.candidates_token_count,
                "total_tokens": usage.total_token_count,
                "completeness_score": completeness,
                "ai_prediction": ensemble.prediction,
                "ai_confidence_score": float(ensemble.confidence_score),
                "ohts_score": ohts_score,
                "ohts_tier": ohts_tier,
            })

        print(f"[retry_gemini] CSV appended. Done.")
        print(f"[retry_gemini] Letter preview: {letter_text[:200]}")

    except Exception as e:
        logger.error(f"[retry_gemini] FAILED: {e}", exc_info=True)
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())