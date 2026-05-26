# backend/app/api/routes/settings.py
#
# System settings endpoints.
# Admin-only routes for reading and updating application settings.
# Settings control inference mode, OHTS tiers, notifications, and more.

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional

from app.core.dependencies import get_current_user, require_role
from app.core.logger import get_logger
from app.db.database import get_db
from app.models.user import User
from app.schemas.system_settings import SettingResponse, UpdateSetting
from app.services.system_settings_service import (
    get_all_settings,
    get_setting_by_code,
    update_setting,
)

logger = get_logger(__name__)

router = APIRouter(prefix="/settings", tags=["System Settings"])


@router.get("/", response_model=list[SettingResponse], status_code=status.HTTP_200_OK)
async def list_settings(
    category: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    # List all system settings - admin only.
    # Optionally filter by category e.g. ?category=ML
    return await get_all_settings(db, category)


@router.get("/{set_code}", response_model=SettingResponse, status_code=status.HTTP_200_OK)
async def get_setting(
    set_code: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    # Get a single setting by set_code - admin only.
    setting = await get_setting_by_code(db, set_code)
    if not setting:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Setting not found: {set_code}",
        )
    return setting


@router.put("/{set_code}", response_model=SettingResponse, status_code=status.HTTP_200_OK)
async def modify_setting(
    set_code: str,
    data: UpdateSetting,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    # Update a setting value or status - admin only.
    # set_code and category are immutable.
    try:
        setting = await update_setting(
            db=db,
            set_code=set_code,
            data=data.model_dump(exclude_none=True),
            updated_by=current_user.user_id,
        )
        return setting
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        )
    
@router.get("/api-keys/status", status_code=status.HTTP_200_OK)
async def check_api_keys_status(
    provider: Optional[str] = None,
    current_user: User = Depends(require_role("admin")),
):
    # Test API key(s) on demand.
    # If provider is specified, test only that provider.
    # If no provider, test all three.
    # provider options: openai, groq, gemini
    import httpx
    from app.core.config import settings

    results = {}

    # Test OpenAI
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                "https://api.openai.com/v1/models",
                headers={"Authorization": f"Bearer {settings.OPENAI_API_KEY}"},
                timeout=5.0,
            )
        results["openai"] = {
            "configured": bool(settings.OPENAI_API_KEY),
            "valid": response.status_code == 200,
            "status": "connected" if response.status_code == 200 else "invalid key",
        }
    except Exception:
        results["openai"] = {"configured": bool(settings.OPENAI_API_KEY), "valid": False, "status": "unreachable"}

    # Test Groq
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                "https://api.groq.com/openai/v1/models",
                headers={"Authorization": f"Bearer {settings.GROQ_API_KEY}"},
                timeout=5.0,
            )
        results["groq"] = {
            "configured": bool(settings.GROQ_API_KEY),
            "valid": response.status_code == 200,
            "status": "connected" if response.status_code == 200 else "invalid key",
        }
    except Exception:
        results["groq"] = {"configured": bool(settings.GROQ_API_KEY), "valid": False, "status": "unreachable"}

    # Test Gemini
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"https://generativelanguage.googleapis.com/v1beta/models?key={settings.GEMINI_API_KEY}",
                timeout=5.0,
            )
        results["gemini"] = {
            "configured": bool(settings.GEMINI_API_KEY),
            "valid": response.status_code == 200,
            "status": "connected" if response.status_code == 200 else "invalid key",
        }
    except Exception:
        results["gemini"] = {"configured": bool(settings.GEMINI_API_KEY), "valid": False, "status": "unreachable"}

    # Filter to single provider if specified
    if provider:
        if provider not in results:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unknown provider: {provider}. Valid options: openai, groq, gemini"
            )
        return {provider: results[provider]}

    return results

