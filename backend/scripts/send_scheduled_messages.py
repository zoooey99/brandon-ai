#!/usr/bin/env python3
"""
Send Scheduled Messages Script

Runs every minute to check for pending scheduled messages
and send them via the Mac server.

Usage:
    python scripts/send_scheduled_messages.py

Cron:
    * * * * * /path/to/venv/bin/python /path/to/brandon-be/scripts/send_scheduled_messages.py
"""

import sys
import os
from pathlib import Path
import asyncio
import logging
from datetime import datetime
from zoneinfo import ZoneInfo

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
    get_pending_scheduled_messages,
    update_scheduled_message_status,
    get_user_by_phone
)
from app.services.mac_client import get_mac_client, MacServerError
from app.services.tracking import create_tracking_session
from app.db.models import OutboundMessageChunk
from app.db.supabase_client import get_supabase
from app.prompts.loader import get_prompt, render_template, safe_format
from app.sms.schedule import ensure_schedule_materialized

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout)
    ]
)

logger = logging.getLogger(__name__)


# Default templates (fallbacks if not in database)
DEFAULT_WORKOUT_TEMPLATE = """Hey {name}! Here's your {day} workout:

{exercises}

Track your workout: {tracking_url}"""

DEFAULT_REST_TEMPLATE = "Hey {name}! Today's a rest day. Recover well and get ready for tomorrow!"


def format_daily_message(user_data: dict, profile: dict, target_date: str = None) -> list[str]:
    """
    Format daily message from the materialized workout_sessions table.

    Ensures the schedule is materialized first, then reads today's session
    directly from workout_sessions (instead of parsing the plan template).

    Args:
        user_data: User data dict
        profile: Profile data dict
        target_date: Optional date string (YYYY-MM-DD) to generate message for.
                     If None, uses today in the user's timezone.

    Returns:
        List of message strings (one per text bubble, split on --- in template)
    """
    try:
        user_id = user_data["id"]
        name = profile.get("name", "there")

        # Get user's timezone to determine correct day
        user_tz_str = profile.get("timezone", DEFAULT_TIMEZONE)
        try:
            user_tz = ZoneInfo(user_tz_str)
        except Exception:
            user_tz = ZoneInfo(DEFAULT_TIMEZONE)

        if target_date:
            today_date = target_date
            today = datetime.strptime(target_date, "%Y-%m-%d").strftime("%A")
        else:
            today = datetime.now(user_tz).strftime("%A")
            today_date = datetime.now(user_tz).strftime("%Y-%m-%d")

        # Ensure schedule is materialized before querying
        ensure_schedule_materialized(user_id, timezone=user_tz_str)

        # Query today's session from materialized workout_sessions
        supabase = get_supabase()
        session_resp = (
            supabase.table("workout_sessions")
            .select("*")
            .eq("user_id", user_id)
            .gte("scheduled_for", today_date)
            .lt("scheduled_for", today_date + "T23:59:59")
            .limit(1)
            .execute()
        )

        session = session_resp.data[0] if session_resp.data else None

        # Rest day - no session for today
        if not session:
            try:
                messages = render_template(get_prompt("daily_rest"), {"name": name, "day": today})
            except ValueError:
                messages = [safe_format(DEFAULT_REST_TEMPLATE, {"name": name, "day": today})]
            return messages if messages else [f"Hey {name}! Enjoy your rest day."]

        # Build exercise list from materialized session
        exercises = session.get("exercises") or []
        focus = session.get("focus", "Workout")
        plan_id = session.get("plan_id")
        exercise_lines = []

        for ex in exercises:
            ex_name = ex.get("name", "Exercise")
            sets = ex.get("sets", "")
            reps = ex.get("reps", "")
            duration = ex.get("duration", "")

            if sets and reps:
                exercise_lines.append(f"- {ex_name}: {sets} sets x {reps} reps")
            elif duration:
                exercise_lines.append(f"- {ex_name}: {duration}")
            else:
                exercise_lines.append(f"- {ex_name}")

        exercises_text = "\n".join(exercise_lines)

        # Create tracking link
        tracking_url = create_tracking_session(user_id, plan_id, today, focus)
        if not tracking_url:
            tracking_url = ""

        # Get workout template and format
        workout_vars = {
            "name": name,
            "day": today,
            "focus": focus,
            "exercises": exercises_text,
            "tracking_url": tracking_url,
        }
        try:
            messages = render_template(get_prompt("daily_workout"), workout_vars)
        except ValueError:
            messages = [safe_format(DEFAULT_WORKOUT_TEMPLATE, workout_vars)]
        return messages if messages else [f"Hey {name}! Time for your workout!"]

    except Exception as e:
        logger.error(f"Error formatting daily message: {e}", exc_info=True)
        return [f"Hey {profile.get('name', 'there')}! Time for your workout!"]


async def send_message(scheduled_msg: dict) -> bool:
    """
    Send a scheduled message.

    Args:
        scheduled_msg: Scheduled message dict

    Returns:
        True if sent successfully
    """
    message_id = scheduled_msg["id"]
    phone_number = scheduled_msg["phone_number"]
    user_id = scheduled_msg["user_id"]

    try:
        logger.info(f"📤 Sending scheduled message {message_id} to {phone_number}")

        # Get user and profile
        user_data = get_user_by_phone(phone_number)

        if not user_data:
            logger.error(f"User not found for phone: {phone_number}")
            update_scheduled_message_status(
                message_id=message_id,
                status="failed",
                error_message="User not found"
            )
            return False

        user = user_data["user"]
        profile = user_data["profile"]

        # Generate or use pre-generated message
        pre_generated = scheduled_msg.get("message_content")

        if pre_generated:
            message_chunks = [OutboundMessageChunk(text=pre_generated)]
        else:
            message_parts = format_daily_message(user, profile)
            message_chunks = [OutboundMessageChunk(text=part) for part in message_parts]

        # Send via Mac server
        mac_client = get_mac_client()

        await mac_client.send_message(
            phone_number=phone_number,
            messages=message_chunks,
            delay_before_typing=1.0,
            typing_duration=2.0
        )

        # Mark as sent
        update_scheduled_message_status(
            message_id=message_id,
            status="sent"
        )

        logger.info(f"✅ Sent scheduled message {message_id}")
        return True

    except MacServerError as e:
        logger.error(f"Mac server error sending message {message_id}: {e}")
        update_scheduled_message_status(
            message_id=message_id,
            status="failed",
            error_message=f"Mac server error: {str(e)}"
        )
        return False

    except Exception as e:
        logger.error(f"Error sending message {message_id}: {e}", exc_info=True)
        update_scheduled_message_status(
            message_id=message_id,
            status="failed",
            error_message=str(e)
        )
        return False


async def send_scheduled_messages():
    """
    Main function to send all pending scheduled messages.
    """
    logger.info("⏰ Checking for scheduled messages...")

    try:
        # Get pending messages
        messages = get_pending_scheduled_messages()

        if not messages:
            logger.info("No pending messages to send")
            return 0, 0

        logger.info(f"Found {len(messages)} pending message(s)")

        sent_count = 0
        failed_count = 0

        # Send each message
        for msg in messages:
            success = await send_message(msg)

            if success:
                sent_count += 1
            else:
                failed_count += 1

            # Small delay between messages to respect rate limits
            await asyncio.sleep(1)

        logger.info(f"✅ Sent: {sent_count}, ❌ Failed: {failed_count}")

        return sent_count, failed_count

    except Exception as e:
        logger.error(f"❌ Fatal error sending scheduled messages: {e}", exc_info=True)
        return 0, 0


if __name__ == "__main__":
    # Run async function
    sent, failed = asyncio.run(send_scheduled_messages())

    # Exit with error code if any failures
    sys.exit(1 if failed > 0 else 0)
