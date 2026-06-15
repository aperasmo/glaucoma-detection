# backend/app/core/scheduler.py
#
# APScheduler setup for recurring background tasks.
# Scheduler starts with the FastAPI app and stops on shutdown.
# Add new scheduled jobs here as the system grows.

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from app.core.logger import get_logger

logger = get_logger(__name__)

# Single shared scheduler instance
scheduler = AsyncIOScheduler()


async def daily_screening_summary():
    # Placeholder for daily screening summary job.
    # Runs every day at 8am - sends summary of previous day's screenings.
    # Wire this when reporting module is built.
    logger.info("Daily screening summary job triggered.")


async def cleanup_failed_screenings():
    # Placeholder for cleanup job.
    # Runs every night at midnight.
    # Cleans up screenings stuck in 'processing' status for over 1 hour.
    logger.info("Cleanup failed screenings job triggered.")


def start_scheduler():
    # Register all scheduled jobs and start the scheduler.
    # Called during FastAPI startup.

    # Daily screening summary - every day at 8:00 AM
    scheduler.add_job(
        daily_screening_summary,
        trigger=CronTrigger(hour=8, minute=0),
        id="daily_screening_summary",
        replace_existing=True,
    )

    # Cleanup failed screenings - every day at midnight
    scheduler.add_job(
        cleanup_failed_screenings,
        trigger=CronTrigger(hour=0, minute=0),
        id="cleanup_failed_screenings",
        replace_existing=True,
    )

    scheduler.start()
    logger.info("Scheduler started. Jobs registered.")


def stop_scheduler():
    # Stop the scheduler cleanly on server shutdown.
    scheduler.shutdown()
    logger.info("Scheduler stopped.")