"""
Tests for phone number normalization and verification-code logic.

Run with: pytest tests/test_phone_verification.py -v
"""

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from unittest.mock import MagicMock, patch

import pytest

from app.db.queries import normalize_phone_for_search
from app.services.phone_verification import (
    generate_code,
    verify_code,
    get_or_create_verification_code,
    normalize_phone,
    MAX_ATTEMPTS,
)

PHONE = "+15555550100"
UTC = ZoneInfo("UTC")


# ===================================================================
# Normalization helpers
# ===================================================================

class TestNormalizePhoneForSearch:
    def test_e164_adds_raw_variant(self):
        variants = normalize_phone_for_search("+15555550100")
        assert "+15555550100" in variants
        assert "5555550100" in variants

    def test_leading_one_adds_raw_variant(self):
        variants = normalize_phone_for_search("15555550100")
        assert "5555550100" in variants

    def test_raw_ten_digit_adds_e164_variant(self):
        variants = normalize_phone_for_search("5555550100")
        assert "+15555550100" in variants

    def test_original_always_included(self):
        for phone in ["+15555550100", "5555550100", "555-0100"]:
            assert phone in normalize_phone_for_search(phone)


class TestNormalizePhone:
    def test_strips_plus_one(self):
        assert normalize_phone("+15555550100") == "5555550100"

    def test_strips_leading_one(self):
        assert normalize_phone("15555550100") == "5555550100"

    def test_raw_unchanged(self):
        assert normalize_phone("5555550100") == "5555550100"


# ===================================================================
# generate_code
# ===================================================================

class TestGenerateCode:
    def test_six_digits(self):
        for _ in range(20):
            code = generate_code()
            assert len(code) == 6
            assert code.isdigit()


# ===================================================================
# verify_code
# ===================================================================

def _mock_supabase_with_record(record):
    sb = MagicMock()
    sb.table.return_value.select.return_value.eq.return_value.limit.return_value \
        .execute.return_value.data = [record] if record else []
    return sb


def _record(code="123456", minutes_until_expiry=5, verified_at=None, attempts=0):
    expires_at = datetime.now(UTC) + timedelta(minutes=minutes_until_expiry)
    return {
        "code": code,
        "expires_at": expires_at.isoformat(),
        "verified_at": verified_at,
        "attempts": attempts,
    }


class TestVerifyCode:
    def _verify(self, record, code):
        sb = _mock_supabase_with_record(record)
        with patch("app.services.phone_verification.get_supabase", return_value=sb):
            return verify_code(PHONE, code), sb

    def test_correct_code_succeeds(self):
        (success, error), sb = self._verify(_record(code="123456"), "123456")
        assert success is True
        assert error is None

    def test_wrong_code_fails_with_remaining_attempts(self):
        (success, error), _ = self._verify(_record(code="123456", attempts=0), "000000")
        assert success is False
        assert "Invalid code" in error
        assert str(MAX_ATTEMPTS - 1) in error

    def test_no_record_fails(self):
        (success, error), _ = self._verify(None, "123456")
        assert success is False
        assert "No verification code" in error

    def test_already_verified_returns_true(self):
        record = _record(verified_at="2026-01-01T00:00:00+00:00")
        (success, error), _ = self._verify(record, "anything")
        assert success is True
        assert error is None

    def test_expired_code_fails(self):
        (success, error), _ = self._verify(_record(minutes_until_expiry=-1), "123456")
        assert success is False
        assert "expired" in error.lower()

    def test_max_attempts_exceeded_fails(self):
        record = _record(attempts=MAX_ATTEMPTS)
        (success, error), _ = self._verify(record, "123456")
        assert success is False
        assert "Too many attempts" in error

    def test_wrong_code_increments_attempts(self):
        record = _record(code="123456", attempts=1)
        _, sb = self._verify(record, "000000")
        update_calls = sb.table.return_value.update.call_args_list
        assert any(call.args[0] == {"attempts": 2} for call in update_calls)


# ===================================================================
# get_or_create_verification_code
# ===================================================================

class TestGetOrCreateVerificationCode:
    def test_returns_existing_valid_code(self):
        record = _record(code="654321", minutes_until_expiry=5)
        sb = _mock_supabase_with_record(record)
        with patch("app.services.phone_verification.get_supabase", return_value=sb):
            code, is_new = get_or_create_verification_code(PHONE)
        assert code == "654321"
        assert is_new is False

    def test_creates_new_code_when_expired(self):
        record = _record(code="654321", minutes_until_expiry=-1)
        sb = _mock_supabase_with_record(record)
        with patch("app.services.phone_verification.get_supabase", return_value=sb):
            code, is_new = get_or_create_verification_code(PHONE)
        assert is_new is True
        assert code != "654321"
        sb.table.return_value.upsert.assert_called_once()

    def test_creates_new_code_when_none_exists(self):
        sb = _mock_supabase_with_record(None)
        with patch("app.services.phone_verification.get_supabase", return_value=sb):
            code, is_new = get_or_create_verification_code(PHONE)
        assert is_new is True
        assert len(code) == 6
