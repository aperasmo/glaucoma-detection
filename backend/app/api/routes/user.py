# backend/app/api/routes/user.py
#
# User management endpoints.
# Admin-only routes for managing clinic staff accounts.
# Users can also update their own profile after activation.

from uuid import UUID
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, logger, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.dependencies import get_current_user, require_role
from app.db.database import get_db
from app.models.user import User
from app.schemas.user import CreateUser, ResponseUser,UpdateUser
from app.utils.security import hash_password
from app.utils.validators import validate_password_strength
from datetime import datetime

from app.core.logger import get_logger
logger = get_logger(__name__)

router = APIRouter(prefix="/users", tags=["Users"])


@router.get("/", response_model=list[ResponseUser], status_code=status.HTTP_200_OK)
async def list_users(
    skip: int = 0,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    # List all users - admin only.
    result = await db.execute(
        select(User)
        .order_by(User.last_name)
        .offset(skip)
        .limit(limit)
    )
    return result.scalars().all()


@router.get("/me", response_model=ResponseUser, status_code=status.HTTP_200_OK)
async def get_my_profile(
    current_user: User = Depends(get_current_user),
):
    # Return the currently logged in user's profile.
    # Accessible to all authenticated roles.
    return current_user


@router.get("/{user_id}", response_model=ResponseUser, status_code=status.HTTP_200_OK)
async def get_user(
    user_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    # Get a single user by UUID - admin only.
    result = await db.execute(select(User).where(User.user_id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found."
        )
    return user


@router.put("/me", response_model=ResponseUser, status_code=status.HTTP_200_OK)
async def update_my_profile(
    user_data: UpdateUser,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Allow any authenticated user to update their own profile.
    update_data = user_data.model_dump(exclude_none=True)
    for field, value in update_data.items():
        setattr(current_user, field, value)

    current_user.updated_by = current_user.user_id
    current_user.updated_at = datetime.utcnow()

    return current_user


@router.put("/{user_id}", response_model=ResponseUser, status_code=status.HTTP_200_OK)
async def update_user(
    user_id: UUID,
    user_data: UpdateUser,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    # Update any user account - admin only.
    result = await db.execute(select(User).where(User.user_id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found."
        )

    update_data = user_data.model_dump(exclude_none=True)
    for field, value in update_data.items():
        setattr(user, field, value)

    user.updated_by = current_user.user_id
    user.updated_at = datetime.utcnow()

    return user


@router.delete("/{user_id}", response_model=ResponseUser, status_code=status.HTTP_200_OK)
async def deactivate_user(
    user_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    # Soft deactivate a user account - admin only.
    # Sets is_active=False - data is never deleted.
    result = await db.execute(select(User).where(User.user_id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found."
        )

    # Prevent admin from deactivating their own account
    if user.user_id == current_user.user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot deactivate your own account."
        )

    user.is_active = False
    user.updated_by = current_user.user_id
    user.updated_at = datetime.utcnow()

    return user

@router.put("/{user_id}/activate", response_model=ResponseUser, status_code=status.HTTP_200_OK)
async def activate_user(
    user_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    # Reactivate a previously deactivated user account - admin only.
    # Sets is_active=True so the user can log in again.
    result = await db.execute(select(User).where(User.user_id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found."
        )

    user.is_active = True
    user.updated_by = current_user.user_id
    user.updated_at = datetime.utcnow()

    logger.info(f"User {user.user_code} reactivated by {current_user.user_code}")

    return user

@router.put("/{user_id}/reset-password", response_model=ResponseUser, status_code=status.HTTP_200_OK)
async def reset_user_password(
    user_id: UUID,
    data: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    # Admin resets a user's password - admin only.
    # Requires new_password in the request body.
    # Password is validated against strength policy before saving.

    from app.utils.validators import validate_password_strength
    from app.utils.security import hash_password

    new_password = data.get("new_password")
    if not new_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="new_password is required."
        )

    try:
        validate_password_strength(new_password)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )

    result = await db.execute(select(User).where(User.user_id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found."
        )

    user.hashed_password = hash_password(new_password)
    user.updated_by = current_user.user_id
    user.updated_at = datetime.utcnow()

    logger.info(f"Password reset for user {user.user_code} by admin {current_user.user_code}")

    return user