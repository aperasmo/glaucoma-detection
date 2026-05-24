# backend/app/utils/settings_helper.py
#
# Utility functions for reading system settings from the database.
# Use get_setting() anywhere in the backend to retrieve a setting by set_code.
# Always returns a default value if the setting is missing or inactive.

from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.system_settings import SystemSettings


async def get_setting(
    db: AsyncSession,
    set_code: str,
    default: Optional[str] = None,
) -> Optional[str]:
    # Retrieve a single system setting value by set_code.
    # Returns the set_value if found and active.
    # Returns default if setting is missing, inactive, or has no value.
    # Usage: mode = await get_setting(db, "INFERENCE_MODE", default="clinical")

    result = await db.execute(
        select(SystemSettings).where(
            SystemSettings.set_code == set_code,
            SystemSettings.status == "A",
        )
    )
    setting = result.scalar_one_or_none()

    if not setting or not setting.set_value:
        return default

    return setting.set_value


async def get_setting_int(
    db: AsyncSession,
    set_code: str,
    default: int = 0,
) -> int:
    # Retrieve a system setting as an integer.
    # Use for numeric settings like OHTS tier thresholds.
    # Returns default if setting is missing or cannot be converted to int.

    value = await get_setting(db, set_code, default=str(default))
    try:
        return int(value)
    except (ValueError, TypeError):
        return default


async def get_setting_bool(
    db: AsyncSession,
    set_code: str,
    default: bool = True,
) -> bool:
    # Retrieve a system setting as a boolean.
    # Accepts "true" or "false" (case insensitive).
    # Returns default if setting is missing or unrecognised.

    value = await get_setting(db, set_code, default=str(default).lower())
    if value is None:
        return default
    return value.lower() == "true"