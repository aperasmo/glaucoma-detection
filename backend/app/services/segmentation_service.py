# backend/app/services/segmentation_service.py
#
# Optic disc and cup segmentation using classical image processing.
# Approximates CDR (Cup-to-Disc Ratio) from fundus images using
# Grad-CAM++ heatmap to locate the optic disc region, then applies
# Hough circle detection to estimate disc and cup boundaries.
#
# This is an approximation - not a clinically validated segmentation model.
# A dedicated U-Net trained on PAPILA and REFUGE is planned as future work.
# CDR values must be clearly presented as approximate in the UI and paper.
#
# Reference: SEGMENTATION_DECISION.md - Option A selected for capstone timeline.

import cv2
import numpy as np
from typing import Optional

from app.core.logger import get_logger

logger = get_logger(__name__)


def extract_cdr_classical(
    fundus_image_path: str,
    heatmap: np.ndarray,
) -> dict:
    # Approximate CDR using classical image processing.
    # Uses Grad-CAM++ heatmap to find optic disc region of interest,
    # then applies Hough circle detection for disc and cup boundaries.
    #
    # Args:
    #   fundus_image_path : path to original BGR fundus image
    #   heatmap           : normalised Grad-CAM++ heatmap (H, W) float [0,1]
    #
    # Returns:
    #   dict with cdr, disc_radius, cup_radius, and method metadata.
    #   All values are None if detection fails.

    logger.info(f"Starting CDR extraction for: {fundus_image_path}")

    try:
        # Load the original fundus image
        fundus_img = cv2.imread(fundus_image_path)
        if fundus_img is None:
            logger.error(f"Could not read fundus image: {fundus_image_path}")
            return _empty_result()

        h, w = fundus_img.shape[:2]

        # Step 1 - Locate optic disc region using Grad-CAM++ heatmap
        heatmap_resized = cv2.resize(heatmap, (w, h))
        heatmap_uint8 = np.uint8(255 * heatmap_resized)

        # Threshold to get high-activation region
        _, binary = cv2.threshold(heatmap_uint8, 127, 255, cv2.THRESH_BINARY)

        contours, _ = cv2.findContours(
            binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
        )

        if not contours:
            logger.warning("No high-activation contours found in heatmap.")
            return _empty_result()

        # Use the largest contour as the optic disc region
        largest = max(contours, key=cv2.contourArea)
        x, y, cw, ch = cv2.boundingRect(largest)

        # Step 2 - Crop region of interest with padding
        padding = 20
        x1 = max(0, x - padding)
        y1 = max(0, y - padding)
        x2 = min(w, x + cw + padding)
        y2 = min(h, y + ch + padding)
        roi = fundus_img[y1:y2, x1:x2]

        # Step 3 - Preprocess ROI for circle detection
        gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
        
        blur = cv2.GaussianBlur(gray, (5, 5), 1)

        roi_h, roi_w = roi.shape[:2]
        min_r = roi_w // 8
        max_r = roi_w // 2

        # Step 4 - Detect optic disc (outer boundary)
        # Parameters tuned for fundus images - more lenient than default
        disc_circles = cv2.HoughCircles(
            blur, cv2.HOUGH_GRADIENT, dp=1.0,
            minDist=roi_w // 4,
            param1=30, param2=20,
            minRadius=min_r // 2, maxRadius=max_r,
        )

        if disc_circles is None:
            logger.warning("Hough circle detection failed for optic disc.")
            return _empty_result()

        disc_circles = np.round(disc_circles[0, :]).astype(int)
        disc_x, disc_y, disc_r = disc_circles[0]

        # Step 5 - Detect optic cup (inner brighter region)
        cup_margin = int(disc_r * 0.7)
        cx1 = max(0, disc_x - cup_margin)
        cy1 = max(0, disc_y - cup_margin)
        cx2 = min(roi_w, disc_x + cup_margin)
        cy2 = min(roi_h, disc_y + cup_margin)
        cup_roi = blur[cy1:cy2, cx1:cx2]

        cup_circles = cv2.HoughCircles(
            cup_roi, cv2.HOUGH_GRADIENT, dp=1.2,
            minDist=max(1, cup_roi.shape[1]),
            param1=50, param2=20,
            minRadius=int(disc_r * 0.1),
            maxRadius=int(disc_r * 0.7),
        )

        if cup_circles is None:
            # Estimate cup as 0.5 * disc radius if detection fails
            logger.warning("Cup detection failed - estimating cup as 0.5 * disc radius.")
            cup_r = int(disc_r * 0.5)
        else:
            cup_circles = np.round(cup_circles[0, :]).astype(int)
            _, _, cup_r = cup_circles[0]

        # Step 6 - Compute CDR
        cdr = round(cup_r / disc_r, 3) if disc_r > 0 else None

        logger.info(f"CDR extracted: disc_r={disc_r} cup_r={cup_r} cdr={cdr}")

        return {
            "cdr": cdr,
            "disc_radius": int(disc_r),
            "cup_radius": int(cup_r),
            "cdr_method": "classical_approximation",
            "cdr_validated": False,
            "cdr_note": (
                "CDR approximated using classical image processing. "
                "Clinical validation against ground truth segmentation masks is pending."
            ),
        }

    except Exception as e:
        logger.error(f"CDR extraction failed: {str(e)}", exc_info=True)
        return _empty_result()


def _empty_result() -> dict:
    # Return empty result when CDR extraction fails or is not possible.
    return {
        "cdr": None,
        "disc_radius": None,
        "cup_radius": None,
        "cdr_method": "classical_approximation",
        "cdr_validated": False,
        "cdr_note": "CDR extraction failed or image quality insufficient.",
    }