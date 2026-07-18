# one-time fix for Scenario 7 (false positive cases) letters missing from
# llm_comparison_letters_raw.csv.
#
# turns out seed_llm_comparison.py's CSV append step only fires when
# `ground_truth == "glaucoma"`. Scenario 7 cases are label=0 (ground truth
# normal) so that check is False and no rows got written, even though the
# model predicted glaucoma (that's the FP) and the letters were generated
# and saved to the DB just fine.
#
# this just pulls the Scenario 7 letters back out of the DB and appends
# them to the existing CSV - no inference, no LLM calls, no DB writes,
# just a read + CSV append, so it's safe to run.
#
# run with:
#   docker exec -it glaucoma_backend python -m scripts.extract_scenario7_letters

import os
import sys
import csv
import asyncio
import traceback
from pathlib import Path
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.logger import get_logger
from app.db.database import AsyncSessionLocal
from app.models.screening import Screening
from app.models.screening_result import ScreeningResult
from app.models.patient import Patient
from sqlalchemy import select

logger = get_logger(__name__)

OUTPUT_DIR = Path(__file__).parent / "output"
LLM_LETTERS_CSV_PATH = OUTPUT_DIR / "llm_comparison_letters_raw.csv"

# used to match cases in the DB since we don't have screening_ids for
# Scenario 7 stored in the CSV yet
SCENARIO7_CONFIDENCES = [
    0.9892, 0.8869, 0.8768, 0.8554, 0.6967,
    0.6859, 0.6548, 0.5448, 0.5431, 0.5412,
]


def calculate_completeness_score(letter_text: str) -> int:
    text_lower = (letter_text or "").lower()
    score = 0
    if any(kw in text_lower for kw in ["ai screening", "screening system", "flagged", "confidence score", "%"]):
        score += 1
    if any(kw in text_lower for kw in ["suspicious", "suggestive of", "raises concern", "concerning", "glaucoma-suspicious"]):
        score += 1
    if any(kw in text_lower for kw in ["specialist review", "further evaluation", "request your", "assess", "would appreciate"]):
        score += 1
    if any(kw in text_lower for kw in ["not a definitive diagnosis", "screening referral", "screening only", "does not constitute"]):
        score += 1
    return score


async def main():
    try:
        logger.info("[extract_s7] Starting Scenario 7 letter extraction from DB...")

        async with AsyncSessionLocal() as db:
            # Scenario 7 patients are tagged with last_name = 'Scenario7'
            result = await db.execute(
                select(Patient).where(Patient.last_name == "Scenario7")
            )
            patients = result.scalars().all()

            if not patients:
                logger.error("[extract_s7] No Scenario7 patients found in DB. Check last_name field.")
                return

            logger.info(f"[extract_s7] Found {len(patients)} Scenario7 patients.")

            letter_rows = []

            for patient in patients:
                # screening for this patient
                result = await db.execute(
                    select(Screening).where(Screening.patient_id == patient.patient_id)
                )
                screening = result.scalar_one_or_none()
                if not screening:
                    logger.warning(f"[extract_s7] No screening found for {patient.patient_code}")
                    continue

                # ensemble result, for OHTS + confidence
                result = await db.execute(
                    select(ScreeningResult).where(
                        ScreeningResult.screening_id == screening.screening_id,
                        ScreeningResult.model_used == "ensemble",
                        ScreeningResult.llm_used.is_(None),
                        ScreeningResult.letter_type.is_(None),
                    )
                )
                ensemble = result.scalar_one_or_none()
                if not ensemble:
                    logger.warning(f"[extract_s7] No ensemble result for {patient.patient_code}")
                    continue

                # all the LLM letters for this screening
                result = await db.execute(
                    select(ScreeningResult).where(
                        ScreeningResult.screening_id == screening.screening_id,
                        ScreeningResult.llm_used.isnot(None),
                    )
                )
                letter_records = result.scalars().all()

                if not letter_records:
                    logger.warning(f"[extract_s7] No letters found for {patient.patient_code}")
                    continue

                logger.info(f"[extract_s7] {patient.patient_code} | conf={ensemble.confidence_score} | {len(letter_records)} letters")

                for record in letter_records:
                    completeness = calculate_completeness_score(record.referral_letter or "")
                    letter_rows.append({
                        "scenario": 7,
                        "screening_id": str(screening.screening_id),
                        "patient_code": patient.patient_code,
                        "llm_used": record.llm_used,
                        "referral_letter": record.referral_letter,
                        "response_time_seconds": round(float(record.generation_time_ms) / 1000, 3) if record.generation_time_ms else None,
                        "prompt_tokens": record.prompt_tokens,
                        "completion_tokens": record.completion_tokens,
                        "total_tokens": record.total_tokens,
                        "completeness_score": completeness,
                        "ai_prediction": record.prediction,
                        "ai_confidence_score": float(record.confidence_score) if record.confidence_score else None,
                        "ohts_score": int(ensemble.ohts_score) if ensemble.ohts_score else None,
                        "ohts_tier": ensemble.ohts_tier,
                    })

        if not letter_rows:
            logger.error("[extract_s7] No letter rows extracted. Check DB data.")
            return

        logger.info(f"[extract_s7] Extracted {len(letter_rows)} letter rows from DB.")

        # append to the existing CSV
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
            for row in letter_rows:
                writer.writerow(row)

        logger.info(f"[extract_s7] Appended {len(letter_rows)} rows to {LLM_LETTERS_CSV_PATH}")

        # quick summary
        from collections import Counter
        by_llm = Counter(r['llm_used'] for r in letter_rows)
        logger.info(f"[extract_s7] Letters by LLM: {dict(by_llm)}")
        logger.info(f"[extract_s7] Done. Scenario 7 now captured in CSV.")

    except Exception as e:
        logger.error(f"[extract_s7] FAILED: {e}", exc_info=True)
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())