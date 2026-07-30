"""
Scheduler Service for Brandon Backend.
Handles scheduling of daily messages for users.
"""

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from typing import Optional, Tuple
import logging

from app.db.queries import create_scheduled_message, get_user_by_phone
from app.db.supabase_client import get_supabase

logger = logging.getLogger(__name__)

# Default timezone if not set
DEFAULT_TIMEZONE = "America/Chicago"


def parse_time(time_str: str) -> Tuple[int, int]:
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


def calculate_scheduled_time(
    preferred_time: str,
    timezone_str: str = DEFAULT_TIMEZONE
) -> datetime:
    """
    Calculate scheduled time based on preferred time in user's timezone,
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

    # Create scheduled time in user's timezone for today
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


def schedule_user_message(user_id: str) -> Optional[int]:
    """
    Schedule a daily message for a specific user.

    This is called after onboarding to schedule the user's first message,
    or can be called to reschedule if settings change.

    Args:
        user_id: The user's ID

    Returns:
        Scheduled message ID if successful, None otherwise
    """
    try:
        supabase = get_supabase()

        # Get user profile
        profile_response = supabase.table("profiles").select("*").eq("user_id", user_id).execute()

        if not profile_response.data:
            logger.warning(f"No profile found for user_id: {user_id}")
            return None

        profile = profile_response.data[0]

        phone = profile.get("phone")
        preferred_time = profile.get("preferred_text_time")
        timezone = profile.get("timezone") or DEFAULT_TIMEZONE
        name = profile.get("name", "User")

        if not phone:
            logger.warning(f"User {user_id} ({name}) has no phone number")
            return None

        if not preferred_time:
            logger.warning(f"User {user_id} ({name}) has no preferred_text_time")
            return None

        # Calculate scheduled time
        scheduled_time = calculate_scheduled_time(preferred_time, timezone)

        # Create scheduled message
        message_id = create_scheduled_message(
            user_id=user_id,
            phone_number=phone,
            scheduled_time=scheduled_time,
            message_content=None  # Will be generated when sent
        )

        if message_id:
            logger.info(
                f"✅ Scheduled message for {name} ({phone}) at {preferred_time} {timezone} "
                f"(UTC: {scheduled_time.strftime('%Y-%m-%d %H:%M')})"
            )
            return message_id
        else:
            logger.error(f"❌ Failed to create scheduled message for {name}")
            return None

    except Exception as e:
        logger.error(f"❌ Error scheduling message for user {user_id}: {e}", exc_info=True)
        return None
