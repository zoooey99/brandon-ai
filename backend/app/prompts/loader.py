"""
Prompt Loader for Brandon Backend.
Loads and manages AI prompt templates from database with version history support.
"""

from typing import Dict, List, Optional
from datetime import datetime
import logging

logger = logging.getLogger(__name__)

# Cache for loaded prompts
_prompt_cache: Dict[str, str] = {}


# ---------------------------------------------------------------------------
# Safe formatting helpers
# ---------------------------------------------------------------------------

class _SafeDict(dict):
    """Dict that returns {key} for missing keys instead of raising KeyError."""
    def __missing__(self, key):
        logger.warning(f"Missing template variable '{key}'")
        return f"{{{key}}}"


def safe_format(template: str, variables: Dict[str, str]) -> str:
    """Format a template string safely using simple replacement.

    Uses str.replace instead of format_map to avoid interpreting JSON
    curly braces as format placeholders.
    """
    result = template
    for key, value in variables.items():
        placeholder = "{" + key + "}"
        result = result.replace(placeholder, str(value))
    return result


def render_template(
    text: str,
    variables: Optional[Dict] = None,
) -> List[str]:
    """Format a template and split on '---' into message list.

    Args:
        text: Template string with optional {placeholders} and --- delimiters.
        variables: Optional dict of substitution values.

    Returns:
        List of message strings (even single-message templates return a
        1-item list).
    """
    if variables:
        text = safe_format(text, variables)
    return [msg.strip() for msg in text.split("---") if msg.strip()]


def get_prompt(prompt_name: str, use_cache: bool = True) -> str:
    """
    Load a prompt template from database.

    Args:
        prompt_name: Name of the prompt (e.g., "coach_agent")
        use_cache: Whether to use cached version

    Returns:
        Prompt template string

    Raises:
        ValueError: If prompt doesn't exist in database
    """
    # Check cache first
    if use_cache and prompt_name in _prompt_cache:
        logger.debug(f"Loading prompt '{prompt_name}' from cache")
        return _prompt_cache[prompt_name]

    try:
        from app.db.supabase_client import get_supabase
        supabase = get_supabase()

        result = supabase.table("agent_prompts").select("prompt_text").eq("name", prompt_name).execute()

        if not result.data:
            raise ValueError(f"Prompt '{prompt_name}' not found in database")

        content = result.data[0]["prompt_text"]
        logger.info(f"Loaded prompt '{prompt_name}' from database ({len(content)} chars)")

        # Cache it
        _prompt_cache[prompt_name] = content
        return content

    except Exception as e:
        logger.error(f"Error loading prompt '{prompt_name}': {e}")
        raise ValueError(f"Failed to load prompt '{prompt_name}': {e}")


def get_prompt_with_model(prompt_name: str) -> tuple:
    """
    Load a prompt template and its configured model from database.

    Args:
        prompt_name: Name of the prompt

    Returns:
        Tuple of (prompt_text, model)

    Raises:
        ValueError: If prompt doesn't exist in database
    """
    try:
        from app.db.supabase_client import get_supabase
        supabase = get_supabase()

        result = supabase.table("agent_prompts").select("prompt_text, model").eq("name", prompt_name).execute()

        if not result.data:
            raise ValueError(f"Prompt '{prompt_name}' not found in database")

        data = result.data[0]
        prompt_text = data["prompt_text"]
        model = data.get("model") or "gpt-4o-mini"

        logger.info(f"Loaded prompt '{prompt_name}' with model '{model}'")

        return prompt_text, model

    except Exception as e:
        logger.error(f"Error loading prompt with model: {e}")
        raise ValueError(f"Failed to load prompt '{prompt_name}': {e}")


def get_prompt_info(prompt_name: str) -> Optional[Dict]:
    """
    Get metadata about a prompt from the database.

    Returns:
        Dict with id, name, version, updated_at, char count, or None if not found
    """
    try:
        from app.db.supabase_client import get_supabase
        supabase = get_supabase()

        result = supabase.table("agent_prompts").select("*").eq("name", prompt_name).execute()

        if result.data:
            data = result.data[0]
            data["char_count"] = len(data.get("prompt_text", ""))
            return data
        return None
    except Exception as e:
        logger.error(f"Error getting prompt info: {e}")
        return None


def list_prompts() -> List[Dict]:
    """
    List all prompts with metadata.

    Returns:
        List of prompt dicts with name, version, model, type, updated_at, char_count
    """
    try:
        from app.db.supabase_client import get_supabase
        supabase = get_supabase()

        result = supabase.table("agent_prompts").select("name, version, model, type, updated_at, prompt_text").order("name").execute()

        prompts = []
        for row in result.data or []:
            prompts.append({
                "name": row["name"],
                "version": row["version"],
                "model": row.get("model") or "gpt-4o-mini",
                "type": row.get("type") or "prompt",
                "updated_at": row["updated_at"],
                "char_count": len(row.get("prompt_text", ""))
            })
        return prompts
    except Exception as e:
        logger.error(f"Error listing prompts: {e}")
        return []


def save_prompt(prompt_name: str, new_content: str, model: Optional[str] = None) -> int:
    """
    Save prompt, archive current version to history, return new version number.

    Args:
        prompt_name: Name of the prompt
        new_content: New prompt content
        model: Optional model to set (if None, keeps existing)

    Returns:
        New version number

    Raises:
        ValueError: If save fails
    """
    try:
        from app.db.supabase_client import get_supabase
        supabase = get_supabase()

        # Get current version
        existing = supabase.table("agent_prompts").select("id, version, prompt_text").eq("name", prompt_name).execute()

        if existing.data:
            current = existing.data[0]
            current_version = current["version"]
            current_text = current["prompt_text"]
            new_version = current_version + 1

            # Archive current version to history
            supabase.table("agent_prompt_history").insert({
                "prompt_name": prompt_name,
                "prompt_text": current_text,
                "version": current_version,
                "char_count": len(current_text),
                "created_at": datetime.utcnow().isoformat()
            }).execute()

            # Update to new version
            update_data = {
                "prompt_text": new_content,
                "version": new_version,
                "updated_at": datetime.utcnow().isoformat()
            }
            if model is not None:
                update_data["model"] = model

            supabase.table("agent_prompts").update(update_data).eq("name", prompt_name).execute()

            logger.info(f"Saved prompt '{prompt_name}' as version {new_version}")
        else:
            # Create new prompt
            new_version = 1
            insert_data = {
                "name": prompt_name,
                "prompt_text": new_content,
                "version": new_version,
                "model": model or "gpt-4o-mini",
                "created_at": datetime.utcnow().isoformat(),
                "updated_at": datetime.utcnow().isoformat()
            }
            supabase.table("agent_prompts").insert(insert_data).execute()

            logger.info(f"Created new prompt '{prompt_name}' as version 1")

        # Clear cache and draft
        if prompt_name in _prompt_cache:
            del _prompt_cache[prompt_name]
        clear_draft(prompt_name)

        return new_version

    except Exception as e:
        logger.error(f"Error saving prompt: {e}")
        raise ValueError(f"Failed to save prompt: {e}")


# =============================================================================
# Version History Functions
# =============================================================================

def get_prompt_history(prompt_name: str) -> List[Dict]:
    """
    Get all versions for a prompt (excluding current).

    Returns:
        List of version dicts with version, char_count, created_at, ordered by version DESC
    """
    try:
        from app.db.supabase_client import get_supabase
        supabase = get_supabase()

        result = supabase.table("agent_prompt_history") \
            .select("version, char_count, created_at") \
            .eq("prompt_name", prompt_name) \
            .order("version", desc=True) \
            .execute()

        return result.data or []
    except Exception as e:
        logger.error(f"Error getting prompt history: {e}")
        return []


def get_prompt_version(prompt_name: str, version: int) -> Optional[Dict]:
    """
    Get specific version content from history.

    Returns:
        Dict with prompt_text, version, char_count, created_at or None
    """
    try:
        from app.db.supabase_client import get_supabase
        supabase = get_supabase()

        result = supabase.table("agent_prompt_history") \
            .select("prompt_text, version, char_count, created_at") \
            .eq("prompt_name", prompt_name) \
            .eq("version", version) \
            .execute()

        if result.data:
            return result.data[0]
        return None
    except Exception as e:
        logger.error(f"Error getting prompt version: {e}")
        return None


def get_current_prompt_version(prompt_name: str) -> Optional[Dict]:
    """
    Get current version content from agent_prompts table.

    Returns:
        Dict with prompt_text, version, char_count, updated_at or None
    """
    try:
        from app.db.supabase_client import get_supabase
        supabase = get_supabase()

        result = supabase.table("agent_prompts") \
            .select("prompt_text, version, updated_at") \
            .eq("name", prompt_name) \
            .execute()

        if result.data:
            data = result.data[0]
            data["char_count"] = len(data.get("prompt_text", ""))
            data["created_at"] = data.get("updated_at")  # Alias for consistency
            return data
        return None
    except Exception as e:
        logger.error(f"Error getting current prompt version: {e}")
        return None


def restore_prompt_version(prompt_name: str, version: int) -> int:
    """
    Restore an old version by creating a new version with that content.

    Args:
        prompt_name: Name of the prompt
        version: Version number to restore

    Returns:
        New version number

    Raises:
        ValueError: If version not found or restore fails
    """
    # Get the old version content
    old_version = get_prompt_version(prompt_name, version)

    if not old_version:
        raise ValueError(f"Version {version} not found for prompt '{prompt_name}'")

    # Save as new version (this archives current and creates new)
    new_version = save_prompt(prompt_name, old_version["prompt_text"])

    logger.info(f"Restored prompt '{prompt_name}' from version {version} to version {new_version}")
    return new_version


# =============================================================================
# Draft Functions (Auto-save)
# =============================================================================

def save_draft(prompt_name: str, draft_text: str) -> bool:
    """
    Auto-save draft (upsert - one draft per prompt).

    Args:
        prompt_name: Name of the prompt
        draft_text: Draft content

    Returns:
        True if successful
    """
    try:
        from app.db.supabase_client import get_supabase
        supabase = get_supabase()

        # Upsert - update if exists, insert if not
        supabase.table("agent_prompt_drafts").upsert({
            "prompt_name": prompt_name,
            "draft_text": draft_text,
            "updated_at": datetime.utcnow().isoformat()
        }, on_conflict="prompt_name").execute()

        logger.debug(f"Saved draft for '{prompt_name}'")
        return True
    except Exception as e:
        logger.error(f"Error saving draft: {e}")
        return False


def get_draft(prompt_name: str) -> Optional[Dict]:
    """
    Get current draft if exists.

    Returns:
        Dict with draft_text, updated_at or None
    """
    try:
        from app.db.supabase_client import get_supabase
        supabase = get_supabase()

        result = supabase.table("agent_prompt_drafts") \
            .select("draft_text, updated_at") \
            .eq("prompt_name", prompt_name) \
            .execute()

        if result.data:
            return result.data[0]
        return None
    except Exception as e:
        logger.error(f"Error getting draft: {e}")
        return None


def clear_draft(prompt_name: str) -> bool:
    """
    Clear draft after successful save.

    Args:
        prompt_name: Name of the prompt

    Returns:
        True if successful (or no draft to clear)
    """
    try:
        from app.db.supabase_client import get_supabase
        supabase = get_supabase()

        supabase.table("agent_prompt_drafts") \
            .delete() \
            .eq("prompt_name", prompt_name) \
            .execute()

        logger.debug(f"Cleared draft for '{prompt_name}'")
        return True
    except Exception as e:
        logger.error(f"Error clearing draft: {e}")
        return False


# =============================================================================
# Cache Management
# =============================================================================

def reload_prompts():
    """
    Clear prompt cache to force reload from database.
    """
    global _prompt_cache
    _prompt_cache.clear()
    logger.info("Prompt cache cleared")

