# backend/app/models/system_settings.py
#
# SystemSettings table - stores all application-wide configuration.
# Replaces hardcoded settings with database-driven values.
# Admin can change settings via API without restarting the server.
# Example entries:
#   category=System, set_code=INFERENCE_MODE, set_value=clinical
#   category=System, set_code=EMAIL_NOTIFICATIONS, set_value=true

from datetime import datetime
from sqlalchemy import Column, DateTime, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID

from app.db.database import Base


class SystemSettings(Base):
    __tablename__ = "system_settings"

    # --- Primary Key ---
    # Auto-incrementing integer - simple and appropriate for a settings table
    id = Column(Integer, primary_key=True, autoincrement=True, index=True)

    # --- Setting Identity ---
    # category groups related settings e.g. "System", "ML", "Email"
    category = Column(String(30), nullable=True, default="System")

    # set_code is the unique key used to look up a setting e.g. "INFERENCE_MODE"
    set_code = Column(String(30), nullable=False, unique=True, index=True)

    # set_name is the human-readable label e.g. "Inference Mode"
    set_name = Column(String(50), nullable=True)

    # set_value stores the actual setting value as a string e.g. "clinical", "true"
    # All values stored as strings - cast to correct type when reading
    set_value = Column(String(500), nullable=True)

    # --- Remarks ---
    remark = Column(Text, nullable=True)

    # --- Status ---
    # A=Active, I=Inactive - single character flag
    status = Column(String(1), nullable=True, default="A")

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
        return f"<SystemSettings {self.set_code}={self.set_value}>"