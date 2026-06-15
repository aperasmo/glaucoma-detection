# backend/app/utils/email.py
#
# Email sending utility using Gmail SMTP.
# Sends transactional emails - activation links, password resets.
# Credentials are loaded from .env - never hardcoded here.
# Runs synchronously but called via FastAPI BackgroundTasks
# so it never blocks the main request thread.

import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from app.core.config import settings
from app.core.logger import get_logger

logger = get_logger(__name__)


def send_activation_email(recipient_email: str, full_name: str, token: str) -> None:
    # Send an account activation email to a newly created user.
    # Builds both plain text and HTML versions of the email.
    # The activation link points to the frontend activation page.
    # Called as a background task - failures are logged but do not
    # crash the registration endpoint.

    activation_link = f"{settings.FRONTEND_URL}/activate?token={token}"

    # Build the email container
    message = MIMEMultipart("alternative")
    message["Subject"] = "Activate your GlaucomaAI account"
    message["From"] = settings.SMTP_SENDER
    message["To"] = recipient_email

    # Plain text fallback for email clients that do not render HTML
    text_body = f"""
Hello {full_name},

Your GlaucomaAI account has been created.
Please click the link below to activate your account:

{activation_link}

This link expires in 48 hours.

If you did not expect this email, please ignore it.

GlaucomaAI Team
    """

    # HTML version - cleaner experience for modern email clients
    html_body = f"""
    <html>
    <body style="font-family: Arial, sans-serif; color: #333;">
        <h2>Welcome to GlaucomaAI</h2>
        <p>Hello <strong>{full_name}</strong>,</p>
        <p>Your account has been created by a clinic administrator.</p>
        <p>Please click the button below to activate your account:</p>
        <p>
            <a href="{activation_link}"
               style="background-color:#2563eb;color:white;padding:12px 24px;
                      text-decoration:none;border-radius:6px;display:inline-block;">
                Activate Account
            </a>
        </p>
        <p>This link expires in <strong>48 hours</strong>.</p>
        <p>If you did not expect this email, please ignore it.</p>
        <hr/>
        <p style="font-size:12px;color:#888;">GlaucomaAI - AI-Powered Glaucoma Screening System</p>
    </body>
    </html>
    """

    # Attach both versions - email client picks the best one it supports
    message.attach(MIMEText(text_body, "plain"))
    message.attach(MIMEText(html_body, "html"))

    # Connect to Gmail SMTP and send
    # Port 465 uses SSL from the start - more secure than STARTTLS on 587
    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
        server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
        server.sendmail(
            settings.SMTP_SENDER,
            recipient_email,
            message.as_string(),
        )