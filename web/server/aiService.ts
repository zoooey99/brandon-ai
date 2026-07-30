import type { Profile } from "@shared/schema";

// AI Service configuration - should be set in environment
const AI_SERVICE_URL = process.env.AI_SERVICE_URL;
const AI_SERVICE_API_KEY = process.env.FRONTEND_APIKEY;

// Custom error class for AI service failures
export class AIServiceError extends Error {
  constructor(
    message: string,
    public readonly isRetryable: boolean = true,
    public readonly userMessage: string = "I'm having trouble right now. Please try again in a moment."
  ) {
    super(message);
    this.name = "AIServiceError";
  }
}

interface Exercise {
  id?: string;
  name: string;
  sets: number;
  reps: string;
  details?: string[];
}

interface WorkoutDay {
  day: string;
  focus: string;
  duration: string;
  exercises: Exercise[];
}

export interface GeneratedPlan {
  weeklyVolume?: string;
  workouts: WorkoutDay[];
}

// Timeout for AI service requests (90 seconds)
const REQUEST_TIMEOUT_MS = 90000;

async function callAIService<T>(
  endpoint: string,
  body: Record<string, unknown>
): Promise<T> {
  if (!AI_SERVICE_URL) {
    throw new AIServiceError(
      "AI_SERVICE_URL not configured",
      false,
      "The AI service is not configured. Please contact support."
    );
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    console.log("[aiService] Sending to FastAPI endpoint:", endpoint);
    console.log("[aiService] Request body:", JSON.stringify(body, null, 2));

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (AI_SERVICE_API_KEY) {
      headers["Authorization"] = `Bearer ${AI_SERVICE_API_KEY}`;
    }

    const response = await fetch(`${AI_SERVICE_URL}${endpoint}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));

      if (response.status === 429) {
        throw new AIServiceError(
          `Rate limited: ${errorData.error || "Too many requests"}`,
          false,
          "I'm getting too many requests right now. Please wait a minute and try again."
        );
      }

      if (response.status >= 500) {
        throw new AIServiceError(
          `AI service error: ${errorData.error || response.statusText}`,
          true,
          "I ran into a technical issue. Please try again."
        );
      }

      throw new AIServiceError(
        `AI service error: ${errorData.error || response.statusText}`,
        false,
        errorData.userMessage || "Something went wrong. Please try again."
      );
    }

    return await response.json();
  } catch (error: any) {
    clearTimeout(timeoutId);

    if (error instanceof AIServiceError) {
      throw error;
    }

    if (error.name === "AbortError") {
      throw new AIServiceError(
        "AI service request timed out",
        true,
        "The request took too long. Please try again."
      );
    }

    if (error.code === "ECONNREFUSED" || error.code === "ENOTFOUND") {
      throw new AIServiceError(
        `Cannot connect to AI service: ${error.message}`,
        true,
        "The AI service is temporarily unavailable. Please try again in a moment."
      );
    }

    throw new AIServiceError(
      `AI service error: ${error.message}`,
      true,
      "I ran into a technical issue. Please try again."
    );
  }
}

export interface GeneratePlanResult {
  plan: GeneratedPlan;
  imageProcessed?: boolean | null;
  coachNotes?: string | null;
}

export async function generateWorkoutPlan(
  profile: Profile,
  workoutImage?: string | null,
  useExactPlan?: boolean,
  planMode?: string | null
): Promise<GeneratePlanResult> {
  // Test mode bypass — return mock plan
  if (process.env.NODE_ENV === "test") {
    return {
      plan: {
        weeklyVolume: "3 days/week",
        workouts: [
          {
            day: "Monday",
            focus: "Full Body A",
            duration: "45 min",
            exercises: [
              { name: "Barbell Squat", sets: 3, reps: "8-10" },
              { name: "Bench Press", sets: 3, reps: "8-10" },
              { name: "Barbell Row", sets: 3, reps: "8-10" },
            ],
          },
          {
            day: "Wednesday",
            focus: "Full Body B",
            duration: "45 min",
            exercises: [
              { name: "Deadlift", sets: 3, reps: "6-8" },
              { name: "Overhead Press", sets: 3, reps: "8-10" },
              { name: "Pull-ups", sets: 3, reps: "6-10" },
            ],
          },
          {
            day: "Friday",
            focus: "Full Body C",
            duration: "45 min",
            exercises: [
              { name: "Front Squat", sets: 3, reps: "8-10" },
              { name: "Incline Dumbbell Press", sets: 3, reps: "10-12" },
              { name: "Cable Row", sets: 3, reps: "10-12" },
            ],
          },
        ],
      },
      imageProcessed: null,
      coachNotes: "Test mode: mock plan generated.",
    };
  }

  const requestBody: Record<string, unknown> = { profile };

  // Include workout image if provided (base64 encoded)
  if (workoutImage) {
    requestBody.workoutImage = workoutImage;
    // When user provides their own workout, copy it exactly
    if (useExactPlan) {
      requestBody.useExactPlan = true;
    }
  }

  if (planMode) {
    requestBody.planMode = planMode;
  }

  const response = await callAIService<{ plan: GeneratedPlan; imageProcessed?: boolean | null; coachNotes?: string | null }>("/api/generate-plan", requestBody);

  if (!response.plan || !Array.isArray(response.plan.workouts)) {
    throw new AIServiceError(
      "Invalid response from AI service",
      true,
      "I received an invalid response. Please try again."
    );
  }

  // Log response details
  console.log(`[aiService] imageProcessed: ${response.imageProcessed}`);
  console.log(`[aiService] coachNotes: ${response.coachNotes || '(not provided)'}`);

  return {
    plan: response.plan,
    imageProcessed: response.imageProcessed,
    coachNotes: response.coachNotes,
  };
}

export async function handleChatMessage(
  message: string,
  currentPlan: GeneratedPlan,
  profile: Profile,
  conversationHistory: Array<{ sender: "ai" | "user"; text: string }> = []
): Promise<{ response: string; updatedPlan?: GeneratedPlan; error?: boolean }> {
  // Test mode bypass — return mock chat response
  if (process.env.NODE_ENV === "test") {
    return {
      response: "Looks great! Your plan is all set. Let's get started!",
    };
  }

  try {
    const result = await callAIService<{
      response: string;
      updatedPlan?: GeneratedPlan;
      error?: boolean;
    }>("/api/coach-chat", {
      message,
      currentPlan,
      profile,
      conversationHistory,
    });

    return result;
  } catch (error) {
    console.error("Error in chat:", error);
    const userMessage = error instanceof AIServiceError
      ? error.userMessage
      : "I encountered an issue. Let me know if you'd like to try again.";
    return { response: userMessage, error: true };
  }
}
