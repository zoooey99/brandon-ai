"""
SMS Agent — LiteLLM tool-calling loop.
Runs the conversation with the LLM, executing tool calls until the model
produces a final text response (or we hit the max rounds).
"""

import litellm
import json
import time
import os
import logging
from typing import List, Dict, Optional, Callable, Awaitable

from datetime import datetime, timezone

from app.config import settings
from app.db.queries import get_recent_messages
from app.db.supabase_client import get_supabase
from app.prompts.loader import get_prompt_with_model
from app.sms.prompt import build_system_prompt
from app.sms.tools import TOOL_DEFINITIONS, execute_tool

logger = logging.getLogger(__name__)

MAX_ROUNDS = 10

# Ensure Helicone is configured (same as ai_agent.py)
if settings.helicone_api_key:
    os.environ["HELICONE_API_KEY"] = settings.helicone_api_key
    litellm.success_callback = ["helicone"]
    litellm.failure_callback = ["helicone"]

litellm.drop_params = True


def _combine_consecutive(messages: List[Dict]) -> List[Dict]:
    """Merge consecutive messages with the same role (required by some models)."""
    if not messages:
        return messages

    combined: List[Dict] = [messages[0].copy()]
    for msg in messages[1:]:
        if msg["role"] == combined[-1]["role"] and msg["role"] in ("user", "assistant"):
            combined[-1]["content"] += "\n\n" + msg["content"]
        else:
            combined.append(msg.copy())
    return combined


async def run_agent(
    user_id: str,
    phone_number: str,
    incoming_message: str,
    profile,
    send_fn: Optional[Callable[[str], Awaitable[None]]] = None,
    drain_fn: Optional[Callable[[], list]] = None,
    on_event: Optional[Callable[[str, dict], None]] = None,
) -> str:
    """
    Run the SMS tool-calling agent.

    Args:
        user_id: User ID
        phone_number: User phone number (E.164)
        incoming_message: The user's latest text
        profile: UserProfile model
        send_fn: Optional async callback to send messages immediately mid-loop
                 (used for acknowledge-before-action pattern)
        drain_fn: Optional callback that returns any messages queued while the
                  agent is running (used for mid-run message injection)
        on_event: Optional callback(event_type, data) for tracing agent runs.
                  Called at natural boundaries — decoupled from trace format.

    Returns:
        Final text response to send to the user (may be empty if sent via send_fn)
    """
    def _emit(event_type: str, data: dict):
        if on_event:
            on_event(event_type, data)

    # 1. Load prompt + model from DB
    prompt_template, model = get_prompt_with_model("sms_agent")

    # Fetch any pending plan draft for system prompt context
    pending_draft = None
    try:
        supabase = get_supabase()
        draft_resp = (
            supabase.table("plan_drafts")
            .select("token, plan_data")
            .eq("user_id", user_id)
            .eq("status", "pending")
            .gt("expires_at", datetime.now(timezone.utc).isoformat())
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        if draft_resp.data:
            pending_draft = draft_resp.data[0]
    except Exception as e:
        logger.warning(f"Failed to fetch pending draft for user {user_id}: {e}")

    system_prompt = build_system_prompt(prompt_template, user_id, profile, pending_draft=pending_draft)
    _emit("system_prompt", {"content": system_prompt})

    # 2. Build messages array: system + history + incoming
    messages: List[Dict] = [{"role": "system", "content": system_prompt}]

    recent = get_recent_messages(user_id, limit=settings.max_conversation_history)
    history_msgs: List[Dict] = []
    for msg in recent:
        direction = msg.get("direction")
        if direction == "inbound":
            role = "user"
        elif direction == "context":
            role = "system"
        else:
            role = "assistant"
        content = msg.get("content", "")
        if content:
            history_msgs.append({"role": role, "content": content})

    if history_msgs:
        history_msgs = _combine_consecutive(history_msgs)
        messages.extend(history_msgs)
    _emit("history", {"messages": history_msgs, "message_count": len(history_msgs)})

    # Append the current incoming message
    if messages[-1]["role"] == "user":
        messages[-1]["content"] += "\n\n" + incoming_message
    else:
        messages.append({"role": "user", "content": incoming_message})
    _emit("user_message", {"content": incoming_message})

    # 3. Helicone metadata
    metadata = {}
    if settings.helicone_api_key:
        metadata = {
            "Helicone-User-Id": user_id,
            "Helicone-Property-UserName": getattr(profile, "name", "unknown"),
            "Helicone-Property-MessageType": "sms_response",
        }

    # 4. Tool-calling loop
    for round_num in range(MAX_ROUNDS):
        _emit("llm_request", {"round": round_num + 1, "model": model, "message_count": len(messages)})
        start = time.time()

        response = await litellm.acompletion(
            model=model,
            messages=messages,
            tools=TOOL_DEFINITIONS,
            metadata=metadata if metadata else None,
            api_key=settings.openai_api_key,
        )

        latency_ms = (time.time() - start) * 1000
        choice = response.choices[0]
        usage = response.usage

        logger.info(
            f"Agent round {round_num + 1}: "
            f"finish_reason={choice.finish_reason}, "
            f"tokens={usage.total_tokens}, "
            f"latency={latency_ms:.0f}ms"
        )

        _emit("llm_response", {
            "round": round_num + 1,
            "finish_reason": choice.finish_reason,
            "content": choice.message.content or "",
            "tool_calls": [
                {"name": tc.function.name, "args": tc.function.arguments}
                for tc in (choice.message.tool_calls or [])
            ],
            "tokens": {
                "prompt": usage.prompt_tokens,
                "completion": usage.completion_tokens,
                "total": usage.total_tokens,
            },
            "latency_ms": round(latency_ms),
        })

        # If the model returned text (no tool calls), we're done
        if choice.finish_reason == "stop" or not choice.message.tool_calls:
            final_text = (choice.message.content or "").strip()
            if not final_text:
                final_text = "Hey! Let me know if you need anything."
            _emit("final_response", {"text": final_text})
            return final_text

        # If model returned text alongside tool_calls, send it immediately
        # This is the "acknowledge before action" pattern (e.g., "yeah lemme check that")
        mid_text = (choice.message.content or "").strip()
        if mid_text:
            _emit("tool_ack", {"text": mid_text})
        if mid_text and send_fn:
            try:
                await send_fn(mid_text)
                logger.info(f"Sent mid-loop acknowledgment: {mid_text[:80]}")
            except Exception as e:
                logger.warning(f"Failed to send mid-loop message: {e}")

        # Process tool calls
        # Append the assistant message (with tool_calls) to conversation
        messages.append(choice.message.model_dump())

        for tool_call in choice.message.tool_calls:
            fn_name = tool_call.function.name
            try:
                fn_args = json.loads(tool_call.function.arguments)
            except json.JSONDecodeError:
                fn_args = {}

            logger.info(f"Tool call: {fn_name}({json.dumps(fn_args, default=str)[:150]})")
            _emit("tool_call", {"round": round_num + 1, "name": fn_name, "args": fn_args})

            result = execute_tool(
                name=fn_name,
                args=fn_args,
                user_id=user_id,
                phone_number=phone_number,
                profile=profile,
            )
            _emit("tool_result", {"round": round_num + 1, "name": fn_name, "result": result})

            messages.append({
                "role": "tool",
                "tool_call_id": tool_call.id,
                "content": json.dumps(result, default=str),
            })

        # Check for new messages that arrived mid-run
        if drain_fn:
            new_msgs = drain_fn()
            if new_msgs:
                new_text = " ".join(m.text for m in new_msgs)
                injection = (
                    "[NEW MESSAGE FROM USER — sent while you were still working on the previous request. "
                    "Take this into account for your response. If it contradicts or corrects the original "
                    "request, prioritize this newer message.]\n\n"
                    + new_text
                )
                messages.append({"role": "user", "content": injection})
                _emit("message_injected", {"count": len(new_msgs), "text": new_text})
                logger.info(f"Injected {len(new_msgs)} new message(s) mid-run")

    # If we exhausted all rounds, make one final call without tools
    logger.warning(f"Agent hit max rounds ({MAX_ROUNDS}), forcing final response")
    response = await litellm.acompletion(
        model=model,
        messages=messages,
        metadata=metadata if metadata else None,
        api_key=settings.openai_api_key,
    )
    final_text = (response.choices[0].message.content or "").strip() or "Hey! Let me know how I can help."
    _emit("final_response", {"text": final_text})
    return final_text
