# backend/app/services/system_settings_service.py
#
# Business logic for system settings management.
# Handles reading and updating settings from the database.
# set_code and category are immutable - only set_value and status can change.

from datetime import datetime
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.logger import get_logger
from app.models.system_settings import SystemSettings

logger = get_logger(__name__)


async def get_all_settings(
    db: AsyncSession,
    category: Optional[str] = None,
) -> list[SystemSettings]:
    # Fetch all system settings.
    # Optionally filter by category e.g. "ML", "Email", "OHTS".
    # Ordered by category then set_code for consistent display.

    query = select(SystemSettings).order_by(
        SystemSettings.category,
        SystemSettings.set_code,
    )

    if category:
        query = query.where(SystemSettings.category == category)

    result = await db.execute(query)
    return result.scalars().all()


async def get_setting_by_code(
    db: AsyncSession,
    set_code: str,
) -> Optional[SystemSettings]:
    # Fetch a single setting by its unique set_code.
    # Returns None if not found.

    result = await db.execute(
        select(SystemSettings).where(SystemSettings.set_code == set_code)
    )
    return result.scalar_one_or_none()


async def update_setting(
    db: AsyncSession,
    set_code: str,
    data: dict,
    updated_by,
) -> SystemSettings:
    # Update a setting's value or status.
    # set_code and category are immutable - cannot be changed via API.
    # Returns the updated setting.

    setting = await get_setting_by_code(db, set_code)
    if not setting:
        raise ValueError(f"Setting not found: {set_code}")

    if "set_value" in data and data["set_value"] is not None:
        setting.set_value = data["set_value"]

    if "status" in data and data["status"] is not None:
        setting.status = data["status"]

    setting.updated_by = updated_by
    setting.updated_at = datetime.utcnow()

    logger.info(f"Setting updated: {set_code} = {setting.set_value}")

    return setting