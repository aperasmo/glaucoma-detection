# backend/app/ml_inference/ohts.py
#
# OHTS (Ocular Hypertension Treatment Study) Risk Score Calculator.
# Predicts 5-year risk of developing glaucoma from ocular hypertension.
# Based on Kass et al. (2002) and Gordon et al. (2007).
#
# Inputs:
#   - age        : from patient date of birth (always available)
#   - iop        : intraocular pressure in mmHg (optional)
#   - cct        : central corneal thickness in micrometres (optional)
#   - cdr        : cup-to-disc ratio (auto-extracted by segmentation - placeholder)
#   - vcd        : vertical cup-to-disc ratio (auto-extracted by segmentation - placeholder)
#
# Score Tiers (Kass et al. 2002):
#   9-10  : Critical - high risk, immediate referral recommended
#   6-8   : Possible - moderate risk, possible within 5 years
#   1-5   : Low - low risk, routine monitoring
#
# Skip scoring if IOP or CCT is missing - do not guess clinical values.

from datetime import date
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession
from app.utils.settings_helper import get_setting_int

from app.core.logger import get_logger

logger = get_logger(__name__)

def calculate_age(dob: date) -> int:
    # Calculate patient age in years from date of birth.
    today = date.today()
    age = today.year - dob.year
    # Adjust if birthday has not occurred yet this year
    if (today.month, today.day) < (dob.month, dob.day):
        age -= 1
    return age


def calculate_ohts_score(
    age: int,
    iop: Optional[float],
    cct: Optional[float],
    cdr: Optional[float] = None,      # Auto-extracted by segmentation module - plug in when ready
    vcd: Optional[float] = None,      # Vertical cup-to-disc ratio - from segmentation module
    tiers: Optional[dict] = None,
) -> Optional[dict]:
    # Calculate OHTS risk score from available clinical inputs.
    # Returns None if IOP or CCT is missing - never estimate clinical values.
    # CDR and VCD are optional - score is still calculated without them
    # but will be more accurate when segmentation is available.
    #
    # Scoring logic based on Kass et al. (2002) OHTS prediction model.
    # Each factor contributes points to the total risk score.

    # Skip if required clinical values are missing
    if iop is None or cct is None:
        return None

    score = 0

    # --- Age factor ---
    # Older patients carry higher risk
    if age >= 70:
        score += 3
    elif age >= 60:
        score += 2
    elif age >= 50:
        score += 1

    # --- IOP factor (mmHg) ---
    # Higher intraocular pressure = higher risk
    if iop >= 28:
        score += 3
    elif iop >= 26:
        score += 2
    elif iop >= 24:
        score += 1

    # --- CCT factor (micrometres) ---
    # Thinner cornea = higher risk (thinner cornea underestimates true IOP)
    if cct < 520:
        score += 3
    elif cct < 555:
        score += 2
    elif cct < 588:
        score += 1

    # --- CDR factor ---
    # Larger cup-to-disc ratio = higher risk
    # CDR is populated automatically when segmentation module is ready.
    # When segmentation is built, cdr will be passed in from ScreeningResult.
    if cdr is not None:
        if cdr >= 0.8:
            score += 3
        elif cdr >= 0.6:
            score += 2
        elif cdr >= 0.4:
            score += 1

    # --- VCD factor ---
    # Vertical cup-to-disc ratio - additional precision from segmentation.
    # When segmentation is built, vcd will be passed in from ScreeningResult.
    if vcd is not None:
        if vcd >= 0.8:
            score += 1

    # Use database-driven tiers or fall back to defaults
    if tiers is None:
        tiers = {"critical": 9, "possible": 6, "low": 1}

    if score >= tiers["critical"]:
        tier = "critical"
    elif score >= tiers["possible"]:
        tier = "possible"
    else:
        tier = "low"

    return {
        "ohts_score": score,
        "ohts_tier": tier,
        "inputs_used": {
            "age": age,
            "iop": iop,
            "cct": cct,
            "cdr": cdr,           # None until segmentation is built
            "vcd": vcd,           # None until segmentation is built
        },
    }


def get_ohts_result(
    dob: Optional[date],
    iop: Optional[float],
    cct: Optional[float],
    cdr: Optional[float] = None,      # Passed in from segmentation result when available
    vcd: Optional[float] = None,      # Passed in from segmentation result when available
    tiers: Optional[dict] = None,     # Optional dict of tier thresholds - if None, defaults are used
) -> Optional[dict]:
    # Main entry point for OHTS scoring.
    # Called during inference pipeline after ML prediction.
    # Returns None if DOB, IOP, or CCT is missing.

    if dob is None:
        return None

    age = calculate_age(dob)
    return calculate_ohts_score(age, iop, cct, cdr, vcd, tiers)

async def get_ohts_tiers(db: AsyncSession) -> dict:
    # Read OHTS tier boundaries from system settings.
    # Falls back to Kass et al. (2002) defaults if settings are missing.
    return {
        "critical": await get_setting_int(db, "OHTS_TIER_CRITICAL", default=9),
        "possible": await get_setting_int(db, "OHTS_TIER_POSSIBLE", default=6),
        "low": await get_setting_int(db, "OHTS_TIER_LOW", default=1),
    }