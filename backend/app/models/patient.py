# backend/app/models/patient.py
#
# Patient table - stores clinic patient records.
# IOP and CCT are stored here for OHTS risk score calculation.
# Gender is enforced at the database level using PostgreSQL Enum.
# All changes are tracked via created_by/updated_by for audit trail.

import uuid
from datetime import datetime

from sqlalchemy import Boolean, Column, Date, DateTime, Enum, String, Text, Numeric
from sqlalchemy.dialects.postgresql import UUID

from app.db.database import Base


class Patient(Base):
    __tablename__ = "patients"

    # --- Primary Key ---
    patient_id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        index=True,
    )

    # --- Patient Code ---
    # Human-readable identifier e.g. PAT0001
    patient_code = Column(String(20), unique=True, nullable=False, index=True)

    # --- Name Fields ---
    last_name = Column(String(255), nullable=False)
    first_name = Column(String(255), nullable=False)

    # --- Personal Info ---
    dob = Column(Date, nullable=True)

    # Gender enforced at DB level
    gender = Column(
        Enum(
            "male",
            "female",
            "non-binary",
            "another gender",
            "prefer not to say",
            name="gender_types",
        ),
        nullable=True,
    )

    # --- Contact Info ---
    contact_person = Column(String(255), nullable=True)
    email = Column(String(255), nullable=True)
    landline_number = Column(String(50), nullable=True)
    mobile_number = Column(String(50), nullable=True)

    # --- Account Status ---
    is_active = Column(Boolean, default=True, nullable=False)

    # --- Clinical Fields ---
    # IOP - Intraocular Pressure in mmHg - used for OHTS risk score
    # CCT - Central Corneal Thickness in micrometres - used for OHTS risk score
    # Both are optional - OHTS score is skipped if either is missing
    iop = Column(Numeric(5, 2), nullable=True)
    cct = Column(Numeric(7, 2), nullable=True)

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

    def __repr__(self):
        return f"<Patient {self.patient_code} {self.last_name}, {self.first_name}>"