"""
Pydantic models for plan generation and coach chat endpoints.
"""

from pydantic import BaseModel, Field
from typing import Optional, List, Literal


# ============================================================================
# Common Models - Workout Structure
# ============================================================================

class Exercise(BaseModel):
    """Exercise in a workout."""
    name: str
    sets: Optional[int] = None
    reps: Optional[str] = None
    duration: Optional[str] = None
    details: Optional[List[str]] = None


class WarmUpExercise(BaseModel):
    """Warm-up exercise."""
    name: str
    duration: Optional[str] = None
    sets: Optional[int] = None
    reps: Optional[str] = None


class MobilityExercise(BaseModel):
    """Mobility/stretching exercise."""
    name: str
    duration: Optional[str] = None


class Workout(BaseModel):
    """Single workout day."""
    day: str
    focus: str
    duration: Optional[str] = None
    warmUp: Optional[List[WarmUpExercise]] = None
    mobility: Optional[List[MobilityExercise]] = None
    exercises: List[Exercise]


class GeneratedPlan(BaseModel):
    """Complete generated workout plan."""
    weeklyVolume: Optional[str] = None
    workouts: List[Workout]


# ============================================================================
# /generate-plan Endpoint
# ============================================================================

class ProfileInput(BaseModel):
    """User profile for plan generation."""
    name: str
    age: Optional[int] = None
    sex: Optional[str] = None
    goal: str
    experience: Optional[str] = None
    equipment: List[str] = Field(default_factory=list)
    split: Optional[str] = None
    workoutDays: List[str] = Field(default_factory=list)
    notes: Optional[str] = None


class GeneratePlanRequest(BaseModel):
    """Request body for /generate-plan."""
    profile: ProfileInput
    workoutImage: Optional[str] = None  # Base64 encoded image (data:image/xxx;base64,...)
    useExactPlan: bool = False  # If True, copy uploaded workout exactly (ignore equipment)
    planMode: Optional[str] = None  # "existing" | "scratch"


class GeneratePlanResponse(BaseModel):
    """Response from /generate-plan."""
    plan: GeneratedPlan
    imageProcessed: Optional[bool] = None  # True if workout image was successfully extracted
    coachNotes: Optional[str] = None  # AI's intro message for the coach chat


# ============================================================================
# /coach-chat Endpoint
# ============================================================================

class ChatMessage(BaseModel):
    """Single message in conversation history."""
    sender: Literal["ai", "user"]
    text: str


class ChatPreferences(BaseModel):
    """User preferences for plan display."""
    includeWarmup: bool = True
    includeMobility: bool = True


class CoachChatRequest(BaseModel):
    """Request body for /coach-chat."""
    message: str
    currentPlan: GeneratedPlan
    profile: ProfileInput
    conversationHistory: List[ChatMessage] = Field(default_factory=list)
    preferences: Optional[ChatPreferences] = None


class CoachChatResponse(BaseModel):
    """Response from /coach-chat."""
    response: str
    updatedPlan: Optional[GeneratedPlan] = None
    error: Optional[bool] = None
