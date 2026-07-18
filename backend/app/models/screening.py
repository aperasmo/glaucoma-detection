# one row per screening event. patients can have many of these over time so
# we can track them longitudinally. links back to the patient and to whoever
# ran the screening.

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
    patient_id = Column(
        UUID(as_uuid=True),
        ForeignKey("patients.patient_id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )

    # the nurse/doctor who ran the screening
    screened_by = Column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="RESTRICT"),
        nullable=False,
    )

    # --- Image ---
    # where the fundus image lives, S3 or local storage depending on setup
    image_path = Column(Text, nullable=False)

    # --- Eye Side ---
    eye_side = Column(
        Enum("left", "right", name="eye_side_types"),
        nullable=False,
    )

    # --- Status ---
    # pending -> processing -> complete, or failed if something breaks along the way
    status = Column(
        Enum("pending", "processing", "complete", "failed", name="screening_status"),
        nullable=False,
        default="pending",
    )

    # locked in at creation time so a screening doesn't silently change
    # appearance later if the global INFERENCE_MODE setting gets flipped
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
    # gives us screening.patient, screening.results, etc. on the Python side
    patient = relationship("Patient", backref="screenings")
    screened_by_user = relationship("User", backref="screenings")
    results = relationship("ScreeningResult", backref="screening")

    def __repr__(self):
        return f"<Screening {self.screening_id} patient={self.patient_id} status={self.status}>"