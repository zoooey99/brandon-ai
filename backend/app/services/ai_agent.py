"""
AI Agent Service for Brandon Backend.
Handles LLM integration for generating coaching responses and daily messages.
Uses LiteLLM for provider-agnostic model switching with automatic parameter handling.
"""

import litellm
from typing import List, Dict, Optional
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
import logging
import time
import os

from app.config import settings
from app.db.models import AIContext
from app.prompts.loader import safe_format

logger = logging.getLogger(__name__)

# Configure LiteLLM
litellm.drop_params = True  # Auto-drop unsupported params (e.g., temperature for GPT-5)

# Set up Helicone callback if configured
# LiteLLM reads HELICONE_API_KEY from environment
if settings.helicone_api_key:
    os.environ["HELICONE_API_KEY"] = settings.helicone_api_key
    litellm.success_callback = ["helicone"]
    litellm.failure_callback = ["helicone"]
    logger.info("Helicone observability enabled via LiteLLM callbacks")


class AIAgent:
    """
    AI agent for generating personalized fitness coaching messages.
    Uses LiteLLM for provider-agnostic model switching.
    """

    def __init__(self):
        self.default_model = settings.openai_model
        logger.info(f"AIAgent initialized with default model: {self.default_model}")

    async def generate_response(
        self,
        prompt_template: str,
        context: AIContext,
        model: Optional[str] = None
    ) -> str:
        """
        Generate a coaching response using AI with proper messages array format.

        Uses system message for instructions/context and messages array for
        conversation history, which is the optimal format for chat models.

        Args:
            prompt_template: Prompt template with placeholders
            context: AI context with user data and conversation history
            model: Optional model override (from prompt config in database)

        Returns:
            Generated response text

        Raises:
            AIAgentError: If generation fails
        """
        try:
            # Build system message (instructions + user profile + workout info)
            system_message = self._build_system_message(prompt_template, context)

            # Build messages array from conversation history
            messages = self._build_messages_array(system_message, context)

            # Use specified model or default
            use_model = model or self.default_model

            logger.info(f"🤖 Generating AI response for user: {context.user_name}")
            logger.info(f"   Model: {use_model}")
            logger.info(f"   Messages: {len(messages)} (1 system + {len(messages) - 1} conversation)")

            start_time = time.time()

            # Build metadata for Helicone tracking
            metadata = {}
            if settings.helicone_api_key:
                metadata = {
                    "Helicone-User-Id": context.user_id,
                    "Helicone-Property-UserName": context.user_name,
                    "Helicone-Property-MessageType": "response",
                }

            # Call LLM via LiteLLM (handles model-specific params automatically)
            response = await litellm.acompletion(
                model=use_model,
                messages=messages,
                metadata=metadata if metadata else None,
                api_key=settings.openai_api_key,
            )

            latency_ms = (time.time() - start_time) * 1000

            # Extract response
            message_content = response.choices[0].message.content.strip()

            # Log response details
            usage = response.usage
            logger.info(f"✅ AI Response generated:")
            logger.info(f"   Response length: {len(message_content)} chars")
            logger.info(f"   Tokens - prompt: {usage.prompt_tokens}, completion: {usage.completion_tokens}, total: {usage.total_tokens}")
            logger.info(f"   Latency: {latency_ms:.0f}ms")
            logger.debug(f"   Response text: {message_content}")

            return message_content

        except Exception as e:
            logger.error(f"❌ Error generating AI response: {e}", exc_info=True)
            raise AIAgentError(f"Failed to generate response: {e}")

    def _build_system_message(self, template: str, context: AIContext) -> str:
        """
        Build system message from template with user profile and workout info.
        Excludes conversation history (that goes in messages array).

        Args:
            template: Prompt template with placeholders
            context: AI context

        Returns:
            System message string
        """
        # Get user's timezone
        try:
            user_tz = ZoneInfo(context.timezone)
        except Exception:
            user_tz = ZoneInfo("America/Chicago")

        # Get current datetime
        now_local = datetime.now(user_tz)
        current_datetime = now_local.strftime("%A, %B %d, %Y at %I:%M %p")

        # Format workout info
        workout_summary = self._summarize_workout(context.workout_today) if context.workout_today else "No workout scheduled"
        workout_history = self._summarize_workout_history(context.workout_history)
        full_workout_plan = self._summarize_full_plan(context.full_workout_plan)
        workout_performance_history = self._summarize_workout_performance(context.workout_performance_history)

        # Fill template, using placeholder for conversation (will be in messages array)
        system_prompt = safe_format(template, {
            "user_name": context.user_name,
            "phone_number": context.phone_number,
            "goal": context.goal,
            "experience": context.experience or "beginner",
            "equipment": ", ".join(context.equipment) if context.equipment else "no equipment",
            "split": context.split or "full body",
            "workout_today": workout_summary,
            "recent_messages": "[See conversation history in messages array]",
            "incoming_message": "[See latest message in messages array]",
            "workout_history": workout_history,
            "full_workout_plan": full_workout_plan,
            "workout_performance_history": workout_performance_history,
            "current_datetime": current_datetime,
        })

        logger.debug(f"📄 System message ({len(system_prompt)} chars)")
        return system_prompt

    def _build_messages_array(self, system_message: str, context: AIContext) -> List[Dict]:
        """
        Build messages array with proper role assignments.

        Format:
        - system: Instructions + user profile + workout info
        - assistant/user: Conversation history (consecutive same-role messages combined)
        - user: Current incoming message

        Args:
            system_message: The system prompt
            context: AI context with conversation history

        Returns:
            List of message dicts with role and content
        """
        messages = [{"role": "system", "content": system_message}]

        # Add conversation history with proper roles
        # Combine consecutive messages from same sender for better model compatibility
        if context.recent_messages:
            current_role = None
            current_content = []

            for msg in context.recent_messages:
                role = "user" if msg.get("direction") == "inbound" else "assistant"

                if role == current_role:
                    # Same sender, combine messages
                    current_content.append(msg.get("content", ""))
                else:
                    # New sender, flush previous messages
                    if current_role and current_content:
                        messages.append({
                            "role": current_role,
                            "content": "\n\n".join(current_content)
                        })
                    current_role = role
                    current_content = [msg.get("content", "")]

            # Flush remaining messages
            if current_role and current_content:
                messages.append({
                    "role": current_role,
                    "content": "\n\n".join(current_content)
                })

        # Add current incoming message as final user message
        if context.incoming_message:
            # If last message was also from user, combine them
            if messages[-1]["role"] == "user":
                messages[-1]["content"] += f"\n\n{context.incoming_message}"
            else:
                messages.append({"role": "user", "content": context.incoming_message})

        logger.debug(f"📨 Built messages array: {len(messages)} messages")
        return messages

    async def generate_daily_message(
        self,
        prompt_template: str,
        user_name: str,
        workout_today: Optional[Dict],
        goal: str,
        recent_activity: Optional[str] = None,
        user_id: Optional[str] = None,
        model: Optional[str] = None
    ) -> str:
        """
        Generate a daily workout reminder message.

        Args:
            prompt_template: Prompt template for daily messages
            user_name: User's name
            workout_today: Today's workout data
            goal: User's fitness goal
            recent_activity: Recent workout activity summary
            user_id: Optional user ID for Helicone tracking
            model: Optional model override

        Returns:
            Generated daily message

        Raises:
            AIAgentError: If generation fails
        """
        try:
            # Build context
            workout_summary = self._summarize_workout(workout_today) if workout_today else "rest day"

            prompt = safe_format(prompt_template, {
                "user_name": user_name,
                "workout_today": workout_summary,
                "goal": goal,
                "recent_activity": recent_activity or "No recent activity",
            })

            use_model = model or self.default_model
            logger.info(f"🤖 Generating daily message for: {user_name} (model: {use_model})")

            # Build metadata for Helicone
            metadata = {}
            if settings.helicone_api_key:
                metadata = {
                    "Helicone-User-Id": user_id or "unknown",
                    "Helicone-Property-UserName": user_name,
                    "Helicone-Property-MessageType": "daily_reminder",
                }

            response = await litellm.acompletion(
                model=use_model,
                messages=[{"role": "user", "content": prompt}],
                metadata=metadata if metadata else None,
                api_key=settings.openai_api_key,
            )

            message_content = response.choices[0].message.content.strip()

            logger.info(f"✅ Generated daily message")
            return message_content

        except Exception as e:
            logger.error(f"❌ Error generating daily message: {e}", exc_info=True)
            raise AIAgentError(f"Failed to generate daily message: {e}")

    async def extract_workout_from_image(
        self,
        base64_image: str,
        prompt_template: str,
        model: Optional[str] = None
    ) -> Dict:
        """
        Extract workout plan from an image using vision model.

        Args:
            base64_image: Base64 encoded image (may include data URL prefix)
            prompt_template: Prompt template for extraction
            model: Vision-capable model (e.g., gpt-4o)

        Returns:
            Dict with:
                - is_workout: bool
                - confidence: float (0.0-1.0)
                - workout_type: str or None
                - extracted_text: str or None
                - rejection_reason: str or None

        Raises:
            AIAgentError: If extraction fails
        """
        import json

        try:
            # Parse data URL to extract MIME type and base64 data
            mime_type = "image/jpeg"  # default
            image_data = base64_image

            if base64_image.startswith("data:"):
                # Format: data:image/png;base64,XXXXXX
                header, image_data = base64_image.split(",", 1)
                if "image/" in header:
                    mime_type = header.split(";")[0].replace("data:", "")

            use_model = model or "gpt-4o"
            logger.info(f"🖼️ Extracting workout from image (model: {use_model}, type: {mime_type})")

            start_time = time.time()

            # Build metadata for Helicone
            metadata = {}
            if settings.helicone_api_key:
                metadata = {
                    "Helicone-Property-MessageType": "workout_image_extraction",
                }

            # Build vision message
            messages = [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": prompt_template
                        },
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:{mime_type};base64,{image_data}",
                                "detail": "high"
                            }
                        }
                    ]
                }
            ]

            response = await litellm.acompletion(
                model=use_model,
                messages=messages,
                metadata=metadata if metadata else None,
                api_key=settings.openai_api_key,
                response_format={"type": "json_object"}
            )

            latency_ms = (time.time() - start_time) * 1000
            message_content = response.choices[0].message.content.strip()

            usage = response.usage
            logger.info(f"✅ Image extraction completed in {latency_ms:.0f}ms, tokens: {usage.total_tokens}")

            # Parse JSON response
            try:
                result = json.loads(message_content)
            except json.JSONDecodeError:
                logger.error(f"Invalid JSON from vision model: {message_content[:200]}")
                return {
                    "is_workout": False,
                    "confidence": 0.0,
                    "workout_type": None,
                    "extracted_text": None,
                    "rejection_reason": "invalid_response"
                }

            # Ensure all expected fields exist
            return {
                "is_workout": result.get("is_workout", False),
                "confidence": float(result.get("confidence", 0.0)),
                "workout_type": result.get("workout_type"),
                "extracted_text": result.get("extracted_text"),
                "rejection_reason": result.get("rejection_reason")
            }

        except Exception as e:
            logger.error(f"❌ Error extracting workout from image: {e}", exc_info=True)
            # Return a safe failure response instead of raising
            return {
                "is_workout": False,
                "confidence": 0.0,
                "workout_type": None,
                "extracted_text": None,
                "rejection_reason": f"extraction_error: {str(e)}"
            }

    def _build_user_profile(self, profile: Dict, notes_value: str, plan_mode: str = "scratch") -> str:
        """Build the user profile block for prompt templates.

        For 'existing' mode, omits equipment/split/workoutDays since those
        weren't collected and should be derived from the uploaded plan.
        """
        profile_lines = [
            f"- Name: {profile.get('name', 'there')}",
            f"- Age: {profile.get('age') or 'not specified'}",
            f"- Sex: {profile.get('sex') or 'not specified'}",
            f"- Goal: {profile.get('goal', 'general fitness')}",
            f"- Experience Level: {profile.get('experience') or 'beginner'}",
        ]
        if plan_mode != "existing":
            profile_lines.extend([
                f"- Available Equipment: {', '.join(profile.get('equipment', [])) or 'no equipment'}",
                f"- Preferred Split: {profile.get('split') or 'flexible'}",
                f"- Workout Days: {', '.join(profile.get('workoutDays', [])) or 'flexible'}",
            ])
        profile_lines.append(f"- Additional Notes: {notes_value}")
        return "\n".join(profile_lines)

    async def generate_plan(
        self,
        prompt_template: str,
        profile: Dict,
        model: Optional[str] = None,
        user_id: Optional[str] = None,
        plan_mode_instructions: str = "",
        plan_mode: str = "scratch"
    ) -> str:
        """
        Generate a workout plan using AI.

        Args:
            prompt_template: Prompt template with profile placeholders
            profile: User profile dict with name, age, sex, goal, etc.
            model: Optional model override (from prompt config)
            user_id: Optional user ID for tracking
            plan_mode_instructions: Mode-specific instruction text
            plan_mode: "scratch" or "existing"

        Returns:
            Generated plan JSON string

        Raises:
            AIAgentError: If generation fails
        """
        try:
            # Debug: Log notes being injected
            notes_value = profile.get("notes") or "none"
            logger.info(f"AI Agent generate_plan - notes being injected: '{notes_value}'")

            # Build profile section — omit equipment/split/days for "existing" mode
            user_profile = self._build_user_profile(profile, notes_value, plan_mode)

            # Fill template with profile data
            prompt = safe_format(prompt_template, {
                "user_profile": user_profile,
                "plan_mode_instructions": plan_mode_instructions,
            })

            use_model = model or self.default_model
            logger.info(f"🏋️ Generating workout plan for: {profile.get('name')} (model: {use_model})")

            start_time = time.time()

            # Build metadata for Helicone
            metadata = {}
            if settings.helicone_api_key:
                metadata = {
                    "Helicone-User-Id": user_id or "anonymous",
                    "Helicone-Property-MessageType": "plan_generation",
                }

            response = await litellm.acompletion(
                model=use_model,
                messages=[{"role": "user", "content": prompt}],
                metadata=metadata if metadata else None,
                api_key=settings.openai_api_key,
                response_format={"type": "json_object"}
            )

            latency_ms = (time.time() - start_time) * 1000
            message_content = response.choices[0].message.content.strip()

            usage = response.usage
            logger.info(f"✅ Plan generated in {latency_ms:.0f}ms, tokens: {usage.total_tokens}")

            return message_content

        except Exception as e:
            logger.error(f"❌ Error generating plan: {e}", exc_info=True)
            raise AIAgentError(f"Failed to generate plan: {e}")

    async def generate_chat_response(
        self,
        prompt_template: str,
        profile: Dict,
        current_plan: Dict,
        user_message: str,
        conversation_history: List[Dict],
        preferences: Optional[Dict] = None,
        model: Optional[str] = None,
        user_id: Optional[str] = None
    ) -> str:
        """
        Generate a coach chat response, potentially with plan modifications.

        Args:
            prompt_template: Prompt template with placeholders
            profile: User profile dict
            current_plan: Current workout plan dict
            user_message: User's message
            conversation_history: List of prior messages
            preferences: User display preferences
            model: Optional model override
            user_id: Optional user ID for tracking

        Returns:
            Generated response text (may include JSON plan at end)

        Raises:
            AIAgentError: If generation fails
        """
        try:
            import json

            # Format conversation history
            history_str = "\n".join([
                f"{'User' if msg.get('sender') == 'user' else 'Coach'}: {msg.get('text', '')}"
                for msg in conversation_history[-10:]
            ]) or "No previous messages"

            # Format current plan
            plan_str = json.dumps(current_plan, indent=2)

            # Build preference instructions
            pref_parts = []
            if preferences:
                if preferences.get("includeWarmup"):
                    pref_parts.append("Include warm-up exercises")
                if preferences.get("includeMobility"):
                    pref_parts.append("Include mobility/stretching")
            preference_instructions = f"\nUser prefers: {', '.join(pref_parts)}" if pref_parts else ""

            # Debug: Log notes being injected
            notes_value = profile.get("notes") or "none"
            logger.info(f"AI Agent generate_chat - notes being injected: '{notes_value}'")

            # Build profile section (always include all fields for chat)
            user_profile = self._build_user_profile(profile, notes_value, plan_mode="scratch")

            # Fill template
            prompt = safe_format(prompt_template, {
                "user_profile": user_profile,
                "current_plan": plan_str,
                "include_warmup": "Yes" if preferences and preferences.get("includeWarmup") else "No",
                "include_mobility": "Yes" if preferences and preferences.get("includeMobility") else "No",
                "conversation_history": history_str,
                "user_message": user_message,
            })

            use_model = model or self.default_model
            logger.info(f"💬 Generating chat response for: {profile.get('name')} (model: {use_model})")

            start_time = time.time()

            # Build metadata for Helicone
            metadata = {}
            if settings.helicone_api_key:
                metadata = {
                    "Helicone-User-Id": user_id or "anonymous",
                    "Helicone-Property-MessageType": "plan_chat",
                }

            response = await litellm.acompletion(
                model=use_model,
                messages=[{"role": "user", "content": prompt}],
                metadata=metadata if metadata else None,
                api_key=settings.openai_api_key,
                response_format={"type": "json_object"}
            )

            latency_ms = (time.time() - start_time) * 1000
            message_content = response.choices[0].message.content.strip()

            usage = response.usage
            logger.info(f"✅ Chat response generated in {latency_ms:.0f}ms, tokens: {usage.total_tokens}")

            return message_content

        except Exception as e:
            logger.error(f"❌ Error generating chat response: {e}", exc_info=True)
            raise AIAgentError(f"Failed to generate chat response: {e}")

    def _summarize_workout(self, workout_data: Optional[Dict]) -> str:
        """
        Summarize workout data into readable format with exercises, sets, and reps.

        Args:
            workout_data: Workout data dict

        Returns:
            Workout summary string
        """
        if not workout_data:
            return "Rest day - no workout scheduled"

        try:
            # Handle workout structure with exercises
            if isinstance(workout_data, dict):
                parts = []

                # Add focus/day info
                if "focus" in workout_data:
                    parts.append(f"Focus: {workout_data['focus']}")
                if "day" in workout_data:
                    parts.append(f"Day: {workout_data['day']}")
                if "duration" in workout_data:
                    parts.append(f"Duration: {workout_data['duration']}")

                # Add exercises with sets and reps
                if "exercises" in workout_data:
                    exercises = workout_data.get("exercises", [])
                    exercise_list = []
                    for ex in exercises:
                        name = ex.get("name", "Exercise")
                        sets = ex.get("sets", "?")
                        reps = ex.get("reps", "?")
                        exercise_list.append(f"- {name}: {sets} sets x {reps} reps")

                    if exercise_list:
                        parts.append("Exercises:\n" + "\n".join(exercise_list))

                if parts:
                    return "\n".join(parts)

                # Fallback if structure is different
                if "focus" in workout_data:
                    return f"{workout_data['focus']} workout"

            return "Workout scheduled"

        except Exception as e:
            logger.warning(f"Error summarizing workout: {e}")
            return "Workout scheduled"

    def _summarize_workout_history(self, history: Optional[List[Dict]]) -> str:
        """
        Format recent workout history (last 7 days) with status.

        Args:
            history: List of workout session dicts from get_recent_workout_history()

        Returns:
            Formatted workout history string
        """
        if not history:
            return "No recent workout history"

        try:
            lines = ["Recent Workouts (Last 7 Days):"]

            for session in history:
                date_str = session.get("date", "Unknown date")
                # Parse date if it's a full datetime string
                if "T" in str(date_str):
                    date_str = date_str.split("T")[0]

                day_name = session.get("day_name", "")
                focus = session.get("focus", "Workout")
                status = session.get("status", "pending")

                # Determine status display
                if status == "completed":
                    status_text = "Completed"
                else:
                    status_text = "Not Completed"

                lines.append(f"- {date_str} ({day_name}): {focus} - {status_text}")

                # Only show exercise details for completed workouts
                if status == "completed" and session.get("exercises"):
                    for exercise in session["exercises"]:
                        name = exercise.get("name", "Exercise")
                        sets = exercise.get("sets", [])
                        if sets:
                            set_details = ", ".join([
                                f"{s.get('weight', '?')} lbs x {s.get('reps', '?')}"
                                for s in sets
                            ])
                            lines.append(f"  • {name}: {set_details}")

            return "\n".join(lines)

        except Exception as e:
            logger.warning(f"Error summarizing workout history: {e}")
            return "No recent workout history"

    def _summarize_full_plan(self, workouts: Optional[List[Dict]]) -> str:
        """
        Format full workout plan for prompt injection.

        Args:
            workouts: List of workout dicts from plan_data.workouts

        Returns:
            Formatted workout plan string
        """
        if not workouts:
            return "No workout plan"

        try:
            lines = ["Weekly Workout Plan:"]

            for workout in workouts:
                day = workout.get("day", "Unknown day")
                focus = workout.get("focus", "")
                exercises = workout.get("exercises", [])
                duration = workout.get("duration", "")

                if exercises:
                    exercise_names = [ex.get("name", "Exercise") for ex in exercises]
                    lines.append(f"- {day}: {focus}")
                    lines.append(f"  Exercises: {', '.join(exercise_names)}")
                elif duration:
                    # Cardio day with duration instead of exercises
                    lines.append(f"- {day}: {focus} ({duration})")
                else:
                    lines.append(f"- {day}: {focus}")

            return "\n".join(lines)

        except Exception as e:
            logger.warning(f"Error summarizing full plan: {e}")
            return "No workout plan"

    def _summarize_workout_performance(self, performance: Optional[List[Dict]]) -> str:
        """
        Format last 4 sessions of today's specific workout.

        Args:
            performance: List of workout session dicts from get_workout_performance_history()

        Returns:
            Formatted performance history string
        """
        if not performance:
            return "No previous sessions for this workout"

        try:
            # Get the day_name and focus from the first session
            first_session = performance[0]
            day_name = first_session.get("day_name", "Unknown")
            focus = first_session.get("focus", "Workout")

            lines = [f'Previous "{day_name}: {focus}" Sessions:']

            for session in performance:
                date_str = session.get("date", "Unknown date")
                # Parse date if it's a full datetime string
                if "T" in str(date_str):
                    date_str = date_str.split("T")[0]

                status = session.get("status", "pending")

                if status == "completed":
                    lines.append(f"- {date_str}: Completed")
                    # Show exercise details for completed workouts
                    if session.get("exercises"):
                        for exercise in session["exercises"]:
                            name = exercise.get("name", "Exercise")
                            sets = exercise.get("sets", [])
                            if sets:
                                set_details = ", ".join([
                                    f"{s.get('weight', '?')} lbs x {s.get('reps', '?')}"
                                    for s in sets
                                ])
                                lines.append(f"  • {name}: {set_details}")
                else:
                    lines.append(f"- {date_str}: Not Completed")

            return "\n".join(lines)

        except Exception as e:
            logger.warning(f"Error summarizing workout performance: {e}")
            return "No previous sessions for this workout"


class AIAgentError(Exception):
    """Exception raised when AI agent operations fail."""
    pass


# Singleton instance
_ai_agent = None


def get_ai_agent() -> AIAgent:
    """
    Get or create AI agent instance.

    Returns:
        AIAgent instance
    """
    global _ai_agent
    if _ai_agent is None:
        _ai_agent = AIAgent()
    return _ai_agent
