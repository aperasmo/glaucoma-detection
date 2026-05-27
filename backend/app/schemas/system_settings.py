# backend/app/schemas/system_settings.py
#
# Pydantic schemas for System Settings endpoints.
# Defines what data the API accepts and returns for settings management.

from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class SettingResponse(BaseModel):
    id: Optional[int] = None
    category: Optional[str] = None
    set_code: str
    set_name: Optional[str] = None
    set_value: Optional[str] = None
    remark: Optional[str] = None
    status: Optional[str] = None
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class UpdateSetting(BaseModel):
    # Only set_value and status can be updated via API.
    # set_code and category are immutable after creation.
    set_value: Optional[str] = None
    status: Optional[str] = None