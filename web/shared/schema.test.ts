import { describe, it, expect } from "vitest";
import {
  insertProfileSchema,
  insertWorkoutSessionSchema,
  insertWorkoutSetSchema,
  insertPhoneVerificationSchema,
} from "./schema";

const baseProfile = {
  userId: "user-123",
  name: "Test User",
  phone: "+15555550100",
  goal: "build_muscle",
};

describe("insertProfileSchema", () => {
  it("accepts a minimal valid profile", () => {
    const result = insertProfileSchema.safeParse(baseProfile);
    expect(result.success).toBe(true);
  });

  it("requires E164 phone format", () => {
    for (const bad of ["5555550100", "+0155550100", "555-555-0100", ""]) {
      const result = insertProfileSchema.safeParse({ ...baseProfile, phone: bad });
      expect(result.success).toBe(false);
    }
    const good = insertProfileSchema.safeParse({ ...baseProfile, phone: "+442071838750" });
    expect(good.success).toBe(true);
  });

  it("trims the name and rejects empty names", () => {
    const trimmed = insertProfileSchema.parse({ ...baseProfile, name: "  Alex  " });
    expect(trimmed.name).toBe("Alex");
    expect(insertProfileSchema.safeParse({ ...baseProfile, name: "" }).success).toBe(false);
    expect(
      insertProfileSchema.safeParse({ ...baseProfile, name: "x".repeat(101) }).success,
    ).toBe(false);
  });

  it("restricts planMode to known values", () => {
    expect(insertProfileSchema.safeParse({ ...baseProfile, planMode: "existing" }).success).toBe(true);
    expect(insertProfileSchema.safeParse({ ...baseProfile, planMode: "scratch" }).success).toBe(true);
    expect(insertProfileSchema.safeParse({ ...baseProfile, planMode: "other" }).success).toBe(false);
  });

  it("caps notes at 1000 characters", () => {
    expect(
      insertProfileSchema.safeParse({ ...baseProfile, notes: "x".repeat(1000) }).success,
    ).toBe(true);
    expect(
      insertProfileSchema.safeParse({ ...baseProfile, notes: "x".repeat(1001) }).success,
    ).toBe(false);
  });
});

describe("insertWorkoutSessionSchema", () => {
  const baseSession = {
    userId: "user-123",
    workoutDate: "2026-01-05T10:00:00.000Z",
    dayIndex: 0,
    dayName: "Monday",
    focus: "Push Day",
  };

  it("coerces ISO date strings to Date objects", () => {
    const parsed = insertWorkoutSessionSchema.parse(baseSession);
    expect(parsed.workoutDate).toBeInstanceOf(Date);
    expect((parsed.workoutDate as Date).toISOString()).toBe("2026-01-05T10:00:00.000Z");
  });

  it("also accepts Date instances directly", () => {
    const date = new Date("2026-01-06T08:00:00.000Z");
    const parsed = insertWorkoutSessionSchema.parse({ ...baseSession, workoutDate: date });
    expect(parsed.workoutDate).toBeInstanceOf(Date);
    expect(parsed.workoutDate).toEqual(date);
  });

  it("rejects sessions missing dayName or focus", () => {
    expect(
      insertWorkoutSessionSchema.safeParse({ ...baseSession, dayName: "" }).success,
    ).toBe(false);
    expect(
      insertWorkoutSessionSchema.safeParse({ ...baseSession, focus: "" }).success,
    ).toBe(false);
  });

  it("rejects negative total duration", () => {
    expect(
      insertWorkoutSessionSchema.safeParse({ ...baseSession, totalDuration: -1 }).success,
    ).toBe(false);
    expect(
      insertWorkoutSessionSchema.safeParse({ ...baseSession, totalDuration: 3600 }).success,
    ).toBe(true);
  });
});

describe("insertWorkoutSetSchema", () => {
  const baseSet = {
    sessionId: 1,
    exerciseName: "Bench Press",
    exerciseIndex: 0,
    setNumber: 1,
  };

  it("accepts a valid set", () => {
    expect(insertWorkoutSetSchema.safeParse(baseSet).success).toBe(true);
  });

  it("bounds RPE between 1 and 10", () => {
    expect(insertWorkoutSetSchema.safeParse({ ...baseSet, rpe: 1 }).success).toBe(true);
    expect(insertWorkoutSetSchema.safeParse({ ...baseSet, rpe: 10 }).success).toBe(true);
    expect(insertWorkoutSetSchema.safeParse({ ...baseSet, rpe: 0 }).success).toBe(false);
    expect(insertWorkoutSetSchema.safeParse({ ...baseSet, rpe: 11 }).success).toBe(false);
    expect(insertWorkoutSetSchema.safeParse({ ...baseSet, rpe: 7.5 }).success).toBe(false);
  });

  it("rejects empty or oversized exercise names", () => {
    expect(insertWorkoutSetSchema.safeParse({ ...baseSet, exerciseName: "" }).success).toBe(false);
    expect(
      insertWorkoutSetSchema.safeParse({ ...baseSet, exerciseName: "x".repeat(201) }).success,
    ).toBe(false);
  });
});

describe("insertPhoneVerificationSchema", () => {
  it("requires E164 phone and a 6-digit code", () => {
    const valid = insertPhoneVerificationSchema.safeParse({
      phoneNumber: "+15555550100",
      code: "123456",
      expiresAt: new Date(),
    });
    expect(valid.success).toBe(true);

    expect(
      insertPhoneVerificationSchema.safeParse({
        phoneNumber: "5555550100",
        code: "123456",
        expiresAt: new Date(),
      }).success,
    ).toBe(false);

    expect(
      insertPhoneVerificationSchema.safeParse({
        phoneNumber: "+15555550100",
        code: "12345",
        expiresAt: new Date(),
      }).success,
    ).toBe(false);
  });
});
