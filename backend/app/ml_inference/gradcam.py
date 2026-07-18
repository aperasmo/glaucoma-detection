# Grad-CAM++ heatmaps for the three models.
# each one needs a different approach because the architectures aren't the same:
# EfficientNetB0/V2 use GradientTape straight on the backbone sub-model,
# VGG16 needs to be flattened first then run through tf-keras-vis with ReplaceToLinear().
# ensemble heatmap is just the average of the three, saved as a PNG overlay on the fundus image.

import os
import uuid
import cv2
import numpy as np
import tensorflow as tf

from app.core.logger import get_logger

logger = get_logger(__name__)

# where the heatmap PNGs get saved
GRADCAM_DIR = "uploads/gradcam"

# last conv layer per model - matches what we used during training
LAST_CONV_LAYERS = {
    "efficientnetb0": "top_conv",
    "vgg16": "block5_conv3",
    "efficientnetv2": "top_conv",
}


def ensure_gradcam_dir():
    # make sure the output dir exists
    os.makedirs(GRADCAM_DIR, exist_ok=True)


def compute_gradcam_efficientnet(
    model,
    img_array: np.ndarray,
    layer_name: str,
) -> np.ndarray:
    # for the EfficientNet models we grab gradients straight off the backbone
    # sub-model and then push the output through the head layers ourselves

    # dig out the backbone sub-model plus whatever head layers sit on top
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

    # this model exposes both the conv layer output and the backbone output
    grad_model = tf.keras.Model(
        inputs=backbone.inputs,
        outputs=[conv_layer.output, backbone.output],
    )

    with tf.GradientTape() as tape:
        inputs = tf.cast(img_array, tf.float32)
        conv_outputs, backbone_out = grad_model(inputs)
        tape.watch(conv_outputs)

        # push it through the head layers to get the actual prediction score
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
    # VGG16 gets vanishing gradients after fine-tuning, so plain GradientTape
    # doesn't work well here - flattening the model and running it through
    # tf-keras-vis with ReplaceToLinear() gets around that

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
    # flattens VGG16's nested sub-model structure - tf-keras-vis needs this
    # for its gradient computation to work

    inputs = model.input
    x = inputs

    for layer in model.layers:
        if hasattr(layer, "layers"):
            # unpack the sub-model's layers directly into the flat chain
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
    # blends the heatmap onto the fundus image, returns a BGR numpy array

    img = cv2.imread(original_image_path)
    img = cv2.resize(img, target_size)

    heatmap_resized = cv2.resize(heatmap, target_size)

    # colourise the heatmap so it's actually visible as an overlay
    heatmap_uint8 = np.uint8(255 * heatmap_resized)
    heatmap_colour = cv2.applyColorMap(heatmap_uint8, cv2.COLORMAP_JET)

    overlay = cv2.addWeighted(img, 0.6, heatmap_colour, 0.4, 0)

    return overlay


def generate_gradcam_for_screening(
    model_name: str,
    model,
    img_array: np.ndarray,
    original_image_path: str,
    screening_id: uuid.UUID,
) -> str:
    # generates and saves the heatmap for one model, returns the file path

    ensure_gradcam_dir()

    layer_name = LAST_CONV_LAYERS[model_name]

    if model_name == "vgg16":
        heatmap = compute_gradcam_vgg16(model, img_array)
    else:
        heatmap = compute_gradcam_efficientnet(model, img_array, layer_name)

    overlay = overlay_heatmap_on_image(original_image_path, heatmap)

    filename = f"{screening_id}_{model_name}_gradcam.png"
    save_path = os.path.join(GRADCAM_DIR, filename)
    cv2.imwrite(save_path, overlay)

    return save_path


def generate_ensemble_gradcam(
    heatmaps: dict,
    original_image_path: str,
    screening_id: uuid.UUID,
) -> str:
    # averages the three model heatmaps into one - regions all models
    # agree on stay bright, everything else fades out

    ensure_gradcam_dir()

    target_size = (224, 224)

    resized = [cv2.resize(hm, target_size) for hm in heatmaps.values()]

    ensemble_heatmap = np.mean(resized, axis=0)

    if ensemble_heatmap.max() > 0:
        ensemble_heatmap = ensemble_heatmap / ensemble_heatmap.max()

    overlay = overlay_heatmap_on_image(original_image_path, ensemble_heatmap)

    filename = f"{screening_id}_ensemble_gradcam.png"
    save_path = os.path.join(GRADCAM_DIR, filename)
    cv2.imwrite(save_path, overlay)

    return save_path