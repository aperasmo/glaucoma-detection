# backend/scripts/discover_test_set_confidence.py
#
# PURPOSE (Paper 2 - LLM comparison research)
# ---------------------------------------------------------------------------
# This is a DISCOVERY script, not a seeding script. It runs every image in
# the locked 415-image test set through the ensemble inference pipeline
# ONLY (no Grad-CAM++, no CDR, no referral letters, no LLM calls) and
# records the resulting prediction + confidence_score against the known
# ground truth label.
#
# WHY: We cannot force a model to output "85-95% confidence" on demand -
# that depends on the actual image content. So instead we run the real,
# unmodified pipeline once across the whole test set, then use the output
# CSV to manually pick 5 real images per target scenario bucket (see
# seed_llm_comparison.py, the follow-up script that uses this CSV's output).
#
# IMPORTANT - THIS SCRIPT DOES NOT WRITE TO THE DATABASE.
# No Patient, Screening, or ScreeningResult rows are created. Everything
# runs in memory and the only output is a CSV file. This keeps the research
# discovery pass completely separate from real clinical data.
#
# IMPORTANT - THIS SCRIPT DOES NOT CALL ANY LLM.
# No OpenAI / Groq / Gemini API calls happen here, so there is zero token
# cost for this pass. LLM calls only happen later in seed_llm_comparison.py
# for the 30 hand-picked cases.
#
# -----------------------------------------------------------------------
# WHERE THINGS LIVE (edit these if your folder layout ever changes)
# -----------------------------------------------------------------------
# Source images + ground truth labels:
#   backend/test_images/test.csv          <- label file, columns below
#   backend/test_images/glaucoma/*.jpg    <- glaucoma-positive images
#   backend/test_images/normal/*.jpg      <- normal images
#
#   test.csv columns (tab or comma separated, header row required):
#     image_path  -> full path as recorded during training prep.
#                    We DO NOT use this path directly because it may be a
#                    Windows host path that does not exist inside the
#                    Docker container. We only use the FILENAME portion
#                    (e.g. "n0092.jpg") combined with the label to locate
#                    the file under test_images/glaucoma/ or
#                    test_images/normal/ at runtime.
#     label       -> 0 = normal, 1 = glaucoma (ground truth)
#     dataset     -> source dataset name (REFUGE, ACRIMA, etc.) - carried
#                    through to the output CSV for traceability only, not
#                    used for any logic.
#
# Output CSV (created fresh every run, overwrites previous run):
#   backend/scripts/output/test_set_confidence_discovery.csv
#
# -----------------------------------------------------------------------
# HOW TO RUN (inside the Docker container)
# -----------------------------------------------------------------------
#   docker exec -it glaucoma_backend python -m scripts.discover_test_set_confidence
#
# Runtime note: this loads all 3 models once and runs ~415 forward passes
# on CPU (no GPU on EC2 t3.medium / most local Docker setups either).
# Expect this to take a while - the script prints progress every 25 images
# so you can see it is alive.
#
# -----------------------------------------------------------------------
# OUTPUT CSV COLUMNS
# -----------------------------------------------------------------------
#   filename            - basename of the image file, e.g. "n0092.jpg"
#   dataset              - source dataset, carried from test.csv
#   ground_truth_label   - "glaucoma" or "normal" (from folder/test.csv)
#   ensemble_prediction  - "glaucoma" or "normal" (model output)
#   confidence_score     - float 0-1, ensemble sigmoid confidence
#   correct              - True/False, prediction matches ground truth
#   full_path            - resolved absolute path used to read the image,
#                           handy for copy-pasting into seed_llm_comparison.py
#
# After this script finishes, open the CSV (Excel, DBeaver, or just
# `cat`/`less` it) and manually pick 5 filenames per bucket described in
# the LLM comparison plan, e.g.:
#   - ground_truth_label=glaucoma AND confidence_score between 0.85-0.95
#   - ground_truth_label=glaucoma AND confidence_score between 0.50-0.65
#   - ground_truth_label=normal   AND confidence_score between 0.50-0.65 (closest to 0.5 on the normal side)
#   etc.
# Then paste those filenames into the SELECTED_CASES list at the top of
# seed_llm_comparison.py.
# ---------------------------------------------------------------------------

import os
import csv
import sys
import traceback
from pathlib import Path
from datetime import datetime

# Make "app" importable when run as `python -m scripts.discover_test_set_confidence`
# from the backend/ working directory inside the container.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.logger import get_logger
from app.core.config import settings
from app.ml_inference.model_loader import load_all_models
from app.ml_inference.preprocessing import preprocess_image_for_model
from app.ml_inference.inference import run_single_model, run_ensemble

logger = get_logger(__name__)

# -----------------------------------------------------------------------
# CONFIG - adjust here if paths or folder names ever change
# -----------------------------------------------------------------------
TEST_IMAGES_ROOT = Path(settings.TEST_IMAGES_DIR)          # "test_images" (relative to backend/ working dir, i.e. /app/test_images inside the container)
LABEL_CSV_PATH = TEST_IMAGES_ROOT / "test.csv"               # backend/test_images/test.csv
GLAUCOMA_SUBDIR = TEST_IMAGES_ROOT / "glaucoma"              # backend/test_images/glaucoma/
NORMAL_SUBDIR = TEST_IMAGES_ROOT / "normal"                  # backend/test_images/normal/

OUTPUT_DIR = Path(__file__).parent / "output"                # backend/scripts/output/
OUTPUT_CSV_PATH = OUTPUT_DIR / "test_set_confidence_discovery.csv"

MODELS_TO_RUN = ["efficientnetb0", "vgg16", "efficientnetv2"]  # same 3 models used everywhere else in the app

PROGRESS_EVERY = 25  # print a progress line every N images so you know it's alive


def load_label_rows(csv_path: Path) -> list[dict]:
    # Reads test.csv and returns a list of dicts: {filename, label, dataset}
    # We only keep the FILENAME (basename) from the recorded image_path,
    # because the recorded path is a host machine path that will not exist
    # inside this container. The actual file is located later by filename
    # under the glaucoma/ or normal/ subfolder that matches the label.

    if not csv_path.exists():
        raise FileNotFoundError(
            f"Label CSV not found at {csv_path}. "
            f"Expected it at backend/test_images/test.csv - check TEST_IMAGES_DIR in .env."
        )

    rows = []
    with open(csv_path, "r", encoding="utf-8-sig", newline="") as f:
        # test.csv has been seen as both tab and comma separated depending
        # on how it was exported from Excel - sniff the delimiter to be safe.
        sample = f.read(4096)
        f.seek(0)
        try:
            dialect = csv.Sniffer().sniff(sample, delimiters="\t,")
        except csv.Error:
            dialect = csv.excel_tab  # fall back to tab if sniffing fails

        reader = csv.DictReader(f, dialect=dialect)
        for row in reader:
            raw_path = row.get("image_path", "").strip()
            label_raw = row.get("label", "").strip()
            dataset = row.get("dataset", "").strip()

            if not raw_path or label_raw == "":
                continue  # skip blank/malformed rows

            filename = Path(raw_path.replace("\\", "/")).name  # handles Windows-style backslashes too
            label = int(label_raw)  # 0 = normal, 1 = glaucoma

            rows.append({
                "filename": filename,
                "label": label,
                "dataset": dataset,
            })

    return rows


def resolve_image_path(filename: str, label: int) -> Path | None:
    # Locates the actual image file on disk under glaucoma/ or normal/
    # based on the ground truth label. Returns None if not found - this
    # can happen if test.csv references an image that was never copied
    # into test_images/, or one that has already been moved to done/
    # by the unrelated seed-screenings admin endpoint.

    subdir = GLAUCOMA_SUBDIR if label == 1 else NORMAL_SUBDIR
    candidate = subdir / filename

    if candidate.exists():
        return candidate

    return None


def run_ensemble_only(image_path: Path) -> dict:
    # Runs the 3 models + ensemble averaging WITHOUT Grad-CAM++, CDR, or
    # referral letters. This mirrors the first half of run_inference_pipeline
    # in app/ml_inference/inference.py but deliberately stops right after
    # the ensemble result is computed, since that is all we need for this
    # discovery pass.

    individual_results = []
    for model_name in MODELS_TO_RUN:
        res = run_single_model(model_name, str(image_path))
        individual_results.append(res)

    ensemble_result = run_ensemble(individual_results)
    return ensemble_result


def main():
    started_at = datetime.now()
    logger.info(f"[discover] Starting test set confidence discovery at {started_at}")

    # Step 1 - Load ground truth labels from test.csv
    label_rows = load_label_rows(LABEL_CSV_PATH)
    logger.info(f"[discover] Loaded {len(label_rows)} rows from {LABEL_CSV_PATH}")

    # Step 2 - Load all 3 models into memory once.
    # load_all_models() is normally called by FastAPI's startup lifespan in
    # main.py - this standalone script never goes through that lifespan, so
    # we call it directly here ourselves before any inference can run.
    load_all_models()
    logger.info("[discover] All 3 models loaded and ready.")

    # Step 3 - Make sure the output folder exists
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    results = []
    skipped = []
    failed = []

    total = len(label_rows)

    for index, row in enumerate(label_rows, start=1):
        filename = row["filename"]
        label = row["label"]
        dataset = row["dataset"]
        ground_truth_label = "glaucoma" if label == 1 else "normal"

        image_path = resolve_image_path(filename, label)

        if image_path is None:
            logger.warning(f"[discover] SKIP - file not found on disk: {filename} (label={ground_truth_label})")
            skipped.append(filename)
            continue

        try:
            ensemble_result = run_ensemble_only(image_path)

            prediction = ensemble_result["prediction"]
            confidence_score = float(ensemble_result["confidence_score"])
            correct = (prediction == ground_truth_label)

            results.append({
                "filename": filename,
                "dataset": dataset,
                "ground_truth_label": ground_truth_label,
                "ensemble_prediction": prediction,
                "confidence_score": round(confidence_score, 4),
                "correct": correct,
                "full_path": str(image_path),
            })

        except Exception as e:
            logger.error(f"[discover] FAILED on {filename}: {e}", exc_info=True)
            failed.append({"filename": filename, "error": str(e)})
            continue

        if index % PROGRESS_EVERY == 0 or index == total:
            logger.info(f"[discover] Progress: {index}/{total} images processed.")

    # Step 4 - Write results CSV
    with open(OUTPUT_CSV_PATH, "w", encoding="utf-8", newline="") as f:
        fieldnames = [
            "filename", "dataset", "ground_truth_label",
            "ensemble_prediction", "confidence_score", "correct", "full_path",
        ]
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for r in results:
            writer.writerow(r)

    finished_at = datetime.now()
    duration = (finished_at - started_at).total_seconds()

    # Step 5 - Print a clear summary so you know what happened
    logger.info("=" * 70)
    logger.info(f"[discover] DONE in {duration:.1f}s")
    logger.info(f"[discover] Total rows in test.csv : {total}")
    logger.info(f"[discover] Successfully processed  : {len(results)}")
    logger.info(f"[discover] Skipped (file not found): {len(skipped)}")
    logger.info(f"[discover] Failed (inference error): {len(failed)}")
    logger.info(f"[discover] Output CSV written to    : {OUTPUT_CSV_PATH}")
    logger.info("=" * 70)

    if skipped:
        logger.warning(f"[discover] Skipped filenames (first 10 shown): {skipped[:10]}")
    if failed:
        logger.warning(f"[discover] Failed filenames (first 10 shown): {[f['filename'] for f in failed[:10]]}")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        logger.error("[discover] Script crashed:")
        traceback.print_exc()
        sys.exit(1)