#!/usr/bin/env python3
"""
Schedule Daily Messages Script

Runs once per day at midnight to create scheduled_messages records
for all users who should receive daily workout reminders.

Usage:
    python scripts/schedule_daily_messages.py

Cron:
    0 0 * * * /path/to/venv/bin/python /path/to/brandon-be/scripts/schedule_daily_messages.py
"""

import sys
import os
from pathlib import Path
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
import logging

# Default timezone if not set
DEFAULT_TIMEZONE = "America/Chicago"

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Create logs directory before configuring logging
os.makedirs("logs", exist_ok=True)

from app.db.queries import (
    get_users_for_daily_messages,
    create_scheduled_message,
    get_user_by_phone
)
from app.db.supabase_client import get_supabase

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout)
    ]
)

logger = logging.getLogger(__name__)


def parse_time(time_str: str) -> tuple[int, int]:
    """
    Parse time string to hour and minute.

    Args:
        time_str: Time string like "14:30" or "14:30:00"

    Returns:
        Tuple of (hour, minute)
    """
    try:
        parts = time_str.split(":")
        hour = int(parts[0])
        minute = int(parts[1]) if len(parts) > 1 else 0
        return hour, minute
    except Exception as e:
        logger.warning(f"Error parsing time '{time_str}': {e}")
        return 9, 0  # Default to 9:00 AM


def calculate_scheduled_time(preferred_time: str, timezone_str: str = DEFAULT_TIMEZONE) -> datetime:
    """
    Calculate today's scheduled time based on preferred time in user's timezone,
    converted to UTC for storage.

    Args:
        preferred_time: Time string like "14:30" (in user's local time)
        timezone_str: User's timezone (e.g., "America/Chicago")

    Returns:
        Datetime in UTC for the scheduled time
    """
    try:
        user_tz = ZoneInfo(timezone_str)
    except Exception as e:
        logger.warning(f"Invalid timezone '{timezone_str}', using default: {e}")
        user_tz = ZoneInfo(DEFAULT_TIMEZONE)

    utc_tz = ZoneInfo("UTC")

    # Get current time in user's timezone
    now_user_tz = datetime.now(user_tz)
    hour, minute = parse_time(preferred_time)

    # Create scheduled time in user's timezone
    scheduled_local = now_user_tz.replace(
        hour=hour,
        minute=minute,
        second=0,
        microsecond=0
    )

    # If time has already passed today in user's timezone, schedule for tomorrow
    if scheduled_local <= now_user_tz:
        logger.info(f"Time {preferred_time} has passed in {timezone_str}, scheduling for tomorrow")
        scheduled_local += timedelta(days=1)

    # Convert to UTC for storage
    scheduled_utc = scheduled_local.astimezone(utc_tz)

    # Return naive datetime (without tzinfo) for database compatibility
    return scheduled_utc.replace(tzinfo=None)


def schedule_daily_messages():
    """
    Main function to schedule daily messages for all eligible users.
    """
    logger.info("=" * 60)
    logger.info("🗓️ Starting daily message scheduling...")
    logger.info("=" * 60)

    try:
        # Get all users with preferred_text_time set
        users = get_users_for_daily_messages()

        logger.info(f"Found {len(users)} users with preferred_text_time set")

        scheduled_count = 0
        error_count = 0

        for profile in users:
            try:
                user_id = profile["user_id"]
                phone = profile["phone"]
                preferred_time = profile["preferred_text_time"]
                name = profile["name"]
                timezone = profile.get("timezone") or DEFAULT_TIMEZONE

                if not phone:
                    logger.warning(f"User {user_id} ({name}) has no phone number, skipping")
                    error_count += 1
                    continue

                if not preferred_time:
                    logger.warning(f"User {user_id} ({name}) has no preferred_text_time, skipping")
                    error_count += 1
                    continue

                # Calculate scheduled time in UTC based on user's timezone
                scheduled_time = calculate_scheduled_time(preferred_time, timezone)

                # Create scheduled message
                message_id = create_scheduled_message(
                    user_id=user_id,
                    phone_number=phone,
                    scheduled_time=scheduled_time,
                    message_content=None  # Will be generated when sent
                )

                if message_id:
                    logger.info(f"✅ Scheduled message for {name} ({phone}) at {preferred_time} {timezone} (UTC: {scheduled_time.strftime('%H:%M')})")
                    scheduled_count += 1
                else:
                    logger.error(f"❌ Failed to schedule message for {name}")
                    error_count += 1

            except Exception as e:
                logger.error(f"❌ Error scheduling for user {profile.get('user_id')}: {e}")
                error_count += 1

        logger.info("=" * 60)
        logger.info(f"✅ Scheduling complete!")
        logger.info(f"   - Scheduled: {scheduled_count}")
        logger.info(f"   - Errors: {error_count}")
        logger.info("=" * 60)

        return scheduled_count, error_count

    except Exception as e:
        logger.error(f"❌ Fatal error in scheduling: {e}", exc_info=True)
        return 0, 0


if __name__ == "__main__":
    # Run scheduling
    scheduled, errors = schedule_daily_messages()

    # Exit with error code if any errors occurred
    sys.exit(1 if errors > 0 else 0)
