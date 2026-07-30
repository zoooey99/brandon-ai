"use client";

import { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence, useDragControls } from "framer-motion";
import { format, parseISO } from "date-fns";
import { ChevronRight, ChevronLeft, Star, TrendingUp, TrendingDown, Minus, X } from "lucide-react";
import { workoutSessionApi, WorkoutSessionData, WorkoutSetData } from "@/lib/api";

interface ExerciseSummary {
  name: string;
  maxWeight: number;
  totalSets: number;
  totalReps: number;
  avgReps: number;
  isPR: boolean;
  previousMax: number | null;
  trend: number; // percentage change from 4 weeks ago
  sparklineData: number[]; // normalized 0-100 values for last 6 sessions
}

interface ExerciseSession {
  date: Date;
  maxWeight: number;
  sets: number;
  reps: number;
  isPR: boolean;
}

interface WorkoutDetailSheetProps {
  isOpen: boolean;
  onClose: () => void;
  selectedDate: Date | null;
  session: WorkoutSessionData | null;
  onExerciseClick?: (exerciseName: string) => void;
}

// Helper to group sets by exercise and calculate summaries
function calculateExerciseSummaries(
  sets: WorkoutSetData[],
  allSetsHistory: WorkoutSetData[]
): ExerciseSummary[] {
  // Group current session sets by exercise
  const exerciseGroups = new Map<string, WorkoutSetData[]>();

  sets.forEach((set) => {
    const existing = exerciseGroups.get(set.exerciseName) || [];
    existing.push(set);
    exerciseGroups.set(set.exerciseName, existing);
  });

  // Calculate summaries
  const summaries: ExerciseSummary[] = [];

  exerciseGroups.forEach((exerciseSets, exerciseName) => {
    const weights = exerciseSets
      .map((s) => s.weight)
      .filter((w): w is number => w !== null && w !== undefined);

    const maxWeight = weights.length > 0 ? Math.max(...weights) : 0;
    const totalSets = exerciseSets.length;
    const totalReps = exerciseSets.reduce((sum, s) => sum + (s.reps || 0), 0);
    const avgReps = totalSets > 0 ? Math.round(totalReps / totalSets) : 0;

    // Get historical data for this exercise
    const historyForExercise = allSetsHistory.filter(
      (s) => s.exerciseName === exerciseName && s.weight !== null
    );

    // Find previous max (before this session)
    const previousMaxWeight = historyForExercise.length > 0
      ? Math.max(...historyForExercise.map((s) => s.weight!))
      : null;

    const isPR = previousMaxWeight !== null ? maxWeight > previousMaxWeight : false;

    // Calculate trend (comparing to ~4 weeks ago)
    let trend = 0;
    if (historyForExercise.length >= 2) {
      const oldestWeight = historyForExercise[historyForExercise.length - 1]?.weight || 0;
      if (oldestWeight > 0) {
        trend = Math.round(((maxWeight - oldestWeight) / oldestWeight) * 100);
      }
    }

    // Generate sparkline data (last 6 data points normalized)
    const recentWeights = historyForExercise
      .slice(-6)
      .map((s) => s.weight!)
      .concat(maxWeight);

    const minW = Math.min(...recentWeights);
    const maxW = Math.max(...recentWeights);
    const range = maxW - minW || 1;

    const sparklineData = recentWeights
      .slice(-6)
      .map((w) => Math.round(((w - minW) / range) * 100));

    summaries.push({
      name: exerciseName,
      maxWeight,
      totalSets,
      totalReps,
      avgReps,
      isPR,
      previousMax: previousMaxWeight,
      trend,
      sparklineData,
    });
  });

  return summaries;
}

// Mini sparkline component
function Sparkline({ data, isPR }: { data: number[]; isPR?: boolean }) {
  if (data.length === 0) return null;

  return (
    <div className="flex items-end gap-[3px] h-6 w-12">
      {data.map((value, i) => {
        const isLast = i === data.length - 1;
        return (
          <div
            key={i}
            className={`flex-1 rounded-sm transition-opacity ${
              isLast && isPR ? "bg-amber-400" : "bg-emerald-500"
            }`}
            style={{
              height: `${Math.max(value, 15)}%`,
              opacity: isLast ? 1 : 0.4,
            }}
          />
        );
      })}
    </div>
  );
}

// Trend indicator component
function TrendIndicator({ trend }: { trend: number }) {
  if (trend > 0) {
    return (
      <span className="flex items-center gap-0.5 text-xs font-semibold text-emerald-400 min-w-[42px] justify-end">
        <TrendingUp className="h-3.5 w-3.5" />
        +{trend}%
      </span>
    );
  } else if (trend < 0) {
    return (
      <span className="flex items-center gap-0.5 text-xs font-semibold text-red-400 min-w-[42px] justify-end">
        <TrendingDown className="h-3.5 w-3.5" />
        {trend}%
      </span>
    );
  }
  return (
    <span className="flex items-center gap-0.5 text-xs font-semibold text-zinc-500 min-w-[42px] justify-end">
      <Minus className="h-3.5 w-3.5" />
      0%
    </span>
  );
}

// PR Badge component
function PRBadge({ small = false }: { small?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 bg-gradient-to-r from-amber-400 to-amber-500 text-black font-bold uppercase tracking-wide rounded ${
        small ? "text-[9px] px-1.5 py-0.5" : "text-[9px] px-1.5 py-0.5"
      }`}
    >
      <Star className={small ? "h-2.5 w-2.5" : "h-2.5 w-2.5"} fill="currentColor" />
      PR
    </span>
  );
}

// Progress Graph component for exercise detail view
function ProgressGraph({ sessions, currentPR }: { sessions: ExerciseSession[]; currentPR: number }) {
  if (sessions.length === 0) return null;

  const weights = sessions.map((s) => s.maxWeight);
  const minWeight = Math.min(...weights) * 0.9;
  const maxWeight = Math.max(...weights) * 1.05;
  const range = maxWeight - minWeight || 1;

  const width = 260;
  const height = 120;
  const padding = { top: 10, bottom: 20, left: 0, right: 0 };

  const graphWidth = width - padding.left - padding.right;
  const graphHeight = height - padding.top - padding.bottom;

  const points = sessions.map((session, i) => {
    const x = padding.left + (i / Math.max(sessions.length - 1, 1)) * graphWidth;
    const y = padding.top + graphHeight - ((session.maxWeight - minWeight) / range) * graphHeight;
    return { x, y, session };
  });

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  const areaPath = `${linePath} L${points[points.length - 1].x},${height - padding.bottom} L${points[0].x},${height - padding.bottom} Z`;

  const dateLabels = useMemo(() => {
    if (sessions.length === 0) return [];
    if (sessions.length === 1) {
      return [{ label: format(sessions[0].date, "MMM d"), x: width / 2 }];
    }
    return [
      { label: format(sessions[0].date, "MMM d"), x: padding.left },
      { label: format(sessions[Math.floor(sessions.length / 2)].date, "MMM d"), x: width / 2 },
      { label: format(sessions[sessions.length - 1].date, "MMM d"), x: width - padding.right },
    ];
  }, [sessions]);

  return (
    <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-5">
      <div className="flex justify-between items-center mb-4">
        <span className="text-sm font-semibold text-white">Weight Over Time</span>
        <span className="text-xs text-zinc-500 bg-white/5 px-2.5 py-1 rounded-md">
          Last {sessions.length} sessions
        </span>
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-[140px]" preserveAspectRatio="none">
        <defs>
          <linearGradient id="areaGradientSheet" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
          </linearGradient>
        </defs>

        {[0.25, 0.5, 0.75].map((ratio) => (
          <line
            key={ratio}
            x1={0}
            y1={padding.top + graphHeight * (1 - ratio)}
            x2={width}
            y2={padding.top + graphHeight * (1 - ratio)}
            stroke="rgba(255,255,255,0.05)"
            strokeWidth="1"
          />
        ))}

        <path d={areaPath} fill="url(#areaGradientSheet)" />
        <path
          d={linePath}
          fill="none"
          stroke="#10b981"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {points.map((point, i) => (
          <circle
            key={i}
            cx={point.x}
            cy={point.y}
            r={point.session.isPR ? 6 : 4}
            fill={point.session.isPR ? "#fbbf24" : "#10b981"}
            stroke="#121212"
            strokeWidth="2"
          />
        ))}
      </svg>

      <div className="flex justify-between mt-2 text-[11px] text-zinc-500">
        {dateLabels.map((label, i) => (
          <span key={i}>{label.label}</span>
        ))}
      </div>
    </div>
  );
}

export function WorkoutDetailSheet({
  isOpen,
  onClose,
  selectedDate,
  session,
}: WorkoutDetailSheetProps) {
  const [sets, setSets] = useState<WorkoutSetData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [exerciseSummaries, setExerciseSummaries] = useState<ExerciseSummary[]>([]);

  // View state: 'list' for exercise list, 'exercise' for exercise detail
  const [view, setView] = useState<'list' | 'exercise'>('list');
  const [selectedExercise, setSelectedExercise] = useState<string | null>(null);

  // Exercise detail data
  const [exerciseHistory, setExerciseHistory] = useState<ExerciseSession[]>([]);
  const [isLoadingExercise, setIsLoadingExercise] = useState(false);
  const [exercisePR, setExercisePR] = useState(0);

  const dragControls = useDragControls();

  // Count PRs for header
  const prCount = exerciseSummaries.filter((e) => e.isPR).length;

  // Recent sessions for exercise detail (newest first)
  const recentExerciseSessions = useMemo(() => [...exerciseHistory].reverse().slice(0, 6), [exerciseHistory]);

  // Lock body scroll when sheet is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "";
      };
    }
  }, [isOpen]);

  // Reset view when modal closes
  useEffect(() => {
    if (!isOpen) {
      setView('list');
      setSelectedExercise(null);
      setExerciseHistory([]);
    }
  }, [isOpen]);

  // Fetch session data when session changes
  useEffect(() => {
    if (session?.id) {
      setIsLoading(true);
      workoutSessionApi
        .getById(session.id)
        .then(({ sets: sessionSets }) => {
          setSets(sessionSets);
          // TODO: Fetch historical sets for PR detection
          // For now, just calculate with current data
          setExerciseSummaries(calculateExerciseSummaries(sessionSets, []));
        })
        .catch(console.error)
        .finally(() => setIsLoading(false));
    } else {
      setSets([]);
      setExerciseSummaries([]);
    }
  }, [session?.id]);

  // Fetch exercise history when an exercise is selected
  useEffect(() => {
    if (!selectedExercise || view !== 'exercise') return;

    setIsLoadingExercise(true);

    workoutSessionApi
      .getAll(50, 0)
      .then(async (allSessions) => {
        const sessionsWithSets: ExerciseSession[] = [];
        let runningMax = 0;

        for (const sess of allSessions) {
          try {
            const { sets: sessionSets } = await workoutSessionApi.getById(sess.id!);
            const exerciseSets = sessionSets.filter(
              (s) => s.exerciseName.toLowerCase() === selectedExercise.toLowerCase()
            );

            if (exerciseSets.length > 0) {
              const weights = exerciseSets
                .map((s) => s.weight)
                .filter((w): w is number => w !== null && w !== undefined);

              if (weights.length > 0) {
                const maxWeight = Math.max(...weights);
                const sessionDate =
                  typeof sess.workoutDate === "string"
                    ? parseISO(sess.workoutDate)
                    : sess.workoutDate;

                const isPR = maxWeight > runningMax;
                if (isPR) runningMax = maxWeight;

                sessionsWithSets.push({
                  date: sessionDate,
                  maxWeight,
                  sets: exerciseSets.length,
                  reps: exerciseSets[0]?.reps || 0,
                  isPR,
                });
              }
            }
          } catch (e) {
            console.error("Failed to fetch session sets:", e);
          }
        }

        // Sort by date ascending for the graph
        sessionsWithSets.sort((a, b) => a.date.getTime() - b.date.getTime());

        // Recalculate PRs chronologically
        let max = 0;
        sessionsWithSets.forEach((sess) => {
          if (sess.maxWeight > max) {
            sess.isPR = true;
            max = sess.maxWeight;
          } else {
            sess.isPR = false;
          }
        });

        setExerciseHistory(sessionsWithSets);
        setExercisePR(max);
      })
      .catch(console.error)
      .finally(() => setIsLoadingExercise(false));
  }, [selectedExercise, view]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            key="workout-detail-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-[2px] z-50 lg:backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Sheet - Mobile: Bottom sheet | Desktop: Centered modal */}
          <motion.div
            key="workout-detail-sheet"
            initial={{ y: "100%", opacity: 1 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: "100%", opacity: 1 }}
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
            className="fixed bottom-0 left-0 right-0 z-50 bg-[#121212] rounded-t-[28px] border-t border-white/10 max-h-[85vh] overflow-hidden flex flex-col lg:bottom-auto lg:left-1/2 lg:top-1/2 lg:-translate-x-1/2 lg:-translate-y-1/2 lg:w-[90%] lg:max-w-[520px] lg:h-[70vh] lg:max-h-[600px] lg:rounded-3xl lg:border lg:shadow-2xl lg:shadow-black/50"
            style={{ boxShadow: "0 -20px 60px rgba(0,0,0,0.5)" }}
          >
            {/* Handle - Mobile only */}
            <div
              className="flex justify-center pt-3 pb-2 cursor-grab active:cursor-grabbing lg:hidden"
              onPointerDown={(e) => dragControls.start(e)}
            >
              <div className="w-9 h-1 bg-white/20 rounded-full" />
            </div>

            {/* Content container with view switching */}
            <div className="flex-1 overflow-hidden relative">
              <AnimatePresence mode="wait" initial={false}>
                {view === 'list' ? (
                  <motion.div
                    key="list-view"
                    initial={{ x: -20, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    exit={{ x: -20, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="h-full flex flex-col"
                  >
                    {/* List Header */}
                    <div className="px-5 pb-4 lg:pt-5">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                            {selectedDate ? format(selectedDate, "EEEE, MMM d") : ""}
                          </p>
                          <h3 className="text-[22px] font-extrabold text-white mt-1 tracking-tight">
                            {session?.focus || "Workout"}
                          </h3>
                          <div className="flex items-center gap-2 mt-1.5">
                            <span className="text-[13px] text-zinc-400">
                              {exerciseSummaries.length} exercises
                            </span>
                            {prCount > 0 && (
                              <>
                                <span className="w-[3px] h-[3px] rounded-full bg-zinc-600" />
                                <span className="flex items-center gap-1 text-[13px] font-semibold text-amber-400">
                                  <Star className="h-3 w-3" fill="currentColor" />
                                  {prCount} {prCount === 1 ? "PR" : "PRs"}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={onClose}
                          className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center text-zinc-500 hover:text-white hover:bg-white/10 transition-colors"
                        >
                          <X className="h-[18px] w-[18px]" />
                        </button>
                      </div>
                    </div>

                    {/* Exercise List */}
                    <div className="flex-1 overflow-y-auto px-4 pb-8">
                      {isLoading ? (
                        <div className="flex items-center justify-center py-12">
                          <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                        </div>
                      ) : exerciseSummaries.length > 0 ? (
                        <div className="space-y-2">
                          {exerciseSummaries.map((exercise, index) => (
                            <motion.button
                              key={exercise.name}
                              initial={{ opacity: 0, y: 12 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ delay: index * 0.05, duration: 0.3 }}
                              onClick={() => {
                                setSelectedExercise(exercise.name);
                                setView('exercise');
                              }}
                              className={`w-full flex items-center gap-3 p-4 rounded-2xl transition-all active:scale-[0.99] ${
                                exercise.isPR
                                  ? "bg-gradient-to-r from-amber-500/15 to-transparent border border-amber-500/20 relative overflow-hidden"
                                  : "bg-white/[0.04] hover:bg-white/[0.07]"
                              }`}
                            >
                              {exercise.isPR && (
                                <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-amber-400 to-transparent opacity-50" />
                              )}

                              <div className="flex-1 min-w-0 text-left">
                                <div className="flex items-center gap-2">
                                  <p className="text-[15px] font-semibold text-white truncate">
                                    {exercise.name}
                                  </p>
                                  {exercise.isPR && <PRBadge />}
                                </div>
                                <div className="flex items-center gap-1.5 mt-1">
                                  <span className="text-[13px] font-semibold text-white">
                                    {exercise.maxWeight} lbs
                                  </span>
                                  <span className="w-[3px] h-[3px] rounded-full bg-zinc-600" />
                                  <span className="text-[13px] text-zinc-400">
                                    {exercise.totalSets} × {exercise.avgReps} reps
                                  </span>
                                </div>
                              </div>

                              <div className="flex items-center gap-2.5">
                                <Sparkline data={exercise.sparklineData} isPR={exercise.isPR} />
                                <TrendIndicator trend={exercise.trend} />
                                <ChevronRight className="h-4 w-4 text-zinc-600" />
                              </div>
                            </motion.button>
                          ))}
                        </div>
                      ) : (
                        <div className="text-center py-12 text-zinc-500">
                          No exercise data recorded
                        </div>
                      )}
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key="exercise-view"
                    initial={{ x: 20, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    exit={{ x: 20, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="h-full flex flex-col"
                  >
                    {/* Exercise Detail Header */}
                    <div className="px-5 pb-4 lg:pt-5">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <button
                            onClick={() => {
                              setView('list');
                              setSelectedExercise(null);
                            }}
                            className="flex items-center gap-1 text-zinc-400 hover:text-white transition-colors mb-2"
                          >
                            <ChevronLeft className="h-4 w-4" />
                            <span className="text-[11px] font-semibold uppercase tracking-wider">
                              Back
                            </span>
                          </button>
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                            Exercise Progress
                          </p>
                          <h3 className="text-[22px] font-extrabold text-white mt-1 tracking-tight">
                            {selectedExercise}
                          </h3>
                        </div>
                        <button
                          onClick={onClose}
                          className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center text-zinc-500 hover:text-white hover:bg-white/10 transition-colors"
                        >
                          <X className="h-[18px] w-[18px]" />
                        </button>
                      </div>
                    </div>

                    {/* Exercise Detail Content */}
                    <div className="flex-1 overflow-y-auto px-4 pb-8">
                      {isLoadingExercise ? (
                        <div className="flex items-center justify-center py-12">
                          <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                        </div>
                      ) : exerciseHistory.length === 0 ? (
                        <div className="text-center py-12 text-zinc-500">
                          No data available for this exercise
                        </div>
                      ) : (
                        <>
                          {/* PR Hero Card */}
                          <div className="relative bg-gradient-to-br from-amber-500/15 to-transparent border border-amber-500/30 rounded-2xl p-5 text-center mb-5 overflow-hidden">
                            <div className="absolute inset-0 bg-radial-gradient from-amber-500/20 to-transparent opacity-50 pointer-events-none" />
                            <p className="flex items-center justify-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-amber-400 mb-2 relative z-10">
                              <Star className="h-3.5 w-3.5" fill="currentColor" />
                              Personal Record
                            </p>
                            <p className="text-4xl font-extrabold text-white relative z-10">
                              {exercisePR}
                              <span className="text-lg font-semibold text-zinc-400 ml-1">lbs</span>
                            </p>
                          </div>

                          {/* Progress Graph */}
                          {exerciseHistory.length >= 2 && (
                            <div className="mb-5">
                              <ProgressGraph sessions={exerciseHistory} currentPR={exercisePR} />
                            </div>
                          )}

                          {/* Recent Sessions */}
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3">
                              Recent Sessions
                            </p>
                            <div className="space-y-0">
                              {recentExerciseSessions.map((sess, i) => (
                                <div
                                  key={i}
                                  className="flex justify-between items-center py-3 border-b border-white/[0.06] last:border-b-0"
                                >
                                  <div>
                                    <p className="text-base font-semibold text-white">
                                      {sess.maxWeight} lbs
                                    </p>
                                    <p className="text-xs text-zinc-500">
                                      {sess.sets} × {sess.reps} reps
                                    </p>
                                  </div>
                                  <div className="flex items-center gap-2.5">
                                    {sess.isPR && <PRBadge small />}
                                    <span className="text-sm text-zinc-500">
                                      {format(sess.date, "MMM d")}
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
