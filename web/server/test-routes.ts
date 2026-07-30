import type { Express } from "express";
import { supabaseAdmin } from "./supabaseClient";
import { db } from "./db";
import { sql } from "drizzle-orm";

/**
 * Test-only routes — only registered when NODE_ENV=test.
 * Provides endpoints for creating/cleaning up test users via Supabase Admin API.
 */
export function registerTestRoutes(app: Express): void {
  // Create a test user and return a session
  app.post("/api/test/login", async (req, res) => {
    const email = req.body.email || `test-${Date.now()}@e2e.local`;
    const password = req.body.password || "TestPassword123!";

    try {
      // Create user via admin API (auto-confirms email)
      const { data: createData, error: createError } =
        await supabaseAdmin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        });

      if (createError) {
        return res.status(400).json({ error: createError.message });
      }

      // Sign in to get a session with tokens
      const { data: signInData, error: signInError } =
        await supabaseAdmin.auth.signInWithPassword({ email, password });

      if (signInError) {
        // Clean up user if sign-in fails
        if (createData.user) {
          await supabaseAdmin.auth.admin.deleteUser(createData.user.id);
        }
        return res.status(400).json({ error: signInError.message });
      }

      res.json({
        access_token: signInData.session?.access_token,
        refresh_token: signInData.session?.refresh_token,
        user: {
          id: signInData.user?.id,
          email: signInData.user?.email,
        },
      });
    } catch (error: any) {
      console.error("Test login error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Clean up a test user — deletes from app tables then auth
  app.post("/api/test/cleanup", async (req, res) => {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }

    try {
      // Delete app-level data via direct SQL (bypasses RLS reliably)
      await db.execute(sql`DELETE FROM workout_sets WHERE session_id IN (SELECT id FROM workout_sessions WHERE user_id = ${userId})`);
      await db.execute(sql`DELETE FROM session_tokens WHERE session_id IN (SELECT id FROM workout_sessions WHERE user_id = ${userId})`);
      await db.execute(sql`DELETE FROM workout_sessions WHERE user_id = ${userId}`);
      await db.execute(sql`DELETE FROM workout_plans WHERE user_id = ${userId}`);
      await db.execute(sql`DELETE FROM plan_drafts WHERE user_id = ${userId}`);
      await db.execute(sql`DELETE FROM profiles WHERE user_id = ${userId}`);
      await db.execute(sql`DELETE FROM messages WHERE user_id = ${userId}`);
      await db.execute(sql`DELETE FROM users WHERE id = ${userId}`);

      // Delete from Supabase Auth
      await supabaseAdmin.auth.admin.deleteUser(userId).catch(() => {});

      res.json({ success: true });
    } catch (error: any) {
      console.error("Test cleanup error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Bulk cleanup — remove all e2e test users (safety net for interrupted runs)
  app.post("/api/test/cleanup-all", async (_req, res) => {
    try {
      // Find all test users in app table
      const { data: testUsers } = await supabaseAdmin
        .from("users")
        .select("id")
        .like("email", "e2e-%@test.local");

      if (testUsers && testUsers.length > 0) {
        // Delete app data via direct SQL (bypasses RLS reliably)
        for (const u of testUsers) {
          await db.execute(sql`DELETE FROM workout_sets WHERE session_id IN (SELECT id FROM workout_sessions WHERE user_id = ${u.id})`);
          await db.execute(sql`DELETE FROM session_tokens WHERE session_id IN (SELECT id FROM workout_sessions WHERE user_id = ${u.id})`);
          await db.execute(sql`DELETE FROM workout_sessions WHERE user_id = ${u.id}`);
          await db.execute(sql`DELETE FROM workout_plans WHERE user_id = ${u.id}`);
          await db.execute(sql`DELETE FROM plan_drafts WHERE user_id = ${u.id}`);
          await db.execute(sql`DELETE FROM profiles WHERE user_id = ${u.id}`);
          await db.execute(sql`DELETE FROM messages WHERE user_id = ${u.id}`);
          await db.execute(sql`DELETE FROM users WHERE id = ${u.id}`);
        }
      }

      // Also clean from Supabase Auth
      const { data: authData } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
      if (authData) {
        const authTestUsers = authData.users.filter(
          (u) => u.email?.match(/^e2e-.*@test\.local$/)
        );
        for (const u of authTestUsers) {
          await supabaseAdmin.auth.admin.deleteUser(u.id);
        }
      }

      const count = (testUsers?.length ?? 0);
      res.json({ success: true, deletedCount: count });
    } catch (error: any) {
      console.error("Test cleanup-all error:", error);
      res.status(500).json({ error: error.message });
    }
  });
}
