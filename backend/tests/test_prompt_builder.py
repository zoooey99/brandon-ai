"""
Tests for SMS prompt builder (build_system_prompt).

Run with: pytest tests/test_prompt_builder.py -v
"""

import pytest
from unittest.mock import Mock, patch

from app.sms.prompt import build_system_prompt


@pytest.fixture
def mock_profile():
    """Mock user profile with all fields."""
    p = Mock()
    p.name = "Brandon"
    p.goal = "build muscle"
    p.experience = "intermediate"
    p.equipment = "dumbbells, barbell, bench"
    p.split = "push/pull/legs"
    p.timezone = "America/New_York"
    p.preferred_text_time = "08:00"
    return p


class TestBuildSystemPrompt:
    def test_all_fields_substituted(self, mock_profile):
        template = (
            "Coach for {user_name}. Goal: {goal}. "
            "Experience: {experience}. Equipment: {equipment}. "
            "Split: {split}. TZ: {timezone}. Time: {current_datetime}."
        )
        result = build_system_prompt(template, "user_123", mock_profile)
        assert "Brandon" in result
        assert "build muscle" in result
        assert "intermediate" in result
        assert "dumbbells, barbell, bench" in result
        assert "push/pull/legs" in result
        assert "America/New_York" in result
        # current_datetime should have been filled (no placeholder left)
        assert "{current_datetime}" not in result

    def test_missing_profile_fields_use_defaults(self):
        profile = Mock()
        profile.name = "Zoe"
        profile.goal = "get fit"
        profile.experience = None
        profile.equipment = None
        profile.split = None
        profile.timezone = None
        template = "Exp: {experience}. Equip: {equipment}. Split: {split}."
        result = build_system_prompt(template, "u1", profile)
        assert "beginner" in result
        assert "no equipment" in result
        assert "full body" in result

    def test_equipment_as_list(self):
        profile = Mock()
        profile.name = "A"
        profile.goal = "g"
        profile.experience = "adv"
        profile.equipment = ["dumbbells", "kettlebell", "bands"]
        profile.split = "upper/lower"
        profile.timezone = "America/Chicago"
        template = "Equipment: {equipment}"
        result = build_system_prompt(template, "u1", profile)
        assert "dumbbells, kettlebell, bands" in result

    def test_empty_equipment_list(self):
        profile = Mock()
        profile.name = "A"
        profile.goal = "g"
        profile.experience = "adv"
        profile.equipment = []
        profile.split = "s"
        profile.timezone = "America/Chicago"
        template = "Equipment: {equipment}"
        result = build_system_prompt(template, "u1", profile)
        assert "no equipment" in result

    def test_invalid_timezone_falls_back(self):
        profile = Mock()
        profile.name = "A"
        profile.goal = "g"
        profile.experience = "b"
        profile.equipment = "bench"
        profile.split = "s"
        profile.timezone = "Invalid/Timezone"
        template = "TZ: {timezone}"
        result = build_system_prompt(template, "u1", profile)
        assert "America/Chicago" in result

    def test_pending_draft_included(self, mock_profile):
        template = "Prompt. {pending_draft}"
        draft = {
            "token": "abc123",
            "plan_data": {
                "workouts": [
                    {"day": "Monday", "focus": "Push"},
                    {"day": "Wednesday", "focus": "Pull"},
                ]
            },
        }
        result = build_system_prompt(template, "u1", mock_profile, pending_draft=draft)
        assert "PENDING PLAN DRAFT" in result
        assert "abc123" in result
        assert "Monday (Push)" in result
        assert "Wednesday (Pull)" in result

    def test_no_pending_draft_empty_string(self, mock_profile):
        template = "Prompt. [{pending_draft}]"
        result = build_system_prompt(template, "u1", mock_profile)
        assert "Prompt. []" in result

    def test_unknown_placeholders_preserved(self, mock_profile):
        template = "Hello {user_name}. {unknown_placeholder} here."
        result = build_system_prompt(template, "u1", mock_profile)
        assert "Brandon" in result
        assert "{unknown_placeholder}" in result
