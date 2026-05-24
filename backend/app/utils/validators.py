# backend/app/utils/validators.py
#
# Input validation utilities used across the application.
# Centralised here so the same rules apply everywhere consistently.

import re

def validate_password_strength(password: str) -> bool:
    # Enforce password policy before hashing and saving.
    # Rules:
    # - Minimum 8 characters
    # - At least one uppercase letter
    # - At least one number
    # - At least one special character
    # Raises ValueError if any rule fails - FastAPI catches this via Pydantic.
    if len(password) < 8:
        raise ValueError("Password must be at least 8 characters long.")

    if not re.search(r"[A-Z]", password):
        raise ValueError("Password must contain at least one uppercase letter.")

    if not re.search(r"\d", password):
        raise ValueError("Password must contain at least one number.")

    if not re.search(r"[!@#$%^&*(),.?\":{}|<>]", password):
        raise ValueError("Password must contain at least one special character.")

    return password

def validate_email_format(email: str) -> str:
    # Basic email format validation.
    # Checks for a valid email pattern before saving to the database.
    pattern = r"^[\w\.-]+@[\w\.-]+\.\w{2,}$"

    if not re.match(pattern, email):
        raise ValueError("Invalid email format.")

    return email