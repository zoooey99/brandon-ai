"""
Tests for the per-user message queue (hybrid collect + generation counter).

Run with: pytest tests/test_queue.py -v
"""

import pytest

import app.sms.queue as queue
from app.sms.queue import (
    enqueue_and_process,
    drain_pending,
    get_current_generation,
    MAX_RERUN_CYCLES,
)
from app.db.models import InboundMessage

PHONE = "+15555550100"


def _msg(text):
    return InboundMessage(text=text, timestamp="2026-01-01T00:00:00Z")


@pytest.fixture(autouse=True)
def reset_queue_state():
    queue._user_locks.clear()
    queue._pending_messages.clear()
    queue._generation.clear()
    yield
    queue._user_locks.clear()
    queue._pending_messages.clear()
    queue._generation.clear()


class TestEnqueueAndProcess:
    async def test_processes_messages_once(self):
        calls = []

        async def process(phone, msgs):
            calls.append((phone, [m.text for m in msgs]))

        await enqueue_and_process(PHONE, [_msg("hello")], process)
        assert calls == [(PHONE, ["hello"])]

    async def test_bumps_generation(self):
        async def process(phone, msgs):
            pass

        assert get_current_generation(PHONE) == 0
        await enqueue_and_process(PHONE, [_msg("hi")], process)
        assert get_current_generation(PHONE) == 1

    async def test_queues_when_lock_held(self):
        lock = queue._get_lock(PHONE)
        await lock.acquire()
        try:
            async def process(phone, msgs):
                raise AssertionError("should not run while lock is held")

            await enqueue_and_process(PHONE, [_msg("queued")], process)
            pending = queue._pending_messages.get(PHONE, [])
            assert [m.text for m in pending] == ["queued"]
        finally:
            lock.release()

    async def test_hybrid_collect_reruns_with_queued_messages(self):
        calls = []

        async def process(phone, msgs):
            calls.append([m.text for m in msgs])
            if len(calls) == 1:
                # Simulate a message arriving mid-run
                queue._pending_messages.setdefault(phone, []).append(_msg("late"))

        await enqueue_and_process(PHONE, [_msg("first")], process)
        assert calls == [["first"], ["late"]]
        # Generation bumped twice: initial run + rerun
        assert get_current_generation(PHONE) == 2

    async def test_stops_after_max_rerun_cycles(self):
        calls = []

        async def process(phone, msgs):
            calls.append(1)
            # Always inject a new pending message — would loop forever without cap
            queue._pending_messages.setdefault(phone, []).append(_msg("again"))

        await enqueue_and_process(PHONE, [_msg("start")], process)
        assert len(calls) == MAX_RERUN_CYCLES


class TestDrainPending:
    def test_drain_returns_and_clears(self):
        queue._pending_messages[PHONE] = [_msg("a"), _msg("b")]
        drained = drain_pending(PHONE)
        assert [m.text for m in drained] == ["a", "b"]
        assert drain_pending(PHONE) == []

    def test_drain_empty(self):
        assert drain_pending(PHONE) == []
