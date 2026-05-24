# backend/app/ml_inference/preprocessing.py
#
# Image preprocessing for ML inference.
# Must match the exact preprocessing used during model training.
# Any deviation from this pipeline will degrade model performance.
# Pipeline: CLAHE enhancement -> BGR to RGB -> Resize -> Backbone normalisation

import cv2
import numpy as np

from app.core.logger import get_logger

logger = get_logger(__name__)


# Input sizes per model - must match training configuration
MODEL_INPUT_SIZES = {
    "efficientnetb0": (224, 224),
    "vgg16": (224, 224),
    "efficientnetv2": (260, 260),
}


def apply_clahe(img_bgr: np.ndarray) -> np.ndarray:
    # Apply CLAHE (Contrast Limited Adaptive Histogram Equalisation) to the L channel.
    # Enhances local contrast in fundus images without over-amplifying noise.
    # clipLimit=2.0 and tileGridSize=(8,8) match training configuration exactly.

    lab = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2LAB)
    l_chan, a_chan, b_chan = cv2.split(lab)

    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    l_eq = clahe.apply(l_chan)

    lab_eq = cv2.merge((l_eq, a_chan, b_chan))
    return cv2.cvtColor(lab_eq, cv2.COLOR_LAB2BGR)


def preprocess_image_for_model(image_path: str, backbone: str) -> np.ndarray:
    # Full preprocessing pipeline for a single image.
    # Replicates the exact load_and_preprocess_image function from training.
    # Returns a float32 array ready for model inference.
    # Returns None if the image cannot be read.

    # Step 1 - Read image from disk
    img = cv2.imread(image_path)
    if img is None:
        raise ValueError(f"Could not read image: {image_path}")

    # Step 2 - Apply CLAHE on LAB L channel
    img = apply_clahe(img)

    # Step 3 - Convert BGR to RGB
    img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)

    # Step 4 - Resize to model input size
    target_size = MODEL_INPUT_SIZES.get(backbone, (224, 224))
    img = cv2.resize(img, target_size, interpolation=cv2.INTER_AREA)

    # Step 5 - Convert to float32
    img = img.astype(np.float32)

    # Step 6 - Backbone-specific normalisation
    # Each backbone expects a specific input range - must match training exactly
    if backbone == "efficientnetb0":
        from tensorflow.keras.applications.efficientnet import preprocess_input
        img = preprocess_input(img)

    elif backbone == "vgg16":
        # VGG16 subtracts ImageNet channel means [103.9, 116.8, 123.7]
        from tensorflow.keras.applications.vgg16 import preprocess_input
        img = preprocess_input(img)

    elif backbone == "efficientnetv2":
        from tensorflow.keras.applications.efficientnet_v2 import preprocess_input
        img = preprocess_input(img)

    else:
        raise ValueError(f"Unknown backbone: {backbone}")

    # Add batch dimension - models expect shape (1, H, W, 3)
    return np.expand_dims(img, axis=0)