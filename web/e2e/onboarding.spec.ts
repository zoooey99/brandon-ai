import { test, expect, type Page, type Frame } from "@playwright/test";
import { completeAllOnboardingSteps, completeAllOnboardingStepsExisting, TEST_USER } from "./helpers/onboarding-steps";

// Supabase localStorage key — derived from VITE_SUPABASE_URL hostname (sb-<project-ref>-auth-token)
const SUPABASE_PROJECT_REF = new URL(process.env.VITE_SUPABASE_URL ?? "https://local.supabase.co").hostname.split(".")[0];
const SUPABASE_STORAGE_KEY = `sb-${SUPABASE_PROJECT_REF}-auth-token`;

let testUserId: string | null = null;
let accessToken: string | null = null;
let refreshToken: string | null = null;

test.describe("Onboarding → Plan Gen → Payment → Dashboard", () => {
  test.beforeAll(async ({ request }) => {
    const response = await request.post("/api/test/login", {
      data: {
        email: TEST_USER.email,
        password: TEST_USER.password,
      },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.access_token).toBeTruthy();

    testUserId = body.user.id;
    accessToken = body.access_token;
    refreshToken = body.refresh_token;
  });

  test.afterAll(async ({ request }) => {
    if (testUserId) {
      await request.post("/api/test/cleanup", {
        data: { userId: testUserId },
      });
    }
  });

  async function injectSession(page: Page) {
    const sessionData = JSON.stringify({
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: "bearer",
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: {
        id: testUserId,
        email: TEST_USER.email,
        aud: "authenticated",
        role: "authenticated",
        email_confirmed_at: new Date().toISOString(),
      },
    });

    await page.addInitScript(
      ({ key, data }) => {
        window.localStorage.setItem(key, data);
      },
      { key: SUPABASE_STORAGE_KEY, data: sessionData }
    );
  }

  // ── Stripe helpers ────────────────────────────────────────

  /** Find a visible input across all frames and fill it */
  async function findAndFill(frames: Frame[], selectors: string[], value: string): Promise<boolean> {
    for (const frame of frames) {
      for (const sel of selectors) {
        try {
          const el = frame.locator(sel).first();
          if (await el.isVisible({ timeout: 500 })) {
            await el.fill(value);
            return true;
          }
        } catch { /* continue */ }
      }
    }
    return false;
  }

  /** Select an option in a <select> across all frames */
  async function findAndSelect(frames: Frame[], selectors: string[], value: string): Promise<boolean> {
    for (const frame of frames) {
      for (const sel of selectors) {
        try {
          const el = frame.locator(sel).first();
          if (await el.isVisible({ timeout: 500 })) {
            await el.selectOption(value);
            return true;
          }
        } catch { /* continue */ }
      }
    }
    return false;
  }

  /** Click "Card" in the Stripe PaymentElement accordion and fill card details */
  async function fillStripeCard(page: Page) {
    // Try multiple strategies to click the "Card" tab in Stripe's PaymentElement
    let cardClicked = false;

    // Strategy 1: Try different iframe selectors for the PE
    const iframeSelectors = [
      'iframe[src*="elements-inner-accessory-target"]',
      'iframe[src*="elements-inner-payment"]',
      'iframe[title*="Payment"]',
    ];
    for (const sel of iframeSelectors) {
      if (cardClicked) break;
      try {
        const frame = page.frameLocator(sel);
        await frame.getByRole("button", { name: "Card" }).click({ timeout: 3000 });
        cardClicked = true;
      } catch { /* try next */ }
    }

    // Strategy 2: Search all frames for a "Card" button
    if (!cardClicked) {
      for (const frame of page.frames()) {
        try {
          const btn = frame.getByRole("button", { name: "Card" });
          if (await btn.isVisible({ timeout: 1000 })) {
            await btn.click();
            cardClicked = true;
            break;
          }
        } catch { /* continue */ }
      }
    }

    await page.waitForTimeout(3000);

    const frames = page.frames();

    await findAndFill(frames,
      ['[name="number"]', '[name="cardNumber"]', '[autocomplete="cc-number"]', '[placeholder*="1234"]'],
      "4242424242424242"
    );
    await page.waitForTimeout(300);

    await findAndFill(frames,
      ['[name="expiry"]', '[name="cardExpiry"]', '[autocomplete="cc-exp"]', '[placeholder*="MM"]'],
      "1234"
    );
    await page.waitForTimeout(300);

    await findAndFill(frames,
      ['[name="cvc"]', '[name="cardCvc"]', '[autocomplete="cc-csc"]', '[placeholder*="CVC"]'],
      "123"
    );
    await page.waitForTimeout(300);

    await findAndSelect(frames,
      ['select[name="country"]', 'select[autocomplete="billing country"]'],
      "US"
    );
    await page.waitForTimeout(300);

    await findAndFill(frames,
      ['[name="postalCode"]', '[name="cardPostalCode"]', '[autocomplete="postal-code"]', '[placeholder*="12345"]'],
      "10001"
    );
    await page.waitForTimeout(500);

    await page.locator('[data-testid="button-pay"]').focus();
    await page.waitForTimeout(300);
  }

  // ── Test ──────────────────────────────────────────────────

  test("full flow: onboarding → plan gen → payment → dashboard", async ({ page }) => {
    test.setTimeout(180_000);

    await injectSession(page);

    // ── Phase 1: Onboarding (steps 1-13) ────────────────────
    await page.goto("/onboarding");

    await page.waitForSelector('[data-testid="button-next-phone"]', {
      state: "visible",
      timeout: 20_000,
    });

    await completeAllOnboardingSteps(page);

    // ── Phase 2: Plan Generation (step 14, inline on /onboarding) ──
    // After fillTextTimeStep clicks "Finish", profile is created and we enter plan gen
    // Wait for the plan to generate and show "Your Training Plan"
    await page.getByText("Your Training Plan").waitFor({ state: "visible", timeout: 60_000 });

    // Still on /onboarding
    expect(page.url()).toContain("/onboarding");

    // Click "Finish & Start" to finalize the plan
    // Two buttons exist (mobile hidden, desktop visible) — use last() for desktop
    const finalizeButton = page.locator('[data-testid="button-finalize"]').last();
    await finalizeButton.waitFor({ state: "visible", timeout: 5_000 });
    await finalizeButton.click();

    // ── Phase 3: Payment ───────────────────────────────────
    await page.waitForURL("**/payment**", { timeout: 15_000 });
    expect(page.url()).toContain("/payment");

    const payButton = page.locator('[data-testid="button-pay"]');
    await payButton.waitFor({ state: "visible", timeout: 30_000 });

    // Wait for Stripe iframe to load
    await page.waitForSelector("iframe", { state: "attached", timeout: 15_000 });
    await page.waitForTimeout(3000);

    await fillStripeCard(page);
    await payButton.click();

    // ── Phase 4: Dashboard ─────────────────────────────────
    await page.waitForURL("**/dashboard**", { timeout: 60_000 });
    expect(page.url()).toContain("/dashboard");
  });

  test("full flow: existing plan fork", async ({ page }) => {
    test.setTimeout(180_000);

    await injectSession(page);

    // ── Phase 1: Onboarding (existing plan fork) ────────────
    await page.goto("/onboarding");

    await page.waitForSelector('[data-testid="button-next-phone"]', {
      state: "visible",
      timeout: 20_000,
    });

    await completeAllOnboardingStepsExisting(page);

    // ── Phase 2: Plan Generation ──────────────────────────
    await page.getByText("Your Training Plan").waitFor({ state: "visible", timeout: 60_000 });
    expect(page.url()).toContain("/onboarding");

    const finalizeButton = page.locator('[data-testid="button-finalize"]').last();
    await finalizeButton.waitFor({ state: "visible", timeout: 5_000 });
    await finalizeButton.click();

    // ── Phase 3: Payment ──────────────────────────────────
    await page.waitForURL("**/payment**", { timeout: 15_000 });
    expect(page.url()).toContain("/payment");

    const payButton = page.locator('[data-testid="button-pay"]');
    await payButton.waitFor({ state: "visible", timeout: 30_000 });

    await page.waitForSelector("iframe", { state: "attached", timeout: 15_000 });
    await page.waitForTimeout(3000);

    await fillStripeCard(page);
    await payButton.click();

    // ── Phase 4: Dashboard ──────────────────────────────
    await page.waitForURL("**/dashboard**", { timeout: 60_000 });
    expect(page.url()).toContain("/dashboard");
  });
});
