"""
Workout Tracking Service for Brandon Backend.
Handles creation of workout sessions and tracking tokens.
"""

import logging
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from nanoid import generate as nanoid

from app.config import settings
from app.db.supabase_client import get_supabase

logger = logging.getLogger(__name__)

DEFAULT_TIMEZONE = "America/Chicago"


def get_user_timezone(supabase, user_id: str) -> ZoneInfo:
    """Get user's timezone from profile, or default."""
    try:
        result = supabase.table("profiles").select("timezone").eq("user_id", user_id).limit(1).execute()
        if result.data and result.data[0].get("timezone"):
            return ZoneInfo(result.data[0]["timezone"])
    except Exception as e:
        logger.warning(f"Error getting user timezone: {e}")
    return ZoneInfo(DEFAULT_TIMEZONE)


def create_tracking_session(user_id: str, plan_id: int, day_name: str, focus: str) -> str:
    """
    Create workout session and return tracking URL.

    If a session already exists for this user + plan + date, returns the existing
    tracking URL instead of creating a duplicate.

    Args:
        user_id: The user's ID
        plan_id: The workout plan ID
        day_name: Day of the week (e.g., "Wednesday")
        focus: Workout focus (e.g., "Lower Body & Core")

    Returns:
        Tracking URL like https://textbrandon.now/track/{token}
        Returns None if session creation fails
    """
    try:
        supabase = get_supabase()

        # Use user's timezone to determine "today"
        user_tz = get_user_timezone(supabase, user_id)
        now_user = datetime.now(user_tz)
        today = now_user.strftime("%Y-%m-%d")

        # 1. Check for existing session for this user + plan + date + day_name
        # Check both scheduled_for (new sessions) and workout_date (legacy sessions)
        # First try scheduled_for for newer sessions
        existing_session = supabase.table("workout_sessions") \
            .select("id") \
            .eq("user_id", user_id) \
            .eq("plan_id", plan_id) \
            .eq("day_name", day_name) \
            .gte("scheduled_for", today) \
            .lt("scheduled_for", today + "T23:59:59") \
            .limit(1) \
            .execute()

        # If not found, check legacy sessions where scheduled_for is null
        if not existing_session.data:
            existing_session = supabase.table("workout_sessions") \
                .select("id") \
                .eq("user_id", user_id) \
                .eq("plan_id", plan_id) \
                .eq("day_name", day_name) \
                .is_("scheduled_for", "null") \
                .gte("workout_date", today) \
                .lt("workout_date", today + "T23:59:59") \
                .limit(1) \
                .execute()

        if existing_session.data:
            # Session exists - get existing token
            session_id = existing_session.data[0]["id"]
            existing_token = supabase.table("session_tokens") \
                .select("token") \
                .eq("session_id", session_id) \
                .limit(1) \
                .execute()

            if existing_token.data:
                token = existing_token.data[0]["token"]
                logger.info(f"Returning existing session {session_id} with token {token}")
                return f"{settings.frontend_url}/track/{token}"
            else:
                # Session exists but no token - create new token for it
                # Expire 7 days after the session date (not from now)
                token = nanoid(size=21)
                session_date = datetime.strptime(today, "%Y-%m-%d")
                expires_at = session_date + timedelta(days=7)
                supabase.table("session_tokens").insert({
                    "token": token,
                    "session_id": session_id,
                    "expires_at": expires_at.isoformat()
                }).execute()
                logger.info(f"Created new token {token} for existing session {session_id}")
                return f"{settings.frontend_url}/track/{token}"

        # 2. No existing session - create new one
        # Store workout_date and scheduled_for as user's local date (start of day)
        # For normal "today's workout" scenarios, both fields are the same
        session_result = supabase.table("workout_sessions").insert({
            "user_id": user_id,
            "plan_id": plan_id,
            "workout_date": today + "T00:00:00",  # When performed
            "scheduled_for": today + "T00:00:00",  # Which day slot this belongs to
            "day_index": 0,
            "day_name": day_name,
            "focus": focus,
            "status": "pending"
        }).execute()

        session_id = session_result.data[0]["id"]

        # 3. Generate token
        token = nanoid(size=21)

        # 4. Store token — expires 7 days after the session date
        session_date = datetime.strptime(today, "%Y-%m-%d")
        expires_at = session_date + timedelta(days=7)
        supabase.table("session_tokens").insert({
            "token": token,
            "session_id": session_id,
            "expires_at": expires_at.isoformat()
        }).execute()

        logger.info(f"Created workout session {session_id} with token {token}")
        return f"{settings.frontend_url}/track/{token}"

    except Exception as e:
        logger.error(f"Error creating tracking session: {e}", exc_info=True)
        return None
