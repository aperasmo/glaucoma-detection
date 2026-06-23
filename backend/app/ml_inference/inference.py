# backend/app/ml_inference/inference.py
#
# Core ML inference pipeline.
# Runs model inference based on the current INFERENCE_MODE setting.
# Clinical Mode  - ensemble only, sensitivity-first threshold.
# Research Mode  - all 3 models + ensemble, all results saved.
# Saves results to screening_results table.
# Updates screening status on completion or failure.

import uuid
import numpy as np
import cv2
from datetime import datetime

from app.core.logger import get_logger

logger = get_logger(__name__)

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.ml_inference.model_loader import get_model, get_all_models
from app.ml_inference.preprocessing import preprocess_image_for_model
from app.models.screening import Screening
from app.models.screening_result import ScreeningResult
from app.models.system_settings import SystemSettings

from app.ml_inference.gradcam import (
    generate_gradcam_for_screening,
    generate_ensemble_gradcam,
)
from app.ml_inference.preprocessing import preprocess_image_for_model

from app.ml_inference.ohts import get_ohts_result
from app.models.patient import Patient
from app.utils.settings_helper import get_setting, get_setting_bool
from app.ml_inference.llm_referral import generate_referral_letters # LLM referral letter generation - called after inference if glaucoma predicted

from app.ml_inference.ohts import get_ohts_result, get_ohts_tiers

import math

from app.utils.notifications import send_high_risk_notification
from app.utils.settings_helper import get_setting

from app.services.segmentation_service import extract_cdr_classical


# Sensitivity-first thresholds per model - confirmed from evaluation_results.json
# These match the thresholds used during evaluation reporting.
SENSITIVITY_THRESHOLDS = {
    "efficientnetb0": 0.52,
    "vgg16": 0.47,
    "efficientnetv2": 0.47,
    "ensemble": 0.50,
}


async def get_inference_mode(db: AsyncSession) -> str:
    return await get_setting(db, "INFERENCE_MODE", default="clinical")


def sigmoid(x: float) -> float:
    # Convert raw logit output to probability (0 to 1 range).
    # Required because VGG16 outputs logits, not probabilities.
    return 1 / (1 + math.exp(-x))

def run_single_model(model_name: str, image_path: str) -> dict:
    model = get_model(model_name)
    threshold = SENSITIVITY_THRESHOLDS[model_name]

    img_array = preprocess_image_for_model(image_path, model_name)
    raw_score = float(model.predict(img_array, verbose=0)[0][0])

    # Apply sigmoid to normalise all outputs to 0-1 probability range
    confidence_score = sigmoid(raw_score)

    prediction = "glaucoma" if confidence_score >= threshold else "normal"

    return {
        "model_used": model_name,
        "confidence_score": confidence_score,
        "threshold_used": threshold,
        "prediction": prediction,
    }


def run_ensemble(individual_results: list[dict]) -> dict:
    # Average the confidence scores from all three models.
    # Apply ensemble sensitivity threshold.
    # Ensemble is always the authoritative clinical output.

    avg_score = sum(r["confidence_score"] for r in individual_results) / len(individual_results)
    threshold = SENSITIVITY_THRESHOLDS["ensemble"]
    prediction = "glaucoma" if avg_score >= threshold else "normal"

    return {
        "model_used": "ensemble",
        "confidence_score": avg_score,
        "threshold_used": threshold,
        "prediction": prediction,
    }


async def save_result(
    db: AsyncSession,
    screening_id: uuid.UUID,
    result: dict,
    created_by: uuid.UUID,
) -> ScreeningResult:
    # Save a single model result to the screening_results table.

    record = ScreeningResult(
        screening_id=screening_id,
        model_used=result["model_used"],
        prediction=result["prediction"],
        confidence_score=result["confidence_score"],
        threshold_used=result["threshold_used"],
        created_by=created_by,
        updated_by=created_by,
    )
    db.add(record)
    return record


async def run_inference_pipeline(
    screening_id: uuid.UUID,
    image_path: str,
    db: AsyncSession,
    created_by: uuid.UUID,
    mode: str | None = None, # Optional mode parameter to override global setting, used for testing. If None, will read from settings.
) -> None:
    # Main inference pipeline - called as a background task after image upload.
    # Steps:
    # 1. Read inference mode from system_settings
    # 2. Run models based on mode
    # 3. Compute ensemble
    # 4. Save all results to screening_results
    # 5. Update screening status to complete
    # On any error - update screening status to failed

    # Fetch the screening record
    result = await db.execute(
        select(Screening).where(Screening.screening_id == screening_id)
    )
    screening = result.scalar_one_or_none()

    if not screening:
        logger.warning(f"Screening {screening_id} not found.")
        return

    try:
        # Use explicit mode when admin seeding passes one.
        # Otherwise use the current system setting for normal screening flow.
        active_mode = mode or await get_inference_mode(db)

        if active_mode not in {"clinical", "research"}:
            logger.warning(
                "Invalid inference mode '%s'. Falling back to clinical.",
                active_mode,
            )
            active_mode = "clinical"

        screening.inference_mode = active_mode
        screening.status = "processing"
        screening.updated_at = datetime.utcnow()

        await db.commit()

        logger.info(
            "Running inference | screening_id=%s | inference_mode=%s",
            screening_id,
            active_mode,
        )

        # Fetch patient data for OHTS scoring
        patient_result = await db.execute(
            select(Patient).where(Patient.patient_id == screening.patient_id)
        )
        patient = patient_result.scalar_one_or_none()


        # Step 2 - Read inference mode
        #Remove these two lines, because mode is already read and saved above.
        #mode = await get_inference_mode(db)
        #logger.info(f"Running in {mode} mode for screening {screening_id}")

        # Step 3 - Run models based on mode
        individual_results = []

        if active_mode == "research":
            # Research Mode - run all three models
            for model_name in ["efficientnetb0", "vgg16", "efficientnetv2"]:
                logger.info(f"Running {model_name}...")
                res = run_single_model(model_name, image_path)
                individual_results.append(res)
                await save_result(db, screening_id, res, created_by)

        else:
            # Clinical Mode - run all three for ensemble but only save ensemble
            for model_name in ["efficientnetb0", "vgg16", "efficientnetv2"]:
                res = run_single_model(model_name, image_path)
                individual_results.append(res)

        # Step 4 - Compute and save ensemble result
        ensemble_result = run_ensemble(individual_results)
        await save_result(db, screening_id, ensemble_result, created_by)

        # Fetch OHTS tiers from system settings
        tiers = await get_ohts_tiers(db)

        # Calculate OHTS risk score using patient clinical data
        ohts_result = None
        if patient:
            ohts_result = get_ohts_result(
                dob=patient.dob,
                iop=patient.iop,
                cct=patient.cct,
                cdr=None,   # Populated by segmentation module when built
                vcd=None,   # Populated by segmentation module when built
                tiers=tiers,
            )

        # Update ensemble result record with OHTS score
        if ohts_result:
            result = await db.execute(
                select(ScreeningResult).where(
                    ScreeningResult.screening_id == screening_id,
                    ScreeningResult.model_used == "ensemble",
                )
            )
            ensemble_record = result.scalar_one_or_none()
            if ensemble_record:
                ensemble_record.ohts_score = ohts_result["ohts_score"]
                ensemble_record.ohts_tier = ohts_result["ohts_tier"]
                logger.info(f"OHTS score: {ohts_result['ohts_score']} tier: {ohts_result['ohts_tier']}")


        # Step 5 - Generate Grad-CAM++ heatmaps
        heatmaps = {}
        gradcam_enabled = await get_setting_bool(db, "GRADCAM_ENABLED", default=True)

        if gradcam_enabled:
            heatmaps = {}      # stores numpy arrays for ensemble
            gradcam_paths = {} # stores file paths for saving to DB

            for model_name in ["efficientnetb0", "vgg16", "efficientnetv2"]:
                model = get_model(model_name)
                img_array = preprocess_image_for_model(image_path, model_name)
                
                # Get heatmap array and save path separately
                from app.ml_inference.gradcam import (
                    compute_gradcam_efficientnet,
                    compute_gradcam_vgg16,
                    LAST_CONV_LAYERS,
                    overlay_heatmap_on_image,
                    ensure_gradcam_dir,
                )
                import os
                ensure_gradcam_dir()
                
                layer_name = LAST_CONV_LAYERS[model_name]
                if model_name == "vgg16":
                    heatmap = compute_gradcam_vgg16(model, img_array)
                else:
                    heatmap = compute_gradcam_efficientnet(model, img_array, layer_name)
                
                heatmaps[model_name] = heatmap  # numpy array for ensemble
                
                # Save individual overlay
                overlay = overlay_heatmap_on_image(image_path, heatmap)
                filename = f"{screening_id}_{model_name}_gradcam.png"
                save_path = os.path.join("uploads/gradcam", filename)
                import cv2
                cv2.imwrite(save_path, overlay)
                gradcam_paths[model_name] = save_path

                # Update individual model result with its gradcam path
                result = await db.execute(
                    select(ScreeningResult).where(
                        ScreeningResult.screening_id == screening_id,
                        ScreeningResult.model_used == model_name,
                    )
                )
                model_record = result.scalar_one_or_none()
                if model_record:
                    model_record.gradcam_path = save_path

                logger.info(f"Grad-CAM++ generated for {model_name}")

            # Generate ensemble heatmap using numpy arrays
            ensemble_gradcam_path = generate_ensemble_gradcam(
                heatmaps=heatmaps,
                original_image_path=image_path,
                screening_id=screening_id,
            )
            # Update ensemble result record with Grad-CAM path
            result = await db.execute(
                select(ScreeningResult).where(
                    ScreeningResult.screening_id == screening_id,
                    ScreeningResult.model_used == "ensemble",
                    ScreeningResult.llm_used.is_(None),
                )
            )
            ensemble_record = result.scalar_one_or_none()
            if ensemble_record:
                ensemble_record.gradcam_path = ensemble_gradcam_path            
            logger.info(f"Ensemble Grad-CAM++ saved: {ensemble_gradcam_path}")

            # Extract CDR using ensemble heatmap and original fundus image
            # Resize all heatmaps to same size before averaging for CDR extraction
            target_size = (224, 224)
            resized_heatmaps = [
                cv2.resize(hm, target_size) for hm in heatmaps.values()
            ]
            averaged_heatmap = np.mean(resized_heatmaps, axis=0)

            # Extract CDR using averaged heatmap and original fundus image
            logger.info(
                "CDR extraction started | screening_id=%s | image_path=%s | ensemble_gradcam_path=%s | heatmap_shape=%s",
                screening_id,
                image_path,
                ensemble_gradcam_path,
                getattr(averaged_heatmap, "shape", None),
            )

            segmentation_result = extract_cdr_classical(
                fundus_image_path=image_path,
                heatmap=averaged_heatmap,
            )

            logger.info(
                "CDR extraction completed | screening_id=%s | result=%s",
                screening_id,
                segmentation_result,
            )

            # Update ensemble result record with CDR values
            if not ensemble_record:
                logger.warning(
                    "CDR not saved because ensemble record was not found | screening_id=%s",
                    screening_id,
                )
            elif segmentation_result.get("cdr") is None:
                logger.warning(
                    "CDR not saved because extraction returned no valid CDR | screening_id=%s | result=%s",
                    screening_id,
                    segmentation_result,
                )
            else:
                ensemble_record.cdr = segmentation_result["cdr"]
                ensemble_record.disc_radius = segmentation_result["disc_radius"]
                ensemble_record.cup_radius = segmentation_result["cup_radius"]

                logger.info(
                    "CDR values assigned to ensemble result = screening_id=%s | result_id=%s | cdr=%s | disc_radius=%s | cup_radius=%s",
                    screening_id,
                    getattr(ensemble_record, "screening_results_id", None),
                    ensemble_record.cdr,
                    ensemble_record.disc_radius,
                    ensemble_record.cup_radius,
                )


        # Step 6 - Generate referral letter if prediction is glaucoma        
        if ensemble_result["prediction"] == "glaucoma":
            patient_name = f"{patient.first_name} {patient.last_name}" if patient else "Unknown"

            clinician_name = await get_setting(
                db,
                "REFERRING_CLINICIAN_NAME",
                default="Dr. [Clinician Name]",
            )
            clinician_title = await get_setting(
                db,
                "REFERRING_CLINICIAN_TITLE",
                default="General Ophthalmologist",
            )
            signed_by = f"{clinician_name}\n{clinician_title}"

            active_llms = ["gpt4o"] if active_mode == "clinical" else ["gpt4o", "gpt4o_mini", "llama", "gemini"]

            letters = generate_referral_letters(
                image_path=image_path,
                patient_name=patient_name,
                eye_side=screening.eye_side,
                confidence_score=ensemble_result["confidence_score"],
                ohts_score=ohts_result["ohts_score"] if ohts_result else None,
                ohts_tier=ohts_result["ohts_tier"] if ohts_result else None,
                active_llms=active_llms,
                clinician_name=clinician_name,
                clinician_title=clinician_title,                
            )

            if active_mode == "clinical":
                # Clinical Mode - create a separate record for GPT-4o letter.
                # Ensemble record stays clean with llm_used = NULL.
                # This ensures llm_used IS NULL filter always finds the clinical result.
                if "gpt4o" in letters:
                    llm_record = ScreeningResult(
                        screening_id=screening_id,
                        model_used="ensemble",
                        prediction=ensemble_result["prediction"],
                        confidence_score=ensemble_result["confidence_score"],
                        threshold_used=ensemble_result["threshold_used"],
                        referral_letter=letters["gpt4o"]["letter"],
                        signed_by=signed_by,
                        llm_used="gpt4o",
                        generation_time_ms=letters["gpt4o"]["generation_time_ms"],
                        prompt_tokens=letters["gpt4o"]["prompt_tokens"],
                        completion_tokens=letters["gpt4o"]["completion_tokens"],
                        total_tokens=letters["gpt4o"]["total_tokens"],                        
                        ohts_score=ohts_result["ohts_score"] if ohts_result else None,
                        ohts_tier=ohts_result["ohts_tier"] if ohts_result else None,
                        created_by=created_by,
                        updated_by=created_by,
                    )
                    db.add(llm_record)
                    logger.info("Clinical Mode - GPT-4o letter saved as separate record.")

            else:
                # Research Mode - create separate record per LLM
                for llm_name, result_data in letters.items():
                    llm_record = ScreeningResult(
                        screening_id=screening_id,
                        model_used="ensemble",
                        prediction=ensemble_result["prediction"],
                        confidence_score=ensemble_result["confidence_score"],
                        threshold_used=ensemble_result["threshold_used"],
                        referral_letter=result_data["letter"],
                        signed_by=signed_by,
                        llm_used=llm_name,
                        generation_time_ms=result_data["generation_time_ms"],
                        prompt_tokens=result_data["prompt_tokens"],
                        completion_tokens=result_data["completion_tokens"],
                        total_tokens=result_data["total_tokens"],                        
                        ohts_score=ohts_result["ohts_score"] if ohts_result else None,
                        ohts_tier=ohts_result["ohts_tier"] if ohts_result else None,
                        created_by=created_by,
                        updated_by=created_by,
                    )
                    db.add(llm_record)

            logger.info(f"Referral letters generated: {list(letters.keys())}")

        # Step 7 - Send high-risk notification email
        # Notify if glaucoma predicted regardless of OHTS availability.
        # If OHTS is available, also check tier matches threshold.
        if ensemble_result["prediction"] == "glaucoma":
            notification_email = await get_setting(
                db, "NOTIFICATION_EMAIL",
                default="aiglaucomascreeningsystem@gmail.com"
            )

            should_notify = False

            if ohts_result:
                # OHTS available - check tier against threshold
                notification_threshold = await get_setting(
                    db, "NOTIFICATION_THRESHOLD",
                    default="critical,possible"
                )
                threshold_tiers = [t.strip() for t in notification_threshold.split(",")]
                if ohts_result["ohts_tier"] in threshold_tiers:
                    should_notify = True
            else:
                # No OHTS data - notify on glaucoma prediction alone
                should_notify = True

            if should_notify:
                patient_name = f"{patient.first_name} {patient.last_name}" if patient else "Unknown"
                logger.info(f"Sending high-risk notification for {patient_name}...")
                send_high_risk_notification(
                    patient_name=patient_name,
                    patient_code=patient.patient_code if patient else "Unknown",
                    eye_side=screening.eye_side,
                    confidence_score=ensemble_result["confidence_score"],
                    ohts_score=ohts_result["ohts_score"] if ohts_result else None,
                    ohts_tier=ohts_result["ohts_tier"] if ohts_result else None,
                    screening_id=str(screening_id),
                    notification_email=notification_email,
                )

                logger.info(f"High-risk notification sent to {notification_email}")

        # Final - Update status to complete and commit everything in one transaction
        screening.status = "complete"
        screening.updated_at = datetime.utcnow()
        await db.commit()

        logger.info(
            "Inference transaction committed | screening_id=%s | ensemble_cdr=%s | ensemble_disc_radius=%s | ensemble_cup_radius=%s",
            screening_id,
            getattr(ensemble_record, "cdr", None) if "ensemble_record" in locals() else None,
            getattr(ensemble_record, "disc_radius", None) if "ensemble_record" in locals() else None,
            getattr(ensemble_record, "cup_radius", None) if "ensemble_record" in locals() else None,
        )

        logger.info(
            f"Screening {screening_id} complete. "
            f"Prediction: {ensemble_result['prediction']} "
            f"Score: {ensemble_result['confidence_score']:.4f}"
        )


    except Exception as e:
        # On any failure - mark screening as failed and log the error
        logger.error(f"Inference failed for screening {screening_id}: {str(e)}", exc_info=True)
        screening.status = "failed"
        screening.updated_at = datetime.utcnow()
        await db.commit()
        raise