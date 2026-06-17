# backend/app/api/routes/auth.py
#
# Authentication routes - registration, activation, login.
# All public endpoints - no authentication required to access these.
# Returns JWT token on successful login.

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.schemas.user import CreateUser, ResponseUser
from app.services.user_service import create_user, activate_user ,get_user_by_email
from app.utils.email import send_activation_email

from fastapi.security import OAuth2PasswordRequestForm
from app.utils.security import verify_password
from app.utils.jwt import create_access_token


from app.core.dependencies import get_current_user
from app.models.user import User
from app.core.logger import get_logger

from app.utils.settings_helper import get_setting
from app.utils.notifications import send_account_locked_notification

logger = get_logger(__name__)


router = APIRouter(prefix="/auth", tags=["Authentication"])


@router.post("/register", response_model=ResponseUser, status_code=status.HTTP_201_CREATED)
async def register_user(
    user_data: CreateUser,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    # Admin creates a new user account.
    # Account is inactive until the user clicks the activation link.
    # Activation email is sent automatically after creation.
    # TODO: Add admin-only protection after auth middleware is ready.

    try:
        new_user, activation_token = await create_user(
            db=db,
            user_data=user_data,
            created_by=None,  # Will be replaced with current admin's user_id after auth is wired
        )
        # Send activation email as a background task - does not block the response.
        background_tasks.add_task(
            send_activation_email,
            recipient_email=new_user.email,
            full_name=f"{new_user.first_name} {new_user.last_name}",
            token=activation_token,
        )
        return new_user

    except ValueError as e:
        logger.warning(f"User registration failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )


@router.get("/activate", status_code=status.HTTP_200_OK)
async def activate_account(token: str, db: AsyncSession = Depends(get_db)):
    # Activate a user account using the token from the activation email.
    # Called when the user clicks the activation link.

    try:
        user = await activate_user(db=db, token=token)
        return {"message": "Account activated successfully. You can now log in."}

    except ValueError as e:
        logger.warning(f"Account activation failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )


@router.post("/login", status_code=status.HTTP_200_OK)
async def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: AsyncSession = Depends(get_db),
):
    # Authenticate user and return JWT access token.
    # Accepts OAuth2 standard form data - email as username, password.
    # Returns bearer token on success.
    # Blocks inactive accounts from logging in.
    # Tracks failed login attempts - locks account after 5 failures.

    try:
        # Fetch user by email
        user = await get_user_by_email(db, form_data.username)

        # Reject if user not found - same generic message, never reveal which one failed
        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Incorrect email or password.",
                headers={"WWW-Authenticate": "Bearer"},
            )

        # Reject if account is already locked due to past failed attempts
        if user.is_locked:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "detail": "Account deactivated due to multiple failed login attempts. Contact your administrator.",
                    "error_code": "ACCOUNT_LOCKED",
                },
            )

        # Reject inactive accounts (admin deactivated, not lockout related)
        if not user.is_active:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Account is inactive. Please activate your account first or contact your System Administrator.",
            )

        # Verify password
        if not verify_password(form_data.password, user.hashed_password):
            # Increment failed attempts counter
            user.failed_login_attempts += 1

            # Lock the account if 5 failed attempts reached
            if user.failed_login_attempts >= 5:
                user.is_locked = True
                user.is_active = False
                await db.commit()

                logger.warning(
                    f"Account locked due to failed login attempts: {user.email}"
                )

                # Send lockout notification email
                notification_email = await get_setting(
                    db, "NOTIFICATION_EMAIL",
                    default="aiglaucomascreeningsystem@gmail.com"
                )
                send_account_locked_notification(
                    user_name=f"{user.first_name} {user.last_name}",
                    user_email=user.email,
                    notification_email=notification_email,
                )

                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail={
                        "detail": "Account deactivated due to multiple failed login attempts. Contact your administrator.",
                        "error_code": "ACCOUNT_LOCKED",
                    },
                )

            await db.commit()

            attempts_remaining = 5 - user.failed_login_attempts
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={
                    "detail": "Incorrect email or password.",
                    "attempts_remaining": attempts_remaining,
                },
                headers={"WWW-Authenticate": "Bearer"},
            )

        # Login successful - reset failed attempts counter
        user.failed_login_attempts = 0
        await db.commit()

        # Generate JWT token with user_id as the subject
        access_token = create_access_token(data={"sub": str(user.user_id)})

        logger.info(f"Login successful: {user.email}")

        return {
            "access_token": access_token,
            "token_type": "bearer",
            "user": {
                "user_id": str(user.user_id),
                "user_code": user.user_code,
                "full_name": f"{user.first_name} {user.last_name}",
                "role": user.role,
            }
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Login failed unexpectedly: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Login failed due to a server error.",
        )

@router.get("/me", status_code=status.HTTP_200_OK)
async def get_me(current_user: User = Depends(get_current_user)):
    # Returns the currently logged in user's profile.
    # Protected - requires valid JWT token.
    return {
        "user_id": str(current_user.user_id),
        "user_code": current_user.user_code,
        "full_name": f"{current_user.first_name} {current_user.last_name}",
        "email": current_user.email,
        "role": current_user.role,
        "is_active": current_user.is_active,
    }