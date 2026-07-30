"""
User Validator Service for Brandon Backend.
Validates user subscriptions and phone numbers before processing messages.
"""

from typing import Optional
import logging

from app.db.models import ValidationResult, User, UserProfile
from app.db.queries import get_user_by_phone

logger = logging.getLogger(__name__)


class UserValidator:
    """
    Validates users can receive coaching messages.
    Checks subscription status and phone number registration.
    """

    # Valid subscription statuses that allow messaging
    VALID_SUBSCRIPTION_STATUSES = {
        "active",
        "trialing",
        "past_due"  # Allow grace period for past_due
    }

    def validate_user(self, phone_number: str) -> ValidationResult:
        """
        Validate that a user can receive messages.

        Checks:
        1. Phone number is registered in profiles
        2. User account exists
        3. Subscription is active

        Args:
            phone_number: Phone number in E.164 format

        Returns:
            ValidationResult with validation outcome
        """
        try:
            logger.info(f"🔍 Validating user for phone: {phone_number}")

            # Get user by phone number
            user_data = get_user_by_phone(phone_number)

            if not user_data:
                logger.warning(f"❌ No user found for phone: {phone_number}")
                return ValidationResult(
                    is_valid=False,
                    error_message=f"Phone number {phone_number} is not registered"
                )

            user_dict = user_data["user"]
            profile_dict = user_data["profile"]

            # Parse into models
            user = User(**user_dict)
            profile = UserProfile(**profile_dict)

            # Check subscription status
            subscription_status = user.subscription_status

            if not subscription_status:
                logger.warning(f"❌ User {user.id} has no subscription status")
                return ValidationResult(
                    is_valid=False,
                    user_id=user.id,
                    user=user,
                    profile=profile,
                    error_message="No active subscription found"
                )

            if subscription_status not in self.VALID_SUBSCRIPTION_STATUSES:
                logger.warning(f"❌ User {user.id} has invalid subscription status: {subscription_status}")
                return ValidationResult(
                    is_valid=False,
                    user_id=user.id,
                    user=user,
                    profile=profile,
                    error_message=f"Subscription is {subscription_status}. Please renew to continue."
                )

            # Check if phone number matches
            if profile.phone != phone_number:
                logger.warning(f"⚠️ Phone number mismatch for user {user.id}")
                # This shouldn't happen since we queried by phone, but log it
                return ValidationResult(
                    is_valid=False,
                    user_id=user.id,
                    user=user,
                    profile=profile,
                    error_message="Phone number verification failed"
                )

            # All checks passed
            logger.info(f"✅ User {user.id} validated successfully (status: {subscription_status})")
            return ValidationResult(
                is_valid=True,
                user_id=user.id,
                user=user,
                profile=profile
            )

        except Exception as e:
            logger.error(f"❌ Error validating user: {e}", exc_info=True)
            return ValidationResult(
                is_valid=False,
                error_message=f"Validation error: {str(e)}"
            )

    def should_send_message(self, phone_number: str) -> tuple[bool, Optional[str]]:
        """
        Quick check if we should send a message to this phone number.

        Args:
            phone_number: Phone number to check

        Returns:
            Tuple of (should_send, error_message)
        """
        result = self.validate_user(phone_number)

        if result.is_valid:
            return True, None

        return False, result.error_message

    def get_validated_user(self, phone_number: str) -> Optional[dict]:
        """
        Get validated user data if valid.

        Args:
            phone_number: Phone number to validate

        Returns:
            Dict with 'user_id', 'user', 'profile' if valid, None otherwise
        """
        result = self.validate_user(phone_number)

        if result.is_valid:
            return {
                "user_id": result.user_id,
                "user": result.user,
                "profile": result.profile
            }

        return None


# Singleton instance
_user_validator = None


def get_user_validator() -> UserValidator:
    """
    Get or create user validator instance.

    Returns:
        UserValidator instance
    """
    global _user_validator
    if _user_validator is None:
        _user_validator = UserValidator()
    return _user_validator
