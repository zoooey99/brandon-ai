"""
Tests for the daily-message scheduler: time parsing and scheduled-time
calculation across timezones.

Run with: pytest tests/test_scheduler.py -v
"""

from datetime import datetime
from zoneinfo import ZoneInfo
from unittest.mock import MagicMock, patch

from app.services.scheduler import (
    parse_time,
    calculate_scheduled_time,
    schedule_user_message,
    DEFAULT_TIMEZONE,
)

UTC = ZoneInfo("UTC")


# ===================================================================
# parse_time
# ===================================================================

class TestParseTime:
    def test_hour_and_minute(self):
        assert parse_time("14:30") == (14, 30)

    def test_with_seconds(self):
        assert parse_time("14:30:00") == (14, 30)

    def test_hour_only(self):
        assert parse_time("9") == (9, 0)

    def test_invalid_defaults_to_9am(self):
        assert parse_time("not a time") == (9, 0)

    def test_empty_defaults_to_9am(self):
        assert parse_time("") == (9, 0)


# ===================================================================
# calculate_scheduled_time
# ===================================================================

class TestCalculateScheduledTime:
    def test_returns_naive_datetime(self):
        result = calculate_scheduled_time("09:00", "America/New_York")
        assert result.tzinfo is None

    def test_scheduled_in_the_future(self):
        result = calculate_scheduled_time("09:00", "America/New_York")
        assert result > datetime.utcnow()

    def test_local_time_matches_preference(self):
        tz = "America/New_York"
        result = calculate_scheduled_time("07:45", tz)
        local = result.replace(tzinfo=UTC).astimezone(ZoneInfo(tz))
        assert (local.hour, local.minute) == (7, 45)

    def test_within_next_24_hours(self):
        result = calculate_scheduled_time("09:00", "America/Los_Angeles")
        delta = result - datetime.utcnow()
        assert 0 < delta.total_seconds() <= 24 * 3600

    def test_invalid_timezone_falls_back_to_default(self):
        result = calculate_scheduled_time("10:15", "Invalid/Zone")
        local = result.replace(tzinfo=UTC).astimezone(ZoneInfo(DEFAULT_TIMEZONE))
        assert (local.hour, local.minute) == (10, 15)


# ===================================================================
# schedule_user_message
# ===================================================================

def _mock_supabase_with_profile(profile):
    sb = MagicMock()
    sb.table.return_value.select.return_value.eq.return_value.execute.return_value.data = (
        [profile] if profile else []
    )
    return sb


class TestScheduleUserMessage:
    PHONE = "+15555550100"

    def test_schedules_for_valid_profile(self):
        profile = {
            "phone": self.PHONE,
            "preferred_text_time": "08:00",
            "timezone": "America/Chicago",
            "name": "Test User",
        }
        with patch("app.services.scheduler.get_supabase",
                   return_value=_mock_supabase_with_profile(profile)), \
             patch("app.services.scheduler.create_scheduled_message",
                   return_value=42) as mock_create:
            assert schedule_user_message("user_123") == 42
            kwargs = mock_create.call_args.kwargs
            assert kwargs["user_id"] == "user_123"
            assert kwargs["phone_number"] == self.PHONE

    def test_no_profile_returns_none(self):
        with patch("app.services.scheduler.get_supabase",
                   return_value=_mock_supabase_with_profile(None)):
            assert schedule_user_message("user_123") is None

    def test_missing_phone_returns_none(self):
        profile = {"phone": None, "preferred_text_time": "08:00", "name": "X"}
        with patch("app.services.scheduler.get_supabase",
                   return_value=_mock_supabase_with_profile(profile)), \
             patch("app.services.scheduler.create_scheduled_message") as mock_create:
            assert schedule_user_message("user_123") is None
            mock_create.assert_not_called()

    def test_missing_preferred_time_returns_none(self):
        profile = {"phone": self.PHONE, "preferred_text_time": None, "name": "X"}
        with patch("app.services.scheduler.get_supabase",
                   return_value=_mock_supabase_with_profile(profile)), \
             patch("app.services.scheduler.create_scheduled_message") as mock_create:
            assert schedule_user_message("user_123") is None
            mock_create.assert_not_called()
