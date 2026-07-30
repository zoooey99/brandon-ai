import { eq, and, desc, sql, ne, inArray, max } from "drizzle-orm";
import { db, withDbRetry } from "./db";
import {
  users,
  profiles,
  workoutPlans,
  workoutSessions,
  workoutSets,
  sessionTokens,
  planDrafts,
  promoCodes,
  promoRedemptions,
  phoneVerifications,
  type User,
  type Profile,
  type InsertProfile,
  type WorkoutPlan,
  type InsertWorkoutPlan,
  type WorkoutSession,
  type InsertWorkoutSession,
  type WorkoutSet,
  type InsertWorkoutSet,
  type SessionToken,
  type PlanDraft,
  type SignupStage,
  type DraftOnboardingData,
  type DraftPlanData,
  type ArchivedPlanConversation,
  type PlanConversationMessage,
  type PromoCode,
  type InsertPromoCode,
  type PromoRedemption,
  type InsertPromoRedemption,
  type PhoneVerification,
} from "@shared/schema";
import { nanoid } from "nanoid";
import { randomUUID } from "crypto";

export interface IStorage {
  // User operations (now using auth system - string IDs)
  getUser(id: string): Promise<User | undefined>;
  getUserByStripeCustomerId(stripeCustomerId: string): Promise<User | undefined>;
  updateUserStripeInfo(userId: string, stripeCustomerId: string, stripeSubscriptionId: string, subscriptionStatus: string): Promise<User | undefined>;
  updateSignupStage(userId: string, stage: SignupStage): Promise<User | undefined>;
  updateDraftOnboardingData(userId: string, draftData: DraftOnboardingData): Promise<User | undefined>;
  updateDraftPlanData(userId: string, draftData: DraftPlanData | null): Promise<User | undefined>;
  archivePlanConversation(userId: string, planId: number, messages: PlanConversationMessage[]): Promise<User | undefined>;

  // Profile operations
  getProfile(userId: string): Promise<Profile | undefined>;
  getProfileById(id: number): Promise<Profile | undefined>;
  getProfileByPhone(phone: string): Promise<Profile | undefined>;
  createProfile(profile: InsertProfile): Promise<Profile>;
  updateProfile(id: number, profile: Partial<InsertProfile>): Promise<Profile | undefined>;

  // Workout plan operations
  getWorkoutPlan(userId: string): Promise<WorkoutPlan | undefined>;
  getWorkoutPlanById(id: number): Promise<WorkoutPlan | undefined>;
  getAllWorkoutPlans(userId: string): Promise<WorkoutPlan[]>;
  getArchivedPlans(userId: string): Promise<WorkoutPlan[]>;
  createWorkoutPlan(plan: InsertWorkoutPlan): Promise<WorkoutPlan>;
  updateWorkoutPlan(id: number, plan: Partial<InsertWorkoutPlan>): Promise<WorkoutPlan | undefined>;
  archiveWorkoutPlan(planId: number): Promise<WorkoutPlan | undefined>;
  archiveAllUserPlans(userId: string): Promise<void>;
  setActivePlan(userId: string, planId: number): Promise<WorkoutPlan | undefined>;

  // Workout session operations
  getWorkoutSessions(userId: string, limit?: number, offset?: number): Promise<WorkoutSession[]>;
  getWorkoutSessionsCount(userId: string): Promise<number>;
  getWorkoutSessionById(id: number): Promise<WorkoutSession | undefined>;
  getWorkoutSessionByDate(userId: string, date: Date): Promise<WorkoutSession | undefined>;
  getWorkoutSessionByScheduledDate(userId: string, scheduledFor: Date, dayName: string): Promise<WorkoutSession | undefined>;
  getWeekSessions(userId: string, weekStart: Date, weekEnd: Date): Promise<WorkoutSession[]>;
  getWorkoutSlotHistory(userId: string, dayName: string, limit?: number): Promise<{ scheduledFor: Date; completed: boolean; performedOn: Date | null }[]>;
  createWorkoutSession(session: InsertWorkoutSession): Promise<WorkoutSession>;
  updateWorkoutSession(id: number, session: Partial<InsertWorkoutSession>): Promise<WorkoutSession | undefined>;

  // Workout set operations
  getWorkoutSets(sessionId: number): Promise<WorkoutSet[]>;
  getWorkoutSetById(id: number): Promise<WorkoutSet | undefined>;
  createWorkoutSet(set: InsertWorkoutSet): Promise<WorkoutSet>;
  createWorkoutSets(sets: InsertWorkoutSet[]): Promise<WorkoutSet[]>;
  updateWorkoutSet(id: number, set: Partial<InsertWorkoutSet>): Promise<WorkoutSet | undefined>;
  deleteWorkoutSet(id: number): Promise<void>;

  // Promo code operations
  getPromoCodeByCode(code: string): Promise<PromoCode | undefined>;
  createPromoCode(promoCode: InsertPromoCode): Promise<PromoCode>;
  getPromoRedemption(promoCodeId: number, userId: string): Promise<PromoRedemption | undefined>;
  redeemPromoCodeAtomic(promoCodeId: number, userId: string): Promise<{ success: boolean; error?: string }>;

  // Session token operations (for shareable workout tracking links)
  createSessionToken(sessionId: number, expiresInDays?: number): Promise<SessionToken>;
  getTokenForSession(sessionId: number): Promise<SessionToken | undefined>;
  getSessionByToken(token: string): Promise<{ session: WorkoutSession; token: SessionToken; plan: WorkoutPlan | null } | undefined>;

  // Historical data for PR tracking
  getHistoricalMaxWeights(userId: string, exerciseNames: string[], excludeSessionId: number): Promise<Record<string, number>>;

  // Get sets from the most recent completed session for the same workout
  getPreviousSessionSets(userId: string, dayName: string, excludeSessionId: number): Promise<WorkoutSet[]>;

  // Plan draft operations (for SMS agent draft-and-review flow)
  getPlanDraftByToken(token: string): Promise<{ draft: PlanDraft; currentPlan: WorkoutPlan | null } | undefined>;
  acceptPlanDraft(token: string): Promise<{ success: boolean; newPlanId?: number; error?: string }>;

  // Context messages (agent-visible events from web actions)
  insertContextMessage(userId: string, content: string): Promise<void>;
  hasMessages(userId: string): Promise<boolean>;

  // Phone verification operations (shared with FastAPI)
  getPhoneVerification(phone: string): Promise<PhoneVerification | undefined>;
  verifyPhoneCode(phone: string, code: string): Promise<{ success: boolean; error?: string }>;
  markPhoneVerified(phone: string): Promise<void>;
  isPhoneVerified(phone: string): Promise<boolean>;
}

class DatabaseStorage implements IStorage {
  // Use shared db client from db.ts (properly configured for Transaction Pooler)

  async getUser(id: string): Promise<User | undefined> {
    return withDbRetry(async () => {
      const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
      return result[0];
    }, 'getUser');
  }

  async getUserByStripeCustomerId(stripeCustomerId: string): Promise<User | undefined> {
    return withDbRetry(async () => {
      const result = await db.select().from(users).where(eq(users.stripeCustomerId, stripeCustomerId)).limit(1);
      return result[0];
    }, 'getUserByStripeCustomerId');
  }

  async updateUserStripeInfo(userId: string, stripeCustomerId: string, stripeSubscriptionId: string, subscriptionStatus: string): Promise<User | undefined> {
    return withDbRetry(async () => {
      const result = await db
        .update(users)
        .set({
          stripeCustomerId,
          stripeSubscriptionId,
          subscriptionStatus,
          updatedAt: new Date()
        })
        .where(eq(users.id, userId))
        .returning();
      return result[0];
    }, 'updateUserStripeInfo');
  }

  async updateSignupStage(userId: string, stage: SignupStage): Promise<User | undefined> {
    return withDbRetry(async () => {
      const result = await db
        .update(users)
        .set({
          signupStage: stage,
          updatedAt: new Date()
        })
        .where(eq(users.id, userId))
        .returning();
      return result[0];
    }, 'updateSignupStage');
  }

  async updateDraftOnboardingData(userId: string, draftData: DraftOnboardingData): Promise<User | undefined> {
    const result = await db
      .update(users)
      .set({
        draftOnboardingData: draftData,
        updatedAt: new Date()
      })
      .where(eq(users.id, userId))
      .returning();
    return result[0];
  }

  async updateDraftPlanData(userId: string, draftData: DraftPlanData | null): Promise<User | undefined> {
    const result = await db
      .update(users)
      .set({
        draftPlanData: draftData,
        updatedAt: new Date()
      })
      .where(eq(users.id, userId))
      .returning();
    return result[0];
  }

  async archivePlanConversation(userId: string, planId: number, messages: PlanConversationMessage[]): Promise<User | undefined> {
    // Get current user to access existing archived conversations
    const user = await this.getUser(userId);
    if (!user) return undefined;

    const existingArchives = (user.archivedPlanConversations as ArchivedPlanConversation[] | null) || [];
    const newArchive: ArchivedPlanConversation = {
      planId,
      messages,
      archivedAt: new Date().toISOString(),
    };

    const result = await db
      .update(users)
      .set({
        archivedPlanConversations: [...existingArchives, newArchive],
        draftPlanData: null, // Clear draft after archiving
        updatedAt: new Date()
      })
      .where(eq(users.id, userId))
      .returning();
    return result[0];
  }

  async getProfile(userId: string): Promise<Profile | undefined> {
    return withDbRetry(async () => {
      const result = await db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
      return result[0];
    }, 'getProfile');
  }

  async getProfileById(id: number): Promise<Profile | undefined> {
    const result = await db.select().from(profiles).where(eq(profiles.id, id)).limit(1);
    return result[0];
  }

  async getProfileByPhone(phone: string): Promise<Profile | undefined> {
    return withDbRetry(async () => {
      const result = await db.select().from(profiles).where(eq(profiles.phone, phone)).limit(1);
      return result[0];
    }, 'getProfileByPhone');
  }

  async createProfile(profile: InsertProfile): Promise<Profile> {
    return withDbRetry(async () => {
      const result = await db.insert(profiles).values(profile).returning();
      return result[0];
    }, 'createProfile');
  }

  async updateProfile(id: number, profile: Partial<InsertProfile>): Promise<Profile | undefined> {
    const result = await db
      .update(profiles)
      .set(profile)
      .where(eq(profiles.id, id))
      .returning();
    return result[0];
  }

  async getWorkoutPlan(userId: string): Promise<WorkoutPlan | undefined> {
    const result = await db
      .select()
      .from(workoutPlans)
      .where(and(eq(workoutPlans.userId, userId), eq(workoutPlans.status, "active")))
      .limit(1);
    return result[0];
  }

  async getWorkoutPlanById(id: number): Promise<WorkoutPlan | undefined> {
    const result = await db
      .select()
      .from(workoutPlans)
      .where(eq(workoutPlans.id, id))
      .limit(1);
    return result[0];
  }

  async createWorkoutPlan(plan: InsertWorkoutPlan): Promise<WorkoutPlan> {
    const result = await db.insert(workoutPlans).values(plan).returning();
    return result[0];
  }

  async updateWorkoutPlan(id: number, plan: Partial<InsertWorkoutPlan>): Promise<WorkoutPlan | undefined> {
    const result = await db
      .update(workoutPlans)
      .set({ ...plan, updatedAt: new Date() })
      .where(eq(workoutPlans.id, id))
      .returning();
    return result[0];
  }

  async getAllWorkoutPlans(userId: string): Promise<WorkoutPlan[]> {
    const result = await db
      .select()
      .from(workoutPlans)
      .where(eq(workoutPlans.userId, userId))
      .orderBy(desc(workoutPlans.updatedAt));
    return result;
  }

  async getArchivedPlans(userId: string): Promise<WorkoutPlan[]> {
    const result = await db
      .select()
      .from(workoutPlans)
      .where(
        and(
          eq(workoutPlans.userId, userId),
          sql`${workoutPlans.archivedAt} IS NOT NULL`
        )
      )
      .orderBy(desc(workoutPlans.archivedAt));
    return result;
  }

  async archiveWorkoutPlan(planId: number): Promise<WorkoutPlan | undefined> {
    const result = await db
      .update(workoutPlans)
      .set({
        archivedAt: new Date(),
        status: "archived",
        updatedAt: new Date()
      })
      .where(eq(workoutPlans.id, planId))
      .returning();
    return result[0];
  }

  async archiveAllUserPlans(userId: string): Promise<void> {
    // Archive all active (non-archived) plans for a user
    await db
      .update(workoutPlans)
      .set({
        archivedAt: new Date(),
        status: "archived",
        updatedAt: new Date()
      })
      .where(
        and(
          eq(workoutPlans.userId, userId),
          sql`${workoutPlans.archivedAt} IS NULL`
        )
      );
  }

  async setActivePlan(userId: string, planId: number): Promise<WorkoutPlan | undefined> {
    // First, verify the plan belongs to this user
    const planToActivate = await db
      .select()
      .from(workoutPlans)
      .where(and(eq(workoutPlans.id, planId), eq(workoutPlans.userId, userId)))
      .limit(1);

    if (planToActivate.length === 0) {
      return undefined;
    }

    // Archive all other plans for this user
    await db
      .update(workoutPlans)
      .set({ status: "archived", updatedAt: new Date() })
      .where(and(eq(workoutPlans.userId, userId), sql`${workoutPlans.id} != ${planId}`));

    // Activate the selected plan
    const result = await db
      .update(workoutPlans)
      .set({ status: "active", updatedAt: new Date() })
      .where(eq(workoutPlans.id, planId))
      .returning();

    return result[0];
  }

  async getWorkoutSessions(userId: string, limit: number = 10, offset: number = 0): Promise<WorkoutSession[]> {
    const result = await db
      .select()
      .from(workoutSessions)
      .where(eq(workoutSessions.userId, userId))
      .orderBy(desc(workoutSessions.workoutDate))
      .limit(limit)
      .offset(offset);
    return result;
  }

  async getWorkoutSessionsCount(userId: string): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(workoutSessions)
      .where(eq(workoutSessions.userId, userId));
    return result[0]?.count ?? 0;
  }

  async getWorkoutSessionById(id: number): Promise<WorkoutSession | undefined> {
    const result = await db
      .select()
      .from(workoutSessions)
      .where(eq(workoutSessions.id, id))
      .limit(1);
    return result[0];
  }

  async getWorkoutSessionByDate(userId: string, date: Date): Promise<WorkoutSession | undefined> {
    // Get session for a specific date (comparing just the date part, ignoring time)
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const result = await db
      .select()
      .from(workoutSessions)
      .where(
        and(
          eq(workoutSessions.userId, userId),
          sql`${workoutSessions.workoutDate} >= ${startOfDay.toISOString()}`,
          sql`${workoutSessions.workoutDate} <= ${endOfDay.toISOString()}`
        )
      )
      .limit(1);
    return result[0];
  }

  async getWorkoutSessionByScheduledDate(userId: string, scheduledFor: Date, dayName: string): Promise<WorkoutSession | undefined> {
    // Get session for a specific scheduled slot (by scheduled_for date and day name)
    // This allows checking if "Friday's workout" already exists for this week
    const startOfDay = new Date(scheduledFor);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(scheduledFor);
    endOfDay.setHours(23, 59, 59, 999);

    const result = await db
      .select()
      .from(workoutSessions)
      .where(
        and(
          eq(workoutSessions.userId, userId),
          eq(workoutSessions.dayName, dayName),
          sql`${workoutSessions.scheduledFor} >= ${startOfDay.toISOString()}`,
          sql`${workoutSessions.scheduledFor} <= ${endOfDay.toISOString()}`
        )
      )
      .limit(1);
    return result[0];
  }

  async getWeekSessions(userId: string, weekStart: Date, weekEnd: Date): Promise<WorkoutSession[]> {
    // Get all sessions for a week (by scheduled_for date range)
    const start = new Date(weekStart);
    start.setHours(0, 0, 0, 0);
    const end = new Date(weekEnd);
    end.setHours(23, 59, 59, 999);

    const result = await db
      .select()
      .from(workoutSessions)
      .where(
        and(
          eq(workoutSessions.userId, userId),
          sql`${workoutSessions.scheduledFor} >= ${start.toISOString()}`,
          sql`${workoutSessions.scheduledFor} <= ${end.toISOString()}`
        )
      )
      .orderBy(workoutSessions.scheduledFor);
    return result;
  }

  async getWorkoutSlotHistory(userId: string, dayName: string, limit: number = 5): Promise<{ scheduledFor: Date; completed: boolean; performedOn: Date | null }[]> {
    // Get the last N sessions for a specific workout slot (e.g., last 5 Fridays)
    const result = await db
      .select({
        scheduledFor: workoutSessions.scheduledFor,
        status: workoutSessions.status,
        completedAt: workoutSessions.completedAt,
        workoutDate: workoutSessions.workoutDate,
      })
      .from(workoutSessions)
      .where(
        and(
          eq(workoutSessions.userId, userId),
          eq(workoutSessions.dayName, dayName)
        )
      )
      .orderBy(desc(workoutSessions.scheduledFor))
      .limit(limit);

    return result.map(r => ({
      scheduledFor: r.scheduledFor || r.workoutDate, // Fallback for old data without scheduledFor
      completed: r.status === 'completed',
      performedOn: r.status === 'completed' ? (r.completedAt || r.workoutDate) : null,
    }));
  }

  async createWorkoutSession(session: InsertWorkoutSession): Promise<WorkoutSession> {
    const result = await db.insert(workoutSessions).values(session).returning();
    return result[0];
  }

  async updateWorkoutSession(id: number, session: Partial<InsertWorkoutSession>): Promise<WorkoutSession | undefined> {
    const result = await db
      .update(workoutSessions)
      .set(session)
      .where(eq(workoutSessions.id, id))
      .returning();
    return result[0];
  }

  async getWorkoutSets(sessionId: number): Promise<WorkoutSet[]> {
    const result = await db
      .select()
      .from(workoutSets)
      .where(eq(workoutSets.sessionId, sessionId))
      .orderBy(workoutSets.exerciseIndex, workoutSets.setNumber);
    return result;
  }

  async getWorkoutSetById(id: number): Promise<WorkoutSet | undefined> {
    const result = await db
      .select()
      .from(workoutSets)
      .where(eq(workoutSets.id, id))
      .limit(1);
    return result[0];
  }

  async createWorkoutSet(set: InsertWorkoutSet): Promise<WorkoutSet> {
    const result = await db.insert(workoutSets).values(set).returning();
    return result[0];
  }

  async createWorkoutSets(sets: InsertWorkoutSet[]): Promise<WorkoutSet[]> {
    if (sets.length === 0) return [];
    return await db.transaction(async (tx) => {
      const result = await tx.insert(workoutSets).values(sets).returning();
      return result;
    });
  }

  async updateWorkoutSet(id: number, set: Partial<InsertWorkoutSet>): Promise<WorkoutSet | undefined> {
    const result = await db
      .update(workoutSets)
      .set(set)
      .where(eq(workoutSets.id, id))
      .returning();
    return result[0];
  }

  async deleteWorkoutSet(id: number): Promise<void> {
    await db.delete(workoutSets).where(eq(workoutSets.id, id));
  }

  async getPromoCodeByCode(code: string): Promise<PromoCode | undefined> {
    const result = await db
      .select()
      .from(promoCodes)
      .where(eq(promoCodes.code, code.toUpperCase()))
      .limit(1);
    return result[0];
  }

  async createPromoCode(promoCode: InsertPromoCode): Promise<PromoCode> {
    const result = await db
      .insert(promoCodes)
      .values({ ...promoCode, code: promoCode.code.toUpperCase() })
      .returning();
    return result[0];
  }

  async getPromoRedemption(promoCodeId: number, userId: string): Promise<PromoRedemption | undefined> {
    const result = await db
      .select()
      .from(promoRedemptions)
      .where(and(eq(promoRedemptions.promoCodeId, promoCodeId), eq(promoRedemptions.userId, userId)))
      .limit(1);
    return result[0];
  }

  async redeemPromoCodeAtomic(promoCodeId: number, userId: string): Promise<{ success: boolean; error?: string }> {
    try {
      await db.transaction(async (tx) => {
        // First try to insert redemption - this will fail fast on duplicate
        try {
          await tx.insert(promoRedemptions).values({
            promoCodeId,
            userId,
          });
        } catch (insertError: any) {
          if (insertError.code === '23505') {
            throw new Error("DUPLICATE_REDEMPTION");
          }
          throw insertError;
        }

        // Atomically increment usage count and check limit
        const updateResult = await tx
          .update(promoCodes)
          .set({ currentUses: sql`current_uses + 1` })
          .where(
            and(
              eq(promoCodes.id, promoCodeId),
              sql`(max_uses IS NULL OR current_uses < max_uses)`
            )
          )
          .returning();

        if (updateResult.length === 0) {
          throw new Error("USAGE_LIMIT_REACHED");
        }

        await tx
          .update(users)
          .set({ signupStage: "complete", updatedAt: new Date() })
          .where(eq(users.id, userId));
      });

      return { success: true };
    } catch (error: any) {
      if (error.message === "DUPLICATE_REDEMPTION") {
        return { success: false, error: "You have already used this promo code" };
      }
      if (error.message === "USAGE_LIMIT_REACHED") {
        return { success: false, error: "Promo code has reached its usage limit" };
      }
      console.error("Error in atomic promo redemption:", error);
      return { success: false, error: "Failed to redeem promo code" };
    }
  }

  // Session token operations for shareable workout tracking links
  async createSessionToken(sessionId: number, expiresInDays: number = 7): Promise<SessionToken> {
    const token = nanoid(21);
    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

    const result = await db
      .insert(sessionTokens)
      .values({ token, sessionId, expiresAt })
      .returning();
    return result[0];
  }

  async getTokenForSession(sessionId: number): Promise<SessionToken | undefined> {
    // Get a valid (non-expired) token for a session
    const result = await db
      .select()
      .from(sessionTokens)
      .where(
        and(
          eq(sessionTokens.sessionId, sessionId),
          sql`${sessionTokens.expiresAt} > NOW()`
        )
      )
      .orderBy(desc(sessionTokens.expiresAt))
      .limit(1);
    return result[0];
  }

  async getSessionByToken(token: string): Promise<{ session: WorkoutSession; token: SessionToken; plan: WorkoutPlan | null } | undefined> {
    return withDbRetry(async () => {
      // Get token and validate it hasn't expired
      const tokenResult = await db
        .select()
        .from(sessionTokens)
        .where(and(
          eq(sessionTokens.token, token),
          sql`${sessionTokens.expiresAt} > NOW()`
        ))
        .limit(1);

      if (tokenResult.length === 0) {
        return undefined;
      }

      const tokenData = tokenResult[0];

      // Get the associated session
      const sessionResult = await db
        .select()
        .from(workoutSessions)
        .where(eq(workoutSessions.id, tokenData.sessionId))
        .limit(1);

      if (sessionResult.length === 0) {
        return undefined;
      }

      const session = sessionResult[0];

      // Get the associated workout plan (if exists)
      let plan: WorkoutPlan | null = null;
      if (session.planId) {
        const planResult = await db
          .select()
          .from(workoutPlans)
          .where(eq(workoutPlans.id, session.planId))
          .limit(1);
        plan = planResult[0] || null;
      }

      return { session, token: tokenData, plan };
    }, 'getSessionByToken');
  }

  async getHistoricalMaxWeights(userId: string, exerciseNames: string[], excludeSessionId: number): Promise<Record<string, number>> {
    return withDbRetry(async () => {
      if (exerciseNames.length === 0) {
        return {};
      }

      // Get max weights from completed sessions for each exercise
      // Excluding the current session
      const results = await db
        .select({
          exerciseName: workoutSets.exerciseName,
          maxWeight: max(workoutSets.weight),
        })
        .from(workoutSets)
        .innerJoin(workoutSessions, eq(workoutSets.sessionId, workoutSessions.id))
        .where(and(
          eq(workoutSessions.userId, userId),
          eq(workoutSessions.status, 'completed'),
          ne(workoutSessions.id, excludeSessionId),
          inArray(workoutSets.exerciseName, exerciseNames)
        ))
        .groupBy(workoutSets.exerciseName);

      // Convert to Record<exerciseName, maxWeight>
      const maxWeights: Record<string, number> = {};
      for (const row of results) {
        if (row.maxWeight !== null && row.maxWeight > 0) {
          maxWeights[row.exerciseName] = row.maxWeight;
        }
      }

      return maxWeights;
    }, 'getHistoricalMaxWeights');
  }

  async getPreviousSessionSets(userId: string, dayName: string, excludeSessionId: number): Promise<WorkoutSet[]> {
    return withDbRetry(async () => {
      // Find the most recent completed session with the same dayName for this user
      const previousSession = await db
        .select()
        .from(workoutSessions)
        .where(and(
          eq(workoutSessions.userId, userId),
          eq(workoutSessions.dayName, dayName),
          eq(workoutSessions.status, 'completed'),
          ne(workoutSessions.id, excludeSessionId)
        ))
        .orderBy(desc(workoutSessions.workoutDate))
        .limit(1);

      if (previousSession.length === 0) {
        return [];
      }

      // Get all sets from that session
      const sets = await db
        .select()
        .from(workoutSets)
        .where(eq(workoutSets.sessionId, previousSession[0].id))
        .orderBy(workoutSets.exerciseIndex, workoutSets.setNumber);

      return sets;
    }, 'getPreviousSessionSets');
  }

  // Plan draft operations
  async getPlanDraftByToken(token: string): Promise<{ draft: PlanDraft; currentPlan: WorkoutPlan | null } | undefined> {
    return withDbRetry(async () => {
      const draftResult = await db
        .select()
        .from(planDrafts)
        .where(and(
          eq(planDrafts.token, token),
          eq(planDrafts.status, "pending"),
          sql`${planDrafts.expiresAt} > NOW()`
        ))
        .limit(1);

      if (draftResult.length === 0) {
        return undefined;
      }

      const draft = draftResult[0];

      // Fetch user's current active plan
      const planResult = await db
        .select()
        .from(workoutPlans)
        .where(and(eq(workoutPlans.userId, draft.userId), eq(workoutPlans.status, "active")))
        .limit(1);

      return { draft, currentPlan: planResult[0] || null };
    }, 'getPlanDraftByToken');
  }

  async acceptPlanDraft(token: string): Promise<{ success: boolean; newPlanId?: number; error?: string }> {
    return withDbRetry(async () => {
      // Fetch draft by token, validate status and expiry
      const draftResult = await db
        .select()
        .from(planDrafts)
        .where(and(
          eq(planDrafts.token, token),
          eq(planDrafts.status, "pending"),
          sql`${planDrafts.expiresAt} > NOW()`
        ))
        .limit(1);

      if (draftResult.length === 0) {
        return { success: false, error: "Draft not found, already accepted, or expired." };
      }

      const draft = draftResult[0];

      // Archive all existing active plans
      await this.archiveAllUserPlans(draft.userId);

      // Delete future pending plan sessions
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      await db
        .delete(workoutSessions)
        .where(and(
          eq(workoutSessions.userId, draft.userId),
          eq(workoutSessions.status, "pending"),
          sql`${workoutSessions.source} = 'plan'`,
          sql`${workoutSessions.scheduledFor} >= ${today.toISOString()}`
        ));

      // Stamp exercise IDs on draft plan data if missing
      const planData = draft.planData as { workouts: Array<{ exercises: Array<{ id?: string; [key: string]: unknown }> }> };
      for (const workout of planData.workouts) {
        for (const exercise of workout.exercises) {
          if (!exercise.id) {
            exercise.id = randomUUID();
          }
        }
      }

      // Create new workout plan from draft's plan_data
      const newPlanResult = await db
        .insert(workoutPlans)
        .values({
          userId: draft.userId,
          planData: planData as typeof draft.planData,
          status: "active",
        })
        .returning();

      const newPlan = newPlanResult[0];

      // Mark draft as accepted
      await db
        .update(planDrafts)
        .set({ status: "accepted", acceptedAt: new Date() })
        .where(eq(planDrafts.id, draft.id));

      // Write context event so the agent knows the draft was accepted
      await this.insertContextMessage(
        draft.userId,
        "[Internal context] The user accepted the plan draft via the web page. Their new plan is now active. The old draft link is no longer valid — do not reference it."
      );

      return { success: true, newPlanId: newPlan.id };
    }, 'acceptPlanDraft');
  }

  // Context messages — write agent-visible events from web actions
  async hasMessages(userId: string): Promise<boolean> {
    try {
      const result = await db.execute(sql`
        SELECT 1 FROM messages WHERE user_id = ${userId} LIMIT 1
      `);
      return Array.isArray(result) ? result.length > 0 : ((result as any).rows?.length ?? 0) > 0;
    } catch (error) {
      console.error("[hasMessages] Failed to check messages:", error);
      return false;
    }
  }

  async insertContextMessage(userId: string, content: string): Promise<void> {
    try {
      await db.execute(sql`
        INSERT INTO messages (user_id, phone_number, direction, content)
        VALUES (${userId}, 'system', 'context', ${content})
      `);
    } catch (error) {
      console.error("Failed to insert context message:", error);
    }
  }

  // Phone verification operations
  async getPhoneVerification(phone: string): Promise<PhoneVerification | undefined> {
    return withDbRetry(async () => {
      // Get the most recent non-expired verification for this phone
      const result = await db
        .select()
        .from(phoneVerifications)
        .where(
          and(
            eq(phoneVerifications.phoneNumber, phone),
            sql`${phoneVerifications.expiresAt} > NOW()`
          )
        )
        .orderBy(desc(phoneVerifications.createdAt))
        .limit(1);
      return result[0];
    }, 'getPhoneVerification');
  }

  async verifyPhoneCode(phone: string, code: string): Promise<{ success: boolean; error?: string }> {
    return withDbRetry(async () => {
      // Get the latest verification for this phone
      const verification = await this.getPhoneVerification(phone);

      if (!verification) {
        return { success: false, error: "No verification code found. Please text START to (628) 997-8087 first." };
      }

      // Check if already verified
      if (verification.verifiedAt) {
        return { success: true }; // Already verified
      }

      // Check attempts (max 5)
      if (verification.attempts >= 5) {
        return { success: false, error: "Too many attempts. Please text START again to get a new code." };
      }

      // Increment attempts
      await db
        .update(phoneVerifications)
        .set({ attempts: verification.attempts + 1 })
        .where(eq(phoneVerifications.id, verification.id));

      // Check code
      if (verification.code !== code) {
        const attemptsLeft = 4 - verification.attempts;
        return {
          success: false,
          error: attemptsLeft > 0
            ? `Invalid code. ${attemptsLeft} attempt${attemptsLeft === 1 ? '' : 's'} remaining.`
            : "Invalid code. Please text START again to get a new code."
        };
      }

      // Mark as verified
      await db
        .update(phoneVerifications)
        .set({ verifiedAt: new Date() })
        .where(eq(phoneVerifications.id, verification.id));

      return { success: true };
    }, 'verifyPhoneCode');
  }

  async markPhoneVerified(phone: string): Promise<void> {
    return withDbRetry(async () => {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours
      // Delete any existing verification for this phone first (handles re-verification)
      await db.delete(phoneVerifications)
        .where(eq(phoneVerifications.phoneNumber, phone));
      await db.insert(phoneVerifications).values({
        phoneNumber: phone,
        code: "twilio",
        verifiedAt: now,
        expiresAt,
      });
    }, 'markPhoneVerified');
  }

  async isPhoneVerified(phone: string): Promise<boolean> {
    return withDbRetry(async () => {
      // Check if there's a verified record for this phone (within last 24 hours)
      const result = await db
        .select()
        .from(phoneVerifications)
        .where(
          and(
            eq(phoneVerifications.phoneNumber, phone),
            sql`${phoneVerifications.verifiedAt} IS NOT NULL`,
            sql`${phoneVerifications.verifiedAt} > NOW() - INTERVAL '24 hours'`
          )
        )
        .limit(1);
      return result.length > 0;
    }, 'isPhoneVerified');
  }
}

export const storage = new DatabaseStorage();
