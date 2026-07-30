"""
SMS Agent Tool Definitions + Execution.
OpenAI function-calling format tools that operate on the materialized workout_sessions table.
"""

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from typing import Any
import json
import logging

from app.db.supabase_client import get_supabase
from app.db.queries import get_user_workout_plan
from app.sms.analytics_tools import ANALYTICS_TOOL_DEFINITIONS, ANALYTICS_TOOL_MAP
from app.sms.plan_tools import PLAN_TOOL_DEFINITIONS, PLAN_TOOL_MAP

logger = logging.getLogger(__name__)

DEFAULT_TIMEZONE = "America/Chicago"

# ---------------------------------------------------------------------------
# Tool definitions (OpenAI function-calling format)
# ---------------------------------------------------------------------------

TOOL_DEFINITIONS = [
    {
        "type": "function",
        "function": {
            "name": "get_todays_workout",
            "description": "Get today's workout details including exercises, sets, reps, and status from the schedule.",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_week_schedule",
            "description": "Get the workout schedule for the next 7 days, including which days have workouts and which are rest days.",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "skip_workout",
            "description": "Skip a workout for a given date. If no date is provided, skips today's workout.",
            "parameters": {
                "type": "object",
                "properties": {
                    "date": {
                        "type": "string",
                        "description": "Date to skip in YYYY-MM-DD format. Defaults to today.",
                    },
                    "reason": {
                        "type": "string",
                        "description": "Optional reason for skipping.",
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "reschedule_workout",
            "description": "Move a workout from one date to another. Skips the original date and creates a new session on the target date.",
            "parameters": {
                "type": "object",
                "properties": {
                    "from_date": {
                        "type": "string",
                        "description": "Original workout date in YYYY-MM-DD format.",
                    },
                    "to_date": {
                        "type": "string",
                        "description": "New workout date in YYYY-MM-DD format.",
                    },
                },
                "required": ["from_date", "to_date"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "modify_workout_exercises",
            "description": "Add, remove, or replace exercises in a workout session.",
            "parameters": {
                "type": "object",
                "properties": {
                    "date": {
                        "type": "string",
                        "description": "Date of the workout in YYYY-MM-DD format. Defaults to today.",
                    },
                    "action": {
                        "type": "string",
                        "enum": ["add", "remove", "replace"],
                        "description": "What to do: add exercises, remove exercises, or replace the entire list.",
                    },
                    "exercises": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string"},
                                "sets": {"type": "integer"},
                                "reps": {"type": "string"},
                            },
                            "required": ["name"],
                        },
                        "description": "List of exercises to add/remove/replace with.",
                    },
                },
                "required": ["action", "exercises"],
            },
        },
    },
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _resolve_date(date_str: str | None, timezone: str) -> str:
    """Return a YYYY-MM-DD string, defaulting to today in the user's timezone."""
    if date_str:
        return date_str[:10]
    try:
        tz = ZoneInfo(timezone)
    except Exception:
        tz = ZoneInfo(DEFAULT_TIMEZONE)
    return datetime.now(tz).strftime("%Y-%m-%d")


def _get_session(user_id: str, date_str: str):
    """Fetch a single workout_session row for user + date."""
    supabase = get_supabase()
    resp = (
        supabase.table("workout_sessions")
        .select("*")
        .eq("user_id", user_id)
        .gte("scheduled_for", date_str)
        .lt("scheduled_for", date_str + "T23:59:59")
        .limit(1)
        .execute()
    )
    return resp.data[0] if resp.data else None


def _get_tracking_url(session_id: int) -> str | None:
    """Look up the pre-generated tracking URL for a session."""
    supabase = get_supabase()
    resp = (
        supabase.table("session_tokens")
        .select("token")
        .eq("session_id", session_id)
        .limit(1)
        .execute()
    )
    if resp.data:
        return f"https://textbrandon.now/track/{resp.data[0]['token']}"
    return None


def _get_tracking_urls_bulk(session_ids: list[int]) -> dict[int, str]:
    """Look up tracking URLs for multiple sessions in one query."""
    if not session_ids:
        return {}
    supabase = get_supabase()
    resp = (
        supabase.table("session_tokens")
        .select("session_id, token")
        .in_("session_id", session_ids)
        .execute()
    )
    return {
        row["session_id"]: f"https://textbrandon.now/track/{row['token']}"
        for row in (resp.data or [])
    }


# ---------------------------------------------------------------------------
# Tool implementations
# ---------------------------------------------------------------------------

def _get_todays_workout(user_id: str, timezone: str, **_kwargs) -> dict:
    date_str = _resolve_date(None, timezone)
    session = _get_session(user_id, date_str)
    if not session:
        return {"rest_day": True, "date": date_str, "message": "No workout scheduled for today — it's a rest day."}

    exercises = session.get("exercises") or []
    tracking_url = _get_tracking_url(session["id"])

    result = {
        "date": date_str,
        "day_name": session.get("day_name"),
        "focus": (session.get("focus") or "").upper(),
        "status": session.get("status"),
        "exercises": exercises,
    }
    if tracking_url:
        result["tracking_url"] = tracking_url
    return result


def _get_week_schedule(user_id: str, timezone: str, **_kwargs) -> dict:
    try:
        tz = ZoneInfo(timezone)
    except Exception:
        tz = ZoneInfo(DEFAULT_TIMEZONE)

    today = datetime.now(tz).date()
    supabase = get_supabase()

    start_str = today.isoformat()
    end_str = (today + timedelta(days=7)).isoformat()

    resp = (
        supabase.table("workout_sessions")
        .select("id, scheduled_for, day_name, focus, status, exercises")
        .eq("user_id", user_id)
        .gte("scheduled_for", start_str)
        .lt("scheduled_for", end_str)
        .order("scheduled_for")
        .execute()
    )

    sessions_by_date = {}
    session_ids = []
    for s in resp.data or []:
        d = s["scheduled_for"][:10]
        sessions_by_date[d] = s
        session_ids.append(s["id"])

    # Bulk-fetch tracking URLs for all sessions in one query
    tracking_urls = _get_tracking_urls_bulk(session_ids)

    schedule = []
    for offset in range(7):
        d = today + timedelta(days=offset)
        d_str = d.isoformat()
        day_name = d.strftime("%A")

        if d_str in sessions_by_date:
            s = sessions_by_date[d_str]
            entry = {
                "date": d_str,
                "day_name": day_name,
                "focus": (s.get("focus") or "").upper(),
                "status": s.get("status"),
                "has_workout": True,
            }
            url = tracking_urls.get(s["id"])
            if url:
                entry["tracking_url"] = url
            schedule.append(entry)
        else:
            schedule.append({
                "date": d_str,
                "day_name": day_name,
                "has_workout": False,
                "rest_day": True,
            })

    return {"schedule": schedule}


def _skip_workout(user_id: str, timezone: str, date: str | None = None, reason: str | None = None, **_kwargs) -> dict:
    date_str = _resolve_date(date, timezone)
    session = _get_session(user_id, date_str)
    if not session:
        return {"success": False, "error": f"No workout found on {date_str}."}

    if session["status"] == "skipped":
        return {"success": True, "message": f"Workout on {date_str} was already skipped."}

    if session["status"] == "completed":
        return {"success": False, "error": f"Workout on {date_str} is already completed and can't be skipped."}

    supabase = get_supabase()
    update = {"status": "skipped"}
    if reason:
        update["notes"] = reason

    supabase.table("workout_sessions").update(update).eq("id", session["id"]).execute()
    focus = (session.get("focus") or "workout").upper()
    return {"success": True, "message": f"Workout on {date_str} ({focus}) has been skipped."}


def _reschedule_workout(user_id: str, timezone: str, from_date: str, to_date: str, **_kwargs) -> dict:
    from_str = _resolve_date(from_date, timezone)
    to_str = _resolve_date(to_date, timezone)

    session = _get_session(user_id, from_str)
    if not session:
        return {"success": False, "error": f"No workout found on {from_str}."}

    if session["status"] == "completed":
        return {"success": False, "error": f"Workout on {from_str} is already completed."}

    # Check target date is free
    existing_target = _get_session(user_id, to_str)
    if existing_target and existing_target["status"] not in ("skipped",):
        return {"success": False, "error": f"There's already a workout on {to_str}. Skip it first if you want to replace it."}

    supabase = get_supabase()

    # Skip the original
    supabase.table("workout_sessions").update({"status": "skipped", "notes": f"Rescheduled to {to_str}"}).eq("id", session["id"]).execute()

    # Create new session on target date (or update if skipped target exists)
    if existing_target and existing_target["status"] == "skipped":
        supabase.table("workout_sessions").update({
            "status": "pending",
            "focus": session.get("focus"),
            "exercises": session.get("exercises"),
            "day_name": session.get("day_name"),
            "source": "rescheduled",
            "notes": f"Rescheduled from {from_str}",
        }).eq("id", existing_target["id"]).execute()
        new_session_id = existing_target["id"]
    else:
        insert_resp = supabase.table("workout_sessions").insert({
            "user_id": user_id,
            "plan_id": session.get("plan_id"),
            "workout_date": f"{to_str}T00:00:00",
            "scheduled_for": f"{to_str}T00:00:00",
            "day_index": session.get("day_index", 0),
            "day_name": session.get("day_name"),
            "focus": session.get("focus"),
            "exercises": session.get("exercises"),
            "source": "rescheduled",
            "status": "pending",
            "notes": f"Rescheduled from {from_str}",
        }).execute()
        new_session_id = insert_resp.data[0]["id"] if insert_resp.data else None

    # Ensure the new/updated session has a tracking token
    if new_session_id and not _get_tracking_url(new_session_id):
        from nanoid import generate as nanoid
        to_date_parsed = datetime.strptime(to_str, "%Y-%m-%d")
        expires_at = to_date_parsed + timedelta(days=7)
        supabase.table("session_tokens").insert({
            "token": nanoid(size=21),
            "session_id": new_session_id,
            "expires_at": expires_at.isoformat(),
        }).execute()

    return {
        "success": True,
        "message": f"Moved {(session.get('focus') or 'workout').upper()} from {from_str} to {to_str}.",
    }


def _modify_workout_exercises(
    user_id: str, timezone: str,
    action: str, exercises: list,
    date: str | None = None, **_kwargs
) -> dict:
    date_str = _resolve_date(date, timezone)
    session = _get_session(user_id, date_str)
    if not session:
        return {"success": False, "error": f"No workout found on {date_str}."}

    current_exercises = session.get("exercises") or []

    if action == "replace":
        new_exercises = exercises
    elif action == "add":
        new_exercises = current_exercises + exercises
    elif action == "remove":
        remove_names = {e.get("name", "").lower() for e in exercises}
        new_exercises = [e for e in current_exercises if e.get("name", "").lower() not in remove_names]
    else:
        return {"success": False, "error": f"Unknown action: {action}"}

    supabase = get_supabase()
    supabase.table("workout_sessions").update({
        "exercises": new_exercises,
        "source": "custom",
    }).eq("id", session["id"]).execute()

    return {
        "success": True,
        "message": f"Exercises updated for {date_str}.",
        "exercise_count": len(new_exercises),
    }


# ---------------------------------------------------------------------------
# Dispatcher
# ---------------------------------------------------------------------------

TOOL_DEFINITIONS.extend(ANALYTICS_TOOL_DEFINITIONS)
TOOL_DEFINITIONS.extend(PLAN_TOOL_DEFINITIONS)

_TOOL_MAP = {
    "get_todays_workout": _get_todays_workout,
    "get_week_schedule": _get_week_schedule,
    "skip_workout": _skip_workout,
    "reschedule_workout": _reschedule_workout,
    "modify_workout_exercises": _modify_workout_exercises,
}
_TOOL_MAP.update(ANALYTICS_TOOL_MAP)
_TOOL_MAP.update(PLAN_TOOL_MAP)


def execute_tool(name: str, args: dict, user_id: str, phone_number: str, profile) -> dict:
    """
    Dispatch and execute a tool call.

    Args:
        name: Tool function name
        args: Arguments dict from the LLM
        user_id: User ID
        phone_number: User's phone number
        profile: UserProfile model

    Returns:
        Result dict (always JSON-serialisable)
    """
    fn = _TOOL_MAP.get(name)
    if not fn:
        return {"error": f"Unknown tool: {name}"}

    timezone = getattr(profile, "timezone", None) or DEFAULT_TIMEZONE

    try:
        result = fn(user_id=user_id, timezone=timezone, phone_number=phone_number, **args)
        logger.info(f"Tool {name} executed: {json.dumps(result, default=str)[:200]}")
        return result
    except Exception as e:
        logger.error(f"Tool {name} failed: {e}", exc_info=True)
        return {"error": f"Tool execution failed: {str(e)}"}
