import { useState, useEffect } from "react";
import { useParams } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { Check, ChevronDown, Clock, Loader2, MessageSquare, AlertTriangle, Dumbbell } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { planDraftApi, type PlanDraftResponse } from "@/lib/api";

const BRANDON_PHONE = "+16289978087";

type PageState = "loading" | "error" | "preview" | "accepted";

export default function PlanDraftReview() {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<PageState>("loading");
  const [error, setError] = useState<string>("");
  const [data, setData] = useState<PlanDraftResponse | null>(null);
  const [expandedDays, setExpandedDays] = useState<Set<number>>(new Set());
  const [accepting, setAccepting] = useState(false);
  const [showChanges, setShowChanges] = useState(false);
  const [changeText, setChangeText] = useState("");

  useEffect(() => {
    if (!token) return;
    planDraftApi.getDraft(token)
      .then((result) => {
        setData(result);
        setState("preview");
      })
      .catch((err) => {
        setError(err.message);
        setState("error");
      });
  }, [token]);

  const toggleDay = (index: number) => {
    setExpandedDays((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const handleAccept = async () => {
    if (!token || accepting) return;
    setAccepting(true);
    try {
      await planDraftApi.acceptDraft(token);
      setState("accepted");
    } catch (err: any) {
      setError(err.message);
      setState("error");
    } finally {
      setAccepting(false);
    }
  };

  const handleSendChanges = () => {
    if (!changeText.trim()) return;
    const body = encodeURIComponent(`About the plan you sent me: ${changeText}`);
    const smsUrl = `sms:${BRANDON_PHONE}?body=${body}`;

    // Try to open SMS app
    window.location.href = smsUrl;
  };

  // Loading state
  if (state === "loading") {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col items-center gap-4"
        >
          <Loader2 className="w-8 h-8 text-emerald-400 animate-spin" />
          <p className="text-zinc-400 text-sm">Loading plan...</p>
        </motion.div>
      </div>
    );
  }

  // Error state
  if (state === "error") {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center max-w-sm"
        >
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
            <AlertTriangle className="w-8 h-8 text-red-400" />
          </div>
          <h1 className="text-xl font-semibold text-white mb-2">Plan Not Found</h1>
          <p className="text-zinc-400 text-sm mb-6">{error || "This link may have expired or already been used."}</p>
          <a
            href={`sms:${BRANDON_PHONE}`}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm text-zinc-300 hover:bg-white/10 transition-colors"
          >
            <MessageSquare className="w-4 h-4" />
            Text Brandon
          </a>
        </motion.div>
      </div>
    );
  }

  // Accepted state
  if (state === "accepted") {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center px-6">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: "spring", damping: 20, stiffness: 300 }}
          className="text-center max-w-sm"
        >
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.15, type: "spring", damping: 12, stiffness: 200 }}
            className="w-20 h-20 mx-auto mb-6 rounded-full bg-emerald-500/15 border-2 border-emerald-500/30 flex items-center justify-center"
          >
            <Check className="w-10 h-10 text-emerald-400" strokeWidth={3} />
          </motion.div>
          <h1 className="text-2xl font-bold text-white mb-2">Plan Activated!</h1>
          <p className="text-zinc-400 text-sm mb-8">
            Your new workout plan is now active. Sessions will be scheduled automatically.
          </p>
          <a
            href={`sms:${BRANDON_PHONE}`}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-white/5 border border-white/10 text-sm text-zinc-300 hover:bg-white/10 transition-colors"
          >
            <MessageSquare className="w-4 h-4" />
            Text Brandon
          </a>
        </motion.div>
      </div>
    );
  }

  // Preview state
  const workouts = (data?.draft.planData as any)?.workouts || [];

  return (
    <div className="min-h-screen bg-black relative">
      {/* Atmospheric glow */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-emerald-500/[0.03] rounded-full blur-[120px]" />
      </div>

      <div className="relative z-10 max-w-2xl mx-auto px-4 pt-8 pb-40 sm:px-6">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center">
              <Dumbbell className="w-5 h-5 text-emerald-400" />
            </div>
            <p className="text-xs uppercase tracking-wider text-zinc-500 font-medium">New Plan Draft</p>
          </div>
          <h1 className="text-2xl font-bold text-white mb-1">Brandon drafted a new plan for you</h1>
          <p className="text-sm text-zinc-500">Review the workouts below, then accept or request changes.</p>
        </motion.div>

        {/* Plan cards */}
        <div className="grid gap-4">
          {workouts.map((workout: any, index: number) => {
            const isDayExpanded = expandedDays.has(index);
            return (
              <div key={`${workout.day}-${workout.focus}`}>
                {/* Mobile: Collapsible pills */}
                <div className="lg:hidden">
                  <motion.button
                    onClick={() => toggleDay(index)}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.08 }}
                    className={cn(
                      "w-full rounded-2xl overflow-hidden transition-all text-left",
                      "bg-white/[0.03] backdrop-blur-xl border border-white/[0.08]",
                      "shadow-[0_4px_24px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.05)]",
                      "hover:bg-white/[0.05] hover:border-white/[0.12]",
                      "active:scale-[0.98]"
                    )}
                  >
                    <div className="flex items-center justify-between p-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center">
                          <span className="text-xs font-bold text-emerald-400 uppercase">
                            {workout.day.slice(0, 3)}
                          </span>
                        </div>
                        <div className="text-left">
                          <p className="text-sm font-medium text-white">{workout.focus}</p>
                          <p className="text-xs text-zinc-500 flex items-center gap-1.5">
                            <Clock className="w-3 h-3" />
                            {workout.duration} &middot; {workout.exercises?.length || 0} exercises
                          </p>
                        </div>
                      </div>
                      <ChevronDown className={cn(
                        "w-5 h-5 text-zinc-500 transition-transform",
                        isDayExpanded && "rotate-180"
                      )} />
                    </div>
                  </motion.button>

                  {/* Expanded exercise list */}
                  <AnimatePresence>
                    {isDayExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ type: "spring", damping: 25, stiffness: 300 }}
                        className="overflow-hidden"
                      >
                        <div className={cn(
                          "mt-2 rounded-2xl overflow-hidden",
                          "bg-white/[0.02] backdrop-blur-xl border border-white/[0.06]",
                          "shadow-[0_4px_24px_rgba(0,0,0,0.2)]"
                        )}>
                          <div className="divide-y divide-white/5">
                            {(workout.exercises || []).map((exercise: any, i: number) => (
                              <div key={i} className="flex items-center gap-3 p-3 px-4">
                                <div className="h-7 w-7 rounded bg-zinc-800/50 flex items-center justify-center text-xs font-mono text-zinc-500">
                                  {i + 1}
                                </div>
                                <div>
                                  <p className="text-sm font-medium text-zinc-200">{exercise.name}</p>
                                  <p className="text-xs text-zinc-500">{exercise.sets} &times; {exercise.reps}</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Desktop: Full expanded cards */}
                <motion.div
                  className="hidden lg:block"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.08 }}
                >
                  <Card className={cn(
                    "bg-white/[0.03] backdrop-blur-xl border border-white/[0.08]",
                    "shadow-[0_4px_24px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.05)]",
                    "hover:border-white/[0.12] transition-all overflow-hidden"
                  )}>
                    <CardHeader className="pb-3 pt-4 px-5 border-b border-white/5">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-bold uppercase tracking-wider text-zinc-500">{workout.day}</span>
                        <span className="w-1 h-1 rounded-full bg-zinc-700" />
                        <span className="text-xs text-zinc-500 flex items-center gap-1">
                          <Clock className="w-3 h-3" /> {workout.duration}
                        </span>
                      </div>
                      <CardTitle className="text-lg font-medium text-white">{workout.focus}</CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                      <div className="divide-y divide-white/5">
                        {(workout.exercises || []).map((exercise: any, i: number) => (
                          <div key={i} className="flex items-center justify-between p-4 px-5 transition-colors group/exercise">
                            <div className="flex items-center gap-4">
                              <div className="h-8 w-8 rounded bg-zinc-800/50 flex items-center justify-center text-xs font-mono text-zinc-500 group-hover/exercise:bg-zinc-800 group-hover/exercise:text-white transition-colors">
                                {i + 1}
                              </div>
                              <div>
                                <p className="text-sm font-medium text-zinc-200 group-hover/exercise:text-white">{exercise.name}</p>
                                <p className="text-xs text-zinc-500">{exercise.sets} sets &times; {exercise.reps}</p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Sticky bottom action area */}
      <div className="fixed bottom-0 inset-x-0 z-20">
        <div className="bg-gradient-to-t from-black via-black/95 to-transparent pt-8 pb-6 px-4 sm:px-6">
          <div className="max-w-2xl mx-auto space-y-3">
            {/* Request changes UI */}
            <AnimatePresence>
              {showChanges && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ type: "spring", damping: 25, stiffness: 300 }}
                  className="overflow-hidden"
                >
                  <div className="flex gap-2 mb-3">
                    <input
                      type="text"
                      value={changeText}
                      onChange={(e) => setChangeText(e.target.value)}
                      placeholder="What would you like changed?"
                      className="flex-1 px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSendChanges();
                      }}
                    />
                    <button
                      onClick={handleSendChanges}
                      disabled={!changeText.trim()}
                      className="px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-sm text-zinc-300 hover:bg-white/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Send
                    </button>
                  </div>
                  {/* Desktop fallback for SMS */}
                  <p className="text-xs text-zinc-600 text-center hidden sm:block">
                    Or text <span className="text-zinc-400 font-mono">(628) 997-8087</span> directly
                  </p>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Action buttons */}
            <div className="flex gap-3">
              <button
                onClick={() => setShowChanges(!showChanges)}
                className="flex-1 flex items-center justify-center gap-2 px-5 py-3.5 rounded-xl bg-white/5 border border-white/10 text-sm font-medium text-zinc-300 hover:bg-white/10 transition-colors"
              >
                <MessageSquare className="w-4 h-4" />
                Request Changes
              </button>
              <button
                onClick={handleAccept}
                disabled={accepting}
                className={cn(
                  "flex-1 flex items-center justify-center gap-2 px-5 py-3.5 rounded-xl text-sm font-semibold transition-all",
                  "bg-emerald-600 hover:bg-emerald-500 text-white",
                  "shadow-[0_0_20px_rgba(16,185,129,0.3)]",
                  accepting && "opacity-60 cursor-not-allowed"
                )}
              >
                {accepting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Check className="w-4 h-4" />
                )}
                {accepting ? "Activating..." : "Accept Plan"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
