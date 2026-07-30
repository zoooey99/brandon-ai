"""
Schedule Materialisation.
Pre-generates workout_sessions rows for the next 14 days from the plan template.
Each session also gets a tracking token (expires 7 days after the session date).
Idempotent — skips dates that already have rows.
"""

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
import logging

from nanoid import generate as nanoid

from app.db.supabase_client import get_supabase
from app.db.queries import get_user_workout_plan

logger = logging.getLogger(__name__)

DEFAULT_TIMEZONE = "America/Chicago"

# Map day names to Python weekday numbers (Monday=0 … Sunday=6)
_DAY_INDEX = {
    "Monday": 0, "Tuesday": 1, "Wednesday": 2,
    "Thursday": 3, "Friday": 4, "Saturday": 5, "Sunday": 6,
}


def ensure_schedule_materialized(user_id: str, timezone: str | None = None) -> None:
    """
    Ensure the next 14 days of workout_sessions exist for the user.

    - Reads the active workout_plan.plan_data.workouts array.
    - For each upcoming calendar date that matches a workout day, inserts a row
      if one doesn't already exist for that (user_id, scheduled_for) date.
    - Rows with source='rescheduled' or 'custom' are never overwritten.

    Args:
        user_id: User ID
        timezone: User's timezone string (default: America/Chicago)
    """
    plan = get_user_workout_plan(user_id)
    if not plan:
        logger.debug(f"No active plan for {user_id}, skipping schedule materialization")
        return

    plan_data = plan.get("plan_data", {})
    workouts = plan_data.get("workouts", []) if isinstance(plan_data, dict) else []
    if not workouts:
        logger.debug(f"Plan for {user_id} has no workouts array")
        return

    plan_id = plan.get("id")

    # Build a lookup: day_name -> workout dict
    workout_by_day: dict[str, dict] = {}
    for w in workouts:
        day_name = w.get("day")
        if day_name and day_name in _DAY_INDEX:
            workout_by_day[day_name] = w

    if not workout_by_day:
        return

    # Determine today in user's timezone
    tz_str = timezone or DEFAULT_TIMEZONE
    try:
        user_tz = ZoneInfo(tz_str)
    except Exception:
        user_tz = ZoneInfo(DEFAULT_TIMEZONE)

    today = datetime.now(user_tz).date()

    supabase = get_supabase()

    # Fetch existing sessions in the 14-day window so we can skip them
    start_str = today.isoformat()
    end_str = (today + timedelta(days=14)).isoformat()

    existing_resp = (
        supabase.table("workout_sessions")
        .select("scheduled_for")
        .eq("user_id", user_id)
        .gte("scheduled_for", start_str)
        .lt("scheduled_for", end_str)
        .execute()
    )

    existing_dates: set[str] = set()
    for row in existing_resp.data or []:
        sf = row.get("scheduled_for", "")
        # Normalise to date string (YYYY-MM-DD)
        existing_dates.add(sf[:10])

    # Walk each of the next 14 days
    rows_to_insert = []
    for offset in range(14):
        d = today + timedelta(days=offset)
        day_name = d.strftime("%A")

        if day_name not in workout_by_day:
            continue  # rest day

        date_str = d.isoformat()
        if date_str in existing_dates:
            continue  # already materialised

        workout = workout_by_day[day_name]
        rows_to_insert.append({
            "user_id": user_id,
            "plan_id": plan_id,
            "workout_date": f"{date_str}T00:00:00",
            "scheduled_for": f"{date_str}T00:00:00",
            "day_index": _DAY_INDEX[day_name],
            "day_name": day_name,
            "focus": workout.get("focus", "Workout"),
            "exercises": workout.get("exercises"),
            "source": "plan",
            "status": "pending",
        })

    if rows_to_insert:
        result = supabase.table("workout_sessions").insert(rows_to_insert).execute()

        # Generate tracking tokens for each new session
        tokens_to_insert = []
        for session_row in result.data or []:
            session_id = session_row["id"]
            scheduled_for = session_row.get("scheduled_for", "")
            # Parse the scheduled_for date to compute expiry (session date + 7 days)
            try:
                session_date = datetime.fromisoformat(scheduled_for[:10])
            except Exception:
                session_date = datetime.utcnow()

            expires_at = session_date + timedelta(days=7)

            tokens_to_insert.append({
                "token": nanoid(size=21),
                "session_id": session_id,
                "expires_at": expires_at.isoformat(),
            })

        if tokens_to_insert:
            supabase.table("session_tokens").insert(tokens_to_insert).execute()

        logger.info(
            f"Materialized {len(rows_to_insert)} session(s) with tokens for user {user_id} "
            f"({start_str} to {end_str})"
        )
    else:
        logger.debug(f"Schedule already up-to-date for user {user_id}")
