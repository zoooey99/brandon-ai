"""
Per-user concurrency control with hybrid collect.
Ensures only one agent run per user at a time.  Messages that arrive while
the agent is running are queued and re-processed after the current run.
"""

import asyncio
import logging
from typing import Callable, Awaitable, List

from app.db.models import InboundMessage

logger = logging.getLogger(__name__)

MAX_RERUN_CYCLES = 3

# Module-level state (lives for the lifetime of the process)
_user_locks: dict[str, asyncio.Lock] = {}
_pending_messages: dict[str, List[InboundMessage]] = {}
_generation: dict[str, int] = {}


def drain_pending(phone: str) -> List[InboundMessage]:
    """Pop and return any messages that arrived while the agent is running.
    Called by the agent loop between rounds to check for new input."""
    return _pending_messages.pop(phone, [])


def _get_lock(phone: str) -> asyncio.Lock:
    if phone not in _user_locks:
        _user_locks[phone] = asyncio.Lock()
    return _user_locks[phone]


def get_current_generation(phone: str) -> int:
    """Return the current generation counter for a phone number."""
    return _generation.get(phone, 0)


async def enqueue_and_process(
    phone_number: str,
    messages: List[InboundMessage],
    process_fn: Callable[[str, List[InboundMessage]], Awaitable[None]],
) -> None:
    """
    Acquire per-user lock, run process_fn, then check for queued messages.

    If the lock is already held (another run in progress), the messages are
    queued and the current holder will pick them up on its next cycle.

    Args:
        phone_number: User's phone (used as key)
        messages: The inbound messages from this webhook
        process_fn: async fn(phone_number, messages) that runs the agent + sends response
    """
    lock = _get_lock(phone_number)

    # If we can't acquire immediately, queue and return — the holder will pick up.
    if lock.locked():
        logger.info(f"Lock held for {phone_number}, queueing {len(messages)} message(s)")
        _pending_messages.setdefault(phone_number, []).extend(messages)
        return

    async with lock:
        # Bump generation so stale responses know to discard themselves
        _generation[phone_number] = _generation.get(phone_number, 0) + 1

        current_messages = messages
        cycles = 0

        while cycles < MAX_RERUN_CYCLES:
            # Clear the pending queue before running so new arrivals accumulate fresh
            _pending_messages.pop(phone_number, None)

            await process_fn(phone_number, current_messages)
            cycles += 1

            # Check if anything arrived while we were running
            queued = _pending_messages.pop(phone_number, None)
            if not queued:
                break  # Nothing new, we're done

            # New messages arrived — bump generation and re-run with those messages
            logger.info(
                f"Hybrid collect: {len(queued)} new message(s) arrived for {phone_number}, "
                f"re-running (cycle {cycles + 1}/{MAX_RERUN_CYCLES})"
            )
            _generation[phone_number] = _generation.get(phone_number, 0) + 1
            current_messages = queued

        if cycles >= MAX_RERUN_CYCLES:
            logger.warning(f"Hit max rerun cycles ({MAX_RERUN_CYCLES}) for {phone_number}")
