import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useLocation } from "wouter";
import { motion, AnimatePresence, Reorder, useDragControls } from "framer-motion";
import { format, parseISO } from "date-fns";
import {
  Loader2,
  Check,
  ChevronDown,
  AlertCircle,
  CheckCircle2,
  Timer,
  Plus,
  Minus,
  SkipForward,
  Volume2,
  VolumeX,
  Pause,
  Play,
  Pencil,
  ChevronRight,
  WifiOff,
  RefreshCw,
  ArrowLeft,
  MoreVertical,
  RotateCcw,
  LayoutDashboard,
  GripVertical,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { PRCelebration } from "@/components/pr-celebration";
import {
  trackingApi,
  TrackingWorkoutData,
  WorkoutSetData,
} from "@/lib/api";
import { useOnlineStatus } from "@/hooks/use-online-status";
import {
  cacheWorkout,
  getCachedWorkout,
  updateLocalSet,
  queueSetUpdate,
  queueSetCreate,
  queueSessionUpdate,
  mergeLocalModifications,
  clearLocalSets,
} from "@/lib/offline-storage";
import { trackEvent, trackWorkoutSaveError, trackApiError } from "@/lib/posthog";

interface ExerciseWithSets {
  name: string;
  exerciseId?: string;
  planSets: number;
  planReps: string;
  details?: string[];
  exerciseIndex: number;
  sets: WorkoutSetData[];
}

interface RestTimer {
  exerciseIndex: number;
  setNumber: number;
  exerciseName: string;
  duration: number;
  remaining: number;
  isPaused: boolean;
  endTime: number;      // timestamp when timer should end
  pausedAt?: number;    // timestamp when paused (for pause/resume)
}

// Get placeholder value for a set field by cascading from earlier sets, previous workout, or plan
function getPlaceholder(
  exercises: ExerciseWithSets[],
  exerciseIndex: number,
  setNumber: number,
  field: "weight" | "reps",
  previousSetsMap: Record<string, WorkoutSetData>,
  targetRepsMap: Record<number, number | null>
): number | null {
  const exercise = exercises.find(ex => ex.exerciseIndex === exerciseIndex);
  if (!exercise) return null;

  // Priority 1: Cascade from most recent earlier set with a value
  for (let s = setNumber - 1; s >= 1; s--) {
    const earlier = exercise.sets.find(set => set.setNumber === s);
    if (earlier?.[field] != null) return earlier[field] as number;
  }

  // Priority 2: Previous workout's value for this set
  const prev = previousSetsMap[`${exerciseIndex}-${setNumber}`];
  if (prev?.[field] != null) return prev[field] as number;

  // Priority 3 (reps only): Plan's target reps
  if (field === "reps") return targetRepsMap[exerciseIndex] ?? null;

  return null;
}

// localStorage helpers for rest time preferences
const REST_PREFS_KEY = "workout-rest-preferences";
const MUTE_PREF_KEY = "workout-rest-muted";

function getRestPreferences(): Record<string, number> {
  try {
    const stored = localStorage.getItem(REST_PREFS_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

function setRestPreference(exerciseName: string, seconds: number): void {
  const prefs = getRestPreferences();
  prefs[exerciseName] = seconds;
  localStorage.setItem(REST_PREFS_KEY, JSON.stringify(prefs));
}

function getMutedPreference(): boolean {
  try {
    return localStorage.getItem(MUTE_PREF_KEY) === "true";
  } catch {
    return false;
  }
}

function setMutedPreference(muted: boolean): void {
  localStorage.setItem(MUTE_PREF_KEY, String(muted));
}

// localStorage helpers for timer persistence across app switches
const TIMER_STATE_KEY = "workout-rest-timer";

function saveTimerState(timer: RestTimer | null): void {
  try {
    if (timer) {
      localStorage.setItem(TIMER_STATE_KEY, JSON.stringify(timer));
    } else {
      localStorage.removeItem(TIMER_STATE_KEY);
    }
  } catch {
    // Ignore storage errors
  }
}

function getTimerState(): RestTimer | null {
  try {
    const stored = localStorage.getItem(TIMER_STATE_KEY);
    if (!stored) return null;
    const timer = JSON.parse(stored) as RestTimer;
    // Validate timer has required fields
    if (timer.endTime && timer.duration) {
      return timer;
    }
    return null;
  } catch {
    return null;
  }
}

function clearTimerState(): void {
  try {
    localStorage.removeItem(TIMER_STATE_KEY);
  } catch {
    // Ignore storage errors
  }
}

// Workout status type
type WorkoutStatus = 'preview' | 'active' | 'paused' | 'completed' | 'editing';

// Workout timer state for tracking total workout duration
interface WorkoutTimerState {
  startedAt: number;        // timestamp when workout started
  pausedAt?: number;        // timestamp when paused (if currently paused)
  totalPausedMs: number;    // accumulated pause time in milliseconds
}

// localStorage helpers for workout timer persistence
const WORKOUT_TIMER_KEY = "workout-timer-state";

function saveWorkoutTimerState(state: WorkoutTimerState | null, token: string): void {
  try {
    const key = `${WORKOUT_TIMER_KEY}-${token}`;
    if (state) {
      localStorage.setItem(key, JSON.stringify(state));
    } else {
      localStorage.removeItem(key);
    }
  } catch {
    // Ignore storage errors
  }
}

function getWorkoutTimerState(token: string): WorkoutTimerState | null {
  try {
    const key = `${WORKOUT_TIMER_KEY}-${token}`;
    const stored = localStorage.getItem(key);
    if (!stored) return null;
    const state = JSON.parse(stored) as WorkoutTimerState;
    if (state.startedAt) {
      return state;
    }
    return null;
  } catch {
    return null;
  }
}

function clearWorkoutTimerState(token: string): void {
  try {
    const key = `${WORKOUT_TIMER_KEY}-${token}`;
    localStorage.removeItem(key);
  } catch {
    // Ignore storage errors
  }
}

// Calculate elapsed seconds from workout timer state
function calculateElapsed(state: WorkoutTimerState): number {
  const now = state.pausedAt || Date.now();
  const elapsedMs = now - state.startedAt - state.totalPausedMs;
  return Math.max(0, Math.floor(elapsedMs / 1000));
}

// Format time as MM:SS or HH:MM:SS
function formatWorkoutTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

// Generate beep sound using Web Audio API
function playBeep(muted: boolean): void {
  if (muted) return;

  try {
    const audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();

    // Create a pleasant two-tone completion sound
    const playTone = (freq: number, startTime: number, duration: number) => {
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      oscillator.frequency.value = freq;
      oscillator.type = "sine";

      gainNode.gain.setValueAtTime(0.3, startTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + duration);

      oscillator.start(startTime);
      oscillator.stop(startTime + duration);
    };

    const now = audioContext.currentTime;
    playTone(880, now, 0.15);
    playTone(1100, now + 0.15, 0.15);
    playTone(1320, now + 0.3, 0.25);
  } catch {
    // Audio not supported
  }
}

// Vibrate if supported
function vibrate(): void {
  if (navigator.vibrate) {
    navigator.vibrate([200, 100, 200]);
  }
}

// Rest Timer Presets
const REST_PRESETS = [
  { label: "30s", value: 30 },
  { label: "60s", value: 60 },
  { label: "90s", value: 90 },
  { label: "2min", value: 120 },
];

// Shared draggable exercise item for both preview and active reorder modes
function DraggableExerciseItem({ exercise, className, children }: {
  exercise: ExerciseWithSets;
  className: string;
  children: React.ReactNode;
}) {
  const dragControls = useDragControls();

  return (
    <Reorder.Item
      value={exercise}
      dragListener={false}
      dragControls={dragControls}
      layout
      transition={{ layout: { duration: 0.2, ease: "easeOut" } }}
      className={className}
      whileDrag={{ scale: 1.03, boxShadow: "0 8px 32px rgba(16,185,129,0.2)", zIndex: 50 }}
    >
      <button
        className="flex items-center justify-center w-10 h-full py-3.5 text-zinc-600 hover:text-zinc-400 touch-none cursor-grab active:cursor-grabbing flex-shrink-0"
        onPointerDown={(e) => dragControls.start(e)}
      >
        <GripVertical className="w-4 h-4" />
      </button>
      {children}
    </Reorder.Item>
  );
}

// Floating Workout Control Island Component
function FloatingWorkoutControl({
  elapsed,
  isPaused,
  isActive,
  progress = 0,
  onStart,
  onTogglePause,
  onComplete,
  isCompleting = false,
  canComplete = false,
}: {
  elapsed: number;
  isPaused: boolean;
  isActive: boolean;
  progress?: number;
  onStart: () => void;
  onTogglePause: () => void;
  onComplete: () => void;
  isCompleting?: boolean;
  canComplete?: boolean;
}) {
  // Preview state - show Start button
  if (!isActive) {
    return (
      <div className="fixed left-0 right-0 z-50 flex justify-center px-4" style={{ bottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}>
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          className="relative"
        >
          {/* Breathing glow */}
          <motion.div
            animate={{
              opacity: [0.3, 0.5, 0.3],
              scale: [1, 1.1, 1],
            }}
            transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
            className="absolute inset-0 rounded-full bg-emerald-500/30 blur-xl"
          />

          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={onStart}
            className="relative flex items-center gap-3 px-8 py-4 rounded-full bg-emerald-500 text-black font-bold text-lg border border-emerald-400/50 backdrop-blur-xl"
            style={{
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3), 0 0 60px rgba(16, 185, 129, 0.25)',
            }}
          >
            <Play className="w-5 h-5" fill="currentColor" />
            Start Workout
          </motion.button>
        </motion.div>
      </div>
    );
  }

  // Active/Paused state - show full control bar
  return (
    <div className="fixed left-0 right-0 z-50 flex justify-center px-4" style={{ bottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}>
      <motion.div
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
        className="relative"
      >
        {/* Ambient glow - only when not paused */}
        <AnimatePresence>
          {!isPaused && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{
                opacity: [0.4, 0.6, 0.4],
                scale: [1, 1.05, 1],
              }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
              className="absolute inset-0 rounded-full bg-emerald-500/30 blur-xl"
            />
          )}
        </AnimatePresence>

        {/* Main pill container */}
        <div
          className={`relative flex items-center gap-1 p-1.5 rounded-full border backdrop-blur-xl transition-all duration-300 ${
            isPaused
              ? 'bg-zinc-900/70 border-zinc-700/50'
              : 'bg-zinc-900/60 border-emerald-500/20'
          }`}
          style={{
            boxShadow: isPaused
              ? '0 8px 32px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255,255,255,0.05)'
              : '0 8px 32px rgba(0, 0, 0, 0.4), 0 0 40px rgba(16, 185, 129, 0.15), inset 0 1px 0 rgba(255,255,255,0.05)',
          }}
        >
          {/* Timer Section */}
          <div
            className={`flex items-center gap-2 px-4 py-2.5 rounded-full transition-colors duration-300 ${
              isPaused ? 'bg-zinc-800/50' : 'bg-emerald-500/10'
            }`}
          >
            {/* Pulse dot */}
            <div className="relative">
              {!isPaused && (
                <motion.div
                  animate={{ scale: [1, 1.5, 1], opacity: [1, 0, 1] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                  className="absolute inset-0 w-2 h-2 rounded-full bg-emerald-500"
                />
              )}
              <div
                className={`w-2 h-2 rounded-full transition-colors ${
                  isPaused ? 'bg-zinc-500' : 'bg-emerald-500'
                }`}
              />
            </div>

            {/* Time display */}
            <span
              className={`font-mono text-lg font-semibold tracking-tight transition-colors duration-300 ${
                isPaused ? 'text-zinc-400' : 'text-white'
              }`}
            >
              {formatWorkoutTime(elapsed)}
            </span>
          </div>

          {/* Pause/Play Button */}
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={onTogglePause}
            className={`w-11 h-11 rounded-full flex items-center justify-center transition-all duration-200 ${
              isPaused
                ? 'bg-emerald-500 text-black hover:bg-emerald-400'
                : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
            }`}
          >
            {isPaused ? (
              <Play className="w-5 h-5 ml-0.5" fill="currentColor" />
            ) : (
              <Pause className="w-5 h-5" fill="currentColor" />
            )}
          </motion.button>

          {/* Complete Button */}
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={onComplete}
            disabled={isCompleting || !canComplete}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-full font-semibold text-sm transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed ${
              isPaused
                ? 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
                : 'bg-emerald-500 text-black hover:bg-emerald-400'
            }`}
          >
            {isCompleting ? (
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                className="w-4 h-4 border-2 border-current border-t-transparent rounded-full"
              />
            ) : (
              <>
                <Check className="w-4 h-4" strokeWidth={3} />
                <span>Done</span>
              </>
            )}
          </motion.button>
        </div>

        {/* Progress underline - glowing bar below the pill */}
        <div className="absolute -bottom-2.5 left-3 right-3">
          {/* Track */}
          <div className="h-[3px] rounded-full bg-zinc-800/60 overflow-hidden">
            {/* Fill with glow */}
            <motion.div
              className={`h-full rounded-full transition-colors duration-300 ${
                isPaused ? 'bg-zinc-500' : 'bg-emerald-500'
              }`}
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              style={{
                boxShadow: isPaused
                  ? 'none'
                  : '0 0 12px rgba(16, 185, 129, 0.5), 0 0 4px rgba(16, 185, 129, 0.8)'
              }}
            />
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// Inline Rest Timer Component
function InlineRestTimer({
  timer,
  onSkip,
  onTogglePause,
  onAdjustTime,
  onPresetChange,
  isMuted,
  onToggleMute,
}: {
  timer: RestTimer;
  onSkip: () => void;
  onTogglePause: () => void;
  onAdjustTime: (delta: number) => void;
  onPresetChange: (seconds: number) => void;
  isMuted: boolean;
  onToggleMute: () => void;
}) {
  const progress = timer.remaining / timer.duration;
  const minutes = Math.floor(timer.remaining / 60);
  const seconds = timer.remaining % 60;
  const timeDisplay = `${minutes}:${seconds.toString().padStart(2, "0")}`;

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ type: "spring", damping: 25, stiffness: 300 }}
      className="overflow-hidden"
    >
      <div className="mt-2 p-3 rounded-lg bg-zinc-800/80 border border-emerald-500/20">
        {/* Compact horizontal layout */}
        <div className="flex items-center gap-3">
          {/* Timer display - tap to pause */}
          <button
            onClick={onTogglePause}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
              timer.isPaused ? "bg-amber-500/20" : "bg-emerald-500/20"
            }`}
          >
            {timer.isPaused ? (
              <Play className="w-4 h-4 text-amber-500" />
            ) : (
              <Pause className="w-4 h-4 text-emerald-500" />
            )}
            <span className={`text-xl font-mono font-bold ${
              timer.isPaused ? "text-amber-500" : "text-emerald-500"
            }`}>
              {timeDisplay}
            </span>
          </button>

          {/* Progress bar */}
          <div className="flex-1 h-2 bg-zinc-700 rounded-full overflow-hidden">
            <motion.div
              className={`h-full ${timer.isPaused ? "bg-amber-500" : "bg-emerald-500"}`}
              initial={false}
              animate={{ width: `${progress * 100}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>

          {/* Quick controls */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => onAdjustTime(-15)}
              className="h-9 w-9 rounded-lg bg-zinc-700 hover:bg-zinc-600 active:bg-zinc-500 flex items-center justify-center text-zinc-300 transition-colors touch-manipulation"
            >
              <Minus className="w-4 h-4" />
            </button>
            <button
              onClick={() => onAdjustTime(15)}
              className="h-9 w-9 rounded-lg bg-zinc-700 hover:bg-zinc-600 active:bg-zinc-500 flex items-center justify-center text-zinc-300 transition-colors touch-manipulation"
            >
              <Plus className="w-4 h-4" />
            </button>
            <button
              onClick={onSkip}
              className="h-9 w-9 rounded-lg bg-zinc-700 hover:bg-zinc-600 active:bg-zinc-500 flex items-center justify-center text-zinc-300 transition-colors touch-manipulation"
            >
              <SkipForward className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Presets row */}
        <div className="flex items-center gap-2 mt-2">
          {REST_PRESETS.map((preset) => (
            <button
              key={preset.value}
              onClick={() => onPresetChange(preset.value)}
              className={`h-8 px-3 rounded-md text-xs font-medium transition-all touch-manipulation ${
                timer.duration === preset.value
                  ? "bg-emerald-500 text-white"
                  : "bg-zinc-700 text-zinc-400 hover:bg-zinc-600"
              }`}
            >
              {preset.label}
            </button>
          ))}
          <button
            onClick={onToggleMute}
            className={`h-8 w-8 rounded-md flex items-center justify-center transition-colors touch-manipulation ml-auto ${
              isMuted ? "bg-zinc-700 text-zinc-500" : "bg-zinc-700 text-emerald-500"
            }`}
          >
            {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </motion.div>
  );
}

export default function WorkoutTracker() {
  const params = useParams<{ token: string }>();
  const token = params.token || "";
  const { toast } = useToast();
  const { isOnline, pendingCount, isSyncing, sync } = useOnlineStatus();
  const { isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<TrackingWorkoutData | null>(null);
  const [exercises, setExercises] = useState<ExerciseWithSets[]>([]);
  const [expandedExercise, setExpandedExercise] = useState<number | null>(0);
  const [isReorderMode, setIsReorderMode] = useState(false);
  const [hasReordered, setHasReordered] = useState(false);
  const [showSaveOrderModal, setShowSaveOrderModal] = useState(false);
  const [isSavingOrder, setIsSavingOrder] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);

  // Workout status and timer state
  const [workoutStatus, setWorkoutStatus] = useState<WorkoutStatus>('preview');
  const [workoutTimerState, setWorkoutTimerState] = useState<WorkoutTimerState | null>(null);
  const [workoutElapsed, setWorkoutElapsed] = useState(0);
  const workoutTimerIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Rest timer state
  const [restTimer, setRestTimer] = useState<RestTimer | null>(null);
  const [isMuted, setIsMuted] = useState(() => getMutedPreference());
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  // PR tracking state
  // Maps exercise name -> max weight ever achieved (before this session)
  const [exerciseMaxWeights, setExerciseMaxWeights] = useState<Record<string, number>>({});
  // Tracks which sets in current session are PRs: "exerciseIndex-setNumber" -> true
  const [prSets, setPrSets] = useState<Record<string, boolean>>({});
  // Track PRs achieved this session for celebration screen
  const [sessionPRs, setSessionPRs] = useState<Array<{ exercise: string; weight: number; previousMax: number }>>([]);
  // Show PR celebration screen after workout completion
  const [showPRCelebration, setShowPRCelebration] = useState(false);

  // Previous workout data for placeholder display
  const [previousSetsMap, setPreviousSetsMap] = useState<Record<string, WorkoutSetData>>({});
  const [targetRepsMap, setTargetRepsMap] = useState<Record<number, number | null>>({});

  // Reset workout confirmation dialog
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // Debounce timers for auto-save
  const saveTimers = useRef<Record<string, NodeJS.Timeout>>({});
  const pendingUpdates = useRef<Record<string, Partial<WorkoutSetData>>>({});
  // Track sets that are currently being created to prevent duplicate API calls
  const creatingInProgress = useRef<Set<string>>(new Set());
  // Always-current exercises ref for stale closure prevention in debounced saveSet
  const exercisesRef = useRef(exercises);
  useEffect(() => { exercisesRef.current = exercises; }, [exercises]);

  // Request wake lock
  const requestWakeLock = useCallback(async () => {
    try {
      if ("wakeLock" in navigator) {
        wakeLockRef.current = await navigator.wakeLock.request("screen");
      }
    } catch {
      // Wake lock not supported or failed
    }
  }, []);

  // Release wake lock
  const releaseWakeLock = useCallback(() => {
    if (wakeLockRef.current) {
      wakeLockRef.current.release();
      wakeLockRef.current = null;
    }
  }, []);

  // Timer completion handler
  const handleTimerComplete = useCallback(() => {
    playBeep(isMuted);
    vibrate();

    toast({
      title: "Rest complete!",
      description: "Ready for your next set",
    });

    // Auto-dismiss after 3 seconds
    setTimeout(() => {
      setRestTimer(null);
      releaseWakeLock();
    }, 3000);
  }, [isMuted, toast, releaseWakeLock]);

  // Timer tick effect - uses absolute endTime for accuracy across app switches
  useEffect(() => {
    if (!restTimer || restTimer.isPaused) {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
      return;
    }

    timerIntervalRef.current = setInterval(() => {
      setRestTimer((prev) => {
        if (!prev) return null;

        // Calculate remaining from absolute endTime for accuracy
        const now = Date.now();
        const newRemaining = Math.max(0, Math.ceil((prev.endTime - now) / 1000));

        if (newRemaining <= 0) {
          if (timerIntervalRef.current) {
            clearInterval(timerIntervalRef.current);
            timerIntervalRef.current = null;
          }
          handleTimerComplete();
          clearTimerState();
          return { ...prev, remaining: 0 };
        }

        return { ...prev, remaining: newRemaining };
      });
    }, 1000);

    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    };
  }, [restTimer?.isPaused, handleTimerComplete]);

  // Visibility change handler - recalculate timer when app regains focus
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        setRestTimer((prev) => {
          if (!prev || prev.isPaused) return prev;

          const now = Date.now();
          const newRemaining = Math.max(0, Math.ceil((prev.endTime - now) / 1000));

          if (newRemaining <= 0) {
            // Timer completed while app was in background
            handleTimerComplete();
            clearTimerState();
            return { ...prev, remaining: 0 };
          }

          return { ...prev, remaining: newRemaining };
        });
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [handleTimerComplete]);

  // Restore timer from localStorage on mount
  useEffect(() => {
    const savedTimer = getTimerState();
    if (savedTimer) {
      const now = Date.now();

      if (savedTimer.isPaused) {
        // Timer was paused - restore as-is
        setRestTimer(savedTimer);
        requestWakeLock();
      } else {
        // Timer was running - check if it's still valid
        const newRemaining = Math.max(0, Math.ceil((savedTimer.endTime - now) / 1000));

        if (newRemaining > 0) {
          setRestTimer({ ...savedTimer, remaining: newRemaining });
          requestWakeLock();
        } else {
          // Timer expired while away - clear it
          clearTimerState();
        }
      }
    }
  }, [requestWakeLock]);

  // Workout timer tick effect
  useEffect(() => {
    if (workoutStatus !== 'active' || !workoutTimerState) {
      if (workoutTimerIntervalRef.current) {
        clearInterval(workoutTimerIntervalRef.current);
        workoutTimerIntervalRef.current = null;
      }
      return;
    }

    workoutTimerIntervalRef.current = setInterval(() => {
      setWorkoutElapsed(calculateElapsed(workoutTimerState));
    }, 1000);

    return () => {
      if (workoutTimerIntervalRef.current) {
        clearInterval(workoutTimerIntervalRef.current);
        workoutTimerIntervalRef.current = null;
      }
    };
  }, [workoutStatus, workoutTimerState]);

  // Workout timer visibility change handler
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && workoutTimerState && workoutStatus === 'active') {
        setWorkoutElapsed(calculateElapsed(workoutTimerState));
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [workoutTimerState, workoutStatus]);

  // Start workout function
  const startWorkout = useCallback(async () => {
    const now = Date.now();
    const newTimerState: WorkoutTimerState = {
      startedAt: now,
      totalPausedMs: 0,
    };

    setWorkoutTimerState(newTimerState);
    setWorkoutStatus('active');
    setWorkoutElapsed(0);
    saveWorkoutTimerState(newTimerState, token);
    requestWakeLock();
    trackEvent('workout_started', { exercise_count: exercises.length });

    // Save to database
    try {
      await trackingApi.updateSession(token, {
        startedAt: new Date(now).toISOString(),
        status: 'in_progress',
      });
    } catch (error) {
      console.error('Error updating session start:', error);
      trackApiError('/api/tracking/session', 'PATCH', undefined, error);
    }
  }, [token, requestWakeLock]);

  // Reset workout — clears all progress and returns to preview screen
  const resetWorkout = useCallback(async () => {
    // Reset session on server
    try {
      await trackingApi.updateSession(token, {
        status: "pending",
        startedAt: null,
        completedAt: null,
        totalDuration: null,
      });
    } catch (error) {
      console.error('Error resetting session:', error);
    }

    // Clear all local timer state
    clearWorkoutTimerState(token);
    clearTimerState();

    // Clear local set data
    await clearLocalSets(token);

    // Reset client state
    setWorkoutTimerState(null);
    setWorkoutElapsed(0);
    setRestTimer(null);
    setWorkoutStatus('preview');
    setIsCompleted(false);
    setShowPRCelebration(false);
    setPrSets({});
    setSessionPRs([]);
    releaseWakeLock();

    // Reload to get fresh data from server
    window.location.reload();
  }, [token, releaseWakeLock]);

  // Toggle workout pause
  const toggleWorkoutPause = useCallback(() => {
    if (workoutStatus === 'active' && workoutTimerState) {
      // Pausing
      const now = Date.now();
      const updated: WorkoutTimerState = {
        ...workoutTimerState,
        pausedAt: now,
      };
      setWorkoutTimerState(updated);
      setWorkoutStatus('paused');
      saveWorkoutTimerState(updated, token);
    } else if (workoutStatus === 'paused' && workoutTimerState) {
      // Resuming
      const now = Date.now();
      const pauseDuration = now - (workoutTimerState.pausedAt || now);
      const updated: WorkoutTimerState = {
        ...workoutTimerState,
        pausedAt: undefined,
        totalPausedMs: workoutTimerState.totalPausedMs + pauseDuration,
      };
      setWorkoutTimerState(updated);
      setWorkoutStatus('active');
      setWorkoutElapsed(calculateElapsed(updated));
      saveWorkoutTimerState(updated, token);
    }
  }, [workoutStatus, workoutTimerState, token]);

  // Enter edit mode (after completion)
  const enterEditMode = useCallback(() => {
    setWorkoutStatus('editing');
  }, []);

  // Exit edit mode
  const exitEditMode = useCallback(() => {
    setWorkoutStatus('completed');
  }, []);

  // Start rest timer
  const startRestTimer = useCallback((exerciseIndex: number, setNumber: number, exerciseName: string) => {
    const prefs = getRestPreferences();
    const duration = prefs[exerciseName] || 60; // Default 60 seconds
    const endTime = Date.now() + (duration * 1000);

    const timer: RestTimer = {
      exerciseIndex,
      setNumber,
      exerciseName,
      duration,
      remaining: duration,
      isPaused: false,
      endTime,
    };

    setRestTimer(timer);
    saveTimerState(timer);
    requestWakeLock();
    trackEvent('rest_timer_used', { duration_seconds: duration, exercise: exerciseName });
  }, [requestWakeLock]);

  // Skip timer
  const skipTimer = useCallback(() => {
    setRestTimer(null);
    clearTimerState();
    releaseWakeLock();
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
  }, [releaseWakeLock]);

  // Toggle pause - tracks pausedAt and recalculates endTime on resume
  const toggleTimerPause = useCallback(() => {
    setRestTimer((prev) => {
      if (!prev) return null;
      const now = Date.now();

      if (prev.isPaused) {
        // Resuming: recalculate endTime based on remaining time
        const newEndTime = now + (prev.remaining * 1000);
        const updated = { ...prev, isPaused: false, endTime: newEndTime, pausedAt: undefined };
        saveTimerState(updated);
        return updated;
      } else {
        // Pausing: store when we paused
        const updated = { ...prev, isPaused: true, pausedAt: now };
        saveTimerState(updated);
        return updated;
      }
    });
  }, []);

  // Adjust time - also updates endTime
  const adjustTimerTime = useCallback((delta: number) => {
    setRestTimer((prev) => {
      if (!prev) return null;
      const newRemaining = Math.max(1, prev.remaining + delta);
      const newDuration = Math.max(prev.duration, newRemaining);
      const newEndTime = prev.isPaused ? prev.endTime : Date.now() + (newRemaining * 1000);
      const updated = { ...prev, remaining: newRemaining, duration: newDuration, endTime: newEndTime };
      saveTimerState(updated);
      return updated;
    });
  }, []);

  // Change preset - also updates endTime
  const changePreset = useCallback((seconds: number) => {
    setRestTimer((prev) => {
      if (!prev) return null;
      setRestPreference(prev.exerciseName, seconds);
      const newEndTime = prev.isPaused ? prev.endTime : Date.now() + (seconds * 1000);
      const updated = { ...prev, duration: seconds, remaining: seconds, endTime: newEndTime };
      saveTimerState(updated);
      return updated;
    });
  }, []);

  // Toggle mute
  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const newMuted = !prev;
      setMutedPreference(newMuted);
      return newMuted;
    });
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      releaseWakeLock();
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
    };
  }, [releaseWakeLock]);

  // Flush pending saves when user leaves the page (visibility change or beforeunload)
  // This prevents data loss when user exits before debounced saves complete
  useEffect(() => {
    const flushPendingSaves = () => {
      // Fire all pending debounced saves immediately
      Object.keys(saveTimers.current).forEach((key) => {
        const timer = saveTimers.current[key];
        if (timer) {
          clearTimeout(timer);
          delete saveTimers.current[key];
        }
      });

      // If there are pending updates, try to sync them immediately
      const pendingKeys = Object.keys(pendingUpdates.current);
      if (pendingKeys.length > 0 && navigator.onLine) {
        pendingKeys.forEach(async (key) => {
          const [exerciseIndex, setNumber] = key.split('-').map(Number);
          const updates = pendingUpdates.current[key];
          if (!updates) return;

          const exercise = exercises.find((e) => e.exerciseIndex === exerciseIndex);
          const set = exercise?.sets.find((s) => s.setNumber === setNumber);
          if (!set) return;

          try {
            if (set.id) {
              // Use sendBeacon for fire-and-forget reliability during page unload
              const url = `/api/track/${token}/sets/${set.id}`;
              const body = JSON.stringify(updates);
              if (navigator.sendBeacon) {
                navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
              } else {
                // Fallback to fetch (less reliable during unload)
                fetch(url, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body,
                  keepalive: true,
                });
              }
            }
          } catch {
            // Best effort - data is still in IndexedDB
          }
        });
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushPendingSaves();
      }
    };

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      const hasPendingUpdates = Object.keys(pendingUpdates.current).length > 0;
      const hasPendingTimers = Object.keys(saveTimers.current).length > 0;

      if (hasPendingUpdates || hasPendingTimers) {
        flushPendingSaves();
        // Show browser's "unsaved changes" dialog
        e.preventDefault();
        e.returnValue = '';
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [token, exercises]);

  // Load workout data
  useEffect(() => {
    if (!token) {
      setError("Invalid link");
      setIsLoading(false);
      return;
    }

    const loadWorkout = async () => {
      try {
        let workoutData: TrackingWorkoutData;

        // Try to fetch from API first
        if (navigator.onLine) {
          try {
            // IMPORTANT: Before fetching fresh data, sync any unsaved local modifications
            // This handles the case where user exited before debounced API call completed
            const cached = await getCachedWorkout(token);
            if (cached && Object.keys(cached.localSets).length > 0) {
              // We have unsaved local modifications - sync them first
              for (const [key, localMods] of Object.entries(cached.localSets)) {
                const [exerciseIndex, setNumber] = key.split('-').map(Number);

                // Find if this set exists in the cached data (has an ID)
                const existingSet = cached.data.sets.find(
                  s => s.exerciseIndex === exerciseIndex && s.setNumber === setNumber
                );

                try {
                  if (existingSet?.id) {
                    // Update existing set
                    await trackingApi.updateSet(token, existingSet.id, localMods);
                  } else {
                    // Create new set - find exercise info from workout
                    const exercise = cached.data.workout?.exercises?.[exerciseIndex];
                    if (exercise) {
                      await trackingApi.createSets(token, [{
                        exerciseName: exercise.name,
                        exerciseIndex,
                        setNumber,
                        weight: localMods.weight ?? null,
                        reps: localMods.reps ?? null,
                        completed: localMods.completed ?? 0,
                      }]);
                    }
                  }
                } catch (syncError) {
                  console.error('Failed to sync local modification:', syncError);
                  // Continue anyway - will show stale data but at least not crash
                }
              }
            }

            workoutData = await trackingApi.getWorkout(token);
            // Cache the workout data for offline use
            await cacheWorkout(token, workoutData);
            // Now safe to clear local modifications since we synced them
            await clearLocalSets(token);
          } catch (apiError) {
            // API failed, try cached data
            const cached = await getCachedWorkout(token);
            if (cached) {
              workoutData = mergeLocalModifications(cached.data, cached.localSets);
              toast({
                title: "Using cached data",
                description: "Couldn't reach server. Showing your last saved workout.",
              });
            } else {
              throw apiError;
            }
          }
        } else {
          // Offline - use cached data
          const cached = await getCachedWorkout(token);
          if (cached) {
            workoutData = mergeLocalModifications(cached.data, cached.localSets);
            toast({
              title: "Offline mode",
              description: "Your changes will sync when you're back online.",
            });
          } else {
            throw new Error("You're offline and this workout isn't cached. Please connect to the internet.");
          }
        }

        setData(workoutData);

        // Set workout status based on session data
        if (workoutData.session.status === "completed") {
          setIsCompleted(true);
          setWorkoutStatus('completed');
          // Restore total duration if available
          if (workoutData.session.totalDuration) {
            setWorkoutElapsed(workoutData.session.totalDuration);
          }
        } else if (workoutData.session.status === "in_progress") {
          // Restore timer state from localStorage
          const savedTimerState = getWorkoutTimerState(token);
          if (savedTimerState) {
            setWorkoutTimerState(savedTimerState);
            setWorkoutElapsed(calculateElapsed(savedTimerState));
            // Check if it was paused
            if (savedTimerState.pausedAt) {
              setWorkoutStatus('paused');
            } else {
              setWorkoutStatus('active');
              requestWakeLock();
            }
          } else if (workoutData.session.startedAt) {
            // Reconstruct timer state from database
            const startedAt = new Date(workoutData.session.startedAt).getTime();
            const timerState: WorkoutTimerState = {
              startedAt,
              totalPausedMs: 0,
            };
            setWorkoutTimerState(timerState);
            setWorkoutElapsed(calculateElapsed(timerState));
            setWorkoutStatus('active');
            requestWakeLock();
          } else {
            // In progress but no start time - treat as preview
            setWorkoutStatus('preview');
          }
        } else {
          // Pending or unknown status - show preview
          setWorkoutStatus('preview');
          setIsCompleted(false);
        }

        // Set historical max weights for PR detection
        // Only exercises with history can have PRs (prevents first workout = all PRs)
        if (workoutData.historicalMaxWeights) {
          setExerciseMaxWeights(workoutData.historicalMaxWeights);
        }

        // Helper function to parse reps range and get the top value
        const parseRepsTop = (repsStr: string): number | null => {
          // Handle ranges like "8-12" -> 12
          const rangeMatch = repsStr.match(/(\d+)\s*[-–]\s*(\d+)/);
          if (rangeMatch) {
            const topValue = parseInt(rangeMatch[2], 10);
            return topValue > 0 ? topValue : null;
          }
          // Handle single numbers like "10" -> 10
          const singleMatch = repsStr.match(/^(\d+)$/);
          if (singleMatch) {
            const value = parseInt(singleMatch[1], 10);
            return value > 0 ? value : null;
          }
          // Handle formats like "10 reps" -> 10
          const prefixMatch = repsStr.match(/^(\d+)/);
          if (prefixMatch) {
            const value = parseInt(prefixMatch[1], 10);
            return value > 0 ? value : null;
          }
          return null;
        };

        // Build exercises with sets
        if (workoutData.workout?.exercises) {
          // Create a lookup map for previous session sets for quick access
          // Key: "exerciseIndex-setNumber", Value: set data
          const prevMap: Record<string, WorkoutSetData> = {};
          if (workoutData.previousSets) {
            for (const prevSet of workoutData.previousSets) {
              const key = `${prevSet.exerciseIndex}-${prevSet.setNumber}`;
              prevMap[key] = prevSet;
            }
          }
          setPreviousSetsMap(prevMap);

          // Build target reps map from plan
          const trMap: Record<number, number | null> = {};
          workoutData.workout.exercises.forEach((exercise, index) => {
            trMap[index] = parseRepsTop(exercise.reps);
          });
          setTargetRepsMap(trMap);

          const exercisesWithSets: ExerciseWithSets[] = workoutData.workout.exercises.map(
            (exercise, index) => {
              // Find existing sets for this exercise
              const existingSets = workoutData.sets.filter(
                (s) => s.exerciseIndex === index
              );

              // If no sets exist, we'll create empty placeholder rows
              const sets: WorkoutSetData[] = [];
              for (let setNum = 1; setNum <= exercise.sets; setNum++) {
                const existingSet = existingSets.find((s) => s.setNumber === setNum);
                if (existingSet) {
                  sets.push(existingSet);
                } else {
                  // Empty set — previous data shown as placeholder, not committed
                  sets.push({
                    id: undefined,
                    sessionId: workoutData.session.id,
                    exerciseName: exercise.name,
                    exerciseIndex: index,
                    setNumber: setNum,
                    weight: null,
                    reps: null,
                    completed: 0,
                  });
                }
              }

              return {
                name: exercise.name,
                exerciseId: exercise.id,
                planSets: exercise.sets,
                planReps: exercise.reps,
                details: exercise.details,
                exerciseIndex: index,
                sets,
              };
            }
          );
          setExercises(exercisesWithSets);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load workout");
      } finally {
        setIsLoading(false);
      }
    };

    loadWorkout();
  }, [token]);

  // Auto-save a set with debouncing - OFFLINE-FIRST approach
  const saveSet = useCallback(
    async (exerciseIndex: number, setNumber: number, updates: Partial<WorkoutSetData>) => {
      const key = `${exerciseIndex}-${setNumber}`;

      // 1. Save to IndexedDB immediately (works offline)
      await updateLocalSet(token, exerciseIndex, setNumber, updates);

      // Accumulate updates instead of replacing them
      pendingUpdates.current[key] = {
        ...pendingUpdates.current[key],
        ...updates,
      };

      // Clear existing timer
      if (saveTimers.current[key]) {
        clearTimeout(saveTimers.current[key]);
      }

      // Debounce the API call
      saveTimers.current[key] = setTimeout(async () => {
        try {
          // Get accumulated updates and clear them
          const accumulatedUpdates = pendingUpdates.current[key] || {};
          delete pendingUpdates.current[key];

          const exercise = exercisesRef.current.find((e) => e.exerciseIndex === exerciseIndex);
          const set = exercise?.sets.find((s) => s.setNumber === setNumber);

          if (!set) return;

          // 2. If online, try to sync immediately
          if (navigator.onLine) {
            try {
              if (set.id) {
                // Update existing set with all accumulated updates
                await trackingApi.updateSet(token, set.id, accumulatedUpdates);
              } else {
                // Check if a create is already in progress for this set
                if (creatingInProgress.current.has(key)) {
                  // Another create is already in flight, skip this one
                  // The pending updates have been cleared, but that's OK because
                  // the in-flight create will use its own accumulated updates
                  return;
                }

                // Mark this set as being created
                creatingInProgress.current.add(key);

                try {
                  // Create new set with all accumulated updates
                  const newSets = await trackingApi.createSets(token, [
                    {
                      exerciseName: set.exerciseName,
                      exerciseIndex: set.exerciseIndex,
                      setNumber: set.setNumber,
                      weight: accumulatedUpdates.weight ?? set.weight ?? undefined,
                      reps: accumulatedUpdates.reps ?? set.reps ?? undefined,
                      completed: accumulatedUpdates.completed ?? set.completed ?? 0,
                    },
                  ]);

                  // Update local state with the new ID (preserve local values)
                  if (newSets.length > 0) {
                    setExercises((prev) =>
                      prev.map((ex) =>
                        ex.exerciseIndex === exerciseIndex
                          ? {
                              ...ex,
                              sets: ex.sets.map((s) =>
                                s.setNumber === setNumber
                                  ? { ...s, id: newSets[0].id }
                                  : s
                              ),
                            }
                          : ex
                      )
                    );
                  }
                } finally {
                  // Always clear the in-progress flag
                  creatingInProgress.current.delete(key);
                }
              }
            } catch (apiError) {
              // API failed - queue for later sync
              trackWorkoutSaveError(apiError, { workout_id: token, sets_at_risk: 1 });
              if (set.id) {
                await queueSetUpdate(token, set.id, accumulatedUpdates);
              } else {
                await queueSetCreate(token, [{
                  exerciseName: set.exerciseName,
                  exerciseIndex: set.exerciseIndex,
                  setNumber: set.setNumber,
                  weight: accumulatedUpdates.weight ?? set.weight ?? undefined,
                  reps: accumulatedUpdates.reps ?? set.reps ?? undefined,
                  completed: accumulatedUpdates.completed ?? set.completed ?? 0,
                }]);
              }
            }
          } else {
            // 3. Offline - queue for later sync
            if (set.id) {
              await queueSetUpdate(token, set.id, accumulatedUpdates);
            } else {
              await queueSetCreate(token, [{
                exerciseName: set.exerciseName,
                exerciseIndex: set.exerciseIndex,
                setNumber: set.setNumber,
                weight: accumulatedUpdates.weight ?? set.weight ?? undefined,
                reps: accumulatedUpdates.reps ?? set.reps ?? undefined,
                completed: accumulatedUpdates.completed ?? set.completed ?? 0,
              }]);
            }
          }
        } catch (err) {
          // Even if everything fails, data is in IndexedDB
          console.error("Save error:", err);
        }
      }, 300);
    },
    [token, toast]
  );

  // Handle exercise reorder — re-stamps exerciseIndex on exercises and their sets
  const handleReorder = useCallback((newOrder: ExerciseWithSets[]) => {
    const reindexed = newOrder.map((ex, i) => ({
      ...ex,
      exerciseIndex: i,
      sets: ex.sets.map(s => ({ ...s, exerciseIndex: i })),
    }));
    setExercises(reindexed);
    setHasReordered(true);
  }, []);

  // Update a set locally and trigger save (cascade is now implicit via placeholders)
  const updateSet = (
    exerciseIndex: number,
    setNumber: number,
    field: "weight" | "reps" | "completed",
    value: number | null
  ) => {
    setExercises((prev) =>
      prev.map((ex) =>
        ex.exerciseIndex === exerciseIndex
          ? {
              ...ex,
              sets: ex.sets.map((s) =>
                s.setNumber === setNumber ? { ...s, [field]: value } : s
              ),
            }
          : ex
      )
    );

    saveSet(exerciseIndex, setNumber, { [field]: value });

    // Check for PR when weight is updated
    // Only allow PRs if there's historical data for this exercise
    // (prevents first workout = all PRs)
    if (field === "weight" && value !== null && value > 0) {
      const exercise = exercises.find((ex) => ex.exerciseIndex === exerciseIndex);
      if (exercise) {
        const exerciseName = exercise.name;
        const previousMax = exerciseMaxWeights[exerciseName];
        const prKey = `${exerciseIndex}-${setNumber}`;

        // Only check for PR if exercise has historical data
        if (previousMax !== undefined && value > previousMax) {
          // New PR! But we need to check if this is the highest weight in this exercise
          // Only the highest PR weight should show the indicator

          // Get updated sets with this new value
          const updatedSets = exercise.sets.map((s) =>
            s.setNumber === setNumber ? { ...s, weight: value } : s
          );

          // Find the max weight across all sets for this exercise
          const maxWeightInExercise = Math.max(
            ...updatedSets.map((s) => s.weight ?? 0)
          );

          // Update PR indicators: only sets with the max weight get the PR badge
          setPrSets((prev) => {
            const updated = { ...prev };
            for (const set of updatedSets) {
              const key = `${exerciseIndex}-${set.setNumber}`;
              const setWeight = set.weight ?? 0;
              // PR badge only if: weight beats historical max AND is the highest in this exercise
              updated[key] = setWeight > previousMax && setWeight >= maxWeightInExercise;
            }
            return updated;
          });

          // Only track event if this set is actually the new highest
          if (value >= maxWeightInExercise) {
            trackEvent('pr_achieved', { exercise: exerciseName, weight: value, previous_max: previousMax });
          }

          // Update the max weight for this exercise (for subsequent sets this session)
          setExerciseMaxWeights((prev) => ({
            ...prev,
            [exerciseName]: Math.max(prev[exerciseName] ?? 0, value),
          }));

          // Track PR for celebration screen (only if not already tracked)
          setSessionPRs((prev) => {
            // Check if we already have a PR for this exercise, update it if new one is higher
            const existingIndex = prev.findIndex((pr) => pr.exercise === exerciseName);
            if (existingIndex >= 0) {
              if (prev[existingIndex].weight < value) {
                const updated = [...prev];
                updated[existingIndex] = {
                  exercise: exerciseName,
                  weight: value,
                  previousMax: prev[existingIndex].previousMax,
                };
                return updated;
              }
              return prev;
            }
            return [...prev, { exercise: exerciseName, weight: value, previousMax }];
          });
        } else {
          // Not a PR (no history or weight not high enough)
          setPrSets((prev) => ({ ...prev, [prKey]: false }));
        }
      }
    }
  };

  // Toggle set completion — commits placeholder values when completing
  const toggleSetComplete = (exerciseIndex: number, setNumber: number, currentCompleted: number, exerciseName: string) => {
    const newCompleted = currentCompleted === 1 ? 0 : 1;

    if (newCompleted === 1) {
      // Commit placeholder values if actual values are null
      const exercise = exercises.find(ex => ex.exerciseIndex === exerciseIndex);
      const set = exercise?.sets.find(s => s.setNumber === setNumber);
      if (set) {
        const w = set.weight ?? getPlaceholder(exercises, exerciseIndex, setNumber, "weight", previousSetsMap, targetRepsMap);
        const r = set.reps ?? getPlaceholder(exercises, exerciseIndex, setNumber, "reps", previousSetsMap, targetRepsMap);

        // Update state with committed values + completed flag
        setExercises(prev => prev.map(ex =>
          ex.exerciseIndex === exerciseIndex
            ? { ...ex, sets: ex.sets.map(s =>
                s.setNumber === setNumber ? { ...s, weight: w, reps: r, completed: 1 } : s
              )}
            : ex
        ));
        saveSet(exerciseIndex, setNumber, { weight: w, reps: r, completed: 1 });

        // Check for PR when weight is committed via placeholder
        if (w !== null && w > 0) {
          const previousMax = exerciseMaxWeights[exerciseName];
          const prKey = `${exerciseIndex}-${setNumber}`;
          if (previousMax !== undefined && w > previousMax) {
            setPrSets(prev => ({ ...prev, [prKey]: true }));
            setSessionPRs(prev => {
              const existingIndex = prev.findIndex(p => p.exercise === exerciseName);
              if (existingIndex >= 0) {
                if (prev[existingIndex].weight < w) {
                  const updated = [...prev];
                  updated[existingIndex] = { exercise: exerciseName, weight: w, previousMax: prev[existingIndex].previousMax };
                  return updated;
                }
                return prev;
              }
              return [...prev, { exercise: exerciseName, weight: w, previousMax }];
            });
          }
        }

        trackEvent('set_logged', { exercise: exerciseName, set_number: setNumber });
        startRestTimer(exerciseIndex, setNumber, exerciseName);
      }
    } else {
      updateSet(exerciseIndex, setNumber, "completed", 0);
      // If uncompleting the set that has the timer, dismiss it
      if (restTimer?.exerciseIndex === exerciseIndex && restTimer?.setNumber === setNumber) {
        skipTimer();
      }
    }
  };

  // Proceed to PR celebration or completed screen (called after save-order decision)
  const proceedToCompletion = () => {
    if (sessionPRs.length > 0) {
      setShowPRCelebration(true);
    } else {
      setIsCompleted(true);
      setWorkoutStatus('completed');
    }
  };

  // Save the current exercise order to the plan for future workouts
  const saveExerciseOrder = async () => {
    setIsSavingOrder(true);
    try {
      const exerciseOrder = exercises.map(ex => ({
        id: ex.exerciseId,
        name: ex.name,
      }));
      await trackingApi.saveExerciseOrder(token, exerciseOrder);
      toast({ title: "Order saved", description: "Future workouts will use this exercise order" });
    } catch (err) {
      console.error("Failed to save exercise order:", err);
      toast({ title: "Couldn't save order", description: "Your workout was saved, but the exercise order wasn't updated", variant: "destructive" });
    } finally {
      setIsSavingOrder(false);
      setShowSaveOrderModal(false);
      proceedToCompletion();
    }
  };

  // Complete workout
  const completeWorkout = async () => {
    setIsCompleting(true);
    try {
      const totalDuration = workoutElapsed;

      await trackingApi.updateSession(token, {
        status: "completed",
        completedAt: new Date().toISOString(),
        totalDuration,
      });

      trackEvent('workout_completed', {
        duration_seconds: totalDuration,
        sets_completed: completedSets,
        total_sets: totalSets,
        prs_achieved: sessionPRs.length,
      });

      skipTimer(); // Clear any running rest timer
      clearWorkoutTimerState(token); // Clear workout timer from localStorage
      releaseWakeLock();

      // If exercises were reordered, ask user if they want to save the new order
      if (hasReordered) {
        setShowSaveOrderModal(true);
        // Don't proceed to PR/complete yet — wait for modal response
      } else {
        proceedToCompletion();
      }
    } catch (err) {
      trackWorkoutSaveError(err, { workout_id: token, sets_at_risk: completedSets });
      toast({
        title: "Error",
        description: "Failed to complete workout",
        variant: "destructive",
      });
    } finally {
      setIsCompleting(false);
    }
  };

  // Calculate progress
  const totalSets = exercises.reduce((acc, ex) => acc + ex.sets.length, 0);
  const completedSets = exercises.reduce(
    (acc, ex) => acc + ex.sets.filter((s) => s.completed === 1).length,
    0
  );
  const progressPercent = totalSets > 0 ? Math.round((completedSets / totalSets) * 100) : 0;

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-4">
        <Card className="glass-card max-w-md w-full">
          <CardContent className="p-6 text-center">
            <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
            <h1 className="text-xl font-semibold text-white mb-2">Link Expired</h1>
            <p className="text-zinc-400">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Completed state (not in editing mode)
  if (isCompleted && workoutStatus === 'completed') {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-4">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="text-center w-full max-w-md"
        >
          {/* Animated checkmark */}
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2, type: "spring", damping: 15 }}
            className="w-24 h-24 rounded-full bg-emerald-500/20 border-2 border-emerald-500 flex items-center justify-center mx-auto mb-6"
          >
            <CheckCircle2 className="h-12 w-12 text-emerald-500" />
          </motion.div>

          <h1 className="text-2xl font-bold text-white mb-6">Workout Complete!</h1>

          {/* Stats card */}
          <Card className="glass-card mb-6">
            <CardContent className="p-6">
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <Timer className="w-5 h-5 text-emerald-500" />
                  <div className="text-left">
                    <p className="text-white font-mono font-bold text-lg">
                      {formatWorkoutTime(workoutElapsed)}
                    </p>
                    <p className="text-xs text-zinc-500">total time</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                  <div className="text-left">
                    <p className="text-white font-bold text-lg">
                      {completedSets}/{totalSets}
                    </p>
                    <p className="text-xs text-zinc-500">sets completed</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Edit button */}
          <Button
            variant="outline"
            onClick={enterEditMode}
            className="w-full mb-3 border-zinc-700 text-zinc-300 hover:bg-zinc-800"
          >
            <Pencil className="w-4 h-4 mr-2" />
            Edit Workout
          </Button>

          {/* View Dashboard button - navigate to login */}
          <Button
            onClick={() => window.location.href = '/login'}
            className="w-full bg-emerald-500 hover:bg-emerald-600 text-black font-semibold"
          >
            View Dashboard
          </Button>
        </motion.div>
      </div>
    );
  }

  // Preview state - show workout overview before starting
  if (workoutStatus === 'preview' && !isCompleted) {
    return (
      <div className="min-h-screen bg-black pb-28">
        {/* Offline banner for preview */}
        <AnimatePresence>
          {!isOnline && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="bg-amber-500/90 text-black overflow-hidden"
            >
              <div className="px-4 py-2 text-center">
                <div className="flex items-center justify-center gap-2">
                  <WifiOff className="w-4 h-4" />
                  <span className="text-sm font-medium">Offline mode - changes will sync when connected</span>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="max-w-lg mx-auto px-4 py-8">
          {/* Back Button */}
          <motion.button
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 }}
            onClick={() => setLocation(isAuthenticated ? "/dashboard" : "/")}
            className="group flex items-center gap-2 mb-6 -ml-1 py-2 pr-3 pl-2 rounded-lg text-zinc-500 hover:text-white hover:bg-white/5 transition-all duration-200"
          >
            <ArrowLeft className="w-4 h-4 transition-transform duration-200 group-hover:-translate-x-0.5" />
            <span className="text-sm font-medium">Dashboard</span>
          </motion.button>

          {/* Header */}
          <div className="text-center mb-8">
            <span className="text-emerald-500/60 uppercase tracking-[0.3em] text-xs font-medium">
              Get Ready
            </span>
            <h1 className="text-3xl font-bold text-white mt-2">{data?.session.focus}</h1>
          </div>

          {/* Stats pill */}
          <div className="mx-auto w-fit px-6 py-3 rounded-full glass-surface mb-6">
            <span className="text-zinc-400">
              {exercises.length} exercises • {totalSets} sets
            </span>
          </div>

          {/* Exercise preview list — drag to reorder */}
          <Reorder.Group
            axis="y"
            values={exercises}
            onReorder={handleReorder}
            className="space-y-2"
          >
            {exercises.map((exercise) => (
              <DraggableExerciseItem
                key={exercise.exerciseId!}
                exercise={exercise}
                className="flex items-center gap-0 glass-card overflow-hidden"
              >
                <div className="flex justify-between items-center flex-1 pr-4 py-3">
                  <span className="text-white font-medium">{exercise.name}</span>
                  <span className="text-zinc-500 text-sm">{exercise.planSets}×{exercise.planReps}</span>
                </div>
              </DraggableExerciseItem>
            ))}
          </Reorder.Group>
        </div>

        {/* Floating Start Button */}
        <FloatingWorkoutControl
          elapsed={0}
          isPaused={false}
          isActive={false}
          onStart={startWorkout}
          onTogglePause={() => {}}
          onComplete={() => {}}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black pb-24 relative">
      {/* Paused Overlay */}
      <AnimatePresence>
        {workoutStatus === 'paused' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-40 flex flex-col items-center justify-center"
            style={{ paddingBottom: '120px' }} // Account for floating control bar
          >
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />

            {/* Content */}
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ delay: 0.1 }}
              className="relative z-10 text-center px-8"
            >
              {/* Paused icon */}
              <motion.div
                animate={{
                  scale: [1, 1.05, 1],
                  opacity: [0.5, 0.8, 0.5],
                }}
                transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                className="w-20 h-20 mx-auto mb-6 rounded-full bg-zinc-800/80 border border-zinc-700 flex items-center justify-center"
              >
                <Pause className="w-10 h-10 text-zinc-400" fill="currentColor" />
              </motion.div>

              <h2 className="text-2xl font-bold text-white mb-2">Workout Paused</h2>
              <p className="text-zinc-500 mb-8">Tap resume to continue your workout</p>

              {/* Timer display */}
              <div className="inline-flex items-center gap-2 px-5 py-3 rounded-full bg-zinc-800/60 border border-zinc-700/50 mb-6">
                <Timer className="w-5 h-5 text-zinc-400" />
                <span className="text-xl font-mono font-semibold text-zinc-300">
                  {formatWorkoutTime(workoutElapsed)}
                </span>
              </div>

              {/* Resume button */}
              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                onClick={toggleWorkoutPause}
                className="flex items-center gap-3 mx-auto px-8 py-4 rounded-full bg-emerald-500 text-black font-bold text-lg"
                style={{
                  boxShadow: '0 0 40px rgba(16, 185, 129, 0.3)',
                }}
              >
                <Play className="w-5 h-5" fill="currentColor" />
                Resume Workout
              </motion.button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Offline banner */}
      <AnimatePresence>
        {!isOnline && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="bg-amber-500/90 text-black overflow-hidden"
          >
            <div className="px-4 py-2">
              <div className="max-w-lg mx-auto flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <WifiOff className="w-4 h-4" />
                  <span className="text-sm font-medium">
                    Offline {pendingCount > 0 && `• ${pendingCount} changes pending`}
                  </span>
                </div>
                <span className="text-xs opacity-75">Will sync when connected</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Syncing indicator - shows briefly when syncing */}
      <AnimatePresence>
        {isSyncing && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="bg-emerald-500/90 text-black overflow-hidden"
          >
            <div className="px-4 py-2">
              <div className="max-w-lg mx-auto flex items-center gap-2">
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span className="text-sm font-medium">Syncing changes...</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Editing banner */}
      {workoutStatus === 'editing' && (
        <div className="bg-amber-500/10 border-b border-amber-500/30 px-4 py-2">
          <div className="max-w-lg mx-auto flex items-center justify-between">
            <div className="flex items-center gap-2 text-amber-500">
              <Pencil className="w-4 h-4" />
              <span className="text-sm font-medium">Editing completed workout</span>
            </div>
            <button
              onClick={exitEditMode}
              className="text-sm text-zinc-400 hover:text-white"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Header - non-sticky, scrolls with content */}
      <div className="px-4 py-5">
        <div className="max-w-lg mx-auto">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              {/* Menu Button */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <motion.button
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="group flex items-center justify-center w-9 h-9 -ml-1 rounded-full text-zinc-500 hover:text-white hover:bg-white/10 transition-all duration-200"
                  >
                    <MoreVertical className="w-5 h-5" />
                  </motion.button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="bg-zinc-900 border-zinc-700">
                  <DropdownMenuItem
                    onClick={() => {
                      setIsReorderMode(true);
                      setExpandedExercise(null);
                    }}
                    className="text-zinc-300 focus:text-white cursor-pointer"
                  >
                    <GripVertical className="w-4 h-4 mr-2" />
                    Reorder Exercises
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setShowResetConfirm(true)}
                    className="text-red-400 focus:text-red-400 focus:bg-red-500/10 cursor-pointer"
                  >
                    <RotateCcw className="w-4 h-4 mr-2" />
                    Reset Workout
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setLocation(isAuthenticated ? "/dashboard" : "/login")}
                    className="text-zinc-300 focus:text-white cursor-pointer"
                  >
                    <LayoutDashboard className="w-4 h-4 mr-2" />
                    Go to Dashboard
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <h1 className="text-2xl font-bold text-white tracking-tight">{data?.session.focus}</h1>
            </div>

            {/* Progress stats */}
            <div className="text-right">
              <span className={`text-3xl font-bold font-mono tracking-tight ${workoutStatus === 'editing' ? 'text-amber-500' : 'text-emerald-500'}`}>
                {progressPercent}%
              </span>
              <p className="text-xs text-zinc-500 mt-1">{completedSets} of {totalSets} sets</p>
            </div>
          </div>

          {/* Progress bar */}
          <div className="h-1.5 bg-zinc-800/60 rounded-full overflow-hidden">
            <motion.div
              className={`h-full rounded-full ${workoutStatus === 'editing' ? 'bg-amber-500' : 'bg-gradient-to-r from-emerald-500 to-emerald-400'}`}
              initial={{ width: 0 }}
              animate={{ width: `${progressPercent}%` }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              style={{ boxShadow: workoutStatus === 'editing' ? 'none' : '0 0 12px rgba(16, 185, 129, 0.4)' }}
            />
          </div>
        </div>
      </div>

      {/* Exercises */}
      {isReorderMode ? (
        <div className="max-w-lg mx-auto px-4 py-2">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">Drag to reorder</span>
            <button
              onClick={() => setIsReorderMode(false)}
              className="text-xs font-semibold text-emerald-500 px-3 py-1.5 rounded-lg hover:bg-emerald-500/10 transition-colors"
            >
              Done
            </button>
          </div>
          <Reorder.Group
            axis="y"
            values={exercises}
            onReorder={handleReorder}
            className="space-y-2"
          >
            {exercises.map((exercise) => {
              const exerciseCompletedSets = exercise.sets.filter((s) => s.completed === 1).length;
              const isExerciseComplete = exerciseCompletedSets === exercise.sets.length;
              return (
                <DraggableExerciseItem
                  key={exercise.exerciseId!}
                  exercise={exercise}
                  className={`flex items-center gap-0 rounded-xl border overflow-hidden ${
                    isExerciseComplete
                      ? "border-zinc-800/50 bg-zinc-900/40 opacity-60"
                      : "border-zinc-800/50 bg-zinc-900/60"
                  }`}
                >
                  <div className="flex justify-between items-center flex-1 pr-4 py-3">
                    <h3 className={`font-semibold text-[15px] ${isExerciseComplete ? 'text-zinc-400 line-through' : 'text-white'}`}>
                      {exercise.name}
                    </h3>
                    <span className="text-xs text-zinc-500 font-mono">
                      {exerciseCompletedSets}/{exercise.sets.length}
                    </span>
                  </div>
                </DraggableExerciseItem>
              );
            })}
          </Reorder.Group>
        </div>
      ) : (
      <div className="max-w-lg mx-auto px-4 py-2 space-y-4">
        {exercises.map((exercise, idx) => {
          // Check if any set in this exercise has a PR
          const exerciseHasPR = exercise.sets.some((set) => {
            const prKey = `${exercise.exerciseIndex}-${set.setNumber}`;
            return prSets[prKey] === true;
          });

          // Calculate exercise progress
          const exerciseCompletedSets = exercise.sets.filter((s) => s.completed === 1).length;
          const exerciseProgressPercent = (exerciseCompletedSets / exercise.sets.length) * 100;
          const isExerciseComplete = exerciseCompletedSets === exercise.sets.length;
          const isActive = expandedExercise === exercise.exerciseIndex;

          return (
          <div
            key={exercise.exerciseId!}
            className="flex gap-3"
          >
            {/* Vertical progress bar */}
            <div className="w-1 bg-zinc-800/60 rounded-full relative flex-shrink-0">
              <motion.div
                className={`absolute top-0 left-0 right-0 rounded-full ${
                  exerciseHasPR ? 'bg-amber-500' : 'bg-emerald-500'
                }`}
                initial={{ height: 0 }}
                animate={{ height: `${exerciseProgressPercent}%` }}
                transition={{ duration: 0.3, ease: "easeOut" }}
              />
            </div>

            {/* Exercise card */}
            <Card
              className={`flex-1 overflow-hidden transition-all border ${
                exerciseHasPR
                  ? "border-amber-500/30 bg-amber-500/5"
                  : isActive
                  ? "border-emerald-500/25 bg-zinc-900/80 shadow-[0_0_24px_rgba(16,185,129,0.08)]"
                  : isExerciseComplete
                  ? "border-zinc-800/50 bg-zinc-900/40 opacity-60"
                  : "border-zinc-800/50 bg-zinc-900/60"
              }`}
            >
              {/* Exercise header - clickable to expand */}
              <button
                className="w-full px-4 py-3.5 flex items-center justify-between text-left"
                onClick={() =>
                  setExpandedExercise(expandedExercise === exercise.exerciseIndex ? null : exercise.exerciseIndex)
                }
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className={`font-semibold text-[15px] ${
                      isExerciseComplete ? 'text-zinc-400 line-through' : 'text-white'
                    }`}>
                      {exercise.name}
                    </h3>
                    {exerciseHasPR && (
                      <motion.span
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide bg-gradient-to-r from-amber-400 to-amber-500 text-black rounded"
                      >
                        <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                        PR
                      </motion.span>
                    )}
                  </div>
                  <p className="text-[13px] text-zinc-500 mt-0.5">
                    {exercise.planSets} sets × {exercise.planReps}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {/* Show timer indicator if timer is active for this exercise */}
                  {restTimer?.exerciseIndex === exercise.exerciseIndex && (
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      className="flex items-center gap-1 text-emerald-500"
                    >
                      <Timer className="h-4 w-4" />
                    </motion.div>
                  )}
                  <span className={`text-sm font-mono ${
                    isActive ? 'text-emerald-400' : 'text-zinc-500'
                  }`}>
                    {exerciseCompletedSets}/{exercise.sets.length}
                  </span>
                  <ChevronDown className={`h-5 w-5 text-zinc-500 transition-transform duration-200 ${
                    isActive ? 'rotate-180' : ''
                  }`} />
                </div>
              </button>

            {/* Expanded sets */}
            <AnimatePresence>
            {expandedExercise === exercise.exerciseIndex && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="border-t border-zinc-800/30 overflow-hidden"
              >
                <div className="p-4 space-y-3">
                  {/* Details/tips if available */}
                  {exercise.details && exercise.details.length > 0 && (
                    <div className="p-3 bg-zinc-800/30 rounded-lg text-[13px] text-zinc-400 leading-relaxed">
                      {exercise.details.map((detail, i) => (
                        <p key={i}>{detail}</p>
                      ))}
                    </div>
                  )}

                  {/* Column headers — Strong-style */}
                  <div className="flex items-center gap-3 px-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                    <div className="w-8 text-center flex-shrink-0">Set</div>
                    <div className="w-14 text-center flex-shrink-0">Previous</div>
                    <div className="flex-1 flex justify-center gap-2">
                      <div className="w-20 text-center">lbs</div>
                      <div className="w-20 text-center">Reps</div>
                    </div>
                    <div className="w-12 flex-shrink-0" />
                  </div>

                  {/* Set rows */}
                  <div className="space-y-2">
                    {exercise.sets.map((set) => {
                      const prKey = `${exercise.exerciseIndex}-${set.setNumber}`;
                      const isPR = prSets[prKey] === true;

                      return (
                      <div key={set.setNumber}>
                        <div
                          className={`flex items-center gap-3 p-2 rounded-xl transition-all ${
                            isPR
                              ? "bg-gradient-to-r from-amber-500/15 to-transparent border border-amber-500/40"
                              : set.completed === 1
                              ? "bg-emerald-500/8 border border-emerald-500/15"
                              : "bg-zinc-800/30 border border-transparent"
                          }`}
                        >
                          {/* Set number indicator */}
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-semibold font-mono flex-shrink-0 ${
                            set.completed === 1
                              ? "bg-emerald-500 text-black"
                              : isPR
                              ? "bg-amber-500/20 text-amber-400"
                              : "bg-zinc-700/60 text-zinc-400"
                          }`}>
                            {set.setNumber}
                          </div>

                          {/* Previous session data */}
                          {(() => {
                            const prev = previousSetsMap[`${exercise.exerciseIndex}-${set.setNumber}`];
                            return (
                              <div className="text-[11px] text-zinc-600 font-mono w-14 text-center flex-shrink-0">
                                {prev && (prev.weight != null || prev.reps != null)
                                  ? `${prev.weight ?? "—"}×${prev.reps ?? "—"}`
                                  : "—"}
                              </div>
                            );
                          })()}

                          {/* Inputs container */}
                          <div className="flex-1 flex justify-center gap-2">
                            {/* Weight input */}
                            <Input
                              type="number"
                              inputMode="numeric"
                              placeholder={(() => {
                                const ph = getPlaceholder(exercises, exercise.exerciseIndex, set.setNumber, "weight", previousSetsMap, targetRepsMap);
                                return ph !== null ? String(ph) : "";
                              })()}
                              value={set.weight ?? ""}
                              onFocus={(e) => e.target.select()}
                              onChange={(e) =>
                                updateSet(
                                  exercise.exerciseIndex,
                                  set.setNumber,
                                  "weight",
                                  e.target.value ? parseInt(e.target.value) : null
                                )
                              }
                              className={`h-10 w-20 bg-black/30 text-center text-white font-mono text-base border rounded-lg placeholder:text-zinc-600 ${
                                isPR ? "border-amber-500/40" : "border-zinc-700/50"
                              } focus:border-emerald-500 focus:ring-0`}
                            />

                            {/* Reps input */}
                            <Input
                              type="number"
                              inputMode="numeric"
                              placeholder={(() => {
                                const ph = getPlaceholder(exercises, exercise.exerciseIndex, set.setNumber, "reps", previousSetsMap, targetRepsMap);
                                return ph !== null ? String(ph) : "";
                              })()}
                              value={set.reps ?? ""}
                              onFocus={(e) => e.target.select()}
                              onChange={(e) =>
                                updateSet(
                                  exercise.exerciseIndex,
                                  set.setNumber,
                                  "reps",
                                  e.target.value ? parseInt(e.target.value) : null
                                )
                              }
                              className="h-10 w-20 bg-black/30 border-zinc-700/50 text-center text-white font-mono text-base rounded-lg placeholder:text-zinc-600 focus:border-emerald-500 focus:ring-0"
                            />
                          </div>

                          {/* Done button */}
                          <button
                            onClick={() =>
                              toggleSetComplete(
                                exercise.exerciseIndex,
                                set.setNumber,
                                set.completed,
                                exercise.name
                              )
                            }
                            className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all flex-shrink-0 ${
                              set.completed === 1
                                ? "bg-emerald-500 text-black"
                                : "bg-zinc-700/50 text-zinc-400 hover:bg-zinc-600/50 border-2 border-zinc-600/50 hover:border-emerald-500/50"
                            }`}
                          >
                            <Check className="h-5 w-5" strokeWidth={set.completed === 1 ? 3 : 2} />
                          </button>
                        </div>

                        {/* Inline Rest Timer - appears below the set that triggered it */}
                        <AnimatePresence>
                          {restTimer?.exerciseIndex === exercise.exerciseIndex &&
                            restTimer?.setNumber === set.setNumber && (
                              <InlineRestTimer
                                timer={restTimer}
                                onSkip={skipTimer}
                                onTogglePause={toggleTimerPause}
                                onAdjustTime={adjustTimerTime}
                                onPresetChange={changePreset}
                                isMuted={isMuted}
                                onToggleMute={toggleMute}
                              />
                            )}
                        </AnimatePresence>
                      </div>
                      );
                    })}
                  </div>
                </div>
              </motion.div>
            )}
            </AnimatePresence>
            </Card>
          </div>
          );
        })}
      </div>
      )}

      {/* Floating Control Island - for active/paused states */}
      {(workoutStatus === 'active' || workoutStatus === 'paused') && (
        <FloatingWorkoutControl
          elapsed={workoutElapsed}
          isPaused={workoutStatus === 'paused'}
          isActive={true}
          progress={progressPercent}
          onStart={startWorkout}
          onTogglePause={toggleWorkoutPause}
          onComplete={completeWorkout}
          isCompleting={isCompleting}
          canComplete={completedSets > 0}
        />
      )}

      {/* Save Changes Button - only for editing mode */}
      {workoutStatus === 'editing' && (
        <div className="fixed bottom-6 left-0 right-0 flex justify-center px-4">
          <motion.button
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            whileTap={{ scale: 0.97 }}
            onClick={exitEditMode}
            className="flex items-center gap-2 px-8 py-4 rounded-full bg-amber-500 text-black font-bold text-lg border border-amber-400/50 backdrop-blur-xl"
            style={{
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3), 0 0 40px rgba(245, 158, 11, 0.2)',
            }}
          >
            <Check className="w-5 h-5" strokeWidth={3} />
            Save Changes
          </motion.button>
        </div>
      )}

      {/* PR Celebration Screen */}
      <PRCelebration
        isOpen={showPRCelebration}
        onClose={() => {
          setShowPRCelebration(false);
          setIsCompleted(true);
          setWorkoutStatus('completed');
        }}
        prs={sessionPRs}
      />

      {/* Save Exercise Order Modal — compact centered pill */}
      <AnimatePresence>
        {showSaveOrderModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center px-8"
          >
            <div className="absolute inset-0 bg-black/60" onClick={() => { if (!isSavingOrder) { setShowSaveOrderModal(false); proceedToCompletion(); } }} />
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="relative z-10 w-full max-w-[280px] bg-zinc-900 border border-zinc-700/80 rounded-2xl p-5 text-center"
            >
              <p className="text-white font-semibold text-[15px] mb-1">Save new order?</p>
              <p className="text-zinc-500 text-xs mb-4">Apply to future workouts</p>
              <button
                disabled={isSavingOrder}
                onClick={saveExerciseOrder}
                className="w-full py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 transition-colors mb-2 disabled:opacity-50"
              >
                {isSavingOrder ? "Saving..." : "Save"}
              </button>
              <button
                disabled={isSavingOrder}
                onClick={() => { setShowSaveOrderModal(false); proceedToCompletion(); }}
                className="w-full py-2.5 rounded-xl text-zinc-400 text-sm hover:text-zinc-300 transition-colors"
              >
                Skip
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Reset Workout Confirmation Dialog */}
      {/* Reset Workout Confirmation */}
      <AnimatePresence>
        {showResetConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center px-8"
          >
            <div className="absolute inset-0 bg-black/60" onClick={() => setShowResetConfirm(false)} />
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="relative z-10 w-full max-w-[280px] bg-zinc-900 border border-zinc-700/80 rounded-2xl p-5 text-center"
            >
              <p className="text-white font-semibold text-[15px] mb-1">Reset workout?</p>
              <p className="text-zinc-500 text-xs mb-4">All progress will be cleared</p>
              <button
                onClick={() => { setShowResetConfirm(false); resetWorkout(); }}
                className="w-full py-2.5 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700 transition-colors mb-2"
              >
                Reset
              </button>
              <button
                onClick={() => setShowResetConfirm(false)}
                className="w-full py-2.5 rounded-xl text-zinc-400 text-sm hover:text-zinc-300 transition-colors"
              >
                Cancel
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
