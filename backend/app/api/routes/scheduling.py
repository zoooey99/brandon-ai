"""
Scheduling endpoints for Brandon Backend.
Handles scheduling of daily messages and welcome message sending.
"""

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional
import logging

from app.services.scheduler import schedule_user_message
from app.api.auth import get_current_user, AuthenticatedUser
from app.api.routes.plan import verify_api_key

logger = logging.getLogger(__name__)

router = APIRouter()


class ScheduleMessageResponse(BaseModel):
    """Response for schedule message endpoint."""
    success: bool
    message_id: Optional[int] = None
    error: Optional[str] = None


class WelcomeMessageRequest(BaseModel):
    """Request body for send-welcome-message endpoint."""
    user_id: str


class WelcomeMessageResponse(BaseModel):
    """Response for send-welcome-message endpoint."""
    success: bool
    error: Optional[str] = None


@router.post("/schedule-first-message", response_model=ScheduleMessageResponse)
async def schedule_first_message(
    current_user: AuthenticatedUser = Depends(get_current_user)
):
    """
    Schedule the first daily message for the authenticated user after onboarding.

    Requires: Authorization header with Supabase access token.

    Returns:
        ScheduleMessageResponse with success status and message_id
    """
    user_id = current_user.user_id

    logger.info(f"Scheduling first message for user: {user_id}")

    try:
        message_id = schedule_user_message(user_id)

        if message_id:
            logger.info(f"Successfully scheduled message {message_id} for user {user_id}")
            return ScheduleMessageResponse(
                success=True,
                message_id=message_id
            )
        else:
            logger.warning(f"Could not schedule message for user {user_id}")
            return ScheduleMessageResponse(
                success=False,
                error="Could not schedule message. Check user profile has phone and preferred_text_time set."
            )

    except Exception as e:
        logger.error(f"Error scheduling message: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Error scheduling message: {str(e)}"
        )


@router.post("/reschedule-message", response_model=ScheduleMessageResponse)
async def reschedule_message(
    current_user: AuthenticatedUser = Depends(get_current_user)
):
    """
    Reschedule the authenticated user's daily message.
    Call this after changing preferred_text_time.

    Requires: Authorization header with Supabase access token.

    Returns:
        ScheduleMessageResponse with success status
    """
    return await schedule_first_message(current_user)


@router.post("/send-welcome-message", response_model=WelcomeMessageResponse)
async def send_welcome_message_endpoint(
    request: WelcomeMessageRequest,
    _: bool = Depends(verify_api_key),
):
    """
    Send a welcome message with the user's first workout after subscription.

    Server-to-server endpoint called by the frontend after payment completes.
    Requires: Authorization header with FRONTEND_APIKEY.

    Args:
        request: WelcomeMessageRequest with user_id

    Returns:
        WelcomeMessageResponse with success status
    """
    logger.info(f"Send welcome message requested for user: {request.user_id}")

    try:
        from app.sms.handler import send_welcome_message
        success = await send_welcome_message(request.user_id)

        if success:
            return WelcomeMessageResponse(success=True)
        else:
            return WelcomeMessageResponse(
                success=False,
                error="Could not send welcome message. Check user profile exists."
            )

    except Exception as e:
        logger.error(f"Error sending welcome message: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Error sending welcome message: {str(e)}"
        )
