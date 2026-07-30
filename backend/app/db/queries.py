"""
Database queries for Brandon Backend.
Provides functions to interact with Supabase tables.
"""

from typing import Optional, List, Dict, Any
from datetime import datetime, timedelta
from app.db.supabase_client import get_supabase
from app.db.models import (
    Message, ConversationContext, ScheduledMessage,
    User, UserProfile, WorkoutPlan
)
import logging

logger = logging.getLogger(__name__)


# ============================================================================
# User Queries
# ============================================================================

def normalize_phone_for_search(phone_number: str) -> List[str]:
    """
    Generate phone number variants for searching.

    Args:
        phone_number: Phone number (could be E.164 like +15555550100 or raw like 5555550100)

    Returns:
        List of phone number variants to search for
    """
    variants = [phone_number]

    # If E.164 format (+1...), also search without country code
    if phone_number.startswith("+1"):
        variants.append(phone_number[2:])  # Remove +1
    elif phone_number.startswith("1") and len(phone_number) == 11:
        variants.append(phone_number[1:])  # Remove leading 1

    # If raw 10-digit, also search with +1
    if len(phone_number) == 10 and phone_number.isdigit():
        variants.append(f"+1{phone_number}")

    return variants


def get_user_by_phone(phone_number: str) -> Optional[Dict[str, Any]]:
    """
    Get user and profile by phone number.

    Args:
        phone_number: Phone number in E.164 format

    Returns:
        Dict with 'user' and 'profile' keys, or None if not found
    """
    try:
        supabase = get_supabase()

        # Get profile by phone
        profile_response = supabase.table("profiles").select("*").eq("phone", phone_number).execute()

        if not profile_response.data:
            logger.warning(f"No profile found for phone: {phone_number}")
            return None

        profile = profile_response.data[0]
        user_id = profile["user_id"]

        # Get user
        user_response = supabase.table("users").select("*").eq("id", user_id).execute()

        if not user_response.data:
            logger.warning(f"No user found for user_id: {user_id}")
            return None

        return {
            "user": user_response.data[0],
            "profile": profile
        }

    except Exception as e:
        logger.error(f"Error getting user by phone: {e}", exc_info=True)
        return None


def get_onboarding_user_by_phone(phone_number: str) -> Optional[Dict[str, Any]]:
    """
    Get user by phone number in draft_onboarding_data.

    This finds users who are in the middle of onboarding and have entered
    their phone number but haven't completed profile creation yet.

    Args:
        phone_number: Phone number in E.164 format (e.g., +15555550100)

    Returns:
        Dict with 'user' key containing user data, or None if not found
    """
    try:
        supabase = get_supabase()

        # Get phone variants to search for (handles +1 prefix differences)
        phone_variants = normalize_phone_for_search(phone_number)

        # Search for users with matching phone in draft_onboarding_data
        for phone_variant in phone_variants:
            # Use containedBy or raw SQL for JSONB query
            # Supabase Python client doesn't have great JSONB support, so we use RPC or filter
            response = supabase.table("users").select("*").execute()

            for user in response.data:
                draft_data = user.get("draft_onboarding_data")
                if draft_data and draft_data.get("phone") == phone_variant:
                    logger.info(f"Found onboarding user {user['id']} with phone in draft data")
                    return {"user": user}

        logger.debug(f"No onboarding user found for phone: {phone_number}")
        return None

    except Exception as e:
        logger.error(f"Error getting onboarding user by phone: {e}", exc_info=True)
        return None


def update_draft_onboarding_data(user_id: str, updates: dict) -> bool:
    """
    Merge updates into a user's draft_onboarding_data JSONB field.

    Args:
        user_id: User ID
        updates: Dict of fields to merge (e.g. {"intro_sent": True})

    Returns:
        True if successful
    """
    try:
        supabase = get_supabase()

        # Fetch current draft data
        result = supabase.table("users").select("draft_onboarding_data").eq("id", user_id).execute()
        if not result.data:
            logger.warning(f"No user found for update_draft_onboarding_data: {user_id}")
            return False

        current = result.data[0].get("draft_onboarding_data") or {}
        current.update(updates)

        supabase.table("users").update({"draft_onboarding_data": current}).eq("id", user_id).execute()
        logger.info(f"Updated draft_onboarding_data for user {user_id}: {list(updates.keys())}")
        return True

    except Exception as e:
        logger.error(f"Error updating draft_onboarding_data: {e}", exc_info=True)
        return False


def get_user_and_profile_by_id(user_id: str) -> Optional[Dict[str, Any]]:
    """
    Get user and profile by user_id.

    Args:
        user_id: User ID

    Returns:
        Dict with 'user' and 'profile' keys, or None if not found
    """
    try:
        supabase = get_supabase()

        # Get profile by user_id
        profile_response = supabase.table("profiles").select("*").eq("user_id", user_id).execute()

        if not profile_response.data:
            logger.warning(f"No profile found for user_id: {user_id}")
            return None

        profile = profile_response.data[0]

        # Get user
        user_response = supabase.table("users").select("*").eq("id", user_id).execute()

        if not user_response.data:
            logger.warning(f"No user found for user_id: {user_id}")
            return None

        return {
            "user": user_response.data[0],
            "profile": profile
        }

    except Exception as e:
        logger.error(f"Error getting user by id: {e}", exc_info=True)
        return None


def get_user_workout_plan(user_id: str) -> Optional[Dict[str, Any]]:
    """
    Get active workout plan for user.

    Args:
        user_id: User ID

    Returns:
        Workout plan dict or None
    """
    try:
        supabase = get_supabase()

        response = supabase.table("workout_plans") \
            .select("*") \
            .eq("user_id", user_id) \
            .eq("status", "active") \
            .order("created_at", desc=True) \
            .limit(1) \
            .execute()

        if response.data:
            return response.data[0]

        return None

    except Exception as e:
        logger.error(f"Error getting workout plan: {e}", exc_info=True)
        return None


# ============================================================================
# Message Queries
# ============================================================================

def save_message(
    user_id: str,
    phone_number: str,
    direction: str,
    content: str,
    metadata: Optional[Dict] = None
) -> Optional[int]:
    """
    Save a message to the database.

    Args:
        user_id: User ID
        phone_number: Phone number
        direction: 'inbound' or 'outbound'
        content: Message text
        metadata: Optional metadata dict

    Returns:
        Message ID or None if failed
    """
    try:
        supabase = get_supabase()

        data = {
            "user_id": user_id,
            "phone_number": phone_number,
            "direction": direction,
            "content": content,
            "metadata": metadata or {},
            "created_at": datetime.utcnow().isoformat()
        }

        response = supabase.table("messages").insert(data).execute()

        if response.data:
            message_id = response.data[0]["id"]
            logger.info(f"✅ Saved {direction} message (ID: {message_id})")
            return message_id

        return None

    except Exception as e:
        logger.error(f"Error saving message: {e}", exc_info=True)
        return None


def get_recent_messages(user_id: str, limit: int = 20) -> List[Dict[str, Any]]:
    """
    Get recent messages for a user.

    Args:
        user_id: User ID
        limit: Number of messages to retrieve

    Returns:
        List of message dicts
    """
    try:
        supabase = get_supabase()

        response = supabase.table("messages") \
            .select("*") \
            .eq("user_id", user_id) \
            .order("created_at", desc=True) \
            .limit(limit) \
            .execute()

        # Reverse to get chronological order
        return list(reversed(response.data)) if response.data else []

    except Exception as e:
        logger.error(f"Error getting recent messages: {e}", exc_info=True)
        return []


def is_first_message(user_id: str) -> bool:
    """
    Check if this is the user's first inbound message.
    Used to trigger scheduling their first daily message.

    Args:
        user_id: User ID

    Returns:
        True if user has no prior inbound messages
    """
    try:
        supabase = get_supabase()

        result = supabase.table("messages") \
            .select("id", count="exact") \
            .eq("user_id", user_id) \
            .eq("direction", "inbound") \
            .execute()

        return (result.count or 0) == 0

    except Exception as e:
        logger.error(f"Error checking first message: {e}", exc_info=True)
        return False


def has_pending_scheduled_message(user_id: str) -> bool:
    """
    Check if user already has a pending scheduled message.
    Used to prevent duplicate scheduling.

    Args:
        user_id: User ID

    Returns:
        True if user has a pending scheduled message
    """
    try:
        supabase = get_supabase()

        result = supabase.table("scheduled_messages") \
            .select("id", count="exact") \
            .eq("user_id", user_id) \
            .eq("status", "pending") \
            .execute()

        return (result.count or 0) > 0

    except Exception as e:
        logger.error(f"Error checking pending messages: {e}", exc_info=True)
        return True  # Return True on error to prevent accidental duplicate scheduling


# ============================================================================
# Conversation Context Queries
# ============================================================================

def get_conversation_context(user_id: str) -> Optional[Dict[str, Any]]:
    """
    Get conversation context for user.

    Args:
        user_id: User ID

    Returns:
        Context dict or None
    """
    try:
        supabase = get_supabase()

        response = supabase.table("conversation_context") \
            .select("*") \
            .eq("user_id", user_id) \
            .execute()

        if response.data:
            return response.data[0]

        return None

    except Exception as e:
        logger.error(f"Error getting conversation context: {e}", exc_info=True)
        return None


def update_conversation_context(user_id: str, context_data: Dict[str, Any]) -> bool:
    """
    Update or create conversation context for user.

    Args:
        user_id: User ID
        context_data: Context data dict

    Returns:
        True if successful
    """
    try:
        supabase = get_supabase()

        # Try to update first
        response = supabase.table("conversation_context") \
            .update({"context_data": context_data, "last_updated": datetime.utcnow().isoformat()}) \
            .eq("user_id", user_id) \
            .execute()

        # If no rows updated, insert new
        if not response.data:
            response = supabase.table("conversation_context").insert({
                "user_id": user_id,
                "context_data": context_data
            }).execute()

        return bool(response.data)

    except Exception as e:
        logger.error(f"Error updating conversation context: {e}", exc_info=True)
        return False


# ============================================================================
# Scheduled Message Queries
# ============================================================================

def create_scheduled_message(
    user_id: str,
    phone_number: str,
    scheduled_time: datetime,
    message_content: Optional[str] = None
) -> Optional[int]:
    """
    Create a scheduled message.

    Args:
        user_id: User ID
        phone_number: Phone number
        scheduled_time: When to send the message
        message_content: Optional pre-generated message

    Returns:
        Scheduled message ID or None
    """
    try:
        supabase = get_supabase()

        data = {
            "user_id": user_id,
            "phone_number": phone_number,
            "scheduled_time": scheduled_time.isoformat(),
            "message_content": message_content,
            "status": "pending"
        }

        response = supabase.table("scheduled_messages").insert(data).execute()

        if response.data:
            msg_id = response.data[0]["id"]
            logger.info(f"✅ Created scheduled message (ID: {msg_id}) for {scheduled_time}")
            return msg_id

        return None

    except Exception as e:
        logger.error(f"Error creating scheduled message: {e}", exc_info=True)
        return None


def get_pending_scheduled_messages() -> List[Dict[str, Any]]:
    """
    Get all pending scheduled messages that should be sent now.

    Returns:
        List of scheduled message dicts
    """
    try:
        supabase = get_supabase()

        now = datetime.utcnow().isoformat()

        response = supabase.table("scheduled_messages") \
            .select("*") \
            .eq("status", "pending") \
            .lte("scheduled_time", now) \
            .order("scheduled_time") \
            .execute()

        return response.data if response.data else []

    except Exception as e:
        logger.error(f"Error getting pending scheduled messages: {e}", exc_info=True)
        return []


def update_scheduled_message_status(
    message_id: int,
    status: str,
    error_message: Optional[str] = None
) -> bool:
    """
    Update status of a scheduled message.

    Args:
        message_id: Scheduled message ID
        status: New status ('sent' or 'failed')
        error_message: Optional error message

    Returns:
        True if successful
    """
    try:
        supabase = get_supabase()

        data = {
            "status": status,
            "sent_at": datetime.utcnow().isoformat() if status == "sent" else None,
            "error_message": error_message
        }

        response = supabase.table("scheduled_messages") \
            .update(data) \
            .eq("id", message_id) \
            .execute()

        return bool(response.data)

    except Exception as e:
        logger.error(f"Error updating scheduled message: {e}", exc_info=True)
        return False


def cancel_todays_scheduled_message(user_id: str) -> bool:
    """
    Cancel any pending scheduled message for today.
    Called after first-message is sent to prevent duplicate same-day messages.

    Args:
        user_id: User ID to cancel messages for

    Returns:
        True if a message was cancelled, False otherwise
    """
    try:
        supabase = get_supabase()
        today = datetime.utcnow().strftime("%Y-%m-%d")
        tomorrow = (datetime.utcnow() + timedelta(days=1)).strftime("%Y-%m-%d")

        # Find and cancel today's pending message
        result = supabase.table("scheduled_messages") \
            .update({"status": "cancelled"}) \
            .eq("user_id", user_id) \
            .eq("status", "pending") \
            .gte("scheduled_time", today) \
            .lt("scheduled_time", tomorrow) \
            .execute()

        if result.data:
            logger.info(f"Cancelled {len(result.data)} scheduled message(s) for user {user_id} - first message already sent today")
            return True

        return False

    except Exception as e:
        logger.error(f"Error cancelling today's scheduled message: {e}", exc_info=True)
        return False


def get_users_for_daily_messages() -> List[Dict[str, Any]]:
    """
    Get all users who should receive daily messages today.
    Only returns users who:
    1. Have preferred_text_time set
    2. Have sent at least one inbound message (i.e., have texted us first)
    3. Have an active subscription (not canceled, cancelled, or unpaid)
    4. Do not have messaging_paused set to true

    Returns:
        List of user profile dicts
    """
    try:
        supabase = get_supabase()

        # First get user_ids who have sent at least one inbound message
        messages_response = supabase.table("messages") \
            .select("user_id") \
            .eq("direction", "inbound") \
            .execute()

        if not messages_response.data:
            logger.info("No users with inbound messages found")
            return []

        # Get unique user_ids who have texted
        user_ids_with_messages = list(set(m["user_id"] for m in messages_response.data))

        # Get users with active subscriptions (filter out canceled/unpaid)
        # Valid statuses: active, trialing, past_due (still give them a chance)
        excluded_statuses = ["canceled", "cancelled", "unpaid"]
        users_response = supabase.table("users") \
            .select("id, subscription_status") \
            .in_("id", user_ids_with_messages) \
            .execute()

        # Filter to only users with valid subscription status
        active_user_ids = []
        for user in (users_response.data or []):
            status = user.get("subscription_status")
            # Include if status is active, trialing, past_due, or even None (legacy users)
            # Exclude only explicitly canceled/unpaid
            if status not in excluded_statuses:
                active_user_ids.append(user["id"])

        if not active_user_ids:
            logger.info("No users with active subscriptions found")
            return []

        # Get profiles for active users with preferred_text_time set and messaging not paused
        # Note: Use or_ filter because neq(True) doesn't match NULL values in PostgreSQL
        response = supabase.table("profiles") \
            .select("*") \
            .not_.is_("preferred_text_time", "null") \
            .in_("user_id", active_user_ids) \
            .or_("messaging_paused.is.null,messaging_paused.eq.false") \
            .execute()

        logger.info(f"Found {len(response.data or [])} eligible users for daily messages "
                    f"(filtered from {len(user_ids_with_messages)} with messages)")

        return response.data if response.data else []

    except Exception as e:
        logger.error(f"Error getting users for daily messages: {e}", exc_info=True)
        return []


# ============================================================================
# Workout History Queries
# ============================================================================

def get_recent_workout_history(user_id: str, days: int = 7) -> List[Dict[str, Any]]:
    """
    Get workouts from the last N days with status and exercise details.

    Args:
        user_id: User ID
        days: Number of days to look back (default 7)

    Returns:
        List of workout session dicts with exercise details
    """
    try:
        supabase = get_supabase()

        # Calculate cutoff date
        cutoff_date = (datetime.utcnow() - timedelta(days=days)).isoformat()

        # Get workout sessions from last N days
        sessions_response = supabase.table("workout_sessions") \
            .select("*") \
            .eq("user_id", user_id) \
            .gte("created_at", cutoff_date) \
            .order("workout_date", desc=True) \
            .execute()

        if not sessions_response.data:
            return []

        result = []
        for session in sessions_response.data:
            session_data = {
                "id": session["id"],
                "date": session["workout_date"],
                "day_name": session["day_name"],
                "focus": session["focus"],
                "status": session["status"],
                "exercises": []
            }

            # Only fetch exercise details if workout was completed
            if session["status"] == "completed":
                # Get workout sets for this session
                sets_response = supabase.table("workout_sets") \
                    .select("*") \
                    .eq("session_id", session["id"]) \
                    .order("exercise_index") \
                    .order("set_number") \
                    .execute()

                if sets_response.data:
                    # Group sets by exercise
                    exercises = {}
                    for set_data in sets_response.data:
                        exercise_name = set_data["exercise_name"]
                        if exercise_name not in exercises:
                            exercises[exercise_name] = {
                                "name": exercise_name,
                                "sets": []
                            }
                        exercises[exercise_name]["sets"].append({
                            "set_number": set_data["set_number"],
                            "weight": set_data["weight"],
                            "reps": set_data["reps"],
                            "rpe": set_data["rpe"]
                        })

                    session_data["exercises"] = list(exercises.values())

            result.append(session_data)

        return result

    except Exception as e:
        logger.error(f"Error getting workout history: {e}", exc_info=True)
        return []


def get_workout_performance_history(user_id: str, day_name: str, limit: int = 4) -> List[Dict[str, Any]]:
    """
    Get last N sessions of a specific workout (by day_name) with performance data.

    Args:
        user_id: User ID
        day_name: Day of the week (e.g., "Monday")
        limit: Number of sessions to retrieve (default 4)

    Returns:
        List of workout session dicts with exercise details
    """
    try:
        supabase = get_supabase()

        # Get workout sessions matching this day_name
        sessions_response = supabase.table("workout_sessions") \
            .select("*") \
            .eq("user_id", user_id) \
            .eq("day_name", day_name) \
            .order("workout_date", desc=True) \
            .limit(limit) \
            .execute()

        if not sessions_response.data:
            return []

        result = []
        for session in sessions_response.data:
            session_data = {
                "id": session["id"],
                "date": session["workout_date"],
                "day_name": session["day_name"],
                "focus": session["focus"],
                "status": session["status"],
                "exercises": []
            }

            # Only fetch exercise details if workout was completed
            if session["status"] == "completed":
                # Get workout sets for this session
                sets_response = supabase.table("workout_sets") \
                    .select("*") \
                    .eq("session_id", session["id"]) \
                    .order("exercise_index") \
                    .order("set_number") \
                    .execute()

                if sets_response.data:
                    # Group sets by exercise
                    exercises = {}
                    for set_data in sets_response.data:
                        exercise_name = set_data["exercise_name"]
                        if exercise_name not in exercises:
                            exercises[exercise_name] = {
                                "name": exercise_name,
                                "sets": []
                            }
                        exercises[exercise_name]["sets"].append({
                            "set_number": set_data["set_number"],
                            "weight": set_data["weight"],
                            "reps": set_data["reps"],
                            "rpe": set_data["rpe"]
                        })

                    session_data["exercises"] = list(exercises.values())

            result.append(session_data)

        return result

    except Exception as e:
        logger.error(f"Error getting workout performance history: {e}", exc_info=True)
        return []


def get_workout_adherence(user_id: str, days: int = 30) -> Dict[str, Any]:
    """
    Get workout adherence data for calendar display.

    Args:
        user_id: User ID
        days: Number of days to look back (default 30)

    Returns:
        Dict with:
        - sessions: List of {date, status, focus, day_name}
        - completion_rate_7d: float (0-100)
        - completion_rate_30d: float (0-100)
        - total_workouts_7d: int
        - completed_workouts_7d: int
        - total_workouts_30d: int
        - completed_workouts_30d: int
    """
    try:
        supabase = get_supabase()

        # Calculate cutoff dates
        now = datetime.utcnow()
        today_str = now.strftime("%Y-%m-%d")
        cutoff_30d = (now - timedelta(days=days)).isoformat()
        cutoff_7d = (now - timedelta(days=7)).isoformat()

        # Get all workout sessions from last N days
        sessions_response = supabase.table("workout_sessions") \
            .select("id, workout_date, day_name, focus, status, created_at") \
            .eq("user_id", user_id) \
            .gte("workout_date", cutoff_30d) \
            .order("workout_date", desc=True) \
            .execute()

        sessions = sessions_response.data or []

        # Calculate stats
        total_7d = 0
        completed_7d = 0
        total_30d = len(sessions)
        completed_30d = 0

        formatted_sessions = []
        for session in sessions:
            workout_date = session.get("workout_date", "")
            raw_status = session.get("status", "pending")

            # Determine display status:
            # - "completed" stays as completed
            # - "pending" or "in_progress" on a past date becomes "skipped"
            # - "pending" or "in_progress" on today stays as "pending"
            session_date = workout_date[:10] if workout_date else ""

            if raw_status == "completed":
                display_status = "completed"
            elif session_date < today_str:
                # Past date and not completed = skipped
                display_status = "skipped"
            else:
                # Today or future = still pending
                display_status = "pending"

            # Format session for calendar
            formatted_sessions.append({
                "date": session_date,
                "status": display_status,
                "focus": session.get("focus", ""),
                "day_name": session.get("day_name", "")
            })

            # Count completions (only actual completed count)
            if raw_status == "completed":
                completed_30d += 1

            # Check if within last 7 days
            if workout_date and workout_date >= cutoff_7d:
                total_7d += 1
                if raw_status == "completed":
                    completed_7d += 1

        # Calculate rates
        completion_rate_7d = (completed_7d / total_7d * 100) if total_7d > 0 else 0
        completion_rate_30d = (completed_30d / total_30d * 100) if total_30d > 0 else 0

        return {
            "sessions": formatted_sessions,
            "completion_rate_7d": round(completion_rate_7d, 1),
            "completion_rate_30d": round(completion_rate_30d, 1),
            "total_workouts_7d": total_7d,
            "completed_workouts_7d": completed_7d,
            "total_workouts_30d": total_30d,
            "completed_workouts_30d": completed_30d
        }

    except Exception as e:
        logger.error(f"Error getting workout adherence: {e}", exc_info=True)
        return {
            "sessions": [],
            "completion_rate_7d": 0,
            "completion_rate_30d": 0,
            "total_workouts_7d": 0,
            "completed_workouts_7d": 0,
            "total_workouts_30d": 0,
            "completed_workouts_30d": 0
        }
