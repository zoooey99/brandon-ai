"""
Tests for prompt loading, formatting, caching, and version management.

Run with: pytest tests/test_prompt_loader.py -v
"""

import pytest
from unittest.mock import Mock, patch, MagicMock

import app.prompts.loader as loader_module
from app.prompts.loader import (
    _SafeDict,
    safe_format,
    render_template,
    get_prompt,
    get_prompt_with_model,
    save_prompt,
    get_prompt_history,
    get_prompt_version,
    get_current_prompt_version,
    restore_prompt_version,
    save_draft,
    get_draft,
    clear_draft,
    reload_prompts,
    _prompt_cache,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _mock_supabase():
    """Return a MagicMock with chainable Supabase query builder."""
    m = MagicMock()
    return m


def _chain(mock_sb, table_name="agent_prompts"):
    """Shortcut to the terminal .execute().return_value on a table chain."""
    return (
        mock_sb.table.return_value
        .select.return_value
        .eq.return_value
    )


@pytest.fixture(autouse=True)
def clear_cache():
    """Clear prompt cache before every test."""
    reload_prompts()
    yield
    reload_prompts()


@pytest.fixture
def mock_supabase():
    """Patch get_supabase in the loader module and return the mock client."""
    with patch("app.db.supabase_client.get_supabase") as mock_get:
        sb = _mock_supabase()
        mock_get.return_value = sb
        yield sb


# ===================================================================
# _SafeDict
# ===================================================================

class TestSafeDict:
    def test_existing_key(self):
        d = _SafeDict({"name": "Alice"})
        assert d["name"] == "Alice"

    def test_missing_key_returns_placeholder(self):
        d = _SafeDict({})
        assert d["missing"] == "{missing}"


# ===================================================================
# safe_format
# ===================================================================

class TestSafeFormat:
    def test_all_variables_present(self):
        result = safe_format("Hello {name}, goal: {goal}", {"name": "Bob", "goal": "lose weight"})
        assert result == "Hello Bob, goal: lose weight"

    def test_missing_variable_preserved(self):
        result = safe_format("Hello {name}, {unknown}", {"name": "Bob"})
        assert result == "Hello Bob, {unknown}"

    def test_empty_variables(self):
        result = safe_format("Hello {name}", {})
        assert result == "Hello {name}"

    def test_no_placeholders(self):
        result = safe_format("No placeholders here", {"name": "Bob"})
        assert result == "No placeholders here"

    def test_multiple_missing(self):
        result = safe_format("{a} {b} {c}", {})
        assert result == "{a} {b} {c}"

    def test_values_with_braces(self):
        result = safe_format("Result: {val}", {"val": "has {curly} braces"})
        assert "has {curly} braces" in result


# ===================================================================
# render_template
# ===================================================================

class TestRenderTemplate:
    def test_single_message_no_delimiter(self):
        assert render_template("Hello {name}", {"name": "Zoe"}) == ["Hello Zoe"]

    def test_multiple_messages_split(self):
        assert render_template("Part A---Part B---Part C") == ["Part A", "Part B", "Part C"]

    def test_variable_substitution_each_segment(self):
        assert render_template("Hi {name}---Bye {name}", {"name": "X"}) == ["Hi X", "Bye X"]

    def test_missing_variable_preserved(self):
        assert render_template("Hello {who}", {"other": "val"}) == ["Hello {who}"]

    def test_whitespace_segments_filtered(self):
        assert render_template("A---   ---B") == ["A", "B"]

    def test_no_variables_none(self):
        assert render_template("Plain text", None) == ["Plain text"]

    def test_empty_variables(self):
        assert render_template("Hello {name}", {}) == ["Hello {name}"]


# ===================================================================
# get_prompt
# ===================================================================

class TestGetPrompt:
    def test_loads_from_db_and_caches(self, mock_supabase):
        _chain(mock_supabase).execute.return_value.data = [{"prompt_text": "cached text"}]
        result = get_prompt("coach")
        assert result == "cached text"
        assert "coach" in _prompt_cache

    def test_second_call_uses_cache(self, mock_supabase):
        _chain(mock_supabase).execute.return_value.data = [{"prompt_text": "text"}]
        get_prompt("p1")
        get_prompt("p1")
        # table() called only once (first load)
        assert mock_supabase.table.call_count == 1

    def test_use_cache_false_hits_db(self, mock_supabase):
        _chain(mock_supabase).execute.return_value.data = [{"prompt_text": "v1"}]
        get_prompt("p2")
        _chain(mock_supabase).execute.return_value.data = [{"prompt_text": "v2"}]
        result = get_prompt("p2", use_cache=False)
        assert result == "v2"
        assert mock_supabase.table.call_count == 2

    def test_not_found_raises(self, mock_supabase):
        _chain(mock_supabase).execute.return_value.data = []
        with pytest.raises(ValueError, match="not found"):
            get_prompt("nope")

    def test_db_error_raises(self, mock_supabase):
        mock_supabase.table.side_effect = Exception("connection failed")
        with pytest.raises(ValueError, match="Failed to load"):
            get_prompt("broken")


# ===================================================================
# get_prompt_with_model
# ===================================================================

class TestGetPromptWithModel:
    def test_returns_tuple(self, mock_supabase):
        _chain(mock_supabase).execute.return_value.data = [
            {"prompt_text": "hello", "model": "gpt-4o"}
        ]
        text, model = get_prompt_with_model("coach")
        assert text == "hello"
        assert model == "gpt-4o"

    def test_missing_model_defaults(self, mock_supabase):
        _chain(mock_supabase).execute.return_value.data = [
            {"prompt_text": "hello", "model": None}
        ]
        _, model = get_prompt_with_model("coach")
        assert model == "gpt-4o-mini"

    def test_not_found_raises(self, mock_supabase):
        _chain(mock_supabase).execute.return_value.data = []
        with pytest.raises(ValueError, match="not found"):
            get_prompt_with_model("nope")


# ===================================================================
# save_prompt
# ===================================================================

class TestSavePrompt:
    def test_new_prompt_inserts_version_1(self, mock_supabase):
        # No existing prompt
        _chain(mock_supabase).execute.return_value.data = []
        version = save_prompt("new_prompt", "content here")
        assert version == 1
        mock_supabase.table.return_value.insert.assert_called_once()
        call_data = mock_supabase.table.return_value.insert.call_args[0][0]
        assert call_data["version"] == 1
        assert call_data["model"] == "gpt-4o-mini"

    def test_existing_prompt_archives_and_increments(self, mock_supabase):
        # Existing prompt at version 3
        _chain(mock_supabase).execute.return_value.data = [
            {"id": 1, "version": 3, "prompt_text": "old content"}
        ]
        version = save_prompt("coach", "new content")
        assert version == 4
        # Should have inserted into history table
        history_insert = mock_supabase.table.return_value.insert
        assert history_insert.called

    def test_model_override(self, mock_supabase):
        _chain(mock_supabase).execute.return_value.data = []
        save_prompt("p", "text", model="gpt-4o")
        call_data = mock_supabase.table.return_value.insert.call_args[0][0]
        assert call_data["model"] == "gpt-4o"

    def test_clears_cache_after_save(self, mock_supabase):
        # Pre-populate cache
        loader_module._prompt_cache["myprompt"] = "old"
        _chain(mock_supabase).execute.return_value.data = []
        save_prompt("myprompt", "new")
        assert "myprompt" not in _prompt_cache

    def test_clears_draft_after_save(self, mock_supabase):
        _chain(mock_supabase).execute.return_value.data = []
        with patch("app.prompts.loader.clear_draft") as mock_clear:
            save_prompt("p", "text")
            mock_clear.assert_called_once_with("p")


# ===================================================================
# Version History
# ===================================================================

class TestVersionHistory:
    def test_get_prompt_history(self, mock_supabase):
        chain = mock_supabase.table.return_value.select.return_value.eq.return_value.order.return_value
        chain.execute.return_value.data = [
            {"version": 2, "char_count": 100, "created_at": "2026-01-01"},
            {"version": 1, "char_count": 80, "created_at": "2025-12-01"},
        ]
        result = get_prompt_history("coach")
        assert len(result) == 2
        assert result[0]["version"] == 2

    def test_get_prompt_version(self, mock_supabase):
        # Double .eq() chain
        chain = mock_supabase.table.return_value.select.return_value.eq.return_value.eq.return_value
        chain.execute.return_value.data = [
            {"prompt_text": "old text", "version": 1, "char_count": 8, "created_at": "2025-01-01"}
        ]
        result = get_prompt_version("coach", 1)
        assert result["prompt_text"] == "old text"

    def test_get_current_prompt_version(self, mock_supabase):
        _chain(mock_supabase).execute.return_value.data = [
            {"prompt_text": "current", "version": 5, "updated_at": "2026-03-01"}
        ]
        result = get_current_prompt_version("coach")
        assert result["version"] == 5
        assert result["char_count"] == len("current")

    def test_restore_prompt_version(self, mock_supabase):
        # get_prompt_version needs double eq chain
        double_eq = mock_supabase.table.return_value.select.return_value.eq.return_value.eq.return_value
        double_eq.execute.return_value.data = [
            {"prompt_text": "old text", "version": 2, "char_count": 8, "created_at": "2025-01-01"}
        ]
        with patch("app.prompts.loader.save_prompt", return_value=5) as mock_save:
            new_ver = restore_prompt_version("coach", 2)
            mock_save.assert_called_once_with("coach", "old text")
            assert new_ver == 5


# ===================================================================
# Drafts
# ===================================================================

class TestDrafts:
    def test_save_draft(self, mock_supabase):
        mock_supabase.table.return_value.upsert.return_value.execute.return_value = Mock()
        assert save_draft("coach", "draft content") is True

    def test_get_draft_found(self, mock_supabase):
        _chain(mock_supabase).execute.return_value.data = [
            {"draft_text": "my draft", "updated_at": "2026-03-01"}
        ]
        result = get_draft("coach")
        assert result["draft_text"] == "my draft"

    def test_get_draft_not_found(self, mock_supabase):
        _chain(mock_supabase).execute.return_value.data = []
        assert get_draft("coach") is None

    def test_clear_draft(self, mock_supabase):
        mock_supabase.table.return_value.delete.return_value.eq.return_value.execute.return_value = Mock()
        assert clear_draft("coach") is True


# ===================================================================
# Cache Management
# ===================================================================

class TestCacheManagement:
    def test_reload_clears_cache(self):
        loader_module._prompt_cache["x"] = "y"
        reload_prompts()
        assert len(_prompt_cache) == 0

    def test_cache_populated_then_cleared(self, mock_supabase):
        _chain(mock_supabase).execute.return_value.data = [{"prompt_text": "hello"}]
        get_prompt("test_prompt")
        assert "test_prompt" in _prompt_cache
        reload_prompts()
        assert "test_prompt" not in _prompt_cache
