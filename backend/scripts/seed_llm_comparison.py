# backend/scripts/seed_llm_comparison.py
#
# PURPOSE (Paper 2 - LLM comparison research)
# ---------------------------------------------------------------------------
# This is the FOLLOW-UP script to discover_test_set_confidence.py.
# It seeds 60 hand-picked, real test set images across 6 clinical scenarios,
# creates a real Patient + Screening record for each, runs the FULL inference
# pipeline (3 models + ensemble + Grad-CAM++ + CDR) in RESEARCH MODE, and
# generates all 4 LLM referral letters per case (GPT-4o, GPT-4o-mini, LLaMa,
# Gemini).
#
# RUNS ONE SCENARIO AT A TIME - SESSION-BASED, NOT ALL 60 AT ONCE.
# Gemini's free-tier rate limit makes running all 60 cases (140 LLM calls)
# in a single session unreliable. Instead, this script takes a single
# --scenario argument and only processes that scenario's cases. Run it
# once per scenario, across separate sessions/days, as your Gemini quota
# allows:
#
#   docker exec -it glaucoma_backend python -m scripts.seed_llm_comparison --scenario 1
#   docker exec -it glaucoma_backend python -m scripts.seed_llm_comparison --scenario 2
#   ... and so on through --scenario 6
#
# Scenario sizes (n) and approx LLM call cost per session:
#   Scenario 1 (n=7,  glaucoma)  -> up to 28 LLM calls (7 cases x 4 LLMs)
#   Scenario 2 (n=10, glaucoma)  -> up to 40 LLM calls
#   Scenario 3 (n=6,  glaucoma)  -> up to 24 LLM calls
#   Scenario 4 (n=12, glaucoma)  -> up to 48 LLM calls
#   Scenario 5 (n=12, normal)    -> 0 LLM calls (no referral letter for normal prediction)
#   Scenario 6 (n=13, normal)    -> 0 LLM calls (no referral letter for normal prediction)
#
# IMAGE TRACKING - "done" SUBFOLDERS PER SCENARIO
# After a case is successfully processed, its source image is moved (not
# copied) from:
#   test_images/glaucoma/<filename>  or  test_images/normal/<filename>
# into a "scenario{N}_done" subfolder INSIDE THE SAME PARENT FOLDER it came
# from, e.g.:
#   test_images/glaucoma/scenario1_done/Im425_g_ACRIMA.jpg
#   test_images/normal/scenario6_done/image_2839.jpg
# This is purely a visual/file-based record of what has been processed for
# that scenario - the database (via the summary CSV's screening_id column)
# remains the authoritative record either way. If a case fails partway
# through inference, its image is deliberately NOT moved, so you can see
# at a glance (by what's still sitting in the bare glaucoma/ or normal/
# folder) which cases for that scenario still need attention.
#
# WHAT IS REAL vs WHAT IS CHOSEN (read this before changing anything):
#   - confidence_score, prediction, Grad-CAM++, CDR -> 100% real model output.
#     Nothing here is fabricated. These numbers came from
#     discover_test_set_confidence.py actually running the real ensemble.
#   - OHTS tier (Critical / Low / none) -> NOT fabricated either. We generate
#     a realistic patient IOP/CCT/age profile within real clinical ranges,
#     then run it through the SAME get_ohts_result() function the production
#     system uses, and verify it actually lands in the target tier before
#     accepting it. If a candidate profile doesn't land in the right tier,
#     we try another realistic candidate - we never hand-pick numbers just
#     to force a label.
#   - Which image goes into which scenario bucket -> chosen by us based on
#     the real confidence_score from the discovery CSV (see SELECTED_CASES
#     below). This is selection, not fabrication - every number attached to
#     every case is something the real system actually produced or verified.
#
# THIS SCRIPT DOES WRITE TO THE DATABASE.
# Unlike discover_test_set_confidence.py, this script creates REAL Patient,
# Screening, and ScreeningResult rows. These are clearly synthetic/research
# patients (NZ-style realistic names, but obviously not real people) sitting
# alongside your normal clinical demo data. If you want them separated from
# your regular Postman/UI demo data, run this against the Paper 2 copy of
# the backend instead of the main capstone database - that decision is up
# to you, this script does not care which database it's pointed at, it just
# uses whatever DATABASE_URL / Docker network the container is configured
# with at the time you run it.
#
# RE-RUN SAFETY
# This script is NOT idempotent by filename - running the same scenario
# twice will create MORE patients/screenings/LLM calls for those same
# images, not skip them. Once an image has been moved into its
# scenario{N}_done folder, running that --scenario again will simply find
# no remaining source files for it in the bare glaucoma/normal folder and
# skip with a warning - this is your natural guard against accidentally
# re-running (and re-spending LLM budget on) a scenario you already
# completed, AS LONG AS you don't manually move files back.
#
# -----------------------------------------------------------------------
# WHERE THINGS LIVE
# -----------------------------------------------------------------------
# Source images:
#   backend/test_images/glaucoma/*.jpg|png
#   backend/test_images/normal/*.jpg|png
# Processed images move to:
#   backend/test_images/glaucoma/scenario{N}_done/*.jpg|png
#   backend/test_images/normal/scenario{N}_done/*.jpg|png
#
# Output summary CSV (APPENDED to across sessions, not overwritten - so
# running scenario 1 today and scenario 2 tomorrow both end up in the same
# file rather than the second run wiping out the first):
#   backend/scripts/output/llm_comparison_seed_summary.csv
#   Columns: scenario, filename, patient_code, screening_id, ground_truth,
#            confidence_score, ohts_target, ohts_score, ohts_tier,
#            iop, cct, age_at_screening
#   This is your reference sheet for building the Paper 2 comparison tool -
#   it tells you exactly which screening_id to pull for each scenario.
#
# -----------------------------------------------------------------------
# HOW TO RUN (inside the Docker container) - ONE SCENARIO PER SESSION
# -----------------------------------------------------------------------
#   docker exec -it glaucoma_backend python -m scripts.seed_llm_comparison --scenario 1
#
# -----------------------------------------------------------------------
# HOW TO ADJUST THE CASE LIST OR PATIENT PROFILE RANGES
# -----------------------------------------------------------------------
# - To change which images are used: edit SELECTED_CASES below. Each entry
#   needs filename, label (0=normal/1=glaucoma - must match which subfolder
#   the file is actually in), dataset (for traceability only), and scenario.
# - To change the realistic IOP/CCT/age ranges used when searching for a
#   profile that lands in a target tier: edit REALISTIC_RANGES below.
# - To change how many attempts the script makes to find a profile that
#   lands in the target tier before giving up: edit MAX_PROFILE_ATTEMPTS.
# ---------------------------------------------------------------------------

import os
import sys
import csv
import argparse
import random
import asyncio
import traceback
import uuid
from pathlib import Path
from datetime import date, timedelta, datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.logger import get_logger
from app.core.config import settings
from app.db.database import AsyncSessionLocal
from app.models.patient import Patient
from app.models.screening import Screening
from app.models.screening_result import ScreeningResult
from app.ml_inference.model_loader import load_all_models
from app.ml_inference.inference import run_inference_pipeline
from app.ml_inference.ohts import get_ohts_result
# NOTE: generate_patient_code is intentionally NOT imported from
# app.services.patient_service here. That function uses COUNT(*) + 1,
# which can collide with an existing patient_code if rows were ever
# manually deleted directly in the database (bypassing the app's normal
# soft-delete, which only sets is_active=False and never removes rows).
# This exact collision happened once already during testing of this
# script. Rather than touch the production patient_service.py (explicitly
# out of scope - no DB/schema changes for this research script), we use
# a script-local generator below that keeps the same COUNT(*) + 1 numbering
# for readability, but appends the last 5 characters of the patient's own
# UUID as a suffix, guaranteeing uniqueness no matter what gaps exist in
# the count.

logger = get_logger(__name__)

# -----------------------------------------------------------------------
# CONFIG - paths, same pattern as discover_test_set_confidence.py
# -----------------------------------------------------------------------
TEST_IMAGES_ROOT = Path(settings.TEST_IMAGES_DIR)
GLAUCOMA_SUBDIR = TEST_IMAGES_ROOT / "glaucoma"
NORMAL_SUBDIR = TEST_IMAGES_ROOT / "normal"

OUTPUT_DIR = Path(__file__).parent / "output"
OUTPUT_CSV_PATH = OUTPUT_DIR / "llm_comparison_seed_summary.csv"
LLM_LETTERS_CSV_PATH = OUTPUT_DIR / "llm_comparison_letters_raw.csv"

# Fixed seed for the placeholder SYSTEM user_id used as created_by.
# Edit this if your SYS00001 user_id is different - check with:
#   SELECT user_id FROM users WHERE user_code = 'SYS00001';
SYSTEM_USER_ID = None  # set below in main() after looking it up from the DB

# -----------------------------------------------------------------------
# REALISTIC CLINICAL RANGES
# Same ranges already used in admin.py's generate_nz_patient() for the
# regular demo seed - kept consistent so nothing here is a "special case"
# range invented just for this script.
# -----------------------------------------------------------------------
REALISTIC_RANGES = {
    "age_years": (40, 80),     # patient age range
    "iop": (18.0, 32.0),       # mmHg
    "cct": (480.0, 600.0),     # micrometres
}

MAX_PROFILE_ATTEMPTS = 200  # how many random candidates to try before giving up on hitting a target tier

# -----------------------------------------------------------------------
# THE 60 SELECTED CASES
# Pulled directly from backend/scripts/output/test_set_confidence_discovery.csv
# confidence_score values shown here are the REAL ensemble output recorded
# during the discovery pass - they are not re-derived, just carried over
# for reference in the summary CSV.
# -----------------------------------------------------------------------
SELECTED_CASES = [
    # --- Scenario 1: glaucoma TP, high-conf (85-95%), OHTS Critical, n=7 ---
    {"filename": "Im425_g_ACRIMA.jpg", "label": 1, "dataset": "ACRIMA", "scenario": 1, "confidence_score": 0.9497, "ohts_target": "critical"},
    {"filename": "r3_G-8-R_left_half.png", "label": 1, "dataset": "RIM-ONE-DL", "scenario": 1, "confidence_score": 0.9457, "ohts_target": "critical"},
    {"filename": "r3_G-3-R_left_half.png", "label": 1, "dataset": "RIM-ONE-DL", "scenario": 1, "confidence_score": 0.9437, "ohts_target": "critical"},
    {"filename": "441.jpg", "label": 1, "dataset": "ORIGA", "scenario": 1, "confidence_score": 0.9434, "ohts_target": "critical"},
    {"filename": "r3_G-31-R_left_half.png", "label": 1, "dataset": "RIM-ONE-DL", "scenario": 1, "confidence_score": 0.9390, "ohts_target": "critical"},
    {"filename": "Im422_g_ACRIMA.jpg", "label": 1, "dataset": "ACRIMA", "scenario": 1, "confidence_score": 0.9350, "ohts_target": "critical"},
    {"filename": "Im420_g_ACRIMA.jpg", "label": 1, "dataset": "ACRIMA", "scenario": 1, "confidence_score": 0.9340, "ohts_target": "critical"},

    # --- Scenario 2: glaucoma TP, low-conf (50-65%), OHTS Critical, n=10 ---
    {"filename": "631.jpg", "label": 1, "dataset": "ORIGA", "scenario": 2, "confidence_score": 0.5044, "ohts_target": "critical"},
    {"filename": "RET072OD.jpg", "label": 1, "dataset": "PAPILA", "scenario": 2, "confidence_score": 0.5128, "ohts_target": "critical"},
    {"filename": "image_1338.jpg", "label": 1, "dataset": "G1020", "scenario": 2, "confidence_score": 0.5158, "ohts_target": "critical"},
    {"filename": "image_199.jpg", "label": 1, "dataset": "G1020", "scenario": 2, "confidence_score": 0.5190, "ohts_target": "critical"},
    {"filename": "image_1798.jpg", "label": 1, "dataset": "G1020", "scenario": 2, "confidence_score": 0.5192, "ohts_target": "critical"},
    {"filename": "Im414_g_ACRIMA.jpg", "label": 1, "dataset": "ACRIMA", "scenario": 2, "confidence_score": 0.5461, "ohts_target": "critical"},
    {"filename": "628.jpg", "label": 1, "dataset": "ORIGA", "scenario": 2, "confidence_score": 0.5534, "ohts_target": "critical"},
    {"filename": "image_1113.jpg", "label": 1, "dataset": "G1020", "scenario": 2, "confidence_score": 0.5548, "ohts_target": "critical"},
    {"filename": "image_3144.jpg", "label": 1, "dataset": "G1020", "scenario": 2, "confidence_score": 0.5562, "ohts_target": "critical"},
    {"filename": "image_841.jpg", "label": 1, "dataset": "G1020", "scenario": 2, "confidence_score": 0.5568, "ohts_target": "critical"},

    # --- Scenario 3: glaucoma TP, high-conf (85-95%), OHTS Low, n=6 ---
    {"filename": "Im352_g_ACRIMA.jpg", "label": 1, "dataset": "ACRIMA", "scenario": 3, "confidence_score": 0.9319, "ohts_target": "low"},
    {"filename": "r2_Im362.png", "label": 1, "dataset": "RIM-ONE-DL", "scenario": 3, "confidence_score": 0.9259, "ohts_target": "low"},
    {"filename": "RET096OS.jpg", "label": 1, "dataset": "PAPILA", "scenario": 3, "confidence_score": 0.8885, "ohts_target": "low"},
    {"filename": "426.jpg", "label": 1, "dataset": "ORIGA", "scenario": 3, "confidence_score": 0.8800, "ohts_target": "low"},
    {"filename": "r3_S-9-L_left_half.png", "label": 1, "dataset": "RIM-ONE-DL", "scenario": 3, "confidence_score": 0.8700, "ohts_target": "low"},
    {"filename": "RET045OS.jpg", "label": 1, "dataset": "PAPILA", "scenario": 3, "confidence_score": 0.8681, "ohts_target": "low"},

    # --- Scenario 4: glaucoma TP, any-conf, NO OHTS (IOP/CCT left blank), n=12 ---
    {"filename": "Im687_g_ACRIMA.jpg", "label": 1, "dataset": "ACRIMA", "scenario": 4, "confidence_score": 0.9999, "ohts_target": None},
    {"filename": "r2_Im387.png", "label": 1, "dataset": "RIM-ONE-DL", "scenario": 4, "confidence_score": 0.9958, "ohts_target": None},
    {"filename": "r2_Im393.png", "label": 1, "dataset": "RIM-ONE-DL", "scenario": 4, "confidence_score": 0.9957, "ohts_target": None},
    {"filename": "r3_G-12-L_left_half.png", "label": 1, "dataset": "RIM-ONE-DL", "scenario": 4, "confidence_score": 0.9927, "ohts_target": None},
    {"filename": "r2_Im403.png", "label": 1, "dataset": "RIM-ONE-DL", "scenario": 4, "confidence_score": 0.9901, "ohts_target": None},
    {"filename": "r2_Im388.png", "label": 1, "dataset": "RIM-ONE-DL", "scenario": 4, "confidence_score": 0.9879, "ohts_target": None},
    {"filename": "r3_G-35-R_left_half.png", "label": 1, "dataset": "RIM-ONE-DL", "scenario": 4, "confidence_score": 0.9718, "ohts_target": None},
    {"filename": "r1_Im118.png", "label": 1, "dataset": "RIM-ONE-DL", "scenario": 4, "confidence_score": 0.9626, "ohts_target": None},
    {"filename": "613.jpg", "label": 1, "dataset": "ORIGA", "scenario": 4, "confidence_score": 0.9510, "ohts_target": None},
    {"filename": "RET016OS.jpg", "label": 1, "dataset": "PAPILA", "scenario": 4, "confidence_score": 0.7830, "ohts_target": None},
    {"filename": "g0006.jpg", "label": 1, "dataset": "REFUGE", "scenario": 4, "confidence_score": 0.7307, "ohts_target": None},
    {"filename": "image_360.jpg", "label": 1, "dataset": "G1020", "scenario": 4, "confidence_score": 0.7038, "ohts_target": None},

    # --- Scenario 5: normal TN, confidently normal, OHTS High/Critical, n=12 ---
    {"filename": "V0106.jpg", "label": 0, "dataset": "REFUGE", "scenario": 5, "confidence_score": 0.0009, "ohts_target": "critical"},
    {"filename": "r3_N-3-L_left_half.png", "label": 0, "dataset": "RIM-ONE-DL", "scenario": 5, "confidence_score": 0.0011, "ohts_target": "critical"},
    {"filename": "V0199.jpg", "label": 0, "dataset": "REFUGE", "scenario": 5, "confidence_score": 0.0011, "ohts_target": "critical"},
    {"filename": "V0195.jpg", "label": 0, "dataset": "REFUGE", "scenario": 5, "confidence_score": 0.0012, "ohts_target": "critical"},
    {"filename": "V0120.jpg", "label": 0, "dataset": "REFUGE", "scenario": 5, "confidence_score": 0.0012, "ohts_target": "critical"},
    {"filename": "V0045.jpg", "label": 0, "dataset": "REFUGE", "scenario": 5, "confidence_score": 0.0012, "ohts_target": "critical"},
    {"filename": "V0313.jpg", "label": 0, "dataset": "REFUGE", "scenario": 5, "confidence_score": 0.0012, "ohts_target": "critical"},
    {"filename": "V0304.jpg", "label": 0, "dataset": "REFUGE", "scenario": 5, "confidence_score": 0.0012, "ohts_target": "critical"},
    {"filename": "Im266_ACRIMA.jpg", "label": 0, "dataset": "ACRIMA", "scenario": 5, "confidence_score": 0.0013, "ohts_target": "critical"},
    {"filename": "V0148.jpg", "label": 0, "dataset": "REFUGE", "scenario": 5, "confidence_score": 0.0014, "ohts_target": "critical"},
    {"filename": "V0239.jpg", "label": 0, "dataset": "REFUGE", "scenario": 5, "confidence_score": 0.0014, "ohts_target": "critical"},
    {"filename": "V0311.jpg", "label": 0, "dataset": "REFUGE", "scenario": 5, "confidence_score": 0.0014, "ohts_target": "critical"},

    # --- Scenario 6: normal TN, borderline (~0.47-0.49), OHTS Low, n=13 ---
    {"filename": "image_2839.jpg", "label": 0, "dataset": "G1020", "scenario": 6, "confidence_score": 0.4949, "ohts_target": "low"},
    {"filename": "image_2431.jpg", "label": 0, "dataset": "G1020", "scenario": 6, "confidence_score": 0.4931, "ohts_target": "low"},
    {"filename": "image_363.jpg", "label": 0, "dataset": "G1020", "scenario": 6, "confidence_score": 0.4920, "ohts_target": "low"},
    {"filename": "image_2064.jpg", "label": 0, "dataset": "G1020", "scenario": 6, "confidence_score": 0.4898, "ohts_target": "low"},
    {"filename": "r2_Im194.png", "label": 0, "dataset": "RIM-ONE-DL", "scenario": 6, "confidence_score": 0.4893, "ohts_target": "low"},
    {"filename": "RET234OD.jpg", "label": 0, "dataset": "PAPILA", "scenario": 6, "confidence_score": 0.4818, "ohts_target": "low"},
    {"filename": "image_437.jpg", "label": 0, "dataset": "G1020", "scenario": 6, "confidence_score": 0.4817, "ohts_target": "low"},
    {"filename": "image_48.jpg", "label": 0, "dataset": "G1020", "scenario": 6, "confidence_score": 0.4805, "ohts_target": "low"},
    {"filename": "image_2899.jpg", "label": 0, "dataset": "G1020", "scenario": 6, "confidence_score": 0.4790, "ohts_target": "low"},
    {"filename": "411.jpg", "label": 0, "dataset": "ORIGA", "scenario": 6, "confidence_score": 0.4751, "ohts_target": "low"},
    {"filename": "image_2303.jpg", "label": 0, "dataset": "G1020", "scenario": 6, "confidence_score": 0.4748, "ohts_target": "low"},
    {"filename": "image_265.jpg", "label": 0, "dataset": "G1020", "scenario": 6, "confidence_score": 0.4747, "ohts_target": "low"},
    {"filename": "r3_N-71-L_left_half.png", "label": 0, "dataset": "RIM-ONE-DL", "scenario": 6, "confidence_score": 0.4740, "ohts_target": "low"},
]

assert len(SELECTED_CASES) == 60, f"Expected 60 cases, found {len(SELECTED_CASES)} - check SELECTED_CASES list."

NZ_FIRST_NAMES_MALE = [
    "James", "William", "Oliver", "Jack", "Noah", "Lucas", "Mason", "Liam",
    "Ethan", "Logan", "Henry", "Samuel", "Daniel", "Benjamin", "Alexander",
]
NZ_FIRST_NAMES_FEMALE = [
    "Charlotte", "Olivia", "Isabella", "Sophie", "Amelia", "Grace", "Isla",
    "Emma", "Mia", "Aria", "Hannah", "Lily", "Zoe", "Chloe", "Ruby",
]
NZ_LAST_NAMES = [
    "Smith", "Jones", "Williams", "Brown", "Taylor", "Wilson", "Johnson",
    "Anderson", "Thompson", "Walker", "Martin", "White", "Harris", "Clark",
    "Lewis", "Robinson", "Young", "Hall", "Allen", "King", "Tane", "Parata",
    "Ngata", "Heke", "Waititi", "Tamaki", "Reweti", "Ngai", "Poa", "Tūhoe",
]
NZ_AREA_CODES = ["021", "022", "027"]


def find_profile_for_target_tier(target_tier: str | None) -> dict:
    # Searches for a realistic IOP/CCT/age combination that genuinely
    # produces the target OHTS tier when run through the REAL get_ohts_result()
    # function - the same function the production system uses.
    #
    # target_tier: "critical", "low", or None (meaning no OHTS - IOP/CCT left blank)
    #
    # Returns dict: {dob, iop, cct, ohts_score, ohts_tier} - ohts_score/tier
    # will be None if target_tier is None (no OHTS case).

    if target_tier is None:
        # Scenario 4 - genuinely missing data, not computed at all.
        age_years = random.randint(*REALISTIC_RANGES["age_years"])
        dob = date.today() - timedelta(days=age_years * 365 + random.randint(0, 364))
        return {
            "dob": dob,
            "iop": None,
            "cct": None,
            "ohts_score": None,
            "ohts_tier": None,
        }

    for attempt in range(MAX_PROFILE_ATTEMPTS):
        age_years = random.randint(*REALISTIC_RANGES["age_years"])
        dob = date.today() - timedelta(days=age_years * 365 + random.randint(0, 364))
        iop = round(random.uniform(*REALISTIC_RANGES["iop"]), 1)
        cct = round(random.uniform(*REALISTIC_RANGES["cct"]), 1)

        # Use the REAL scoring function with default Kass et al. (2002) tiers.
        # CDR/VCD are None here, matching current production behaviour where
        # segmentation output is not yet fed into OHTS (locked design decision).
        result = get_ohts_result(dob=dob, iop=iop, cct=cct, cdr=None, vcd=None, tiers=None)

        if result is not None and result["ohts_tier"] == target_tier:
            return {
                "dob": dob,
                "iop": iop,
                "cct": cct,
                "ohts_score": result["ohts_score"],
                "ohts_tier": result["ohts_tier"],
            }

    raise RuntimeError(
        f"Could not find a realistic profile landing in tier '{target_tier}' "
        f"after {MAX_PROFILE_ATTEMPTS} attempts. Consider widening REALISTIC_RANGES."
    )


def generate_nz_patient_identity() -> dict:
    # Generates just the name/contact portion of a patient - clinical values
    # (dob/iop/cct) are handled separately by find_profile_for_target_tier()
    # since those need to be verified against the target OHTS tier.
    gender = random.choice(["male", "female"])
    first_name = random.choice(NZ_FIRST_NAMES_MALE if gender == "male" else NZ_FIRST_NAMES_FEMALE)
    last_name = random.choice(NZ_LAST_NAMES)
    mobile = f"{random.choice(NZ_AREA_CODES)}{random.randint(1000000, 9999999)}"
    return {
        "first_name": first_name,
        "last_name": last_name,
        "gender": gender,
        "mobile_number": mobile,
        "email": f"{first_name.lower()}.{last_name.lower()}@email.com",
    }


def resolve_image_path(filename: str, label: int) -> Path | None:
    # Looks for the file only in the BARE glaucoma/ or normal/ folder, not
    # inside any scenario{N}_done/ subfolder. If a previous session already
    # moved this file into its done folder, this correctly returns None -
    # which process_case() treats as "already processed, skip" rather than
    # an error, so re-running a completed scenario is a safe no-op.
    subdir = GLAUCOMA_SUBDIR if label == 1 else NORMAL_SUBDIR
    candidate = subdir / filename
    return candidate if candidate.exists() else None


def move_to_scenario_done(image_path: Path, label: int, scenario: int) -> None:
    # Moves a successfully processed image into a scenario{N}_done subfolder
    # INSIDE the same parent folder it came from (glaucoma/ stays under
    # glaucoma/, normal/ stays under normal/). This is a visual/file-based
    # processed-marker only - the database is still the source of truth.
    subdir = GLAUCOMA_SUBDIR if label == 1 else NORMAL_SUBDIR
    done_dir = subdir / f"scenario{scenario}_done"
    done_dir.mkdir(parents=True, exist_ok=True)

    import shutil
    destination = done_dir / image_path.name
    shutil.move(str(image_path), str(destination))
    logger.info(f"[seed_llm] Moved processed image to: {destination}")


async def get_system_user_id(db) -> uuid.UUID:
    # Looks up the real SYS00001 user_id from the DB rather than hardcoding
    # a guessed UUID - this stays correct even if the DB was reset and
    # SYS00001 was recreated with a new UUID.
    from sqlalchemy import select
    from app.models.user import User

    result = await db.execute(select(User).where(User.user_code == "SYS00001"))
    user = result.scalar_one_or_none()
    if not user:
        raise RuntimeError(
            "SYS00001 user not found. Run 'python -m app.db.seed' first to create it."
        )
    return user.user_id


async def process_case(case: dict, system_user_id: uuid.UUID, summary_rows: list, llm_letter_rows: list) -> str:
    # Returns a status string: "processed", "skipped_already_done", or raises on real failure.
    filename = case["filename"]
    label = case["label"]
    scenario = case["scenario"]
    ground_truth = "glaucoma" if label == 1 else "normal"

    image_path = resolve_image_path(filename, label)
    if image_path is None:
        # Could mean the file genuinely doesn't exist, OR it was already
        # moved into scenario{N}_done/ by a previous run of this same
        # scenario. Either way, there's nothing to process - log it clearly
        # and move on rather than treating it as a hard failure.
        done_check = (GLAUCOMA_SUBDIR if label == 1 else NORMAL_SUBDIR) / f"scenario{scenario}_done" / filename
        if done_check.exists():
            logger.info(f"[seed_llm] SKIP - already processed in a previous session: {filename}")
        else:
            logger.warning(f"[seed_llm] SKIP - file not found anywhere: {filename} (label={ground_truth})")
        return "skipped_already_done"

    profile = find_profile_for_target_tier(case["ohts_target"])
    identity = generate_nz_patient_identity()

    async with AsyncSessionLocal() as db:
        # Step 1 - create patient
        # Generate the UUID ourselves first (normally SQLAlchemy's column
        # default=uuid.uuid4 would do this at flush time, but we need the
        # UUID value available BEFORE insert to derive a collision-safe
        # patient_code from it - see generate_safe_patient_code() above).
        new_patient_uuid = uuid.uuid4()
        patient_code = await generate_safe_patient_code(db, new_patient_uuid)

        new_patient = Patient(
            patient_id=new_patient_uuid,
            patient_code=patient_code,
            first_name=identity["first_name"],
            last_name=identity["last_name"],
            dob=profile["dob"],
            gender=identity["gender"],
            email=identity["email"],
            mobile_number=identity["mobile_number"],
            iop=profile["iop"],
            cct=profile["cct"],
            is_active=True,
            created_by=system_user_id,
            updated_by=system_user_id,
        )
        db.add(new_patient)
        await db.flush()

        # Step 2 - create screening record, copy image into uploads/screenings
        import shutil
        screening_id = uuid.uuid4()
        eye_side = random.choice(["left", "right"])
        ext = image_path.suffix
        upload_path = os.path.join("uploads/screenings", f"{screening_id}{ext}")
        shutil.copy2(image_path, upload_path)

        new_screening = Screening(
            screening_id=screening_id,
            patient_id=new_patient.patient_id,
            screened_by=system_user_id,
            image_path=upload_path,
            eye_side=eye_side,
            status="pending",
            created_by=system_user_id,
            updated_by=system_user_id,
        )
        db.add(new_screening)
        await db.commit()

        logger.info(
            f"[seed_llm] Scenario {scenario} | {patient_code} created | "
            f"OHTS target={case['ohts_target']} actual={profile['ohts_tier']} "
            f"(score={profile['ohts_score']}) | image={filename}"
        )

    # Step 3 - run full inference pipeline, FORCED Research Mode, regardless
    # of the global INFERENCE_MODE setting - this is the whole point of the
    # LLM comparison run, every case needs all 4 LLM letters.
    async with AsyncSessionLocal() as db:
        await run_inference_pipeline(
            screening_id=screening_id,
            image_path=upload_path,
            db=db,
            created_by=system_user_id,
            mode="research",
        )

    # Step 4 - only NOW that inference has fully succeeded, move the source
    # image into its scenario_done folder. If inference raised an exception
    # above, we never reach this line, so the image stays in the bare
    # glaucoma/normal folder as a visible marker that this case still needs
    # attention on the next run.
    move_to_scenario_done(image_path, label, scenario)

    summary_rows.append({
        "scenario": scenario,
        "filename": filename,
        "patient_code": patient_code,
        "screening_id": str(screening_id),
        "ground_truth": ground_truth,
        "confidence_score": case["confidence_score"],
        "ohts_target": case["ohts_target"],
        "ohts_score": profile["ohts_score"],
        "ohts_tier": profile["ohts_tier"],
        "iop": profile["iop"],
        "cct": profile["cct"],
        "age_at_screening": (date.today() - profile["dob"]).days // 365,
    })

    # Step 5 - if this case generated LLM letters (glaucoma-positive cases
    # only), fetch the actual saved records back from the DB and record
    # per-LLM data for the comparison study - response time, token usage,
    # and the concept-based completeness_score. This is read back from the
    # DB rather than captured inline here because run_inference_pipeline()
    # owns the actual save step - reading back after the fact keeps this
    # script decoupled from that function's internals.
    if ground_truth == "glaucoma":
        from sqlalchemy import select
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(ScreeningResult).where(
                    ScreeningResult.screening_id == screening_id,
                    ScreeningResult.llm_used.isnot(None),
                )
            )
            letter_records = result.scalars().all()

        for record in letter_records:
            completeness = calculate_completeness_score(record.referral_letter or "")
            llm_letter_rows.append({
                "scenario": scenario,
                "screening_id": str(screening_id),
                "patient_code": patient_code,
                "llm_used": record.llm_used,
                "referral_letter": record.referral_letter,
                "response_time_seconds": round(float(record.generation_time_ms) / 1000, 3) if record.generation_time_ms else None,
                "prompt_tokens": record.prompt_tokens,
                "completion_tokens": record.completion_tokens,
                "total_tokens": record.total_tokens,
                "completeness_score": completeness,
                "ai_prediction": record.prediction,
                "ai_confidence_score": float(record.confidence_score) if record.confidence_score else None,
                "ohts_score": profile["ohts_score"],
                "ohts_tier": profile["ohts_tier"],
            })
        logger.info(f"[seed_llm] Captured {len(letter_records)} LLM letter records for {patient_code}.")

    return "processed"


async def generate_safe_patient_code(db, patient_uuid: uuid.UUID) -> str:
    # Script-local replacement for app.services.patient_service.generate_patient_code().
    # Keeps the same COUNT(*) + 1 numbering for human readability (so codes
    # still look like PAT00016, PAT00017, ...) but appends the last 5
    # characters of the patient's own UUID as a suffix. This guarantees
    # uniqueness even if COUNT(*) is ever wrong due to rows being deleted
    # directly in the database outside the app's normal soft-delete flow -
    # which is exactly what caused a UniqueViolationError during testing
    # of this script (2 patients had been manually deleted, leaving a gap
    # that made COUNT(*) + 1 recompute an already-used code).
    #
    # Final result looks like: PAT0001636088f
    #   PAT          - same prefix as production codes
    #   00016        - same zero-padded count-based number as before
    #   36088f       - last 5 hex characters of this patient's UUID
    #
    # This does NOT touch or modify app/services/patient_service.py -
    # production patient_code generation is intentionally left exactly
    # as-is, per explicit decision to make no DB/schema changes here.
    from sqlalchemy import select, func
    from app.models.patient import Patient

    result = await db.execute(select(func.count()).select_from(Patient))
    count = result.scalar()

    uuid_suffix = str(patient_uuid).replace("-", "")[-5:]
    return f"PAT{str(count + 1).zfill(5)}{uuid_suffix}"


def calculate_completeness_score(letter_text: str) -> int:
    # Concept-based completeness check, 0-4, scoring whether the letter
    # FUNCTIONALLY covers four expected clinical referral components -
    # NOT a literal header search. Real generated letters use flowing
    # prose ("Dear Colleague, I am writing to refer...") and never include
    # literal section headers like "Findings:" or "Impression:" - confirmed
    # by inspecting real letters during testing. A literal header search
    # would incorrectly score every real letter 0/4 regardless of quality.
    #
    # The 4 concepts checked, each worth 1 point:
    #   1. Findings   - mentions the AI screening flag/finding and a
    #                    confidence/percentage figure
    #   2. Impression  - states a clinical impression or suspicion level
    #                    (e.g. "suspicious", "suggestive of", "raises
    #                    concern", "flagged as")
    #   3. Recommendation - explicitly requests specialist review, further
    #                    evaluation, or assessment
    #   4. Disclaimer  - explicitly states this is NOT a definitive
    #                    diagnosis / is screening-only - this is the
    #                    dimension most likely to actually differ between
    #                    LLMs, confirmed by inspecting real Scenario 4
    #                    output where GPT-4o-mini and LLaMa omitted this
    #                    explicit framing while GPT-4o and Gemini included it.
    #
    # This is intentionally a simple keyword/phrase presence check, not an
    # LLM-graded score - keeps it deterministic, free, and reproducible
    # rather than spending more LLM budget to grade LLM output.

    text_lower = letter_text.lower()
    score = 0

    # 1. Findings - AI flag/finding + a confidence figure
    findings_keywords = ["ai screening", "screening system", "flagged", "confidence score", "%"]
    if any(kw in text_lower for kw in findings_keywords):
        score += 1

    # 2. Impression - suspicion/clinical impression language
    impression_keywords = [
        "suspicious", "suggestive of", "raises concern", "concerning",
        "potential glaucomatous", "presence of glaucoma", "glaucoma-suspicious",
    ]
    if any(kw in text_lower for kw in impression_keywords):
        score += 1

    # 3. Recommendation - explicit request for specialist action
    recommendation_keywords = [
        "specialist review", "further evaluation", "further investigation",
        "request your", "would appreciate your", "comprehensive assessment",
        "specialist opinion", "assess",
    ]
    if any(kw in text_lower for kw in recommendation_keywords):
        score += 1

    # 4. Disclaimer - explicit non-diagnostic / screening-only framing
    disclaimer_keywords = [
        "not a definitive diagnosis", "not constitute a definitive",
        "screening referral", "screening only", "has not made a definitive diagnosis",
        "based solely on the ai screening",
    ]
    if any(kw in text_lower for kw in disclaimer_keywords):
        score += 1

    return score


def parse_args():
    parser = argparse.ArgumentParser(
        description="Seed LLM comparison cases for one scenario at a time (Paper 2 research)."
    )
    parser.add_argument(
        "--scenario",
        type=int,
        required=True,
        choices=[1, 2, 3, 4, 5, 6],
        help="Which scenario to process (1-6). Run one scenario per session to respect Gemini's rate limit.",
    )
    parser.add_argument(
        "--pause-seconds",
        type=float,
        default=0,
        help=(
            "Optional pause (in seconds) inserted AFTER each case completes, "
            "before starting the next one. Default 0 = no pause."
        ),
    )
    parser.add_argument(
        "--start-index",
        type=int,
        default=0,
        help=(
            "Which case to start from within this scenario's case list, "
            "0-indexed. Default 0 = start from the first case. Use this "
            "with --count to process the scenario in batches across "
            "multiple sessions/days - e.g. Scenario 2 has 10 cases: "
            "run --start-index 0 --count 5 today (processes cases 1-5), "
            "then --start-index 5 --count 5 tomorrow (processes cases 6-10)."
        ),
    )
    parser.add_argument(
        "--count",
        type=int,
        default=None,
        help=(
            "How many cases to process starting from --start-index. "
            "Default None = process all remaining cases in the scenario "
            "from --start-index onward (current behaviour if neither "
            "--start-index nor --count is given)."
        ),
    )
    return parser.parse_args()


async def main():
    args = parse_args()
    target_scenario = args.scenario

    all_cases_for_scenario = [c for c in SELECTED_CASES if c["scenario"] == target_scenario]

    # Apply batching slice - default (no args given) processes all cases,
    # same as before this feature existed.
    start = args.start_index
    end = start + args.count if args.count is not None else len(all_cases_for_scenario)
    cases_for_scenario = all_cases_for_scenario[start:end]

    started_at = datetime.now()
    logger.info(f"[seed_llm] Starting LLM comparison seed for SCENARIO {target_scenario} at {started_at}")
    logger.info(
        f"[seed_llm] Scenario {target_scenario} has {len(all_cases_for_scenario)} total cases. "
        f"Processing batch: index {start} to {end - 1} ({len(cases_for_scenario)} cases this run)."
    )

    if not cases_for_scenario:
        logger.warning(
            f"[seed_llm] --start-index {start} is beyond the scenario's case count "
            f"({len(all_cases_for_scenario)}) - nothing to process. Check your "
            f"--start-index/--count values."
        )
        return

    # Load models once - same as discover script, required before any
    # inference can run since this is a standalone script outside the
    # normal FastAPI startup lifespan.
    load_all_models()
    logger.info("[seed_llm] All 3 models loaded and ready.")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    async with AsyncSessionLocal() as db:
        system_user_id = await get_system_user_id(db)
    logger.info(f"[seed_llm] Using SYS00001 user_id={system_user_id} as created_by.")

    summary_rows = []
    llm_letter_rows = []
    failed = []
    processed_count = 0
    skipped_count = 0

    for index, case in enumerate(cases_for_scenario, start=1):
        try:
            status = await process_case(case, system_user_id, summary_rows, llm_letter_rows)
            if status == "processed":
                processed_count += 1
            else:
                skipped_count += 1
        except Exception as e:
            logger.error(f"[seed_llm] FAILED on {case['filename']}: {e}", exc_info=True)
            failed.append({"filename": case["filename"], "error": str(e)})
            continue

        logger.info(f"[seed_llm] Progress: {index}/{len(cases_for_scenario)} cases in scenario {target_scenario} handled.")

        # Optional pause between cases - off by default (pause_seconds=0).
        # Skipped after the very last case since there's nothing after it
        # to wait for. See --pause-seconds help text for when to use this.
        if args.pause_seconds > 0 and index < len(cases_for_scenario):
            logger.info(f"[seed_llm] Pausing {args.pause_seconds}s before next case...")
            await asyncio.sleep(args.pause_seconds)

    # Append to the summary CSV rather than overwriting it, so multiple
    # sessions across different scenarios all accumulate into one file.
    # Write the header only if the file doesn't exist yet.
    file_exists = OUTPUT_CSV_PATH.exists()
    with open(OUTPUT_CSV_PATH, "a", encoding="utf-8", newline="") as f:
        fieldnames = [
            "scenario", "filename", "patient_code", "screening_id", "ground_truth",
            "confidence_score", "ohts_target", "ohts_score", "ohts_tier",
            "iop", "cct", "age_at_screening",
        ]
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        if not file_exists:
            writer.writeheader()
        for row in summary_rows:
            writer.writerow(row)

    # Same append pattern for the per-LLM letter data CSV - this is the raw
    # source file that the separate export_llm_comparison.py script (see
    # below) reads from to build the blind evaluation export and hidden
    # mapping file once all 4 scenarios are done.
    llm_letters_file_exists = LLM_LETTERS_CSV_PATH.exists()
    with open(LLM_LETTERS_CSV_PATH, "a", encoding="utf-8", newline="") as f:
        fieldnames = [
            "scenario", "screening_id", "patient_code", "llm_used", "referral_letter",
            "response_time_seconds", "prompt_tokens", "completion_tokens", "total_tokens",
            "completeness_score", "ai_prediction", "ai_confidence_score",
            "ohts_score", "ohts_tier",
        ]
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        if not llm_letters_file_exists:
            writer.writeheader()
        for row in llm_letter_rows:
            writer.writerow(row)

    finished_at = datetime.now()
    duration = (finished_at - started_at).total_seconds()

    logger.info("=" * 70)
    logger.info(f"[seed_llm] SCENARIO {target_scenario} DONE in {duration / 60:.1f} minutes")
    logger.info(f"[seed_llm] Newly processed this session: {processed_count}")
    logger.info(f"[seed_llm] Skipped (already done previously): {skipped_count}")
    logger.info(f"[seed_llm] Failed: {len(failed)}")
    logger.info(f"[seed_llm] LLM letters captured this session: {len(llm_letter_rows)}")
    logger.info(f"[seed_llm] Case summary CSV (appended) at: {OUTPUT_CSV_PATH}")
    logger.info(f"[seed_llm] Raw LLM letters CSV (appended) at: {LLM_LETTERS_CSV_PATH}")
    logger.info("=" * 70)

    if failed:
        logger.warning(f"[seed_llm] Failed cases this session: {failed}")
        logger.warning(
            f"[seed_llm] These images were NOT moved to scenario{target_scenario}_done/ "
            f"- re-run 'python -m scripts.seed_llm_comparison --scenario {target_scenario}' "
            f"to retry just the failed ones (successful ones will be auto-skipped)."
        )


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception:
        logger.error("[seed_llm] Script crashed:")
        traceback.print_exc()
        sys.exit(1)