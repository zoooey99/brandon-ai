import { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import { format, addDays, isSameDay } from "date-fns";
import { Check, Activity, Loader2, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  workoutSessionApi,
  WorkoutSessionData,
  WorkoutSlotHistory,
  WeekSessionsResponse,
} from "@/lib/api";

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

interface WorkoutPlanData {
  id?: number;
  planData: {
    workouts: WorkoutDay[];
  };
}

interface DaySlot {
  date: Date;
  dayName: string;
  workout: WorkoutDay | null;
  isToday: boolean;
  isSelected: boolean;
  session: WorkoutSessionData | null;
  isCompleted: boolean;
  isRestDay: boolean;
}

// Get date as YYYY-MM-DD string in local timezone (avoids timezone comparison issues)
function getLocalDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Get date string from a date that might be a string (ISO) or Date object
function getDateStringFromValue(value: Date | string): string {
  if (typeof value === 'string') {
    // ISO string like "2025-01-28T00:00:00.000Z" - extract YYYY-MM-DD
    return value.substring(0, 10);
  }
  return getLocalDateString(value);
}

function parseDayToNumber(dayStr: string): number | null {
  const normalized = dayStr.toLowerCase().trim();
  const dayMappings: Record<string, number> = {
    su: 0, sun: 0, sunday: 0,
    m: 1, mon: 1, monday: 1,
    t: 2, tu: 2, tue: 2, tues: 2, tuesday: 2,
    w: 3, wed: 3, wednesday: 3,
    th: 4, thu: 4, thur: 4, thurs: 4, thursday: 4,
    f: 5, fri: 5, friday: 5,
    s: 6, sa: 6, sat: 6, saturday: 6,
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

interface WeekPickerDashboardProps {
  workoutPlan: WorkoutPlanData | null;
  sessions: WorkoutSessionData[];
  onTrackWorkout: (workout: WorkoutDay, scheduledFor: Date, dayIndex: number) => Promise<void>;
  onViewPlan: () => void;
  onViewWorkoutDetails: (session: WorkoutSessionData, date: Date) => void;
}

export function WeekPickerDashboard({
  workoutPlan,
  sessions,
  onTrackWorkout,
  onViewPlan,
  onViewWorkoutDetails,
}: WeekPickerDashboardProps) {
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [historyData, setHistoryData] = useState<Record<string, boolean[]>>({});
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isStartingWorkout, setIsStartingWorkout] = useState(false);

  const plan = workoutPlan?.planData?.workouts || [];

  // Generate next 7 days starting from today (rolling window)
  const weekDays = useMemo((): DaySlot[] => {
    const today = new Date();
    const days: DaySlot[] = [];

    // Show today + next 6 days = 7 days total
    for (let i = 0; i < 7; i++) {
      const date = addDays(today, i);
      const dayOfWeek = date.getDay();
      const isToday = i === 0;

      // Find workout for this day
      const workout = plan.find((w) => {
        const workoutDayNum = parseDayToNumber(w.day);
        return workoutDayNum === dayOfWeek;
      });

      // Find session for this day
      // If scheduledFor exists, use ONLY that (for "do Saturday's workout on Wednesday" scenarios)
      // Only fall back to workoutDate when scheduledFor is null (legacy sessions)
      const dateStr = getLocalDateString(date);
      const session = sessions.find((s) => {
        if (s.scheduledFor) {
          // Session has scheduledFor - only match by that field
          const scheduledDateStr = getDateStringFromValue(s.scheduledFor);
          return scheduledDateStr === dateStr;
        }
        // No scheduledFor - fall back to workoutDate (legacy sessions)
        const workoutDateStr = getDateStringFromValue(s.workoutDate);
        return workoutDateStr === dateStr;
      });

      const isCompleted = session?.status === 'completed';

      // Prefer session exercises (materialized/agent-modified) over plan template
      let effectiveWorkout: WorkoutDay | null = workout || null;
      if (session?.exercises && Array.isArray(session.exercises) && session.exercises.length > 0) {
        effectiveWorkout = {
          day: session.dayName,
          focus: session.focus,
          duration: workout?.duration || '',
          exercises: session.exercises,
        };
      }

      days.push({
        date,
        dayName: format(date, 'EEEE'),
        workout: effectiveWorkout,
        isToday,
        isSelected: isSameDay(date, selectedDate),
        session: session || null,
        isCompleted,
        isRestDay: !effectiveWorkout && !session,
      });
    }

    return days;
  }, [plan, sessions, selectedDate]);

  // Load history for all workout days
  useEffect(() => {
    const loadHistory = async () => {
      if (plan.length === 0) return;

      setIsLoadingHistory(true);
      try {
        const historyPromises = plan.map(async (w) => {
          try {
            const response = await workoutSessionApi.getSlotHistory(w.day, 5);
            return { dayName: w.day, history: response.history.map(h => h.completed) };
          } catch (e) {
            return { dayName: w.day, history: [] };
          }
        });

        const results = await Promise.all(historyPromises);
        const historyMap: Record<string, boolean[]> = {};
        results.forEach(({ dayName, history }) => {
          historyMap[dayName] = history;
        });
        setHistoryData(historyMap);
      } catch (error) {
        console.error("Error loading history:", error);
      } finally {
        setIsLoadingHistory(false);
      }
    };

    loadHistory();
  }, [plan]);

  // Get selected day info
  const selectedDay = weekDays.find(d => d.isSelected) || weekDays.find(d => d.isToday) || weekDays[0];

  // Handle starting a workout
  const handleStartWorkout = async () => {
    if (!selectedDay.workout || !workoutPlan?.id) return;

    setIsStartingWorkout(true);
    try {
      const dayIndex = workoutPlan.planData.workouts.findIndex(
        (w) => w.day === selectedDay.workout!.day && w.focus === selectedDay.workout!.focus
      );
      await onTrackWorkout(selectedDay.workout, selectedDay.date, dayIndex);
    } finally {
      setIsStartingWorkout(false);
    }
  };

  // Get history dots for selected workout
  const selectedHistory = selectedDay.workout
    ? (historyData[selectedDay.workout.day] || [])
    : [];

  return (
    <div className="space-y-4 lg:hidden">
      {/* Week Picker Strip */}
      <div className="flex justify-between px-1">
        {weekDays.map((day, index) => {
          const isWorkoutDay = !!day.workout;

          return (
            <button
              key={index}
              onClick={() => setSelectedDate(day.date)}
              className={`
                flex flex-col items-center py-2 px-2.5 rounded-xl transition-all min-w-[44px]
                ${day.isSelected
                  ? 'bg-white/10 ring-2 ring-white/30'
                  : 'hover:bg-white/5'
                }
              `}
            >
              {/* Day abbrev */}
              <span className={`text-[10px] font-bold uppercase tracking-wider mb-1 ${
                day.isSelected ? 'text-white' : day.isToday ? 'text-emerald-400' : 'text-zinc-500'
              }`}>
                {format(day.date, 'EEE')}
              </span>

              {/* Date number */}
              <span className={`text-lg font-bold mb-1 ${
                day.isSelected ? 'text-white' : day.isToday ? 'text-white' : isWorkoutDay ? 'text-zinc-300' : 'text-zinc-600'
              }`}>
                {format(day.date, 'd')}
              </span>

              {/* Status indicator */}
              <div className="h-4 flex items-center justify-center">
                {day.isCompleted ? (
                  <div className="w-4 h-4 rounded-full bg-emerald-500 flex items-center justify-center">
                    <Check className="w-2.5 h-2.5 text-black" strokeWidth={3} />
                  </div>
                ) : isWorkoutDay ? (
                  <div className={`w-1.5 h-1.5 rounded-full ${day.isToday ? 'bg-emerald-400' : 'bg-zinc-500'}`} />
                ) : (
                  <div className="w-1.5 h-1.5 rounded-full bg-zinc-700" />
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Workout Card */}
      <Card className="glass-elevated overflow-hidden">
        <CardContent className="p-5">
          {selectedDay.isRestDay ? (
            /* Rest Day Card */
            <div className="text-center py-4">
              <div className="w-14 h-14 rounded-full bg-zinc-800/50 flex items-center justify-center mx-auto mb-3">
                <span className="text-2xl">😴</span>
              </div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-1">
                {selectedDay.isToday ? 'Today' : format(selectedDay.date, 'EEEE')}
              </p>
              <p className="text-xl font-heading font-bold text-white">
                Rest Day
              </p>
              <p className="text-sm text-zinc-500 mt-1">
                Recovery is part of the process
              </p>
            </div>
          ) : (
            /* Workout Day Card */
            <div>
              {/* Header */}
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[10px] font-bold uppercase tracking-wider ${
                      selectedDay.isToday ? 'text-emerald-400' : 'text-zinc-500'
                    }`}>
                      {selectedDay.isToday ? "Today's Workout" : format(selectedDay.date, 'EEEE')}
                    </span>
                    {selectedDay.isCompleted && (
                      <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded">
                        Done
                      </span>
                    )}
                  </div>
                  <h3 className="text-2xl font-heading font-bold text-white">
                    {selectedDay.workout?.focus}
                  </h3>
                  <p className="text-sm text-zinc-500">
                    {selectedDay.workout?.duration} • {selectedDay.workout?.exercises.length} exercises
                  </p>
                </div>

                {selectedDay.isCompleted && (
                  <div className="w-10 h-10 rounded-full bg-emerald-500 flex items-center justify-center shrink-0">
                    <Check className="w-5 h-5 text-black" strokeWidth={2.5} />
                  </div>
                )}
              </div>

              {/* Exercise Pills */}
              <div className="flex flex-wrap gap-2 mb-4">
                {selectedDay.workout?.exercises.slice(0, 4).map((ex, i) => (
                  <span
                    key={i}
                    className="text-xs text-zinc-300 bg-white/[0.06] px-3 py-1.5 rounded-full"
                  >
                    {ex.name}
                  </span>
                ))}
                {(selectedDay.workout?.exercises.length || 0) > 4 && (
                  <span className="text-xs text-zinc-500 bg-white/[0.04] px-3 py-1.5 rounded-full">
                    +{(selectedDay.workout?.exercises.length || 0) - 4} more
                  </span>
                )}
              </div>

              {/* Action Button */}
              {!selectedDay.isCompleted ? (
                <Button
                  onClick={handleStartWorkout}
                  disabled={isStartingWorkout}
                  className="w-full bg-white hover:bg-zinc-200 text-black font-semibold py-3 rounded-xl"
                >
                  {isStartingWorkout ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Activity className="h-4 w-4 mr-2" />
                  )}
                  {selectedDay.isToday ? 'Start Workout' : `Start ${format(selectedDay.date, 'EEEE')}'s Workout`}
                </Button>
              ) : (
                <Button
                  onClick={() => {
                    if (selectedDay.session) {
                      onViewWorkoutDetails(selectedDay.session, selectedDay.date);
                    }
                  }}
                  variant="ghost"
                  className="w-full bg-emerald-500/[0.08] border border-emerald-500/20 text-zinc-300 hover:text-white hover:bg-emerald-500/[0.12] hover:border-emerald-500/30 py-3 rounded-xl transition-all duration-200"
                >
                  View Completed Workout
                  <ChevronRight className="h-4 w-4 ml-1 text-emerald-500/60" />
                </Button>
              )}

              {/* History Dots */}
              {selectedHistory.length > 0 && (
                <div className="mt-4 pt-4 border-t border-white/5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                      Last {selectedHistory.length} {selectedDay.workout?.day}s
                    </span>
                    <div className="flex gap-1.5">
                      {selectedHistory.map((completed, i) => (
                        <div
                          key={i}
                          className={`w-2.5 h-2.5 rounded-full ${
                            completed ? 'bg-emerald-500' : 'bg-zinc-700'
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
