import { sql } from "drizzle-orm";
import { boolean, integer, jsonb, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";

// Signup stage type for tracking user progress through onboarding flow
export type SignupStage = "onboarding_incomplete" | "payment_pending" | "plan_pending" | "complete";

// Draft onboarding data type for auto-saving form progress
export type DraftOnboardingData = {
  phone?: string;
  age?: string;
  sex?: string;
  goal?: string;
  consistency?: string;
  experience?: string;
  equipment?: string[];
  split?: string;
  workoutDays?: string[];
  preferredTextTime?: string;
  timezone?: string;
  notes?: string;
  workoutImage?: string; // Base64 encoded image of user's existing workout
  useExactPlan?: boolean; // When true, copy user's workout exactly instead of adapting
  planMode?: "existing" | "scratch";
  currentStep?: string;
};

// Generated plan structure (matches client/src/lib/api.ts GeneratedPlan)
export type GeneratedPlanData = {
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

// Message in plan generation conversation
export type PlanConversationMessage = {
  id: string;
  sender: "ai" | "user";
  text: string;
  timestamp?: string;
};

// Draft plan data type for auto-saving plan generation progress
export type DraftPlanData = {
  plan: GeneratedPlanData | null;
  messages: PlanConversationMessage[];
  updatedAt: string;
};

// Archived conversation after plan finalization
export type ArchivedPlanConversation = {
  planId: number;
  messages: PlanConversationMessage[];
  archivedAt: string;
};

// User storage table - compatible with Supabase Auth
export const users = pgTable("users", {
  id: varchar("id").primaryKey(), // Supabase Auth user UUID
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  stripeCustomerId: varchar("stripe_customer_id"),
  stripeSubscriptionId: varchar("stripe_subscription_id"),
  subscriptionStatus: varchar("subscription_status"),
  signupStage: varchar("signup_stage").$type<SignupStage>().default("onboarding_incomplete"),
  draftOnboardingData: jsonb("draft_onboarding_data").$type<DraftOnboardingData>(),
  draftPlanData: jsonb("draft_plan_data").$type<DraftPlanData>(),
  archivedPlanConversations: jsonb("archived_plan_conversations").$type<ArchivedPlanConversation[]>(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;

// ============================================================================
// EXTERNAL TABLES - Managed by Agent/SMS Service
// ============================================================================
// These tables are used by a separate server that handles agent functionality
// and SMS messaging. They share this database but are NOT managed by this app.
// DO NOT DELETE these tables - they are defined here only to prevent Drizzle
// from removing them during migrations.
// ============================================================================

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id"),
  topic: text("topic"),
  phoneNumber: text("phone_number"),
  direction: text("direction"),
  extension: text("extension"),
  content: text("content"),
  payload: jsonb("payload"),
  metadata: jsonb("metadata"),
  event: text("event"),
  private: boolean("private"),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
  insertedAt: timestamp("inserted_at"),
});

export const scheduledMessages = pgTable("scheduled_messages", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id"),
  phoneNumber: text("phone_number"),
  scheduledTime: timestamp("scheduled_time"),
  messageContent: text("message_content"),
  status: text("status"),
  sentAt: timestamp("sent_at"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at"),
});

export const agentPrompts = pgTable("agent_prompts", {
  id: serial("id").primaryKey(),
  name: varchar("name"),
  promptText: text("prompt_text"),
  version: integer("version"),
  isActive: boolean("is_active"),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
});
