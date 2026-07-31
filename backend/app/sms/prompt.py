"""
SMS Prompt Builder.
Builds system prompt from template + user profile.
Unlike the old system, does NOT inject workout data (agent fetches via tools).
"""

from datetime import datetime
from zoneinfo import ZoneInfo
import logging

from app.config import settings
from app.prompts.loader import get_prompt_with_model, safe_format

logger = logging.getLogger(__name__)

DEFAULT_TIMEZONE = "America/Chicago"


def build_system_prompt(prompt_template: str, user_id: str, profile, pending_draft: dict | None = None) -> str:
    """
    Fill system prompt template with user profile data.

    Args:
        prompt_template: Template string with {placeholders}
        user_id: User ID
        profile: UserProfile model (or dict-like)
        pending_draft: Optional pending plan draft dict with token, plan_data, etc.

    Returns:
        Filled system prompt string
    """
    # Resolve timezone
    tz_str = getattr(profile, "timezone", None) or DEFAULT_TIMEZONE
    try:
        user_tz = ZoneInfo(tz_str)
    except Exception:
        user_tz = ZoneInfo(DEFAULT_TIMEZONE)
        tz_str = DEFAULT_TIMEZONE

    now_local = datetime.now(user_tz)
    current_datetime = now_local.strftime("%A, %B %d, %Y at %I:%M %p")

    equipment = getattr(profile, "equipment", None)
    if isinstance(equipment, list):
        equipment_str = ", ".join(equipment) if equipment else "no equipment"
    else:
        equipment_str = equipment or "no equipment"

    # Build pending draft context string
    pending_draft_str = ""
    if pending_draft:
        token = pending_draft.get("token", "")
        plan_data = pending_draft.get("plan_data", {})
        workouts = plan_data.get("workouts", [])
        days_overview = ", ".join(
            f"{w.get('day', '?')} ({w.get('focus', '?')})" for w in workouts
        )
        url = f"{settings.frontend_url}/plan/draft/{token}"
        pending_draft_str = (
            f"PENDING PLAN DRAFT: You already sent this user a draft plan that they haven't accepted yet.\n"
            f"Draft URL: {url}\n"
            f"Days: {days_overview}\n"
            f"If they want changes to this draft, create a new draft with save_plan_draft (the old one expires automatically). "
            f"If they haven't seen it yet, remind them to check the link."
        )
    TOOL_ACK_GUIDANCE = (
        "\n\n## Tool acknowledgments\n"
        "When using tools, you do NOT need to say something every time. "
        "Only include text alongside a tool call when:\n"
        "- The user asked a question and you want to acknowledge before a slow lookup\n"
        "- You want to set expectations (\"Let me pull up your stats for the past month...\")\n"
        "- The user seems frustrated or anxious and a quick response would help\n\n"
        "Do NOT include filler text like \"Let me check that\" or \"One moment\" for simple, "
        "fast tool calls like fetching today's workout or checking the schedule. "
        "Just use the tool silently and respond with the result."
    )

    prompt = safe_format(prompt_template, {
        "user_name": getattr(profile, "name", "there"),
        "goal": getattr(profile, "goal", "general fitness"),
        "experience": getattr(profile, "experience", None) or "beginner",
        "equipment": equipment_str,
        "split": getattr(profile, "split", None) or "full body",
        "timezone": tz_str,
        "current_datetime": current_datetime,
        "pending_draft": pending_draft_str,
    })

    return prompt + TOOL_ACK_GUIDANCE
