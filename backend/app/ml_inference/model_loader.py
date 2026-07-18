# loads all three models once at server startup and keeps them in memory -
# reloading per request would be way too slow for clinical use. the .h5
# files need to already be sitting in the models/ folder at the project root.

import os
import tensorflow as tf

from app.core.logger import get_logger

logger = get_logger(__name__)

# climb up from ml_inference/ to backend/, then into models/
MODELS_DIR = os.path.normpath(os.path.join(
    os.path.dirname(__file__),  # ml_inference/
    "..",                        # app/
    "..",                        # backend/
    "models",
))

# each model lives in its own subfolder
MODEL_FILES = {
    "efficientnetb0": os.path.join("efficientnetb0", "efficientnetb0_phase2b_best.h5"),
    "vgg16": os.path.join("vgg16", "vgg16_phase2b_best.h5"),
    "efficientnetv2": os.path.join("efficientnetv2", "efficientnetv2_phase2b_best.h5"),
}

# name -> loaded Keras model, filled in once at startup
_models: dict = {}


def load_all_models() -> None:
    # runs once on FastAPI startup - logging each model as it loads so we
    # can actually see progress if startup is slow

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
    # grabs a loaded model by name, blows up if load_all_models() hasn't run yet

    if not _models:
        raise RuntimeError("Models not loaded. Call load_all_models() first.")

    if name not in _models:
        raise ValueError(f"Unknown model: {name}. Valid options: {list(_models.keys())}")

    return _models[name]


def get_all_models() -> dict:
    # research mode needs all three at once, this hands them all back

    if not _models:
        raise RuntimeError("Models not loaded. Call load_all_models() first.")

    return _models