"""
SMS Handler — top-level orchestrator for inbound SMS messages.
Replaces message_handler.py for the SMS path.

Flow:
1. Validate user (subscription, phone)
2. Handle special flows (first message, verification, unknown phone)
3. Save inbound message
4. Ensure schedule is materialized
5. Enqueue for agent processing (with hybrid collect)
"""

from typing import List
from datetime import datetime
from zoneinfo import ZoneInfo
import logging

from app.db.models import (
    WebhookRequest, OutboundMessageChunk, InboundMessage,
)
from app.db.queries import (
    save_message, is_first_message,
    get_user_workout_plan, get_onboarding_user_by_phone,
    get_user_and_profile_by_id,
)
from app.services.user_validator import get_user_validator
from app.services.mac_client import get_mac_client
from app.services.tracking import create_tracking_session
from app.services.phone_verification import get_or_create_verification_code
from app.prompts.loader import get_prompt, render_template
from app.sms.schedule import ensure_schedule_materialized
from app.sms.agent import run_agent
from app.sms.queue import enqueue_and_process, get_current_generation, drain_pending

logger = logging.getLogger(__name__)

DEFAULT_TIMEZONE = "America/Chicago"


# ---------------------------------------------------------------------------
# Message chunking — agent-directed via --- delimiters
# ---------------------------------------------------------------------------

def _split_on_delimiter(text: str) -> List[OutboundMessageChunk]:
    """Split agent response on --- delimiters into separate iMessage bubbles.

    The agent is prompted to use --- between distinct message chunks.
    If no delimiters are found and text is long, falls back to sentence splitting.
    """
    # Try agent-directed splitting first
    if "---" in text:
        parts = [p.strip() for p in text.split("---") if p.strip()]
    elif len(text) > 500:
        # Fallback: sentence-boundary split for unexpectedly long single chunks
        parts = _sentence_split(text, max_length=400)
    else:
        parts = [text.strip()] if text.strip() else []

    if not parts:
        return [OutboundMessageChunk(text="Hey! Let me know if you need anything.")]

    return [
        OutboundMessageChunk(text=chunk, delay_after_previous=2.0 if i > 0 else 0.0)
        for i, chunk in enumerate(parts)
    ]


def _sentence_split(text: str, max_length: int = 400) -> List[str]:
    """Fallback: split long text at sentence boundaries."""
    sentences = text.replace("! ", "!|").replace(". ", ".|").replace("? ", "?|").split("|")
    chunks: List[str] = []
    current = ""

    for sentence in sentences:
        sentence = sentence.strip()
        if not sentence:
            continue
        if len(current) + len(sentence) + 1 > max_length:
            if current:
                chunks.append(current.strip())
            current = sentence
        else:
            current += (" " + sentence if current else sentence)

    if current:
        chunks.append(current.strip())

    return chunks or [text]


# ---------------------------------------------------------------------------
# Helper: format exercises for first-message templates
# ---------------------------------------------------------------------------

def _format_exercises(exercises: list) -> str:
    lines = []
    for ex in exercises:
        name = ex.get("name", "Exercise")
        sets = ex.get("sets", "")
        reps = ex.get("reps", "")
        duration = ex.get("duration", "")
        if sets and reps:
            lines.append(f"- {name}: {sets} sets x {reps}")
        elif duration:
            lines.append(f"- {name}: {duration}")
        else:
            lines.append(f"- {name}")
    return "\n".join(lines)


def _format_text_time(time_str: str) -> str:
    try:
        hour, minute = time_str.split(":")[:2]
        hour = int(hour)
        minute = int(minute)
        period = "AM" if hour < 12 else "PM"
        hour_12 = hour % 12 or 12
        return f"{hour_12}:{minute:02d} {period}"
    except Exception:
        return time_str


def _get_todays_workout(workout_plan, timezone):
    if not workout_plan:
        return None
    try:
        plan_data = workout_plan.get("plan_data", {})
        tz_str = timezone or DEFAULT_TIMEZONE
        try:
            user_tz = ZoneInfo(tz_str)
        except Exception:
            user_tz = ZoneInfo(DEFAULT_TIMEZONE)
        today = datetime.now(user_tz).strftime("%A")
        if isinstance(plan_data, dict) and "workouts" in plan_data:
            for workout in plan_data["workouts"]:
                if workout.get("day") == today:
                    return workout
        return None
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Special-case handlers (preserved from old message_handler)
# ---------------------------------------------------------------------------

async def _handle_verification_code(phone_number: str, user_name: str) -> None:
    """Send verification code via mac_client."""
    mac_client = get_mac_client()
    try:
        code, is_new = get_or_create_verification_code(phone_number)
        if is_new:
            text = (
                f"Hey {user_name}! Your Brandon verification code is:\n\n"
                f"{code}"
            )
        else:
            text = (
                f"Here's your verification code again:\n\n"
                f"{code}"
            )
        await mac_client.send_message(
            phone_number=phone_number,
            messages=[OutboundMessageChunk(text=text)],
        )
    except Exception as e:
        logger.error(f"Error sending verification code to {phone_number}: {e}", exc_info=True)
        await mac_client.send_message(
            phone_number=phone_number,
            messages=[OutboundMessageChunk(text="Hey! I'm having trouble sending your verification code. Please try again in a moment.")],
        )


async def _handle_unknown_phone(phone_number: str) -> None:
    """Send signup redirect for truly unknown phone numbers."""
    mac_client = get_mac_client()
    await mac_client.send_message(
        phone_number=phone_number,
        messages=[
            OutboundMessageChunk(
                text="Hey! To get started with Brandon, visit textbrandon.now and create your account."
            )
        ],
    )


async def _handle_first_message(user_id: str, phone_number: str, profile) -> None:
    """Send intro template messages (bypasses agent), same as old handler."""
    mac_client = get_mac_client()
    try:
        text_time = _format_text_time(profile.preferred_text_time) if profile.preferred_text_time else "9:00 AM"
        variables = {"name": profile.name, "text_time": text_time}
        messages = render_template(get_prompt("first_message"), variables)

        workout_plan = get_user_workout_plan(user_id)
        workout_today = _get_todays_workout(workout_plan, profile.timezone)

        if workout_today:
            exercises_text = _format_exercises(workout_today.get("exercises", []))
            focus = workout_today.get("focus", "Today's Workout")
            user_tz_str = getattr(profile, "timezone", None) or DEFAULT_TIMEZONE
            try:
                user_tz = ZoneInfo(user_tz_str)
            except Exception:
                user_tz = ZoneInfo(DEFAULT_TIMEZONE)
            today_day_name = datetime.now(user_tz).strftime("%A")

            plan_id = workout_plan.get("id") if workout_plan else None
            tracking_url = create_tracking_session(user_id, plan_id, today_day_name, focus) or ""

            workout_variables = {
                "name": profile.name, "text_time": text_time,
                "focus": focus, "exercises": exercises_text, "tracking_url": tracking_url,
            }
            try:
                messages.extend(render_template(get_prompt("first_workout"), workout_variables))
            except Exception:
                fallback = f"Here's today's workout ({focus}):\n\n{exercises_text}\n\nTrack your workout: {tracking_url}"
                messages.append(fallback)

        elif workout_plan:
            rest_variables = {"name": profile.name, "text_time": text_time}
            try:
                messages.extend(render_template(get_prompt("first_rest_day"), rest_variables))
            except Exception:
                messages.append(f"Today's a rest day — your first workout will be tomorrow! Rest up and get ready.")

        chunks = [
            OutboundMessageChunk(text=msg, delay_after_previous=0.0 if i == 0 else 2.0)
            for i, msg in enumerate(messages)
        ]

        await mac_client.send_message(phone_number=phone_number, messages=chunks)

        # Save combined outbound
        save_message(
            user_id=user_id, phone_number=phone_number,
            direction="outbound",
            content=" | ".join(messages),
            metadata={"first_message_intro": True, "message_count": len(messages)},
        )
        logger.info(f"Sent {len(messages)} intro message(s) to first-time user {user_id}")

    except Exception as e:
        logger.error(f"Error sending first message: {e}", exc_info=True)
        fallback = f"Hey {profile.name}! I'm Brandon, your fitness coach. How can I help you today?"
        save_message(user_id=user_id, phone_number=phone_number, direction="outbound", content=fallback, metadata={"first_message_intro": True, "fallback": True})
        await mac_client.send_message(phone_number=phone_number, messages=[OutboundMessageChunk(text=fallback)])


# ---------------------------------------------------------------------------
# Welcome message (triggered by frontend after subscription)
# ---------------------------------------------------------------------------

async def send_welcome_message(user_id: str) -> bool:
    """Send welcome message with first workout after user subscribes.

    Called by the frontend after payment completes. The user has already been
    chatting with Brandon during onboarding, so this skips the full intro and
    sends a shorter "you're all set" message plus today's workout.

    Idempotent: skips if a welcome_message has already been sent for this user.

    Args:
        user_id: The subscribing user's ID

    Returns:
        True if message was sent (or already sent), False on error
    """
    mac_client = get_mac_client()
    try:
        # Look up user + profile
        result = get_user_and_profile_by_id(user_id)
        if not result:
            logger.error(f"send_welcome_message: no user/profile for {user_id}")
            return False

        user_data = result["user"]
        profile_data = result["profile"]
        phone_number = profile_data.get("phone")
        name = profile_data.get("name", "there")

        if not phone_number:
            logger.error(f"send_welcome_message: no phone for user {user_id}")
            return False

        # Idempotency: check if welcome message already sent
        from app.db.supabase_client import get_supabase
        supabase = get_supabase()
        existing = supabase.table("messages") \
            .select("id", count="exact") \
            .eq("user_id", user_id) \
            .eq("direction", "outbound") \
            .contains("metadata", {"welcome_message": True}) \
            .execute()
        if (existing.count or 0) > 0:
            logger.info(f"Welcome message already sent for user {user_id}, skipping")
            return True

        # Build messages: short welcome + workout
        text_time = _format_text_time(profile_data.get("preferred_text_time")) if profile_data.get("preferred_text_time") else "9:00 AM"
        variables = {"name": name, "text_time": text_time}

        try:
            messages = render_template(get_prompt("welcome_subscribed"), variables)
        except ValueError:
            # Fallback if prompt not seeded yet
            messages = [f"you're officially in, {name}! here's your first workout 💪"]

        # Append workout (reuse existing first_workout / first_rest_day templates)
        workout_plan = get_user_workout_plan(user_id)
        timezone = profile_data.get("timezone") or DEFAULT_TIMEZONE
        workout_today = _get_todays_workout(workout_plan, timezone)

        if workout_today:
            exercises_text = _format_exercises(workout_today.get("exercises", []))
            focus = workout_today.get("focus", "Today's Workout")
            try:
                user_tz = ZoneInfo(timezone)
            except Exception:
                user_tz = ZoneInfo(DEFAULT_TIMEZONE)
            today_day_name = datetime.now(user_tz).strftime("%A")

            plan_id = workout_plan.get("id") if workout_plan else None
            tracking_url = create_tracking_session(user_id, plan_id, today_day_name, focus) or ""

            workout_variables = {
                "name": name, "text_time": text_time,
                "focus": focus, "exercises": exercises_text, "tracking_url": tracking_url,
            }
            try:
                messages.extend(render_template(get_prompt("first_workout"), workout_variables))
            except Exception:
                fallback = f"Here's today's workout ({focus}):\n\n{exercises_text}\n\nTrack your workout: {tracking_url}"
                messages.append(fallback)
        elif workout_plan:
            rest_variables = {"name": name, "text_time": text_time}
            try:
                messages.extend(render_template(get_prompt("first_rest_day"), rest_variables))
            except Exception:
                messages.append("Today's a rest day — your first workout will be tomorrow! Rest up and get ready.")

        # Send via iMessage
        chunks = [
            OutboundMessageChunk(text=msg, delay_after_previous=0.0 if i == 0 else 2.0)
            for i, msg in enumerate(messages)
        ]
        await mac_client.send_message(phone_number=phone_number, messages=chunks)

        # Save to DB
        save_message(
            user_id=user_id, phone_number=phone_number,
            direction="outbound",
            content=" | ".join(messages),
            metadata={"welcome_message": True, "message_count": len(messages)},
        )
        logger.info(f"Sent {len(messages)} welcome message(s) to user {user_id}")

        # Schedule recurring daily messages
        from app.services.scheduler import schedule_user_message
        schedule_user_message(user_id)

        return True

    except Exception as e:
        logger.error(f"Error sending welcome message for {user_id}: {e}", exc_info=True)
        return False


# ---------------------------------------------------------------------------
# Agent runner (passed to queue as process_fn)
# ---------------------------------------------------------------------------

async def _run_agent_and_send(phone_number: str, messages: List[InboundMessage], *, user_id: str, profile) -> None:
    """Run the agent, then send the response via mac_client (checking generation)."""
    mac_client = get_mac_client()
    gen_before = get_current_generation(phone_number)

    combined = " ".join(m.text for m in messages)

    # Callback for sending intermediate messages mid-tool-execution
    async def send_fn(text: str) -> None:
        """Send a message immediately (used for acknowledge-before-action)."""
        text = text.strip()
        if not text:
            return
        save_message(
            user_id=user_id, phone_number=phone_number,
            direction="outbound", content=text,
            metadata={"ai_generated": True, "engine": "sms_agent", "intermediate": True},
        )
        chunks = _split_on_delimiter(text)
        await mac_client.send_message(phone_number=phone_number, messages=chunks)
        logger.info(f"Sent intermediate {len(chunks)} chunk(s) to {phone_number}")

    try:
        response_text = await run_agent(
            user_id=user_id,
            phone_number=phone_number,
            incoming_message=combined,
            profile=profile,
            send_fn=send_fn,
            drain_fn=lambda: drain_pending(phone_number),
        )
    except Exception as e:
        logger.error(f"Agent error for {phone_number}: {e}", exc_info=True)
        response_text = "Hey! I'm having trouble processing your message right now. Let me get back to you in a moment!"

    # Check if generation changed (newer messages arrived → our response is stale)
    gen_after = get_current_generation(phone_number)
    if gen_after != gen_before:
        logger.info(f"Discarding stale response for {phone_number} (gen {gen_before} -> {gen_after})")
        return

    # Send final response (if any — agent may have already sent everything via send_fn)
    if response_text:
        save_message(
            user_id=user_id, phone_number=phone_number,
            direction="outbound", content=response_text,
            metadata={"ai_generated": True, "engine": "sms_agent"},
        )
        chunks = _split_on_delimiter(response_text)
        await mac_client.send_message(phone_number=phone_number, messages=chunks)
        logger.info(f"Sent final {len(chunks)} chunk(s) to {phone_number}")


# ---------------------------------------------------------------------------
# Top-level entry point
# ---------------------------------------------------------------------------

async def handle_inbound_message(webhook_data: WebhookRequest) -> None:
    """
    Handle an inbound SMS webhook — top-level entry point.
    Sends responses directly via mac_client (no return value needed).

    Args:
        webhook_data: The parsed webhook payload
    """
    phone_number = webhook_data.phone_number
    messages = webhook_data.messages

    logger.info(f"Processing {len(messages)} message(s) from {phone_number}")

    try:
        # 1. Validate user
        validator = get_user_validator()
        validation = validator.validate_user(phone_number)

        if not validation.is_valid:
            mac_client = get_mac_client()

            # Check mid-onboarding FIRST (before subscription checks)
            # An onboarding user may have a partial profile, so this must come first
            onboarding_user = get_onboarding_user_by_phone(phone_number)
            if onboarding_user:
                from app.sms.onboarding_agent import handle_onboarding_intro
                incoming_text = " ".join(m.text for m in webhook_data.messages)
                onboarding_user["incoming_message"] = incoming_text
                await handle_onboarding_intro(phone_number, onboarding_user)
                return

            if validation.user is not None and validation.profile is not None:
                # User exists with profile — check subscription status
                status = (validation.user.subscription_status or "").lower()
                if status == "canceled":
                    # Canceled subscription → save inbound, then send resubscribe
                    save_message(
                        user_id=validation.user.id, phone_number=phone_number,
                        direction="inbound", content=" ".join(m.text for m in messages),
                        metadata={"subscription_canceled": True},
                    )
                    await mac_client.send_message(
                        phone_number=phone_number,
                        messages=[OutboundMessageChunk(
                            text="Hey! It looks like your subscription has ended. To keep chatting with Brandon, resubscribe at textbrandon.now/payment"
                        )],
                    )
                elif not status:
                    # No subscription at all — still mid-onboarding
                    from app.sms.onboarding_agent import handle_onboarding_intro
                    incoming_text = " ".join(m.text for m in webhook_data.messages)
                    user_dict = validation.user.model_dump() if hasattr(validation.user, 'model_dump') else validation.user.__dict__
                    # Seed draft_onboarding_data with profile name so the agent can greet them
                    if not user_dict.get("draft_onboarding_data"):
                        user_dict["draft_onboarding_data"] = {"name": validation.profile.name}
                    onboarding_user = {"user": user_dict, "incoming_message": incoming_text}
                    await handle_onboarding_intro(phone_number, onboarding_user)
                else:
                    # Has account but subscription not active → save inbound, then send setup prompt
                    save_message(
                        user_id=validation.user.id, phone_number=phone_number,
                        direction="inbound", content=" ".join(m.text for m in messages),
                        metadata={"subscription_inactive": True},
                    )
                    await mac_client.send_message(
                        phone_number=phone_number,
                        messages=[OutboundMessageChunk(
                            text="Hey! It looks like you still need to finish setting up your account. Log in at textbrandon.now/login to complete your profile and subscribe."
                        )],
                    )
                return

            # No profile, not onboarding — truly unknown phone
            if "not registered" in (validation.error_message or "").lower():
                await _handle_unknown_phone(phone_number)
                return

            # Other validation error — save inbound if we have a user
            if validation.user is not None:
                save_message(
                    user_id=validation.user.id, phone_number=phone_number,
                    direction="inbound", content=" ".join(m.text for m in messages),
                    metadata={"validation_error": True},
                )
            await mac_client.send_message(
                phone_number=phone_number,
                messages=[OutboundMessageChunk(text="Hey! I'm having trouble with your account. Please check your Brandon account settings.")],
            )
            return

        user_id = validation.user_id
        profile = validation.profile
        logger.info(f"User validated: {user_id} ({profile.name})")

        # 2. Check first message (before saving)
        first_message = is_first_message(user_id)

        # 3. Save inbound
        combined = " ".join(m.text for m in messages)
        save_message(
            user_id=user_id, phone_number=phone_number,
            direction="inbound", content=combined,
            metadata={"message_count": len(messages)},
        )

        # 4. First message → intro flow (bypasses agent)
        if first_message:
            await _handle_first_message(user_id, phone_number, profile)
            return

        # 5. Materialize schedule
        ensure_schedule_materialized(user_id, timezone=profile.timezone)

        # 6. Enqueue for agent processing
        async def _process(phone: str, msgs: List[InboundMessage]) -> None:
            await _run_agent_and_send(phone, msgs, user_id=user_id, profile=profile)

        await enqueue_and_process(phone_number, messages, _process)

    except Exception as e:
        logger.error(f"Error handling inbound from {phone_number}: {e}", exc_info=True)
        try:
            mac_client = get_mac_client()
            await mac_client.send_message(
                phone_number=phone_number,
                messages=[OutboundMessageChunk(text="Hey! I'm having trouble processing your message right now. Let me get back to you in a moment!")],
            )
        except Exception as send_err:
            logger.error(f"Failed to send error message to {phone_number}: {send_err}")
