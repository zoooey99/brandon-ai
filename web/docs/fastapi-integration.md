# FastAPI Integration

API contract between Node.js backend and FastAPI AI service.

## Environment Variables

```bash
AI_SERVICE_URL=https://your-fastapi-service.com
FRONTEND_APIKEY=your-api-key  # Optional, sent as Bearer token
```

---

## Endpoints

### POST `/api/generate-plan`

Generates a personalized workout plan based on user profile.

**Request:**
```json
{
  "profile": {
    "id": 1,
    "userId": "uuid",
    "name": "John Doe",
    "phone": "+14155551234",
    "age": 28,
    "sex": "male",
    "goal": "build_muscle",
    "consistency": "3-4 days",
    "experience": "intermediate",
    "equipment": ["barbell", "dumbbells", "cables"],
    "split": "push_pull_legs",
    "workoutDays": ["Monday", "Wednesday", "Friday"],
    "startDate": "2025-01-30T00:00:00Z",
    "preferredTextTime": "07:00",
    "timezone": "America/Los_Angeles",
    "notes": "Bad shoulder, avoid overhead pressing"
  },
  "workoutImage": "data:image/png;base64,/9j/4AAQ...",  // Optional
  "useExactPlan": true  // Optional: copy user's workout exactly instead of using as inspiration
}
```

**Response:**
```json
{
  "plan": {
    "weeklyVolume": "12 sets per muscle group",
    "workouts": [
      {
        "day": "Monday",
        "focus": "Push (Chest, Shoulders, Triceps)",
        "duration": "60 mins",
        "exercises": [
          {
            "name": "Bench Press",
            "sets": 4,
            "reps": "6-8",
            "details": ["Warm up with 2 light sets"]
          }
        ]
      }
    ]
  },
  "imageProcessed": true,
  "coachNotes": "I copied your Push/Pull/Legs plan exactly! Some exercises like Lat Pulldowns need a cable machine. Let me know if you'd like alternatives."
}
```

**Field Details:**

| Field | Type | Description |
|-------|------|-------------|
| `workoutImage` | string? | Base64 data URL (PNG keeps quality for screenshots) |
| `useExactPlan` | boolean? | When `true`, copy user's workout exactly; when `false`/missing, use as inspiration |
| `imageProcessed` | boolean? | Whether the image was successfully processed |
| `coachNotes` | string? | Dynamic welcome message for the chat (explains what the AI did) |

**Notes:**
- `coachNotes` is displayed as the first message in the plan editor chat
- If `coachNotes` is null/missing, frontend falls back to a default message
- When `useExactPlan=true`, the AI should replicate the user's workout structure
- Timeout: 90 seconds

---

### POST `/api/coach-chat`

Handles conversation with AI coach for plan modifications.

**Request:**
```json
{
  "message": "Can you add more leg exercises?",
  "currentPlan": { /* GeneratedPlan object */ },
  "profile": { /* Profile object */ },
  "conversationHistory": [
    { "sender": "ai", "text": "I've created your plan..." },
    { "sender": "user", "text": "Looks good but..." }
  ]
}
```

**Response:**
```json
{
  "response": "I've added Romanian Deadlifts and Leg Curls to your leg day.",
  "updatedPlan": { /* GeneratedPlan object, only if plan was modified */ },
  "error": false
}
```

---

## Authentication

If `FRONTEND_APIKEY` is set, requests include:
```
Authorization: Bearer <FRONTEND_APIKEY>
```

---

## Error Handling

FastAPI should return appropriate HTTP status codes:

| Status | Meaning | Node.js Behavior |
|--------|---------|------------------|
| 200 | Success | Return response |
| 400 | Bad request | Non-retryable error |
| 429 | Rate limited | Non-retryable, show rate limit message |
| 500+ | Server error | Retryable error |

Error response format:
```json
{
  "error": "Description of what went wrong",
  "userMessage": "Friendly message to show user"  // Optional
}
```

---

## Processing Workout Images

When `workoutImage` is provided, extract workout info using a vision model:

```python
import openai

async def extract_workout_from_image(base64_image: str) -> str:
    # Remove data URL prefix if present
    if base64_image.startswith('data:'):
        base64_image = base64_image.split(',', 1)[1]

    client = openai.OpenAI()

    response = client.chat.completions.create(
        model="gpt-4o",  # or gpt-4o-mini
        messages=[{
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": """Extract the workout plan from this image. Include:
- Day/split names
- Exercise names
- Sets and reps
- Rest periods or notes

If no workout found, respond with "NO_WORKOUT_FOUND"."""
                },
                {
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:image/jpeg;base64,{base64_image}",
                        "detail": "high"
                    }
                }
            ]
        }],
        max_tokens=2000,
    )

    content = response.choices[0].message.content or ""
    return "" if content == "NO_WORKOUT_FOUND" else content
```

Then incorporate into plan generation:
```python
from pydantic import BaseModel
from typing import Optional

class GeneratePlanRequest(BaseModel):
    profile: dict
    workoutImage: Optional[str] = None
    useExactPlan: Optional[bool] = False

@app.post("/api/generate-plan")
async def generate_plan(request: GeneratePlanRequest):
    existing_workout = ""
    image_processed = None
    coach_notes = None

    if request.workoutImage:
        try:
            existing_workout = await extract_workout_from_image(request.workoutImage)
            image_processed = bool(existing_workout)
        except Exception as e:
            print(f"Image extraction failed: {e}")
            image_processed = False

    # Generate plan based on mode
    if request.useExactPlan and existing_workout:
        # Copy user's workout exactly, just structure it properly
        plan = await structure_existing_workout(existing_workout, request.profile)
        coach_notes = generate_exact_plan_notes(plan, existing_workout)
    else:
        # Use workout as inspiration or generate from scratch
        notes = request.profile.get("notes", "") or ""
        if existing_workout:
            notes = f"{notes}\n\n--- USER'S EXISTING WORKOUT ---\n{existing_workout}"
        plan = await generate_plan_with_ai(request.profile, notes)
        coach_notes = generate_standard_notes(plan, request.profile)

    return {
        "plan": plan,
        "imageProcessed": image_processed,
        "coachNotes": coach_notes
    }

def generate_exact_plan_notes(plan, extracted_workout):
    """Generate coach notes for copied workout"""
    # Analyze what equipment might be needed
    return f"I copied your workout plan exactly! I noticed you have {len(plan['workouts'])} training days. Let me know if you'd like any modifications."

def generate_standard_notes(plan, profile):
    """Generate coach notes for AI-generated plan"""
    return f"I've created a {profile.get('split', 'custom')} plan based on your goals. You can review it on the left, or ask me to make any changes."
```
