/**
 * Playwright global teardown — runs after ALL tests finish (even on crash).
 * Calls the bulk cleanup endpoint to remove any orphaned e2e test users.
 */
export default async function globalTeardown() {
  try {
    const port = process.env.TEST_PORT || "3000";
    const res = await fetch(`http://localhost:${port}/api/test/cleanup-all`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    if (res.ok) {
      const body = await res.json();
      if (body.deletedCount > 0) {
        console.log(`[teardown] Cleaned up ${body.deletedCount} orphaned test users`);
      }
    }
  } catch {
    // Server may already be shut down — that's fine
  }
}
