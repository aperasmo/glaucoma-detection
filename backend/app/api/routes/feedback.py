# backend/app/api/routes/feedback.py
#
# Feedback submission endpoint.
# Sends feedback email to ALERT_EMAIL from system settings.
# No DB persistence - email only.

from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, status
from pydantic import BaseModel, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logger import get_logger
from app.core.dependencies import get_current_user
from app.db.database import get_db
from app.models.user import User
from app.utils.notifications import send_feedback_notification
from app.utils.settings_helper import get_setting

logger = get_logger(__name__)

router = APIRouter(prefix="/feedback", tags=["Feedback"])


class CreateFeedback(BaseModel):
    name: str
    email: str
    type: str
    subject: str
    description: str

    @field_validator("subject", "description")
    @classmethod
    def must_not_be_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("Field cannot be empty.")
        return v.strip()


@router.post("/", status_code=status.HTTP_200_OK)
async def submit_feedback(
    payload: CreateFeedback,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Accepts feedback from any authenticated user.
    # Reads ALERT_EMAIL from system settings and sends an email.
    # Runs the email send as a background task so the response
    # is immediate regardless of SMTP latency.

    try:
        print(f"[feedback] Received feedback from {current_user.user_code} | type={payload.type}")

        alert_email = await get_setting(db, "ALERT_EMAIL", default="")

        if not alert_email or not alert_email.strip():
            logger.error("[feedback] ALERT_EMAIL not configured in system settings.")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Alert email not configured.",
            )

        timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")

        background_tasks.add_task(
            send_feedback_notification,
            alert_email=alert_email.strip(),
            name=payload.name,
            email=payload.email,
            feedback_type=payload.type,
            subject=payload.subject,
            description=payload.description,
            timestamp=timestamp,
        )

        logger.info(f"[feedback] Email queued to {alert_email} | type={payload.type} | subject={payload.subject}")

        return {"message": "Feedback sent successfully."}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[feedback] Failed to process feedback: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to send feedback. Please try again.",
        )