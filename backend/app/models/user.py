# clinic staff accounts. roles are locked to a fixed set via a Postgres enum,
# passwords only ever get stored as bcrypt hashes, and created_by/updated_by
# give us an audit trail.

import uuid
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Enum, String, Text,Integer
from sqlalchemy.dialects.postgresql import UUID

from app.db.database import Base


class User(Base):
    __tablename__ = "users"

    # --- Primary Key ---
    # UUID so ids can't just be guessed by incrementing a counter
    user_id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        index=True,
    )

    # --- User Code ---
    # human-readable id, e.g. USR0001
    user_code = Column(String(20), unique=True, nullable=False, index=True)

    # --- Name Fields ---
    last_name = Column(String(255), nullable=False)
    first_name = Column(String(255), nullable=False)

    # --- Security ---
    # bcrypt hash only, never the raw password
    hashed_password = Column(Text, nullable=False)

    # --- Role-Based Access Control ---
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
    # flip to False to disable an account without deleting anything
    is_active = Column(Boolean, default=True, nullable=False)

    # login lockout tracking
    failed_login_attempts = Column(Integer, nullable=False, default=0)
    is_locked = Column(Boolean, nullable=False, default=False)

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
    # nullable because the very first admin account doesn't have a creator
    created_by = Column(UUID(as_uuid=True), nullable=True)
    updated_by = Column(UUID(as_uuid=True), nullable=True)

    is_researcher = Column(Boolean, nullable=False, default=False)

    def __repr__(self):
        # deliberately leaves the password out
        return f"<User {self.user_code} {self.last_name}, {self.first_name} role={self.role}>"