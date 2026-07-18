# run this once Scenarios 1-4 are all seeded via seed_llm_comparison.py.
# doesn't call any LLM or touch the DB or run inference - just reads the raw
# CSV seed_llm_comparison.py already wrote and spits out two files:
#
#   1. blind_evaluation_export.csv - the one you actually score. has the
#      full letter text plus patient/clinical context, but the real LLM
#      name is swapped for a randomised label (Letter A/B/C/D) per case
#      so scoring can be done blind.
#   2. hidden_llm_mapping.csv - don't open this until scoring is done. maps
#      case_id + label back to the real LLM so scores can be matched to
#      providers afterward.
#
# labels are shuffled independently per case rather than fixed (e.g. gpt4o
# always "A") because a fixed mapping would become guessable after a few
# cases just from writing style, even without seeing the real name.
#
# run with (inside docker, after scenarios 1-4 are done):
#   docker exec -it glaucoma_backend python -m scripts.export_llm_comparison
#
# safe to re-run - always reads the raw CSV fresh and overwrites both output
# files from scratch, so if more cases get seeded later just run this again.

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

    # load everything
    with open(RAW_LETTERS_CSV, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    logger.info(f"[export] Loaded {len(rows)} raw LLM letter rows from {RAW_LETTERS_CSV}")

    # group by screening_id - each case has (up to) 4 letters, one per LLM,
    # and they need to be shuffled together as a set
    by_case = defaultdict(list)
    for row in rows:
        by_case[row["screening_id"]].append(row)

    blind_rows = []
    mapping_rows = []

    incomplete_cases = []

    for screening_id, case_rows in by_case.items():
        if len(case_rows) != 4:
            # worth flagging instead of silently skipping - probably means an
            # LLM hit a rate limit or transient error for this case and never got retried
            incomplete_cases.append((screening_id, len(case_rows)))

        # fresh shuffle per case, not reused across cases
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
                # completeness_score is included on purpose - it's just a
                # keyword check, not an opinion, so it won't bias the human
                # scorer the way seeing the LLM name would
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

    # blind export
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

    # hidden mapping
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