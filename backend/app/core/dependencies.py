# backend/app/core/dependencies.py
#
# FastAPI dependency functions for protected routes.
# Inject get_current_user into any route that requires authentication.
# Inject require_role to restrict access by role.

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db.database import get_db
from app.models.user import User
from app.utils.jwt import decode_access_token

# Tells FastAPI the token comes from Authorization: Bearer <token> header
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    # Extract and validate the current user from the JWT token.
    # Raises 401 if token is missing, invalid, or expired.
    # Raises 403 if the account is inactive.

    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired token.",
        headers={"WWW-Authenticate": "Bearer"},
    )

    payload = decode_access_token(token)
    if not payload:
        raise credentials_exception

    user_id = payload.get("sub")
    if not user_id:
        raise credentials_exception

    result = await db.execute(select(User).where(User.user_id == user_id))
    user = result.scalar_one_or_none()

    if not user:
        raise credentials_exception

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is inactive. Please activate your account first.",
        )

    return user


def require_role(*roles: str):
    # Restrict a route to specific roles.
    # Usage: Depends(require_role("admin"))
    # Usage: Depends(require_role("admin", "doctor"))

    async def role_checker(current_user: User = Depends(get_current_user)) -> User:
        if current_user.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied. Required role: {', '.join(roles)}.",
            )
        return current_user

    return role_checker