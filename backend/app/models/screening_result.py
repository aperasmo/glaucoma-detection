# ML prediction results, one row per model that ran plus one for the
# ensemble. Clinical Mode only shows the ensemble row to the user; Research
# Mode shows all of them side by side for comparison.

import uuid
from datetime import datetime

from sqlalchemy import Column, DateTime, Enum, ForeignKey, Numeric, String, Text,Integer,Boolean
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
    screening_id = Column(
        UUID(as_uuid=True),
        ForeignKey("screenings.screening_id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )

    # --- ML Model Info ---
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
    prediction = Column(
        Enum("glaucoma", "normal", name="prediction_types"),
        nullable=False,
    )

    # --- Scores ---
    # confidence_score is the raw model output (0.0-1.0), threshold_used is
    # the cutoff we applied to turn that into glaucoma/normal (Youden's J optimised)
    confidence_score = Column(Numeric(5, 4), nullable=False)
    threshold_used = Column(Numeric(5, 4), nullable=False)

    # --- Explainability ---
    # Grad-CAM++ heatmap, S3 or local depending on env
    gradcam_path = Column(Text, nullable=True)

    # disc/cup segmentation output - filled in once the segmentation module is
    # wired up, used for the biomarker visuals on the frontend
    cdr = Column(Numeric(4, 3), nullable=True)          # cup-to-disc ratio, e.g. 0.720
    disc_radius = Column(Numeric(8, 2), nullable=True)  # optic disc radius, pixels
    cup_radius = Column(Numeric(8, 2), nullable=True)   # optic cup radius, pixels

    # --- OHTS Risk Score ---
    # derived from patient age, IOP, CCT, and the CDR from segmentation above
    ohts_score = Column(Numeric(5, 2), nullable=True)
    ohts_tier = Column(
        Enum("low", "possible", "critical", name="ohts_tier_types"),
        nullable=True,
    )

    # --- Referral Letter ---
    referral_letter = Column(Text, nullable=True)

    # which LLM wrote the letter
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

    # how long the LLM took to write the letter, in ms - feeds the multi-LLM
    # comparison in Research Mode
    generation_time_ms = Column(Numeric(10, 2), nullable=True)

    # token counts per LLM call, mainly so we can compare cost/quality across
    # providers later. only set on referral letter rows (llm_used not null) -
    # stays NULL on the ensemble row and the 3 individual model rows.
    # OpenAI/Groq return these field names natively; Gemini calls them
    # something else in usage_metadata, so llm_referral.py remaps them to
    # match before this gets saved.
    prompt_tokens  = Column(Integer, nullable=True)
    completion_tokens = Column(Integer, nullable=True)
    total_tokens = Column(Integer, nullable=True)

    # model disagreement tracking, Clinical Mode only - kicks in when the
    # ensemble says normal but one of the individual models crossed its own
    # sensitivity threshold (B0>=0.52, VGG16/V2>=0.47) anyway.
    # disagreement_model holds which model flagged it (e.g. "efficientnetv2"),
    # disagreement_confidence is that model's raw score, and letter_type is
    # "clinical" for the normal GPT-4o letter vs "disagreement" for the
    # on-demand second opinion (NULL if it's not a letter row at all).
    has_model_disagreement = Column(Boolean, nullable=True, default=False)
    disagreement_model = Column(String(50), nullable=True)
    disagreement_confidence = Column(Numeric(10, 4), nullable=True)
    letter_type = Column(String(20), nullable=True)

    # who signs the referral letter - defaults from the REFERRING_CLINICIAN_NAME
    # system setting when generated, but can be overridden per letter before
    # printing via PUT /results/{id}/sign
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