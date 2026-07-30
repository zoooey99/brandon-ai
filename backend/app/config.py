"""
Configuration management for Brandon Backend.
Loads and validates environment variables.
"""

from pydantic_settings import BaseSettings
from pydantic import Field
from typing import Literal


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # Supabase Configuration
    supabase_url: str = Field(..., alias="SUPABASE_URL")
    supabase_service_key: str = Field(..., alias="SUPABASE_SERVICE_KEY")

    # Mac Server Integration
    mac_server_url: str = Field(..., alias="MAC_SERVER_URL")
    mac_server_apikey: str = Field(..., alias="MAC_SERVER_APIKEY")
    remote_server_apikey: str = Field(..., alias="REMOTE_SERVER_APIKEY")

    # OpenAI Configuration
    openai_api_key: str = Field(..., alias="OPENAI_API_KEY")
    openai_model: str = Field(default="gpt-5-mini", alias="OPENAI_MODEL")

    # Helicone Observability (optional)
    helicone_api_key: str = Field(default="", alias="HELICONE_API_KEY")

    # Frontend API Authentication
    frontend_apikey: str = Field(
        default="",
        alias="FRONTEND_APIKEY",
        description="API key for frontend endpoints (plan generation, coach chat)"
    )

    # Backend Server Configuration
    backend_host: str = Field(default="0.0.0.0", alias="BACKEND_HOST")
    backend_port: int = Field(default=8000, alias="BACKEND_PORT")
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = Field(
        default="INFO", alias="LOG_LEVEL"
    )

    # Frontend URL (for callbacks like intro-complete notification)
    frontend_url: str = Field(default="https://textbrandon.now", alias="FRONTEND_URL")

    # Environment
    environment: Literal["development", "staging", "production"] = Field(
        default="development", alias="ENVIRONMENT"
    )

    # Rate Limiting
    mac_server_rate_limit: int = Field(
        default=10,
        description="Max requests per minute to Mac server"
    )

    # Conversation Settings
    max_conversation_history: int = Field(
        default=20,
        description="Number of recent messages to include in AI context"
    )

    # Scheduling
    daily_message_lookback_minutes: int = Field(
        default=5,
        description="How many minutes to look back when scheduling daily messages"
    )

    # Admin UI (REQUIRED - no defaults for security)
    admin_password: str = Field(
        ...,
        alias="ADMIN_PASSWORD",
        description="Password for admin UI access (required, no default)"
    )
    admin_secret_key: str = Field(
        ...,
        alias="ADMIN_SECRET_KEY",
        description="Secret key for signing admin session cookies (required, min 32 chars)"
    )

    # Stripe Configuration
    stripe_secret_key: str = Field(
        default="",
        alias="STRIPE_SECRET_KEY",
        description="Stripe secret key for subscription management"
    )
    stripe_webhook_secret: str = Field(
        default="",
        alias="STRIPE_WEBHOOK_SECRET",
        description="Stripe webhook signing secret for verifying webhook events"
    )

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        case_sensitive = False


# Global settings instance
settings = Settings()
