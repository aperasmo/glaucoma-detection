# request/response shapes for the system settings endpoints

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
    # set_code and category are fixed once created - only the value/status can change
    set_value: Optional[str] = None
    status: Optional[str] = None