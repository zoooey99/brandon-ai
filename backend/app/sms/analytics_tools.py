"""
SMS Agent Analytics Tools.
Provides exercise search, workout data querying, and math tools (1RM, trend, projection)
for the SMS agent to answer questions about training progress.
"""

from datetime import datetime, timedelta, date
from typing import Any
import logging
import math

from app.db.supabase_client import get_supabase

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Common exercise aliases
# ---------------------------------------------------------------------------

_EXERCISE_ALIASES = {
    "bench": "bench press",
    "flat bench": "bench press",
    "bp": "bench press",
    "squat": "back squat",
    "bs": "back squat",
    "rdl": "romanian deadlift",
    "ohp": "overhead press",
    "shoulder press": "overhead press",
    "military press": "overhead press",
    "dl": "deadlift",
    "pull up": "pull-up",
    "pullup": "pull-up",
    "chin up": "chin-up",
    "chinup": "chin-up",
    "db": "dumbbell",
    "bb": "barbell",
    "inc bench": "incline bench press",
    "incline bench": "incline bench press",
    "lat raise": "lateral raise",
    "lat pulldown": "lat pulldown",
    "hip thrust": "hip thrust",
    "leg press": "leg press",
    "leg curl": "leg curl",
    "leg ext": "leg extension",
    "leg extension": "leg extension",
    "tri": "tricep",
    "bis": "bicep",
    "curls": "bicep curl",
    "skull crushers": "skull crusher",
    "face pull": "face pull",
    "cable fly": "cable fly",
    "chest fly": "chest fly",
    "pec deck": "pec deck",
    "row": "row",
    "bent over row": "barbell row",
    "t bar row": "t-bar row",
}

# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------


def _epley_1rm(weight: float, reps: int) -> float:
    """Estimate 1RM using the Epley formula."""
    if reps <= 0 or weight <= 0:
        return 0.0
    if reps == 1:
        return float(weight)
    return round(weight * (1 + reps / 30), 1)


def _linear_regression(xs: list[float], ys: list[float]) -> tuple[float, float, float]:
    """
    Simple least-squares linear regression.
    Returns (slope, intercept, r_squared).
    """
    n = len(xs)
    if n < 2:
        return 0.0, ys[0] if ys else 0.0, 0.0

    sum_x = sum(xs)
    sum_y = sum(ys)
    sum_xy = sum(x * y for x, y in zip(xs, ys))
    sum_x2 = sum(x * x for x in xs)
    sum_y2 = sum(y * y for y in ys)

    denom = n * sum_x2 - sum_x * sum_x
    if denom == 0:
        return 0.0, sum_y / n, 0.0

    slope = (n * sum_xy - sum_x * sum_y) / denom
    intercept = (sum_y - slope * sum_x) / n

    # R-squared
    ss_res = sum((y - (slope * x + intercept)) ** 2 for x, y in zip(xs, ys))
    y_mean = sum_y / n
    ss_tot = sum((y - y_mean) ** 2 for y in ys)
    r_squared = 1 - (ss_res / ss_tot) if ss_tot > 0 else 0.0

    return slope, intercept, r_squared


def _get_completed_session_ids(
    user_id: str,
    start_date: str | None = None,
    end_date: str | None = None,
    limit: int = 500,
) -> list[int]:
    """Get IDs of completed workout sessions for a user within a date range."""
    supabase = get_supabase()

    if not start_date:
        start_date = (datetime.utcnow() - timedelta(days=90)).strftime("%Y-%m-%d")
    if not end_date:
        end_date = (datetime.utcnow() + timedelta(days=1)).strftime("%Y-%m-%d")

    resp = (
        supabase.table("workout_sessions")
        .select("id")
        .eq("user_id", user_id)
        .eq("status", "completed")
        .gte("workout_date", start_date)
        .lt("workout_date", end_date + "T23:59:59")
        .order("workout_date", desc=True)
        .limit(limit)
        .execute()
    )
    return [row["id"] for row in (resp.data or [])]


def _fetch_sets_for_sessions(
    session_ids: list[int],
    exercise_name: str | None = None,
) -> list[dict]:
    """Fetch workout_sets rows for given session IDs, optionally filtered by exercise."""
    if not session_ids:
        return []

    supabase = get_supabase()
    all_sets = []

    # Batch in groups of 100 to keep .in_() manageable
    for i in range(0, len(session_ids), 100):
        batch = session_ids[i : i + 100]
        query = (
            supabase.table("workout_sets")
            .select("id, session_id, exercise_name, exercise_index, set_number, weight, reps, rpe, completed, created_at")
            .in_("session_id", batch)
            .eq("completed", 1)
        )
        if exercise_name:
            query = query.eq("exercise_name", exercise_name)

        resp = query.order("session_id").order("exercise_index").order("set_number").execute()
        all_sets.extend(resp.data or [])

    return all_sets


def _get_session_dates(session_ids: list[int]) -> dict[int, str]:
    """Get workout_date for a list of session IDs."""
    if not session_ids:
        return {}

    supabase = get_supabase()
    dates = {}

    for i in range(0, len(session_ids), 100):
        batch = session_ids[i : i + 100]
        resp = (
            supabase.table("workout_sessions")
            .select("id, workout_date")
            .in_("id", batch)
            .execute()
        )
        for row in resp.data or []:
            dates[row["id"]] = row["workout_date"][:10] if row.get("workout_date") else ""

    return dates


# ---------------------------------------------------------------------------
# Aggregation helpers
# ---------------------------------------------------------------------------


def _group_by_set(sets_data: list[dict]) -> list[dict]:
    """Return raw set data, capped at 500."""
    result = []
    for s in sets_data[:500]:
        result.append({
            "session_id": s["session_id"],
            "exercise_name": s["exercise_name"],
            "set_number": s["set_number"],
            "weight": s.get("weight"),
            "reps": s.get("reps"),
            "rpe": s.get("rpe"),
        })
    return result


def _group_by_session(sets_data: list[dict], session_dates: dict[int, str]) -> list[dict]:
    """Aggregate sets per session: max_weight, estimated_1rm, total_volume, avg_rpe, set_count, best_set."""
    # Group sets by session_id
    sessions: dict[int, list[dict]] = {}
    for s in sets_data:
        sid = s["session_id"]
        if sid not in sessions:
            sessions[sid] = []
        sessions[sid].append(s)

    result = []
    for sid, session_sets in sessions.items():
        max_weight = 0
        best_1rm = 0.0
        total_volume = 0.0
        rpe_sum = 0.0
        rpe_count = 0
        best_set = None

        for s in session_sets:
            w = s.get("weight") or 0
            r = s.get("reps") or 0
            rpe = s.get("rpe")

            if w > max_weight:
                max_weight = w

            e1rm = _epley_1rm(w, r)
            if e1rm > best_1rm:
                best_1rm = e1rm
                best_set = {"weight": w, "reps": r, "rpe": rpe}

            total_volume += w * r

            if rpe is not None and rpe > 0:
                rpe_sum += rpe
                rpe_count += 1

        result.append({
            "session_id": sid,
            "date": session_dates.get(sid, ""),
            "max_weight": max_weight,
            "estimated_1rm": best_1rm,
            "total_volume": round(total_volume),
            "avg_rpe": round(rpe_sum / rpe_count, 1) if rpe_count > 0 else None,
            "set_count": len(session_sets),
            "best_set": best_set,
        })

    # Sort by date
    result.sort(key=lambda x: x["date"])
    return result[:100]


def _group_by_week(sets_data: list[dict], session_dates: dict[int, str]) -> list[dict]:
    """Aggregate per ISO week."""
    # First get per-session data
    session_data = _group_by_session(sets_data, session_dates)

    # Group by ISO week
    weeks: dict[str, list[dict]] = {}
    for sd in session_data:
        if not sd["date"]:
            continue
        try:
            dt = datetime.strptime(sd["date"], "%Y-%m-%d")
            iso = dt.isocalendar()
            week_key = f"{iso[0]}-W{iso[1]:02d}"
        except ValueError:
            continue

        if week_key not in weeks:
            weeks[week_key] = []
        weeks[week_key].append(sd)

    result = []
    for week_key in sorted(weeks.keys()):
        week_sessions = weeks[week_key]
        max_weight = max(s["max_weight"] for s in week_sessions)
        best_1rm = max(s["estimated_1rm"] for s in week_sessions)
        total_volume = sum(s["total_volume"] for s in week_sessions)
        rpe_values = [s["avg_rpe"] for s in week_sessions if s["avg_rpe"] is not None]
        avg_rpe = round(sum(rpe_values) / len(rpe_values), 1) if rpe_values else None

        result.append({
            "week": week_key,
            "session_count": len(week_sessions),
            "max_weight": max_weight,
            "estimated_1rm": best_1rm,
            "total_volume": round(total_volume),
            "avg_rpe": avg_rpe,
        })

    return result


def _group_by_exercise(sets_data: list[dict], session_dates: dict[int, str]) -> list[dict]:
    """Aggregate per exercise across all sessions."""
    exercises: dict[str, list[dict]] = {}
    for s in sets_data:
        name = s["exercise_name"]
        if name not in exercises:
            exercises[name] = []
        exercises[name].append(s)

    result = []
    for name, ex_sets in exercises.items():
        session_ids_for_ex = list(set(s["session_id"] for s in ex_sets))
        max_weight = max((s.get("weight") or 0) for s in ex_sets)
        best_1rm = max(_epley_1rm(s.get("weight") or 0, s.get("reps") or 0) for s in ex_sets)
        total_volume = sum((s.get("weight") or 0) * (s.get("reps") or 0) for s in ex_sets)
        rpe_values = [s["rpe"] for s in ex_sets if s.get("rpe") and s["rpe"] > 0]
        avg_rpe = round(sum(rpe_values) / len(rpe_values), 1) if rpe_values else None

        result.append({
            "exercise_name": name,
            "session_count": len(session_ids_for_ex),
            "set_count": len(ex_sets),
            "max_weight": max_weight,
            "estimated_1rm": best_1rm,
            "total_volume": round(total_volume),
            "avg_rpe": avg_rpe,
        })

    result.sort(key=lambda x: x["session_count"], reverse=True)
    return result


# ---------------------------------------------------------------------------
# Tool implementations
# ---------------------------------------------------------------------------


def _search_exercises(user_id: str, query: str, **_kwargs) -> dict:
    """Fuzzy search exercise names from user's completed workout history."""
    if not query or not query.strip():
        return {"error": "Please provide a search query."}

    query_lower = query.strip().lower()

    # Expand aliases
    expanded = _EXERCISE_ALIASES.get(query_lower, query_lower)

    # Get completed session IDs (last 500 sessions)
    session_ids = _get_completed_session_ids(user_id, limit=500)
    if not session_ids:
        return {"matches": [], "message": "No completed workouts found. Complete some workouts first to search exercise history."}

    # Get distinct exercise names from those sessions
    supabase = get_supabase()
    exercise_names = set()

    for i in range(0, len(session_ids), 100):
        batch = session_ids[i : i + 100]
        resp = (
            supabase.table("workout_sets")
            .select("exercise_name")
            .in_("session_id", batch)
            .eq("completed", 1)
            .execute()
        )
        for row in resp.data or []:
            exercise_names.add(row["exercise_name"])

    if not exercise_names:
        return {"matches": [], "message": "No completed sets found in workout history."}

    # Score each exercise name
    matches = []
    for name in exercise_names:
        name_lower = name.lower()
        score = 0

        # Exact match
        if name_lower == expanded or name_lower == query_lower:
            score = 100
        # Starts with query
        elif name_lower.startswith(expanded) or name_lower.startswith(query_lower):
            score = 80
        # Word match (any word in exercise name matches query)
        elif expanded in name_lower.split() or query_lower in name_lower.split():
            score = 70
        # Substring match
        elif expanded in name_lower or query_lower in name_lower:
            score = 60
        else:
            # Partial word overlap
            query_words = set(expanded.split())
            name_words = set(name_lower.split())
            overlap = query_words & name_words
            if overlap:
                score = 40 + int(20 * len(overlap) / len(query_words))

        if score > 0:
            matches.append({"exercise_name": name, "score": score})

    # Sort by score descending, take top 10
    matches.sort(key=lambda m: m["score"], reverse=True)
    return {"matches": matches[:10]}


def _query_workout_data(
    user_id: str,
    exercise: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    group_by: str | None = None,
    **_kwargs,
) -> dict:
    """Query workout data with flexible aggregation."""
    group_by = group_by or "session"

    if group_by not in ("set", "session", "week", "exercise"):
        return {"error": f"Invalid group_by value: {group_by}. Use: set, session, week, exercise"}

    # Get completed sessions in date range
    session_ids = _get_completed_session_ids(user_id, start_date, end_date)
    if not session_ids:
        return {"data": [], "message": "No completed workouts found in the specified date range."}

    # Fetch sets
    sets_data = _fetch_sets_for_sessions(session_ids, exercise_name=exercise)
    if not sets_data:
        msg = f"No completed sets found"
        if exercise:
            msg += f" for '{exercise}'"
        msg += " in the specified date range."
        return {"data": [], "message": msg}

    # Get session dates for aggregation
    relevant_session_ids = list(set(s["session_id"] for s in sets_data))
    session_dates = _get_session_dates(relevant_session_ids)

    # Aggregate
    if group_by == "set":
        data = _group_by_set(sets_data)
    elif group_by == "session":
        data = _group_by_session(sets_data, session_dates)
    elif group_by == "week":
        data = _group_by_week(sets_data, session_dates)
    elif group_by == "exercise":
        data = _group_by_exercise(sets_data, session_dates)

    return {
        "data": data,
        "group_by": group_by,
        "total_sessions": len(session_ids),
        "exercise_filter": exercise,
    }


def _calculate_1rm(weight: float | int, reps: int, **_kwargs) -> dict:
    """Calculate estimated 1RM using the Epley formula."""
    if weight <= 0:
        return {"error": "Weight must be greater than 0."}
    if reps <= 0:
        return {"error": "Reps must be greater than 0."}

    estimated = _epley_1rm(float(weight), int(reps))
    return {
        "estimated_1rm": estimated,
        "weight": weight,
        "reps": reps,
        "formula": "Epley: weight * (1 + reps/30)",
    }


def _calculate_trend(data_points: list[dict], **_kwargs) -> dict:
    """
    Calculate linear trend from data points.
    Each point: {x: date_string_or_number, y: numeric_value}
    """
    if not data_points or len(data_points) < 2:
        return {"error": "Need at least 2 data points to calculate a trend."}

    # Parse x values
    xs = []
    ys = []
    for pt in data_points:
        x_val = pt.get("x")
        y_val = pt.get("y")

        if y_val is None:
            continue

        try:
            y = float(y_val)
        except (TypeError, ValueError):
            continue

        # Try parsing as date first
        if isinstance(x_val, str) and len(x_val) >= 8:
            try:
                dt = datetime.strptime(x_val[:10], "%Y-%m-%d")
                xs.append(dt.toordinal())
                ys.append(y)
                continue
            except ValueError:
                pass

        # Otherwise treat as numeric
        try:
            xs.append(float(x_val))
            ys.append(y)
        except (TypeError, ValueError):
            continue

    if len(xs) < 2:
        return {"error": "Need at least 2 valid data points to calculate a trend."}

    # Normalize x to start at 0
    x_min = min(xs)
    xs_norm = [x - x_min for x in xs]

    slope, intercept, r_squared = _linear_regression(xs_norm, ys)

    # Calculate slope per week (7 days)
    slope_per_week = slope * 7

    # Direction
    if abs(slope_per_week) < 0.1:
        direction = "flat"
    elif slope_per_week > 0:
        direction = "increasing"
    else:
        direction = "decreasing"

    start_value = ys[0]
    end_value = ys[-1]

    return {
        "direction": direction,
        "slope_per_week": round(slope_per_week, 2),
        "r_squared": round(r_squared, 3),
        "start_value": round(start_value, 1),
        "end_value": round(end_value, 1),
        "change": round(end_value - start_value, 1),
        "data_points": len(xs),
    }


def _calculate_projection(
    data_points: list[dict],
    target_value: float | None = None,
    target_date: str | None = None,
    **_kwargs,
) -> dict:
    """
    Project forward using linear regression.
    - target_value: "When will I hit X?" -> returns estimated_date
    - target_date: "Where will I be by date?" -> returns projected_value
    """
    if not data_points or len(data_points) < 2:
        return {"error": "Need at least 2 data points for a projection."}

    if target_value is None and target_date is None:
        return {"error": "Provide either target_value or target_date."}

    # Parse data points
    xs = []
    ys = []
    is_date_based = False

    for pt in data_points:
        x_val = pt.get("x")
        y_val = pt.get("y")

        if y_val is None:
            continue

        try:
            y = float(y_val)
        except (TypeError, ValueError):
            continue

        if isinstance(x_val, str) and len(x_val) >= 8:
            try:
                dt = datetime.strptime(x_val[:10], "%Y-%m-%d")
                xs.append(dt.toordinal())
                ys.append(y)
                is_date_based = True
                continue
            except ValueError:
                pass

        try:
            xs.append(float(x_val))
            ys.append(y)
        except (TypeError, ValueError):
            continue

    if len(xs) < 2:
        return {"error": "Need at least 2 valid data points for projection."}

    x_min = min(xs)
    xs_norm = [x - x_min for x in xs]

    slope, intercept, r_squared = _linear_regression(xs_norm, ys)

    result = {"r_squared": round(r_squared, 3), "data_points": len(xs)}

    if target_value is not None:
        target_value = float(target_value)
        current_value = ys[-1]

        # Already surpassed?
        if current_value >= target_value:
            return {
                **result,
                "already_reached": True,
                "current_value": round(current_value, 1),
                "target_value": target_value,
                "message": f"You've already surpassed {target_value}! Current: {round(current_value, 1)}",
            }

        # Flat or negative trend
        if slope <= 0:
            direction = "flat" if abs(slope * 7) < 0.1 else "decreasing"
            return {
                **result,
                "can_estimate": False,
                "current_value": round(current_value, 1),
                "target_value": target_value,
                "trend_direction": direction,
                "message": f"With a {direction} trend, can't estimate when you'll reach {target_value}.",
            }

        # Calculate when
        x_last = xs_norm[-1]
        # slope * x_target + intercept = target_value
        x_target = (target_value - intercept) / slope
        days_away = x_target - x_last

        if is_date_based:
            last_date = date.fromordinal(int(xs[-1]))
            est_date = last_date + timedelta(days=int(days_away))
            weeks_away = round(days_away / 7, 1)
            result.update({
                "estimated_date": est_date.isoformat(),
                "weeks_away": weeks_away,
                "current_value": round(current_value, 1),
                "target_value": target_value,
                "slope_per_week": round(slope * 7, 2),
            })
        else:
            result.update({
                "steps_away": round(days_away, 1),
                "current_value": round(current_value, 1),
                "target_value": target_value,
            })

    elif target_date is not None:
        if not is_date_based:
            return {"error": "target_date requires date-based x values in data_points."}

        try:
            target_dt = datetime.strptime(target_date[:10], "%Y-%m-%d")
        except ValueError:
            return {"error": "Invalid target_date format. Use YYYY-MM-DD."}

        target_ordinal = target_dt.toordinal() - x_min
        projected = slope * target_ordinal + intercept

        result.update({
            "target_date": target_date[:10],
            "projected_value": round(projected, 1),
            "current_value": round(ys[-1], 1),
            "slope_per_week": round(slope * 7, 2),
        })

    return result


# ---------------------------------------------------------------------------
# Tool definitions (OpenAI function-calling format)
# ---------------------------------------------------------------------------

ANALYTICS_TOOL_DEFINITIONS = [
    {
        "type": "function",
        "function": {
            "name": "search_exercises",
            "description": "Fuzzy search for exercise names in the user's completed workout history. Use this to find the exact exercise name before querying workout data.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Search term, e.g. 'bench', 'squat', 'rdl'. Handles common aliases.",
                    },
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "query_workout_data",
            "description": "Query the user's completed workout data with flexible aggregation. Use search_exercises first to get exact exercise names.",
            "parameters": {
                "type": "object",
                "properties": {
                    "exercise": {
                        "type": "string",
                        "description": "Exact exercise name (from search_exercises). Omit for all exercises.",
                    },
                    "start_date": {
                        "type": "string",
                        "description": "Start date in YYYY-MM-DD format. Defaults to 90 days ago.",
                    },
                    "end_date": {
                        "type": "string",
                        "description": "End date in YYYY-MM-DD format. Defaults to today.",
                    },
                    "group_by": {
                        "type": "string",
                        "enum": ["set", "session", "week", "exercise"],
                        "description": "Aggregation level. 'set' = raw rows, 'session' = per-session metrics (default), 'week' = per-ISO-week, 'exercise' = per-exercise summary.",
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "calculate_1rm",
            "description": "Calculate estimated one-rep max using the Epley formula: weight * (1 + reps/30).",
            "parameters": {
                "type": "object",
                "properties": {
                    "weight": {
                        "type": "number",
                        "description": "Weight lifted.",
                    },
                    "reps": {
                        "type": "integer",
                        "description": "Number of reps performed.",
                    },
                },
                "required": ["weight", "reps"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "calculate_trend",
            "description": "Calculate a linear trend from data points. Returns direction (increasing/decreasing/flat), slope per week, and R-squared. Feed in session metrics from query_workout_data.",
            "parameters": {
                "type": "object",
                "properties": {
                    "data_points": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "x": {
                                    "type": "string",
                                    "description": "Date (YYYY-MM-DD) or numeric value for the x-axis.",
                                },
                                "y": {
                                    "type": "number",
                                    "description": "Metric value (e.g. estimated_1rm, max_weight, total_volume).",
                                },
                            },
                            "required": ["x", "y"],
                        },
                        "description": "Array of data points with x (date or number) and y (value) fields.",
                    },
                },
                "required": ["data_points"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "calculate_projection",
            "description": "Project forward using linear regression. Either estimate when a target value will be reached, or project what the value will be at a target date.",
            "parameters": {
                "type": "object",
                "properties": {
                    "data_points": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "x": {
                                    "type": "string",
                                    "description": "Date (YYYY-MM-DD) or numeric value.",
                                },
                                "y": {
                                    "type": "number",
                                    "description": "Metric value.",
                                },
                            },
                            "required": ["x", "y"],
                        },
                        "description": "Array of data points to build the regression from.",
                    },
                    "target_value": {
                        "type": "number",
                        "description": "Target metric value to project toward, e.g. 225 for a 225lb bench. Use this OR target_date.",
                    },
                    "target_date": {
                        "type": "string",
                        "description": "Target date in YYYY-MM-DD format to project to. Use this OR target_value.",
                    },
                },
                "required": ["data_points"],
            },
        },
    },
]

# ---------------------------------------------------------------------------
# Dispatch map
# ---------------------------------------------------------------------------

ANALYTICS_TOOL_MAP = {
    "search_exercises": _search_exercises,
    "query_workout_data": _query_workout_data,
    "calculate_1rm": _calculate_1rm,
    "calculate_trend": _calculate_trend,
    "calculate_projection": _calculate_projection,
}
