# backend/scripts/test_gemini_fallback.py
#
# Tests the Gemini fallback chain using real API calls and persistent state.
# Makes multiple real calls and logs exactly what happens including state changes.
# The exhausted set now persists in app/data/gemini_model_state.json.
#
# HOW TO RUN:
#   docker exec -it glaucoma_backend python -m scripts.test_gemini_fallback
#
# To reset state before testing:
#   docker exec -it glaucoma_backend rm -f app/data/gemini_model_state.json

import os
import sys
import json
import logging
from datetime import datetime
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

LOG_FILE = Path(__file__).parent / "test_gemini_fallback.log"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE, mode="a", encoding="utf-8"),
        logging.StreamHandler(sys.stdout),
    ]
)
log = logging.getLogger(__name__)

from app.ml_inference.llm_referral import generate_gemini_vision
from app.ml_inference.gemini_state import (
    load_state, save_state, mark_exhausted,
    _check_and_reset_expired, STATE_FILE, GEMINI_FALLBACK_MODELS
)

TEST_IMAGE = "test_images/normal/002.jpg"
NUM_CALLS = 50  # number of real API calls to make


def print_state():
    state = load_state()
    state = _check_and_reset_expired(state)
    log.info(f"Current state:")
    log.info(f"  last_successful_model: {state.get('last_successful_model')}")
    for m in state["models"]:
        log.info(
            f"  {m['name']}: exhausted={m['exhausted']} exhausted_at={m['exhausted_at']}"
        )


def call_gemini(call_number: int) -> None:
    log.info(f"--- Real Call #{call_number} ---")
    print_state()
    try:
        result = generate_gemini_vision(
            image_path=TEST_IMAGE,
            patient_name="Test Patient",
            eye_side="right",
            confidence_score=0.85,
            ohts_score=9,
            ohts_tier="critical",
        )
        log.info(f"RESULT: SUCCESS")
        log.info(f"Tokens - prompt={result['prompt_tokens']} completion={result['completion_tokens']} total={result['total_tokens']}")
        log.info(f"Letter preview: {result['letter'][:200]}")
    except RuntimeError as e:
        log.error(f"RESULT: ALL MODELS EXHAUSTED - {e}")
    except Exception as e:
        log.error(f"RESULT: UNEXPECTED ERROR - {e}", exc_info=True)
    finally:
        log.info(f"State after call:")
        print_state()


def run():
    log.info("=" * 60)
    log.info(f"Test run started: {datetime.now().isoformat()}")
    log.info(f"Fallback chain: {GEMINI_FALLBACK_MODELS}")
    log.info(f"State file: {STATE_FILE}")
    log.info(f"Making {NUM_CALLS} real consecutive API calls")
    log.info("=" * 60)

    for i in range(1, NUM_CALLS + 1):
        call_gemini(i)
        if i < NUM_CALLS:
            log.info(f"Waiting 5 seconds before next call...")
            import time
            time.sleep(5)

    log.info("\n" + "=" * 60)
    log.info(f"All {NUM_CALLS} calls complete: {datetime.now().isoformat()}")
    log.info(f"Log saved to: {LOG_FILE}")
    log.info("=" * 60)


if __name__ == "__main__":
    run()