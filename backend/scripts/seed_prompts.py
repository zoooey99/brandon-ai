#!/usr/bin/env python3
"""
Seed script to migrate file-based prompts to database.
Run once after applying the database migration.

Usage:
    python scripts/seed_prompts.py
"""

import sys
from pathlib import Path

# Add project root to path
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from app.db.supabase_client import get_supabase
from datetime import datetime


PROMPTS_DIR = project_root / "app" / "prompts"

# Prompt descriptions for admin UI
PROMPT_DESCRIPTIONS = {
    "coach_agent": "Main coaching response prompt for user conversations",
    "daily_message": "Daily workout reminder prompt sent in mornings",
}


def seed_prompts():
    """Migrate all .md prompt files to database as version 1."""
    supabase = get_supabase()

    # Find all .md files in prompts directory
    prompt_files = list(PROMPTS_DIR.glob("*.md"))

    if not prompt_files:
        print("No prompt files found!")
        return

    print(f"Found {len(prompt_files)} prompt file(s) to migrate")

    for prompt_file in prompt_files:
        prompt_name = prompt_file.stem

        # Read file content
        with open(prompt_file, "r", encoding="utf-8") as f:
            prompt_text = f.read()

        print(f"\nProcessing: {prompt_name}")
        print(f"  File: {prompt_file}")
        print(f"  Size: {len(prompt_text)} chars")

        # Check if already exists in DB
        existing = supabase.table("agent_prompts").select("id, version").eq("name", prompt_name).execute()

        if existing.data:
            print(f"  Status: Already exists in DB (version {existing.data[0]['version']}), skipping")
            continue

        # Insert into agent_prompts table
        result = supabase.table("agent_prompts").insert({
            "name": prompt_name,
            "prompt_text": prompt_text,
            "version": 1,
            "created_at": datetime.utcnow().isoformat(),
            "updated_at": datetime.utcnow().isoformat()
        }).execute()

        if result.data:
            print(f"  Status: Inserted as version 1")

            # Also insert into history table
            history_result = supabase.table("agent_prompt_history").insert({
                "prompt_name": prompt_name,
                "prompt_text": prompt_text,
                "version": 1,
                "char_count": len(prompt_text),
                "created_at": datetime.utcnow().isoformat()
            }).execute()

            if history_result.data:
                print(f"  History: Created history entry for version 1")
            else:
                print(f"  History: Failed to create history entry")
        else:
            print(f"  Status: Failed to insert")

    print("\n✅ Seed complete!")


def verify_migration():
    """Verify that all prompts were migrated successfully."""
    supabase = get_supabase()

    print("\n--- Verification ---")

    # Check agent_prompts table
    prompts = supabase.table("agent_prompts").select("name, version, created_at").execute()

    if prompts.data:
        print(f"\nagent_prompts table ({len(prompts.data)} rows):")
        for p in prompts.data:
            print(f"  - {p['name']}: v{p['version']} (created: {p['created_at']})")
    else:
        print("\nagent_prompts table: empty")

    # Check history table
    history = supabase.table("agent_prompt_history").select("prompt_name, version, char_count").execute()

    if history.data:
        print(f"\nagent_prompt_history table ({len(history.data)} rows):")
        for h in history.data:
            print(f"  - {h['prompt_name']}: v{h['version']} ({h['char_count']} chars)")
    else:
        print("\nagent_prompt_history table: empty")


if __name__ == "__main__":
    print("=" * 50)
    print("Prompt Migration Script")
    print("=" * 50)

    seed_prompts()
    verify_migration()
