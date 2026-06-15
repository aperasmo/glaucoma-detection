# backend/app/db/seed.py
#
# Main seed runner - calls each seed function in order.
# Each seed manages its own session and validation.
# Safe to run multiple times - skips already existing records.
# Usage: python -m app.db.seed

import asyncio
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db.database import AsyncSessionLocal
from app.models.user import User
from app.models.system_settings import SystemSettings
from app.utils.security import hash_password


async def seed_users():
    # Seed the first system admin account.
    # Skips if admin already exists.
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(User).where(User.email == "aiglaucomascreeningsystem@gmail.com")
        )
        existing = result.scalar_one_or_none()

        if existing:
            print("[seed_users] Admin already exists. Skipping.")
            return

        admin = User(
            user_code="SYS00001",
            first_name="System",
            last_name="Admin",
            email="aiglaucomascreeningsystem@gmail.com",
            hashed_password=hash_password("Admin@1234"),
            role="admin",
            is_active=True,
        )
        db.add(admin)
        await db.commit()
        print("[seed_users] Admin account created successfully.")


async def seed_system_settings():
    # Seed default system settings.
    # Skips individual entries that already exist.
    async with AsyncSessionLocal() as db:
        defaults = [
            {
                "category": "ML",
                "set_code": "INFERENCE_MODE",
                "set_name": "Inference Mode",
                "set_value": "clinical",
                "remark": "clinical = ensemble only. research = all 3 models + ensemble.",
                "status": "A",
            },
            {
                "category": "ML",
                "set_code": "GRADCAM_ENABLED",
                "set_name": "Grad-CAM++ Enabled",
                "set_value": "true",
                "remark": "Enable or disable Grad-CAM++ heatmap generation.",
                "status": "A",
            },
            {
                "category": "Email",
                "set_code": "EMAIL_NOTIFICATIONS",
                "set_name": "Email Notifications",
                "set_value": "true",
                "remark": "Enable or disable high-risk result email notifications.",
                "status": "A",
            },
            {
                "category": "OHTS",
                "set_code": "OHTS_TIER_CRITICAL",
                "set_name": "OHTS Critical Tier Threshold",
                "set_value": "9",
                "remark": "Score 9-10 triggers Critical tier - immediate referral recommended.",
                "status": "A",
            },
            {
                "category": "OHTS",
                "set_code": "OHTS_TIER_POSSIBLE",
                "set_name": "OHTS Possible Tier Threshold",
                "set_value": "6",
                "remark": "Score 6-8 triggers Possible tier - possible glaucoma within 5 years.",
                "status": "A",
            },
            {
                "category": "OHTS",
                "set_code": "OHTS_TIER_LOW",
                "set_name": "OHTS Low Tier Threshold",
                "set_value": "1",
                "remark": "Score 1-5 triggers Low tier - routine monitoring recommended.",
                "status": "A",
            },            
            {
            "category": "Email",
            "set_code": "NOTIFICATION_EMAIL",
            "set_name": "High-Risk Notification Email",
            "set_value": "aiglaucomascreeningsystem@gmail.com",
            "remark": "Shared clinic email that receives high-risk screening alerts.",
            "status": "A",
            },
            {
            "category": "Email",
            "set_code": "NOTIFICATION_THRESHOLD",
            "set_name": "Notification OHTS Threshold",
            "set_value": "critical,possible",
            "remark": "OHTS tiers that trigger email notification. Options: critical, possible.",
            "status": "A",
            },            
            {
                "category": "General",
                "set_code": "REFERRING_CLINICIAN_NAME",
                "set_name": "Referring Clinician Name",
                "set_value": "Dr. [Clinician Name]",
                "remark": "Name used to sign all AI-generated referral letters. Set this to the designated clinician at your clinic.",
                "status": "A",
            },
            {
                "category": "General",
                "set_code": "REFERRING_CLINICIAN_TITLE",
                "set_name": "Referring Clinician Title",
                "set_value": "General Ophthalmologist",
                "remark": "Title of the referring clinician e.g. General Ophthalmologist, Optometrist.",
                "status": "A",
            },            
            ]

        for item in defaults:
            result = await db.execute(
                select(SystemSettings).where(SystemSettings.set_code == item["set_code"])
            )
            existing = result.scalar_one_or_none()
            if not existing:
                db.add(SystemSettings(**item))
                print(f"[seed_system_settings] Added: {item['set_code']}")
            else:
                print(f"[seed_system_settings] Already exists, skipping: {item['set_code']}")

        await db.commit()


async def seed():
    # Main seed runner - add new seed functions here as needed.
    print("Starting seed...")
    await seed_users()
    await seed_system_settings()
    print("Seed complete.")


if __name__ == "__main__":
    asyncio.run(seed())