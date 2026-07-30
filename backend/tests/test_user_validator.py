"""
Tests for user validation (subscription + phone checks before messaging).

Run with: pytest tests/test_user_validator.py -v
"""

from unittest.mock import patch

from app.services.user_validator import UserValidator, get_user_validator

PHONE = "+15555550100"


def _user_data(subscription_status="active", phone=PHONE):
    return {
        "user": {
            "id": "user_123",
            "email": "test@example.com",
            "subscription_status": subscription_status,
        },
        "profile": {
            "id": 1,
            "user_id": "user_123",
            "name": "Test User",
            "goal": "build muscle",
            "phone": phone,
        },
    }


class TestValidateUser:
    def _validate(self, user_data):
        with patch("app.services.user_validator.get_user_by_phone", return_value=user_data):
            return UserValidator().validate_user(PHONE)

    def test_active_subscription_valid(self):
        result = self._validate(_user_data("active"))
        assert result.is_valid is True
        assert result.user_id == "user_123"
        assert result.profile.name == "Test User"

    def test_trialing_subscription_valid(self):
        assert self._validate(_user_data("trialing")).is_valid is True

    def test_past_due_grace_period_valid(self):
        assert self._validate(_user_data("past_due")).is_valid is True

    def test_unknown_phone_invalid(self):
        result = self._validate(None)
        assert result.is_valid is False
        assert "not registered" in result.error_message

    def test_canceled_subscription_invalid(self):
        result = self._validate(_user_data("canceled"))
        assert result.is_valid is False
        assert result.user is not None  # caller can still identify the user
        assert "canceled" in result.error_message

    def test_missing_subscription_invalid(self):
        result = self._validate(_user_data(None))
        assert result.is_valid is False
        assert "No active subscription" in result.error_message

    def test_phone_mismatch_invalid(self):
        result = self._validate(_user_data("active", phone="+15555550199"))
        assert result.is_valid is False

    def test_db_error_invalid(self):
        with patch(
            "app.services.user_validator.get_user_by_phone",
            side_effect=Exception("db down"),
        ):
            result = UserValidator().validate_user(PHONE)
        assert result.is_valid is False
        assert "Validation error" in result.error_message


class TestShouldSendMessage:
    def test_valid_user(self):
        with patch("app.services.user_validator.get_user_by_phone", return_value=_user_data()):
            should_send, error = UserValidator().should_send_message(PHONE)
        assert should_send is True
        assert error is None

    def test_invalid_user(self):
        with patch("app.services.user_validator.get_user_by_phone", return_value=None):
            should_send, error = UserValidator().should_send_message(PHONE)
        assert should_send is False
        assert error


class TestSingleton:
    def test_get_user_validator_returns_same_instance(self):
        assert get_user_validator() is get_user_validator()
