# backend/app/models/screening_result.py
#
# ScreeningResult table - stores ML prediction results for each screening.
# One screening can have multiple results (one per model + one ensemble).
# In Clinical Mode only the ensemble result is shown.
# In Research Mode all model results are shown side by side.
# All changes are tracked via created_by/updated_by for audit trail.

import uuid
from datetime import datetime

from sqlalchemy import Column, DateTime, Enum, ForeignKey, Numeric, String, Text
from sqlalchemy.dialects.postgresql import UUID

from app.db.database import Base


class ScreeningResult(Base):
    __tablename__ = "screening_results"

    # --- Primary Key ---
    screening_results_id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        index=True,
    )

    # --- Foreign Key ---
    # Links to the screening this result belongs to
    screening_id = Column(
        UUID(as_uuid=True),
        ForeignKey("screenings.screening_id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )

    # --- ML Model Info ---
    # Which model produced this result
    model_used = Column(
        Enum(
            "efficientnetb0",
            "vgg16",
            "efficientnetv2",
            "ensemble",
            name="model_types",
        ),
        nullable=False,
    )

    # --- Prediction ---
    # The binary classification result
    prediction = Column(
        Enum("glaucoma", "normal", name="prediction_types"),
        nullable=False,
    )

    # --- Scores ---
    # confidence_score - probability output from the model (0.0 to 1.0)
    # threshold_used   - the decision threshold applied (Youden's J optimised)
    confidence_score = Column(Numeric(5, 4), nullable=False)
    threshold_used = Column(Numeric(5, 4), nullable=False)

    # --- Explainability ---
    # Path to the Grad-CAM++ heatmap image stored on S3 or local storage
    gradcam_path = Column(Text, nullable=True)

    # Optic disc and cup segmentation results.
    # Populated by segmentation module when built.
    # Used for biomarker visualisation in the frontend.
    cdr = Column(Numeric(4, 3), nullable=True)          # Cup-to-Disc Ratio e.g. 0.720
    disc_radius = Column(Numeric(8, 2), nullable=True)  # Optic disc radius in pixels
    cup_radius = Column(Numeric(8, 2), nullable=True)   # Optic cup radius in pixels

    # --- OHTS Risk Score ---
    # Calculated from patient age, IOP, CCT, and CDR extracted from segmentation
    # ohts_score - raw numeric score
    # ohts_tier  - risk category derived from the score
    ohts_score = Column(Numeric(5, 2), nullable=True)
    ohts_tier = Column(
        Enum("low", "possible", "critical", name="ohts_tier_types"),
        nullable=True,
    )

    # --- Referral Letter ---
    # LLM-generated clinical referral letter text
    referral_letter = Column(Text, nullable=True)

    # Which LLM generated the referral letter
    llm_used = Column(
        Enum(
            "gpt4o",
            "gpt4o_mini",
            "llama",
            "gemini",
            name="llm_types",
        ),
        nullable=True,
    )

    # Time taken by the LLM to generate the referral letter in milliseconds.
    # Used for multi-LLM performance comparison in Research Mode.
    generation_time_ms = Column(Numeric(10, 2), nullable=True)

    # Clinician name who signs the referral letter.
    # Populated from system settings REFERRING_CLINICIAN_NAME on generation.
    # Can be updated per letter before printing via PUT /results/{id}/sign
    signed_by = Column(String(255), nullable=True)

    # --- Audit Trail: When ---
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

    # --- Audit Trail: Who ---
    created_by = Column(UUID(as_uuid=True), nullable=True)
    updated_by = Column(UUID(as_uuid=True), nullable=True)

    def __repr__(self):
        return f"<ScreeningResult {self.screening_results_id} model={self.model_used} prediction={self.prediction}>"