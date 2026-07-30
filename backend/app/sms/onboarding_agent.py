"""
Onboarding agent for Brandon Backend.
Handles intro sequence and follow-up chat for mid-onboarding users.
"""

import logging
import os
import litellm
import httpx

from app.config import settings
from app.db.models import OutboundMessageChunk
from app.db.queries import save_message, update_draft_onboarding_data
from app.prompts.loader import get_prompt_with_model
from app.services.mac_client import get_mac_client

logger = logging.getLogger(__name__)

if settings.helicone_api_key:
    os.environ["HELICONE_API_KEY"] = settings.helicone_api_key

# Fallback prompt if DB prompt doesn't exist yet
_FALLBACK_ONBOARDING_CHAT_PROMPT = """You are Brandon, an AI fitness coach. The user is mid-signup — they've received your intro but haven't finished onboarding on the website yet.

Keep responses short (1-2 sentences max). Be friendly and casual (lowercase, no emojis). Answer their question briefly, then direct them back to finish signing up. Use --- between separate messages to sound more natural (like texting).

Their signup link is: {onboarding_url}

Examples:
- "what do you do?" → "i help you build a workout plan and text you every day with what to do---finish signing up here and we'll get started: {onboarding_url}"
- "how much does it cost?" → "it's $X/mo. sign up here to get started: {onboarding_url}"
- random message → "hey! finish setting up your account so we can get started: {onboarding_url}"
"""

ONBOARDING_URL = "https://textbrandon.now/onboarding"


async def handle_onboarding_intro(phone_number: str, onboarding_user: dict) -> None:
    """
    Send a 3-bubble intro sequence to a mid-onboarding user.

    Args:
        phone_number: User's phone number in E.164 format
        onboarding_user: Dict with 'user' key from get_onboarding_user_by_phone()
    """
    user = onboarding_user["user"]
    user_id = user["id"]
    draft_data = user.get("draft_onboarding_data") or {}
    name = draft_data.get("name") or draft_data.get("first_name") or "there"

    # Save inbound message before any routing (intro or chat)
    incoming_message = onboarding_user.get("incoming_message", "")
    if incoming_message:
        save_message(
            user_id=user_id,
            phone_number=phone_number,
            direction="inbound",
            content=incoming_message,
            metadata={"onboarding_intro": True},
        )

    # Duplicate guard — if intro already sent, handle as follow-up chat
    if draft_data.get("intro_sent"):
        logger.info(f"Intro already sent for user {user_id}, routing to onboarding chat")
        incoming_message = onboarding_user.get("incoming_message", "")
        await handle_onboarding_chat(phone_number, user_id, name, incoming_message)
        return

    # Set intro_sent flag immediately (before sending) to prevent duplicates
    update_draft_onboarding_data(user_id, {"intro_sent": True})

    # Build 3-bubble intro
    chunks = [
        OutboundMessageChunk(
            text=f"hey {name}! happy you're here.",
            delay_after_previous=0.7,
        ),
        OutboundMessageChunk(
            text="i'm brandon, your new ai fitness coach.",
            delay_after_previous=3.5,
        ),
        OutboundMessageChunk(
            text=f"click here to continue sign up\n{ONBOARDING_URL}",
            delay_after_previous=3.5,
        ),
    ]

    # Send intro chunks
    mac_client = get_mac_client()
    await mac_client.send_message(
        phone_number=phone_number,
        messages=chunks,
    )

    # Save outbound message
    full_text = "\n---\n".join(chunk.text for chunk in chunks)
    save_message(
        user_id=user_id,
        phone_number=phone_number,
        direction="outbound",
        content=full_text,
        metadata={"onboarding_intro": True},
    )

    # Notify frontend to auto-advance the browser
    await notify_frontend_intro_complete(user_id)

    logger.info(f"Onboarding intro sent to user {user_id} ({phone_number})")


async def handle_onboarding_chat(
    phone_number: str, user_id: str, name: str, incoming_message: str
) -> None:
    """
    Handle follow-up messages from a user who already received the intro.
    Uses a simple LLM call to answer questions and redirect to signup.
    """
    # Inbound already saved by handle_onboarding_intro() before routing here

    # Load prompt + model from DB, fall back to hardcoded if not seeded yet
    try:
        prompt_template, model = get_prompt_with_model("onboarding_chat")
    except ValueError:
        logger.warning("onboarding_chat prompt not found in DB, using fallback")
        prompt_template = _FALLBACK_ONBOARDING_CHAT_PROMPT
        model = settings.openai_model

    system_prompt = prompt_template.format(onboarding_url=ONBOARDING_URL)

    try:
        response = await litellm.acompletion(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": incoming_message or "hey"},
            ],
            max_tokens=150,
            temperature=0.7,
        )
        reply = response.choices[0].message.content.strip()
    except Exception as e:
        logger.error(f"Onboarding chat LLM error: {e}")
        reply = f"hey {name}! finish setting up your account so we can get started: {ONBOARDING_URL}"

    # Split on --- delimiters for multi-bubble replies
    from app.sms.handler import _split_on_delimiter
    chunks = _split_on_delimiter(reply)

    mac_client = get_mac_client()
    await mac_client.send_message(
        phone_number=phone_number,
        messages=chunks,
    )

    save_message(
        user_id=user_id,
        phone_number=phone_number,
        direction="outbound",
        content=reply,
        metadata={"onboarding_chat": True},
    )

    logger.info(f"Onboarding chat reply sent to user {user_id}")


async def notify_frontend_intro_complete(user_id: str) -> bool:
    """
    Notify the frontend that the intro sequence is complete,
    so the browser can auto-advance past the 'text Brandon' step.

    Args:
        user_id: User ID

    Returns:
        True if notification was successful
    """
    url = f"{settings.frontend_url}/api/brandon-intro-complete"
    headers = {
        "Authorization": f"Bearer {settings.frontend_apikey}",
        "Content-Type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(url, json={"userId": user_id}, headers=headers)
            if response.status_code == 200:
                logger.info(f"Frontend notified of intro complete for user {user_id}")
                return True
            else:
                logger.warning(
                    f"Frontend notification failed: {response.status_code} {response.text}"
                )
                return False
    except Exception as e:
        logger.error(f"Error notifying frontend of intro complete: {e}")
        return False
