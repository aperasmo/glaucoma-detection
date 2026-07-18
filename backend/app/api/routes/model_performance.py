# serves the frozen test-set eval metrics to the frontend. this is NOT live clinical
# performance - it's from the held-out test set used during model evaluation.
# reads from backend/app/data/model_performance/evaluation_results.json and
# mcnemar_results.json

import json
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.dependencies import get_current_user
from app.core.logger import get_logger
from app.models.user import User

logger = get_logger(__name__)

router = APIRouter(prefix="/models", tags=["Model Performance"])


# parents[2] from routes/model_performance.py lands on backend/app - update this
# if the JSON files ever move
APP_DIR = Path(__file__).resolve().parents[2]
PERFORMANCE_DIR = APP_DIR / "data" / "model_performance"

EVALUATION_FILE = PERFORMANCE_DIR / "evaluation_results.json"
MCNEMAR_FILE = PERFORMANCE_DIR / "mcnemar_results.json"


def _load_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        logger.error("Model performance file missing: %s", path)
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Model performance file not found: {path.name}",
        )

    try:
        with path.open("r", encoding="utf-8") as file:
            return json.load(file)
    except json.JSONDecodeError as exc:
        logger.error("Invalid model performance JSON: %s", path, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Invalid JSON file: {path.name}",
        ) from exc


def _safe_metric(value: Any) -> float | int | None:
    # coerces to a number if possible, otherwise gives up quietly
    if value is None:
        return None

    try:
        number = float(value)
    except (TypeError, ValueError):
        return None

    if number.is_integer():
        return int(number)

    return number


def _build_model_row(model_key: str, model_data: dict[str, Any]) -> dict[str, Any]:
    # one row per model, all metrics taken at the Youden threshold
    youden = model_data.get("youden_threshold", {}) or {}

    return {
        "model_key": model_key,
        "model_name": {
            "efficientnetb0": "EfficientNetB0",
            "vgg16": "VGG16",
            "efficientnetv2": "EfficientNetV2",
            "ensemble": "Ensemble",
        }.get(model_key, model_key),
        "checkpoint": model_data.get("checkpoint"),
        "threshold_method": "youden_threshold",
        "threshold": _safe_metric(youden.get("threshold")),
        "auc": _safe_metric(youden.get("auc")),
        "accuracy": _safe_metric(youden.get("accuracy")),
        "sensitivity": _safe_metric(youden.get("sensitivity")),
        "specificity": _safe_metric(youden.get("specificity")),
        "precision": _safe_metric(youden.get("precision")),
        "npv": _safe_metric(youden.get("npv")),
        "f1": _safe_metric(youden.get("f1")),
        "youden_j": _safe_metric(youden.get("youden_j")),
        "tp": _safe_metric(youden.get("tp")),
        "tn": _safe_metric(youden.get("tn")),
        "fp": _safe_metric(youden.get("fp")),
        "fn": _safe_metric(youden.get("fn")),
    }


@router.get("/performance", status_code=status.HTTP_200_OK)
async def get_model_performance(
    current_user: User = Depends(get_current_user),
):
    """Metrics for the Model Performance page - reads static JSON on purpose,
    don't wire this up to live clinical data."""
    evaluation_data = _load_json(EVALUATION_FILE)

    mcnemar_data = {}
    if MCNEMAR_FILE.exists():
        mcnemar_data = _load_json(MCNEMAR_FILE)

    primary_model_key = "ensemble"
    primary_model = evaluation_data.get(primary_model_key)

    if not primary_model:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Ensemble model result not found in evaluation_results.json.",
        )

    primary_result = _build_model_row(primary_model_key, primary_model)

    model_order = [
        "efficientnetb0",
        "vgg16",
        "efficientnetv2",
        "ensemble",
    ]

    models = [
        _build_model_row(model_key, evaluation_data[model_key])
        for model_key in model_order
        if model_key in evaluation_data
    ]

    test_size = mcnemar_data.get("test_set_size")
    if not test_size:
        tp = primary_result.get("tp") or 0
        tn = primary_result.get("tn") or 0
        fp = primary_result.get("fp") or 0
        fn = primary_result.get("fn") or 0
        test_size = tp + tn + fp + fn

    logger.info(
        "Model performance requested | user_id=%s | primary_model=%s | test_size=%s",
        current_user.user_id,
        primary_model_key,
        test_size,
    )

    return {
        "page_title": "Model Performance",
        "dataset_label": "Held-out test set",
        "test_size": test_size,
        "primary_model": primary_model_key,
        "primary_model_name": "Ensemble",
        "threshold_method": "youden_threshold",
        "threshold_method_label": "Youden threshold",
        "disclaimer": (
            "These metrics are based on a held-out test set and do not represent "
            "live clinical performance. Live performance tracking requires "
            "clinician-confirmed ground truth for screened patients."
        ),
        "primary_result": primary_result,
        "models": models,
        "mcnemar": {
            "method": mcnemar_data.get("method"),
            "threshold_method": mcnemar_data.get("threshold_method"),
            "significance_level": mcnemar_data.get("significance_level"),
            "results": mcnemar_data.get("results", []),
        },
    }
