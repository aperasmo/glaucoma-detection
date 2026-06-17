# backend/app/models/user.py
#
# User table - clinic staff who log into the system.
# Roles are enforced at the database level using PostgreSQL Enum.
# Passwords are never stored as plain text - only bcrypt hashes.
# All changes are tracked via created_by/updated_by for audit trail.

import uuid
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Enum, String, Text,Integer
from sqlalchemy.dialects.postgresql import UUID

from app.db.database import Base


class User(Base):
    __tablename__ = "users"

    # --- Primary Key ---
    # UUID prevents ID enumeration attacks (cannot guess other users by incrementing)
    user_id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        index=True,
    )

    # --- User Code ---
    # Human-readable identifier for the user e.g. USR0001
    # unique=True ensures no duplicate codes
    user_code = Column(String(20), unique=True, nullable=False, index=True)

    # --- Name Fields ---
    last_name = Column(String(255), nullable=False)
    first_name = Column(String(255), nullable=False)

    # --- Security ---
    # Only the bcrypt hash is stored - never the real password
    hashed_password = Column(Text, nullable=False)

    # --- Role-Based Access Control ---
    # PostgreSQL enforces valid values at the DB level
    # admin  - full access, user management, system settings
    # doctor - view results, generate referral letters, manage patients
    # nurse  - upload images, register patients, view basic results
    role = Column(
        Enum("admin", "doctor", "nurse", name="user_roles"),
        nullable=False,
        default="doctor",
    )

    # --- Contact Info ---
    address = Column(Text, nullable=True)
    contact_person = Column(String(255), nullable=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    landline_number = Column(String(50), nullable=True)
    mobile_number = Column(String(50), nullable=True)

    # --- Account Status ---
    # is_active=False disables the account without deleting data
    is_active = Column(Boolean, default=True, nullable=False)

    # Login lockout tracking
    failed_login_attempts = Column(Integer, nullable=False, default=0)
    is_locked = Column(Boolean, nullable=False, default=False)

    # --- Remarks ---
    # Free text notes about the user account
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
    # Links to user_id of the staff who created or last modified this record
    # nullable=True because the first admin account has no creator
    created_by = Column(UUID(as_uuid=True), nullable=True)
    updated_by = Column(UUID(as_uuid=True), nullable=True)

    def __repr__(self):
        # Safe representation - never includes password
        return f"<User {self.user_code} {self.last_name}, {self.first_name} role={self.role}>"