# backend/app/models/screening.py
#
# Screening table - records each screening event for a patient.
# One patient can have multiple screenings over time (longitudinal tracking).
# Links to patients via patient_id and to users via screened_by.
# Status is enforced at the database level using PostgreSQL Enum.
# All changes are tracked via created_by/updated_by for audit trail.

import uuid
from datetime import datetime

from sqlalchemy import Column, DateTime, Enum, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.db.database import Base


class Screening(Base):
    __tablename__ = "screenings"

    # --- Primary Key ---
    screening_id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        index=True,
    )

    # --- Foreign Keys ---
    # Links to the patient being screened
    patient_id = Column(
        UUID(as_uuid=True),
        ForeignKey("patients.patient_id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )

    # Links to the user (nurse/doctor) who performed the screening
    screened_by = Column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="RESTRICT"),
        nullable=False,
    )

    # --- Image ---
    # Path to the uploaded fundus image stored on S3 or local storage
    image_path = Column(Text, nullable=False)

    # --- Eye Side ---
    # Which eye was screened
    eye_side = Column(
        Enum("left", "right", name="eye_side_types"),
        nullable=False,
    )

    # --- Status ---
    # Tracks the screening pipeline progress
    # pending    - image uploaded, waiting to be processed
    # processing - ML inference running
    # complete   - results ready
    # failed     - something went wrong during processing
    status = Column(
        Enum("pending", "processing", "complete", "failed", name="screening_status"),
        nullable=False,
        default="pending",
    )

    # Stores the mode used when this screening was generated.
    # This prevents a screening from changing view just because the global
    # INFERENCE_MODE setting is changed later.
    inference_mode = Column(
        Enum("clinical", "research", name="inference_modes"),
        nullable=False,
        default="clinical",
        index=True,
    )

    # --- Remarks ---
    remarks = Column(Text, nullable=True)

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

    # --- Relationships ---
    # Allows Python-level access: screening.patient, screening.results
    patient = relationship("Patient", backref="screenings")
    screened_by_user = relationship("User", backref="screenings")
    results = relationship("ScreeningResult", backref="screening")

    def __repr__(self):
        return f"<Screening {self.screening_id} patient={self.patient_id} status={self.status}>"