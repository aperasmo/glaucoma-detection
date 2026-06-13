# backend/app/models/user_tokens.py
#
# user_tokens - stores authentication tokens for users.
# Each token is linked to a user and has an expiration time.


import uuid
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Enum, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID

from app.db.database import Base


class UserTokens(Base):
    __tablename__ = "user_tokens"

    # --- Primary Key ---
    # UUID prevents ID enumeration attacks (cannot guess other users by incrementing)
    token_id  = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        index=True,
    )

    # --- Foreign Keys ---
    # Links to the user who owns the token
    user_id  = Column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )

    # --- token ---
    # Human-readable identifier for the token e.g. TOK0001
    # unique=True ensures no duplicate tokens
    token = Column(String(255), unique=True, nullable=False, index=True)


    # --- token_type  ----
    # Type of token (e.g. activation, password_reset) - useful for managing multiple token types
    token_type = Column(
        Enum("activation", "password_reset", name="token_type_enum"),
        nullable=False,
    )    

    # --- MFA tokens ---
    # For tokens used in Multi-Factor Authentication (MFA), we can add fields like:
    mfa_secret = Column(String(255), nullable=True)  # Store MFA secret
    


    # --- Token Status ---
    # is_used=False indicates the token has been used
    is_used  = Column(Boolean, default=False, nullable=False)

    # --- Expiry ---
    # Token expiry datetime - set at creation time by the application
    expires_at = Column(DateTime, nullable=False)

    # --- Audit Trail: When ---
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)    


    # --- Audit Trail: Who ---
    # Optionally track which user created/updated the token (useful for admin actions)
    created_by = Column(UUID(as_uuid=True), nullable=True)

    def __repr__(self):
        # Safe representation - never includes password
        return f"<UserTokens token_id={self.token_id} user_id={self.user_id}>"