# backend/app/utils/notifications.py
#
# High-risk screening notification emails.
# Sends alert to the shared clinic email when a screening flags glaucoma
# with OHTS tier matching the configured notification threshold.
# Patient does not receive any email - clinic staff are notified only.

import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional

from app.core.config import settings
from app.core.logger import get_logger

logger = get_logger(__name__)


def send_high_risk_notification(
    patient_name: str,
    patient_code: str,
    eye_side: str,
    confidence_score: float,
    ohts_score: Optional[int],
    ohts_tier: Optional[str],
    screening_id: str,
    notification_email: str,
) -> None:
    # Send a high-risk screening alert to the shared clinic email.
    # Called as a background task after inference completes.
    # Never blocks the main inference pipeline.

    subject = f"[Glaucoma AI] High-Risk Alert - {patient_code} - {patient_name}"

    text_body = f"""
Glaucoma AI High-Risk Screening Alert

Patient: {patient_name} ({patient_code})
Eye Screened: {eye_side.capitalize()} eye
AI Confidence Score: {confidence_score:.1%}
OHTS Risk Score: {ohts_score if ohts_score is not None else 'N/A'}
OHTS Tier: {ohts_tier.upper() if ohts_tier else 'N/A'}
Screening ID: {screening_id}

This patient has been flagged as glaucoma-suspicious by the AI screening system.
A referral letter has been automatically generated and is available in the system.

Please review and arrange specialist referral as appropriate.

This is an automated alert from Glaucoma AI Screening System.
    """

    html_body = f"""
    <html>
    <body style="font-family: Arial, sans-serif; color: #333;">
        <h2 style="color: #dc2626;">Glaucoma AI - High-Risk Screening Alert</h2>
        <table style="border-collapse: collapse; width: 100%;">
            <tr>
                <td style="padding: 8px; border: 1px solid #ddd;"><strong>Patient</strong></td>
                <td style="padding: 8px; border: 1px solid #ddd;">{patient_name} ({patient_code})</td>
            </tr>
            <tr>
                <td style="padding: 8px; border: 1px solid #ddd;"><strong>Eye Screened</strong></td>
                <td style="padding: 8px; border: 1px solid #ddd;">{eye_side.capitalize()} eye</td>
            </tr>
            <tr>
                <td style="padding: 8px; border: 1px solid #ddd;"><strong>AI Confidence Score</strong></td>
                <td style="padding: 8px; border: 1px solid #ddd;">{confidence_score:.1%}</td>
            </tr>
            <tr>
                <td style="padding: 8px; border: 1px solid #ddd;"><strong>OHTS Risk Score</strong></td>
                <td style="padding: 8px; border: 1px solid #ddd;">{ohts_score if ohts_score is not None else 'N/A'}</td>
            </tr>
            <tr>
                <td style="padding: 8px; border: 1px solid #ddd;"><strong>OHTS Tier</strong></td>
                <td style="padding: 8px; border: 1px solid #ddd; color: #dc2626;">
                    <strong>{ohts_tier.upper() if ohts_tier else 'N/A'}</strong>
                </td>
            </tr>
            <tr>
                <td style="padding: 8px; border: 1px solid #ddd;"><strong>Screening ID</strong></td>
                <td style="padding: 8px; border: 1px solid #ddd;">{screening_id}</td>
            </tr>
        </table>
        <br/>
        <p>This patient has been flagged as glaucoma-suspicious by the AI screening system.</p>
        <p>A referral letter has been automatically generated and is available in the system.</p>
        <p><strong>Please review and arrange specialist referral as appropriate.</strong></p>
        <hr/>
        <p style="font-size:12px; color:#888;">
            This is an automated alert from Glaucoma AI Screening System.
        </p>
    </body>
    </html>
    """

    message = MIMEMultipart("alternative")
    message["Subject"] = subject
    message["From"] = settings.SMTP_SENDER
    message["To"] = notification_email

    message.attach(MIMEText(text_body, "plain"))
    message.attach(MIMEText(html_body, "html"))

    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
        server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
        server.sendmail(
            settings.SMTP_SENDER,
            notification_email,
            message.as_string(),
        )

def send_account_locked_notification(
    user_name: str,
    user_email: str,
    notification_email: str,
) -> None:
    # Send an account lockout alert to the shared clinic email.
    # Called when a user reaches 5 failed login attempts.
    # Notifies the admin/clinic email, not the locked user.

    from datetime import datetime
    lockout_time = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC")

    subject = "Account Locked - Glaucoma AI"

    text_body = f"""
Glaucoma AI Account Locked Alert

User: {user_name}
Email: {user_email}
Locked at: {lockout_time}

This account has been automatically deactivated after 5 consecutive failed
login attempts. The user will need an administrator to reactivate the account
and reset their password before they can log in again.

This is an automated alert from Glaucoma AI Screening System.
    """

    html_body = f"""
    <html>
    <body style="font-family: Arial, sans-serif; color: #333;">
        <h2 style="color: #dc2626;">Glaucoma AI - Account Locked Alert</h2>
        <table style="border-collapse: collapse; width: 100%;">
            <tr>
                <td style="padding: 8px; border: 1px solid #ddd;"><strong>User</strong></td>
                <td style="padding: 8px; border: 1px solid #ddd;">{user_name}</td>
            </tr>
            <tr>
                <td style="padding: 8px; border: 1px solid #ddd;"><strong>Email</strong></td>
                <td style="padding: 8px; border: 1px solid #ddd;">{user_email}</td>
            </tr>
            <tr>
                <td style="padding: 8px; border: 1px solid #ddd;"><strong>Locked at</strong></td>
                <td style="padding: 8px; border: 1px solid #ddd;">{lockout_time}</td>
            </tr>
        </table>
        <br/>
        <p>This account has been automatically deactivated after 5 consecutive failed login attempts.</p>
        <p><strong>An administrator must reactivate the account and reset the password before this user can log in again.</strong></p>
        <hr/>
        <p style="font-size:12px; color:#888;">
            This is an automated alert from Glaucoma AI Screening System.
        </p>
    </body>
    </html>
    """

    message = MIMEMultipart("alternative")
    message["Subject"] = subject
    message["From"] = settings.SMTP_SENDER
    message["To"] = notification_email

    message.attach(MIMEText(text_body, "plain"))
    message.attach(MIMEText(html_body, "html"))

    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
        server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
        server.sendmail(
            settings.SMTP_SENDER,
            notification_email,
            message.as_string(),
        )        

# --- Append below send_account_locked_notification() in backend/app/utils/notifications.py ---
# Keep everything above it exactly as is.


def send_feedback_notification(
    alert_email: str,
    name: str,
    email: str,
    feedback_type: str,
    subject: str,
    description: str,
    timestamp: str,
) -> None:
    # Send feedback email to the configured alert address.
    # Matches the same SMTP_SSL pattern as the other notification functions.

    import smtplib
    from email.mime.text import MIMEText
    from email.mime.multipart import MIMEMultipart

    msg = MIMEMultipart()
    msg["Subject"] = f"[GlaucomaAI Feedback] {feedback_type} - {subject}"
    msg["From"] = settings.SMTP_SENDER
    msg["To"] = alert_email

    body = f"""GlaucomaAI Feedback Submission
    ==============================
    Timestamp:   {timestamp}
    From:        {name}
    Email:       {email}
    Type:        {feedback_type}
    Subject:     {subject}

    Description:
    {description}
    """

    msg.attach(MIMEText(body, "plain"))

    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
        server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
        server.sendmail(settings.SMTP_SENDER, alert_email, msg.as_string())
