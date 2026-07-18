# quick read-only status check for the LLM comparison study (paper 2).
# queries the DB directly instead of the CSVs, since the CSVs have drifted
# out of sync with the DB more than once after cleanup/retry cycles.
#
# for each of the 6 scenarios this prints: how many cases are seeded, which
# ones have all 4 LLM letters, which are missing some, and a "what's left"
# summary at the end. doesn't touch anything, so it's fine to run repeatedly
# mid-run just to check progress.
#
# cases get matched to a scenario by confidence_score against SELECTED_CASES
# (from seed_llm_comparison.py), not by reading the summary CSV - the DB is
# the only thing this script trusts. confidence_score works well as a match
# key because it's basically unique per image out to 4 decimal places, so
# two different cases won't collide.
#
# run with:
#   docker exec -it glaucoma_backend python -m scripts.check_llm_comparison_status

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

# reuse the seeding script's own list so we never hardcode the case plan
# separately and risk it drifting out of sync
from scripts.seed_llm_comparison import SELECTED_CASES

logger = get_logger(__name__)

ALL_LLMS = {"gpt4o", "gpt4o_mini", "llama", "gemini"}


async def main():
    # confidence_score (rounded to 4dp) -> case info
    case_by_confidence = {
        round(c["confidence_score"], 4): c for c in SELECTED_CASES
    }

    async with AsyncSessionLocal() as db:
        # grab every research-mode screening plus its ensemble confidence and
        # whatever screening_results rows exist (model_used + llm_used) in one go
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

    # group by screening_id
    by_screening = defaultdict(lambda: {"patient_code": None, "confidence": None, "llms": set()})
    for screening_id, patient_code, confidence_score, model_used, llm_used in rows:
        entry = by_screening[screening_id]
        entry["patient_code"] = patient_code
        if model_used == "ensemble" and llm_used is None and confidence_score is not None:
            entry["confidence"] = round(float(confidence_score), 4)
        if llm_used is not None:
            entry["llms"].add(llm_used)

    # match each screening back to a scenario via confidence_score
    scenario_status = defaultdict(list)
    unmatched = []

    for screening_id, entry in by_screening.items():
        conf = entry["confidence"]
        if conf is None:
            continue  # screening exists but no ensemble result yet
        matched_case = case_by_confidence.get(conf)
        if not matched_case:
            unmatched.append((screening_id, entry["patient_code"], conf))
            continue

        scenario_status[matched_case["scenario"]].append({
            "screening_id": screening_id,
            "patient_code": entry["patient_code"],
            "filename": matched_case["filename"],
            "confidence": conf,
            "needs_llms": matched_case["scenario"] in {1, 2, 3, 4, 7},  # scenarios 5,6 skip letters; 7 needs them (FP cases)
            "has_llms": entry["llms"],
        })

    # expected counts per scenario per the locked study design
    expected_counts = {1: 7, 2: 10, 3: 6, 4: 12, 5: 12, 6: 13, 7: 10}

    print("=" * 70)
    print("LLM COMPARISON STUDY - STATUS CHECK (live from database)")
    print("=" * 70)

    total_cases_done = 0
    total_letters_done = 0
    total_letters_expected = 0

    for scenario in range(1, 8):
        cases = scenario_status.get(scenario, [])
        expected = expected_counts[scenario]
        needs_llms = scenario in {1, 2, 3, 4, 7}

        print(f"\nScenario {scenario}: {len(cases)}/{expected} cases seeded")

        if not needs_llms:
            # scenarios 5 and 6 - just confirm case count, no letters expected here
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