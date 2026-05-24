# backend/app/services/user_service.py
#
# Business logic for user management.
# Handles user creation, user code generation, and account activation.
# Kept separate from routes so logic can be reused and tested independently.

import uuid
import secrets
from datetime import datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.models.user import User
from app.models.user_tokens import UserTokens
from app.schemas.user import CreateUser
from app.utils.security import hash_password
from app.utils.validators import validate_email_format
from app.core.logger import get_logger

logger = get_logger(__name__)


async def generate_user_code(db: AsyncSession) -> str:
    # Count existing users and generate the next sequential code.
    # Pads to 5 digits e.g. USR00001, USR00002.
    result = await db.execute(select(func.count()).select_from(User))
    count = result.scalar()
    return f"USR{str(count + 1).zfill(5)}"


async def get_user_by_email(db: AsyncSession, email: str):
    # Fetch a single user by email address.
    # Returns None if not found - used to check for duplicate emails.
    result = await db.execute(select(User).where(User.email == email))
    return result.scalar_one_or_none()


async def get_user_by_id(db: AsyncSession, user_id: uuid.UUID):
    # Fetch a single user by their UUID.
    # Returns None if not found.
    result = await db.execute(select(User).where(User.user_id == user_id))
    return result.scalar_one_or_none()


async def create_activation_token(db: AsyncSession, user_id: uuid.UUID) -> str:
    # Generate a cryptographically secure activation token.
    # Saves it to user_tokens with a 48 hour expiry.
    # Returns the raw token string for inclusion in the activation email.
    # secrets.token_urlsafe is cryptographically secure - safe for auth tokens.

    raw_token = secrets.token_urlsafe(32)

    token_record = UserTokens(
        user_id=user_id,
        token=raw_token,
        token_type="activation",
        is_used=False,
        expires_at=datetime.utcnow() + timedelta(hours=48),
        created_by=user_id,
    )
    db.add(token_record)

    return raw_token


async def create_user(
    db: AsyncSession,
    user_data: CreateUser,
    created_by: uuid.UUID,
) -> tuple[User, str]:
    # Create a new inactive user account and generate an activation token.
    # Steps:
    # 1. Validate email format
    # 2. Check for duplicate email
    # 3. Generate user code
    # 4. Hash the password
    # 5. Save the user as inactive
    # 6. Generate and save activation token
    # Returns a tuple of (User, activation_token_string).

    # Step 1 - Validate email format
    validate_email_format(user_data.email)

    # Step 2 - Check for duplicate email - reject early to avoid wasted DB writes
    existing = await get_user_by_email(db, user_data.email)
    if existing:
        raise ValueError("A user with this email already exists.")

    # Step 3 - Generate sequential user code
    user_code = await generate_user_code(db)

    # Step 4 - Hash the password - never store plain text
    hashed = hash_password(user_data.password)

    # Step 5 - Build the user record - inactive until email is confirmed
    new_user = User(
        user_code=user_code,
        first_name=user_data.first_name,
        last_name=user_data.last_name,
        email=user_data.email,
        hashed_password=hashed,
        role=user_data.role,
        is_active=False,
        created_by=created_by,
        updated_by=created_by,
    )
    db.add(new_user)

    # Flush to get the user_id assigned before creating the token
    await db.flush()

    # Step 6 - Generate activation token linked to the new user
    activation_token = await create_activation_token(db, new_user.user_id)

    return new_user, activation_token


async def activate_user(db: AsyncSession, token: str) -> User:
    # Activate a user account using the token from the activation email.
    # Validates the token is genuine, unused, and not expired.
    # Marks the token as used so it cannot be replayed.
    # Returns the activated User object.

    # Find the token record
    result = await db.execute(
        select(UserTokens).where(UserTokens.token == token)
    )
    token_record = result.scalar_one_or_none()

    # Reject missing tokens - do not reveal whether it ever existed
    if not token_record:
        raise ValueError("Invalid activation token.")

    # Reject already used tokens - prevents replay attacks
    if token_record.is_used:
        raise ValueError("This activation link has already been used.")

    # Reject expired tokens
    if token_record.expires_at < datetime.utcnow():
        raise ValueError("This activation link has expired.")

    # Reject wrong token type - defence against token type confusion attacks
    if token_record.token_type != "activation":
        raise ValueError("Invalid token type.")

    # Fetch the user linked to this token
    result = await db.execute(
        select(User).where(User.user_id == token_record.user_id)
    )
    user = result.scalar_one_or_none()

    if not user:
        raise ValueError("User not found.")

    # Activate the account
    user.is_active = True
    user.updated_by = user.user_id
    user.updated_at = datetime.utcnow()

    # Mark token as used - one time use only
    token_record.is_used = True

    return user