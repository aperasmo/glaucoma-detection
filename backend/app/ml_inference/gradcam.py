# backend/app/ml_inference/gradcam.py
#
# Grad-CAM++ heatmap generation for all three models.
# Each model requires a different approach due to architecture differences.
# EfficientNetB0 and EfficientNetV2 - GradientTape on backbone sub-model.
# VGG16 - flat model rebuild + tf-keras-vis with ReplaceToLinear().
# Ensemble heatmap - average of all three model heatmaps.
# Output is saved as a PNG overlay on the original fundus image.

import os
import uuid
import cv2
import numpy as np
import tensorflow as tf

from app.core.logger import get_logger

logger = get_logger(__name__)

# Folder where Grad-CAM++ heatmap images are saved
GRADCAM_DIR = "uploads/gradcam"

# Last convolutional layer names - confirmed from training
LAST_CONV_LAYERS = {
    "efficientnetb0": "top_conv",
    "vgg16": "block5_conv3",
    "efficientnetv2": "top_conv",
}


def ensure_gradcam_dir():
    # Create the Grad-CAM output directory if it does not exist.
    os.makedirs(GRADCAM_DIR, exist_ok=True)


def compute_gradcam_efficientnet(
    model,
    img_array: np.ndarray,
    layer_name: str,
) -> np.ndarray:
    # Grad-CAM++ for EfficientNetB0 and EfficientNetV2.
    # Uses GradientTape on the backbone sub-model directly.
    # Routes backbone output through head layers manually.

    # Find backbone sub-model and head layers
    backbone = None
    head_layers = []

    for layer in model.layers:
        if hasattr(layer, "layers"):
            try:
                layer.get_layer(layer_name)
                backbone = layer
            except ValueError:
                continue
        elif not isinstance(layer, tf.keras.layers.InputLayer):
            head_layers.append(layer)

    if backbone is None:
        raise ValueError(f"Could not find backbone containing layer: {layer_name}")

    conv_layer = backbone.get_layer(layer_name)

    # Build grad model from backbone inputs to conv output and backbone output
    grad_model = tf.keras.Model(
        inputs=backbone.inputs,
        outputs=[conv_layer.output, backbone.output],
    )

    with tf.GradientTape() as tape:
        inputs = tf.cast(img_array, tf.float32)
        conv_outputs, backbone_out = grad_model(inputs)
        tape.watch(conv_outputs)

        # Route through head layers to get final score
        x = backbone_out
        for layer in head_layers:
            x = layer(x)
        score = x[:, 0]

    grads = tape.gradient(score, conv_outputs)
    pooled_grads = tf.reduce_mean(grads, axis=(0, 1, 2))

    conv_outputs = conv_outputs[0]
    heatmap = conv_outputs @ pooled_grads[..., tf.newaxis]
    heatmap = tf.squeeze(heatmap).numpy()
    heatmap = np.maximum(heatmap, 0)

    if heatmap.max() > 0:
        heatmap = heatmap / heatmap.max()

    return heatmap


def compute_gradcam_vgg16(model, img_array: np.ndarray) -> np.ndarray:
    # Grad-CAM++ for VGG16 using tf-keras-vis.
    # VGG16 has vanishing gradient problem after fine-tuning.
    # Fix: rebuild as flat model then use GradcamPlusPlus with ReplaceToLinear().

    from tf_keras_vis.gradcam_plus_plus import GradcamPlusPlus
    from tf_keras_vis.utils.model_modifiers import ReplaceToLinear

    flat_model = rebuild_flat_vgg16(model)

    def glaucoma_score(output):
        return output[:, 0]

    gradcam = GradcamPlusPlus(
        flat_model,
        model_modifier=ReplaceToLinear(),
        clone=True,
    )

    cam = gradcam(glaucoma_score, img_array, penultimate_layer=-1)
    heatmap = cam[0]

    if heatmap.max() > 0:
        heatmap = heatmap / heatmap.max()

    return heatmap


def rebuild_flat_vgg16(model) -> tf.keras.Model:
    # Rebuild VGG16 as a flat model removing the nested sub-model structure.
    # Required for tf-keras-vis gradient computation.

    inputs = model.input
    x = inputs

    for layer in model.layers:
        if hasattr(layer, "layers"):
            # Expand the sub-model layers into the flat model
            for sub_layer in layer.layers:
                if not isinstance(sub_layer, tf.keras.layers.InputLayer):
                    x = sub_layer(x)
        elif not isinstance(layer, tf.keras.layers.InputLayer):
            x = layer(x)

    return tf.keras.Model(inputs=inputs, outputs=x)


def overlay_heatmap_on_image(
    original_image_path: str,
    heatmap: np.ndarray,
    target_size: tuple = (224, 224),
) -> np.ndarray:
    # Overlay the Grad-CAM++ heatmap on the original fundus image.
    # Produces a colour heatmap blended with the original image.
    # Returns the overlay as a numpy array (BGR).

    # Read and resize original image
    img = cv2.imread(original_image_path)
    img = cv2.resize(img, target_size)

    # Resize heatmap to match image size
    heatmap_resized = cv2.resize(heatmap, target_size)

    # Convert heatmap to colour map
    heatmap_uint8 = np.uint8(255 * heatmap_resized)
    heatmap_colour = cv2.applyColorMap(heatmap_uint8, cv2.COLORMAP_JET)

    # Blend heatmap with original image
    overlay = cv2.addWeighted(img, 0.6, heatmap_colour, 0.4, 0)

    return overlay


def generate_gradcam_for_screening(
    model_name: str,
    model,
    img_array: np.ndarray,
    original_image_path: str,
    screening_id: uuid.UUID,
) -> str:
    # Generate and save a Grad-CAM++ heatmap for a single model.
    # Returns the saved file path.

    ensure_gradcam_dir()

    layer_name = LAST_CONV_LAYERS[model_name]

    # Compute heatmap using model-specific approach
    if model_name == "vgg16":
        heatmap = compute_gradcam_vgg16(model, img_array)
    else:
        heatmap = compute_gradcam_efficientnet(model, img_array, layer_name)

    # Overlay on original image
    overlay = overlay_heatmap_on_image(original_image_path, heatmap)

    # Save the overlay image
    filename = f"{screening_id}_{model_name}_gradcam.png"
    save_path = os.path.join(GRADCAM_DIR, filename)
    cv2.imwrite(save_path, overlay)

    return save_path


def generate_ensemble_gradcam(
    heatmaps: dict,
    original_image_path: str,
    screening_id: uuid.UUID,
) -> str:
    # Generate ensemble heatmap by averaging all three model heatmaps.
    # Where all models agree on high activation the region stays bright.
    # Returns the saved file path.

    ensure_gradcam_dir()

    target_size = (224, 224)

    # Resize all heatmaps to same size
    resized = [cv2.resize(hm, target_size) for hm in heatmaps.values()]

    # Average the heatmaps
    ensemble_heatmap = np.mean(resized, axis=0)

    if ensemble_heatmap.max() > 0:
        ensemble_heatmap = ensemble_heatmap / ensemble_heatmap.max()

    # Overlay on original image
    overlay = overlay_heatmap_on_image(original_image_path, ensemble_heatmap)

    # Save the ensemble overlay
    filename = f"{screening_id}_ensemble_gradcam.png"
    save_path = os.path.join(GRADCAM_DIR, filename)
    cv2.imwrite(save_path, overlay)

    return save_path