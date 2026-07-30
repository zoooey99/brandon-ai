/**
 * Backfill exercise IDs on existing plans, drafts, sessions, and workout sets.
 *
 * This script:
 * 1. Adds a UUID to every exercise in workout_plans.plan_data that doesn't have one
 * 2. Adds a UUID to every exercise in plan_drafts.plan_data that doesn't have one
 * 3. Adds a UUID to every exercise in workout_sessions.exercises that doesn't have one
 * 4. Adds a UUID to every exercise in users.draft_plan_data that doesn't have one
 * 5. Backfills exercise_id on workout_sets rows by matching exerciseIndex to the
 *    session's exercise list (from session.exercises or the plan template)
 *
 * Safe to run multiple times — only fills in missing IDs.
 *
 * Usage: npx tsx scripts/backfill-exercise-ids.ts
 */

import "../server/dns-config";
import { db } from "../server/db";
import { workoutPlans, planDrafts, workoutSessions, workoutSets, users } from "../shared/schema";
import { eq, isNull, sql } from "drizzle-orm";
import { randomUUID } from "crypto";

type ExerciseWithId = { id?: string; name: string; sets: number; reps: string; details?: string[] };
type PlanData = { weeklyVolume?: string; workouts: Array<{ day: string; focus: string; duration: string; exercises: ExerciseWithId[] }> };

function stampIds(planData: PlanData): boolean {
  let changed = false;
  for (const workout of planData.workouts) {
    for (const exercise of workout.exercises) {
      if (!exercise.id) {
        exercise.id = randomUUID();
        changed = true;
      }
    }
  }
  return changed;
}

async function backfillPlans() {
  console.log("=== Backfilling workout_plans ===");
  const plans = await db.select().from(workoutPlans);
  let updated = 0;
  for (const plan of plans) {
    const planData = plan.planData as PlanData;
    if (!planData?.workouts) continue;
    if (stampIds(planData)) {
      await db.update(workoutPlans).set({ planData }).where(eq(workoutPlans.id, plan.id));
      updated++;
    }
  }
  console.log(`  Updated ${updated}/${plans.length} plans`);
}

async function backfillDrafts() {
  console.log("=== Backfilling plan_drafts ===");
  const drafts = await db.select().from(planDrafts);
  let updated = 0;
  for (const draft of drafts) {
    const planData = draft.planData as PlanData;
    if (!planData?.workouts) continue;
    if (stampIds(planData)) {
      await db.update(planDrafts).set({ planData }).where(eq(planDrafts.id, draft.id));
      updated++;
    }
  }
  console.log(`  Updated ${updated}/${drafts.length} drafts`);
}

async function backfillSessions() {
  console.log("=== Backfilling workout_sessions.exercises ===");
  const sessions = await db.select().from(workoutSessions);
  let updated = 0;
  for (const session of sessions) {
    if (!session.exercises || !Array.isArray(session.exercises)) continue;
    const exercises = session.exercises as ExerciseWithId[];
    let changed = false;
    for (const exercise of exercises) {
      if (!exercise.id) {
        exercise.id = randomUUID();
        changed = true;
      }
    }
    if (changed) {
      await db.update(workoutSessions).set({ exercises }).where(eq(workoutSessions.id, session.id));
      updated++;
    }
  }
  console.log(`  Updated ${updated}/${sessions.length} sessions`);
}

async function backfillUserDraftPlans() {
  console.log("=== Backfilling users.draft_plan_data ===");
  const allUsers = await db.select().from(users);
  let updated = 0;
  for (const user of allUsers) {
    if (!user.draftPlanData?.plan?.workouts) continue;
    const planData = user.draftPlanData.plan as PlanData;
    if (stampIds(planData)) {
      await db.update(users).set({ draftPlanData: user.draftPlanData }).where(eq(users.id, user.id));
      updated++;
    }
  }
  console.log(`  Updated ${updated}/${allUsers.length} users`);
}

async function backfillWorkoutSets() {
  console.log("=== Backfilling workout_sets.exercise_id ===");

  // Get all sets that don't have an exercise_id
  const setsWithoutId = await db
    .select({ id: workoutSets.id, sessionId: workoutSets.sessionId, exerciseIndex: workoutSets.exerciseIndex })
    .from(workoutSets)
    .where(isNull(workoutSets.exerciseId));

  if (setsWithoutId.length === 0) {
    console.log("  No sets need backfilling");
    return;
  }

  console.log(`  Found ${setsWithoutId.length} sets without exercise_id`);

  // Group by sessionId for efficient lookups
  const setsBySession = new Map<number, typeof setsWithoutId>();
  for (const set of setsWithoutId) {
    const existing = setsBySession.get(set.sessionId) || [];
    existing.push(set);
    setsBySession.set(set.sessionId, existing);
  }

  let updated = 0;
  let skipped = 0;

  for (const [sessionId, sets] of setsBySession) {
    // Get the session
    const [session] = await db.select().from(workoutSessions).where(eq(workoutSessions.id, sessionId)).limit(1);
    if (!session) { skipped += sets.length; continue; }

    // Get exercise list: prefer session.exercises, fall back to plan template
    let exercises: ExerciseWithId[] | null = null;

    if (session.exercises && Array.isArray(session.exercises) && (session.exercises as unknown[]).length > 0) {
      exercises = session.exercises as ExerciseWithId[];
    } else if (session.planId) {
      const [plan] = await db.select().from(workoutPlans).where(eq(workoutPlans.id, session.planId)).limit(1);
      if (plan?.planData) {
        const planData = plan.planData as PlanData;
        const workout = planData.workouts.find(w => w.day === session.dayName);
        exercises = workout?.exercises || null;
      }
    }

    if (!exercises) { skipped += sets.length; continue; }

    // Update each set with the exercise ID from the matching index
    for (const set of sets) {
      const exercise = exercises[set.exerciseIndex];
      if (exercise?.id) {
        await db.update(workoutSets).set({ exerciseId: exercise.id }).where(eq(workoutSets.id, set.id));
        updated++;
      } else {
        skipped++;
      }
    }
  }

  console.log(`  Updated ${updated} sets, skipped ${skipped}`);
}

async function main() {
  console.log("Starting exercise ID backfill...\n");

  await backfillPlans();
  await backfillDrafts();
  await backfillSessions();
  await backfillUserDraftPlans();
  await backfillWorkoutSets();

  console.log("\nBackfill complete!");
  process.exit(0);
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
