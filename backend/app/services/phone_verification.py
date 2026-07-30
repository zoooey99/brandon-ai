"""
Phone Verification Service for Brandon Backend.
Handles generating, storing, and verifying phone verification codes.
"""

import random
import logging
from datetime import datetime, timedelta
from typing import Optional, Tuple
from zoneinfo import ZoneInfo

from app.db.supabase_client import get_supabase

logger = logging.getLogger(__name__)

# Code expiration time in minutes
CODE_EXPIRATION_MINUTES = 10

# Max verification attempts before requiring new code
MAX_ATTEMPTS = 5


def generate_code() -> str:
    """Generate a 6-digit verification code."""
    return str(random.randint(100000, 999999))


def get_or_create_verification_code(phone_number: str) -> Tuple[str, bool]:
    """
    Get existing verification code or create a new one.

    If a valid (non-expired, non-verified) code exists, returns it.
    Otherwise creates a new code.

    Args:
        phone_number: Phone number in E.164 format

    Returns:
        Tuple of (code, is_new) - the code and whether it was newly created
    """
    try:
        supabase = get_supabase()
        now = datetime.now(ZoneInfo("UTC"))

        # Check for existing valid code
        existing = supabase.table("phone_verifications") \
            .select("code, expires_at, verified_at") \
            .eq("phone_number", phone_number) \
            .limit(1) \
            .execute()

        if existing.data:
            record = existing.data[0]
            expires_at_str = record["expires_at"]
            # Handle various timestamp formats from database
            if "Z" in expires_at_str:
                expires_at = datetime.fromisoformat(expires_at_str.replace("Z", "+00:00"))
            elif "+" in expires_at_str or expires_at_str.endswith("-00:00"):
                expires_at = datetime.fromisoformat(expires_at_str)
            else:
                # Naive datetime from DB - assume UTC
                expires_at = datetime.fromisoformat(expires_at_str).replace(tzinfo=ZoneInfo("UTC"))

            # If not expired and not yet verified, return existing code
            if expires_at > now and record["verified_at"] is None:
                logger.info(f"Returning existing verification code for {phone_number}")
                return record["code"], False

        # Generate new code
        code = generate_code()
        expires_at = now + timedelta(minutes=CODE_EXPIRATION_MINUTES)

        # Upsert - replace any existing record for this phone
        supabase.table("phone_verifications").upsert({
            "phone_number": phone_number,
            "code": code,
            "expires_at": expires_at.isoformat(),
            "verified_at": None,
            "attempts": 0,
            "created_at": now.isoformat()
        }, on_conflict="phone_number").execute()

        logger.info(f"Created new verification code for {phone_number}, expires at {expires_at}")
        return code, True

    except Exception as e:
        logger.error(f"Error getting/creating verification code: {e}", exc_info=True)
        # Generate a code anyway so user gets something
        return generate_code(), True


def verify_code(phone_number: str, code: str) -> Tuple[bool, Optional[str]]:
    """
    Verify a phone verification code.

    Args:
        phone_number: Phone number in E.164 format
        code: The 6-digit code to verify

    Returns:
        Tuple of (success, error_message)
    """
    try:
        supabase = get_supabase()
        now = datetime.now(ZoneInfo("UTC"))

        # Get verification record
        result = supabase.table("phone_verifications") \
            .select("*") \
            .eq("phone_number", phone_number) \
            .limit(1) \
            .execute()

        if not result.data:
            logger.warning(f"No verification record found for {phone_number}")
            return False, "No verification code found. Please text us first to get a code."

        record = result.data[0]

        # Check if already verified
        if record["verified_at"] is not None:
            logger.info(f"Phone {phone_number} already verified")
            return True, None

        # Check expiration
        expires_at_str = record["expires_at"]
        if "Z" in expires_at_str:
            expires_at = datetime.fromisoformat(expires_at_str.replace("Z", "+00:00"))
        elif "+" in expires_at_str or expires_at_str.endswith("-00:00"):
            expires_at = datetime.fromisoformat(expires_at_str)
        else:
            expires_at = datetime.fromisoformat(expires_at_str).replace(tzinfo=ZoneInfo("UTC"))

        if expires_at < now:
            logger.warning(f"Verification code expired for {phone_number}")
            return False, "Code expired. Please text us again to get a new code."

        # Check attempts
        attempts = record.get("attempts", 0)
        if attempts >= MAX_ATTEMPTS:
            logger.warning(f"Max attempts exceeded for {phone_number}")
            return False, "Too many attempts. Please text us again to get a new code."

        # Increment attempts
        supabase.table("phone_verifications") \
            .update({"attempts": attempts + 1}) \
            .eq("phone_number", phone_number) \
            .execute()

        # Check code
        if record["code"] != code:
            logger.warning(f"Invalid code attempt for {phone_number}")
            remaining = MAX_ATTEMPTS - attempts - 1
            return False, f"Invalid code. {remaining} attempts remaining."

        # Success! Mark as verified
        supabase.table("phone_verifications") \
            .update({"verified_at": now.isoformat()}) \
            .eq("phone_number", phone_number) \
            .execute()

        # Also update the profile's phone_verified flag
        supabase.table("profiles") \
            .update({"phone_verified": True}) \
            .eq("phone", phone_number) \
            .execute()

        logger.info(f"✅ Phone {phone_number} verified successfully")
        return True, None

    except Exception as e:
        logger.error(f"Error verifying code: {e}", exc_info=True)
        return False, "Verification failed. Please try again."


def normalize_phone(phone_number: str) -> str:
    """Normalize phone to 10-digit format for comparison."""
    if phone_number.startswith("+1"):
        return phone_number[2:]
    elif phone_number.startswith("1") and len(phone_number) == 11:
        return phone_number[1:]
    return phone_number


def is_phone_verified(phone_number: str) -> bool:
    """
    Check if a phone number has been verified.

    Checks both profiles.phone_verified (for completed profiles) and
    phone_verifications.verified_at (for onboarding users).

    Args:
        phone_number: Phone number in E.164 format

    Returns:
        True if verified, False otherwise
    """
    try:
        supabase = get_supabase()

        # Check profiles table for phone_verified flag
        result = supabase.table("profiles") \
            .select("phone_verified") \
            .eq("phone", phone_number) \
            .limit(1) \
            .execute()

        if result.data and result.data[0].get("phone_verified", False):
            return True

        # Also check phone_verifications table (for onboarding users without profile yet)
        verification_result = supabase.table("phone_verifications") \
            .select("verified_at") \
            .eq("phone_number", phone_number) \
            .limit(1) \
            .execute()

        if verification_result.data and verification_result.data[0].get("verified_at"):
            return True

        return False

    except Exception as e:
        logger.error(f"Error checking phone verification status: {e}", exc_info=True)
        return False


def is_phone_available(phone_number: str, exclude_user_id: Optional[str] = None) -> bool:
    """
    Check if a phone number is available (not registered to another user).

    Checks both profiles.phone and users.draft_onboarding_data.phone.

    Args:
        phone_number: Phone number in E.164 format
        exclude_user_id: Optionally exclude this user from the check (for updating own phone)

    Returns:
        True if available, False if already registered
    """
    try:
        supabase = get_supabase()

        # Check profiles table
        query = supabase.table("profiles") \
            .select("user_id") \
            .eq("phone", phone_number)

        if exclude_user_id:
            query = query.neq("user_id", exclude_user_id)

        result = query.limit(1).execute()

        if result.data:
            return False  # Found in profiles

        # Also check draft_onboarding_data in users table
        # Need to check both E.164 and raw formats
        phone_normalized = normalize_phone(phone_number)

        users_result = supabase.table("users").select("id, draft_onboarding_data").execute()

        for user in users_result.data:
            # Skip the excluded user
            if exclude_user_id and user["id"] == exclude_user_id:
                continue

            draft_data = user.get("draft_onboarding_data")
            if draft_data:
                draft_phone = draft_data.get("phone", "")
                draft_phone_normalized = normalize_phone(draft_phone)

                if draft_phone_normalized == phone_normalized and draft_phone_normalized:
                    return False  # Found in draft data

        return True  # Available

    except Exception as e:
        logger.error(f"Error checking phone availability: {e}", exc_info=True)
        return False  # Err on the side of caution
