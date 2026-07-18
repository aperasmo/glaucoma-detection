# This is the discovery pass for the Paper 2 LLM comparison work, not a seeding
# script. Runs every image in the locked 415-image test set through just the
# ensemble inference (no Grad-CAM++, no CDR, no referral letters, no LLM calls)
# and logs the prediction + confidence_score against the known ground truth.
#
# Reason this exists: you can't just tell a model to output "85-95% confidence"
# on demand, it depends on what's actually in the image. So instead we run the
# real unmodified pipeline once over the whole test set, then eyeball the output
# CSV afterward and hand-pick images per target scenario bucket for
# seed_llm_comparison.py (the follow-up script that reads this CSV).
#
# Doesn't touch the database at all - no Patient/Screening/ScreeningResult
# rows, everything stays in memory and the only output is a CSV. Keeps this
# discovery pass fully separate from real clinical data. Also doesn't call any
# LLM (no OpenAI/Groq/Gemini here), so zero token cost - LLM calls only start
# happening later in seed_llm_comparison.py for the hand-picked cases.
#
# Source images and labels live at backend/test_images/test.csv plus the
# glaucoma/ and normal/ subfolders. test.csv (tab or comma separated, needs a
# header row) has image_path, label, dataset columns - we only ever use the
# filename portion of image_path since the recorded path is often a Windows
# host path that won't exist inside the container; the file gets located by
# filename under whichever subfolder matches the label. label is 0=normal,
# 1=glaucoma, and dataset is just carried through for traceability.
#
# Output CSV gets written fresh each run (overwrites the previous one) at
# backend/scripts/output/test_set_confidence_discovery.csv, columns: filename,
# dataset, ground_truth_label, ensemble_prediction, confidence_score, correct,
# full_path.
#
# Run it inside the container with:
#   docker exec -it glaucoma_backend python -m scripts.discover_test_set_confidence
# Loads all 3 models and runs ~415 forward passes on CPU (no GPU on the usual
# EC2/local Docker setups), so it takes a while - prints progress every 25
# images so you know it's not stuck.
#
# Once it's done, open the CSV and manually pick filenames per bucket from the
# comparison plan - e.g. glaucoma images with confidence 0.85-0.95, glaucoma
# with 0.50-0.65, normal images closest to 0.5 from the normal side, etc - then
# paste those filenames into SELECTED_CASES at the top of seed_llm_comparison.py.

import os
import csv
import sys
import traceback
from pathlib import Path
from datetime import datetime

# need this so "app" is importable when run as
# `python -m scripts.discover_test_set_confidence` from backend/ in the container
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.logger import get_logger
from app.core.config import settings
from app.ml_inference.model_loader import load_all_models
from app.ml_inference.preprocessing import preprocess_image_for_model
from app.ml_inference.inference import run_single_model, run_ensemble

logger = get_logger(__name__)

# paths - update these if the folder layout ever changes
TEST_IMAGES_ROOT = Path(settings.TEST_IMAGES_DIR)          # "test_images" (relative to backend/ working dir, i.e. /app/test_images inside the container)
LABEL_CSV_PATH = TEST_IMAGES_ROOT / "test.csv"               # backend/test_images/test.csv
GLAUCOMA_SUBDIR = TEST_IMAGES_ROOT / "glaucoma"              # backend/test_images/glaucoma/
NORMAL_SUBDIR = TEST_IMAGES_ROOT / "normal"                  # backend/test_images/normal/

OUTPUT_DIR = Path(__file__).parent / "output"                # backend/scripts/output/
OUTPUT_CSV_PATH = OUTPUT_DIR / "test_set_confidence_discovery.csv"

MODELS_TO_RUN = ["efficientnetb0", "vgg16", "efficientnetv2"]  # same 3 models used everywhere else in the app

PROGRESS_EVERY = 25  # print a progress line every N images so you know it's alive


def load_label_rows(csv_path: Path) -> list[dict]:
    # reads test.csv into a list of {filename, label, dataset} dicts. only
    # keeping the basename from image_path since the recorded path is a host
    # machine path that won't exist in the container - the file gets found
    # later by filename under whichever subfolder matches the label

    if not csv_path.exists():
        raise FileNotFoundError(
            f"Label CSV not found at {csv_path}. "
            f"Expected it at backend/test_images/test.csv - check TEST_IMAGES_DIR in .env."
        )

    rows = []
    with open(csv_path, "r", encoding="utf-8-sig", newline="") as f:
        # test.csv shows up as both tab- and comma-separated depending on how
        # it got exported from Excel, so sniff the delimiter to be safe
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
    # finds the image under glaucoma/ or normal/ based on the ground truth
    # label, returns None if it's missing - which can happen if test.csv
    # points at something never copied into test_images/, or something
    # already moved to done/ by the unrelated seed-screenings admin endpoint

    subdir = GLAUCOMA_SUBDIR if label == 1 else NORMAL_SUBDIR
    candidate = subdir / filename

    if candidate.exists():
        return candidate

    return None


def run_ensemble_only(image_path: Path) -> dict:
    # runs the 3 models + ensemble averaging, skipping Grad-CAM++/CDR/referral
    # letters - basically the first half of run_inference_pipeline() in
    # app/ml_inference/inference.py, stopped right after the ensemble result
    # since that's all this discovery pass actually needs

    individual_results = []
    for model_name in MODELS_TO_RUN:
        res = run_single_model(model_name, str(image_path))
        individual_results.append(res)

    ensemble_result = run_ensemble(individual_results)
    return ensemble_result


def main():
    started_at = datetime.now()
    logger.info(f"[discover] Starting test set confidence discovery at {started_at}")

    # load ground truth labels from test.csv
    label_rows = load_label_rows(LABEL_CSV_PATH)
    logger.info(f"[discover] Loaded {len(label_rows)} rows from {LABEL_CSV_PATH}")

    # load all 3 models into memory once. normally FastAPI's startup lifespan
    # calls load_all_models() for us, but this standalone script never goes
    # through that, so we call it directly before any inference can happen
    load_all_models()
    logger.info("[discover] All 3 models loaded and ready.")

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

    # write out the results CSV
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

    # print a summary so it's obvious what happened
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