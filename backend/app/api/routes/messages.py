"""
Message webhook endpoints for Brandon Backend.
Handles incoming messages from Mac iMessage relay server.

Flow:
1. Mac server forwards each message immediately (fire-and-forget)
2. Backend returns 200 OK right away
3. Backend processes message in background
4. When done, backend POSTs response to Mac server's /api/send
"""

from fastapi import APIRouter, BackgroundTasks, Header, HTTPException
import logging
import hmac

from app.config import settings
from app.db.models import WebhookRequest
from app.sms import handle_inbound_message
from app.services.mac_client import get_mac_client, MacServerError

logger = logging.getLogger(__name__)

router = APIRouter()


def verify_mac_server_auth(authorization: str = Header(None)) -> None:
    """Verify request is from the Mac server using API key."""
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing Authorization header")

    expected_auth = f"Bearer {settings.remote_server_apikey}"
    if not hmac.compare_digest(authorization, expected_auth):
        raise HTTPException(status_code=401, detail="Invalid API key")


async def _process_and_send(webhook_data: WebhookRequest):
    """
    Background task: process message via SMS engine.
    The SMS handler sends responses directly via mac_client.
    """
    try:
        await handle_inbound_message(webhook_data)
    except Exception as e:
        logger.error(f"Error processing webhook for {webhook_data.phone_number}: {e}", exc_info=True)


@router.post("/webhook")
async def receive_messages(
    webhook_data: WebhookRequest,
    background_tasks: BackgroundTasks,
    authorization: str = Header(None)
):
    """
    Receive incoming message from Mac server.

    Returns 200 immediately, processes in background,
    then sends response to Mac server via /api/send.
    """
    verify_mac_server_auth(authorization)

    phone_number = webhook_data.phone_number
    message_count = len(webhook_data.messages)

    logger.info(f"Received webhook from {phone_number} ({message_count} message(s))")

    # Process in background - return immediately
    background_tasks.add_task(_process_and_send, webhook_data)

    return {"ok": True}


@router.get("/webhook/test")
async def test_webhook(authorization: str = Header(None)):
    """
    Test endpoint to verify webhook authentication.

    Args:
        authorization: Authorization header

    Returns:
        Test success message
    """
    verify_mac_server_auth(authorization)

    return {
        "status": "ok",
        "message": "Webhook authentication successful"
    }
