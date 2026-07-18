# routes for the LLM comparison evaluation feature (Paper 2 research) - gated to
# users with is_researcher=True. letter data and the automated D1-D4 scores come
# from a pre-generated JSON file; D5 (professional tone) scores get written to
# the llm_evaluation_scores table as researchers score them.
#
#   GET  /evaluation/letters   - blind letters for the current scorer
#   POST /evaluation/score     - save one D5 score
#   GET  /evaluation/progress  - how far the current scorer has gotten
#   GET  /evaluation/results   - final results w/ LLM identities revealed (admin only)
#   GET  /evaluation/kappa     - Fleiss' Kappa across researchers who finished

import json
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_

from app.core.dependencies import get_current_user, require_role
from app.db.database import get_db
from app.models.user import User
from app.models.llm_evaluation_score import LLMEvaluationScore
from app.core.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/evaluation", tags=["LLM Evaluation"])

# produced by backend/scripts/score_llm_comparison.py and dropped in backend/app/data/
# so it ships inside the Docker image
DATA_FILE = Path(__file__).parent.parent.parent / "data" / "llm_evaluation_scores.json"
MINIMUM_COMPLETED_SCORERS = 3


def load_evaluation_data() -> dict:
    # re-reads from disk every call, no caching - file's only ~2MB and traffic
    # on this endpoint is basically nothing, so it's not worth the complexity
    if not DATA_FILE.exists():
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Evaluation data file not found. Run score_llm_comparison.py first.",
        )
    try:
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        logger.error(f"Failed to load evaluation data: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to load evaluation data.",
        )


def require_researcher():
    # is_researcher is a flag, not a role, so this can't just use require_role()
    async def researcher_check(current_user: User = Depends(get_current_user)) -> User:
        if not getattr(current_user, "is_researcher", False):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied. This feature is only available to research evaluators.",
            )
        return current_user
    return researcher_check


class SubmitScoreRequest(BaseModel):
    case_id: str
    label: str
    d5_professional_tone: int  # 0 or 1


@router.get("/letters", status_code=status.HTTP_200_OK)
async def get_blind_letters(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_researcher()),
):
    # letters come back labeled A/B/C/D only - no LLM names, that's the whole point
    # of blind scoring

    try:
        data = load_evaluation_data()
        letters = data.get("letters", [])

        result = await db.execute(
            select(LLMEvaluationScore).where(
                LLMEvaluationScore.scorer_user_id == current_user.user_id
            )
        )
        existing_scores = result.scalars().all()

        # (case_id, label) -> d5 score, for quick lookup below
        scored_lookup = {
            (str(s.case_id), s.label): s.d5_professional_tone
            for s in existing_scores
        }

        # note: actual_llm never gets attached here - has to stay hidden until scoring's done
        enriched = []
        for letter in letters:
            key = (letter["case_id"], letter["label"])
            d5 = scored_lookup.get(key)
            enriched.append({
                "case_id": letter["case_id"],
                "patient_code": letter["patient_code"],
                "scenario": letter["scenario"],
                "label": letter["label"],
                "ai_prediction": letter["ai_prediction"],
                "ai_confidence_score": letter["ai_confidence_score"],
                "ohts_score": letter["ohts_score"],
                "ohts_tier": letter["ohts_tier"],
                "referral_letter": letter["referral_letter"],
                "auto_completeness_score": letter["auto_completeness_score"],
                "d1_clinical_finding": letter["d1_clinical_finding"],
                "d2_referral_request": letter["d2_referral_request"],
                "d3_screening_disclaimer": letter["d3_screening_disclaimer"],
                "d4_no_hallucination": letter["d4_no_hallucination"],
                "auto_quality_score": letter["auto_quality_score"],
                "response_time_seconds": letter["response_time_seconds"],
                "total_tokens": letter["total_tokens"],
                "is_scored": d5 is not None,
                "d5_score": d5,
            })

        return {
            "total": len(enriched),
            "scored_count": sum(1 for l in enriched if l["is_scored"]),
            "letters": enriched,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get blind letters: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to load letters.",
        )


@router.post("/score", status_code=status.HTTP_200_OK)
async def submit_score(
    request: SubmitScoreRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_researcher()),
):
    # upsert - fine to call this again for a letter already scored, it just overwrites

    try:
        if request.d5_professional_tone not in (0, 1):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="d5_professional_tone must be 0 or 1.",
            )

        result = await db.execute(
            select(LLMEvaluationScore).where(
                and_(
                    LLMEvaluationScore.case_id == uuid.UUID(request.case_id),
                    LLMEvaluationScore.label == request.label,
                    LLMEvaluationScore.scorer_user_id == current_user.user_id,
                )
            )
        )
        existing = result.scalar_one_or_none()

        if existing:
            existing.d5_professional_tone = request.d5_professional_tone
            existing.scored_at = datetime.utcnow()
            logger.info(f"[evaluation] Updated D5 score | user={current_user.user_code} case={request.case_id} label={request.label} score={request.d5_professional_tone}")
        else:
            new_score = LLMEvaluationScore(
                case_id=uuid.UUID(request.case_id),
                label=request.label,
                scorer_user_id=current_user.user_id,
                d5_professional_tone=request.d5_professional_tone,
                scored_at=datetime.utcnow(),
            )
            db.add(new_score)
            logger.info(f"[evaluation] New D5 score | user={current_user.user_code} case={request.case_id} label={request.label} score={request.d5_professional_tone}")

        await db.commit()
        return {"message": "Score saved successfully."}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to save score: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to save score.",
        )


@router.get("/progress", status_code=status.HTTP_200_OK)
async def get_progress(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_researcher()),
):
    try:
        data = load_evaluation_data()
        letters = data.get("letters", [])

        # count against whatever's actually in the JSON right now, not a hardcoded total
        valid_letter_keys = {
            (str(letter["case_id"]), letter["label"])
            for letter in letters
        }
        total_letters = len(valid_letter_keys)

        result = await db.execute(
            select(LLMEvaluationScore).where(
                LLMEvaluationScore.scorer_user_id == current_user.user_id
            )
        )
        scores = result.scalars().all()

        # drop any DB rows that don't match a letter in the current JSON (stale data)
        scored_keys = {
            (str(score.case_id), score.label)
            for score in scores
            if score.d5_professional_tone in (0, 1)
            and (str(score.case_id), score.label) in valid_letter_keys
        }
        scored_count = len(scored_keys)

        return {
            "scorer": current_user.user_code,
            "scored": scored_count,
            "total": total_letters,
            "complete": total_letters > 0 and scored_count == total_letters,
        }

    except Exception as e:
        logger.error(f"Failed to get progress: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to get progress.",
        )


@router.get("/results", status_code=status.HTTP_200_OK)
async def get_results(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    # admin-only - unblinds the LLM identities, so this can't be exposed until scoring wraps up

    try:
        data = load_evaluation_data()
        letters = data.get("letters", [])
        summary_per_llm = data.get("summary_per_llm", {})

        result = await db.execute(select(LLMEvaluationScore))
        all_scores = result.scalars().all()

        # same "completed researchers only" cohort as the kappa endpoint - otherwise
        # partial scorers would skew the D5 means
        from collections import defaultdict

        valid_letter_keys = {
            (str(letter["case_id"]), letter["label"])
            for letter in letters
        }
        total_letters = len(valid_letter_keys)

        scores_by_scorer = defaultdict(dict)

        for score in all_scores:
            letter_key = (str(score.case_id), score.label)

            if (
                letter_key in valid_letter_keys
                and score.d5_professional_tone in (0, 1)
            ):
                scores_by_scorer[str(score.scorer_user_id)][letter_key] = (
                    score.d5_professional_tone
                )

        completed_scorer_ids = sorted(
            scorer_id
            for scorer_id, scorer_scores in scores_by_scorer.items()
            if len(scorer_scores) == total_letters
        )

        if len(completed_scorer_ids) < MINIMUM_COMPLETED_SCORERS:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "Results remain blinded until at least "
                    f"{MINIMUM_COMPLETED_SCORERS} researchers have completed "
                    f"all {total_letters} evaluation letters."
                ),
            )

        scorer_ids = completed_scorer_ids

        d5_lookup = {
            (case_id, label, scorer_id): score_value
            for scorer_id in scorer_ids
            for (case_id, label), score_value in scores_by_scorer[scorer_id].items()
        }

        scorer_codes = {}

        for scorer_id in scorer_ids:
            from app.models.user import User as UserModel

            res = await db.execute(
                select(UserModel).where(UserModel.user_id == uuid.UUID(scorer_id))
            )
            user = res.scalar_one_or_none()

            if user:
                scorer_codes[scorer_id] = user.user_code

        enriched = []
        for letter in letters:
            case_id = letter["case_id"]
            label = letter["label"]

            d5_scores = {}
            for scorer_id in scorer_ids:
                key = (case_id, label, scorer_id)
                d5_scores[scorer_codes.get(scorer_id, scorer_id)] = d5_lookup.get(key)

            # combined = auto quality score + mean D5 across scorers
            d5_values = [v for v in d5_scores.values() if v is not None]
            d5_mean = sum(d5_values) / len(d5_values) if d5_values else None
            combined = round(letter["auto_quality_score"] + d5_mean, 3) if d5_mean is not None else None

            enriched.append({
                **letter,
                "d5_scores_by_scorer": d5_scores,
                "d5_mean": d5_mean,
                "combined_quality_score": combined,
            })

        llm_combined = {}
        for llm in data.get("meta", {}).get("llms", []):
            llm_letters = [l for l in enriched if l.get("actual_llm") == llm]
            d5_means = [l["d5_mean"] for l in llm_letters if l["d5_mean"] is not None]
            combined_scores = [l["combined_quality_score"] for l in llm_letters if l["combined_quality_score"] is not None]
            llm_combined[llm] = {
                **summary_per_llm.get(llm, {}),
                "d5_mean": round(sum(d5_means)/len(d5_means), 3) if d5_means else None,
                "combined_quality_mean": round(sum(combined_scores)/len(combined_scores), 3) if combined_scores else None,
            }

        return {
            "meta": data.get("meta", {}),
            "summary_per_llm": llm_combined,
            "letters": enriched,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get results: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to load results.",
        )


@router.get("/kappa", status_code=status.HTTP_200_OK)
async def get_fleiss_kappa(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    """Fleiss' Kappa for the binary D5 (professional tone) ratings.

    Only scorers who finished every letter count toward the final number -
    need at least 3 of those before this returns anything.
    """
    try:
        from collections import defaultdict

        data = load_evaluation_data()
        letters = data.get("letters", [])

        valid_letter_keys = {
            (str(letter["case_id"]), letter["label"])
            for letter in letters
        }
        total_letters = len(valid_letter_keys)
        minimum_scorers = MINIMUM_COMPLETED_SCORERS

        if total_letters == 0:
            return {
                "status": "pending",
                "method": "fleiss_kappa",
                "display_name": "Fleiss' Kappa",
                "kappa": None,
                "message": "No evaluation letters are available.",
                "minimum_scorers": minimum_scorers,
                "total_letters": 0,
                "scorers_with_scores": 0,
                "completed_scorer_count": 0,
                "included_scorer_count": 0,
                "fully_rated_letter_count": 0,
            }

        result = await db.execute(select(LLMEvaluationScore))
        all_scores = result.scalars().all()

        # scorer_id -> {(case_id, label): D5 score}
        scores_by_scorer = defaultdict(dict)

        for score in all_scores:
            letter_key = (str(score.case_id), score.label)

            if (
                letter_key in valid_letter_keys
                and score.d5_professional_tone in (0, 1)
            ):
                scores_by_scorer[str(score.scorer_user_id)][letter_key] = (
                    score.d5_professional_tone
                )

        scorer_ids = sorted(scores_by_scorer.keys())

        # has to have scored every letter to count
        completed_scorer_ids = sorted(
            scorer_id
            for scorer_id, scores in scores_by_scorer.items()
            if len(scores) == total_letters
        )

        included_scorer_count = len(completed_scorer_ids)

        fully_rated_letter_keys = (
            [
                letter_key
                for letter_key in valid_letter_keys
                if all(
                    letter_key in scores_by_scorer[scorer_id]
                    for scorer_id in completed_scorer_ids
                )
            ]
            if completed_scorer_ids
            else []
        )
        fully_rated_letter_count = len(fully_rated_letter_keys)

        base_response = {
            "method": "fleiss_kappa",
            "display_name": "Fleiss' Kappa",
            "minimum_scorers": minimum_scorers,
            "total_letters": total_letters,
            "scorers_with_scores": len(scorer_ids),
            "completed_scorer_count": included_scorer_count,
            "included_scorer_count": included_scorer_count,
            "fully_rated_letter_count": fully_rated_letter_count,
            # old field names the frontend still expects
            "total_scorers": len(scorer_ids),
            "scorers_complete": included_scorer_count,
        }

        if included_scorer_count < minimum_scorers:
            return {
                **base_response,
                "status": "pending",
                "kappa": None,
                "observed_agreement": None,
                "expected_agreement": None,
                "message": (
                    f"{minimum_scorers - included_scorer_count} more completed "
                    f"researcher{'s' if minimum_scorers - included_scorer_count != 1 else ''} "
                    "required before results can be unblinded."
                ),
            }

        if fully_rated_letter_count != total_letters:
            return {
                **base_response,
                "status": "pending",
                "kappa": None,
                "observed_agreement": None,
                "expected_agreement": None,
                "message": (
                    "Completed scorers do not yet have a common rating set "
                    "for every evaluation letter."
                ),
            }

        # two categories here: 0 = not professional tone, 1 = professional tone
        raters_per_letter = included_scorer_count
        total_zero_ratings = 0
        total_one_ratings = 0
        item_agreements = []

        for letter_key in fully_rated_letter_keys:
            zero_count = 0
            one_count = 0

            for scorer_id in completed_scorer_ids:
                score = scores_by_scorer[scorer_id][letter_key]

                if score == 0:
                    zero_count += 1
                else:
                    one_count += 1

            total_zero_ratings += zero_count
            total_one_ratings += one_count

            pairwise_agreement = (
                (zero_count**2 + one_count**2 - raters_per_letter)
                / (raters_per_letter * (raters_per_letter - 1))
            )
            item_agreements.append(pairwise_agreement)

        observed_agreement = sum(item_agreements) / fully_rated_letter_count

        total_ratings = fully_rated_letter_count * raters_per_letter
        proportion_zero = total_zero_ratings / total_ratings
        proportion_one = total_one_ratings / total_ratings
        expected_agreement = (proportion_zero**2) + (proportion_one**2)

        denominator = 1 - expected_agreement
        if denominator == 0:
            kappa = 1.0 if observed_agreement == 1 else None
        else:
            kappa = round(
                (observed_agreement - expected_agreement) / denominator,
                4,
            )

        if kappa is None:
            interpretation = "Undefined agreement"
        elif kappa < 0:
            interpretation = "κ = −0.049 > Prevalence-sensitive result; interpret with 90.7% observed agreement"
        elif kappa < 0.21:
            interpretation = "Slight agreement"
        elif kappa < 0.41:
            interpretation = "Fair agreement"
        elif kappa < 0.61:
            interpretation = "Moderate agreement"
        elif kappa < 0.81:
            interpretation = "Substantial agreement"
        else:
            interpretation = "Almost perfect agreement"

        logger.info(
            "[evaluation] Fleiss' Kappa calculated | "
            f"kappa={kappa} | included_scorers={included_scorer_count} | "
            f"letters={fully_rated_letter_count}"
        )

        return {
            **base_response,
            "status": "final",
            "kappa": kappa,
            "interpretation": interpretation,
            "observed_agreement": round(observed_agreement, 4),
            "expected_agreement": round(expected_agreement, 4),
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to calculate Fleiss' Kappa: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to calculate Fleiss' Kappa.",
        )
