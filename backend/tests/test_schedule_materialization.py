"""
Tests for schedule materialization (pre-generating workout_sessions rows).

Run with: pytest tests/test_schedule_materialization.py -v
"""

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from unittest.mock import MagicMock, patch

from app.sms.schedule import ensure_schedule_materialized

USER_ID = "user_123"
TZ = "America/Chicago"


def _plan(workouts, plan_id=42):
    return {"id": plan_id, "plan_data": {"workouts": workouts}}


def _mock_supabase(existing_dates=None, inserted_rows=None):
    """Mock the two query shapes used by ensure_schedule_materialized."""
    sb = MagicMock()
    # Existing-sessions lookup: select().eq().gte().lt().execute()
    sb.table.return_value.select.return_value.eq.return_value.gte.return_value \
        .lt.return_value.execute.return_value.data = [
            {"scheduled_for": f"{d}T00:00:00"} for d in (existing_dates or [])
        ]
    # Insert result: rows come back with ids so tokens can be generated
    sb.table.return_value.insert.return_value.execute.return_value.data = inserted_rows or []
    return sb


def _next_dates_for_day(day_name, count=2):
    """Dates in the next 14 days (user tz) falling on day_name."""
    today = datetime.now(ZoneInfo(TZ)).date()
    return [
        (today + timedelta(days=offset)).isoformat()
        for offset in range(14)
        if (today + timedelta(days=offset)).strftime("%A") == day_name
    ][:count]


class TestEnsureScheduleMaterialized:
    def test_no_plan_does_nothing(self):
        sb = _mock_supabase()
        with patch("app.sms.schedule.get_user_workout_plan", return_value=None), \
             patch("app.sms.schedule.get_supabase", return_value=sb):
            ensure_schedule_materialized(USER_ID, timezone=TZ)
        sb.table.assert_not_called()

    def test_plan_without_workouts_does_nothing(self):
        sb = _mock_supabase()
        with patch("app.sms.schedule.get_user_workout_plan", return_value=_plan([])), \
             patch("app.sms.schedule.get_supabase", return_value=sb):
            ensure_schedule_materialized(USER_ID, timezone=TZ)
        sb.table.assert_not_called()

    def test_materializes_two_weeks_of_sessions(self):
        workouts = [
            {"day": "Monday", "focus": "Push", "exercises": [{"name": "Bench"}]},
            {"day": "Thursday", "focus": "Pull", "exercises": [{"name": "Rows"}]},
        ]
        sb = _mock_supabase()
        with patch("app.sms.schedule.get_user_workout_plan", return_value=_plan(workouts)), \
             patch("app.sms.schedule.get_supabase", return_value=sb):
            ensure_schedule_materialized(USER_ID, timezone=TZ)

        insert_calls = sb.table.return_value.insert.call_args_list
        assert insert_calls, "expected sessions to be inserted"
        rows = insert_calls[0].args[0]
        # Each workout day occurs exactly twice in a 14-day window
        assert len(rows) == 4
        assert {r["day_name"] for r in rows} == {"Monday", "Thursday"}
        assert all(r["user_id"] == USER_ID for r in rows)
        assert all(r["plan_id"] == 42 for r in rows)
        assert all(r["source"] == "plan" for r in rows)
        assert all(r["status"] == "pending" for r in rows)

    def test_skips_already_materialized_dates(self):
        workouts = [{"day": "Monday", "focus": "Push"}]
        existing = _next_dates_for_day("Monday", count=1)  # first Monday exists
        sb = _mock_supabase(existing_dates=existing)
        with patch("app.sms.schedule.get_user_workout_plan", return_value=_plan(workouts)), \
             patch("app.sms.schedule.get_supabase", return_value=sb):
            ensure_schedule_materialized(USER_ID, timezone=TZ)

        rows = sb.table.return_value.insert.call_args_list[0].args[0]
        assert len(rows) == 1  # only the second Monday
        assert rows[0]["scheduled_for"][:10] not in existing

    def test_all_dates_existing_inserts_nothing(self):
        workouts = [{"day": "Monday", "focus": "Push"}]
        existing = _next_dates_for_day("Monday", count=2)
        sb = _mock_supabase(existing_dates=existing)
        with patch("app.sms.schedule.get_user_workout_plan", return_value=_plan(workouts)), \
             patch("app.sms.schedule.get_supabase", return_value=sb):
            ensure_schedule_materialized(USER_ID, timezone=TZ)

        sb.table.return_value.insert.assert_not_called()

    def test_generates_tracking_tokens_for_new_sessions(self):
        workouts = [{"day": "Monday", "focus": "Push"}]
        monday = _next_dates_for_day("Monday", count=1)[0]
        inserted = [{"id": 101, "scheduled_for": f"{monday}T00:00:00"}]
        sb = _mock_supabase(inserted_rows=inserted)
        with patch("app.sms.schedule.get_user_workout_plan", return_value=_plan(workouts)), \
             patch("app.sms.schedule.get_supabase", return_value=sb):
            ensure_schedule_materialized(USER_ID, timezone=TZ)

        insert_calls = sb.table.return_value.insert.call_args_list
        assert len(insert_calls) == 2  # sessions insert + tokens insert
        tokens = insert_calls[1].args[0]
        assert len(tokens) == 1
        assert tokens[0]["session_id"] == 101
        assert len(tokens[0]["token"]) == 21
        # Token expires 7 days after the session date
        expected_expiry = (datetime.fromisoformat(monday) + timedelta(days=7)).isoformat()
        assert tokens[0]["expires_at"] == expected_expiry

    def test_unknown_day_names_ignored(self):
        workouts = [{"day": "Someday", "focus": "Push"}]
        sb = _mock_supabase()
        with patch("app.sms.schedule.get_user_workout_plan", return_value=_plan(workouts)), \
             patch("app.sms.schedule.get_supabase", return_value=sb):
            ensure_schedule_materialized(USER_ID, timezone=TZ)
        sb.table.assert_not_called()
