# backend/app/ml_inference/gemini_state.py
#
# Persistent Gemini model state manager.
# Tracks which models are exhausted and when, survives container restarts.
# Auto-resets exhausted models after 24 hours (daily quota reset).
#
# State file: backend/app/data/gemini_model_state.json
# Written on every exhaustion and every successful call.

import json
import os
from datetime import datetime, timezone, timedelta
from pathlib import Path
from threading import Lock

from app.core.logger import get_logger

logger = get_logger(__name__)

STATE_FILE = Path(__file__).parent.parent.parent / "app" / "data" / "gemini_model_state.json"

GEMINI_FALLBACK_MODELS = [
    "gemini-3.5-flash",
    "gemini-2.5-flash",
    "gemini-3.6-flash",
]

QUOTA_RESET_HOURS = 24

# Thread lock - inference pipeline runs in async background tasks
# which can overlap; protect file read/write
_state_lock = Lock()


def _default_state() -> dict:
    return {
        "last_successful_model": None,
        "models": [
            {"name": m, "exhausted": False, "exhausted_at": None}
            for m in GEMINI_FALLBACK_MODELS
        ],
    }


def load_state() -> dict:
    # Load state from JSON file.
    # Returns default state if file doesn't exist or is corrupted.
    with _state_lock:
        try:
            if not STATE_FILE.exists():
                logger.info("[gemini_state] No state file found - using defaults.")
                return _default_state()
            with open(STATE_FILE, "r", encoding="utf-8") as f:
                state = json.load(f)
            logger.info(f"[gemini_state] Loaded state from {STATE_FILE}")
            return state
        except Exception as e:
            logger.warning(f"[gemini_state] Failed to load state file - using defaults: {e}")
            return _default_state()


def save_state(state: dict) -> None:
    # Write state to JSON file.
    with _state_lock:
        try:
            STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
            with open(STATE_FILE, "w", encoding="utf-8") as f:
                json.dump(state, f, indent=2, ensure_ascii=False)
            logger.info(f"[gemini_state] State saved to {STATE_FILE}")
        except Exception as e:
            logger.error(f"[gemini_state] Failed to save state: {e}")


def _check_and_reset_expired(state: dict) -> dict:
    # Check each exhausted model - if exhausted_at is > 24 hours ago, reset it.
    now = datetime.now(timezone.utc)
    for model_entry in state["models"]:
        if model_entry["exhausted"] and model_entry["exhausted_at"]:
            exhausted_at = datetime.fromisoformat(model_entry["exhausted_at"])
            hours_elapsed = (now - exhausted_at).total_seconds() / 3600
            if hours_elapsed >= QUOTA_RESET_HOURS:
                logger.info(
                    f"[gemini_state] {model_entry['name']} quota reset after "
                    f"{hours_elapsed:.1f}h - marking available again."
                )
                model_entry["exhausted"] = False
                model_entry["exhausted_at"] = None
    return state


def get_ordered_candidates(state: dict) -> list[str]:
    # Returns ordered list of non-exhausted models.
    # Prefers last_successful_model first if still available,
    # then falls back to original chain order for the rest.
    # Option B: re-evaluate all models on each call based on current state.
    available = [
        m["name"] for m in state["models"]
        if not m["exhausted"]
    ]

    last = state.get("last_successful_model")
    if last and last in available:
        # Put last successful model first, then the rest in original order
        ordered = [last] + [m for m in available if m != last]
    else:
        ordered = available

    return ordered


def mark_exhausted(state: dict, model_name: str) -> dict:
    # Mark a model as exhausted with current timestamp.
    now_iso = datetime.now(timezone.utc).isoformat()
    for model_entry in state["models"]:
        if model_entry["name"] == model_name:
            model_entry["exhausted"] = True
            model_entry["exhausted_at"] = now_iso
            logger.warning(
                f"[gemini_state] {model_name} marked exhausted at {now_iso}"
            )
            break
    return state


def mark_success(state: dict, model_name: str) -> dict:
    # Record last successful model.
    state["last_successful_model"] = model_name
    return state