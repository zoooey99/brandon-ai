import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence, useDragControls } from "framer-motion";
import { format, addDays, isSameDay, parseISO, startOfWeek, endOfWeek, subWeeks, subDays, isWithinInterval, startOfDay } from "date-fns";
import {
  Loader2,
  Clock,
  LogOut,
  User,
  Activity,
  Check,
  ChevronRight,
  CreditCard,
  ChevronDown,
  X,
  Flame,
  MessageSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import {
  workoutPlanApi,
  profileApi,
  workoutSessionApi,
  WorkoutPlanData,
  WorkoutSessionData,
  ProfileData,
} from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { PlanManager } from "@/components/plan-manager";
import { WorkoutDetailSheet } from "@/components/workout-detail-sheet";
import { WeekPickerDashboard } from "@/components/week-picker-dashboard";
import { FeedbackSheet } from "@/components/feedback-sheet";
import { trackEvent } from "@/lib/posthog";

interface WorkoutDay {
  day: string;
  focus: string;
  duration: string;
  exercises: Array<{
    name: string;
    sets: number;
    reps: string;
    details?: string[];
  }>;
}

// Helper to compare dates by their date string (YYYY-MM-DD) to avoid timezone issues
// The workout_date is stored as UTC midnight, so we compare using local date strings
function isSameDateString(date1: Date | string, date2: Date | string): boolean {
  const d1 = typeof date1 === "string" ? date1 : date1.toISOString();
  const d2 = typeof date2 === "string" ? date2 : date2.toISOString();
  // Extract just the date part (YYYY-MM-DD) from ISO strings
  return d1.substring(0, 10) === d2.substring(0, 10);
}

// Get today's date as YYYY-MM-DD string in local timezone
function getTodayDateString(): string {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Check if a workout session date matches a given local date
function sessionMatchesLocalDate(sessionDate: Date | string, localDate: Date): boolean {
  // Get the session's date string (first 10 chars of ISO)
  const sessionDateStr = typeof sessionDate === "string"
    ? sessionDate.substring(0, 10)
    : sessionDate.toISOString().substring(0, 10);

  // Get the local date as YYYY-MM-DD
  const year = localDate.getFullYear();
  const month = String(localDate.getMonth() + 1).padStart(2, '0');
  const day = String(localDate.getDate()).padStart(2, '0');
  const localDateStr = `${year}-${month}-${day}`;

  return sessionDateStr === localDateStr;
}

function parseDayToNumber(dayStr: string): number | null {
  const normalized = dayStr.toLowerCase().trim();

  const dayMappings: Record<string, number> = {
    su: 0,
    sun: 0,
    sunday: 0,
    m: 1,
    mon: 1,
    monday: 1,
    t: 2,
    tu: 2,
    tue: 2,
    tues: 2,
    tuesday: 2,
    w: 3,
    wed: 3,
    wednesday: 3,
    th: 4,
    thu: 4,
    thur: 4,
    thurs: 4,
    thursday: 4,
    f: 5,
    fri: 5,
    friday: 5,
    s: 6,
    sa: 6,
    sat: 6,
    saturday: 6,
  };

  if (dayMappings[normalized] !== undefined) {
    return dayMappings[normalized];
  }

  for (const [key, value] of Object.entries(dayMappings)) {
    if (normalized.includes(key) && key.length >= 3) {
      return value;
    }
  }

  return null;
}

function getNext7DaysWorkouts(
  plan: WorkoutDay[],
  sessions: WorkoutSessionData[] = [],
): Array<{ date: Date; workout: WorkoutDay | null }> {
  const today = new Date();
  const next7Days: Array<{ date: Date; workout: WorkoutDay | null }> = [];

  for (let i = 0; i < 7; i++) {
    const date = addDays(today, i);
    const dayOfWeek = date.getDay();

    const planWorkout = plan.find((w) => {
      const workoutDayNum = parseDayToNumber(w.day);
      return workoutDayNum === dayOfWeek;
    });

    // Check if there's a materialized session with custom exercises for this date
    const dateYear = date.getFullYear();
    const dateMonth = String(date.getMonth() + 1).padStart(2, '0');
    const dateDay = String(date.getDate()).padStart(2, '0');
    const dateStr = `${dateYear}-${dateMonth}-${dateDay}`;

    const session = sessions.find((s) => {
      const sf = s.scheduledFor;
      if (sf) {
        const sfStr = typeof sf === 'string' ? sf.substring(0, 10) : '';
        return sfStr === dateStr;
      }
      return false;
    });

    // Prefer session exercises over plan template
    let workout: WorkoutDay | null = planWorkout || null;
    if (session?.exercises && Array.isArray(session.exercises) && session.exercises.length > 0) {
      workout = {
        day: session.dayName,
        focus: session.focus,
        duration: planWorkout?.duration || '',
        exercises: session.exercises,
      };
    }

    next7Days.push({ date, workout });
  }

  return next7Days;
}

// Find the next scheduled workout day (for rest day preview)
function getNextWorkout(
  plan: WorkoutDay[],
  sessions: WorkoutSessionData[] = [],
): { date: Date; workout: WorkoutDay } | null {
  const today = new Date();

  // Look up to 7 days ahead for the next workout
  for (let i = 1; i <= 7; i++) {
    const date = addDays(today, i);
    const dayOfWeek = date.getDay();

    const planWorkout = plan.find((w) => {
      const workoutDayNum = parseDayToNumber(w.day);
      return workoutDayNum === dayOfWeek;
    });

    // Check for a materialized session with custom exercises
    const dateYear = date.getFullYear();
    const dateMonth = String(date.getMonth() + 1).padStart(2, '0');
    const dateDay = String(date.getDate()).padStart(2, '0');
    const dateStr = `${dateYear}-${dateMonth}-${dateDay}`;

    const session = sessions.find((s) => {
      const sf = s.scheduledFor;
      if (sf) {
        const sfStr = typeof sf === 'string' ? sf.substring(0, 10) : '';
        return sfStr === dateStr;
      }
      return false;
    });

    // Prefer session exercises over plan template
    if (session?.exercises && Array.isArray(session.exercises) && session.exercises.length > 0) {
      return {
        date,
        workout: {
          day: session.dayName,
          focus: session.focus,
          duration: planWorkout?.duration || '',
          exercises: session.exercises,
        },
      };
    }

    if (planWorkout) {
      return { date, workout: planWorkout };
    }
  }

  return null;
}

// Calculate week streak (consecutive weeks of completing all planned workouts)
function calculateWeekStreak(
  sessions: WorkoutSessionData[],
  plan: WorkoutDay[],
): number {
  if (sessions.length === 0 || plan.length === 0) return 0;

  // Get planned workout days (0 = Sunday, 1 = Monday, etc.)
  const plannedDays = plan
    .map((w) => parseDayToNumber(w.day))
    .filter((d): d is number => d !== null);

  if (plannedDays.length === 0) return 0;

  let streak = 0;
  const today = new Date();
  let currentWeekStart = startOfWeek(today, { weekStartsOn: 1 }); // Monday start

  // Check each week going backwards
  for (let weekOffset = 0; weekOffset < 52; weekOffset++) {
    const weekStart = subWeeks(currentWeekStart, weekOffset);
    const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });

    // Get completed session dates for this week (only status === "completed" counts)
    const weekSessions = sessions.filter((s) => {
      const sessionDate =
        typeof s.workoutDate === "string" ? parseISO(s.workoutDate) : s.workoutDate;
      return isWithinInterval(sessionDate, { start: weekStart, end: weekEnd }) && s.status === "completed";
    });

    // Get unique days that had completed workouts in this week
    const completedDays = new Set(
      weekSessions.map((s) => {
        const sessionDate =
          typeof s.workoutDate === "string" ? parseISO(s.workoutDate) : s.workoutDate;
        return sessionDate.getDay();
      }),
    );

    // Check if all planned days were completed
    const allPlannedCompleted = plannedDays.every((day) => completedDays.has(day));

    // For current week (weekOffset === 0), don't break streak if not all complete yet
    if (weekOffset === 0) {
      // Check if there are still planned days remaining this week
      const todayDayOfWeek = today.getDay();
      const remainingPlannedDays = plannedDays.filter((day) => day > todayDayOfWeek);
      const completedPlannedDays = plannedDays.filter((day) =>
        day <= todayDayOfWeek ? completedDays.has(day) : true,
      );

      if (completedPlannedDays.length === plannedDays.length || remainingPlannedDays.length > 0) {
        // Current week is on track or hasn't finished yet
        if (allPlannedCompleted) streak++;
        continue; // Check previous weeks
      } else {
        // Already missed a workout this week
        break;
      }
    } else {
      if (allPlannedCompleted) {
        streak++;
      } else {
        break; // Streak broken
      }
    }
  }

  return streak;
}

// Heatmap day state type
type HeatmapDayState = "rest" | "scheduled" | "completed" | "future" | "pre_plan";

type HeatmapDay = {
  date: Date;
  state: HeatmapDayState;
  isToday: boolean;
  session: WorkoutSessionData | null;
  isFirstDayOfPlan?: boolean; // True for the day the current plan started
};

// Generate heatmap data organized by weeks (columns) and days (rows)
// Returns array of weeks, each week is array of 7 days (Sunday=0 to Saturday=6)
function generateHeatmapData(
  sessions: WorkoutSessionData[],
  plan: WorkoutDay[],
  weeksToShow: number = 8,
  planStartDate?: Date | string | null,
): HeatmapDay[][] {
  const today = new Date();

  // Parse plan start date if provided
  const planStart = planStartDate
    ? (typeof planStartDate === "string" ? parseISO(planStartDate) : planStartDate)
    : null;
  // Normalize to start of day for comparison
  const planStartDay = planStart ? startOfDay(planStart) : null;

  // Get planned workout days (0 = Sunday, 1 = Monday, etc.)
  const plannedDays = new Set(
    plan
      .map((w) => parseDayToNumber(w.day))
      .filter((d): d is number => d !== null)
  );

  // Find the start of the current week (Sunday)
  const currentWeekStart = startOfWeek(today, { weekStartsOn: 0 });

  // Generate weeks array (each week is a column)
  const weeks: HeatmapDay[][] = [];

  for (let weekOffset = weeksToShow - 1; weekOffset >= 0; weekOffset--) {
    const weekStart = subWeeks(currentWeekStart, weekOffset);
    const week: HeatmapDay[] = [];

    // For each day of the week (Sunday = 0 to Saturday = 6)
    for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
      const date = addDays(weekStart, dayOfWeek);
      const dateDay = startOfDay(date);
      const isScheduledDay = plannedDays.has(dayOfWeek);
      const isFuture = date > today;
      const isToday = isSameDay(date, today);

      // Check if this day is before the plan started
      const isBeforePlanStart = planStartDay && dateDay < planStartDay;
      const isFirstDayOfPlan = planStartDay && isSameDay(dateDay, planStartDay);

      // Check if there's a completed session for this day
      const completedSession = sessions.find((s) => {
        return sessionMatchesLocalDate(s.workoutDate, date) && s.status === "completed";
      });

      let state: HeatmapDayState;
      if (isBeforePlanStart) {
        // Days before the current plan started - show as muted
        state = "pre_plan";
      } else if (isFuture) {
        state = "future";
      } else if (!isScheduledDay) {
        state = "rest";
      } else if (completedSession) {
        state = "completed";
      } else {
        state = "scheduled";
      }

      week.push({
        date,
        state,
        isToday,
        session: completedSession || null,
        isFirstDayOfPlan: isFirstDayOfPlan || false,
      });
    }

    weeks.push(week);
  }

  return weeks;
}

// Bottom Sheet Component for Mobile Plan View
function MobilePlanSheet({
  isOpen,
  onClose,
  plan,
  expandedDay,
  setExpandedDay,
  allPlans,
  workoutPlan,
  onEdit,
  onSwitch,
  onCreateNew,
}: {
  isOpen: boolean;
  onClose: () => void;
  plan: WorkoutDay[];
  expandedDay: number | null;
  setExpandedDay: (day: number | null) => void;
  allPlans: WorkoutPlanData[];
  workoutPlan: WorkoutPlanData | null;
  onEdit: () => void;
  onSwitch: (planId: number) => Promise<void>;
  onCreateNew: () => void;
}) {
  const dragControls = useDragControls();

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
          />

          {/* Sheet */}
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
            drag="y"
            dragControls={dragControls}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.5 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 100 || info.velocity.y > 500) {
                onClose();
              }
            }}
            className="fixed bottom-0 left-0 right-0 z-50 lg:hidden max-h-[85vh] glass-elevated rounded-t-3xl !border-t !border-white/10 shadow-2xl shadow-black/50 flex flex-col pb-safe"
          >
            {/* Drag Handle */}
            <div
              onPointerDown={(e) => dragControls.start(e)}
              className="flex justify-center py-3 cursor-grab active:cursor-grabbing touch-none"
            >
              <div className="w-10 h-1 rounded-full bg-zinc-700" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-5 pb-4 border-b border-zinc-800/50">
              <div className="flex items-center gap-3">
                <div className="h-8 w-1 rounded-full bg-gradient-to-b from-emerald-400 to-emerald-600" />
                <h2 className="text-lg font-heading font-bold text-white">
                  Your Plan
                </h2>
              </div>
              <button
                onClick={onClose}
                className="h-10 w-10 flex items-center justify-center rounded-full bg-zinc-900 text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
              {plan.map((workout, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.05 }}
                >
                  <button
                    onClick={() =>
                      setExpandedDay(expandedDay === index ? null : index)
                    }
                    className="w-full text-left"
                  >
                    <Card
                      className={`glass-card ${expandedDay === index ? "border-white/20" : ""}`}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-xs font-bold uppercase tracking-wider text-zinc-500">
                              {workout.day}
                            </p>
                            <p className="text-sm font-medium text-white">
                              {workout.focus}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-zinc-500">
                              {workout.duration}
                            </span>
                            <ChevronRight
                              className={`h-4 w-4 text-zinc-500 transition-transform ${expandedDay === index ? "rotate-90" : ""}`}
                            />
                          </div>
                        </div>

                        {expandedDay === index && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            className="mt-3 pt-3 border-t border-zinc-800 space-y-3"
                          >
                            <div>
                              <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-1.5">
                                Exercises
                              </p>
                              <div className="space-y-1">
                                {workout.exercises.map((exercise, i) => (
                                  <div
                                    key={i}
                                    className="flex items-center justify-between text-xs"
                                  >
                                    <span className="text-zinc-400">
                                      {exercise.name}
                                    </span>
                                    <span className="text-zinc-600">
                                      {exercise.sets}x{exercise.reps}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </CardContent>
                    </Card>
                  </button>
                </motion.div>
              ))}
            </div>

            {/* Fixed Bottom - Plan Manager */}
            <div className="shrink-0 p-4 pt-2 border-t border-zinc-800/50 bg-zinc-950">
              <PlanManager
                plans={allPlans}
                activePlan={workoutPlan}
                onEdit={onEdit}
                onSwitch={onSwitch}
                onCreateNew={onCreateNew}
              />
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// Merged Hero Card Component (Today's Workout + Daily Text Time)
function HeroCard({
  workout,
  nextWorkout,
  hasCompleted,
  onViewPlan,
  onTrackWorkout,
  preferredTime,
  isEditingTime,
  editingHour,
  editingMinute,
  editingPeriod,
  onEditTimeStart,
  onEditingHourChange,
  onEditingMinuteChange,
  onEditingPeriodChange,
  onSaveTime,
  onCancelEdit,
  isSavingTime,
  formatTimeDisplay,
}: {
  workout: WorkoutDay | null;
  nextWorkout: { date: Date; workout: WorkoutDay } | null;
  hasCompleted: boolean;
  onViewPlan: () => void;
  onTrackWorkout: () => void;
  preferredTime: string;
  isEditingTime: boolean;
  editingHour: string;
  editingMinute: string;
  editingPeriod: "AM" | "PM";
  onEditTimeStart: () => void;
  onEditingHourChange: (val: string) => void;
  onEditingMinuteChange: (val: string) => void;
  onEditingPeriodChange: (period: "AM" | "PM") => void;
  onSaveTime: () => void;
  onCancelEdit: () => void;
  isSavingTime: boolean;
  formatTimeDisplay: (time: string) => string;
}) {
  // Rest Day variant
  if (!workout) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="lg:hidden"
      >
        <Card className="glass-elevated overflow-hidden">
          {/* Rest Day Main Section */}
          <CardContent className="p-5 text-center">
            <div className="w-12 h-12 rounded-full bg-zinc-800/50 flex items-center justify-center mx-auto mb-3">
              <span className="text-xl">😴</span>
            </div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-1">
              Today
            </p>
            <p className="text-xl font-heading font-bold text-white">
              Rest Day
            </p>
            <p className="text-sm text-zinc-500 mt-1">
              Recovery is part of the process
            </p>
          </CardContent>

          {/* Next Workout Preview */}
          {nextWorkout && (
            <div className="px-5 py-3 bg-black/30 border-t border-white/5">
              <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-2">
                {format(nextWorkout.date, "EEEE")}
              </p>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-white">{nextWorkout.workout.focus}</p>
                  <p className="text-xs text-zinc-500">{nextWorkout.workout.duration} • {nextWorkout.workout.exercises.length} exercises</p>
                </div>
                <Button
                  onClick={onViewPlan}
                  variant="ghost"
                  size="sm"
                  className="text-xs text-zinc-400 hover:text-white hover:bg-zinc-800 h-8 px-3"
                >
                  View Plan
                </Button>
              </div>
            </div>
          )}

          {/* Daily Text Section */}
          <div className="px-5 py-3 bg-black/30 border-t border-white/5">
            {isEditingTime ? (
              <div className="space-y-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                  Daily Text Time
                </p>
                <div className="flex items-center gap-1">
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={2}
                    value={editingHour}
                    onChange={(e) => {
                      const val = e.target.value.replace(/\D/g, '');
                      if (val === '' || (parseInt(val) >= 0 && parseInt(val) <= 12)) {
                        onEditingHourChange(val);
                      }
                    }}
                    autoFocus
                    placeholder="00"
                    className="w-12 text-xl font-bold text-white font-mono bg-zinc-800/50 border-b-2 border-emerald-500 focus:outline-none text-center rounded py-1"
                  />
                  <span className="text-xl font-bold text-zinc-500">:</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={2}
                    value={editingMinute}
                    onChange={(e) => {
                      const val = e.target.value.replace(/\D/g, '');
                      if (val === '' || (parseInt(val) >= 0 && parseInt(val) <= 59)) {
                        onEditingMinuteChange(val);
                      }
                    }}
                    placeholder="00"
                    className="w-12 text-xl font-bold text-white font-mono bg-zinc-800/50 border-b-2 border-emerald-500 focus:outline-none text-center rounded py-1"
                  />
                  <div className="flex gap-1 ml-2">
                    <button
                      onClick={() => onEditingPeriodChange("AM")}
                      className={`px-2 py-1 text-xs font-bold rounded transition-all ${
                        editingPeriod === "AM"
                          ? "bg-emerald-500 text-black"
                          : "bg-zinc-800 text-zinc-400"
                      }`}
                    >
                      AM
                    </button>
                    <button
                      onClick={() => onEditingPeriodChange("PM")}
                      className={`px-2 py-1 text-xs font-bold rounded transition-all ${
                        editingPeriod === "PM"
                          ? "bg-emerald-500 text-black"
                          : "bg-zinc-800 text-zinc-400"
                      }`}
                    >
                      PM
                    </button>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={onSaveTime}
                    disabled={isSavingTime}
                    size="sm"
                    className="bg-emerald-600 hover:bg-emerald-700 text-white h-8 px-3"
                  >
                    {isSavingTime ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
                  </Button>
                  <Button
                    onClick={onCancelEdit}
                    variant="ghost"
                    size="sm"
                    className="text-zinc-400 hover:text-white h-8 px-3"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                    Daily Text
                  </p>
                  <p className="text-lg font-bold text-white font-mono">
                    {formatTimeDisplay(preferredTime)}
                  </p>
                </div>
                <Button
                  onClick={onEditTimeStart}
                  variant="ghost"
                  size="sm"
                  className="text-xs text-zinc-400 hover:text-white hover:bg-zinc-800 h-8 px-3"
                >
                  Edit
                </Button>
              </div>
            )}
          </div>
        </Card>
      </motion.div>
    );
  }

  // Workout Day variant
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="lg:hidden"
    >
      <Card className="glass-elevated overflow-hidden">
        {/* Workout Main Section */}
        <CardContent className="p-5">
          <div className="flex items-start justify-between mb-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-1">
                Today
              </p>
              <p className="text-xl font-heading font-bold text-white">
                {workout.focus}
              </p>
              <p className="text-sm text-zinc-400 mt-0.5">
                {workout.duration} • {workout.exercises.length} exercises
              </p>
            </div>
            {hasCompleted && (
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-300 bg-emerald-500/20 border border-emerald-500/30 px-2.5 py-1.5 rounded-lg flex items-center gap-1">
                <Check className="h-3 w-3" /> Done
              </span>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2 mt-4">
            {!hasCompleted ? (
              <Button
                onClick={onTrackWorkout}
                className="flex-1 h-11 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-white font-semibold rounded-xl transition-all shadow-lg shadow-emerald-500/20"
              >
                <Check className="h-4 w-4 mr-2" />
                Track Workout
              </Button>
            ) : (
              <Button
                onClick={onViewPlan}
                className="flex-1 h-11 bg-white hover:bg-zinc-100 text-black font-semibold rounded-xl transition-all"
              >
                View Full Plan
              </Button>
            )}
            {!hasCompleted && (
              <Button
                onClick={onViewPlan}
                variant="ghost"
                className="h-11 px-4 bg-zinc-800/50 hover:bg-zinc-800 text-white rounded-xl border border-white/10"
              >
                View Plan
              </Button>
            )}
          </div>
        </CardContent>

        {/* Daily Text Section */}
        <div className="px-5 py-3 bg-black/30 border-t border-white/5">
          {isEditingTime ? (
            <div className="space-y-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                Daily Text Time
              </p>
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={2}
                  value={editingHour}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, '');
                    if (val === '' || (parseInt(val) >= 0 && parseInt(val) <= 12)) {
                      onEditingHourChange(val);
                    }
                  }}
                  autoFocus
                  placeholder="00"
                  className="w-12 text-xl font-bold text-white font-mono bg-zinc-800/50 border-b-2 border-emerald-500 focus:outline-none text-center rounded py-1"
                />
                <span className="text-xl font-bold text-zinc-500">:</span>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={2}
                  value={editingMinute}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, '');
                    if (val === '' || (parseInt(val) >= 0 && parseInt(val) <= 59)) {
                      onEditingMinuteChange(val);
                    }
                  }}
                  placeholder="00"
                  className="w-12 text-xl font-bold text-white font-mono bg-zinc-800/50 border-b-2 border-emerald-500 focus:outline-none text-center rounded py-1"
                />
                <div className="flex gap-1 ml-2">
                  <button
                    onClick={() => onEditingPeriodChange("AM")}
                    className={`px-2 py-1 text-xs font-bold rounded transition-all ${
                      editingPeriod === "AM"
                        ? "bg-emerald-500 text-black"
                        : "bg-zinc-800 text-zinc-400"
                    }`}
                  >
                    AM
                  </button>
                  <button
                    onClick={() => onEditingPeriodChange("PM")}
                    className={`px-2 py-1 text-xs font-bold rounded transition-all ${
                      editingPeriod === "PM"
                        ? "bg-emerald-500 text-black"
                        : "bg-zinc-800 text-zinc-400"
                    }`}
                  >
                    PM
                  </button>
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={onSaveTime}
                  disabled={isSavingTime}
                  size="sm"
                  className="bg-emerald-600 hover:bg-emerald-700 text-white h-8 px-3"
                >
                  {isSavingTime ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
                </Button>
                <Button
                  onClick={onCancelEdit}
                  variant="ghost"
                  size="sm"
                  className="text-zinc-400 hover:text-white h-8 px-3"
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                  Daily Text
                </p>
                <p className="text-lg font-bold text-white font-mono">
                  {formatTimeDisplay(preferredTime)}
                </p>
              </div>
              <Button
                onClick={onEditTimeStart}
                variant="ghost"
                size="sm"
                className="text-xs text-zinc-400 hover:text-white hover:bg-zinc-800 h-8 px-3"
              >
                Edit
              </Button>
            </div>
          )}
        </div>
      </Card>
    </motion.div>
  );
}

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const { user, isLoading, isAuthenticated, logout } = useAuth();
  const { toast } = useToast();

  const [workoutPlan, setWorkoutPlan] = useState<WorkoutPlanData | null>(null);
  const [allPlans, setAllPlans] = useState<WorkoutPlanData[]>([]);
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [plan, setPlan] = useState<WorkoutDay[]>([]);
  const [sessions, setSessions] = useState<WorkoutSessionData[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [preferredTime, setPreferredTime] = useState("");
  const [isSavingTime, setIsSavingTime] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [expandedDay, setExpandedDay] = useState<number | null>(null);
  const [isEditingTime, setIsEditingTime] = useState(false);
  const [editingHour, setEditingHour] = useState("");
  const [editingMinute, setEditingMinute] = useState("");
  const [editingPeriod, setEditingPeriod] = useState<"AM" | "PM">("AM");
  const [isPlanSheetOpen, setIsPlanSheetOpen] = useState(false);

  // Workout detail sheet state (for heatmap clicks)
  const [isWorkoutDetailOpen, setIsWorkoutDetailOpen] = useState(false);
  const [selectedHeatmapDay, setSelectedHeatmapDay] = useState<HeatmapDay | null>(null);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      window.location.href = "/login?returnTo=/dashboard";
    }
  }, [isLoading, isAuthenticated]);

  // Load all dashboard data
  const loadData = useCallback(async (userId: string) => {
    try {
      const [planData, allPlansData, profileData, sessionsData] = await Promise.all([
        workoutPlanApi.get(userId),
        workoutPlanApi.getAll(userId),
        profileApi.get(userId),
        workoutSessionApi.getAll(100, 0),
      ]);

      if (planData && planData.planData?.workouts?.length) {
        setWorkoutPlan(planData);
        setPlan(planData.planData.workouts);
      } else {
        setLocation("/setup-plan");
        return;
      }

      setAllPlans(allPlansData);

      if (profileData) {
        setProfile(profileData);
        setPreferredTime(profileData.preferredTextTime || "09:00");
      }

      setSessions(sessionsData);
    } catch (error) {
      console.error("Error loading dashboard data:", error);
      toast({
        title: "Error",
        description: "Failed to load your data",
        variant: "destructive",
      });
    } finally {
      setIsLoadingData(false);
    }
  }, [setLocation, toast]);

  // Initial data load
  useEffect(() => {
    if (!user?.id) return;
    loadData(user.id);
  }, [user?.id, loadData]);

  // Refetch sessions when page becomes visible (e.g., returning from workout tracker)
  useEffect(() => {
    if (!user?.id) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // Only refetch sessions, not all data
        workoutSessionApi.getAll(100, 0).then(setSessions).catch(console.error);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [user?.id]);

  const handleSwitchPlan = async (planId: number) => {
    if (!user?.id) return;

    try {
      const activatedPlan = await workoutPlanApi.activate(planId);

      setWorkoutPlan(activatedPlan);
      if (activatedPlan.planData?.workouts) {
        setPlan(activatedPlan.planData.workouts);
      }

      const updatedPlans = await workoutPlanApi.getAll(user.id);
      setAllPlans(updatedPlans);

      trackEvent('plan_switched', { plan_id: planId });

      toast({
        title: "Plan Activated",
        description: "Your workout plan has been switched.",
      });
    } catch (error) {
      console.error("Error switching plan:", error);
      toast({
        title: "Error",
        description: "Failed to switch plan. Please try again.",
        variant: "destructive",
      });
    }
  };

  const startEditingTime = () => {
    if (preferredTime) {
      const [hours, minutes] = preferredTime.split(':');
      const hour24 = parseInt(hours);
      const isPM = hour24 >= 12;
      const hour12 = hour24 > 12 ? hour24 - 12 : hour24 === 0 ? 12 : hour24;
      setEditingHour(hour12.toString());
      setEditingMinute(minutes);
      setEditingPeriod(isPM ? "PM" : "AM");
    } else {
      setEditingHour("9");
      setEditingMinute("00");
      setEditingPeriod("AM");
    }
    setIsEditingTime(true);
  };

  const cancelEditingTime = () => {
    setIsEditingTime(false);
    setEditingHour("");
    setEditingMinute("");
  };

  const saveTime = async () => {
    const hour = parseInt(editingHour);
    const minute = parseInt(editingMinute);

    if (isNaN(hour) || hour < 1 || hour > 12) {
      toast({
        title: "Invalid Hour",
        description: "Please enter an hour between 1 and 12",
        variant: "destructive",
      });
      return;
    }

    if (isNaN(minute) || minute < 0 || minute > 59) {
      toast({
        title: "Invalid Minutes",
        description: "Please enter minutes between 00 and 59",
        variant: "destructive",
      });
      return;
    }

    let hour24 = hour;
    if (editingPeriod === "PM" && hour !== 12) {
      hour24 = hour + 12;
    } else if (editingPeriod === "AM" && hour === 12) {
      hour24 = 0;
    }

    const validatedTime = `${hour24.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;

    if (!profile?.id) return;

    setIsSavingTime(true);
    try {
      const updatedProfile = await profileApi.update(profile.id, {
        preferredTextTime: validatedTime,
      });
      setProfile(updatedProfile);
      setPreferredTime(validatedTime);
      setIsEditingTime(false);
      toast({
        title: "Updated",
        description: "Your daily message time has been updated.",
      });
    } catch (error) {
      console.error("Error updating time:", error);
      toast({
        title: "Error",
        description: "Failed to update time preference. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSavingTime(false);
    }
  };

  const handleTimeKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      saveTime();
    } else if (e.key === "Escape") {
      cancelEditingTime();
    }
  };

  const next7Days = getNext7DaysWorkouts(plan, sessions);
  const todayWorkout = next7Days[0];
  const todayCompleted = sessions.some((s) => {
    return sessionMatchesLocalDate(s.workoutDate, new Date()) && s.status === "completed";
  });

  // Get next workout for rest day preview
  const nextWorkout = getNextWorkout(plan, sessions);

  // Handle Track Workout button - creates/gets session and navigates to tracker
  const handleTrackWorkout = async () => {
    if (!workoutPlan?.id || !todayWorkout.workout) {
      toast({
        title: "Unable to start workout",
        description: "No workout plan found for today.",
        variant: "destructive",
      });
      return;
    }

    try {
      // Find the day index in the plan
      const dayIndex = workoutPlan.planData.workouts.findIndex(
        (w) => w.day === todayWorkout.workout!.day && w.focus === todayWorkout.workout!.focus
      );

      if (dayIndex === -1) {
        toast({
          title: "Unable to start workout",
          description: "Could not find today's workout in the plan.",
          variant: "destructive",
        });
        return;
      }

      // Call API to create/get session and token
      const { token } = await workoutSessionApi.startToday({
        planId: workoutPlan.id,
        dayIndex,
        dayName: todayWorkout.workout.day,
        focus: todayWorkout.workout.focus,
      });

      // Navigate to the workout tracker
      setLocation(`/track/${token}`);
    } catch (error) {
      console.error("Error starting workout:", error);
      toast({
        title: "Error",
        description: "Failed to start workout tracking. Please try again.",
        variant: "destructive",
      });
    }
  };

  // Handle Track Workout for any day (with scheduledFor support)
  const handleTrackWorkoutForDate = async (
    workout: WorkoutDay,
    scheduledFor: Date,
    dayIndex: number
  ) => {
    if (!workoutPlan?.id) {
      toast({
        title: "Unable to start workout",
        description: "No workout plan found.",
        variant: "destructive",
      });
      return;
    }

    try {
      // Call the new API that supports scheduledFor
      const { token } = await workoutSessionApi.start({
        planId: workoutPlan.id,
        dayIndex,
        dayName: workout.day,
        focus: workout.focus,
        scheduledFor: scheduledFor.toISOString(),
      });

      // Navigate to the workout tracker
      setLocation(`/track/${token}`);
    } catch (error) {
      console.error("Error starting workout:", error);
      toast({
        title: "Error",
        description: "Failed to start workout tracking. Please try again.",
        variant: "destructive",
      });
    }
  };

  const formatTimeDisplay = (time: string) => {
    if (!time) return "";
    const [hours, minutes] = time.split(":");
    const hour = parseInt(hours);
    const period = hour >= 12 ? "PM" : "AM";
    const displayHour = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
    return `${displayHour}:${minutes} ${period}`;
  };

  if (isLoading || isLoadingData) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-white" />
      </div>
    );
  }

  return (
    <div className="h-screen bg-black text-white flex flex-col overflow-hidden">
      {/* Header - Responsive */}
      <header className="shrink-0 flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 glass-header">
        <div className="flex items-center gap-2">
          <span className="font-heading font-black text-xl sm:text-2xl tracking-tighter uppercase leading-[0.85]">
            Brandon
          </span>
          <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.8)] animate-pulse mt-0.5"></div>
        </div>
        {profile?.name && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="flex items-center gap-2 text-sm text-zinc-400 hover:text-white transition-colors px-2 sm:px-3 py-2 rounded-lg hover:bg-zinc-900 min-h-[44px]"
                data-testid="button-profile-menu"
              >
                <div className="h-8 w-8 rounded-full bg-zinc-800 flex items-center justify-center">
                  <User className="h-4 w-4" />
                </div>
                <span className="hidden sm:inline" data-testid="text-username">{profile.name}</span>
                <ChevronDown className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="bg-zinc-900 border-zinc-800 rounded-xl text-white w-48"
            >
              <DropdownMenuItem
                className="hover:bg-zinc-800 focus:bg-zinc-800 cursor-pointer min-h-[44px]"
                onClick={() => setFeedbackOpen(true)}
                data-testid="menu-help-feedback"
              >
                <MessageSquare className="h-4 w-4 mr-2" />
                Help & Feedback
              </DropdownMenuItem>
              <DropdownMenuItem
                className="hover:bg-zinc-800 focus:bg-zinc-800 cursor-pointer min-h-[44px]"
                onClick={() =>
                  window.open(
                    "https://billing.stripe.com/p/login/28E5kC6k56or7aV2C7e3e00",
                    "_blank",
                  )
                }
                data-testid="menu-manage-subscription"
              >
                <CreditCard className="h-4 w-4 mr-2" />
                Manage subscription
              </DropdownMenuItem>
              <DropdownMenuItem
                className="hover:bg-zinc-800 focus:bg-zinc-800 cursor-pointer text-red-400 focus:text-red-400 min-h-[44px]"
                onClick={() => logout()}
                data-testid="menu-sign-out"
              >
                <LogOut className="h-4 w-4 mr-2" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </header>

      <div className="flex flex-col lg:flex-row flex-1 overflow-hidden">
        {/* LEFT SIDE: Desktop Plan Display - Hidden on mobile */}
        <div className="hidden lg:flex lg:w-80 xl:w-96 border-r border-white/8 glass-surface flex-col">
          <div className="flex-1 overflow-y-auto p-4 lg:p-6">
            <div className="mb-6">
              <div className="flex items-center gap-3 mb-2">
                <div className="h-8 w-1 rounded-full bg-gradient-to-b from-emerald-400 to-emerald-600"></div>
                <h2
                  className="text-lg font-heading font-bold text-white tracking-tight"
                  data-testid="text-plan-title"
                >
                  Your Plan
                </h2>
              </div>
            </div>

            <div className="space-y-2">
              {plan.map((workout, index) => {
                // Check if this workout day is today
                const workoutDayNum = parseDayToNumber(workout.day);
                const todayDayNum = new Date().getDay();
                const isToday = workoutDayNum === todayDayNum;

                // Check if this workout is completed today
                const isTodayCompleted = isToday && sessions.some((s) => {
                  return sessionMatchesLocalDate(s.workoutDate, new Date()) && s.status === "completed";
                });

                return (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.05 }}
                >
                  <button
                    onClick={() =>
                      setExpandedDay(expandedDay === index ? null : index)
                    }
                    className="w-full text-left"
                    data-testid={`card-workout-${index}`}
                  >
                    <Card
                      className={`glass-card transition-all ${
                        isToday
                          ? "!border-white/30 ring-1 ring-white/10"
                          : expandedDay === index
                            ? "border-white/20"
                            : ""
                      } ${isTodayCompleted ? "!border-emerald-500/30" : ""}`}
                    >
                      <CardContent className="p-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="flex items-center gap-2 mb-0.5">
                              <p className="text-xs font-bold uppercase tracking-wider text-zinc-500">
                                {workout.day}
                              </p>
                              {isToday && (
                                <span className="text-[9px] font-bold uppercase tracking-wider text-white bg-white/15 px-1.5 py-0.5 rounded">
                                  Today
                                </span>
                              )}
                              {isTodayCompleted && (
                                <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-400 bg-emerald-500/20 px-1.5 py-0.5 rounded flex items-center gap-1">
                                  <Check className="h-2.5 w-2.5" />
                                  Done
                                </span>
                              )}
                            </div>
                            <p className="text-sm font-medium text-white">
                              {workout.focus}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-zinc-500">
                              {workout.duration}
                            </span>
                            <ChevronRight
                              className={`h-4 w-4 text-zinc-500 transition-transform ${expandedDay === index ? "rotate-90" : ""}`}
                            />
                          </div>
                        </div>

                        {expandedDay === index && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            className="mt-3 pt-3 border-t border-zinc-800 space-y-3"
                          >
                            <div>
                              <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-1.5">
                                Exercises
                              </p>
                              <div className="space-y-1">
                                {workout.exercises.map((exercise, i) => (
                                  <div
                                    key={i}
                                    className="flex items-center justify-between text-xs"
                                  >
                                    <span className="text-zinc-400">
                                      {exercise.name}
                                    </span>
                                    <span className="text-zinc-600">
                                      {exercise.sets}x{exercise.reps}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </CardContent>
                    </Card>
                  </button>
                </motion.div>
                );
              })}
            </div>
          </div>

          <div className="shrink-0 p-4 lg:p-6 pt-0">
            <PlanManager
              plans={allPlans}
              activePlan={workoutPlan}
              onEdit={() => setLocation("/setup-plan?mode=edit")}
              onSwitch={handleSwitchPlan}
              onCreateNew={() => setLocation("/setup-plan?mode=new")}
            />
          </div>
        </div>

        {/* RIGHT SIDE: Main Content - Responsive */}
        <div className="flex-1 p-4 sm:p-5 md:p-6 lg:p-8 overflow-y-auto">
          <div className="max-w-4xl mx-auto space-y-5 sm:space-y-6 lg:space-y-8">
            {/* Mobile: Week Picker + Workout Card */}
            <WeekPickerDashboard
              workoutPlan={workoutPlan}
              sessions={sessions}
              onTrackWorkout={handleTrackWorkoutForDate}
              onViewPlan={() => setIsPlanSheetOpen(true)}
              onViewWorkoutDetails={(session, date) => {
                // Reuse the heatmap day state to show workout details
                setSelectedHeatmapDay({
                  date,
                  state: "completed",
                  isToday: false,
                  session,
                });
                setIsWorkoutDetailOpen(true);
              }}
            />

            {/* Mobile: Daily Text Time Card (separate from week picker) */}
            <div className="lg:hidden">
              <Card className="glass-card overflow-hidden">
                <CardContent className="p-4">
                  {isEditingTime ? (
                    <div className="space-y-3">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                        Daily Text Time
                      </p>
                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          inputMode="numeric"
                          maxLength={2}
                          value={editingHour}
                          onChange={(e) => {
                            const val = e.target.value.replace(/\D/g, '');
                            if (val === '' || (parseInt(val) >= 0 && parseInt(val) <= 12)) {
                              setEditingHour(val);
                            }
                          }}
                          autoFocus
                          placeholder="00"
                          className="w-12 text-xl font-bold text-white font-mono bg-zinc-800/50 border-b-2 border-emerald-500 focus:outline-none text-center rounded py-1"
                        />
                        <span className="text-xl font-bold text-zinc-500">:</span>
                        <input
                          type="text"
                          inputMode="numeric"
                          maxLength={2}
                          value={editingMinute}
                          onChange={(e) => {
                            const val = e.target.value.replace(/\D/g, '');
                            if (val === '' || (parseInt(val) >= 0 && parseInt(val) <= 59)) {
                              setEditingMinute(val);
                            }
                          }}
                          placeholder="00"
                          className="w-12 text-xl font-bold text-white font-mono bg-zinc-800/50 border-b-2 border-emerald-500 focus:outline-none text-center rounded py-1"
                        />
                        <div className="flex gap-1 ml-2">
                          <button
                            onClick={() => setEditingPeriod("AM")}
                            className={`px-2 py-1 text-xs font-bold rounded transition-all ${
                              editingPeriod === "AM"
                                ? "bg-emerald-500 text-black"
                                : "bg-zinc-800 text-zinc-400"
                            }`}
                          >
                            AM
                          </button>
                          <button
                            onClick={() => setEditingPeriod("PM")}
                            className={`px-2 py-1 text-xs font-bold rounded transition-all ${
                              editingPeriod === "PM"
                                ? "bg-emerald-500 text-black"
                                : "bg-zinc-800 text-zinc-400"
                            }`}
                          >
                            PM
                          </button>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          onClick={saveTime}
                          disabled={isSavingTime}
                          size="sm"
                          className="bg-emerald-600 hover:bg-emerald-700 text-white h-8 px-3"
                        >
                          {isSavingTime ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
                        </Button>
                        <Button
                          onClick={cancelEditingTime}
                          variant="ghost"
                          size="sm"
                          className="text-zinc-400 hover:text-white h-8 px-3"
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                          Daily Text
                        </p>
                        <p className="text-lg font-bold text-white font-mono">
                          {formatTimeDisplay(preferredTime)}
                        </p>
                      </div>
                      <Button
                        onClick={startEditingTime}
                        variant="ghost"
                        size="sm"
                        className="text-xs text-zinc-400 hover:text-white hover:bg-zinc-800 h-8 px-3"
                      >
                        Edit
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Desktop: Today's Workout Card */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="hidden lg:block"
            >
              {todayWorkout.workout ? (
                // Workout Day
                <Card className={`overflow-hidden ${todayCompleted ? "glass-elevated" : "glass-elevated border-emerald-500/20"}`}>
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-400 mb-1">
                          Today's Workout
                        </p>
                        <h3 className="text-2xl font-heading font-bold text-white mb-2">
                          {todayWorkout.workout.focus}
                        </h3>
                        <div className="flex flex-wrap gap-2 mb-4">
                          {todayWorkout.workout.exercises.slice(0, 5).map((ex, i) => (
                            <span
                              key={i}
                              className="text-sm text-zinc-300 bg-white/[0.06] px-3 py-1.5 rounded-full"
                            >
                              {ex.name}
                            </span>
                          ))}
                          {todayWorkout.workout.exercises.length > 5 && (
                            <span className="text-sm text-zinc-500 bg-white/[0.04] px-3 py-1.5 rounded-full">
                              +{todayWorkout.workout.exercises.length - 5} more
                            </span>
                          )}
                        </div>
                        {!todayCompleted && (
                          <Button
                            onClick={handleTrackWorkout}
                            className="bg-emerald-500 hover:bg-emerald-400 text-black font-semibold px-6 py-2.5 rounded-xl"
                          >
                            <Activity className="h-4 w-4 mr-2" />
                            Track Workout
                          </Button>
                        )}
                      </div>
                      {todayCompleted && (
                        <div className="flex items-center gap-3 bg-emerald-500/20 border border-emerald-500/30 rounded-xl px-4 py-3">
                          <div className="h-10 w-10 rounded-full bg-emerald-500 flex items-center justify-center">
                            <Check className="h-5 w-5 text-black" />
                          </div>
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                              Completed
                            </p>
                            <p className="text-sm font-semibold text-white">
                              {todayWorkout.workout.focus}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ) : (
                // Rest Day
                <Card className="glass-card overflow-hidden">
                  <CardContent className="p-6 text-center">
                    <div className="w-14 h-14 rounded-full bg-zinc-800/50 flex items-center justify-center mx-auto mb-4">
                      <span className="text-3xl">😴</span>
                    </div>
                    <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-500 mb-1">
                      Today
                    </p>
                    <h3 className="text-2xl font-heading font-bold text-white mb-2">
                      Rest Day
                    </h3>
                    <p className="text-sm text-zinc-500 mb-4">
                      Recovery is part of the process
                    </p>

                    {/* Next Workout Preview */}
                    {nextWorkout && (
                      <div className="bg-white/[0.04] border border-white/[0.08] rounded-xl p-4 mt-4 inline-block">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-1">
                          Up Next — {format(nextWorkout.date, "EEEE")}
                        </p>
                        <p className="text-lg font-semibold text-white">
                          {nextWorkout.workout.focus}
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </motion.div>

            {/* Daily Message Time Setting - Desktop Only (mobile shows in HeroCard) */}
            <Card className="glass-card overflow-hidden hidden lg:block">
              <CardContent className="p-5 sm:p-6 md:p-8">
                <div className="text-center">
                  <p className="text-xs sm:text-sm text-zinc-500 uppercase tracking-widest mb-2">
                    Daily Text Time
                  </p>

                  {isEditingTime ? (
                    <div className="space-y-4 sm:space-y-6">
                      <div className="flex items-center justify-center gap-1 sm:gap-2">
                        <input
                          type="text"
                          inputMode="numeric"
                          maxLength={2}
                          value={editingHour}
                          onChange={(e) => {
                            const val = e.target.value.replace(/\D/g, '');
                            if (val === '' || (parseInt(val) >= 0 && parseInt(val) <= 12)) {
                              setEditingHour(val);
                            }
                          }}
                          onKeyDown={handleTimeKeyDown}
                          autoFocus
                          placeholder="00"
                          className="w-20 sm:w-24 md:w-32 text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold text-white tracking-tight font-mono leading-none bg-zinc-800/50 border-b-4 border-emerald-500 focus:outline-none text-center rounded-lg py-2"
                          data-testid="input-hour"
                        />
                        <span className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold text-zinc-500">:</span>
                        <input
                          type="text"
                          inputMode="numeric"
                          maxLength={2}
                          value={editingMinute}
                          onChange={(e) => {
                            const val = e.target.value.replace(/\D/g, '');
                            if (val === '' || (parseInt(val) >= 0 && parseInt(val) <= 59)) {
                              setEditingMinute(val);
                            }
                          }}
                          onKeyDown={handleTimeKeyDown}
                          placeholder="00"
                          className="w-20 sm:w-24 md:w-32 text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold text-white tracking-tight font-mono leading-none bg-zinc-800/50 border-b-4 border-emerald-500 focus:outline-none text-center rounded-lg py-2"
                          data-testid="input-minute"
                        />
                        <div className="flex flex-col gap-1 ml-1 sm:ml-2">
                          <button
                            onClick={() => setEditingPeriod("AM")}
                            className={`px-2 sm:px-3 py-1.5 sm:py-2 text-sm sm:text-base md:text-lg font-bold rounded-lg transition-all min-h-[40px] sm:min-h-[44px] ${
                              editingPeriod === "AM"
                                ? "bg-emerald-500 text-black"
                                : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                            }`}
                            data-testid="button-am"
                          >
                            AM
                          </button>
                          <button
                            onClick={() => setEditingPeriod("PM")}
                            className={`px-2 sm:px-3 py-1.5 sm:py-2 text-sm sm:text-base md:text-lg font-bold rounded-lg transition-all min-h-[40px] sm:min-h-[44px] ${
                              editingPeriod === "PM"
                                ? "bg-emerald-500 text-black"
                                : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                            }`}
                            data-testid="button-pm"
                          >
                            PM
                          </button>
                        </div>
                      </div>
                      <p className="text-zinc-400 text-xs sm:text-sm">
                        Press <span className="text-white font-medium">Enter</span> to save or <span className="text-white font-medium">Escape</span> to cancel
                      </p>
                      <div className="flex items-center justify-center gap-3">
                        <Button
                          onClick={saveTime}
                          disabled={isSavingTime}
                          className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 min-h-[44px]"
                          data-testid="button-save-time"
                        >
                          {isSavingTime ? (
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          ) : null}
                          Save
                        </Button>
                        <Button
                          onClick={cancelEditingTime}
                          variant="outline"
                          className="border-zinc-700 text-zinc-300 hover:bg-zinc-800 min-h-[44px]"
                          data-testid="button-cancel-time"
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="relative inline-block">
                        <p className="text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-bold text-white tracking-tight font-mono leading-none">
                          {formatTimeDisplay(preferredTime).split(' ')[0]}
                        </p>
                        <span className="absolute -right-8 sm:-right-10 md:-right-12 top-1 sm:top-2 text-base sm:text-lg md:text-xl font-medium text-zinc-500">
                          {formatTimeDisplay(preferredTime).split(' ')[1]}
                        </span>
                      </div>
                      <p className="text-zinc-500 mt-3 sm:mt-4 mb-4 sm:mb-6 text-sm sm:text-base">
                        Brandon will text you every day
                      </p>
                      <Button
                        onClick={startEditingTime}
                        className="bg-white/10 backdrop-blur-md text-white border border-white/20 hover:bg-white/20 hover:border-white/30 px-5 sm:px-6 py-3 rounded-full font-medium shadow-lg min-h-[44px]"
                        data-testid="button-edit-time"
                      >
                        <Clock className="h-4 w-4 mr-2" />
                        Change Time
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* This Week - Desktop Only (mobile uses WeekPickerDashboard above) */}
            <div className="hidden lg:block">
              <h2 className="text-base sm:text-lg font-heading font-medium text-white mb-3 sm:mb-4">
                This Week
              </h2>

              {/* Desktop: Week Grid */}
              <div className="-mx-4 px-4 overflow-x-auto scrollbar-hide">
                <div className="flex gap-2 pb-2" style={{ width: "max-content" }}>
                  {next7Days.map(({ date, workout }, index) => {
                    const isToday = isSameDay(date, new Date());
                    const hasCompleted = sessions.some((s) => {
                      return sessionMatchesLocalDate(s.workoutDate, date) && s.status === "completed";
                    });

                    return (
                      <motion.div
                        key={index}
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: index * 0.03 }}
                        data-testid={`upcoming-day-mobile-${index}`}
                        className="w-[72px] shrink-0"
                      >
                        <Card
                          className={`h-full transition-all ${
                            isToday
                              ? "glass-elevated !border-white/30 ring-2 ring-white/20"
                              : workout
                                ? "glass-card"
                                : "glass-card opacity-60"
                          }`}
                        >
                          <CardContent className="p-3 flex flex-col items-center text-center">
                            {/* Day & Date */}
                            <span className={`text-[10px] font-bold uppercase ${isToday ? "text-white" : !workout ? "text-zinc-600" : "text-zinc-500"}`}>
                              {format(date, "EEE")}
                            </span>
                            <span className={`text-xl font-bold ${isToday ? "text-white" : !workout ? "text-zinc-600" : "text-white"}`}>
                              {format(date, "d")}
                            </span>

                            {/* Status Icon */}
                            <div className="mt-2 h-5 flex items-center justify-center">
                              {hasCompleted && workout ? (
                                <div className="h-5 w-5 rounded-full bg-emerald-500/20 flex items-center justify-center">
                                  <Check className="h-3 w-3 text-emerald-400" />
                                </div>
                              ) : workout ? (
                                <div className="h-1.5 w-1.5 rounded-full bg-white/40"></div>
                              ) : (
                                <span className="text-[10px] text-zinc-600">Rest</span>
                              )}
                            </div>
                          </CardContent>
                        </Card>
                      </motion.div>
                    );
                  })}
                </div>
              </div>

              {/* Desktop: Vertical List */}
              <div className="hidden lg:grid gap-2">
                {next7Days.map(({ date, workout }, index) => {
                  const isToday = isSameDay(date, new Date());
                  const hasCompleted = sessions.some((s) => {
                    return sessionMatchesLocalDate(s.workoutDate, date) && s.status === "completed";
                  });

                  return (
                    <motion.div
                      key={index}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.03 }}
                      data-testid={`upcoming-day-${index}`}
                    >
                      <Card
                        className={`transition-all ${
                          isToday
                            ? "glass-elevated !border-white/30 ring-2 ring-white/20"
                            : workout
                              ? "glass-card"
                              : "glass-card opacity-60"
                        }`}
                      >
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-4">
                              <div
                                className={`h-12 w-12 rounded-lg flex flex-col items-center justify-center relative shrink-0 ${
                                  isToday
                                    ? "bg-white text-black"
                                    : workout
                                      ? "bg-zinc-800"
                                      : "bg-zinc-800/50"
                                }`}
                              >
                                {isToday && (
                                  <span className="absolute -top-1 -right-1 h-3 w-3 bg-white rounded-full animate-pulse"></span>
                                )}
                                <span className={`text-[10px] font-bold uppercase ${!workout && !isToday ? "text-zinc-500" : ""}`}>
                                  {format(date, "EEE")}
                                </span>
                                <span className={`text-lg font-bold leading-none ${!workout && !isToday ? "text-zinc-500" : ""}`}>
                                  {format(date, "d")}
                                </span>
                              </div>
                              <div className="min-w-0 flex-1">
                                {workout ? (
                                  <>
                                    <div className="flex items-center gap-2 flex-wrap">
                                      {isToday && (
                                        <span className="text-[10px] font-bold uppercase tracking-wider text-white bg-white/20 px-2 py-0.5 rounded shrink-0">
                                          Today
                                        </span>
                                      )}
                                      <p className="font-medium text-white truncate">
                                        {workout.focus}
                                      </p>
                                    </div>
                                    <p className="text-xs text-zinc-500">
                                      {workout.duration} • {workout.exercises.length} exercises
                                    </p>
                                  </>
                                ) : (
                                  <div className="flex items-center gap-2">
                                    {isToday && (
                                      <span className="text-[10px] font-bold uppercase tracking-wider text-white bg-white/20 px-2 py-0.5 rounded">
                                        Today
                                      </span>
                                    )}
                                    <p className="font-medium text-zinc-500">
                                      Rest Day
                                    </p>
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              {!workout && (
                                <span className="text-xs text-zinc-600 bg-zinc-800/50 px-2 py-1 rounded">
                                  Rest
                                </span>
                              )}
                              {hasCompleted && workout && (
                                <div className="flex items-center gap-2 text-emerald-500">
                                  <Check className="h-5 w-5" />
                                  <span className="text-xs font-medium">
                                    Done
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </motion.div>
                  );
                })}
              </div>
            </div>

            {/* Progress - Week Streak & Heatmap */}
            <div>
              <h2 className="text-base sm:text-lg font-heading font-medium text-white mb-3 sm:mb-4">
                Your Progress
              </h2>

              <Card className="glass-card overflow-hidden">
                <CardContent className="p-4 sm:p-5">
                  {/* Week Streak Counter */}
                  <div className="flex items-center gap-4 mb-5 pb-4 border-b border-white/5">
                    <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-orange-500/20 to-red-500/20 flex items-center justify-center">
                      <Flame className="h-6 w-6 text-orange-400" />
                    </div>
                    <div>
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-3xl font-bold text-white">
                          {calculateWeekStreak(sessions, plan)}
                        </span>
                        <span className="text-sm text-zinc-500">week streak</span>
                      </div>
                      <p className="text-xs text-zinc-600 mt-0.5">
                        Consecutive weeks hitting your goal
                      </p>
                    </div>
                  </div>

                  {/* Calendar Heatmap */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                        Last 8 Weeks
                      </p>
                      {/* 3-state legend */}
                      <div className="flex items-center gap-3 text-[10px] text-zinc-500">
                        <div className="flex items-center gap-1">
                          <div className="w-2.5 h-2.5 rounded-sm bg-zinc-800/60"></div>
                          <span>Rest</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <div className="w-2.5 h-2.5 rounded-sm border border-zinc-600 bg-transparent"></div>
                          <span>Missed</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <div className="w-2.5 h-2.5 rounded-sm bg-emerald-400"></div>
                          <span>Done</span>
                        </div>
                      </div>
                    </div>

                    {/* Heatmap Grid - GitHub style: rows = days of week, columns = weeks */}
                    <div className="flex gap-1.5">
                      {/* Day labels column */}
                      <div className="flex flex-col justify-between py-[2px]">
                        {["S", "M", "T", "W", "T", "F", "S"].map((day, i) => (
                          <div
                            key={i}
                            className="text-[9px] text-zinc-500 leading-none flex items-center"
                          >
                            {day}
                          </div>
                        ))}
                      </div>

                      {/* Weeks grid */}
                      <div className="flex-1 grid grid-cols-8 gap-1.5">
                        {(() => {
                          const weeks = generateHeatmapData(sessions, plan, 8, workoutPlan?.createdAt);

                          // Find if any week has a plan start divider
                          let hasShownPlanStart = false;

                          return weeks.map((week, weekIndex) => {
                            // Check if this week contains the plan start day
                            const planStartDayInWeek = week.find(d => d.isFirstDayOfPlan);
                            const showDividerAfterWeek = planStartDayInWeek && !hasShownPlanStart && weekIndex > 0;
                            if (planStartDayInWeek) hasShownPlanStart = true;

                            return (
                              <div key={weekIndex} className="flex flex-col gap-1.5 relative">
                                {/* Plan Start Divider - shown before the week that contains plan start */}
                                {showDividerAfterWeek && (
                                  <div className="absolute -left-1 top-0 bottom-0 flex items-center pointer-events-none z-10">
                                    <div className="w-0.5 h-full bg-gradient-to-b from-transparent via-emerald-500/60 to-transparent" />
                                  </div>
                                )}
                                {week.map((day, dayIndex) => {
                                  // Determine styling based on state
                                  let stateClasses = "";
                                  let stateTitle = "";

                                  if (day.state === "pre_plan") {
                                    // Before current plan - muted/neutral
                                    stateClasses = "bg-zinc-900/20";
                                    stateTitle = "Before current plan";
                                  } else if (day.state === "future") {
                                    stateClasses = "bg-zinc-900/30";
                                    stateTitle = "Upcoming";
                                  } else if (day.state === "rest") {
                                    stateClasses = "bg-zinc-800/40";
                                    stateTitle = "Rest day";
                                  } else if (day.state === "completed") {
                                    stateClasses = "bg-emerald-400";
                                    stateTitle = "Workout completed";
                                  } else {
                                    // scheduled but not completed
                                    stateClasses = "border border-zinc-600 bg-transparent";
                                    stateTitle = "Missed workout";
                                  }

                                  const isClickable = day.state === "completed" && day.session;

                                  return (
                                    <motion.div
                                      key={`${weekIndex}-${dayIndex}`}
                                      initial={{ opacity: 0, scale: 0.5 }}
                                      animate={{ opacity: 1, scale: 1 }}
                                      transition={{ delay: (weekIndex * 7 + dayIndex) * 0.003 }}
                                      className={`w-full aspect-square rounded-sm transition-colors ${stateClasses} ${
                                        day.isToday ? "ring-1 ring-white/60" : ""
                                      } ${day.isFirstDayOfPlan ? "ring-1 ring-emerald-500/50" : ""} ${isClickable ? "cursor-pointer hover:ring-2 hover:ring-emerald-400/50" : ""}`}
                                      title={`${format(day.date, "EEE, MMM d")} - ${stateTitle}${day.isFirstDayOfPlan ? " (Plan Started)" : ""}`}
                                      onClick={
                                        isClickable
                                          ? () => {
                                              setSelectedHeatmapDay(day);
                                              setIsWorkoutDetailOpen(true);
                                            }
                                          : undefined
                                      }
                                      whileHover={isClickable ? { scale: 1.2 } : undefined}
                                      whileTap={isClickable ? { scale: 0.95 } : undefined}
                                    />
                                  );
                                })}
                              </div>
                            );
                          });
                        })()}
                      </div>
                    </div>

                    {/* Week Labels */}
                    <div className="flex mt-2">
                      <div className="w-4"></div>
                      <div className="flex-1 flex justify-between px-0.5">
                        <span className="text-[9px] text-zinc-600">8w ago</span>
                        <span className="text-[9px] text-zinc-600">This week</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

            </div>
          </div>
        </div>
      </div>

      {/* Mobile Bottom Sheet for Full Plan */}
      <MobilePlanSheet
        isOpen={isPlanSheetOpen}
        onClose={() => setIsPlanSheetOpen(false)}
        plan={plan}
        expandedDay={expandedDay}
        setExpandedDay={setExpandedDay}
        allPlans={allPlans}
        workoutPlan={workoutPlan}
        onEdit={() => {
          setIsPlanSheetOpen(false);
          setLocation("/setup-plan?mode=edit");
        }}
        onSwitch={handleSwitchPlan}
        onCreateNew={() => {
          setIsPlanSheetOpen(false);
          setLocation("/setup-plan?mode=new");
        }}
      />

      {/* Workout Detail Sheet (for heatmap day clicks) */}
      <WorkoutDetailSheet
        isOpen={isWorkoutDetailOpen}
        onClose={() => {
          setIsWorkoutDetailOpen(false);
          setSelectedHeatmapDay(null);
        }}
        selectedDate={selectedHeatmapDay?.date || null}
        session={selectedHeatmapDay?.session || null}
        onExerciseClick={(exerciseName) => {
          // TODO: Navigate to exercise progress page
          console.log("Navigate to exercise:", exerciseName);
        }}
      />

      {/* Feedback Sheet */}
      <FeedbackSheet open={feedbackOpen} onOpenChange={setFeedbackOpen} />
    </div>
  );
}
