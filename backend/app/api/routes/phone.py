"""
Phone verification endpoints for Brandon Backend.
Handles phone number verification during onboarding.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
import logging

from app.api.auth import get_current_user, AuthenticatedUser
from app.services.phone_verification import (
    verify_code,
    is_phone_verified,
    is_phone_available
)

logger = logging.getLogger(__name__)

router = APIRouter()


# ============================================================================
# Request/Response Models
# ============================================================================

class VerifyCodeRequest(BaseModel):
    """Request to verify a phone code."""
    phone: str  # E.164 format, e.g., "+15551234567"
    code: str   # 6-digit code


class VerifyCodeResponse(BaseModel):
    """Response from code verification."""
    success: bool
    error: Optional[str] = None


class PhoneStatusResponse(BaseModel):
    """Response for phone status check."""
    phone: Optional[str] = None
    verified: bool
    available: Optional[bool] = None  # Only included if checking availability


class CheckAvailabilityRequest(BaseModel):
    """Request to check phone availability."""
    phone: str  # E.164 format


class CheckAvailabilityResponse(BaseModel):
    """Response for availability check."""
    available: bool
    message: Optional[str] = None


# ============================================================================
# Endpoints
# ============================================================================

@router.post("/verify-code", response_model=VerifyCodeResponse)
async def verify_phone_code(
    request: VerifyCodeRequest,
    current_user: AuthenticatedUser = Depends(get_current_user)
):
    """
    Verify a phone verification code.

    The user must have received a code by texting the Brandon number.
    This endpoint verifies the code and marks the phone as verified.

    Requires: Authorization header with Supabase access token.

    Args:
        request: VerifyCodeRequest with phone and code

    Returns:
        VerifyCodeResponse with success status
    """
    logger.info(f"Verifying code for phone {request.phone}, user {current_user.user_id}")

    success, error = verify_code(request.phone, request.code)

    if success:
        logger.info(f"✅ Phone {request.phone} verified for user {current_user.user_id}")
        return VerifyCodeResponse(success=True)
    else:
        logger.warning(f"❌ Verification failed for {request.phone}: {error}")
        return VerifyCodeResponse(success=False, error=error)


@router.get("/status", response_model=PhoneStatusResponse)
async def get_phone_status(
    current_user: AuthenticatedUser = Depends(get_current_user)
):
    """
    Get the current user's phone verification status.

    Requires: Authorization header with Supabase access token.

    Returns:
        PhoneStatusResponse with phone and verification status
    """
    from app.db.supabase_client import get_supabase

    try:
        supabase = get_supabase()

        # Get user's profile
        result = supabase.table("profiles") \
            .select("phone, phone_verified") \
            .eq("user_id", current_user.user_id) \
            .limit(1) \
            .execute()

        if not result.data:
            return PhoneStatusResponse(phone=None, verified=False)

        profile = result.data[0]
        return PhoneStatusResponse(
            phone=profile.get("phone"),
            verified=profile.get("phone_verified", False)
        )

    except Exception as e:
        logger.error(f"Error getting phone status: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to get phone status")


@router.post("/check-available", response_model=CheckAvailabilityResponse)
async def check_phone_available(
    request: CheckAvailabilityRequest,
    current_user: AuthenticatedUser = Depends(get_current_user)
):
    """
    Check if a phone number is available (not registered to another user).

    Use this before allowing the user to save a phone number to their profile.

    Requires: Authorization header with Supabase access token.

    Args:
        request: CheckAvailabilityRequest with phone number

    Returns:
        CheckAvailabilityResponse with availability status
    """
    logger.info(f"Checking availability for {request.phone}, user {current_user.user_id}")

    # Exclude current user from check (in case they're updating their own number)
    available = is_phone_available(request.phone, exclude_user_id=current_user.user_id)

    if available:
        return CheckAvailabilityResponse(
            available=True,
            message="Phone number is available"
        )
    else:
        return CheckAvailabilityResponse(
            available=False,
            message="This phone number is already registered to another account"
        )
