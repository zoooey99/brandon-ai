"""
Pydantic models for Brandon Backend.
Defines data structures for API requests/responses and database records.
"""

from pydantic import BaseModel, Field
from typing import Optional, List, Literal
from datetime import datetime


# ============================================================================
# Message Models
# ============================================================================

class InboundMessage(BaseModel):
    """Single message from user (from Mac server webhook)."""
    text: str
    timestamp: str


class WebhookRequest(BaseModel):
    """Webhook payload from Mac server."""
    phone_number: str
    messages: List[InboundMessage]


class OutboundMessageChunk(BaseModel):
    """Single message chunk to send to user."""
    text: str
    delay_after_previous: Optional[float] = 0.7
    attachment_path: Optional[str] = None


class WebhookResponse(BaseModel):
    """Response to Mac server (either message or no_reply)."""
    reply_type: Literal["message", "no_reply"]
    phone_number: str
    messages: Optional[List[OutboundMessageChunk]] = None
    delay_before_typing: float = 2.0
    typing_duration: float = 3.0


# ============================================================================
# Database Models
# ============================================================================

class Message(BaseModel):
    """Database model for messages table."""
    id: Optional[int] = None
    user_id: str
    phone_number: str
    direction: Literal["inbound", "outbound"]
    content: str
    metadata: dict = Field(default_factory=dict)
    created_at: Optional[datetime] = None


class ConversationContext(BaseModel):
    """Database model for conversation_context table."""
    id: Optional[int] = None
    user_id: str
    context_data: dict = Field(default_factory=dict)
    last_updated: Optional[datetime] = None


class ScheduledMessage(BaseModel):
    """Database model for scheduled_messages table."""
    id: Optional[int] = None
    user_id: str
    phone_number: str
    scheduled_time: datetime
    message_content: Optional[str] = None
    status: Literal["pending", "sent", "failed"] = "pending"
    sent_at: Optional[datetime] = None
    error_message: Optional[str] = None
    created_at: Optional[datetime] = None


class AgentPrompt(BaseModel):
    """Database model for agent_prompts table."""
    id: Optional[int] = None
    name: str
    prompt_text: str
    version: int = 1
    is_active: bool = True
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


# ============================================================================
# User Models
# ============================================================================

class UserProfile(BaseModel):
    """User profile data from Supabase."""
    id: int
    user_id: str
    name: str
    phone: Optional[str] = None
    phone_verified: bool = False
    age: Optional[int] = None
    sex: Optional[str] = None
    goal: str
    consistency: Optional[str] = None
    experience: Optional[str] = None
    equipment: Optional[List[str]] = None
    split: Optional[str] = None
    workout_days: Optional[List[str]] = None
    start_date: Optional[datetime] = None
    preferred_text_time: Optional[str] = None
    timezone: Optional[str] = "America/Chicago"
    created_at: Optional[datetime] = None


class User(BaseModel):
    """User data from Supabase."""
    id: str
    email: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    profile_image_url: Optional[str] = None
    stripe_customer_id: Optional[str] = None
    stripe_subscription_id: Optional[str] = None
    subscription_status: Optional[str] = None
    signup_stage: Optional[str] = None
    draft_onboarding_data: Optional[dict] = None
    is_test_user: bool = False
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class WorkoutPlan(BaseModel):
    """Workout plan data from Supabase."""
    id: int
    user_id: str
    profile_id: Optional[int] = None
    plan_data: dict
    status: str = "active"
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


# ============================================================================
# Service Models
# ============================================================================

class AIContext(BaseModel):
    """Context data passed to AI agent."""
    user_id: str
    user_name: str
    phone_number: str
    goal: str
    experience: Optional[str]
    equipment: Optional[List[str]]
    split: Optional[str]
    workout_today: Optional[dict]
    recent_messages: List[dict]
    incoming_message: str
    timezone: str = "America/Chicago"  # User's timezone for datetime formatting
    # New context fields for richer AI responses
    workout_history: Optional[List[dict]] = None  # Last 7 days of workouts
    full_workout_plan: Optional[List[dict]] = None  # All days in the plan
    workout_performance_history: Optional[List[dict]] = None  # Last 4 of today's workout


class ValidationResult(BaseModel):
    """Result of user validation."""
    is_valid: bool
    user_id: Optional[str] = None
    user: Optional[User] = None
    profile: Optional[UserProfile] = None
    error_message: Optional[str] = None
