# backend/scripts/check_llm_comparison_status.py
#
# PURPOSE (Paper 2 - LLM comparison research)
# ---------------------------------------------------------------------------
# Read-only status check. Queries the database directly (not the CSV files,
# which can drift out of sync with the database after multiple cleanup/
# retry cycles - confirmed happening more than once during this study) to
# show exactly what's been seeded so far across all 6 scenarios:
#
#   - How many cases exist for each scenario
#   - Which cases have a complete 4/4 LLM letter set
#   - Which cases are missing one or more specific LLMs
#   - A clear "what to do next" summary at the end
#
# This does NOT modify anything - safe to run anytime, as often as you
# want, including mid-run to check progress.
#
# Cases are identified as belonging to a scenario by cross-referencing the
# patient's OHTS profile (iop/cct/ohts target) and confidence_score against
# the SELECTED_CASES list defined in seed_llm_comparison.py - NOT by
# reading the summary CSV, since that file has been shown to drift from
# the database after cleanup operations. The database itself is the only
# source of truth this script trusts.
#
# Specifically, matching works by confidence_score (rounded) since that
# value is a real, distinctive identifier carried from the original
# discovery CSV into each case - two different real images essentially
# never share the exact same confidence_score to 4 decimal places.
#
# -----------------------------------------------------------------------
# HOW TO RUN
# -----------------------------------------------------------------------
#   docker exec -it glaucoma_backend python -m scripts.check_llm_comparison_status
# ---------------------------------------------------------------------------

import os
import sys
import asyncio
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.logger import get_logger
from app.db.database import AsyncSessionLocal
from sqlalchemy import select

from app.models.screening import Screening
from app.models.screening_result import ScreeningResult
from app.models.patient import Patient

# Import the same SELECTED_CASES list used by the seeding script, so this
# status check always reflects whatever the 60-case plan currently is -
# never hardcoded separately, never able to drift out of sync with the
# actual seeding logic.
from scripts.seed_llm_comparison import SELECTED_CASES

logger = get_logger(__name__)

ALL_LLMS = {"gpt4o", "gpt4o_mini", "llama", "gemini"}


async def main():
    # Build a lookup: confidence_score (rounded to 4dp) -> case info
    case_by_confidence = {
        round(c["confidence_score"], 4): c for c in SELECTED_CASES
    }

    async with AsyncSessionLocal() as db:
        # Fetch every research-mode screening with its ensemble confidence
        # score and whatever screening_results rows it has (model_used +
        # llm_used), in one query.
        result = await db.execute(
            select(
                Screening.screening_id,
                Patient.patient_code,
                ScreeningResult.confidence_score,
                ScreeningResult.model_used,
                ScreeningResult.llm_used,
            )
            .join(Patient, Patient.patient_id == Screening.patient_id)
            .outerjoin(ScreeningResult, ScreeningResult.screening_id == Screening.screening_id)
            .where(Screening.inference_mode == "research")
        )
        rows = result.all()

    # Group by screening_id
    by_screening = defaultdict(lambda: {"patient_code": None, "confidence": None, "llms": set()})
    for screening_id, patient_code, confidence_score, model_used, llm_used in rows:
        entry = by_screening[screening_id]
        entry["patient_code"] = patient_code
        if model_used == "ensemble" and llm_used is None and confidence_score is not None:
            entry["confidence"] = round(float(confidence_score), 4)
        if llm_used is not None:
            entry["llms"].add(llm_used)

    # Match each screening to a scenario via confidence_score
    scenario_status = defaultdict(list)
    unmatched = []

    for screening_id, entry in by_screening.items():
        conf = entry["confidence"]
        if conf is None:
            continue  # screening exists but has no ensemble result yet - skip
        matched_case = case_by_confidence.get(conf)
        if not matched_case:
            unmatched.append((screening_id, entry["patient_code"], conf))
            continue

        scenario_status[matched_case["scenario"]].append({
            "screening_id": screening_id,
            "patient_code": entry["patient_code"],
            "filename": matched_case["filename"],
            "confidence": conf,
            "needs_llms": matched_case["scenario"] in {1, 2, 3, 4},  # scenarios 5,6 never need letters
            "has_llms": entry["llms"],
        })

    # Expected counts per scenario, from the locked study design
    expected_counts = {1: 7, 2: 10, 3: 6, 4: 12, 5: 12, 6: 13}

    print("=" * 70)
    print("LLM COMPARISON STUDY - STATUS CHECK (live from database)")
    print("=" * 70)

    total_cases_done = 0
    total_letters_done = 0
    total_letters_expected = 0

    for scenario in range(1, 7):
        cases = scenario_status.get(scenario, [])
        expected = expected_counts[scenario]
        needs_llms = scenario in {1, 2, 3, 4}

        print(f"\nScenario {scenario}: {len(cases)}/{expected} cases seeded")

        if not needs_llms:
            # Scenarios 5 and 6 - just confirm case count, no letters expected
            total_cases_done += len(cases)
            if len(cases) == expected:
                print("  Status: COMPLETE (no LLM letters needed - normal prediction)")
            else:
                print(f"  Status: {expected - len(cases)} case(s) still to seed")
            continue

        complete = [c for c in cases if c["has_llms"] == ALL_LLMS]
        incomplete = [c for c in cases if c["has_llms"] and c["has_llms"] != ALL_LLMS]
        no_letters = [c for c in cases if not c["has_llms"]]

        total_cases_done += len(cases)
        total_letters_done += sum(len(c["has_llms"]) for c in cases)
        total_letters_expected += expected * 4

        print(f"  Complete (4/4 LLMs): {len(complete)}")
        if incomplete:
            print(f"  INCOMPLETE - missing some LLM(s):")
            for c in incomplete:
                missing = ALL_LLMS - c["has_llms"]
                print(f"    {c['patient_code']} ({c['filename']}) - missing: {sorted(missing)} | screening_id={c['screening_id']}")
        if no_letters:
            print(f"  NO LETTERS YET (ML inference done, LLM step not run):")
            for c in no_letters:
                print(f"    {c['patient_code']} ({c['filename']}) | screening_id={c['screening_id']}")
        if len(cases) < expected:
            print(f"  NOT YET SEEDED: {expected - len(cases)} case(s) still need their patient/screening created")

    if unmatched:
        print(f"\n--- {len(unmatched)} screening(s) in the database could not be matched to any of the 60 study cases ---")
        print("(These may be from earlier testing/seeding unrelated to this study, or a confidence_score mismatch)")
        for sid, code, conf in unmatched[:10]:
            print(f"  {code} | confidence={conf} | screening_id={sid}")

    print("\n" + "=" * 70)
    print(f"OVERALL: {total_cases_done}/60 total cases seeded")
    print(f"OVERALL: {total_letters_done}/{total_letters_expected} LLM letters captured (scenarios 1-4 only)")
    print("=" * 70)


if __name__ == "__main__":
    asyncio.run(main())