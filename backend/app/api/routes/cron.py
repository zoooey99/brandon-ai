"""
Cron job endpoints for Brandon Backend.
These endpoints are designed to be called by external schedulers (e.g., Render cron jobs)
and use Bearer token authentication instead of session cookies.
"""

from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel
import logging
import hmac

from app.config import settings

logger = logging.getLogger(__name__)

router = APIRouter()


def verify_cron_token(authorization: str = Header(None)) -> bool:
    """Verify the Bearer token matches ADMIN_SECRET_KEY."""
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing Authorization header")

    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid Authorization format. Use 'Bearer <token>'")

    token = authorization[7:]  # Remove "Bearer " prefix

    if not hmac.compare_digest(token, settings.admin_secret_key):
        raise HTTPException(status_code=401, detail="Invalid token")

    return True


class CronResponse(BaseModel):
    """Response model for cron endpoints."""
    success: bool
    message: str
    scheduled: int = 0
    sent: int = 0
    failed: int = 0
    errors: int = 0


@router.post("/schedule-daily", response_model=CronResponse)
async def cron_schedule_daily(authorization: str = Header(None)):
    """
    Schedule daily messages for all active users.

    Called by Render cron job. Requires Bearer token authentication.

    Headers:
        Authorization: Bearer <ADMIN_SECRET_KEY>
    """
    verify_cron_token(authorization)

    try:
        from scripts.schedule_daily_messages import schedule_daily_messages
        scheduled, errors = schedule_daily_messages()

        logger.info(f"Cron schedule-daily: scheduled={scheduled}, errors={errors}")

        return CronResponse(
            success=True,
            message=f"Scheduled {scheduled} messages, {errors} errors",
            scheduled=scheduled,
            errors=errors
        )
    except Exception as e:
        logger.error(f"Cron schedule-daily failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/send-pending", response_model=CronResponse)
async def cron_send_pending(authorization: str = Header(None)):
    """
    Send all pending scheduled messages.

    Called by Render cron job. Requires Bearer token authentication.

    Headers:
        Authorization: Bearer <ADMIN_SECRET_KEY>
    """
    verify_cron_token(authorization)

    try:
        from scripts.send_scheduled_messages import send_scheduled_messages
        sent, failed = await send_scheduled_messages()

        logger.info(f"Cron send-pending: sent={sent}, failed={failed}")

        return CronResponse(
            success=True,
            message=f"Sent {sent} messages, {failed} failed",
            sent=sent,
            failed=failed
        )
    except Exception as e:
        logger.error(f"Cron send-pending failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
