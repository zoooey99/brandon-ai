import { boolean, pgTable, text, varchar, integer, timestamp, jsonb, serial, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Re-export auth models (users and sessions tables)
export * from "./models/auth";
export type { SignupStage, DraftOnboardingData, DraftPlanData, ArchivedPlanConversation, PlanConversationMessage, GeneratedPlanData } from "./models/auth";

// Import users from auth for reference
import { users } from "./models/auth";

export const profiles = pgTable("profiles", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  age: integer("age"),
  sex: text("sex"),
  goal: text("goal").notNull(),
  consistency: text("consistency"),
  experience: text("experience"),
  equipment: jsonb("equipment").$type<string[]>(),
  split: text("split"),
  workoutDays: jsonb("workout_days").$type<string[]>(),
  preferredTextTime: text("preferred_text_time"),
  timezone: text("timezone"),
  notes: text("notes"),
  planMode: text("plan_mode"),
  planFreedom: integer("plan_freedom"),
  // EXTERNAL: Used by Agent/SMS Service - DO NOT REMOVE
  messagingPaused: boolean("messaging_paused"),
  // Phone verification status - set to true after user verifies via SMS code
  phoneVerified: boolean("phone_verified").default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("profiles_user_id_unique_idx").on(table.userId)
]);

export const insertProfileSchema = createInsertSchema(profiles, {
  name: z.string().min(1, "Name is required").max(100, "Name must be 100 characters or less").trim(),
  phone: z.string().regex(/^\+[1-9]\d{1,14}$/, "Phone must be in E164 format (e.g., +14155551234)"),
  sex: z.string().max(20).optional().nullable(),
  goal: z.string().min(1).max(50),
  consistency: z.string().max(50).optional().nullable(),
  experience: z.string().max(50).optional().nullable(),
  split: z.string().max(50).optional().nullable(),
  preferredTextTime: z.string().max(10, "Time must be 10 characters or less").trim().optional().nullable(),
  timezone: z.string().max(50, "Timezone must be 50 characters or less").optional().nullable(),
  equipment: z.array(z.string().max(50)).optional(),
  workoutDays: z.array(z.string().max(10)).optional(),
  notes: z.string().max(1000, "Notes must be 1000 characters or less").trim().optional().nullable(),
  planMode: z.enum(["existing", "scratch"]).optional().nullable(),
  messagingPaused: z.boolean().optional(), // EXTERNAL: Used by Agent/SMS Service
  phoneVerified: z.boolean().optional(),
}).omit({ id: true, createdAt: true });

export type InsertProfile = z.infer<typeof insertProfileSchema>;
export type Profile = typeof profiles.$inferSelect;

export const workoutPlans = pgTable("workout_plans", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  profileId: integer("profile_id").references(() => profiles.id, { onDelete: "set null" }),
  name: text("name"),  // User-friendly plan name, e.g., "Winter Strength" or auto-generated
  planData: jsonb("plan_data").notNull().$type<{
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
  }>(),
  status: text("status").default("active").notNull(),
  archivedAt: timestamp("archived_at"),  // When plan was archived (null = active plan)
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("workout_plans_user_id_idx").on(table.userId)
]);

export const insertWorkoutPlanSchema = createInsertSchema(workoutPlans).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertWorkoutPlan = z.infer<typeof insertWorkoutPlanSchema>;
export type WorkoutPlan = typeof workoutPlans.$inferSelect;

export const workoutSessions = pgTable("workout_sessions", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  planId: integer("plan_id").references(() => workoutPlans.id, { onDelete: "set null" }),
  workoutDate: timestamp("workout_date").notNull(),
  // scheduledFor: which day slot this workout belongs to (e.g., "Friday's workout" even if done on Wednesday)
  // This enables tracking by workout slot rather than calendar date
  scheduledFor: timestamp("scheduled_for"),
  dayIndex: integer("day_index").notNull(),
  dayName: text("day_name").notNull(),
  focus: text("focus").notNull(),
  exercises: jsonb("exercises"),  // materialized exercises from plan or custom overrides
  source: text("source").default("plan"),  // plan | rescheduled | custom
  status: text("status").default("pending").notNull(), // pending | in_progress | completed
  notes: text("notes"),
  startedAt: timestamp("started_at"),       // when user clicked "Start Workout"
  completedAt: timestamp("completed_at"),
  totalDuration: integer("total_duration"), // total seconds (excluding paused time)
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("workout_sessions_user_id_idx").on(table.userId),
  index("workout_sessions_plan_id_idx").on(table.planId),
  index("workout_sessions_date_idx").on(table.workoutDate),
  index("workout_sessions_status_idx").on(table.status),
  index("workout_sessions_scheduled_for_idx").on(table.scheduledFor)
]);

export const insertWorkoutSessionSchema = createInsertSchema(workoutSessions, {
  dayName: z.string().min(1).max(50),
  focus: z.string().min(1).max(100),
  status: z.string().max(20).optional(),
  notes: z.string().max(500, "Notes must be 500 characters or less").trim().optional().nullable(),
  workoutDate: z.union([z.date(), z.string().transform((s) => new Date(s))]),
  scheduledFor: z.union([z.date(), z.string().transform((s) => new Date(s))]).optional().nullable(),
  startedAt: z.union([z.date(), z.string().transform((s) => new Date(s))]).optional().nullable(),
  completedAt: z.union([z.date(), z.string().transform((s) => new Date(s))]).optional().nullable(),
  totalDuration: z.number().int().min(0).optional().nullable(),
}).omit({ id: true, createdAt: true });

export type InsertWorkoutSession = z.infer<typeof insertWorkoutSessionSchema>;
export type WorkoutSession = typeof workoutSessions.$inferSelect;

export const workoutSets = pgTable("workout_sets", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").references(() => workoutSessions.id, { onDelete: "cascade" }).notNull(),
  exerciseName: text("exercise_name").notNull(),
  exerciseId: text("exercise_id"),
  exerciseIndex: integer("exercise_index").notNull(),
  setNumber: integer("set_number").notNull(),
  weight: integer("weight"),
  reps: integer("reps"),
  rpe: integer("rpe"),
  notes: text("notes"),
  completed: integer("completed").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertWorkoutSetSchema = createInsertSchema(workoutSets, {
  exerciseName: z.string().min(1).max(200, "Exercise name must be 200 characters or less"),
  notes: z.string().max(500, "Notes must be 500 characters or less").trim().optional().nullable(),
  rpe: z.number().int().min(1).max(10).optional().nullable(),
}).omit({
  id: true,
  createdAt: true,
});

export type InsertWorkoutSet = z.infer<typeof insertWorkoutSetSchema>;
export type WorkoutSet = typeof workoutSets.$inferSelect;

// Session tokens for shareable workout tracking links
export const sessionTokens = pgTable("session_tokens", {
  id: serial("id").primaryKey(),
  token: varchar("token", { length: 32 }).notNull().unique(),
  sessionId: integer("session_id").references(() => workoutSessions.id, { onDelete: "cascade" }).notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("session_tokens_token_idx").on(table.token),
  index("session_tokens_session_id_idx").on(table.sessionId),
]);

export const insertSessionTokenSchema = createInsertSchema(sessionTokens).omit({
  id: true,
  createdAt: true,
});

export type InsertSessionToken = z.infer<typeof insertSessionTokenSchema>;
export type SessionToken = typeof sessionTokens.$inferSelect;

// Plan drafts for SMS agent draft-and-review flow
export const planDrafts = pgTable("plan_drafts", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  token: varchar("token", { length: 32 }).notNull().unique(),
  planData: jsonb("plan_data").notNull().$type<{
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
  }>(),
  status: text("status").default("pending").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  acceptedAt: timestamp("accepted_at"),
}, (table) => [
  index("plan_drafts_token_idx").on(table.token),
  index("plan_drafts_user_id_idx").on(table.userId),
]);
export type PlanDraft = typeof planDrafts.$inferSelect;

export const promoCodes = pgTable("promo_codes", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  description: text("description"),
  maxUses: integer("max_uses"),
  currentUses: integer("current_uses").default(0).notNull(),
  expiresAt: timestamp("expires_at"),
  isActive: integer("is_active").default(1).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertPromoCodeSchema = createInsertSchema(promoCodes).omit({
  id: true,
  currentUses: true,
  createdAt: true,
});

export type InsertPromoCode = z.infer<typeof insertPromoCodeSchema>;
export type PromoCode = typeof promoCodes.$inferSelect;

export const promoRedemptions = pgTable("promo_redemptions", {
  id: serial("id").primaryKey(),
  promoCodeId: integer("promo_code_id").references(() => promoCodes.id, { onDelete: "cascade" }).notNull(),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  redeemedAt: timestamp("redeemed_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("promo_redemptions_unique_idx").on(table.promoCodeId, table.userId)
]);

export const insertPromoRedemptionSchema = createInsertSchema(promoRedemptions).omit({
  id: true,
  redeemedAt: true,
});

export type InsertPromoRedemption = z.infer<typeof insertPromoRedemptionSchema>;
export type PromoRedemption = typeof promoRedemptions.$inferSelect;

// Phone verification for onboarding - shared with FastAPI
// FastAPI generates codes when users text Brandon, our backend verifies them
export const phoneVerifications = pgTable("phone_verifications", {
  id: serial("id").primaryKey(),
  phoneNumber: text("phone_number").notNull(),  // E164 format: +16289978087
  code: varchar("code", { length: 6 }).notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  verifiedAt: timestamp("verified_at"),  // NULL until verified
  attempts: integer("attempts").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("phone_verifications_phone_idx").on(table.phoneNumber),
  index("phone_verifications_code_idx").on(table.code),
]);

export const insertPhoneVerificationSchema = createInsertSchema(phoneVerifications, {
  phoneNumber: z.string().regex(/^\+[1-9]\d{1,14}$/, "Phone must be in E164 format"),
  code: z.string().length(6, "Code must be 6 digits"),
}).omit({ id: true, createdAt: true, attempts: true, verifiedAt: true });

export type InsertPhoneVerification = z.infer<typeof insertPhoneVerificationSchema>;
export type PhoneVerification = typeof phoneVerifications.$inferSelect;

