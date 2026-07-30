"""
Tests for SMS handler helpers: message chunking, time/exercise formatting,
and today's-workout lookup.

Run with: pytest tests/test_message_chunking.py -v
"""

from datetime import datetime
from zoneinfo import ZoneInfo

from app.sms.handler import (
    _split_on_delimiter,
    _sentence_split,
    _format_exercises,
    _format_text_time,
    _get_todays_workout,
)


# ===================================================================
# _split_on_delimiter
# ===================================================================

class TestSplitOnDelimiter:
    def test_delimiter_splits_into_chunks(self):
        chunks = _split_on_delimiter("First bubble---Second bubble---Third")
        assert [c.text for c in chunks] == ["First bubble", "Second bubble", "Third"]

    def test_first_chunk_has_no_delay(self):
        chunks = _split_on_delimiter("A---B---C")
        assert chunks[0].delay_after_previous == 0.0
        assert all(c.delay_after_previous == 2.0 for c in chunks[1:])

    def test_short_text_single_chunk(self):
        chunks = _split_on_delimiter("Just one short message")
        assert len(chunks) == 1
        assert chunks[0].text == "Just one short message"

    def test_empty_text_returns_fallback(self):
        chunks = _split_on_delimiter("   ")
        assert len(chunks) == 1
        assert chunks[0].text  # non-empty fallback message

    def test_whitespace_only_segments_dropped(self):
        chunks = _split_on_delimiter("A---   ---B")
        assert [c.text for c in chunks] == ["A", "B"]

    def test_long_text_without_delimiter_falls_back_to_sentences(self):
        text = "This is a sentence. " * 40  # ~800 chars, no delimiters
        chunks = _split_on_delimiter(text)
        assert len(chunks) > 1
        assert all(len(c.text) <= 420 for c in chunks)


class TestSentenceSplit:
    def test_respects_max_length(self):
        text = "Sentence one is here. Sentence two is here. Sentence three is here."
        chunks = _sentence_split(text, max_length=30)
        assert all(len(c) <= 30 for c in chunks)

    def test_short_text_single_chunk(self):
        assert _sentence_split("Short.", max_length=400) == ["Short."]

    def test_content_preserved(self):
        text = "Alpha beta. Gamma delta! Epsilon zeta?"
        chunks = _sentence_split(text, max_length=15)
        joined = " ".join(chunks)
        for word in ["Alpha", "Gamma", "Epsilon"]:
            assert word in joined


# ===================================================================
# _format_text_time
# ===================================================================

class TestFormatTextTime:
    def test_morning(self):
        assert _format_text_time("08:00") == "8:00 AM"

    def test_afternoon(self):
        assert _format_text_time("14:30") == "2:30 PM"

    def test_midnight(self):
        assert _format_text_time("00:15") == "12:15 AM"

    def test_noon(self):
        assert _format_text_time("12:00") == "12:00 PM"

    def test_with_seconds(self):
        assert _format_text_time("09:05:00") == "9:05 AM"

    def test_invalid_returned_unchanged(self):
        assert _format_text_time("whenever") == "whenever"


# ===================================================================
# _format_exercises
# ===================================================================

class TestFormatExercises:
    def test_sets_and_reps(self):
        result = _format_exercises([{"name": "Bench Press", "sets": 3, "reps": 8}])
        assert result == "- Bench Press: 3 sets x 8"

    def test_duration(self):
        result = _format_exercises([{"name": "Plank", "duration": "60s"}])
        assert result == "- Plank: 60s"

    def test_name_only(self):
        result = _format_exercises([{"name": "Stretching"}])
        assert result == "- Stretching"

    def test_multiple_lines(self):
        result = _format_exercises([
            {"name": "Squat", "sets": 4, "reps": 5},
            {"name": "Plank", "duration": "45s"},
        ])
        assert result == "- Squat: 4 sets x 5\n- Plank: 45s"

    def test_empty_list(self):
        assert _format_exercises([]) == ""


# ===================================================================
# _get_todays_workout
# ===================================================================

class TestGetTodaysWorkout:
    TZ = "America/Chicago"

    def _today_name(self):
        return datetime.now(ZoneInfo(self.TZ)).strftime("%A")

    def test_returns_todays_workout(self):
        today = self._today_name()
        plan = {"plan_data": {"workouts": [
            {"day": today, "focus": "Push"},
        ]}}
        workout = _get_todays_workout(plan, self.TZ)
        assert workout is not None
        assert workout["focus"] == "Push"

    def test_rest_day_returns_none(self):
        today = self._today_name()
        other_days = [d for d in
                      ["Monday", "Tuesday", "Wednesday", "Thursday",
                       "Friday", "Saturday", "Sunday"] if d != today]
        plan = {"plan_data": {"workouts": [{"day": other_days[0], "focus": "Pull"}]}}
        assert _get_todays_workout(plan, self.TZ) is None

    def test_no_plan_returns_none(self):
        assert _get_todays_workout(None, self.TZ) is None

    def test_malformed_plan_returns_none(self):
        assert _get_todays_workout({"plan_data": "not-a-dict"}, self.TZ) is None

    def test_invalid_timezone_falls_back(self):
        today = datetime.now(ZoneInfo("America/Chicago")).strftime("%A")
        plan = {"plan_data": {"workouts": [{"day": today, "focus": "Legs"}]}}
        workout = _get_todays_workout(plan, "Not/AZone")
        assert workout is not None
        assert workout["focus"] == "Legs"
