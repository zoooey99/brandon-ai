"""
Mac Server Client for Brandon Backend.
Handles sending messages to the Mac iMessage relay server with rate limiting and retries.
"""

import httpx
import asyncio
import time
from typing import List, Dict, Optional
from asyncio import Lock
from collections import deque
from datetime import datetime, timedelta
import logging

from app.config import settings
from app.db.models import OutboundMessageChunk

logger = logging.getLogger(__name__)


class MacServerClient:
    """
    Client for communicating with Mac iMessage relay server.
    Implements rate limiting (10 requests/min) and retry logic.
    """

    def __init__(self):
        # Strip /api/send from URL if present (to avoid doubling)
        self.base_url = settings.mac_server_url.rstrip("/")
        if self.base_url.endswith("/api/send"):
            self.base_url = self.base_url[:-9]  # Remove /api/send
        self.api_key = settings.mac_server_apikey
        self.rate_limit = settings.mac_server_rate_limit  # requests per minute
        self.request_times: deque = deque()
        self.lock = Lock()

    async def _wait_for_rate_limit(self):
        """
        Implement rate limiting by tracking request times.
        Blocks if rate limit would be exceeded.
        """
        async with self.lock:
            now = time.time()
            one_minute_ago = now - 60

            # Remove requests older than 1 minute
            while self.request_times and self.request_times[0] < one_minute_ago:
                self.request_times.popleft()

            # If we're at the limit, wait
            if len(self.request_times) >= self.rate_limit:
                oldest_request = self.request_times[0]
                wait_time = 60 - (now - oldest_request) + 0.1  # Add small buffer

                if wait_time > 0:
                    logger.info(f"⏳ Rate limit reached, waiting {wait_time:.1f}s...")
                    await asyncio.sleep(wait_time)

                    # Clean up old requests again after waiting
                    now = time.time()
                    one_minute_ago = now - 60
                    while self.request_times and self.request_times[0] < one_minute_ago:
                        self.request_times.popleft()

            # Record this request
            self.request_times.append(now)

    async def send_message(
        self,
        phone_number: str,
        messages: List[OutboundMessageChunk],
        delay_before_typing: float = 2.0,
        typing_duration: float = 3.0,
        max_retries: int = 3
    ) -> Dict:
        """
        Send message(s) to Mac server.

        Args:
            phone_number: Recipient phone number (E.164 format)
            messages: List of message chunks to send
            delay_before_typing: Seconds to wait before showing typing indicator
            typing_duration: Seconds to show typing indicator
            max_retries: Maximum retry attempts

        Returns:
            Response dict from Mac server

        Raises:
            MacServerError: If all retries fail
        """
        # Wait for rate limit
        await self._wait_for_rate_limit()

        # Prepare payload
        payload = {
            "reply_type": "message",
            "phone_number": phone_number,
            "messages": [msg.model_dump() for msg in messages],
            "delay_before_typing": delay_before_typing,
            "typing_duration": typing_duration
        }

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }

        attempt = 0
        last_error = None

        while attempt < max_retries:
            try:
                async with httpx.AsyncClient(timeout=30.0) as client:
                    logger.info(f"📤 Sending message to {phone_number} (attempt {attempt + 1}/{max_retries})")

                    response = await client.post(
                        f"{self.base_url}/api/send",
                        json=payload,
                        headers=headers
                    )

                    # Handle rate limit response
                    if response.status_code == 429:
                        retry_after = int(response.headers.get("Retry-After", 60))
                        logger.warning(f"⚠️ Rate limited by Mac server, waiting {retry_after}s")
                        await asyncio.sleep(retry_after)
                        attempt += 1
                        continue

                    # Handle errors
                    if response.status_code >= 400:
                        error_data = response.json() if response.headers.get("content-type") == "application/json" else {}
                        error_msg = error_data.get("error", response.text)
                        logger.error(f"❌ Mac server error ({response.status_code}): {error_msg}")

                        if response.status_code == 401:
                            raise MacServerError(f"Authentication failed: {error_msg}")

                        if response.status_code == 400:
                            raise MacServerError(f"Invalid request: {error_msg}")

                        last_error = MacServerError(f"Mac server error: {error_msg}")
                        attempt += 1
                        continue

                    # Success
                    result = response.json()
                    logger.info(f"✅ Message sent successfully (job_id: {result.get('job_id')})")
                    return result

            except httpx.TimeoutException as e:
                last_error = MacServerError(f"Request timeout: {e}")
                logger.error(f"⏱️ Timeout sending to Mac server: {e}")
                attempt += 1

                if attempt < max_retries:
                    # Exponential backoff
                    wait_time = min(2 ** attempt, 30)
                    logger.info(f"Retrying in {wait_time}s...")
                    await asyncio.sleep(wait_time)

            except httpx.RequestError as e:
                last_error = MacServerError(f"Request failed: {e}")
                logger.error(f"❌ Error sending to Mac server: {e}")
                attempt += 1

                if attempt < max_retries:
                    wait_time = min(2 ** attempt, 30)
                    logger.info(f"Retrying in {wait_time}s...")
                    await asyncio.sleep(wait_time)

            except Exception as e:
                last_error = MacServerError(f"Unexpected error: {e}")
                logger.error(f"❌ Unexpected error: {e}", exc_info=True)
                attempt += 1

                if attempt < max_retries:
                    await asyncio.sleep(5)

        # All retries failed
        raise last_error or MacServerError("Failed to send message after all retries")

    async def send_no_reply(self, phone_number: str) -> Dict:
        """
        Send a no-reply response to Mac server.

        Args:
            phone_number: Phone number to acknowledge

        Returns:
            Response dict from Mac server
        """
        await self._wait_for_rate_limit()

        payload = {
            "reply_type": "no_reply",
            "phone_number": phone_number
        }

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.post(
                    f"{self.base_url}/api/send",
                    json=payload,
                    headers=headers
                )

                response.raise_for_status()
                return response.json()

        except Exception as e:
            logger.error(f"Error sending no-reply: {e}")
            raise MacServerError(f"Failed to send no-reply: {e}")

    async def check_health(self) -> bool:
        """
        Check if Mac server is healthy.

        Returns:
            True if healthy, False otherwise
        """
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(f"{self.base_url}/health")
                return response.status_code == 200

        except Exception as e:
            logger.error(f"Mac server health check failed: {e}")
            return False


class MacServerError(Exception):
    """Exception raised when Mac server operations fail."""
    pass


# Singleton instance
_mac_client = None


def get_mac_client() -> MacServerClient:
    """
    Get or create Mac server client instance.

    Returns:
        MacServerClient instance
    """
    global _mac_client
    if _mac_client is None:
        _mac_client = MacServerClient()
    return _mac_client
