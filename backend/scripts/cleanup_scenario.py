# backend/scripts/cleanup_scenario.py
#
# PURPOSE - one-off utility, NOT part of the normal seed/export workflow
# ---------------------------------------------------------------------------
# Use this when you need to completely undo one scenario's seeding run and
# start that scenario fresh - e.g. after switching the LLaMa model from
# llama-4-scout (garbled output) to gpt-oss-120b, and wanting Scenario 3's
# 6 cases re-generated with the new model instead of mixing old broken
# letters with new clean ones.
#
# This script removes ONLY the specified scenario's data from 3 places,
# leaving every other scenario's data completely untouched:
#
#   1. DATABASE - deletes all screening_results, screenings, and patients
#      that were created for this scenario's cases. Identified by matching
#      screening_id values found in the summary CSV for this scenario -
#      NOT by any heuristic guessing, so it only touches exactly the rows
#      this scenario actually created.
#
#   2. IMAGES - moves files back from
#      test_images/glaucoma/scenario{N}_done/ (or normal/ equivalent)
#      into the bare test_images/glaucoma/ or test_images/normal/ folder,
#      so seed_llm_comparison.py will find and re-process them on the next
#      run for that scenario.
#
#   3. CSVs - rewrites both llm_comparison_seed_summary.csv and
#      llm_comparison_letters_raw.csv, keeping every row NOT belonging to
#      this scenario, dropping every row that does. Other scenarios'
#      already-captured data (e.g. Scenarios 5 and 6) is preserved exactly
#      as-is.
#
# THIS DOES NOT TOUCH ANY OTHER SCENARIO'S DATA. Confirmed by filtering
# strictly on scenario number throughout, never by image filename pattern
# or date range (which could accidentally catch the wrong rows).
#
# -----------------------------------------------------------------------
# HOW TO RUN
# -----------------------------------------------------------------------
#   docker exec -it glaucoma_backend python -m scripts.cleanup_scenario --scenario 3
#
# Prompts for confirmation before deleting anything from the database -
# this is a destructive operation, type-to-confirm is required.
# ---------------------------------------------------------------------------

import os
import sys
import csv
import shutil
import argparse
import asyncio
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.logger import get_logger
from app.core.config import settings
from app.db.database import AsyncSessionLocal

logger = get_logger(__name__)

TEST_IMAGES_ROOT = Path(settings.TEST_IMAGES_DIR)
GLAUCOMA_SUBDIR = TEST_IMAGES_ROOT / "glaucoma"
NORMAL_SUBDIR = TEST_IMAGES_ROOT / "normal"

OUTPUT_DIR = Path(__file__).parent / "output"
SUMMARY_CSV_PATH = OUTPUT_DIR / "llm_comparison_seed_summary.csv"
LETTERS_CSV_PATH = OUTPUT_DIR / "llm_comparison_letters_raw.csv"


def parse_args():
    parser = argparse.ArgumentParser(
        description="Delete one scenario's seeded data (DB rows, moved images, CSV rows) to allow a clean re-run."
    )
    parser.add_argument("--scenario", type=int, required=True, choices=[1, 2, 3, 4, 5, 6])
    return parser.parse_args()


def get_scenario_screening_ids_and_filenames(scenario: int) -> list[dict]:
    # Reads the summary CSV and returns the screening_id + filename for
    # every row belonging to this scenario - this is the authoritative
    # list of exactly what this scenario actually created.
    if not SUMMARY_CSV_PATH.exists():
        logger.warning(f"[cleanup] {SUMMARY_CSV_PATH} not found - nothing to clean up from CSV side.")
        return []

    with open(SUMMARY_CSV_PATH, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        rows = [r for r in reader if int(r["scenario"]) == scenario]

    return rows


async def delete_database_rows(screening_ids: list[str]) -> None:
    from sqlalchemy import select
    from app.models.screening import Screening
    from app.models.screening_result import ScreeningResult
    from app.models.patient import Patient

    async with AsyncSessionLocal() as db:
        # Step 1 - find the patient_ids linked to these screenings, before
        # deleting the screenings themselves (need this to delete the
        # patients afterward).
        result = await db.execute(
            select(Screening.patient_id).where(Screening.screening_id.in_(screening_ids))
        )
        patient_ids = [row[0] for row in result.all()]

        # Step 2 - delete screening_results first (foreign key dependency
        # on screening_id).
        result = await db.execute(
            select(ScreeningResult).where(ScreeningResult.screening_id.in_(screening_ids))
        )
        results_to_delete = result.scalars().all()
        for r in results_to_delete:
            await db.delete(r)
        logger.info(f"[cleanup] Deleted {len(results_to_delete)} screening_results rows.")

        # Step 3 - delete screenings.
        result = await db.execute(
            select(Screening).where(Screening.screening_id.in_(screening_ids))
        )
        screenings_to_delete = result.scalars().all()
        for s in screenings_to_delete:
            await db.delete(s)
        logger.info(f"[cleanup] Deleted {len(screenings_to_delete)} screenings rows.")

        # Step 4 - delete patients.
        result = await db.execute(
            select(Patient).where(Patient.patient_id.in_(patient_ids))
        )
        patients_to_delete = result.scalars().all()
        for p in patients_to_delete:
            await db.delete(p)
        logger.info(f"[cleanup] Deleted {len(patients_to_delete)} patients rows.")

        await db.commit()


def move_images_back(scenario: int, rows: list[dict]) -> None:
    # Moves each scenario's images from their scenario{N}_done/ subfolder
    # back to the bare glaucoma/ or normal/ folder. Tries both possible
    # source folders since we don't store label/ground_truth directly in
    # this lookup - whichever one actually has the file wins.
    moved = 0
    for row in rows:
        filename = row["filename"]
        for subdir in [GLAUCOMA_SUBDIR, NORMAL_SUBDIR]:
            done_path = subdir / f"scenario{scenario}_done" / filename
            if done_path.exists():
                target = subdir / filename
                shutil.move(str(done_path), str(target))
                logger.info(f"[cleanup] Moved back: {done_path} -> {target}")
                moved += 1
                break
    logger.info(f"[cleanup] Moved {moved}/{len(rows)} images back to bare folders.")


def rewrite_csv_excluding_scenario(csv_path: Path, scenario: int) -> None:
    if not csv_path.exists():
        logger.warning(f"[cleanup] {csv_path} not found - skipping.")
        return

    with open(csv_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames
        kept_rows = [r for r in reader if int(r["scenario"]) != scenario]

    removed_count = 0
    with open(csv_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        removed_count = sum(1 for r in reader if int(r["scenario"]) == scenario)

    with open(csv_path, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for row in kept_rows:
            writer.writerow(row)

    logger.info(f"[cleanup] {csv_path.name}: removed {removed_count} rows for scenario {scenario}, kept {len(kept_rows)} rows from other scenarios.")


async def main():
    args = parse_args()
    scenario = args.scenario

    rows = get_scenario_screening_ids_and_filenames(scenario)

    if not rows:
        logger.info(f"[cleanup] No rows found for scenario {scenario} in the summary CSV - nothing to clean up.")
        return

    screening_ids = [r["screening_id"] for r in rows]

    print(f"\nThis will PERMANENTLY DELETE:")
    print(f"  - {len(rows)} patients/screenings and their screening_results from scenario {scenario}")
    print(f"  - Move {len(rows)} image(s) back from scenario{scenario}_done/ to the bare folder")
    print(f"  - Remove {len(rows)} row(s) from both CSV files")
    print(f"\nScreening IDs affected: {screening_ids}\n")

    confirm = input(f"Type 'DELETE SCENARIO {scenario}' to confirm: ")
    if confirm != f"DELETE SCENARIO {scenario}":
        logger.info("[cleanup] Confirmation text did not match - aborted, nothing was changed.")
        return

    await delete_database_rows(screening_ids)
    move_images_back(scenario, rows)
    rewrite_csv_excluding_scenario(SUMMARY_CSV_PATH, scenario)
    rewrite_csv_excluding_scenario(LETTERS_CSV_PATH, scenario)

    logger.info(f"[cleanup] Scenario {scenario} fully cleaned up. Ready for a fresh re-run.")


if __name__ == "__main__":
    asyncio.run(main())