import { supabase } from "./supabase";

const API_BASE = "/api";

// Helper to get auth headers for authenticated requests
async function getAuthHeaders(): Promise<HeadersInit> {
  const { data: { session } } = await supabase.auth.getSession();
  const headers: HeadersInit = {
    "Content-Type": "application/json",
  };
  if (session?.access_token) {
    headers["Authorization"] = `Bearer ${session.access_token}`;
  }
  return headers;
}

// Helper for authenticated fetch
async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const authHeaders = await getAuthHeaders();
  return fetch(url, {
    ...options,
    headers: {
      ...authHeaders,
      ...options.headers,
    },
  });
}

export interface ProfileData {
  id?: number;
  userId: string;
  name: string;
  phone?: string;
  age?: number;
  sex?: string;
  goal: string;
  consistency?: string;
  experience?: string;
  equipment?: string[];
  split?: string;
  notes?: string;
  workoutDays?: string[];
  preferredTextTime?: string;
  timezone?: string;
  planMode?: string;
  planFreedom?: number;
}

export interface WorkoutPlanData {
  id?: number;
  userId: string;
  profileId?: number;
  name?: string | null;
  planData: {
    weeklyVolume?: string;
    workouts: Array<{
      day: string;
      focus: string;
      duration: string;
      exercises: Array<{
        id?: string;
        name: string;
        sets: number;
        reps: string;
        details?: string[];
      }>;
    }>;
  };
  status?: string;
  createdAt?: string;
  archivedAt?: string;
  updatedAt?: string;
}

// Phone number check and verification (public - no auth required)
export const authApi = {
  checkPhoneExists: async (phone: string): Promise<{ exists: boolean }> => {
    const response = await fetch(`${API_BASE}/auth/check-phone?phone=${encodeURIComponent(phone)}`);
    if (!response.ok) throw new Error("Failed to check phone number");
    return response.json();
  },

  sendCode: async (phone: string): Promise<{ sent: boolean; error?: string }> => {
    const response = await fetch(`${API_BASE}/auth/send-code`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone }),
    });
    const data = await response.json();
    if (!response.ok) {
      return { sent: false, error: data.error || "Failed to send code" };
    }
    return data;
  },

  verifyPhone: async (phone: string, code: string): Promise<{ verified: boolean; error?: string }> => {
    const response = await fetch(`${API_BASE}/auth/verify-phone`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, code }),
    });
    const data = await response.json();
    if (!response.ok) {
      return { verified: false, error: data.error || "Verification failed" };
    }
    return data;
  },

  isPhoneVerified: async (phone: string): Promise<{ verified: boolean }> => {
    const response = await fetch(`${API_BASE}/auth/phone-verified?phone=${encodeURIComponent(phone)}`);
    if (!response.ok) throw new Error("Failed to check phone verification");
    return response.json();
  },
};

export const profileApi = {
  create: async (data: Omit<ProfileData, "id">): Promise<ProfileData> => {
    const response = await authFetch(`${API_BASE}/profile`, {
      method: "POST",
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error("Failed to create profile");
    return response.json();
  },

  get: async (userId: string): Promise<ProfileData | null> => {
    const response = await authFetch(`${API_BASE}/profile/user/${userId}`);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error("Failed to fetch profile");
    return response.json();
  },

  update: async (id: number, data: Partial<ProfileData>): Promise<ProfileData> => {
    const response = await authFetch(`${API_BASE}/profile/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error("Failed to update profile");
    return response.json();
  },
};

export const workoutPlanApi = {
  create: async (data: Omit<WorkoutPlanData, "id">, messages?: PlanConversationMessage[]): Promise<WorkoutPlanData> => {
    const response = await authFetch(`${API_BASE}/workout-plan`, {
      method: "POST",
      body: JSON.stringify({ ...data, messages }),
    });
    if (!response.ok) throw new Error("Failed to create workout plan");
    return response.json();
  },

  get: async (userId: string): Promise<WorkoutPlanData | null> => {
    const response = await authFetch(`${API_BASE}/workout-plan/user/${userId}`);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error("Failed to fetch workout plan");
    return response.json();
  },

  update: async (id: number, data: Partial<WorkoutPlanData>): Promise<WorkoutPlanData> => {
    const response = await authFetch(`${API_BASE}/workout-plan/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error("Failed to update workout plan");
    return response.json();
  },

  getAll: async (userId: string): Promise<WorkoutPlanData[]> => {
    const response = await authFetch(`${API_BASE}/workout-plans/user/${userId}`);
    if (!response.ok) throw new Error("Failed to fetch workout plans");
    return response.json();
  },

  activate: async (planId: number): Promise<WorkoutPlanData> => {
    const response = await authFetch(`${API_BASE}/workout-plan/${planId}/activate`, {
      method: "POST",
    });
    if (!response.ok) throw new Error("Failed to activate workout plan");
    return response.json();
  },

  getArchived: async (): Promise<WorkoutPlanData[]> => {
    const response = await authFetch(`${API_BASE}/workout-plans/archived`);
    if (!response.ok) throw new Error("Failed to fetch archived plans");
    return response.json();
  },
};

export interface GeneratedPlan {
  weeklyVolume?: string;
  workouts: Array<{
    day: string;
    focus: string;
    duration: string;
    exercises: Array<{
      name: string;
      sets: number;
      reps: string;
      details?: string[];
    }>;
  }>;
}

export interface DraftOnboardingData {
  phone?: string;
  age?: string;
  sex?: string;
  goal?: string;
  consistency?: string;
  experience?: string;
  equipment?: string[];
  split?: string;
  notes?: string;
  workoutDays?: string[];
  preferredTextTime?: string;
  timezone?: string;
  workoutImage?: string;
  useExactPlan?: boolean;
  planMode?: "existing" | "scratch";
  currentStep?: string;
  contactDownloaded?: boolean;
  messageSent?: boolean;
}

export interface PlanConversationMessage {
  id: string;
  sender: "ai" | "user";
  text: string;
  timestamp?: string;
}

export interface DraftPlanData {
  plan: GeneratedPlan | null;
  messages: PlanConversationMessage[];
  updatedAt: string;
}

export interface SignupProgress {
  signupStage: "onboarding_incomplete" | "payment_pending" | "plan_pending" | "complete";
  draftOnboardingData: DraftOnboardingData | null;
  draftPlanData: DraftPlanData | null;
  hasProfile: boolean;
  hasWorkoutPlan: boolean;
  hasMessages: boolean;
  subscriptionStatus: string | null;
}

export const signupProgressApi = {
  get: async (): Promise<SignupProgress> => {
    const response = await authFetch(`${API_BASE}/signup-progress`);
    if (!response.ok) throw new Error("Failed to fetch signup progress");
    return response.json();
  },

  saveDraft: async (draftData: DraftOnboardingData): Promise<void> => {
    const response = await authFetch(`${API_BASE}/signup-progress/draft`, {
      method: "PATCH",
      body: JSON.stringify(draftData),
    });
    if (!response.ok) throw new Error("Failed to save draft");
  },

  saveDraftPlan: async (draftData: DraftPlanData): Promise<void> => {
    const response = await authFetch(`${API_BASE}/signup-progress/draft-plan`, {
      method: "PATCH",
      body: JSON.stringify(draftData),
    });
    if (!response.ok) throw new Error("Failed to save draft plan");
  },
};

export class AIApiError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean = true
  ) {
    super(message);
    this.name = "AIApiError";
  }
}

export const aiApi = {
  generatePlan: async (): Promise<{ plan: GeneratedPlan; coachNotes?: string | null }> => {
    const response = await authFetch(`${API_BASE}/generate-plan`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new AIApiError(
        errorData.error || "Failed to generate workout plan",
        errorData.retryable !== false
      );
    }
    return response.json();
  },

  chat: async (
    message: string,
    currentPlan: GeneratedPlan,
    conversationHistory?: Array<{ sender: "ai" | "user"; text: string }>
  ): Promise<{ response: string; updatedPlan?: GeneratedPlan; error?: boolean }> => {
    const response = await authFetch(`${API_BASE}/coach-chat`, {
      method: "POST",
      body: JSON.stringify({
        message,
        currentPlan,
        conversationHistory,
      }),
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new AIApiError(
        errorData.error || "Failed to send message",
        errorData.retryable !== false
      );
    }
    return response.json();
  },
};

export interface WorkoutSessionData {
  id?: number;
  userId: string;
  planId?: number | null;
  workoutDate: Date | string;
  scheduledFor?: Date | string | null; // Which day slot this workout belongs to
  dayIndex: number;
  dayName: string;
  focus: string;
  exercises?: Array<{ id?: string; name: string; sets: number; reps: string; details?: string[] }> | null;
  source?: string | null; // plan | rescheduled | custom
  status: string;
  notes?: string | null;
  completedAt?: Date | string | null;
  createdAt?: Date | string;
}

export interface WeekSessionsResponse {
  weekStart: string;
  weekEnd: string;
  sessions: WorkoutSessionData[];
}

export interface WorkoutSlotHistory {
  scheduledFor: Date | string;
  completed: boolean;
  performedOn: Date | string | null;
}

export interface WorkoutHistoryResponse {
  dayName: string;
  history: WorkoutSlotHistory[];
}

export interface WorkoutSetData {
  id?: number;
  sessionId: number;
  exerciseName: string;
  exerciseId?: string | null;
  exerciseIndex: number;
  setNumber: number;
  weight?: number | null;
  reps?: number | null;
  rpe?: number | null;
  notes?: string | null;
  completed: number;
}

export interface PaginatedResponse<T> {
  sessions: T[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

export const workoutSessionApi = {
  getAll: async (limit: number = 10, offset: number = 0): Promise<WorkoutSessionData[]> => {
    const response = await authFetch(`${API_BASE}/workout-sessions?limit=${limit}&offset=${offset}`);
    if (!response.ok) throw new Error("Failed to fetch workout sessions");
    const data: PaginatedResponse<WorkoutSessionData> = await response.json();
    return data.sessions;
  },

  getAllPaginated: async (limit: number = 10, offset: number = 0): Promise<PaginatedResponse<WorkoutSessionData>> => {
    const response = await authFetch(`${API_BASE}/workout-sessions?limit=${limit}&offset=${offset}`);
    if (!response.ok) throw new Error("Failed to fetch workout sessions");
    return response.json();
  },

  getById: async (id: number): Promise<{ session: WorkoutSessionData; sets: WorkoutSetData[] }> => {
    const response = await authFetch(`${API_BASE}/workout-sessions/${id}`);
    if (!response.ok) throw new Error("Failed to fetch workout session");
    return response.json();
  },

  create: async (data: Omit<WorkoutSessionData, "id" | "userId" | "createdAt">): Promise<WorkoutSessionData> => {
    const response = await authFetch(`${API_BASE}/workout-sessions`, {
      method: "POST",
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error("Failed to create workout session");
    return response.json();
  },

  update: async (id: number, data: Partial<WorkoutSessionData>): Promise<WorkoutSessionData> => {
    const response = await authFetch(`${API_BASE}/workout-sessions/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error("Failed to update workout session");
    return response.json();
  },

  addSets: async (sessionId: number, sets: Omit<WorkoutSetData, "id" | "sessionId">[]): Promise<WorkoutSetData[]> => {
    const response = await authFetch(`${API_BASE}/workout-sessions/${sessionId}/sets`, {
      method: "POST",
      body: JSON.stringify(sets),
    });
    if (!response.ok) throw new Error("Failed to add workout sets");
    return response.json();
  },

  // Start tracking today's workout - creates session if needed and returns tracking token
  startToday: async (data: { planId: number; dayIndex: number; dayName: string; focus: string }): Promise<{ token: string; sessionId: number }> => {
    const response = await authFetch(`${API_BASE}/workout-sessions/start-today`, {
      method: "POST",
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: "Failed to start workout tracking" }));
      throw new Error(error.error || "Failed to start workout tracking");
    }
    return response.json();
  },

  // Start tracking any workout (can specify scheduledFor to do future/past workouts)
  start: async (data: { planId: number; dayIndex: number; dayName: string; focus: string; scheduledFor?: string }): Promise<{ token: string; sessionId: number }> => {
    const response = await authFetch(`${API_BASE}/workout-sessions/start`, {
      method: "POST",
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: "Failed to start workout tracking" }));
      throw new Error(error.error || "Failed to start workout tracking");
    }
    return response.json();
  },

  // Get all sessions for a specific week
  getWeek: async (weekStart?: string): Promise<WeekSessionsResponse> => {
    const url = weekStart
      ? `${API_BASE}/workout-sessions/week?weekStart=${encodeURIComponent(weekStart)}`
      : `${API_BASE}/workout-sessions/week`;
    const response = await authFetch(url);
    if (!response.ok) throw new Error("Failed to fetch week sessions");
    return response.json();
  },

  // Get workout history for a specific day slot (e.g., last 5 Fridays)
  getSlotHistory: async (dayName: string, limit: number = 5): Promise<WorkoutHistoryResponse> => {
    const response = await authFetch(`${API_BASE}/workout-sessions/history/${encodeURIComponent(dayName)}?limit=${limit}`);
    if (!response.ok) throw new Error("Failed to fetch workout history");
    return response.json();
  },
};

export const workoutSetApi = {
  update: async (id: number, data: Partial<WorkoutSetData>): Promise<WorkoutSetData> => {
    const response = await authFetch(`${API_BASE}/workout-sets/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error("Failed to update workout set");
    return response.json();
  },

  delete: async (id: number): Promise<void> => {
    const response = await authFetch(`${API_BASE}/workout-sets/${id}`, {
      method: "DELETE",
    });
    if (!response.ok) throw new Error("Failed to delete workout set");
  },
};

// ========================================
// PUBLIC WORKOUT TRACKING API
// These endpoints use token-based auth (no login required)
// ========================================

export interface TrackingWorkoutData {
  session: {
    id: number;
    dayName: string;
    focus: string;
    status: "pending" | "in_progress" | "completed";
    workoutDate: string;
    notes?: string | null;
    startedAt?: string | null;
    completedAt?: string | null;
    totalDuration?: number | null;
  };
  workout: {
    day: string;
    focus: string;
    duration: string;
    exercises: Array<{
      id?: string;
      name: string;
      sets: number;
      reps: string;
      details?: string[];
    }>;
  } | null;
  sets: WorkoutSetData[];
  historicalMaxWeights: Record<string, number>;
  previousSets?: WorkoutSetData[];
  expiresAt: string;
}

export interface TrackingSetUpdate {
  weight?: number | null;
  reps?: number | null;
  rpe?: number | null;
  notes?: string | null;
  completed?: number;
}

export interface TrackingSetCreate {
  exerciseName: string;
  exerciseId?: string | null;
  exerciseIndex: number;
  setNumber: number;
  weight?: number | null;
  reps?: number | null;
  completed?: number;
}

export interface TrackingSessionUpdate {
  status?: "pending" | "in_progress" | "completed";
  notes?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  totalDuration?: number | null;
}

// ========================================
// PUBLIC PLAN DRAFT API
// Token-based auth (no login required)
// ========================================

export interface PlanDraftResponse {
  draft: {
    planData: GeneratedPlan;
    status: string;
    createdAt: string;
    expiresAt: string;
  };
  currentPlan: { planData: GeneratedPlan; name: string | null } | null;
}

export const planDraftApi = {
  getDraft: async (token: string): Promise<PlanDraftResponse> => {
    const response = await fetch(`${API_BASE}/plan-draft/${token}`);
    if (response.status === 404) {
      throw new Error("This plan draft has expired or is invalid.");
    }
    if (!response.ok) {
      throw new Error("Failed to load plan draft");
    }
    return response.json();
  },

  acceptDraft: async (token: string): Promise<{ success: boolean; newPlanId: number }> => {
    const response = await fetch(`${API_BASE}/plan-draft/${token}/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    if (response.status === 404) {
      throw new Error("This plan draft has expired or is invalid.");
    }
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "Failed to accept plan draft");
    }
    return response.json();
  },
};

export const trackingApi = {
  // Get workout data by token (public - no auth required)
  getWorkout: async (token: string): Promise<TrackingWorkoutData> => {
    const response = await fetch(`${API_BASE}/track/${token}`);
    if (response.status === 404) {
      throw new Error("This link has expired or is invalid.");
    }
    if (!response.ok) {
      throw new Error("Failed to load workout");
    }
    return response.json();
  },

  // Update a set via token
  updateSet: async (token: string, setId: number, data: TrackingSetUpdate): Promise<WorkoutSetData> => {
    const response = await fetch(`${API_BASE}/track/${token}/sets/${setId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (response.status === 404) {
      throw new Error("This link has expired or is invalid.");
    }
    if (!response.ok) {
      throw new Error("Failed to update set");
    }
    return response.json();
  },

  // Create sets via token
  createSets: async (token: string, sets: TrackingSetCreate[]): Promise<WorkoutSetData[]> => {
    const response = await fetch(`${API_BASE}/track/${token}/sets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sets),
    });
    if (response.status === 404) {
      throw new Error("This link has expired or is invalid.");
    }
    if (!response.ok) {
      throw new Error("Failed to create sets");
    }
    return response.json();
  },

  // Update session via token
  updateSession: async (token: string, data: TrackingSessionUpdate): Promise<WorkoutSessionData> => {
    const response = await fetch(`${API_BASE}/track/${token}/session`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (response.status === 404) {
      throw new Error("This link has expired or is invalid.");
    }
    if (!response.ok) {
      throw new Error("Failed to update session");
    }
    return response.json();
  },

  // Save exercise order to plan via token
  saveExerciseOrder: async (token: string, exerciseOrder: Array<{ id?: string; name: string }>): Promise<void> => {
    const response = await fetch(`${API_BASE}/track/${token}/save-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ exerciseOrder }),
    });
    if (response.status === 404) {
      throw new Error("This link has expired or is invalid.");
    }
    if (!response.ok) {
      throw new Error("Failed to save exercise order");
    }
  },
};
