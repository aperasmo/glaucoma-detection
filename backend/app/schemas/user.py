# request/response shapes for the user endpoints - kept separate from the
# DB model so we're explicit about what actually leaves the API

from uuid import UUID
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, EmailStr, field_validator

from app.utils.validators import validate_password_strength, validate_email_format


class CreateUser(BaseModel):
    # what an admin has to provide to create a new account
    first_name: str
    last_name: str
    email: EmailStr
    password: str
    role: str

    @field_validator("password")
    @classmethod
    def password_must_be_strong(cls, value):
        return validate_password_strength(value)

    @field_validator("role")
    @classmethod
    def role_must_be_valid(cls, value):
        valid_roles = ["admin", "doctor", "nurse"]
        if value not in valid_roles:
            raise ValueError(f"Role must be one of: {', '.join(valid_roles)}")
        return value


class ResponseUser(BaseModel):
    # what we send back - password never makes it in here
    user_id: UUID
    user_code: str
    first_name: str
    last_name: str
    email: str
    role: str
    is_active: bool
    created_at: datetime
    is_researcher: Optional[bool] = False
    
    model_config = {"from_attributes": True}


class UpdateUser(BaseModel):
    # fields a user can edit once their account is active
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    address: Optional[str] = None
    contact_person: Optional[str] = None
    landline_number: Optional[str] = None
    mobile_number: Optional[str] = None
    remarks: Optional[str] = None