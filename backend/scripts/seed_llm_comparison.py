# Follow-up to discover_test_set_confidence.py, for the Paper 2 LLM comparison work.
# Seeds 60 hand-picked real test set images across 6 clinical scenarios, creates a
# real Patient + Screening for each, runs the full inference pipeline (3 models +
# ensemble + Grad-CAM++ + CDR) in research mode, and generates all 4 LLM referral
# letters per case (GPT-4o, GPT-4o-mini, LLaMa, Gemini).
#
# Important: run one scenario per session, not all 60 at once. Gemini's free-tier
# rate limit chokes if you try to push all ~140 LLM calls through in one go, so this
# takes a --scenario arg and only processes that scenario. Do them one at a time
# across separate days as the quota resets, e.g.:
#   docker exec -it glaucoma_backend python -m scripts.seed_llm_comparison --scenario 1
#   docker exec -it glaucoma_backend python -m scripts.seed_llm_comparison --scenario 2
# (scenarios 5 and 6 are normal predictions so they don't cost any LLM calls at all -
# scenarios 1-4 are the glaucoma ones, roughly 4x cases-count calls each)
#
# Once a case finishes successfully its source image gets moved (not copied) out of
# test_images/glaucoma/ or test_images/normal/ into a scenario{N}_done/ subfolder
# right there in the same parent dir, e.g. test_images/glaucoma/scenario1_done/....
# That's just a visual marker of what's been processed - the DB (via the summary
# CSV's screening_id column) is still the real record either way. If a case blows up
# mid-inference its image deliberately stays put, so next time you can just glance at
# what's still sitting in the bare folder to see what needs another attempt.
#
# Worth remembering what's real here vs what's chosen, before touching anything:
# confidence_score, prediction, Grad-CAM++, CDR are all genuine model output from
# discover_test_set_confidence.py actually running the ensemble - nothing's made up.
# The OHTS tier isn't faked either - we generate a plausible IOP/CCT/age profile and
# run it through the actual get_ohts_result() (same function prod uses), checking it
# really lands in the target tier before keeping it; if not we just try another
# candidate. What we do choose is which image goes in which scenario bucket, based on
# the real confidence_score from the discovery CSV (see SELECTED_CASES) - that's
# selection, not fabrication.
#
# Heads up: this script writes to the database for real. Creates actual Patient,
# Screening, and ScreeningResult rows - obviously synthetic (NZ-style names) but they
# sit right alongside normal demo data unless you point this at a separate Paper 2
# DB copy. It doesn't care which DB it's pointed at, just uses whatever DATABASE_URL
# the container has at the time.
#
# Also not idempotent by filename - running the same scenario twice makes MORE
# patients/screenings/LLM calls for the same images, it won't just skip them. The
# scenario{N}_done move is what protects you here: once an image's been moved there,
# re-running that scenario finds nothing left in the bare folder and skips with a
# warning. Don't manually move files back unless you mean to redo them.
#
# Source images live in backend/test_images/glaucoma|normal/*.jpg|png, and processed
# ones end up under .../scenario{N}_done/. The summary CSV gets appended to (not
# overwritten) at backend/scripts/output/llm_comparison_seed_summary.csv, so today's
# scenario 1 run and tomorrow's scenario 2 run both land in the same file - columns
# are scenario, filename, patient_code, screening_id, ground_truth, confidence_score,
# ohts_target, ohts_score, ohts_tier, iop, cct, age_at_screening. That CSV is what you
# use to look up which screening_id belongs to which case for the comparison tool.
#
# To change which images are used, edit SELECTED_CASES below - each entry needs
# filename, label (0=normal/1=glaucoma, has to match the actual subfolder), dataset
# (just for traceability), and scenario. IOP/CCT/age ranges are in REALISTIC_RANGES,
# and MAX_PROFILE_ATTEMPTS controls how many random profiles it'll try before giving
# up on hitting a target tier.

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
# deliberately not importing generate_patient_code from patient_service here -
# it uses COUNT(*) + 1, which collides with an existing code if rows were ever
# manually deleted from the DB (bypassing the app's soft-delete). Actually hit
# this collision once while testing. Didn't want to touch patient_service.py
# for a research script, so there's a local generator below instead that keeps
# the same COUNT(*) + 1 numbering but tacks on 5 chars of the patient's UUID
# so it can't collide no matter what gaps exist in the count.

logger = get_logger(__name__)

# same path setup pattern as discover_test_set_confidence.py
TEST_IMAGES_ROOT = Path(settings.TEST_IMAGES_DIR)
GLAUCOMA_SUBDIR = TEST_IMAGES_ROOT / "glaucoma"
NORMAL_SUBDIR = TEST_IMAGES_ROOT / "normal"

OUTPUT_DIR = Path(__file__).parent / "output"
OUTPUT_CSV_PATH = OUTPUT_DIR / "llm_comparison_seed_summary.csv"
LLM_LETTERS_CSV_PATH = OUTPUT_DIR / "llm_comparison_letters_raw.csv"

# placeholder for the SYSTEM user_id used as created_by - filled in later in
# main() once we look it up. If SYS00001's user_id ever changes you can check
# it with: SELECT user_id FROM users WHERE user_code = 'SYS00001';
SYSTEM_USER_ID = None

# same ranges admin.py's generate_nz_patient() uses for the regular demo seed -
# kept consistent so this isn't some special range just invented for this script
REALISTIC_RANGES = {
    "age_years": (40, 80),     # patient age range
    "iop": (18.0, 32.0),       # mmHg
    "cct": (480.0, 600.0),     # micrometres
}

MAX_PROFILE_ATTEMPTS = 500  # how many random candidates to try before giving up on hitting a target tier

# the 60 cases, pulled straight from
# backend/scripts/output/test_set_confidence_discovery.csv - confidence_score
# here is the real ensemble output from the discovery pass, just carried over
# for reference in the summary CSV, not recomputed
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
    # Scenario 7: false positives - model said glaucoma but ground truth is normal, n=10.
    # These are the scary ones clinically - a referral letter goes out for someone who
    # doesn't actually have glaucoma. Added later for Assessment 3 / Paper 2 to see how
    # the LLMs handle false-alarm referrals. Spread across confidence bands: 4 high-conf
    # (>=0.70, model was very wrong and very sure), 3 mid-conf (0.55-0.70), 3 borderline
    # (<0.55, barely tipped over the glaucoma threshold). OHTS profiles reuse the same
    # critical/low/none split as scenarios 1-4 so LLM behaviour is comparable across
    # scenarios. All from the locked 415-image test set, none reused from scenarios 1-6.
    {"filename": "r3_N-51-L_left_half.png", "label": 0, "dataset": "RIM-ONE-DL", "scenario": 7, "confidence_score": 0.9892, "ohts_target": "critical"},
    {"filename": "531.jpg",                  "label": 0, "dataset": "ORIGA",      "scenario": 7, "confidence_score": 0.8869, "ohts_target": "critical"},
    {"filename": "590.jpg",                  "label": 0, "dataset": "ORIGA",      "scenario": 7, "confidence_score": 0.8768, "ohts_target": "low"},
    {"filename": "629.jpg",                  "label": 0, "dataset": "ORIGA",      "scenario": 7, "confidence_score": 0.8554, "ohts_target": "low"},
    {"filename": "V0046.jpg",                "label": 0, "dataset": "REFUGE",     "scenario": 7, "confidence_score": 0.6967, "ohts_target": "critical"},
    {"filename": "022.jpg",                  "label": 0, "dataset": "ORIGA",      "scenario": 7, "confidence_score": 0.6859, "ohts_target": None},
    {"filename": "image_1553.jpg",           "label": 0, "dataset": "G1020",      "scenario": 7, "confidence_score": 0.6548, "ohts_target": None},
    {"filename": "image_492.jpg",            "label": 0, "dataset": "G1020",      "scenario": 7, "confidence_score": 0.5448, "ohts_target": "low"},
    {"filename": "image_236.jpg",            "label": 0, "dataset": "G1020",      "scenario": 7, "confidence_score": 0.5431, "ohts_target": None},
    {"filename": "418.jpg",                  "label": 0, "dataset": "ORIGA",      "scenario": 7, "confidence_score": 0.5412, "ohts_target": "critical"},
]

assert len(SELECTED_CASES) == 70, f"Expected 70 cases, found {len(SELECTED_CASES)} - check SELECTED_CASES list."

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
    # hunts for a realistic IOP/CCT/age combo that actually lands in the target
    # OHTS tier when run through the real get_ohts_result() (same one prod uses).
    # target_tier is "critical", "low", or None (scenario 4 - no OHTS at all).
    # returns {dob, iop, cct, ohts_score, ohts_tier}, with score/tier None when
    # target_tier is None.

    if target_tier is None:
        # scenario 4 - data's genuinely missing, not computed
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

        # real scoring function, default Kass et al. (2002) tiers. CDR/VCD stay
        # None here since prod doesn't feed segmentation output into OHTS yet
        # (that's a locked design decision, not an oversight)
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


def generate_nz_patient_identity(scenario: int, case_number: int) -> dict:
    # first/last name are just "Patient{N} Scenario{N}" instead of random NZ
    # names, so every patient is instantly identifiable in the DB/CSV without
    # cross-referencing anything - the 3rd patient in scenario 2 is always
    # "Patient3 Scenario2".
    first_name = f"Patient{case_number}"
    last_name = f"Scenario{scenario}"
    gender = random.choice(["male", "female"])
    mobile = f"{random.choice(NZ_AREA_CODES)}{random.randint(1000000, 9999999)}"
    return {
        "first_name": first_name,
        "last_name": last_name,
        "gender": gender,
        "mobile_number": mobile,
        "email": f"{first_name.lower()}.{last_name.lower()}@email.com",
    }


def resolve_image_path(filename: str, label: int) -> Path | None:
    # only checks the bare glaucoma/ or normal/ folder, never the
    # scenario{N}_done/ subfolders. if a previous run already moved the file
    # there, this returns None, and process_case() reads that as "already
    # done, skip" rather than an error - that's what makes re-running a
    # finished scenario safe.
    subdir = GLAUCOMA_SUBDIR if label == 1 else NORMAL_SUBDIR
    candidate = subdir / filename
    return candidate if candidate.exists() else None


def move_to_scenario_done(image_path: Path, label: int, scenario: int) -> None:
    # moves a finished image into scenario{N}_done/ under the same parent
    # folder (glaucoma stays with glaucoma, normal stays with normal) - just a
    # visual marker, the DB is still what actually matters
    subdir = GLAUCOMA_SUBDIR if label == 1 else NORMAL_SUBDIR
    done_dir = subdir / f"scenario{scenario}_done"
    done_dir.mkdir(parents=True, exist_ok=True)

    import shutil
    destination = done_dir / image_path.name
    shutil.move(str(image_path), str(destination))
    logger.info(f"[seed_llm] Moved processed image to: {destination}")


async def get_system_user_id(db) -> uuid.UUID:
    # look up SYS00001's real user_id instead of hardcoding a UUID guess - still
    # works even if the DB got reset and SYS00001 was recreated with a new one
    from sqlalchemy import select
    from app.models.user import User

    result = await db.execute(select(User).where(User.user_code == "SYS00001"))
    user = result.scalar_one_or_none()
    if not user:
        raise RuntimeError(
            "SYS00001 user not found. Run 'python -m app.db.seed' first to create it."
        )
    return user.user_id


async def process_case(case: dict, system_user_id: uuid.UUID, summary_rows: list, llm_letter_rows: list, case_number: int) -> str:
    # returns "processed" or "skipped_already_done", or just raises if something real fails
    filename = case["filename"]
    label = case["label"]
    scenario = case["scenario"]
    ground_truth = "glaucoma" if label == 1 else "normal"

    image_path = resolve_image_path(filename, label)
    if image_path is None:
        # either the file genuinely doesn't exist, or it's already sitting in
        # scenario{N}_done/ from a previous run - either way nothing to do here,
        # just log which one it was and move on
        done_check = (GLAUCOMA_SUBDIR if label == 1 else NORMAL_SUBDIR) / f"scenario{scenario}_done" / filename
        if done_check.exists():
            logger.info(f"[seed_llm] SKIP - already processed in a previous session: {filename}")
        else:
            logger.warning(f"[seed_llm] SKIP - file not found anywhere: {filename} (label={ground_truth})")
        return "skipped_already_done"

    profile = find_profile_for_target_tier(case["ohts_target"])
    identity = generate_nz_patient_identity(scenario, case_number)

    async with AsyncSessionLocal() as db:
        # create the patient. generating the UUID ourselves here instead of
        # letting SQLAlchemy's default=uuid.uuid4 handle it at flush time,
        # because we need the value up front to build the collision-safe
        # patient_code (see generate_safe_patient_code below)
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

        # now the screening record, and copy the image into uploads/screenings
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

    # run the full pipeline, forced into research mode regardless of the global
    # INFERENCE_MODE setting - the whole point of this run is getting all 4 LLM
    # letters for every case
    async with AsyncSessionLocal() as db:
        await run_inference_pipeline(
            screening_id=screening_id,
            image_path=upload_path,
            db=db,
            created_by=system_user_id,
            mode="research",
        )

    # only move the source image once inference has actually succeeded - if it
    # threw above we never get here, so the image just stays put as a visible
    # sign this case still needs another go
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

    # if this case produced LLM letters, pull the saved records back out of the
    # DB and log per-LLM stats for the comparison study - response time, token
    # counts, completeness_score. reading it back after the fact rather than
    # capturing inline because run_inference_pipeline() owns the actual save,
    # and this keeps the script from depending on its internals.
    # checking the actual model prediction here, not ground_truth - scenario 7's
    # false positives have ground_truth=normal but the model predicts glaucoma
    # and does generate letters, so checking ground_truth would silently drop
    # their CSV rows
    async with AsyncSessionLocal() as db:
        from sqlalchemy import select
        result = await db.execute(
            select(ScreeningResult).where(
                ScreeningResult.screening_id == screening_id,
                ScreeningResult.model_used == "ensemble",
                ScreeningResult.llm_used.is_(None),
                ScreeningResult.letter_type.is_(None),
            )
        )
        ensemble_check = result.scalar_one_or_none()
    actual_prediction = ensemble_check.prediction if ensemble_check else ground_truth

    if actual_prediction == "glaucoma":
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
    # local stand-in for patient_service.generate_patient_code(). keeps the
    # same COUNT(*) + 1 numbering so codes still read like PAT00016, PAT00017,
    # but tacks on the last 5 chars of the patient's UUID so it can't collide
    # even if COUNT(*) is off because rows got deleted outside the app's normal
    # soft-delete flow. that's not hypothetical - it's exactly what caused a
    # UniqueViolationError while testing this (2 patients had been manually
    # deleted, leaving a gap that made COUNT(*) + 1 land on an already-used code).
    # ends up looking like PAT0001636088f - PAT prefix, 00016 same as before,
    # 36088f being the UUID suffix. doesn't touch patient_service.py itself -
    # production code generation stays exactly as-is on purpose.
    from sqlalchemy import select, func
    from app.models.patient import Patient

    result = await db.execute(select(func.count()).select_from(Patient))
    count = result.scalar()

    uuid_suffix = str(patient_uuid).replace("-", "")[-5:]
    return f"PAT{str(count + 1).zfill(5)}{uuid_suffix}"


def calculate_completeness_score(letter_text: str) -> int:
    # scores 0-4 based on whether the letter functionally covers four expected
    # referral components - not a literal header search. real letters are
    # flowing prose ("Dear Colleague, I am writing to refer...") and never use
    # headers like "Findings:" or "Impression:", confirmed by actually reading
    # real letters, so a literal search would score everything 0/4 no matter
    # how good it is.
    #
    # the four things checked, one point each: findings (mentions the AI
    # flag/finding plus a confidence number), impression (states a suspicion
    # level - "suspicious", "suggestive of", "raises concern", etc),
    # recommendation (explicitly asks for specialist review/further
    # evaluation), and disclaimer (explicitly says this isn't a definitive
    # diagnosis / is screening-only - this last one's the one that actually
    # seems to vary between LLMs, GPT-4o-mini and LLaMa dropped it in some
    # scenario 4 letters while GPT-4o and Gemini kept it).
    #
    # deliberately just a keyword/phrase check rather than an LLM-graded
    # score - keeps it deterministic, free, and reproducible instead of
    # burning more LLM budget grading LLM output.

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
        choices=[1, 2, 3, 4, 5, 6, 7],
        help="Which scenario to process (1-7). Run one scenario per session to respect Gemini's rate limit.",
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
    parser.add_argument(
        "--filename",
        type=str,
        default=None,
        help=(
            "Optional filename to retry a single specific failed case within "
            "the scenario, e.g. --filename r3_G-31-R_left_half.png. "
            "When specified, only that one case is processed and all others "
            "are skipped regardless of --start-index or --count. "
            "Use this when one image failed (e.g. OHTS profile generation "
            "error) and you want to retry just that one without re-running "
            "the entire scenario. The image must still be in the bare "
            "test_images folder (not in scenario_done/) for this to work."
        ),
    )
    return parser.parse_args()


async def main():
    args = parse_args()
    target_scenario = args.scenario

    all_cases_for_scenario = [c for c in SELECTED_CASES if c["scenario"] == target_scenario]

    # --filename retries just one failed case, overrides --start-index/--count entirely
    if args.filename:
        matched = [c for c in all_cases_for_scenario if c["filename"] == args.filename]
        if not matched:
            logger.error(
                f"[seed_llm] --filename \'{args.filename}\' not found in Scenario {target_scenario} "
                f"SELECTED_CASES. Check the filename spelling and scenario number."
            )
            return
        cases_for_scenario = matched
        logger.info(
            f"[seed_llm] --filename mode: retrying single case \'{args.filename}\' "
            f"in Scenario {target_scenario}."
        )
    else:
        # batching slice - with no args given this just processes everything,
        # same as before this feature existed
        start = args.start_index
        end = start + args.count if args.count is not None else len(all_cases_for_scenario)
        cases_for_scenario = all_cases_for_scenario[start:end]

    started_at = datetime.now()
    logger.info(f"[seed_llm] Starting LLM comparison seed for SCENARIO {target_scenario} at {started_at}")
    logger.info(
        f"[seed_llm] Scenario {target_scenario} has {len(all_cases_for_scenario)} total cases. "
        f"Processing {len(cases_for_scenario)} case(s) this run."
    )

    if not cases_for_scenario:
        logger.warning(
            f"[seed_llm] No cases to process. Check your --start-index/--count/--filename values."
        )
        return

    # load models once, same as the discover script - needed before inference
    # can run at all since this is standalone, outside the normal FastAPI startup
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
            status = await process_case(case, system_user_id, summary_rows, llm_letter_rows, index)
            if status == "processed":
                processed_count += 1
            else:
                skipped_count += 1
        except Exception as e:
            logger.error(f"[seed_llm] FAILED on {case['filename']}: {e}", exc_info=True)
            failed.append({"filename": case["filename"], "error": str(e)})
            continue

        logger.info(f"[seed_llm] Progress: {index}/{len(cases_for_scenario)} cases in scenario {target_scenario} handled.")

        # optional pause between cases, off by default. skip it after the last
        # case since there's nothing left to wait for
        if args.pause_seconds > 0 and index < len(cases_for_scenario):
            logger.info(f"[seed_llm] Pausing {args.pause_seconds}s before next case...")
            await asyncio.sleep(args.pause_seconds)

    # append rather than overwrite so different sessions/scenarios all pile
    # into the same file - only write the header if it's not there yet
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

    # same append pattern for the per-LLM letter CSV - this is the raw file
    # export_llm_comparison.py later reads to build the blind evaluation
    # export and hidden mapping once all scenarios are done
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