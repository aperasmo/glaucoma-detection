# auth tokens for users - activation links, password resets, that kind of
# thing. each one belongs to a user and expires eventually.


import uuid
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Enum, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID

from app.db.database import Base


class UserTokens(Base):
    __tablename__ = "user_tokens"

    # --- Primary Key ---
    # UUID so ids aren't guessable by incrementing
    token_id  = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        index=True,
    )

    # --- Foreign Keys ---
    user_id  = Column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )

    # --- token ---
    token = Column(String(255), unique=True, nullable=False, index=True)


    # --- token_type  ----
    # lets us reuse this table for different purposes instead of one table per type
    token_type = Column(
        Enum("activation", "password_reset", name="token_type_enum"),
        nullable=False,
    )

    # --- MFA tokens ---
    # placeholder for when we add MFA - not used yet
    mfa_secret = Column(String(255), nullable=True)



    # --- Token Status ---
    is_used  = Column(Boolean, default=False, nullable=False)

    # --- Expiry ---
    # set by the app at creation time
    expires_at = Column(DateTime, nullable=False)

    # --- Audit Trail: When ---
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


    # --- Audit Trail: Who ---
    # only really used for admin-triggered tokens
    created_by = Column(UUID(as_uuid=True), nullable=True)

    def __repr__(self):
        return f"<UserTokens token_id={self.token_id} user_id={self.user_id}>"