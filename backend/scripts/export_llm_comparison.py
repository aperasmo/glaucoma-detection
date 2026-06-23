# backend/scripts/export_llm_comparison.py
#
# PURPOSE (Paper 2 - LLM comparison research)
# ---------------------------------------------------------------------------
# Run this ONCE, after all of Scenarios 1-4 have been seeded via
# seed_llm_comparison.py (i.e. after running --scenario 1, 2, 3, and 4,
# each in its own session). This script does NOT call any LLM, does NOT
# touch the database, and does NOT run inference - it only reads the raw
# CSV that seed_llm_comparison.py already wrote, and produces two files:
#
#   1. BLIND EVALUATION EXPORT (for you to actually score)
#      backend/scripts/output/blind_evaluation_export.csv
#      Contains all captured letters, full text, patient/clinical context
#      (name, AI prediction, confidence, OHTS score) for reference - but
#      the LLM's real identity is stripped and replaced with a randomised
#      label (Letter A / B / C / D) PER CASE, so you can score blind
#      without knowing which provider generated which letter.
#
#   2. HIDDEN MAPPING FILE (do NOT look at this until scoring is done)
#      backend/scripts/output/hidden_llm_mapping.csv
#      Maps each case_id + label back to the real LLM name, so scores can
#      be matched back to providers after blind scoring is complete.
#
# WHY RANDOMISED PER CASE, NOT FIXED (e.g. gpt4o is always "Letter A"):
# If gpt4o were always labelled "A" across all 35 cases, a pattern would
# become recognisable after a few cases even without seeing the real name
# (e.g. "Letter A is always concise and uses similar phrasing") - defeating
# the purpose of blinding. Each case gets its own independent random
# shuffle of which LLM maps to which letter.
#
# -----------------------------------------------------------------------
# HOW TO RUN (inside the Docker container, after Scenarios 1-4 are done)
# -----------------------------------------------------------------------
#   docker exec -it glaucoma_backend python -m scripts.export_llm_comparison
#
# Safe to re-run - it always reads the full raw CSV fresh and regenerates
# both output files from scratch (overwrites, does not append), so if you
# add more cases later (e.g. decide to scale up the study), just re-run
# this after seeding the new cases and both export files will reflect
# everything captured so far.
# ---------------------------------------------------------------------------

import csv
import random
import sys
import os
from pathlib import Path
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.logger import get_logger

logger = get_logger(__name__)

OUTPUT_DIR = Path(__file__).parent / "output"
RAW_LETTERS_CSV = OUTPUT_DIR / "llm_comparison_letters_raw.csv"
BLIND_EXPORT_CSV = OUTPUT_DIR / "blind_evaluation_export.csv"
MAPPING_CSV = OUTPUT_DIR / "hidden_llm_mapping.csv"

LABELS = ["Letter A", "Letter B", "Letter C", "Letter D"]


def main():
    if not RAW_LETTERS_CSV.exists():
        raise FileNotFoundError(
            f"{RAW_LETTERS_CSV} not found. Run seed_llm_comparison.py for "
            f"scenarios 1-4 first - this script only reads what's already "
            f"been captured, it does not generate new data."
        )

    # Load all raw letter rows
    with open(RAW_LETTERS_CSV, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    logger.info(f"[export] Loaded {len(rows)} raw LLM letter rows from {RAW_LETTERS_CSV}")

    # Group rows by screening_id, since each case should have exactly 4
    # letters (one per LLM) that need to be shuffled together as a set.
    by_case = defaultdict(list)
    for row in rows:
        by_case[row["screening_id"]].append(row)

    blind_rows = []
    mapping_rows = []

    incomplete_cases = []

    for screening_id, case_rows in by_case.items():
        if len(case_rows) != 4:
            # Flag rather than silently skip - a case with fewer than 4
            # letters likely means one LLM failed for that case (e.g. a
            # rate limit or transient API error) and was never retried.
            incomplete_cases.append((screening_id, len(case_rows)))

        # Shuffle a fresh random label assignment for THIS case only
        labels_for_case = LABELS.copy()
        random.shuffle(labels_for_case)

        for row, label in zip(case_rows, labels_for_case):
            blind_rows.append({
                "case_id": screening_id,
                "patient_code": row["patient_code"],
                "scenario": row["scenario"],
                "label": label,
                "ai_prediction": row["ai_prediction"],
                "ai_confidence_score": row["ai_confidence_score"],
                "ohts_score": row["ohts_score"],
                "ohts_tier": row["ohts_tier"],
                "referral_letter": row["referral_letter"],
                # completeness_score is intentionally included in the blind
                # export - it's a deterministic, objective keyword-based
                # check (not an opinion), so seeing it doesn't bias a human
                # evaluator's own scoring the way seeing the LLM name would.
                "auto_completeness_score": row["completeness_score"],
            })

            mapping_rows.append({
                "case_id": screening_id,
                "label": label,
                "actual_llm": row["llm_used"],
                "response_time_seconds": row["response_time_seconds"],
                "prompt_tokens": row["prompt_tokens"],
                "completion_tokens": row["completion_tokens"],
                "total_tokens": row["total_tokens"],
            })

    # Write blind export
    with open(BLIND_EXPORT_CSV, "w", encoding="utf-8", newline="") as f:
        fieldnames = [
            "case_id", "patient_code", "scenario", "label",
            "ai_prediction", "ai_confidence_score", "ohts_score", "ohts_tier",
            "referral_letter", "auto_completeness_score",
        ]
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for row in blind_rows:
            writer.writerow(row)

    # Write hidden mapping
    with open(MAPPING_CSV, "w", encoding="utf-8", newline="") as f:
        fieldnames = [
            "case_id", "label", "actual_llm",
            "response_time_seconds", "prompt_tokens", "completion_tokens", "total_tokens",
        ]
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for row in mapping_rows:
            writer.writerow(row)

    logger.info("=" * 70)
    logger.info(f"[export] DONE")
    logger.info(f"[export] Cases found: {len(by_case)}")
    logger.info(f"[export] Letters exported: {len(blind_rows)}")
    logger.info(f"[export] Blind evaluation export: {BLIND_EXPORT_CSV}")
    logger.info(f"[export] Hidden mapping (do not view until scoring is done): {MAPPING_CSV}")
    logger.info("=" * 70)

    if incomplete_cases:
        logger.warning(
            f"[export] {len(incomplete_cases)} case(s) did NOT have all 4 letters "
            f"- likely an LLM failed for that case and was never retried:"
        )
        for screening_id, count in incomplete_cases:
            logger.warning(f"  screening_id={screening_id} only has {count}/4 letters")
        logger.warning(
            "[export] These incomplete cases were still exported with whatever "
            "letters they do have. Consider re-running the relevant --scenario "
            "to retry the missing LLM for these specific cases."
        )


if __name__ == "__main__":
    main()