# OHTS risk score calc - estimates 5-year risk of developing glaucoma from
# ocular hypertension, based on Kass et al. (2002) and Gordon et al. (2007).
#
# inputs: age (from DOB, always available), iop and cct (optional, mmHg /
# micrometres), and cdr/vcd which are still placeholders until the
# segmentation module is built.
#
# tiers per Kass et al. 2002: 9-10 critical (refer immediately), 6-8 possible
# (moderate risk within 5 years), 1-5 low (routine monitoring).
#
# if IOP or CCT is missing we just skip scoring entirely - not going to guess
# clinical values.

from datetime import date
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession
from app.utils.settings_helper import get_setting_int

from app.core.logger import get_logger

logger = get_logger(__name__)

def calculate_age(dob: date) -> int:
    today = date.today()
    age = today.year - dob.year
    # hasn't hit their birthday yet this year, so knock a year off
    if (today.month, today.day) < (dob.month, dob.day):
        age -= 1
    return age


def calculate_ohts_score(
    age: int,
    iop: Optional[float],
    cct: Optional[float],
    cdr: Optional[float] = None,      # from segmentation module once it's plugged in
    vcd: Optional[float] = None,      # vertical cup-to-disc ratio, also from segmentation
    tiers: Optional[dict] = None,
) -> Optional[dict]:
    # implements the Kass et al. (2002) scoring model - each factor below adds
    # points toward the total. bails out with None if IOP or CCT is missing
    # since we won't guess those. CDR/VCD are optional, score just gets less
    # precise without them until segmentation is wired up.

    if iop is None or cct is None:
        return None

    score = 0

    # older = higher risk
    if age >= 70:
        score += 3
    elif age >= 60:
        score += 2
    elif age >= 50:
        score += 1

    # higher IOP (mmHg) = higher risk
    if iop >= 28:
        score += 3
    elif iop >= 26:
        score += 2
    elif iop >= 24:
        score += 1

    # thinner cornea = higher risk, since it underestimates true IOP
    if cct < 520:
        score += 3
    elif cct < 555:
        score += 2
    elif cct < 588:
        score += 1

    # bigger cup-to-disc ratio = higher risk - stays None until segmentation
    # passes a real value in from ScreeningResult
    if cdr is not None:
        if cdr >= 0.8:
            score += 3
        elif cdr >= 0.6:
            score += 2
        elif cdr >= 0.4:
            score += 1

    # vertical CDR adds a bit more precision once segmentation provides it
    if vcd is not None:
        if vcd >= 0.8:
            score += 1

    # DB-configured tiers if we have them, otherwise the defaults
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
            "cdr": cdr,           # still None until segmentation exists
            "vcd": vcd,           # same here
        },
    }


def get_ohts_result(
    dob: Optional[date],
    iop: Optional[float],
    cct: Optional[float],
    cdr: Optional[float] = None,      # from segmentation result, if we have one
    vcd: Optional[float] = None,      # from segmentation result, if we have one
    tiers: Optional[dict] = None,     # tier thresholds, falls back to defaults if None
) -> Optional[dict]:
    # entry point called from the inference pipeline after the ML prediction -
    # returns None if DOB, IOP, or CCT is missing

    if dob is None:
        return None

    age = calculate_age(dob)
    return calculate_ohts_score(age, iop, cct, cdr, vcd, tiers)

async def get_ohts_tiers(db: AsyncSession) -> dict:
    # pulls tier boundaries from system settings, falls back to Kass et al.
    # (2002) defaults if they're not set
    return {
        "critical": await get_setting_int(db, "OHTS_TIER_CRITICAL", default=9),
        "possible": await get_setting_int(db, "OHTS_TIER_POSSIBLE", default=6),
        "low": await get_setting_int(db, "OHTS_TIER_LOW", default=1),
    }