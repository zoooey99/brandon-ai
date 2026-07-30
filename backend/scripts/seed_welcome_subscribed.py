#!/usr/bin/env python3
"""
Seed the welcome_subscribed prompt into agent_prompts.

This is the short welcome message sent after a user subscribes.
Since they've already been chatting with Brandon during onboarding,
it skips the full intro and just confirms they're set up.

Usage:
    python scripts/seed_welcome_subscribed.py
"""

import sys
from pathlib import Path
from datetime import datetime

# Add project root to path
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from app.db.supabase_client import get_supabase

PROMPTS = [
    {
        "name": "welcome_subscribed",
        "type": "template",
        "model": None,
        "prompt_text": """\
you're officially in, {name}! your plan is locked and loaded 💪
---
i'll text you every day at {text_time} with your workout. let's get after it.""",
    },
]


def seed_prompt(supabase, prompt_config):
    name = prompt_config["name"]
    prompt_text = prompt_config["prompt_text"]
    now = datetime.utcnow().isoformat()

    existing = supabase.table("agent_prompts").select("id, version").eq("name", name).execute()

    if existing.data:
        old_version = existing.data[0]["version"]
        new_version = old_version + 1
        update_data = {
            "prompt_text": prompt_text,
            "version": new_version,
            "updated_at": now,
        }
        if prompt_config["model"] is not None:
            update_data["model"] = prompt_config["model"]
        result = supabase.table("agent_prompts").update(update_data).eq("name", name).execute()

        if result.data:
            print(f"Updated '{name}' from version {old_version} to {new_version} ({len(prompt_text)} chars)")
        else:
            print(f"Failed to update '{name}'")
            return
    else:
        new_version = 1
        insert_data = {
            "name": name,
            "prompt_text": prompt_text,
            "version": 1,
            "type": prompt_config["type"],
            "created_at": now,
            "updated_at": now,
        }
        if prompt_config["model"] is not None:
            insert_data["model"] = prompt_config["model"]
        result = supabase.table("agent_prompts").insert(insert_data).execute()

        if result.data:
            print(f"Inserted '{name}' as version 1 ({len(prompt_text)} chars)")
        else:
            print(f"Failed to insert '{name}'")
            return

    supabase.table("agent_prompt_history").insert({
        "prompt_name": name,
        "prompt_text": prompt_text,
        "version": new_version,
        "char_count": len(prompt_text),
        "created_at": now,
    }).execute()
    print(f"History entry created for '{name}'")


def seed():
    supabase = get_supabase()
    for prompt_config in PROMPTS:
        seed_prompt(supabase, prompt_config)


if __name__ == "__main__":
    seed()
