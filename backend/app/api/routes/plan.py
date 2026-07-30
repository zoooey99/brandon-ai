"""
Plan generation and coach chat endpoints for Brandon Backend.
Provides AI-powered workout plan generation and interactive plan modification.
"""

from fastapi import APIRouter, Depends, HTTPException, Header
from typing import Optional
import logging
import json
import hmac

from app.config import settings
from app.api.schemas.plan_schemas import (
    GeneratePlanRequest, GeneratePlanResponse,
    CoachChatRequest, CoachChatResponse,
    GeneratedPlan
)
from app.services.ai_agent import get_ai_agent, AIAgentError
from app.prompts.loader import get_prompt, get_prompt_with_model

logger = logging.getLogger(__name__)

router = APIRouter()


async def verify_api_key(
    authorization: Optional[str] = Header(None, alias="Authorization")
) -> bool:
    """
    Verify API key from Authorization header.

    Expects header: Authorization: Bearer <api_key>

    Raises:
        HTTPException 401 if key is missing or invalid
    """
    if not settings.frontend_apikey:
        logger.warning("FRONTEND_APIKEY not configured - rejecting request")
        raise HTTPException(
            status_code=500,
            detail="Frontend API not configured"
        )

    if not authorization:
        raise HTTPException(
            status_code=401,
            detail="Missing Authorization header"
        )

    # Extract token from "Bearer <token>"
    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(
            status_code=401,
            detail="Invalid Authorization header format. Expected: Bearer <api_key>"
        )

    token = parts[1]

    if not hmac.compare_digest(token, settings.frontend_apikey):
        raise HTTPException(
            status_code=401,
            detail="Invalid API key"
        )

    return True


@router.post("/generate-plan", response_model=GeneratePlanResponse)
async def generate_plan(
    request: GeneratePlanRequest,
    _: bool = Depends(verify_api_key)
):
    """
    Generate a personalized workout plan based on user profile.

    Optionally accepts a workout image to extract user's existing routine.
    If useExactPlan is True, the extracted workout is copied exactly
    (equipment constraints are ignored).

    Requires: Authorization header with API key.

    Args:
        request: GeneratePlanRequest with user profile, optional workoutImage, and useExactPlan flag

    Returns:
        GeneratePlanResponse with generated workout plan, imageProcessed flag, and coachNotes
    """
    profile = request.profile.model_dump()
    image_processed = None  # None = no image provided, True/False = processed result
    use_exact_plan = request.useExactPlan

    logger.info(f"Generating plan for: {profile.get('name')} (useExactPlan={use_exact_plan})")
    logger.info(f"Generate plan - notes received: '{profile.get('notes')}'")

    try:
        ai_agent = get_ai_agent()

        # Process workout image if provided
        if request.workoutImage:
            logger.info("Workout image provided, attempting extraction...")
            try:
                # Load extraction prompt and model
                extraction_prompt, extraction_model = get_prompt_with_model("workout_image_extractor")

                extraction_result = await ai_agent.extract_workout_from_image(
                    base64_image=request.workoutImage,
                    prompt_template=extraction_prompt,
                    model=extraction_model
                )

                # Check if extraction was successful (confidence >= 0.7)
                if extraction_result["is_workout"] and extraction_result["confidence"] >= 0.7:
                    extracted_text = extraction_result["extracted_text"]
                    if extracted_text:
                        existing_notes = profile.get("notes") or ""

                        if use_exact_plan:
                            # Copy exactly mode: remove equipment constraints, copy workout verbatim
                            profile["equipment"] = []  # Clear equipment so AI doesn't filter exercises
                            workout_context = f"""
--- COPY THIS WORKOUT EXACTLY ---
Replicate the workout below exactly as written. Use the SAME exercises, sets, and reps.
Do NOT substitute or modify exercises based on equipment. Copy it verbatim.
Add form cues and details for each exercise, but keep the structure identical.

{extracted_text}
--- END OF WORKOUT TO COPY ---
"""
                        else:
                            # Inspiration mode: adapt to user's equipment and experience
                            workout_context = f"""
--- USER'S EXISTING WORKOUT (use as inspiration) ---
The user has shared their current workout routine. Use this as a starting point
when creating their personalized plan. You may adapt exercises to match their
available equipment, adjust volumes for their experience level, or suggest
improvements while respecting their general structure and preferences.

{extracted_text}
--- END OF EXISTING WORKOUT ---
"""
                        profile["notes"] = f"{existing_notes}\n\n{workout_context}".strip() if existing_notes else workout_context.strip()
                        image_processed = True
                        logger.info(f"✅ Workout extracted successfully (confidence: {extraction_result['confidence']:.2f}, type: {extraction_result['workout_type']}, exact={use_exact_plan})")
                else:
                    image_processed = False
                    logger.info(f"⚠️ Image not processed: is_workout={extraction_result['is_workout']}, confidence={extraction_result['confidence']:.2f}, reason={extraction_result.get('rejection_reason')}")

            except ValueError as e:
                # Prompt not found in database
                logger.warning(f"workout_image_extractor prompt not configured: {e}")
                image_processed = False
            except Exception as e:
                logger.error(f"Error processing workout image: {e}", exc_info=True)
                image_processed = False

        # Load prompt and model configuration for plan generation
        prompt_template, model = get_prompt_with_model("plan_generator")

        # Load mode-specific instructions based on planMode
        plan_mode = request.planMode or "scratch"  # default to scratch if not specified
        plan_mode_instructions = ""
        mode_prompt_name = f"plan_mode_{plan_mode}"
        try:
            plan_mode_instructions = get_prompt(mode_prompt_name)
            logger.info(f"Loaded plan mode instructions: {mode_prompt_name} ({len(plan_mode_instructions)} chars)")
        except ValueError:
            logger.warning(f"Plan mode prompt '{mode_prompt_name}' not found, using empty instructions")

        # Generate plan using AI
        response_text = await ai_agent.generate_plan(
            prompt_template=prompt_template,
            profile=profile,
            model=model,
            plan_mode_instructions=plan_mode_instructions,
            plan_mode=plan_mode,
        )

        # Parse JSON response
        try:
            plan_data = json.loads(response_text)
        except json.JSONDecodeError as e:
            logger.error(f"Invalid JSON from AI: {response_text[:500]}")
            raise HTTPException(
                status_code=500,
                detail="AI generated invalid plan format"
            )

        # Extract coachNotes if present (new format)
        coach_notes = None
        if "coachNotes" in plan_data:
            coach_notes = plan_data.pop("coachNotes")

        # Handle if AI wrapped response in {"plan": {...}}
        if "plan" in plan_data and "workouts" not in plan_data:
            plan_data = plan_data["plan"]

        # Validate and return
        plan = GeneratedPlan(**plan_data)

        logger.info(f"Successfully generated plan with {len(plan.workouts)} workouts")

        return GeneratePlanResponse(plan=plan, imageProcessed=image_processed, coachNotes=coach_notes)

    except AIAgentError as e:
        logger.error(f"AI error generating plan: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error generating plan: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to generate plan")


@router.post("/coach-chat", response_model=CoachChatResponse)
async def coach_chat(
    request: CoachChatRequest,
    _: bool = Depends(verify_api_key)
):
    """
    Chat with the AI coach to modify workout plan.

    Requires: Authorization header with API key.

    Args:
        request: CoachChatRequest with message, current plan, and context

    Returns:
        CoachChatResponse with AI response and optionally updated plan
    """
    logger.info(f"Coach chat: {request.message[:50]}...")

    try:
        # Load prompt and model configuration
        prompt_template, model = get_prompt_with_model("plan_chat")

        # Prepare data
        profile = request.profile.model_dump()
        logger.info(f"Coach chat - notes received: '{profile.get('notes')}'")
        current_plan = request.currentPlan.model_dump()
        conversation_history = [msg.model_dump() for msg in request.conversationHistory]
        preferences = request.preferences.model_dump() if request.preferences else None

        # Generate response
        ai_agent = get_ai_agent()
        response_text = await ai_agent.generate_chat_response(
            prompt_template=prompt_template,
            profile=profile,
            current_plan=current_plan,
            user_message=request.message,
            conversation_history=conversation_history,
            preferences=preferences,
            model=model
        )

        # Parse structured JSON response
        updated_plan = None
        response_message = response_text

        try:
            response_json = json.loads(response_text)
            response_message = response_json.get("response", response_text)

            if "updatedPlan" in response_json and response_json["updatedPlan"]:
                updated_plan = GeneratedPlan(**response_json["updatedPlan"])
                logger.info(f"Successfully parsed updatedPlan from response")
        except json.JSONDecodeError as e:
            logger.warning(f"Response was not valid JSON, using as plain text: {e}")
        except Exception as e:
            logger.warning(f"Could not parse updatedPlan: {e}")

        logger.info(f"Chat response generated, plan updated: {updated_plan is not None}")

        return CoachChatResponse(
            response=response_message,
            updatedPlan=updated_plan
        )

    except AIAgentError as e:
        logger.error(f"AI error in chat: {e}")
        return CoachChatResponse(
            response="I'm having some trouble right now. Could you try again?",
            error=True
        )
    except Exception as e:
        logger.error(f"Error in coach chat: {e}", exc_info=True)
        return CoachChatResponse(
            response="Something went wrong. Please try again.",
            error=True
        )
