# the core inference pipeline - runs models based on whatever INFERENCE_MODE
# is currently set to. Clinical mode just cares about the ensemble result
# with the sensitivity-first threshold; research mode runs all 3 models plus
# the ensemble and saves everything. results go to screening_results, and
# screening status gets updated either way (complete or failed).

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
from app.ml_inference.llm_referral import generate_referral_letters # generates the referral letter after inference, only if glaucoma predicted

from app.ml_inference.ohts import get_ohts_result, get_ohts_tiers

import math

from app.utils.notifications import send_high_risk_notification
from app.utils.settings_helper import get_setting

from app.services.segmentation_service import extract_cdr_classical


# thresholds tuned for sensitivity, pulled from evaluation_results.json -
# keep these in sync with whatever's reported in the evaluation writeup
SENSITIVITY_THRESHOLDS = {
    "efficientnetb0": 0.52,
    "vgg16": 0.47,
    "efficientnetv2": 0.47,
    "ensemble": 0.50,
}


async def get_inference_mode(db: AsyncSession) -> str:
    return await get_setting(db, "INFERENCE_MODE", default="clinical")


def sigmoid(x: float) -> float:
    # need this because VGG16 spits out raw logits, not probabilities
    return 1 / (1 + math.exp(-x))

def run_single_model(model_name: str, image_path: str) -> dict:
    model = get_model(model_name)
    threshold = SENSITIVITY_THRESHOLDS[model_name]

    img_array = preprocess_image_for_model(image_path, model_name)
    raw_score = float(model.predict(img_array, verbose=0)[0][0])

    # normalise to a 0-1 probability so all models are comparable
    confidence_score = sigmoid(raw_score)

    prediction = "glaucoma" if confidence_score >= threshold else "normal"

    return {
        "model_used": model_name,
        "confidence_score": confidence_score,
        "threshold_used": threshold,
        "prediction": prediction,
    }


def run_ensemble(individual_results: list[dict]) -> dict:
    # averages the three model scores and checks against the ensemble
    # threshold - this is the result we treat as authoritative clinically

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
    # writes one model's result into screening_results

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
    mode: str | None = None, # lets tests override the global setting directly; otherwise we read it from settings
) -> None:
    # runs as a background task once an image is uploaded - reads the mode,
    # runs the right models, computes the ensemble, saves everything, and
    # marks the screening complete (or failed if something blows up)

    # grab the screening record
    result = await db.execute(
        select(Screening).where(Screening.screening_id == screening_id)
    )
    screening = result.scalar_one_or_none()

    if not screening:
        logger.warning(f"Screening {screening_id} not found.")
        return

    try:
        # explicit mode wins (used by admin seeding), otherwise fall back to
        # whatever's configured for the normal screening flow
        active_mode = mode or await get_inference_mode(db)
        # default until clinical mode overrides it below - research mode
        # always sticks with ensemble anyway
        default_cnn_model = "ensemble"
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

        # patient data for OHTS scoring
        patient_result = await db.execute(
            select(Patient).where(Patient.patient_id == screening.patient_id)
        )
        patient = patient_result.scalar_one_or_none()

        individual_results = []

        if active_mode == "research":
            # research mode - just run all three, straightforward
            for model_name in ["efficientnetb0", "vgg16", "efficientnetv2"]:
                logger.info(f"Running {model_name}...")
                res = run_single_model(model_name, image_path)
                individual_results.append(res)
                await save_result(db, screening_id, res, created_by)

        else:
                    # clinical mode still runs all 3 models regardless of what
                    # DEFAULT_CNN_MODEL says - we need every result to compute
                    # the ensemble average and to check for disagreement between
                    # models. DEFAULT_CNN_MODEL only decides which result gets
                    # shown to the clinician as the reference, not what runs.
                    for model_name in ["efficientnetb0", "vgg16", "efficientnetv2"]:
                        res = run_single_model(model_name, image_path)
                        individual_results.append(res)

        ensemble_result = run_ensemble(individual_results)

        # DEFAULT_CNN_MODEL decides which result becomes the clinical
        # reference in clinical mode - research mode ignores this entirely
        default_cnn_model = "ensemble"
        if active_mode == "clinical":
            default_cnn_model = await get_setting(
                db, "DEFAULT_CNN_MODEL", default="ensemble"
            )

        if active_mode == "clinical" and default_cnn_model in SENSITIVITY_THRESHOLDS:
            # a specific model was picked - pull its result out
            clinical_result = next(
                (r for r in individual_results if r["model_used"] == default_cnn_model),
                ensemble_result  # fall back to ensemble if somehow not found
            )
            logger.info(
                f"[inference] Clinical reference: {default_cnn_model} "
                f"(confidence={clinical_result['confidence_score']:.4f} "
                f"prediction={clinical_result['prediction']}) | "
                f"screening_id={screening_id}"
            )
        else:
            # default case - ensemble is the reference
            clinical_result = ensemble_result

        # model_used gets the real model name here so the result page can
        # show which one was actually used as the clinical reference
        clinical_result_to_save = {
            **clinical_result,
            "model_used": "ensemble" if default_cnn_model == "ensemble" else default_cnn_model,
        }
        await save_result(db, screening_id, clinical_result_to_save, created_by)

        has_disagreement = False
        disagreement_model_name = None
        disagreement_conf = None

        # disagreement check, clinical mode only: if the clinical reference
        # says normal but some other model crossed its own threshold, flag it.
        # uses the locked SENSITIVITY_THRESHOLDS, not whatever's in the DB.
        if active_mode == "clinical" and clinical_result["prediction"] == "normal":
            all_results = individual_results + [ensemble_result]
            for res in all_results:
                model_name = res["model_used"]
                if model_name == default_cnn_model:
                    continue  # don't compare the reference against itself
                model_threshold = SENSITIVITY_THRESHOLDS.get(model_name, 0.50)
                if res["confidence_score"] >= model_threshold:
                    if disagreement_conf is None or res["confidence_score"] > disagreement_conf:
                        has_disagreement = True
                        disagreement_model_name = model_name
                        disagreement_conf = res["confidence_score"]
                    logger.info(
                        f"[disagreement] {model_name} predicted glaucoma "
                        f"({res['confidence_score']:.4f} >= {model_threshold}) "
                        f"while {default_cnn_model} predicted normal "
                        f"({clinical_result['confidence_score']:.4f})"
                    )

        # stash the disagreement info on the ensemble record
        if has_disagreement:
            result = await db.execute(
                select(ScreeningResult).where(
                    ScreeningResult.screening_id == screening_id,
                    ScreeningResult.model_used == clinical_result_to_save["model_used"],
                    ScreeningResult.llm_used.is_(None),
                    ScreeningResult.letter_type.is_(None),
                )
            )
            ensemble_record = result.scalar_one_or_none()
            if ensemble_record:
                ensemble_record.has_model_disagreement = True
                ensemble_record.disagreement_model = disagreement_model_name
                ensemble_record.disagreement_confidence = disagreement_conf
                logger.info(
                    f"[disagreement] Flagged on ensemble record | "
                    f"model={disagreement_model_name} conf={disagreement_conf:.4f}"
                )

        tiers = await get_ohts_tiers(db)

        ohts_result = None
        if patient:
            ohts_result = get_ohts_result(
                dob=patient.dob,
                iop=patient.iop,
                cct=patient.cct,
                cdr=None,   # segmentation module fills this in once it's built
                vcd=None,   # same here
                tiers=tiers,
            )

        if ohts_result:
            result = await db.execute(
                select(ScreeningResult).where(
                    ScreeningResult.screening_id == screening_id,
                    ScreeningResult.model_used == clinical_result_to_save["model_used"],
                    ScreeningResult.llm_used.is_(None),
                    ScreeningResult.letter_type.is_(None),
                )
            )
            ensemble_record = result.scalar_one_or_none()
            if ensemble_record:
                ensemble_record.ohts_score = ohts_result["ohts_score"]
                ensemble_record.ohts_tier = ohts_result["ohts_tier"]
                logger.info(f"OHTS score: {ohts_result['ohts_score']} tier: {ohts_result['ohts_tier']}")


        heatmaps = {}
        gradcam_enabled = await get_setting_bool(db, "GRADCAM_ENABLED", default=True)

        if gradcam_enabled:
            heatmaps = {}      # numpy arrays, used later for the ensemble heatmap
            gradcam_paths = {} # file paths, these go into the DB

            for model_name in ["efficientnetb0", "vgg16", "efficientnetv2"]:
                model = get_model(model_name)
                img_array = preprocess_image_for_model(image_path, model_name)

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

                heatmaps[model_name] = heatmap  # keep the array for the ensemble step

                overlay = overlay_heatmap_on_image(image_path, heatmap)
                filename = f"{screening_id}_{model_name}_gradcam.png"
                save_path = os.path.join("uploads/gradcam", filename)
                import cv2
                cv2.imwrite(save_path, overlay)
                gradcam_paths[model_name] = save_path

                # attach the gradcam path to this model's result row
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

            ensemble_gradcam_path = generate_ensemble_gradcam(
                heatmaps=heatmaps,
                original_image_path=image_path,
                screening_id=screening_id,
            )
            # attach the ensemble gradcam path too
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

            # need all heatmaps at the same size before averaging for CDR extraction
            target_size = (224, 224)
            resized_heatmaps = [
                cv2.resize(hm, target_size) for hm in heatmaps.values()
            ]
            averaged_heatmap = np.mean(resized_heatmaps, axis=0)

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


        # letter generation runs off the clinical reference result, which
        # could be the ensemble or a single model depending on settings
        if clinical_result["prediction"] == "glaucoma":
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

            # research mode always fires all 4 LLMs, this setting only
            # matters for clinical mode
            if active_mode == "clinical":
                default_llm = await get_setting(
                    db, "DEFAULT_CLINICAL_LLM", default="gpt4o"
                )
                active_llms = [default_llm]
            else:
                active_llms = ["gpt4o", "gpt4o_mini", "llama", "gemini"]

            letters = generate_referral_letters(
                image_path=image_path,
                patient_name=patient_name,
                eye_side=screening.eye_side,
                confidence_score=clinical_result["confidence_score"],
                ohts_score=ohts_result["ohts_score"] if ohts_result else None,
                ohts_tier=ohts_result["ohts_tier"] if ohts_result else None,
                active_llms=active_llms,
                clinician_name=clinician_name,
                clinician_title=clinician_title,                
            )

            if active_mode == "clinical":
                # separate record for the GPT-4o letter, keeps the ensemble
                # record's llm_used = NULL so that filter always finds the
                # clinical result reliably
                if default_llm  in letters:
                    llm_record = ScreeningResult(
                        screening_id=screening_id,
                        model_used="ensemble",
                        prediction=ensemble_result["prediction"],
                        confidence_score=ensemble_result["confidence_score"],
                        threshold_used=ensemble_result["threshold_used"],
                        referral_letter=letters["gpt4o"]["letter"],
                        signed_by=signed_by,
                        llm_used=default_llm,
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
                # research mode - one record per LLM
                for llm_name, result_data in letters.items():
                    llm_record = ScreeningResult(
                        screening_id=screening_id,
                        model_used="ensemble",
                        prediction=clinical_result["prediction"],
                        confidence_score=clinical_result["confidence_score"],
                        threshold_used=clinical_result["threshold_used"],
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

        # high-risk email notification - fires on glaucoma prediction, and
        # if OHTS data is present we also check the tier is above threshold
        if clinical_result["prediction"] == "glaucoma":
            notification_email = await get_setting(
                db, "NOTIFICATION_EMAIL",
                default="aiglaucomascreeningsystem@gmail.com"
            )

            should_notify = False

            if ohts_result:
                # we have OHTS data, so gate on the tier threshold
                notification_threshold = await get_setting(
                    db, "NOTIFICATION_THRESHOLD",
                    default="critical,possible"
                )
                threshold_tiers = [t.strip() for t in notification_threshold.split(",")]
                if ohts_result["ohts_tier"] in threshold_tiers:
                    should_notify = True
            else:
                # no OHTS data, so a glaucoma prediction alone is enough
                should_notify = True

            if should_notify:
                patient_name = f"{patient.first_name} {patient.last_name}" if patient else "Unknown"
                logger.info(f"Sending high-risk notification for {patient_name}...")
                send_high_risk_notification(
                    patient_name=patient_name,
                    patient_code=patient.patient_code if patient else "Unknown",
                    eye_side=screening.eye_side,
                    confidence_score=clinical_result["confidence_score"],
                    ohts_score=ohts_result["ohts_score"] if ohts_result else None,
                    ohts_tier=ohts_result["ohts_tier"] if ohts_result else None,
                    screening_id=str(screening_id),
                    notification_email=notification_email,
                )

                logger.info(f"High-risk notification sent to {notification_email}")

        # everything's done, commit it all as one transaction
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
            f"Clinical reference: {default_cnn_model} | "
            f"Prediction: {clinical_result['prediction']} | "
            f"Score: {clinical_result['confidence_score']:.4f}"
        )


    except Exception as e:
        # whatever went wrong, mark it failed and log it
        logger.error(f"Inference failed for screening {screening_id}: {str(e)}", exc_info=True)
        screening.status = "failed"
        screening.updated_at = datetime.utcnow()
        await db.commit()
        raise