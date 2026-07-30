import type { Page } from "@playwright/test";

// ── Test Data ──────────────────────────────────────────────

// Generate unique phone per test run — +1 NPA NXX XXXX format (NXX must start with 2-9)
// Use 212 (NYC) area code; no real SMS sent in test mode
const last4 = Date.now().toString().slice(-4);
const testPhoneDigits = `212555${last4}`;

export const TEST_USER = {
  email: `e2e-${Date.now()}@test.local`,
  password: "TestPassword123!",
  phone: `+1${testPhoneDigits}`,
  verificationCode: "000000",
  age: "25",
  sex: "male" as const,
  goal: "build_muscle" as const,
  consistency: "consistent" as const,
  experience: "2_4_years" as const,
  equipment: ["barbell", "dumbbells", "cable_machine"] as const,
  split: "push_pull_legs" as const,
  workoutDays: ["M", "T", "W", "Th", "F"] as const,
  planMode: "scratch" as const,
  notes: "E2E test — no special notes.",
  textTimeHour: "7",
  textTimeMinute: "00",
  textTimePeriod: "AM",
  timezone: "America/New_York",
};

// ── Selectors (mapped by step) ─────────────────────────────

export const SEL = {
  // Step 1: Phone
  phoneInput: '[data-testid="input-phone"] input, .phone-input-dark input',
  phoneNext: '[data-testid="button-next-phone"]',

  // Step 2: Verify Phone
  otpInput: '[data-testid="input-otp-code"]',
  verifyButton: '[data-testid="button-verify-phone"]',

  // Step 3: Download Contact
  downloadContactNext: '[data-testid="button-next-download-contact"]',

  // Step 4: Send Message
  sendMessageNext: '[data-testid="button-next-send-message"]',

  // Step 5: Demographics
  ageInput: '[data-testid="input-age"]',
  sexContainer: '[data-testid="input-sex"]',
  demographicsNext: '[data-testid="button-next-demographics"]',

  // Step 6: Goal
  goalNext: '[data-testid="button-next-goal"]',

  // Step 7: Consistency
  consistencyNext: '[data-testid="button-next-consistency"]',

  // Step 8: Experience
  experienceNext: '[data-testid="button-next-experience"]',

  // Step 9: Plan Mode
  planModeNext: '[data-testid="button-next-plan-mode"]',

  // Step 10 (Fork B): Equipment
  equipmentNext: '[data-testid="button-next-equipment"]',

  // Step 11 (Fork B): Split + Days
  daysContainer: '[data-testid="input-workout-days"]',
  splitDaysNext: '[data-testid="button-next-split-days"]',

  // Step 12: Plan Detail
  planDetailNext: '[data-testid="button-next-plan-detail"]',

  // Step 13: Text Time
  timezoneSelect: '[data-testid="input-timezone"]',
  textTimeContainer: '[data-testid="input-text-time"]',
  finishButton: '[data-testid="button-finish"]',
};

// ── Helper: click a glass-pill button by its visible label ──

async function clickPill(page: Page, label: string) {
  await page.locator("button.glass-pill", { hasText: label }).click();
}

// ── Helper: select a Radix Select value ─────────────────────

async function selectRadixValue(page: Page, triggerSelector: string, value: string) {
  await page.locator(triggerSelector).click();
  // Radix Select renders options in a portal; click the matching item
  await page.locator(`[role="option"]`, { hasText: value }).click();
}

// ── Step Functions ──────────────────────────────────────────

export async function fillPhoneStep(page: Page) {
  // The PhoneInput component renders a nested <input> — type into it
  const phoneInput = page.locator(SEL.phoneInput).first();
  await phoneInput.waitFor({ state: "visible" });
  await phoneInput.click();
  // Type 10-digit number (PhoneInput already has +1 country code selected)
  await phoneInput.fill(testPhoneDigits);
  await page.locator(SEL.phoneNext).click();
}

export async function fillVerifyPhoneStep(page: Page) {
  const otpInput = page.locator(SEL.otpInput);
  await otpInput.waitFor({ state: "visible" });
  await otpInput.fill(TEST_USER.verificationCode);
  await page.locator(SEL.verifyButton).click();
}

export async function fillDownloadContactStep(page: Page) {
  const btn = page.locator(SEL.downloadContactNext);
  await btn.waitFor({ state: "visible" });
  await btn.click();
}

export async function fillSendMessageStep(page: Page) {
  const btn = page.locator(SEL.sendMessageNext);
  await btn.waitFor({ state: "visible" });
  await btn.click();
}

export async function fillDemographicsStep(page: Page) {
  const ageInput = page.locator(SEL.ageInput);
  await ageInput.waitFor({ state: "visible" });
  await ageInput.fill(TEST_USER.age);

  // Click the "Male" pill button inside the sex container (use exact text match)
  await page.locator(SEL.sexContainer).getByRole("button", { name: "Male", exact: true }).click();

  await page.locator(SEL.demographicsNext).click();
}

export async function fillGoalStep(page: Page) {
  await clickPill(page, "Build Muscle");
  await page.locator(SEL.goalNext).click();
}

export async function fillConsistencyStep(page: Page) {
  await clickPill(page, "I train consistently");
  await page.locator(SEL.consistencyNext).click();
}

export async function fillExperienceStep(page: Page) {
  await clickPill(page, "2-4 years");
  await page.locator(SEL.experienceNext).click();
}

export async function fillPlanModeStep(page: Page) {
  // Click "Start from scratch" card
  await page.locator("button.glass-pill", { hasText: "Start from scratch" }).click();
  await page.locator(SEL.planModeNext).click();
}

export async function fillPlanModeExistingStep(page: Page) {
  // Click "Use my existing plan" card
  await page.locator("button.glass-pill", { hasText: "Use my existing plan" }).click();
  await page.locator(SEL.planModeNext).click();
}

export async function fillEquipmentStep(page: Page) {
  for (const label of ["Barbell", "Dumbbells", "Cable Machine"]) {
    await clickPill(page, label);
  }
  await page.locator(SEL.equipmentNext).click();
}

export async function fillSplitDaysStep(page: Page) {
  // Select split
  await clickPill(page, "Push / Pull / Legs");

  // Select workout days (M T W Th F) — they are round buttons inside the days container
  const daysContainer = page.locator(SEL.daysContainer);
  for (const dayId of TEST_USER.workoutDays) {
    // Day buttons use their `id` (M, T, W, Th, F) as the key.
    // The label text is single-letter (M, T, W, T, F, S, S).
    // Click by nth index to avoid ambiguity between T/Th and S/Su.
    const dayIndex = ["M", "T", "W", "Th", "F", "S", "Su"].indexOf(dayId);
    await daysContainer.locator("button").nth(dayIndex).click();
  }

  await page.locator(SEL.splitDaysNext).click();
}

export async function fillPlanDetailStep(page: Page) {
  // For "scratch" mode, this is an optional notes textarea + Continue button
  await page.locator(SEL.planDetailNext).click();
}

export async function fillPlanDetailExistingStep(page: Page) {
  // For "existing" mode: fill the notes textarea, skip photo upload (optional)
  const notesTextarea = page.locator('[data-testid="textarea-plan-notes"]');
  await notesTextarea.waitFor({ state: "visible" });
  await notesTextarea.fill("E2E test — existing plan notes.");
  await page.locator(SEL.planDetailNext).click();
}

export async function fillTextTimeStep(page: Page) {
  // Timezone is auto-detected; select a specific one via Radix Select
  await selectRadixValue(page, SEL.timezoneSelect, "Eastern Time");

  // Select hour, minute, period from the time selectors
  const timeContainer = page.locator(SEL.textTimeContainer);
  // There are 3 Select triggers inside: Hour, Minute, AM/PM
  const selects = timeContainer.locator("button[role='combobox']");

  // Hour
  await selects.nth(0).click();
  await page.locator("[role='option']", { hasText: /^7$/ }).click();

  // Minute
  await selects.nth(1).click();
  await page.locator("[role='option']", { hasText: /^00$/ }).click();

  // AM/PM — should default to AM, but click to be safe
  await selects.nth(2).click();
  await page.locator("[role='option']", { hasText: "AM" }).click();

  await page.locator(SEL.finishButton).click();
}

// ── Run all onboarding steps sequentially (Fork B: scratch) ──

export async function completeAllOnboardingSteps(page: Page) {
  await fillPhoneStep(page);
  await fillVerifyPhoneStep(page);
  await fillDownloadContactStep(page);
  await fillSendMessageStep(page);
  await fillDemographicsStep(page);
  await fillGoalStep(page);
  await fillConsistencyStep(page);
  await fillExperienceStep(page);
  await fillPlanModeStep(page);
  await fillEquipmentStep(page);
  await fillSplitDaysStep(page);
  await fillPlanDetailStep(page);
  await fillTextTimeStep(page);
}

// ── Run all onboarding steps sequentially (Fork A: existing plan) ──

export async function completeAllOnboardingStepsExisting(page: Page) {
  await fillPhoneStep(page);
  await fillVerifyPhoneStep(page);
  await fillDownloadContactStep(page);
  await fillSendMessageStep(page);
  await fillDemographicsStep(page);
  await fillGoalStep(page);
  await fillConsistencyStep(page);
  await fillExperienceStep(page);
  await fillPlanModeExistingStep(page);
  await fillPlanDetailExistingStep(page);
  await fillTextTimeStep(page);
}
