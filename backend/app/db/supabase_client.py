"""
Supabase client wrapper for Brandon Backend.
Provides singleton access to Supabase client.
"""

from supabase import create_client, Client
from app.config import settings
import logging

logger = logging.getLogger(__name__)


class SupabaseClient:
    """Singleton Supabase client wrapper."""

    _instance: Client = None

    @classmethod
    def get_client(cls) -> Client:
        """
        Get or create Supabase client instance.

        Returns:
            Client: Supabase client instance
        """
        if cls._instance is None:
            logger.info("Initializing Supabase client...")
            cls._instance = create_client(
                supabase_url=settings.supabase_url,
                supabase_key=settings.supabase_service_key
            )
            logger.info("✅ Supabase client initialized")

        return cls._instance


def get_supabase() -> Client:
    """
    Convenience function to get Supabase client.

    Returns:
        Client: Supabase client instance
    """
    return SupabaseClient.get_client()
