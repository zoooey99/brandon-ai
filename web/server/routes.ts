import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertProfileSchema, insertWorkoutPlanSchema, insertWorkoutSessionSchema, insertWorkoutSetSchema, type DraftOnboardingData, type DraftPlanData, type PlanConversationMessage } from "@shared/schema";
import { z } from "zod";
import { stripe, getStripePublishableKey } from "./stripeClient";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { generateWorkoutPlan, handleChatMessage, AIServiceError, type GeneratedPlan, type GeneratePlanResult } from "./aiService";
import { isAuthenticated } from "./auth";
import rateLimit from "express-rate-limit";
import { sendVerificationCode, checkVerificationCode } from "./twilio";
import { Resend } from "resend";
import { randomUUID } from "crypto";

/**
 * Stamps a stable UUID on each exercise in a plan that doesn't already have one.
 * Mutates the plan in place and returns it for convenience.
 * When an existingPlan is provided, exercises are matched by name to preserve existing IDs.
 */
function stampExerciseIds(plan: GeneratedPlan, existingPlan?: GeneratedPlan): GeneratedPlan {
  // Build a lookup from existing plan if provided (for preserving IDs across updates)
  const existingIdsByDayAndName = new Map<string, string>();
  if (existingPlan) {
    for (const workout of existingPlan.workouts) {
      for (const exercise of workout.exercises) {
        if (exercise.id) {
          existingIdsByDayAndName.set(`${workout.day}::${exercise.name}`, exercise.id);
        }
      }
    }
  }

  for (const workout of plan.workouts) {
    for (const exercise of workout.exercises) {
      if (!exercise.id) {
        // Try to match from existing plan first, then generate new
        const key = `${workout.day}::${exercise.name}`;
        exercise.id = existingIdsByDayAndName.get(key) || randomUUID();
      }
    }
  }
  return plan;
}

// Track active plan generations to avoid duplicate AI calls
// Key: userId, Value: Promise that resolves to the generated plan
const activeGenerations = new Map<string, Promise<GeneratePlanResult>>();

// Key generator that uses authenticated user ID or falls back to default IP handling
const getUserKey = (req: any) => {
  const userId = req.user?.id;
  if (userId) return userId;
  return undefined; // Let express-rate-limit use default IP handling
};

// Rate limiter for expensive AI endpoints - plan generation (5 per hour)
const planGenerationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  message: { error: "Too many plan generation requests. Please try again later.", retryable: false },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getUserKey,
  validate: { xForwardedForHeader: false },
});

// Rate limiter for coach chat (30 per hour)
const coachChatLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 30,
  message: { error: "Too many chat messages. Please try again later.", retryable: false },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getUserKey,
  validate: { xForwardedForHeader: false },
});

// General rate limiter for all API endpoints (100 per minute)
const generalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100,
  message: { error: "Too many requests. Please slow down.", retryable: false },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
});

// Rate limiter for public tracking endpoints (30 per 15 minutes per IP)
const trackingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30,
  message: { error: "Too many requests. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
});

// Middleware to verify user has paid/active subscription before accessing AI endpoints
// This prevents users from bypassing the frontend payment flow and calling AI APIs directly
const requireActiveSubscription = async (req: any, res: any, next: any) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    const user = await storage.getUser(userId);
    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }

    // Allow access if:
    // 1. signupStage is "plan_pending" (user building first plan before payment)
    // 2. signupStage is "payment_pending" (plan built, awaiting payment)
    // 3. signupStage is "complete" (user has active subscription)
    // 4. subscriptionStatus is "active" or "trialing" (backup check)
    const validSignupStages = ["plan_pending", "payment_pending", "complete"];
    const validSubscriptionStatuses = ["active", "trialing"];

    const hasValidSignupStage = validSignupStages.includes(user.signupStage || "");
    const hasValidSubscription = validSubscriptionStatuses.includes(user.subscriptionStatus || "");

    if (!hasValidSignupStage && !hasValidSubscription) {
      console.log(`[requireActiveSubscription] Access denied for user ${userId}: signupStage=${user.signupStage}, subscriptionStatus=${user.subscriptionStatus}`);
      return res.status(403).json({
        error: "Active subscription required. Please complete payment to access this feature.",
        code: "SUBSCRIPTION_REQUIRED"
      });
    }

    next();
  } catch (error) {
    console.error("[requireActiveSubscription] Error:", error);
    return res.status(500).json({ error: "Failed to verify subscription status" });
  }
};

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  // Apply general rate limiting to all API routes
  app.use("/api", generalLimiter);

  // Health check endpoint for Render
  app.get("/api/health", async (req, res) => {
    try {
      // Basic health check - can add database ping if needed
      res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
    } catch (error) {
      res.status(503).json({ status: "error" });
    }
  });

  // ========================================
  // PUBLIC WORKOUT TRACKING ENDPOINTS
  // These endpoints use token-based auth (no login required)
  // ========================================

  // Get workout data by token (public - no auth required)
  app.get("/api/track/:token", trackingLimiter, async (req, res) => {
    try {
      const { token } = req.params;

      const result = await storage.getSessionByToken(token);
      if (!result) {
        res.status(404).json({ error: "This link has expired or is invalid." });
        return;
      }

      const { session, token: tokenData, plan } = result;

      // Get existing sets for this session
      const sets = await storage.getWorkoutSets(session.id);

      // Find the workout exercises — prefer session.exercises (materialized/custom),
      // fall back to plan template if session doesn't have them
      let workout = null;
      if (session.exercises && Array.isArray(session.exercises) && (session.exercises as unknown[]).length > 0) {
        // Use exercises from the materialized session (supports agent modifications)
        workout = {
          day: session.dayName,
          focus: session.focus,
          exercises: session.exercises as Array<{ id?: string; name: string; sets: number; reps: string; details?: string[] }>,
        };
      } else if (plan?.planData?.workouts && session.dayName) {
        workout = plan.planData.workouts.find(w => w.day === session.dayName) || null;
      }

      // Get historical max weights for PR detection
      // Only fetch if we have exercises to compare against
      let historicalMaxWeights: Record<string, number> = {};
      if (workout?.exercises && workout.exercises.length > 0) {
        const exerciseNames = workout.exercises.map(e => e.name);
        historicalMaxWeights = await storage.getHistoricalMaxWeights(
          session.userId,
          exerciseNames,
          session.id
        );
      }

      // Get sets from the previous completed session for auto-fill
      // Only fetch if this session has a day name to match against
      let previousSets: Awaited<ReturnType<typeof storage.getPreviousSessionSets>> = [];
      if (session.dayName) {
        previousSets = await storage.getPreviousSessionSets(
          session.userId,
          session.dayName,
          session.id
        );
      }

      res.json({
        session: {
          id: session.id,
          dayName: session.dayName,
          focus: session.focus,
          status: session.status,
          workoutDate: session.workoutDate,
          notes: session.notes,
          startedAt: session.startedAt,
          completedAt: session.completedAt,
          totalDuration: session.totalDuration,
        },
        workout,
        sets,
        historicalMaxWeights,
        previousSets,
        expiresAt: tokenData.expiresAt,
      });
    } catch (error) {
      console.error("Error fetching workout by token:", error);
      res.status(500).json({ error: "Failed to fetch workout data" });
    }
  });

  // Update a set via token (public - token validates access)
  app.patch("/api/track/:token/sets/:setId", trackingLimiter, async (req, res) => {
    try {
      const { token, setId } = req.params;
      const setIdNum = parseInt(setId);

      if (isNaN(setIdNum)) {
        res.status(400).json({ error: "Invalid set ID" });
        return;
      }

      // Validate token
      const result = await storage.getSessionByToken(token);
      if (!result) {
        res.status(404).json({ error: "This link has expired or is invalid." });
        return;
      }

      // Verify the set belongs to this session
      const existingSet = await storage.getWorkoutSetById(setIdNum);
      if (!existingSet || existingSet.sessionId !== result.session.id) {
        res.status(403).json({ error: "Access denied" });
        return;
      }

      // Validate and update
      const updateSchema = z.object({
        weight: z.number().int().min(0).max(2000).optional().nullable(),
        reps: z.number().int().min(0).max(500).optional().nullable(),
        rpe: z.number().int().min(1).max(10).optional().nullable(),
        notes: z.string().max(500).optional().nullable(),
        completed: z.number().int().min(0).max(1).optional(),
      });

      const validatedData = updateSchema.parse(req.body);
      const updatedSet = await storage.updateWorkoutSet(setIdNum, validatedData);
      res.json(updatedSet);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid set data", details: error.errors });
      } else {
        console.error("Error updating set via token:", error);
        res.status(500).json({ error: "Failed to update set" });
      }
    }
  });

  // Create sets via token (public - token validates access)
  // Uses upsert logic to prevent duplicate sets from race conditions
  app.post("/api/track/:token/sets", trackingLimiter, async (req, res) => {
    try {
      const { token } = req.params;

      // Validate token
      const result = await storage.getSessionByToken(token);
      if (!result) {
        res.status(404).json({ error: "This link has expired or is invalid." });
        return;
      }

      // Validate and create sets
      const createSetSchema = z.object({
        exerciseName: z.string().min(1).max(200),
        exerciseId: z.string().max(100).optional().nullable(),
        exerciseIndex: z.number().int().min(0),
        setNumber: z.number().int().min(1),
        weight: z.number().int().min(0).max(2000).optional().nullable(),
        reps: z.number().int().min(0).max(500).optional().nullable(),
        rpe: z.number().int().min(1).max(10).optional().nullable(),
        notes: z.string().max(500).optional().nullable(),
        completed: z.number().int().min(0).max(1).optional(),
      });

      const sets = Array.isArray(req.body) ? req.body : [req.body];
      const validatedSets = sets.map((set: Record<string, unknown>) => ({
        ...createSetSchema.parse(set),
        sessionId: result.session.id,
      }));

      // Upsert logic: check if sets already exist for this session/exercise/set combo
      const existingSets = await storage.getWorkoutSets(result.session.id);
      const resultSets: typeof existingSets = [];

      for (const newSet of validatedSets) {
        // Check if a set already exists with the same sessionId, exerciseIndex, setNumber
        const existing = existingSets.find(
          (s) => s.exerciseIndex === newSet.exerciseIndex && s.setNumber === newSet.setNumber
        );

        if (existing) {
          // Update existing set instead of creating duplicate
          const updated = await storage.updateWorkoutSet(existing.id, {
            weight: newSet.weight,
            reps: newSet.reps,
            completed: newSet.completed ?? 0,
          });
          if (updated) resultSets.push(updated);
        } else {
          // Create new set
          const created = await storage.createWorkoutSets([newSet]);
          resultSets.push(...created);
        }
      }

      res.json(resultSets);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid set data", details: error.errors });
      } else {
        console.error("Error creating sets via token:", error);
        res.status(500).json({ error: "Failed to create sets" });
      }
    }
  });

  // Update session via token (public - token validates access)
  app.patch("/api/track/:token/session", trackingLimiter, async (req, res) => {
    try {
      const { token } = req.params;

      // Validate token
      const result = await storage.getSessionByToken(token);
      if (!result) {
        res.status(404).json({ error: "This link has expired or is invalid." });
        return;
      }

      // Validate and update
      const updateSchema = z.object({
        status: z.enum(["pending", "in_progress", "completed"]).optional(),
        notes: z.string().max(500).optional().nullable(),
        startedAt: z.union([z.date(), z.string().transform((s) => new Date(s))]).optional().nullable(),
        completedAt: z.union([z.date(), z.string().transform((s) => new Date(s))]).optional().nullable(),
        totalDuration: z.number().int().min(0).optional().nullable(),
      });

      const validatedData = updateSchema.parse(req.body);
      const previousStatus = result.session.status;
      const updatedSession = await storage.updateWorkoutSession(result.session.id, validatedData);

      // Write context events for status transitions the agent should know about
      if (validatedData.status && validatedData.status !== previousStatus) {
        const focus = result.session.focus || "workout";
        if (validatedData.status === "in_progress") {
          await storage.insertContextMessage(
            result.session.userId,
            `[Internal context] The user started their ${focus} workout on the tracking page.`
          );
        } else if (validatedData.status === "completed") {
          const duration = validatedData.totalDuration
            ? `${Math.round(validatedData.totalDuration / 60)} min`
            : null;
          const detail = duration ? ` (${duration})` : "";
          await storage.insertContextMessage(
            result.session.userId,
            `[Internal context] The user completed their ${focus} workout on the tracking page${detail}.`
          );
        }
      }

      res.json(updatedSession);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid session data", details: error.errors });
      } else {
        console.error("Error updating session via token:", error);
        res.status(500).json({ error: "Failed to update session" });
      }
    }
  });

  // Save exercise order to plan via token (public - token validates access)
  app.post("/api/track/:token/save-order", trackingLimiter, async (req, res) => {
    try {
      const { token } = req.params;

      const result = await storage.getSessionByToken(token);
      if (!result) {
        res.status(404).json({ error: "This link has expired or is invalid." });
        return;
      }

      const { session, plan } = result;
      if (!plan) {
        res.status(400).json({ error: "No plan associated with this session" });
        return;
      }

      const orderSchema = z.object({
        exerciseOrder: z.array(z.object({
          id: z.string().optional(),
          name: z.string(),
        })),
      });

      const { exerciseOrder } = orderSchema.parse(req.body);

      // Find the workout day in the plan that matches this session
      const planData = plan.planData as {
        weeklyVolume?: string;
        workouts: Array<{
          day: string;
          focus: string;
          duration: string;
          exercises: Array<{ id?: string; name: string; sets: number; reps: string; details?: string[] }>;
        }>;
      };

      const workoutIndex = planData.workouts.findIndex(w => w.day === session.dayName);
      if (workoutIndex === -1) {
        res.status(400).json({ error: "Workout day not found in plan" });
        return;
      }

      const workout = planData.workouts[workoutIndex];
      const existingExercises = workout.exercises;

      // Reorder exercises based on the provided order, matching by id then name
      const reordered: typeof existingExercises = [];
      for (const item of exerciseOrder) {
        const match = existingExercises.find(e =>
          (item.id && e.id === item.id) || e.name === item.name
        );
        if (match) reordered.push(match);
      }
      // Append any exercises that weren't in the order (safety net)
      for (const ex of existingExercises) {
        if (!reordered.includes(ex)) reordered.push(ex);
      }

      planData.workouts[workoutIndex].exercises = reordered;

      await storage.updateWorkoutPlan(plan.id, { planData: planData as any });

      res.json({ success: true });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid order data", details: error.errors });
      } else {
        console.error("Error saving exercise order:", error);
        res.status(500).json({ error: "Failed to save exercise order" });
      }
    }
  });

  // ========================================
  // PUBLIC PLAN DRAFT ENDPOINTS
  // These endpoints use token-based auth (no login required)
  // ========================================

  // Get plan draft by token (public - token IS the auth)
  app.get("/api/plan-draft/:token", trackingLimiter, async (req, res) => {
    try {
      const { token } = req.params;

      const result = await storage.getPlanDraftByToken(token);
      if (!result) {
        res.status(404).json({ error: "This plan draft has expired or is invalid." });
        return;
      }

      const { draft, currentPlan } = result;

      res.json({
        draft: {
          planData: draft.planData,
          status: draft.status,
          createdAt: draft.createdAt,
          expiresAt: draft.expiresAt,
        },
        currentPlan: currentPlan ? { planData: currentPlan.planData, name: currentPlan.name } : null,
      });
    } catch (error) {
      console.error("Error fetching plan draft:", error);
      res.status(500).json({ error: "Failed to fetch plan draft" });
    }
  });

  // Accept plan draft (public - token IS the auth)
  app.post("/api/plan-draft/:token/accept", trackingLimiter, async (req, res) => {
    try {
      const { token } = req.params;

      const result = await storage.acceptPlanDraft(token);

      if (!result.success) {
        res.status(400).json({ error: result.error });
        return;
      }

      res.json({ success: true, newPlanId: result.newPlanId });
    } catch (error) {
      console.error("Error accepting plan draft:", error);
      res.status(500).json({ error: "Failed to accept plan draft" });
    }
  });

  // ========================================
  // PHONE CHECK ENDPOINT (public - for onboarding)
  // ========================================

  // Check if a phone number is already registered
  app.get("/api/auth/check-phone", async (req, res) => {
    try {
      const phone = req.query.phone as string;

      if (!phone) {
        res.status(400).json({ error: "Phone number is required" });
        return;
      }

      // Validate E164 format
      const e164Regex = /^\+[1-9]\d{1,14}$/;
      if (!e164Regex.test(phone)) {
        res.status(400).json({ error: "Phone must be in E164 format (e.g., +15551234567)" });
        return;
      }

      const profile = await storage.getProfileByPhone(phone);
      res.json({ exists: !!profile });
    } catch (error) {
      console.error("Error checking phone:", error);
      res.status(500).json({ error: "Failed to check phone number" });
    }
  });

  // Send verification code via Twilio Verify
  app.post("/api/auth/send-code", async (req, res) => {
    try {
      const { phone } = req.body;

      if (!phone) {
        res.status(400).json({ sent: false, error: "Phone number is required" });
        return;
      }

      const e164Regex = /^\+[1-9]\d{1,14}$/;
      if (!e164Regex.test(phone)) {
        res.status(400).json({ sent: false, error: "Phone must be in E164 format (e.g., +15551234567)" });
        return;
      }

      const result = await sendVerificationCode(phone);
      if (result.success) {
        res.json({ sent: true });
      } else {
        res.status(400).json({ sent: false, error: result.error });
      }
    } catch (error) {
      console.error("Error sending verification code:", error);
      res.status(500).json({ sent: false, error: "Failed to send verification code" });
    }
  });

  // Verify phone number with code from Twilio Verify
  app.post("/api/auth/verify-phone", async (req, res) => {
    try {
      const { phone, code } = req.body;

      if (!phone || !code) {
        res.status(400).json({ error: "Phone number and code are required" });
        return;
      }

      // Validate E164 format
      const e164Regex = /^\+[1-9]\d{1,14}$/;
      if (!e164Regex.test(phone)) {
        res.status(400).json({ error: "Phone must be in E164 format (e.g., +15551234567)" });
        return;
      }

      // Validate code format (6 digits)
      if (!/^\d{6}$/.test(code)) {
        res.status(400).json({ error: "Code must be 6 digits" });
        return;
      }

      const result = await checkVerificationCode(phone, code);

      if (result.verified) {
        await storage.markPhoneVerified(phone);
        res.json({ verified: true });
      } else {
        res.status(400).json({ verified: false, error: result.error });
      }
    } catch (error) {
      console.error("Error verifying phone:", error);
      res.status(500).json({ error: "Failed to verify phone number" });
    }
  });

  // Check if a phone number has been verified
  app.get("/api/auth/phone-verified", async (req, res) => {
    try {
      const phone = req.query.phone as string;

      if (!phone) {
        res.status(400).json({ error: "Phone number is required" });
        return;
      }

      // Validate E164 format
      const e164Regex = /^\+[1-9]\d{1,14}$/;
      if (!e164Regex.test(phone)) {
        res.status(400).json({ error: "Phone must be in E164 format (e.g., +15551234567)" });
        return;
      }

      const verified = await storage.isPhoneVerified(phone);
      res.json({ verified });
    } catch (error) {
      console.error("Error checking phone verification:", error);
      res.status(500).json({ error: "Failed to check phone verification" });
    }
  });

  // Profile routes (protected - user can only create their own profile)
  app.post("/api/profile", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: "User not authenticated" });
        return;
      }

      console.log("[api/profile] Received request body notes:", req.body.notes);
      console.log("[api/profile] Full request body:", JSON.stringify(req.body, null, 2));

      // Remove any client-provided userId and use authenticated session
      const { userId: _, ...bodyWithoutUserId } = req.body;

      // Check if phone was verified during onboarding
      const phoneVerified = await storage.isPhoneVerified(bodyWithoutUserId.phone);

      const validatedData = insertProfileSchema.parse({
        ...bodyWithoutUserId,
        userId,
        phoneVerified,
      });

      // Check if profile already exists - if so, update instead of create
      const existingProfile = await storage.getProfile(userId);
      let profile;
      if (existingProfile) {
        profile = await storage.updateProfile(existingProfile.id, validatedData);
      } else {
        profile = await storage.createProfile(validatedData);
      }

      // Advance signup stage and clear draft data
      await storage.updateSignupStage(userId, "plan_pending");
      await storage.updateDraftOnboardingData(userId, null as any);

      // Start plan generation in background (fire-and-forget)
      // This runs while user navigates to setup-plan, so plan may be ready when they arrive
      const user = await storage.getUser(userId);
      if (!user?.draftPlanData?.plan && profile && !activeGenerations.has(userId)) {
        console.log("[profile] Starting background plan generation for user:", userId);

        // Get workout image, useExactPlan, planMode from draft data
        const workoutImage = user?.draftOnboardingData?.workoutImage || null;
        const useExactPlan = user?.draftOnboardingData?.useExactPlan ?? false;
        const planMode = user?.draftOnboardingData?.planMode || null;

        // Create the generation promise and store it in the Map
        const generationPromise = generateWorkoutPlan(profile, workoutImage, useExactPlan, planMode);
        activeGenerations.set(userId, generationPromise);

        generationPromise.then(async (result) => {
          // Stamp exercise IDs on generated plan
          stampExerciseIds(result.plan);

          // Use coachNotes from AI response, or fallback to default message
          const defaultMessage = "I've analyzed your profile and created a personalized workout plan based on your goals, experience, and available equipment. You can review it on the left, or ask me to make any changes.";
          const welcomeMessage: PlanConversationMessage = {
            id: "welcome",
            sender: "ai",
            text: result.coachNotes || defaultMessage,
            timestamp: new Date().toISOString(),
          };

          await storage.updateDraftPlanData(userId, {
            plan: result.plan,
            messages: [welcomeMessage],
            updatedAt: new Date().toISOString(),
          });
          console.log("[profile] Background plan generation completed for user:", userId);
        }).catch(err => {
          console.error("[profile] Background plan generation failed for user:", userId, err);
        }).finally(() => {
          // Always clean up the Map entry when done (success or failure)
          activeGenerations.delete(userId);
        });
      } else {
        console.log("[profile] Skipping background generation - draft plan already exists or generation in progress for user:", userId);
      }

      res.json(profile);
    } catch (error) {
      if (error instanceof z.ZodError) {
        console.error("Profile validation error:", JSON.stringify(error.errors, null, 2));
        res.status(400).json({ error: "Invalid profile data", details: error.errors });
      } else {
        console.error("Error creating profile:", error);
        res.status(500).json({ error: "Failed to create profile" });
      }
    }
  });

  app.get("/api/profile/user/:userId", isAuthenticated, async (req: any, res) => {
    try {
      const authenticatedUserId = req.user?.id;
      const requestedUserId = req.params.userId;
      
      // Users can only access their own profile
      if (authenticatedUserId !== requestedUserId) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
      
      const profile = await storage.getProfile(requestedUserId);
      if (!profile) {
        res.status(404).json({ error: "Profile not found" });
        return;
      }
      res.json(profile);
    } catch (error) {
      console.error("Error fetching profile:", error);
      res.status(500).json({ error: "Failed to fetch profile" });
    }
  });

  app.patch("/api/profile/:id", isAuthenticated, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        res.status(400).json({ error: "Invalid profile ID" });
        return;
      }
      
      // Verify user owns this profile
      const existingProfile = await storage.getProfileById(id);
      if (!existingProfile) {
        res.status(404).json({ error: "Profile not found" });
        return;
      }
      
      const userId = req.user?.id;
      if (existingProfile.userId !== userId) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
      
      const validatedData = insertProfileSchema.partial().parse(req.body);
      // Remove userId to prevent ownership transfer
      const { userId: _, ...safeData } = validatedData;
      const profile = await storage.updateProfile(id, safeData);
      res.json(profile);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid profile data", details: error.errors });
      } else {
        console.error("Error updating profile:", error);
        res.status(500).json({ error: "Failed to update profile" });
      }
    }
  });

  // Signup progress routes - for tracking where users are in the onboarding flow
  app.get("/api/signup-progress", isAuthenticated, async (req: any, res) => {
    // Prevent caching so draft data is always fresh
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');

    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: "User not authenticated" });
        return;
      }

      const user = await storage.getUser(userId);
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      console.log("[signup-progress] userId:", userId, "subscriptionStatus:", user.subscriptionStatus, "stripeSubId:", user.stripeSubscriptionId);

      // Check if user has a profile, subscription, or workout plan to determine actual stage
      const profile = await storage.getProfile(userId);
      const workoutPlan = await storage.getWorkoutPlan(userId);
      
      // Determine the correct stage based on actual data
      let computedStage = user.signupStage || "onboarding_incomplete";

      if (workoutPlan && (user.subscriptionStatus === "active" || user.subscriptionStatus === "trialing")) {
        computedStage = "complete";
      } else if (workoutPlan && profile) {
        // Plan exists but no subscription — need to pay
        computedStage = "payment_pending";
      } else if (profile) {
        // Profile exists but no plan — need to build plan
        computedStage = "plan_pending";
      }

      // Check if user has any messages (for routing complete users to dashboard vs QR screen)
      const hasMessages = computedStage === "complete" ? await storage.hasMessages(userId) : false;

      res.json({
        signupStage: computedStage,
        draftOnboardingData: user.draftOnboardingData,
        draftPlanData: user.draftPlanData,
        hasProfile: !!profile,
        hasWorkoutPlan: !!workoutPlan,
        hasMessages,
        subscriptionStatus: user.subscriptionStatus,
      });
    } catch (error) {
      console.error("Error fetching signup progress:", error);
      res.status(500).json({ error: "Failed to fetch signup progress" });
    }
  });

  app.patch("/api/signup-progress/draft", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: "User not authenticated" });
        return;
      }

      const draftData = req.body as DraftOnboardingData;
      const user = await storage.updateDraftOnboardingData(userId, draftData);

      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      res.json({ success: true, draftOnboardingData: user.draftOnboardingData });
    } catch (error) {
      console.error("Error updating draft onboarding data:", error);
      res.status(500).json({ error: "Failed to update draft data" });
    }
  });

  app.patch("/api/signup-progress/draft-plan", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: "User not authenticated" });
        return;
      }

      const draftData = req.body as DraftPlanData;
      console.log("[draft-plan save] userId:", userId, "messages:", draftData.messages?.length || 0, "plan:", draftData.plan ? "exists" : "null");

      const user = await storage.updateDraftPlanData(userId, draftData);

      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      console.log("[draft-plan save] saved, user.draftPlanData:", user.draftPlanData ? "exists" : "null");
      res.json({ success: true, draftPlanData: user.draftPlanData });
    } catch (error) {
      console.error("Error updating draft plan data:", error);
      res.status(500).json({ error: "Failed to update draft plan data" });
    }
  });

  // Workout plan routes (protected - requires active subscription to create)
  app.post("/api/workout-plan", isAuthenticated, requireActiveSubscription, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: "User not authenticated" });
        return;
      }

      // Archive any existing active plans before creating a new one
      await storage.archiveAllUserPlans(userId);

      // Extract messages for archiving, remove from plan data
      const { userId: _, messages, ...bodyWithoutUserId } = req.body;
      const validatedData = insertWorkoutPlanSchema.parse({
        ...bodyWithoutUserId,
        userId,
      });

      // Stamp exercise IDs on plan data before saving
      if (validatedData.planData) {
        stampExerciseIds(validatedData.planData as GeneratedPlan);
      }

      const plan = await storage.createWorkoutPlan(validatedData);

      // Archive the conversation messages if provided
      if (messages && Array.isArray(messages) && messages.length > 0) {
        await storage.archivePlanConversation(userId, plan.id, messages as PlanConversationMessage[]);
      } else {
        // Just clear the draft plan data if no messages to archive
        await storage.updateDraftPlanData(userId, null);
      }

      // Advance signup stage: plan built → payment pending (or complete if already paid)
      const currentUser = await storage.getUser(userId);
      if (currentUser?.signupStage === "plan_pending") {
        await storage.updateSignupStage(userId, "payment_pending");
      } else {
        await storage.updateSignupStage(userId, "complete");

        // Fire-and-forget: send welcome message with first workout via Python backend
        const AI_SERVICE_URL = process.env.AI_SERVICE_URL;
        const FRONTEND_APIKEY = process.env.FRONTEND_APIKEY;
        if (AI_SERVICE_URL) {
          const welcomeHeaders: Record<string, string> = { "Content-Type": "application/json" };
          if (FRONTEND_APIKEY) {
            welcomeHeaders["Authorization"] = `Bearer ${FRONTEND_APIKEY}`;
          }
          fetch(`${AI_SERVICE_URL}/api/send-welcome-message`, {
            method: "POST",
            headers: welcomeHeaders,
            body: JSON.stringify({ user_id: userId }),
          }).catch(err => console.error("Failed to send welcome message:", err));
        }
      }

      res.json(plan);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid workout plan data", details: error.errors });
      } else {
        console.error("Error creating workout plan:", error);
        res.status(500).json({ error: "Failed to create workout plan" });
      }
    }
  });

  // Get archived plans for a user
  app.get("/api/workout-plans/archived", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: "User not authenticated" });
        return;
      }

      const archivedPlans = await storage.getArchivedPlans(userId);
      res.json(archivedPlans);
    } catch (error) {
      console.error("Error fetching archived plans:", error);
      res.status(500).json({ error: "Failed to fetch archived plans" });
    }
  });

  app.get("/api/workout-plan/user/:userId", isAuthenticated, requireActiveSubscription, async (req: any, res) => {
    try {
      const authenticatedUserId = req.user?.id;
      const requestedUserId = req.params.userId;
      
      // Users can only access their own workout plan
      if (authenticatedUserId !== requestedUserId) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
      
      const plan = await storage.getWorkoutPlan(requestedUserId);
      if (!plan) {
        res.status(404).json({ error: "Workout plan not found" });
        return;
      }
      res.json(plan);
    } catch (error) {
      console.error("Error fetching workout plan:", error);
      res.status(500).json({ error: "Failed to fetch workout plan" });
    }
  });

  app.patch("/api/workout-plan/:id", isAuthenticated, requireActiveSubscription, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        res.status(400).json({ error: "Invalid workout plan ID" });
        return;
      }
      
      // Verify user owns this workout plan
      const existingPlan = await storage.getWorkoutPlanById(id);
      if (!existingPlan) {
        res.status(404).json({ error: "Workout plan not found" });
        return;
      }
      
      const userId = req.user?.id;
      if (existingPlan.userId !== userId) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
      
      const validatedData = insertWorkoutPlanSchema.partial().parse(req.body);
      // Remove userId to prevent ownership transfer
      const { userId: _, ...safeData } = validatedData;
      const plan = await storage.updateWorkoutPlan(id, safeData);
      res.json(plan);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid workout plan data", details: error.errors });
      } else {
        console.error("Error updating workout plan:", error);
        res.status(500).json({ error: "Failed to update workout plan" });
      }
    }
  });

  // Get all workout plans for a user (including archived)
  app.get("/api/workout-plans/user/:userId", isAuthenticated, requireActiveSubscription, async (req: any, res) => {
    try {
      const requestedUserId = req.params.userId;
      const authenticatedUserId = req.user?.id;

      if (requestedUserId !== authenticatedUserId) {
        res.status(403).json({ error: "Access denied" });
        return;
      }

      const plans = await storage.getAllWorkoutPlans(requestedUserId);
      res.json(plans);
    } catch (error) {
      console.error("Error fetching workout plans:", error);
      res.status(500).json({ error: "Failed to fetch workout plans" });
    }
  });

  // Activate a specific workout plan (sets it as active, archives others)
  app.post("/api/workout-plan/:id/activate", isAuthenticated, requireActiveSubscription, async (req: any, res) => {
    try {
      const planId = parseInt(req.params.id);
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({ error: "User not authenticated" });
        return;
      }

      if (isNaN(planId)) {
        res.status(400).json({ error: "Invalid plan ID" });
        return;
      }

      const activatedPlan = await storage.setActivePlan(userId, planId);

      if (!activatedPlan) {
        res.status(404).json({ error: "Plan not found or access denied" });
        return;
      }

      res.json(activatedPlan);
    } catch (error) {
      console.error("Error activating workout plan:", error);
      res.status(500).json({ error: "Failed to activate workout plan" });
    }
  });

  // Workout Session routes (for logging workouts - requires active subscription)
  app.get("/api/workout-sessions", isAuthenticated, requireActiveSubscription, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: "User not authenticated" });
        return;
      }

      const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);
      const offset = parseInt(req.query.offset as string) || 0;

      const [sessions, total] = await Promise.all([
        storage.getWorkoutSessions(userId, limit, offset),
        storage.getWorkoutSessionsCount(userId),
      ]);

      res.json({
        sessions,
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + sessions.length < total,
        },
      });
    } catch (error) {
      console.error("Error fetching workout sessions:", error);
      res.status(500).json({ error: "Failed to fetch workout sessions" });
    }
  });

  // Get all sessions for a specific week (by scheduled date range)
  // IMPORTANT: This route must be defined BEFORE /api/workout-sessions/:id
  app.get("/api/workout-sessions/week", isAuthenticated, requireActiveSubscription, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: "User not authenticated" });
        return;
      }

      // Parse week start date, default to current week's Monday
      let weekStart: Date;
      if (req.query.weekStart) {
        weekStart = new Date(req.query.weekStart as string);
      } else {
        // Get current week's Monday
        weekStart = new Date();
        const dayOfWeek = weekStart.getDay();
        const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // Adjust for Monday start
        weekStart.setDate(weekStart.getDate() + diff);
      }
      weekStart.setHours(0, 0, 0, 0);

      // Week end is Sunday
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);
      weekEnd.setHours(23, 59, 59, 999);

      const sessions = await storage.getWeekSessions(userId, weekStart, weekEnd);

      res.json({
        weekStart: weekStart.toISOString(),
        weekEnd: weekEnd.toISOString(),
        sessions,
      });
    } catch (error) {
      console.error("Error fetching week sessions:", error);
      res.status(500).json({ error: "Failed to fetch week sessions" });
    }
  });

  // Get workout history for a specific day slot (e.g., last 5 Fridays)
  // IMPORTANT: This route must be defined BEFORE /api/workout-sessions/:id
  app.get("/api/workout-sessions/history/:dayName", isAuthenticated, requireActiveSubscription, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: "User not authenticated" });
        return;
      }

      const { dayName } = req.params;
      const limit = Math.min(parseInt(req.query.limit as string) || 5, 20);

      const history = await storage.getWorkoutSlotHistory(userId, dayName, limit);

      res.json({
        dayName,
        history,
      });
    } catch (error) {
      console.error("Error fetching workout history:", error);
      res.status(500).json({ error: "Failed to fetch workout history" });
    }
  });

  // Start tracking a workout - creates session if needed and returns token
  // Now supports starting any workout (not just today's) by specifying scheduledFor
  // IMPORTANT: This route must be defined BEFORE /api/workout-sessions/:id to avoid matching "start" as an ID
  app.post("/api/workout-sessions/start", isAuthenticated, requireActiveSubscription, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: "User not authenticated" });
        return;
      }

      // Validate input - now accepts scheduledFor to specify which workout slot
      const startWorkoutSchema = z.object({
        planId: z.number().int().positive(),
        dayIndex: z.number().int().min(0),
        dayName: z.string().min(1).max(50),
        focus: z.string().min(1).max(100),
        scheduledFor: z.string().optional(), // ISO date string for which day this workout is for
      });

      const { planId, dayIndex, dayName, focus, scheduledFor } = startWorkoutSchema.parse(req.body);

      // Use scheduledFor if provided, otherwise default to today
      const scheduledDate = scheduledFor ? new Date(scheduledFor) : new Date();
      const today = new Date();

      // Check if session already exists for this scheduled slot
      let session = await storage.getWorkoutSessionByScheduledDate(userId, scheduledDate, dayName);

      if (!session) {
        // Create new session for this workout slot
        session = await storage.createWorkoutSession({
          userId,
          planId,
          workoutDate: today,        // When actually performed
          scheduledFor: scheduledDate, // Which slot this belongs to
          dayIndex,
          dayName,
          focus,
          status: "pending",
        });
      }

      // Check if there's an existing valid token for this session
      let tokenData = await storage.getTokenForSession(session.id);

      if (!tokenData) {
        // Create new token (expires in 7 days)
        tokenData = await storage.createSessionToken(session.id, 7);
      }

      res.json({ token: tokenData.token, sessionId: session.id });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid request data", details: error.errors });
      } else {
        console.error("Error starting workout:", error);
        res.status(500).json({ error: "Failed to start workout tracking" });
      }
    }
  });

  // Legacy endpoint - redirects to new /start endpoint
  app.post("/api/workout-sessions/start-today", isAuthenticated, requireActiveSubscription, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: "User not authenticated" });
        return;
      }

      const startTodaySchema = z.object({
        planId: z.number().int().positive(),
        dayIndex: z.number().int().min(0),
        dayName: z.string().min(1).max(50),
        focus: z.string().min(1).max(100),
      });

      const { planId, dayIndex, dayName, focus } = startTodaySchema.parse(req.body);

      const today = new Date();

      // Check by scheduled date now
      let session = await storage.getWorkoutSessionByScheduledDate(userId, today, dayName);

      if (!session) {
        session = await storage.createWorkoutSession({
          userId,
          planId,
          workoutDate: today,
          scheduledFor: today,
          dayIndex,
          dayName,
          focus,
          status: "pending",
        });
      }

      let tokenData = await storage.getTokenForSession(session.id);

      if (!tokenData) {
        tokenData = await storage.createSessionToken(session.id, 7);
      }

      res.json({ token: tokenData.token, sessionId: session.id });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid request data", details: error.errors });
      } else {
        console.error("Error starting today's workout:", error);
        res.status(500).json({ error: "Failed to start workout tracking" });
      }
    }
  });

  app.get("/api/workout-sessions/:id", isAuthenticated, requireActiveSubscription, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        res.status(400).json({ error: "Invalid session ID" });
        return;
      }
      
      const session = await storage.getWorkoutSessionById(id);
      if (!session) {
        res.status(404).json({ error: "Workout session not found" });
        return;
      }
      
      // Verify user owns this session
      const userId = req.user?.id;
      if (session.userId !== userId) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
      
      const sets = await storage.getWorkoutSets(id);
      res.json({ session, sets });
    } catch (error) {
      console.error("Error fetching workout session:", error);
      res.status(500).json({ error: "Failed to fetch workout session" });
    }
  });

  app.post("/api/workout-sessions", isAuthenticated, requireActiveSubscription, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: "User not authenticated" });
        return;
      }
      
      const validatedData = insertWorkoutSessionSchema.parse({
        ...req.body,
        userId,
      });
      
      // Ensure user can only create their own sessions
      if (validatedData.userId !== userId) {
        res.status(403).json({ error: "Cannot create session for another user" });
        return;
      }
      
      const session = await storage.createWorkoutSession(validatedData);
      res.json(session);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid session data", details: error.errors });
      } else {
        console.error("Error creating workout session:", error);
        res.status(500).json({ error: "Failed to create workout session" });
      }
    }
  });

  app.patch("/api/workout-sessions/:id", isAuthenticated, requireActiveSubscription, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        res.status(400).json({ error: "Invalid session ID" });
        return;
      }
      
      // Verify user owns this session
      const existingSession = await storage.getWorkoutSessionById(id);
      if (!existingSession) {
        res.status(404).json({ error: "Session not found" });
        return;
      }
      
      const userId = req.user?.id;
      if (existingSession.userId !== userId) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
      
      const validatedData = insertWorkoutSessionSchema.partial().parse(req.body);
      // Remove userId and planId to prevent ownership transfer
      const { userId: _userId, planId: _planId, ...safeData } = validatedData;
      const session = await storage.updateWorkoutSession(id, safeData);
      res.json(session);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid session data", details: error.errors });
      } else {
        console.error("Error updating workout session:", error);
        res.status(500).json({ error: "Failed to update workout session" });
      }
    }
  });

  // Workout Sets routes (requires active subscription)
  app.post("/api/workout-sessions/:sessionId/sets", isAuthenticated, requireActiveSubscription, async (req: any, res) => {
    try {
      const sessionId = parseInt(req.params.sessionId);
      if (isNaN(sessionId)) {
        res.status(400).json({ error: "Invalid session ID" });
        return;
      }
      
      // Verify user owns this session
      const session = await storage.getWorkoutSessionById(sessionId);
      if (!session) {
        res.status(404).json({ error: "Session not found" });
        return;
      }
      
      const userId = req.user?.id;
      if (session.userId !== userId) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
      
      // Handle both single set and array of sets
      const sets = Array.isArray(req.body) ? req.body : [req.body];
      const validatedSets = sets.map((set: Record<string, unknown>) => insertWorkoutSetSchema.parse({
        ...set,
        sessionId,
      }));
      
      const createdSets = await storage.createWorkoutSets(validatedSets);
      res.json(createdSets);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid set data", details: error.errors });
      } else {
        console.error("Error creating workout sets:", error);
        res.status(500).json({ error: "Failed to create workout sets" });
      }
    }
  });

  app.patch("/api/workout-sets/:id", isAuthenticated, requireActiveSubscription, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        res.status(400).json({ error: "Invalid set ID" });
        return;
      }
      
      // Verify user owns this set via its session
      const existingSet = await storage.getWorkoutSetById(id);
      if (!existingSet) {
        res.status(404).json({ error: "Workout set not found" });
        return;
      }
      
      const session = await storage.getWorkoutSessionById(existingSet.sessionId);
      if (!session) {
        res.status(404).json({ error: "Parent session not found" });
        return;
      }
      
      const userId = req.user?.id;
      if (session.userId !== userId) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
      
      const validatedData = insertWorkoutSetSchema.partial().parse(req.body);
      // Remove sessionId to prevent reassigning to different session
      const { sessionId: _, ...safeData } = validatedData;
      const set = await storage.updateWorkoutSet(id, safeData);
      res.json(set);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid set data", details: error.errors });
      } else {
        console.error("Error updating workout set:", error);
        res.status(500).json({ error: "Failed to update workout set" });
      }
    }
  });

  app.delete("/api/workout-sets/:id", isAuthenticated, requireActiveSubscription, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        res.status(400).json({ error: "Invalid set ID" });
        return;
      }
      
      // Verify user owns this set via its session
      const existingSet = await storage.getWorkoutSetById(id);
      if (!existingSet) {
        res.status(404).json({ error: "Workout set not found" });
        return;
      }
      
      const session = await storage.getWorkoutSessionById(existingSet.sessionId);
      if (!session) {
        res.status(404).json({ error: "Parent session not found" });
        return;
      }
      
      const userId = req.user?.id;
      if (session.userId !== userId) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
      
      await storage.deleteWorkoutSet(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting workout set:", error);
      res.status(500).json({ error: "Failed to delete workout set" });
    }
  });

  // AI Workout Plan Generation (with strict rate limiting + subscription verification)
  app.post("/api/generate-plan", isAuthenticated, requireActiveSubscription, planGenerationLimiter, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: "User not authenticated" });
        return;
      }

      // Check if plan already exists in draft (may have been generated in background during payment)
      const user = await storage.getUser(userId);
      if (user?.draftPlanData?.plan) {
        console.log("[generate-plan] Returning existing draft plan for user:", userId);
        // Get coachNotes from the first message in draft
        const coachNotes = user.draftPlanData.messages?.[0]?.text || null;
        res.json({ plan: user.draftPlanData.plan, coachNotes });
        return;
      }

      // Check if there's an active generation in progress (started during profile creation)
      if (activeGenerations.has(userId)) {
        console.log("[generate-plan] Waiting for active background generation for user:", userId);
        try {
          const result = await activeGenerations.get(userId);
          // The background job saves to draftPlanData, but let's return it directly
          console.log("[generate-plan] Background generation completed, returning plan for user:", userId);
          res.json({ plan: result?.plan, coachNotes: result?.coachNotes });
          return;
        } catch (err) {
          console.error("[generate-plan] Background generation failed, will retry for user:", userId, err);
          // Fall through to generate a new plan
        }
      }

      const profile = await storage.getProfile(userId);
      console.log("[generate-plan] Profile notes:", profile?.notes);
      console.log("[generate-plan] Full profile:", JSON.stringify(profile, null, 2));
      if (!profile) {
        res.status(404).json({ error: "Profile not found. Please complete onboarding first." });
        return;
      }

      // Get workout image, useExactPlan, planMode from draft data (fallback to profile for planMode)
      const workoutImage = user?.draftOnboardingData?.workoutImage || null;
      const useExactPlan = user?.draftOnboardingData?.useExactPlan ?? false;
      const planMode = user?.draftOnboardingData?.planMode || profile.planMode || null;
      if (workoutImage) {
        console.log("[generate-plan] Found workout image in draft data, useExactPlan:", useExactPlan);
      }

      console.log("[generate-plan] Generating new plan for user:", userId, "planMode:", planMode);
      const result = await generateWorkoutPlan(profile, workoutImage, useExactPlan, planMode);

      // Save to draft immediately so plan isn't lost if client disconnects
      // Use coachNotes from AI response, or fallback to default message
      const defaultMessage = "I've analyzed your profile and created a personalized workout plan based on your goals, experience, and available equipment. You can review it on the left, or ask me to make any changes.";
      const welcomeMessage: PlanConversationMessage = {
        id: "welcome",
        sender: "ai",
        text: result.coachNotes || defaultMessage,
        timestamp: new Date().toISOString(),
      };

      // Stamp exercise IDs on generated plan
      stampExerciseIds(result.plan);

      await storage.updateDraftPlanData(userId, {
        plan: result.plan,
        messages: [welcomeMessage],
        updatedAt: new Date().toISOString(),
      });

      res.json({ plan: result.plan, coachNotes: result.coachNotes });
    } catch (error) {
      console.error("Error generating workout plan:", error);
      if (error instanceof AIServiceError) {
        res.status(503).json({
          error: error.userMessage,
          retryable: error.isRetryable
        });
      } else {
        res.status(500).json({
          error: "Failed to generate workout plan. Please try again.",
          retryable: true
        });
      }
    }
  });

  // Coach chat (with subscription verification)
  app.post("/api/coach-chat", isAuthenticated, requireActiveSubscription, coachChatLimiter, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: "User not authenticated" });
        return;
      }
      
      const { message, currentPlan, conversationHistory, preferences } = req.body;

      if (!message) {
        res.status(400).json({ error: "Message is required" });
        return;
      }

      if (typeof message !== 'string' || message.length > 2000) {
        res.status(400).json({ error: "Message must be 2000 characters or less" });
        return;
      }

      const profile = await storage.getProfile(userId);
      if (!profile) {
        res.status(404).json({ error: "Profile not found" });
        return;
      }

      // Validate and limit conversation history to prevent abuse
      const validHistory = Array.isArray(conversationHistory)
        ? conversationHistory.slice(-10).filter(
            (m: any) => m && typeof m.text === 'string' && ['ai', 'user'].includes(m.sender)
          )
        : [];

      const result = await handleChatMessage(message, currentPlan, profile, validHistory);

      // If the plan was updated, stamp exercise IDs (preserving existing) and save to draft
      if (result.updatedPlan) {
        stampExerciseIds(result.updatedPlan, currentPlan);
        // Build updated conversation history
        const updatedMessages: PlanConversationMessage[] = [
          ...validHistory.map((m: any) => ({
            id: m.id || String(Date.now()),
            sender: m.sender as "ai" | "user",
            text: m.text,
            timestamp: m.timestamp || new Date().toISOString(),
          })),
          {
            id: String(Date.now()),
            sender: "user" as const,
            text: message,
            timestamp: new Date().toISOString(),
          },
          {
            id: String(Date.now() + 1),
            sender: "ai" as const,
            text: result.response,
            timestamp: new Date().toISOString(),
          },
        ];

        await storage.updateDraftPlanData(userId, {
          plan: result.updatedPlan,
          messages: updatedMessages,
          updatedAt: new Date().toISOString(),
        });
      }

      res.json(result);
    } catch (error) {
      console.error("Error in coach chat:", error);
      res.status(500).json({ error: "Failed to process message" });
    }
  });

  // Stripe routes
  app.get("/api/stripe/config", async (req, res) => {
    try {
      const publishableKey = await getStripePublishableKey();
      res.json({ publishableKey });
    } catch (error) {
      console.error("Error getting Stripe config:", error);
      res.status(500).json({ error: "Failed to get Stripe config" });
    }
  });

  app.get("/api/stripe/prices", async (req, res) => {
    try {
      const yearlyPriceId = process.env.STRIPE_YEARLY_PRICE_ID;
      const monthlyPriceId = process.env.STRIPE_MONTHLY_PRICE_ID;

      if (!yearlyPriceId || !monthlyPriceId) {
        throw new Error('STRIPE_YEARLY_PRICE_ID and STRIPE_MONTHLY_PRICE_ID environment variables are required');
      }

      const [yearlyPrice, monthlyPrice] = await Promise.all([
        stripe.prices.retrieve(yearlyPriceId, { expand: ['product'] }),
        stripe.prices.retrieve(monthlyPriceId, { expand: ['product'] }),
      ]);

      const formatPrice = (price: any) => {
        const product = price.product as any;
        return {
          product_id: product?.id,
          product_name: product?.name,
          product_description: product?.description,
          price_id: price.id,
          unit_amount: price.unit_amount,
          currency: price.currency,
          recurring: price.recurring,
        };
      };

      const prices = [formatPrice(yearlyPrice), formatPrice(monthlyPrice)];

      res.json({ prices });
    } catch (error: any) {
      console.error("Error fetching prices:", error);
      if (error?.type) {
        console.error("Stripe error type:", error.type);
        console.error("Stripe error message:", error.message);
        console.error("Stripe error code:", error.code);
      }
      res.status(500).json({
        error: "Failed to fetch prices",
        details: error?.message || "Unknown error"
      });
    }
  });

  // Create SetupIntent for collecting payment method (no subscription yet)
  app.post("/api/stripe/create-setup-intent", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      const { email } = req.body;

      if (!userId) {
        res.status(401).json({ error: "User not authenticated" });
        return;
      }

      // Check if user already has an active subscription
      const existingUser = await storage.getUser(userId);
      if (existingUser?.subscriptionStatus === 'active') {
        res.status(400).json({ error: "You already have an active subscription" });
        return;
      }

      // Get user email from auth or request body
      const userEmail = email || req.user?.email;

      // Create or find customer
      let customer;
      if (existingUser?.stripeCustomerId) {
        // Use existing customer
        customer = await stripe.customers.retrieve(existingUser.stripeCustomerId);
      } else if (userEmail) {
        const existingCustomers = await stripe.customers.list({ email: userEmail, limit: 1 });
        if (existingCustomers.data.length > 0) {
          customer = existingCustomers.data[0];
          if (!customer.metadata?.userId) {
            await stripe.customers.update(customer.id, {
              metadata: { userId },
            });
          }
        } else {
          customer = await stripe.customers.create({
            email: userEmail,
            metadata: { userId },
          });
        }
      } else {
        customer = await stripe.customers.create({
          metadata: { userId },
        });
      }

      // Create SetupIntent for collecting payment method
      const setupIntent = await stripe.setupIntents.create({
        customer: customer.id,
        automatic_payment_methods: { enabled: true },
        metadata: { userId },
      });

      // Try to create Customer Session for Link auto-recognition (requires customer_session_write permission)
      let customerSessionSecret: string | undefined;
      try {
        const customerSession = await stripe.customerSessions.create({
          customer: customer.id,
          components: {
            payment_element: {
              enabled: true,
              features: {
                payment_method_save: 'enabled',
                payment_method_redisplay: 'enabled',
              },
            },
          },
        });
        customerSessionSecret = customerSession.client_secret;
      } catch (csError: any) {
        console.warn("Customer Session creation skipped (key may lack permission):", csError.message);
      }

      res.json({
        clientSecret: setupIntent.client_secret,
        customerId: customer.id,
        ...(customerSessionSecret ? { customerSessionClientSecret: customerSessionSecret } : {}),
      });
    } catch (error: any) {
      console.error("Error creating setup intent:", error);
      res.status(500).json({
        error: "Failed to create setup intent",
        details: error?.message || "Unknown error"
      });
    }
  });

  // Validate promo code
  app.post("/api/stripe/validate-coupon", isAuthenticated, async (req: any, res) => {
    try {
      const { couponId } = req.body;

      if (!couponId) {
        res.status(400).json({ error: "Promo code required" });
        return;
      }

      // Look up the promotion code in Stripe (expand coupon to get full details)
      const promotionCodes = await stripe.promotionCodes.list({
        code: couponId.toUpperCase(),
        active: true,
        limit: 1,
        expand: ['data.coupon'],
      });

      if (promotionCodes.data.length === 0) {
        res.status(400).json({ error: "Invalid promo code" });
        return;
      }

      const promoCode = promotionCodes.data[0];
      console.log("[Coupon] PromoCode:", JSON.stringify(promoCode, null, 2));

      // Get the coupon ID - handle different API response structures
      // (older API versions expose `coupon` at the top level; newer ones nest it under `promotion.coupon`)
      let stripeCouponId: string | null = null;
      const rawCoupon = (promoCode as any).coupon ?? promoCode.promotion?.coupon;
      if (typeof rawCoupon === 'string') {
        stripeCouponId = rawCoupon;
      } else if (rawCoupon && typeof rawCoupon === 'object') {
        stripeCouponId = rawCoupon.id;
      }

      if (!stripeCouponId) {
        console.error("[Coupon] Could not find coupon ID");
        res.status(400).json({ error: "Invalid promo code structure" });
        return;
      }

      // Fetch the coupon details directly
      console.log("[Coupon] Fetching coupon:", stripeCouponId);
      const coupon = await stripe.coupons.retrieve(stripeCouponId);
      console.log("[Coupon] Coupon details:", JSON.stringify(coupon, null, 2));

      // Check if coupon is valid
      if (!coupon.valid) {
        res.status(400).json({ error: "This promo code has expired" });
        return;
      }

      res.json({
        id: promoCode.id,
        percent_off: coupon?.percent_off ?? null,
        amount_off: coupon?.amount_off ?? null,
        duration: coupon?.duration ?? null,
        duration_in_months: coupon?.duration_in_months ?? null,
      });
    } catch (error: any) {
      console.error("Promo code validation error:", error);
      res.status(500).json({ error: "Failed to validate promo code" });
    }
  });

  // Create subscription with payment method (deferred intent flow)
  app.post("/api/stripe/create-subscription-with-pm", isAuthenticated, async (req: any, res) => {
    try {
      const { priceId, paymentMethodId, couponId: promotionCodeId } = req.body;
      const userId = req.user?.id;
      const userEmail = req.user?.email;

      if (!userId) {
        res.status(401).json({ error: "User not authenticated" });
        return;
      }

      if (!priceId) {
        res.status(400).json({ error: "Price ID is required" });
        return;
      }

      // Check if user already has an active subscription
      const existingUser = await storage.getUser(userId);
      if (existingUser?.subscriptionStatus === 'active') {
        res.status(400).json({ error: "You already have an active subscription" });
        return;
      }

      // Cancel any existing incomplete/trialing subscription
      if (existingUser?.stripeSubscriptionId) {
        try {
          const existingSub = await stripe.subscriptions.retrieve(existingUser.stripeSubscriptionId);
          if (existingSub.status === 'incomplete' || existingSub.status === 'trialing') {
            await stripe.subscriptions.cancel(existingSub.id);
            console.log(`Canceled existing ${existingSub.status} subscription: ${existingSub.id}`);
          }
        } catch (err) {
          console.log("Could not retrieve/cancel existing subscription, continuing...");
        }
      }

      // Get or create customer
      let customerId = existingUser?.stripeCustomerId;

      if (!customerId) {
        // Check if customer exists by email
        if (userEmail) {
          const existingCustomers = await stripe.customers.list({ email: userEmail, limit: 1 });
          if (existingCustomers.data.length > 0) {
            customerId = existingCustomers.data[0].id;
          }
        }

        // Create new customer if not found
        if (!customerId) {
          const customer = await stripe.customers.create({
            email: userEmail,
            metadata: { userId },
          });
          customerId = customer.id;
        }
      }

      // Attach payment method to customer and set as default (if provided)
      if (paymentMethodId) {
        try {
          await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
        } catch (e: any) {
          // After confirmSetup, Stripe auto-attaches the PM — ignore that error
          if (!e.message?.includes('already been attached')) throw e;
        }
        await stripe.customers.update(customerId, {
          invoice_settings: { default_payment_method: paymentMethodId },
        });
      }

      // Build subscription options
      const subscriptionOptions: any = {
        customer: customerId,
        items: [{ price: priceId }],
        metadata: { userId },
      };

      if (paymentMethodId) {
        subscriptionOptions.default_payment_method = paymentMethodId;
      }

      if (promotionCodeId) {
        // Fetch promo code to check coupon details
        const promoCode = await stripe.promotionCodes.retrieve(promotionCodeId) as any;
        // Coupon can be at promoCode.coupon (expanded) or promoCode.promotion.coupon (string ID)
        const couponRef = promoCode.coupon ?? promoCode.promotion?.coupon;
        const coupon = typeof couponRef === 'string'
          ? await stripe.coupons.retrieve(couponRef)
          : couponRef;

        subscriptionOptions.discounts = [{ promotion_code: promotionCodeId }];

        if (coupon.percent_off === 100) {
          // 100% off — no trial, no card needed
          // When free period ends, no card on file → past_due → cancels naturally
          subscriptionOptions.payment_behavior = 'allow_incomplete';
        } else {
          subscriptionOptions.trial_period_days = 7;
        }
      } else {
        // No coupon - standard 7-day trial
        subscriptionOptions.trial_period_days = 7;
      }

      const subscription = await stripe.subscriptions.create(subscriptionOptions);

      // Update user's Stripe info and advance to complete
      await storage.updateUserStripeInfo(userId, customerId, subscription.id, subscription.status);
      await storage.updateSignupStage(userId, "complete");

      // Fire-and-forget: send welcome message with first workout via Python backend
      const AI_SERVICE_URL = process.env.AI_SERVICE_URL;
      const FRONTEND_APIKEY = process.env.FRONTEND_APIKEY;
      if (AI_SERVICE_URL) {
        const welcomeHeaders: Record<string, string> = { "Content-Type": "application/json" };
        if (FRONTEND_APIKEY) {
          welcomeHeaders["Authorization"] = `Bearer ${FRONTEND_APIKEY}`;
        }
        fetch(`${AI_SERVICE_URL}/api/send-welcome-message`, {
          method: "POST",
          headers: welcomeHeaders,
          body: JSON.stringify({ user_id: userId }),
        }).catch(err => console.error("Failed to send welcome message:", err));
      }

      // Check if setup intent requires action (3DS)
      const setupIntent = subscription.pending_setup_intent;
      if (setupIntent && typeof setupIntent === 'object' && setupIntent.status === 'requires_action') {
        res.json({
          subscriptionId: subscription.id,
          status: 'requires_action',
          clientSecret: setupIntent.client_secret,
        });
        return;
      }

      res.json({
        subscriptionId: subscription.id,
        status: subscription.status,
      });
    } catch (error: any) {
      console.error("Error creating subscription with payment method:", error);
      res.status(500).json({
        error: "Failed to create subscription",
        details: error?.message || "Unknown error"
      });
    }
  });

  app.post("/api/stripe/create-subscription", isAuthenticated, async (req: any, res) => {
    try {
      const { priceId, email } = req.body;
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({ error: "User not authenticated" });
        return;
      }

      if (!priceId) {
        res.status(400).json({ error: "Price ID is required" });
        return;
      }

      // Check if user already has a PAID active subscription (not incomplete or trialing)
      const existingUser = await storage.getUser(userId);
      if (existingUser?.subscriptionStatus === 'active') {
        res.status(400).json({ error: "You already have an active subscription" });
        return;
      }

      // Cancel any existing incomplete/trialing subscription before creating new one
      // This handles the case when user switches plans (yearly → monthly → yearly)
      if (existingUser?.stripeSubscriptionId) {
        try {
          const existingSub = await stripe.subscriptions.retrieve(existingUser.stripeSubscriptionId);
          if (existingSub.status === 'incomplete' || existingSub.status === 'trialing') {
            await stripe.subscriptions.cancel(existingSub.id);
            console.log(`Canceled existing ${existingSub.status} subscription: ${existingSub.id}`);
          }
        } catch (err) {
          // Subscription may not exist anymore, continue
          console.log("Could not retrieve/cancel existing subscription, continuing...");
        }
      }

      // Generate idempotency key with timestamp to allow creating new subscriptions for same price
      // This is needed when user switches plans back and forth (yearly → monthly → yearly)
      const idempotencyKey = `sub_${userId}_${priceId}_${Date.now()}`;

      // Get user email from auth or request body
      const userEmail = email || req.user?.email;

      // Create or find customer
      let customer;
      if (userEmail) {
        const existingCustomers = await stripe.customers.list({ email: userEmail, limit: 1 });
        if (existingCustomers.data.length > 0) {
          customer = existingCustomers.data[0];
          // Update metadata if needed
          if (!customer.metadata?.userId) {
            await stripe.customers.update(customer.id, {
              metadata: { userId },
            });
          }
        } else {
          customer = await stripe.customers.create({
            email: userEmail,
            metadata: { userId },
          });
        }
      } else {
        customer = await stripe.customers.create({
          metadata: { userId },
        });
      }

      // Create subscription with 7-day free trial
      // Using confirmation_secret for 2025 API version
      const subscription = await stripe.subscriptions.create({
        customer: customer.id,
        items: [{ price: priceId }],
        trial_period_days: 7,
        payment_behavior: 'default_incomplete',
        payment_settings: { save_default_payment_method: 'on_subscription' },
        metadata: { userId },
        expand: ['latest_invoice.confirmation_secret', 'pending_setup_intent'],
      }, {
        idempotencyKey,
      });

      // Link user to Stripe immediately (status will be updated by webhook or confirm-payment)
      await storage.updateUserStripeInfo(userId, customer.id, subscription.id, subscription.status);

      // Get client_secret from confirmation_secret or pending_setup_intent
      let clientSecret: string | null = null;
      const latestInvoice = subscription.latest_invoice as any;
      const pendingSetupIntent = subscription.pending_setup_intent as any;

      if (pendingSetupIntent?.client_secret) {
        clientSecret = pendingSetupIntent.client_secret;
      } else if (latestInvoice?.confirmation_secret?.client_secret) {
        clientSecret = latestInvoice.confirmation_secret.client_secret;
      }

      if (!clientSecret) {
        console.error("No client_secret found for subscription:", subscription.id);
        res.status(500).json({ error: "Failed to create payment intent" });
        return;
      }

      res.json({
        clientSecret,
        subscriptionId: subscription.id,
        customerId: customer.id,
      });
    } catch (error: any) {
      console.error("Error creating subscription:", error);
      // Log detailed Stripe error for debugging
      if (error?.type) {
        console.error("Stripe error type:", error.type);
        console.error("Stripe error message:", error.message);
        console.error("Stripe error code:", error.code);
        console.error("Stripe error param:", error.param);
      }
      res.status(500).json({
        error: "Failed to create subscription",
        details: error?.message || "Unknown error"
      });
    }
  });

  // Confirm payment and update user subscription status
  app.post("/api/stripe/confirm-payment", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: "User not authenticated" });
        return;
      }

      const { subscriptionId, customerId } = req.body;
      
      if (!subscriptionId || !customerId) {
        res.status(400).json({ error: "Subscription ID and Customer ID are required" });
        return;
      }

      // Update user's subscription status to active
      await storage.updateUserStripeInfo(userId, customerId, subscriptionId, "active");

      res.json({ success: true });
    } catch (error) {
      console.error("Error confirming payment:", error);
      res.status(500).json({ error: "Failed to confirm payment" });
    }
  });

  app.get("/api/stripe/session-status", async (req, res) => {
    try {
      const sessionId = req.query.session_id as string;
      if (!sessionId) {
        res.status(400).json({ error: "Session ID required" });
        return;
      }

      const session = await stripe.checkout.sessions.retrieve(sessionId);

      res.json({
        status: session.status,
        customerEmail: session.customer_details?.email
      });
    } catch (error) {
      console.error("Error retrieving session:", error);
      res.status(500).json({ error: "Failed to retrieve session" });
    }
  });

  // Promo code routes
  app.post("/api/promo/validate", isAuthenticated, async (req: any, res) => {
    try {
      const { code } = req.body;
      const userId = req.user?.id;
      
      if (!code) {
        res.status(400).json({ error: "Promo code is required" });
        return;
      }

      if (!userId) {
        res.status(401).json({ error: "User not authenticated" });
        return;
      }

      const promoCode = await storage.getPromoCodeByCode(code);
      
      if (!promoCode) {
        res.status(404).json({ error: "Invalid promo code" });
        return;
      }

      if (!promoCode.isActive) {
        res.status(400).json({ error: "This promo code is no longer active" });
        return;
      }

      if (promoCode.expiresAt && new Date(promoCode.expiresAt) < new Date()) {
        res.status(400).json({ error: "This promo code has expired" });
        return;
      }

      if (promoCode.maxUses && promoCode.currentUses >= promoCode.maxUses) {
        res.status(400).json({ error: "This promo code has reached its usage limit" });
        return;
      }

      const existingRedemption = await storage.getPromoRedemption(promoCode.id, userId);
      if (existingRedemption) {
        res.status(400).json({ error: "You have already used this promo code" });
        return;
      }

      res.json({ 
        valid: true, 
        code: promoCode.code,
        description: promoCode.description 
      });
    } catch (error) {
      console.error("Error validating promo code:", error);
      res.status(500).json({ error: "Failed to validate promo code" });
    }
  });

  app.post("/api/promo/redeem", isAuthenticated, async (req: any, res) => {
    try {
      const { code } = req.body;
      const userId = req.user?.id;
      
      if (!code) {
        res.status(400).json({ error: "Promo code is required" });
        return;
      }

      if (!userId) {
        res.status(401).json({ error: "User not authenticated" });
        return;
      }

      const promoCode = await storage.getPromoCodeByCode(code);
      
      if (!promoCode) {
        res.status(404).json({ error: "Invalid promo code" });
        return;
      }

      if (!promoCode.isActive) {
        res.status(400).json({ error: "This promo code is no longer active" });
        return;
      }

      if (promoCode.expiresAt && new Date(promoCode.expiresAt) < new Date()) {
        res.status(400).json({ error: "This promo code has expired" });
        return;
      }

      if (promoCode.maxUses && promoCode.currentUses >= promoCode.maxUses) {
        res.status(400).json({ error: "This promo code has reached its usage limit" });
        return;
      }

      const result = await storage.redeemPromoCodeAtomic(promoCode.id, userId);
      
      if (!result.success) {
        res.status(400).json({ error: result.error });
        return;
      }

      // Update user's subscription status to "active" so they can proceed to plan generation
      await storage.updateUserStripeInfo(userId, "promo", "promo", "active");

      res.json({
        success: true,
        message: "Promo code redeemed successfully"
      });
    } catch (error) {
      console.error("Error redeeming promo code:", error);
      res.status(500).json({ error: "Failed to redeem promo code" });
    }
  });

  // Feedback endpoint - sends email via Resend
  const feedbackLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5, // 5 feedback submissions per hour
    message: { error: "Too many feedback submissions. Please try again later." },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: getUserKey,
    validate: { xForwardedForHeader: false },
  });

  const feedbackSchema = z.object({
    message: z.string().min(1, "Message is required").max(2000, "Message too long"),
    category: z.enum(["bug", "feature", "question", "other"]),
  });

  app.post("/api/feedback", isAuthenticated, feedbackLimiter, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: "User not authenticated" });
        return;
      }

      // Validate input
      const parseResult = feedbackSchema.safeParse(req.body);
      if (!parseResult.success) {
        res.status(400).json({ error: parseResult.error.errors[0].message });
        return;
      }

      const { message, category } = parseResult.data;

      // Get user details
      const user = await storage.getUser(userId);
      const profile = await storage.getProfile(userId);

      const userEmail = user?.email || "No email";
      const userName = profile?.name || user?.firstName || "Unknown";
      const userPhone = profile?.phone || "No phone";

      // Format category for display
      const categoryLabels: Record<string, string> = {
        bug: "Bug Report",
        feature: "Feature Request",
        question: "Question",
        other: "Other",
      };
      const categoryLabel = categoryLabels[category] || category;

      // Initialize Resend
      const resendApiKey = process.env.RESEND_API_KEY;
      console.log("[feedback] API key exists:", !!resendApiKey, "length:", resendApiKey?.length);
      if (!resendApiKey) {
        console.error("RESEND_API_KEY not configured");
        res.status(500).json({ error: "Email service not configured" });
        return;
      }

      const resend = new Resend(resendApiKey);

      console.log("[feedback] Sending email from:", userName, "category:", categoryLabel);

      // Send email
      const { data: emailData, error: emailError } = await resend.emails.send({
        from: "Brandon Feedback <noreply@textbrandon.now>",
        to: "support@textbrandon.now",
        replyTo: userEmail !== "No email" ? userEmail : undefined,
        subject: `[${categoryLabel}] Feedback from ${userName}`,
        text: `${userName}
${userEmail} · ${userPhone}

${message}`,
      });

      console.log("[feedback] Resend response - data:", emailData, "error:", emailError);

      if (emailError) {
        console.error("Resend error:", emailError);
        res.status(500).json({ error: "Failed to send feedback" });
        return;
      }

      console.log("[feedback] Email sent successfully, id:", emailData?.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error sending feedback:", error);
      res.status(500).json({ error: "Failed to send feedback" });
    }
  });

  return httpServer;
}
