"""
SMS Agent Plan Tools.
Provides get_current_plan and save_plan_draft for structural plan changes
via the draft-and-review flow.
"""

from datetime import datetime, timedelta
from typing import Any
import logging

from nanoid import generate as nanoid
from app.db.supabase_client import get_supabase
from app.db.queries import get_user_workout_plan

logger = logging.getLogger(__name__)

DRAFT_EXPIRY_DAYS = 7

DAY_ORDER = {
    "monday": 0, "tuesday": 1, "wednesday": 2, "thursday": 3,
    "friday": 4, "saturday": 5, "sunday": 6,
}


def _sort_workouts_by_day(plan_data: dict) -> dict:
    """Sort workouts array by day of week (Monday first)."""
    workouts = plan_data.get("workouts")
    if not workouts:
        return plan_data
    plan_data["workouts"] = sorted(
        workouts,
        key=lambda w: DAY_ORDER.get(w.get("day", "").lower(), 99),
    )
    return plan_data


# ---------------------------------------------------------------------------
# Tool definitions (OpenAI function-calling format)
# ---------------------------------------------------------------------------

PLAN_TOOL_DEFINITIONS = [
    {
        "type": "function",
        "function": {
            "name": "get_current_plan",
            "description": "Get the user's current active workout plan template including all days and exercises.",
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
            "name": "save_plan_draft",
            "description": "Save a new workout plan draft for the user to review via a web link. Use this for structural plan changes (changing split, adding/removing days, overhauling exercises). The user will review and accept or request further changes.",
            "parameters": {
                "type": "object",
                "properties": {
                    "plan_data": {
                        "type": "object",
                        "description": "Complete plan data object with workouts array. Each workout needs: day (e.g. 'Monday'), focus, duration, exercises (array of {name, sets (integer), reps (string)}).",
                        "properties": {
                            "weeklyVolume": {
                                "type": "string",
                                "description": "Optional weekly volume description.",
                            },
                            "workouts": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "day": {"type": "string"},
                                        "focus": {"type": "string"},
                                        "duration": {"type": "string"},
                                        "exercises": {
                                            "type": "array",
                                            "items": {
                                                "type": "object",
                                                "properties": {
                                                    "name": {"type": "string"},
                                                    "sets": {"type": "integer"},
                                                    "reps": {"type": "string"},
                                                },
                                                "required": ["name", "sets", "reps"],
                                            },
                                        },
                                    },
                                    "required": ["day", "focus", "duration", "exercises"],
                                },
                            },
                        },
                        "required": ["workouts"],
                    },
                },
                "required": ["plan_data"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "cancel_plan_draft",
            "description": "Cancel the user's pending plan draft. Use when the user changes their mind about a drafted plan and doesn't want it anymore.",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": [],
            },
        },
    },
]


# ---------------------------------------------------------------------------
# Tool implementations
# ---------------------------------------------------------------------------

def _get_current_plan(user_id: str, **_kwargs) -> dict:
    """Fetch the user's active workout plan."""
    plan = get_user_workout_plan(user_id)
    if not plan:
        return {"error": "No active plan found"}

    plan_data = plan.get("plan_data")
    if not plan_data:
        return {"error": "Plan exists but has no plan_data"}

    return {"plan_data": plan_data}


def _save_plan_draft(user_id: str, plan_data: dict, **_kwargs) -> dict:
    """Create a plan draft for user review."""
    supabase = get_supabase()

    # Validate plan_data has workouts
    if not plan_data or not plan_data.get("workouts"):
        return {"error": "plan_data must include a workouts array"}

    # Sort workouts by day of week (agent may output them in wrong order)
    plan_data = _sort_workouts_by_day(plan_data)

    # Expire any existing pending drafts for this user
    supabase.table("plan_drafts").update({
        "status": "expired",
    }).eq("user_id", user_id).eq("status", "pending").execute()

    # Generate token and expiry
    token = nanoid(size=21)
    expires_at = (datetime.utcnow() + timedelta(days=DRAFT_EXPIRY_DAYS)).isoformat()

    # Insert new draft
    result = supabase.table("plan_drafts").insert({
        "user_id": user_id,
        "token": token,
        "plan_data": plan_data,
        "status": "pending",
        "expires_at": expires_at,
    }).execute()

    if not result.data:
        return {"error": "Failed to save plan draft"}

    url = f"https://textbrandon.now/plan/draft/{token}"

    logger.info(f"Plan draft saved for user {user_id}: {url}")

    return {
        "success": True,
        "url": url,
        "message": "Draft saved. Share the URL with the user so they can review and accept.",
    }


def _cancel_plan_draft(user_id: str, **_kwargs) -> dict:
    """Cancel any pending plan drafts for the user."""
    supabase = get_supabase()

    result = supabase.table("plan_drafts").update({
        "status": "expired",
    }).eq("user_id", user_id).eq("status", "pending").execute()

    expired_count = len(result.data) if result.data else 0

    if expired_count == 0:
        return {"success": True, "message": "No pending draft to cancel."}

    logger.info(f"Cancelled {expired_count} pending draft(s) for user {user_id}")
    return {"success": True, "message": "Plan draft cancelled."}


# ---------------------------------------------------------------------------
# Exports
# ---------------------------------------------------------------------------

PLAN_TOOL_MAP = {
    "get_current_plan": _get_current_plan,
    "save_plan_draft": _save_plan_draft,
    "cancel_plan_draft": _cancel_plan_draft,
}
