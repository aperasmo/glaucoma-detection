# backend/app/utils/jwt.py
#
# JWT token generation and validation.
# Used for authenticating API requests after login.
# Tokens are signed with the SECRET_KEY from settings.
# Never store sensitive data inside the token payload.

from datetime import datetime, timedelta
from typing import Optional

from jose import JWTError, jwt

from app.core.config import settings


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    # Generate a signed JWT access token.
    # data should contain the user identity - typically {"sub": str(user_id)}.
    # Token expires after ACCESS_TOKEN_EXPIRE_MINUTES by default.

    to_encode = data.copy()

    # Set expiry time
    expire = datetime.utcnow() + (
        expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES) #  Use provided expiry or default from settings
    )
    to_encode.update({"exp": expire})

    # Sign and return the token
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def decode_access_token(token: str) -> Optional[dict]:
    # Decode and validate a JWT token.
    # Returns the payload dict if valid, None if invalid or expired.
    # Called on every protected request to verify the caller's identity.

    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM]) # Decode the token using the same secret and algorithm
        return payload
    except JWTError:
        return None