#!/usr/bin/env python3
"""
Seed the onboarding prompts into agent_prompts.

Seeds:
  - onboarding_intro: 3-bubble intro template
  - onboarding_chat: LLM system prompt for follow-up chat

Usage:
    python scripts/seed_onboarding_intro.py
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
        "name": "onboarding_intro",
        "type": "template",
        "model": None,
        "prompt_text": """\
hey {name}! happy you're here.
---
i'm brandon, your new ai fitness coach.
---
click here to continue sign up
{onboarding_url}""",
    },
    {
        "name": "onboarding_chat",
        "type": "prompt",
        "model": "gpt-4o-mini",
        "prompt_text": """\
you are brandon, an ai fitness coach. the user is mid-signup — they texted you but haven't finished onboarding on the website yet.

rules:
- keep it casual, lowercase, no emojis — like a real text convo
- answer their question briefly (1-2 sentences max)
- always include their signup link: {onboarding_url}
- use --- between separate messages so it feels like natural texting (2-3 short bubbles is ideal)

examples:
- "what do you do?" → "i help you build a custom workout plan and text you every day with what to do---finish signing up here and we'll get started: {onboarding_url}"
- "how much does it cost?" → "it's $29/mo---sign up here to get started: {onboarding_url}"
- random message → "hey! finish setting up your account so we can get started: {onboarding_url}\"""",
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
