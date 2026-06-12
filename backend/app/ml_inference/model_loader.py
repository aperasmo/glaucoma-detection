# backend/app/ml_inference/model_loader.py
#
# Loads all three models once when the server starts.
# Models are kept in memory for fast inference.
# Loading on every request would be too slow for clinical use.
# Model files must exist in the models/ folder at the project root.

import os
import tensorflow as tf

from app.core.logger import get_logger

logger = get_logger(__name__)

# Base models directory - relative to project root
MODELS_DIR = os.path.normpath(os.path.join(
    os.path.dirname(__file__),  # ml_inference/
    "..",                        # app/
    "..",                        # backend/
    "models",
))

# Model file paths - each model in its own subfolder
MODEL_FILES = {
    "efficientnetb0": os.path.join("efficientnetb0", "efficientnetb0_phase2b_best.h5"),
    "vgg16": os.path.join("vgg16", "vgg16_phase2b_best.h5"),
    "efficientnetv2": os.path.join("efficientnetv2", "efficientnetv2_phase2b_best.h5"),
}

# Global model registry - populated once at startup
# Key: model name, Value: loaded Keras model
_models: dict = {}


def load_all_models() -> None:
    # Load all three models into memory.
    # Called once during FastAPI startup event.
    # Logs each model as it loads so we can track startup progress.

    for name, filename in MODEL_FILES.items():
        model_path = os.path.normpath(os.path.join(MODELS_DIR, filename))

        if not os.path.exists(model_path):
            raise FileNotFoundError(
                f"Model file not found: {model_path}. "
                f"Copy the .h5 files to the models/ folder."
            )

        logger.info(f"Loading {name} from {model_path}...")
        _models[name] = tf.keras.models.load_model(model_path)
        logger.info(f"{name} loaded successfully.")

    logger.info(f"All {len(_models)} models loaded and ready.")


def get_model(name: str):
    # Retrieve a loaded model by name.
    # Raises RuntimeError if models have not been loaded yet.

    if not _models:
        raise RuntimeError("Models not loaded. Call load_all_models() first.")

    if name not in _models:
        raise ValueError(f"Unknown model: {name}. Valid options: {list(_models.keys())}")

    return _models[name]


def get_all_models() -> dict:
    # Return all loaded models.
    # Used in Research Mode to run all three models simultaneously.

    if not _models:
        raise RuntimeError("Models not loaded. Call load_all_models() first.")

    return _models