import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, CheckCircle2, Loader2, Sparkles, Clock, ChevronRight, ChevronDown, ChevronUp, AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { aiApi, signupProgressApi, type GeneratedPlan, type PlanConversationMessage, AIApiError } from "@/lib/api";
import { trackEvent, trackPlanGenerationError, trackApiError } from "@/lib/posthog";

type Message = {
  id: string;
  sender: "ai" | "user";
  text: string;
};

type Exercise = {
  name: string;
  sets: number;
  reps: string;
  details?: string[];
};

type MobilityExercise = {
  name: string;
  duration: string;
};

type WorkoutDay = {
  day: string;
  focus: string;
  duration: string;
  exercises: Exercise[];
  mobility?: MobilityExercise[];
};

// Typewriter text effect for loading state
function TypewriterText({ text, className }: { text: string; className?: string }) {
  const [displayedText, setDisplayedText] = useState("");

  useEffect(() => {
    let index = 0;
    const interval = setInterval(() => {
      if (index < text.length) {
        setDisplayedText(text.slice(0, index + 1));
        index++;
      } else {
        clearInterval(interval);
      }
    }, 30);
    return () => clearInterval(interval);
  }, [text]);

  return (
    <p className={className}>
      {displayedText}
      <span className="animate-pulse text-emerald-500">|</span>
    </p>
  );
}

// Skeleton line with shimmer effect for loading state
function SkeletonLine({ width, className }: { width: string; className?: string }) {
  return (
    <div className={cn(
      "h-4 bg-zinc-800 rounded overflow-hidden relative",
      width,
      className
    )}>
      <motion.div
        animate={{ x: ["-100%", "100%"] }}
        transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
        className="absolute inset-0 bg-gradient-to-r from-transparent via-zinc-700/50 to-transparent"
      />
    </div>
  );
}

interface PlanGenerationViewProps {
  userId: string;
  /** If provided, restored from draft. Otherwise generates fresh. */
  initialPlan?: GeneratedPlan | null;
  initialMessages?: PlanConversationMessage[];
  /** Called when user clicks "Finish" */
  onFinalize: (plan: GeneratedPlan, messages: PlanConversationMessage[]) => void;
  /** Whether the finalize action is in progress */
  isFinalizing?: boolean;
  /** Label for the finish button */
  finalizeLabel?: string;
}

export function PlanGenerationView({
  userId,
  initialPlan,
  initialMessages,
  onFinalize,
  isFinalizing = false,
  finalizeLabel = "Finish & Start",
}: PlanGenerationViewProps) {
  const [state, setState] = useState<"generating" | "review" | "error">(
    initialPlan ? "review" : "generating"
  );
  const [messages, setMessages] = useState<Message[]>(
    initialMessages?.map(m => ({ id: m.id, sender: m.sender, text: m.text })) || []
  );
  const [inputValue, setInputValue] = useState("");
  const [plan, setPlan] = useState<WorkoutDay[]>(initialPlan?.workouts || []);
  const [generatedPlan, setGeneratedPlan] = useState<GeneratedPlan | null>(initialPlan || null);
  const [isSending, setIsSending] = useState(false);
  const [expandedExercises, setExpandedExercises] = useState<Set<string>>(new Set());
  const [errorMessage, setErrorMessage] = useState("");
  const [isRetryable, setIsRetryable] = useState(true);
  const [restoredFromDraft, setRestoredFromDraft] = useState(!!initialPlan);
  const [changedIndices, setChangedIndices] = useState<Set<number>>(new Set());
  const [showChangePill, setShowChangePill] = useState(false);
  const [changeCount, setChangeCount] = useState(0);
  const [showRipple, setShowRipple] = useState(false);
  const [isChatExpanded, setIsChatExpanded] = useState(false);
  const [expandedDays, setExpandedDays] = useState<Set<number>>(new Set());

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const finalizingRef = useRef(false);

  const toggleDayExpanded = (index: number) => {
    setExpandedDays(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const toggleExpanded = (key: string) => {
    setExpandedExercises(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const detectChangedWorkouts = (oldPlan: WorkoutDay[], newPlan: WorkoutDay[]): number[] => {
    const changed: number[] = [];
    if (oldPlan.length !== newPlan.length) return newPlan.map((_, i) => i);
    for (let i = 0; i < newPlan.length; i++) {
      if (JSON.stringify(oldPlan[i]) !== JSON.stringify(newPlan[i])) changed.push(i);
    }
    return changed;
  };

  const generatePlanAsync = async () => {
    setState("generating");
    setErrorMessage("");

    try {
      const { plan: aiPlan, coachNotes } = await aiApi.generatePlan();
      const defaultMessage = "I've analyzed your profile and created a personalized workout plan based on your goals, experience, and available equipment. You can review it on the left, or ask me to make any changes.";
      const welcomeMessage: Message = {
        id: "welcome",
        sender: "ai",
        text: coachNotes || defaultMessage,
      };

      setGeneratedPlan(aiPlan);
      setPlan(aiPlan.workouts);
      setMessages([welcomeMessage]);
      setState("review");
      trackEvent('plan_generated', { workout_count: aiPlan.workouts.length });

      // Save draft immediately
      const welcomeMessages: PlanConversationMessage[] = [{
        id: welcomeMessage.id,
        sender: welcomeMessage.sender,
        text: welcomeMessage.text,
        timestamp: new Date().toISOString(),
      }];

      try {
        await signupProgressApi.saveDraftPlan({
          plan: aiPlan,
          messages: welcomeMessages,
          updatedAt: new Date().toISOString(),
        });
      } catch (saveError) {
        console.error("Failed to save initial draft to server:", saveError);
      }
    } catch (error) {
      console.error("Error generating plan:", error);
      trackPlanGenerationError(error);

      if (error instanceof AIApiError) {
        setErrorMessage(error.message);
        setIsRetryable(error.retryable);
      } else {
        setErrorMessage(error instanceof Error ? error.message : "Failed to generate workout plan");
        setIsRetryable(true);
      }
      setState("error");
    }
  };

  // Generate plan on mount if no initial plan
  useEffect(() => {
    if (!initialPlan && userId) {
      generatePlanAsync();
    }
  }, [userId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-save draft plan
  useEffect(() => {
    if (state !== "review" || !generatedPlan || finalizingRef.current || messages.length === 0) return;

    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);

    saveTimeoutRef.current = setTimeout(async () => {
      if (finalizingRef.current) return;
      try {
        const messagesForDraft: PlanConversationMessage[] = messages.map(m => ({
          id: m.id,
          sender: m.sender,
          text: m.text,
          timestamp: new Date().toISOString(),
        }));
        await signupProgressApi.saveDraftPlan({
          plan: generatedPlan,
          messages: messagesForDraft,
          updatedAt: new Date().toISOString(),
        });
      } catch (error) {
        console.error("Failed to auto-save draft:", error);
      }
    }, 1000);

    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [messages, generatedPlan, state]);

  // Retry pending user message from restored draft
  useEffect(() => {
    if (!restoredFromDraft || !generatedPlan || isSending || state !== "review") return;
    if (messages.length === 0) return;

    const lastMessage = messages[messages.length - 1];
    if (lastMessage.sender !== "user") return;

    const retryPendingMessage = async () => {
      setIsSending(true);
      try {
        const historyForAI = messages.slice(1, -1).map(m => ({ sender: m.sender, text: m.text }));
        const result = await aiApi.chat(lastMessage.text, generatedPlan, historyForAI);
        const aiResponse: Message = { id: (Date.now() + 1).toString(), sender: "ai", text: result.response };
        setMessages(prev => [...prev, aiResponse]);

        if (result.updatedPlan) {
          const changed = detectChangedWorkouts(plan, result.updatedPlan.workouts);
          if (changed.length > 0) {
            setChangeCount(changed.length);
            setShowRipple(true);
            setTimeout(() => setShowChangePill(true), 350);
            setTimeout(() => setChangedIndices(new Set(changed)), 400);
            setTimeout(() => setShowRipple(false), 600);
            setTimeout(() => { setShowChangePill(false); setChangedIndices(new Set()); }, 5000);
          }
          setGeneratedPlan(result.updatedPlan);
          setPlan(result.updatedPlan.workouts);
        }
      } catch (error) {
        const errorText = error instanceof AIApiError ? error.message : "I'm having trouble processing that. Could you try again?";
        setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), sender: "ai", text: errorText }]);
      } finally {
        setIsSending(false);
        setRestoredFromDraft(false);
      }
    };

    retryPendingMessage();
  }, [restoredFromDraft, generatedPlan, state]);

  const handleSend = async () => {
    if (!inputValue.trim() || !userId || !generatedPlan || isSending) return;

    const userMsg: Message = { id: Date.now().toString(), sender: "user", text: inputValue };
    const updatedMessages = [...messages, userMsg];

    setMessages(updatedMessages);
    setInputValue("");
    setIsSending(true);
    trackEvent('ai_chat_message_sent', { message_length: inputValue.length });

    // Save immediately
    const messagesForDraft: PlanConversationMessage[] = updatedMessages.map(m => ({
      id: m.id, sender: m.sender, text: m.text, timestamp: new Date().toISOString(),
    }));
    signupProgressApi.saveDraftPlan({
      plan: generatedPlan,
      messages: messagesForDraft,
      updatedAt: new Date().toISOString(),
    }).catch(err => console.error("Failed to save message to server:", err));

    try {
      const historyForAI = messages.slice(1).map(m => ({ sender: m.sender, text: m.text }));
      const result = await aiApi.chat(inputValue, generatedPlan, historyForAI);
      const aiResponse: Message = { id: (Date.now() + 1).toString(), sender: "ai", text: result.response };
      setMessages(prev => [...prev, aiResponse]);

      if (result.updatedPlan) {
        const oldPlan = plan;
        const newPlan = result.updatedPlan.workouts;
        const changed = detectChangedWorkouts(oldPlan, newPlan);
        trackEvent('plan_modified', { workouts_changed: changed.length });

        if (changed.length > 0) {
          setChangeCount(changed.length);
          setShowRipple(true);
          setTimeout(() => setShowChangePill(true), 350);
          setTimeout(() => setChangedIndices(new Set(changed)), 400);
          setTimeout(() => setShowRipple(false), 600);
          setTimeout(() => { setShowChangePill(false); setChangedIndices(new Set()); }, 5000);
        }

        setGeneratedPlan(result.updatedPlan);
        setPlan(newPlan);
      }
    } catch (error) {
      console.error("Error in chat:", error);
      trackPlanGenerationError(error);
      const errorText = error instanceof AIApiError ? error.message : "I'm having trouble processing that. Could you try again?";
      setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), sender: "ai", text: errorText }]);
    } finally {
      setIsSending(false);
    }
  };

  const handleFinalize = () => {
    if (!generatedPlan) return;
    finalizingRef.current = true;
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    const messagesForArchive: PlanConversationMessage[] = messages.map(m => ({
      id: m.id, sender: m.sender, text: m.text, timestamp: new Date().toISOString(),
    }));
    onFinalize(generatedPlan, messagesForArchive);
  };

  // --- GENERATING STATE ---
  if (state === "generating") {
    return (
      <div className="min-h-screen bg-black text-white font-sans flex flex-col h-screen overflow-hidden">
        <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
          <div className="flex-1 lg:flex-[2] overflow-y-auto p-4 lg:p-8 pb-32 lg:pb-8 lg:border-r border-white/10 bg-zinc-950/30">
            <div className="max-w-3xl mx-auto space-y-5 lg:space-y-6">
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="flex items-center gap-3">
                <div className="w-1.5 h-8 bg-emerald-500 rounded-full shadow-[0_0_12px_rgba(16,185,129,0.3)]" />
                <h2 className="text-xl sm:text-2xl font-heading text-white font-bold tracking-tight">Building Your Plan</h2>
              </motion.div>
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.15 }} className="min-h-[20px]">
                <TypewriterText text="Brandon is analyzing your profile and designing a personalized program..." className="text-zinc-400 text-sm" />
              </motion.div>

              {/* Mobile skeleton pills */}
              <div className="lg:hidden space-y-3">
                {[0, 1, 2].map((index) => (
                  <motion.div key={index} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.2 + index * 0.15 }}
                    className={cn("flex items-center justify-between p-4 rounded-2xl", "bg-white/[0.03] backdrop-blur-xl border border-white/[0.08]", "shadow-[0_4px_24px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.05)]")}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-11 h-11 rounded-xl bg-emerald-500/[0.12] border border-emerald-500/20 flex items-center justify-center overflow-hidden relative">
                        <div className="w-6 h-3 rounded bg-emerald-500/30" />
                        <motion.div animate={{ x: ["-100%", "100%"] }} transition={{ duration: 2, repeat: Infinity, ease: "linear" }} className="absolute inset-0 bg-gradient-to-r from-transparent via-emerald-500/[0.15] to-transparent" />
                      </div>
                      <div className="space-y-1.5">
                        <SkeletonLine width="w-28" className="h-3.5" />
                        <SkeletonLine width="w-20" className="h-2.5" />
                      </div>
                    </div>
                    <div className="w-5 h-5 rounded bg-zinc-800/50" />
                  </motion.div>
                ))}
              </div>

              {/* Desktop card skeletons */}
              <div className="hidden lg:grid gap-6">
                {[0, 1, 2].map((index) => (
                  <motion.div key={index} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 + index * 0.15 }} className="glass-card overflow-hidden">
                    <div className="pb-3 pt-4 px-5 border-b border-white/5">
                      <div className="flex items-center gap-2 mb-2">
                        <SkeletonLine width="w-16" className="h-3" />
                        <span className="w-1 h-1 rounded-full bg-zinc-700" />
                        <SkeletonLine width="w-12" className="h-3" />
                      </div>
                      <SkeletonLine width="w-48" className="h-5" />
                    </div>
                    <div className="divide-y divide-white/5">
                      {[0, 1, 2, 3].map((i) => (
                        <motion.div key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 + index * 0.15 + i * 0.08 + 0.3 }} className="flex items-center justify-between p-4 px-5">
                          <div className="flex items-center gap-4">
                            <div className="h-8 w-8 rounded bg-zinc-800/50" />
                            <div className="space-y-1">
                              <SkeletonLine width="w-32" className="h-4" />
                              <SkeletonLine width="w-20" className="h-3" />
                            </div>
                          </div>
                          <SkeletonLine width="w-6" className="h-4" />
                        </motion.div>
                      ))}
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          </div>

          {/* Desktop chat skeleton sidebar */}
          <div className="hidden lg:flex flex-1 flex-col bg-zinc-950 border-l border-white/10">
            <div className="p-4 border-b border-white/10 bg-zinc-900/50">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className="w-9 h-9 rounded-full bg-emerald-500 flex items-center justify-center shadow-lg shadow-emerald-500/20">
                    <span className="text-black font-black text-sm tracking-tight">B</span>
                  </div>
                  <motion.div animate={{ scale: [1, 1.2, 1] }} transition={{ duration: 2, repeat: Infinity }} className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-400 rounded-full border-2 border-zinc-950" />
                </div>
                <div>
                  <h3 className="text-sm font-medium text-white">Brandon</h3>
                  <div className="flex items-center gap-1.5">
                    <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.5, repeat: Infinity }} className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    <span className="text-xs text-zinc-500">Writing your plan...</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 flex items-end">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }} className="flex justify-start w-full">
                <div className="max-w-[90%] rounded-2xl px-4 py-3 bg-zinc-900 border border-zinc-800">
                  <div className="flex items-center gap-3">
                    <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center"><span className="text-black font-black text-[10px]">B</span></div>
                    <div className="flex items-center gap-0.5">
                      {[0, 1, 2, 3, 4].map((i) => (
                        <motion.div key={i} animate={{ height: [8, 8 + (i === 2 ? 8 : i === 1 || i === 3 ? 4 : 0), 8] }}
                          transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.1 }} className="w-1 bg-emerald-500 rounded-full" style={{ height: '8px' }} />
                      ))}
                    </div>
                  </div>
                </div>
              </motion.div>
            </div>
            <div className="p-4 bg-black border-t border-white/10">
              <div className="relative">
                <div className="h-12 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center px-4"><span className="text-zinc-600 text-sm">Message Brandon...</span></div>
                <div className="absolute right-1 top-1 h-10 w-10 rounded-lg bg-zinc-800" />
              </div>
            </div>
          </div>
        </div>

        {/* Mobile floating dock skeleton */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.6 }} className="lg:hidden fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
          <div className={cn("flex items-center gap-2 p-1.5 rounded-full", "bg-white/[0.04] backdrop-blur-2xl border border-white/[0.08]", "shadow-[0_8px_32px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.05)]")}>
            <div className="flex items-center gap-2 pl-1 pr-3 py-1">
              <div className="relative">
                <div className="w-9 h-9 rounded-full bg-emerald-500 flex items-center justify-center shadow-lg shadow-emerald-500/30"><span className="text-black font-bold text-sm">B</span></div>
                <motion.div animate={{ scale: [1, 1.2, 1], opacity: [1, 0.6, 1] }} transition={{ duration: 2, repeat: Infinity }}
                  className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-400 rounded-full border-2 border-black shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-[11px] text-zinc-500">Brandon</span>
                <div className="flex items-center gap-1">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <motion.div key={i} animate={{ height: [4, 4 + (i === 2 ? 8 : i === 1 || i === 3 ? 4 : 0), 4] }}
                      transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.1 }} className="w-[3px] bg-emerald-500 rounded-full" style={{ height: '4px' }} />
                  ))}
                </div>
              </div>
            </div>
            <div className="w-px h-6 bg-white/10" />
            <div className="h-9 w-20 rounded-full bg-zinc-800/80 relative overflow-hidden">
              <motion.div animate={{ x: ["-100%", "100%"] }} transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                className="absolute inset-0 bg-gradient-to-r from-transparent via-zinc-700/30 to-transparent" />
            </div>
          </div>
        </motion.div>
      </div>
    );
  }

  // --- ERROR STATE ---
  if (state === "error") {
    return (
      <div className="min-h-screen bg-black flex flex-col relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-red-900/10 via-black to-black pointer-events-none" />
        <div className="flex-1 flex flex-col items-center justify-center p-4 relative z-10">
          <div className="text-center z-10 space-y-6 max-w-md">
            <div className="w-20 h-20 bg-red-950/50 border border-red-900/50 rounded-full flex items-center justify-center mx-auto">
              <AlertCircle className="h-10 w-10 text-red-500" />
            </div>
            <div className="space-y-3">
              <h2 className="text-2xl font-heading text-white font-medium">Something went wrong</h2>
              <p className="text-zinc-400 text-sm leading-relaxed">{errorMessage}</p>
            </div>
            {isRetryable && (
              <Button onClick={() => generatePlanAsync()} className="bg-white text-black hover:bg-zinc-200 font-medium px-6 h-12 rounded-lg">
                <RefreshCw className="h-4 w-4 mr-2" /> Try Again
              </Button>
            )}
            {!isRetryable && <p className="text-zinc-500 text-sm">Please wait a moment and refresh the page to try again.</p>}
          </div>
        </div>
      </div>
    );
  }

  // --- REVIEW STATE ---
  return (
    <div className="min-h-screen bg-black text-white font-sans flex flex-col h-screen overflow-hidden">
      {/* Ripple Wave Effect */}
      <AnimatePresence>
        {showRipple && (
          <motion.div initial={{ x: "100%" }} animate={{ x: "-100%" }} exit={{ opacity: 0 }} transition={{ duration: 0.5, ease: "easeOut" }}
            className="fixed inset-0 z-40 pointer-events-none"
            style={{ background: "linear-gradient(90deg, transparent 0%, rgba(16,185,129,0.08) 40%, rgba(16,185,129,0.15) 50%, rgba(16,185,129,0.08) 60%, transparent 100%)", filter: "blur(20px)" }} />
        )}
      </AnimatePresence>

      {/* Change Pill */}
      <AnimatePresence>
        {showChangePill && (
          <motion.div initial={{ opacity: 0, y: -20, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 300, damping: 25 }} className="fixed top-20 left-1/2 lg:left-1/3 -translate-x-1/2 z-50">
            <div className="bg-emerald-500/90 backdrop-blur-md text-black px-4 py-2 rounded-full shadow-lg shadow-emerald-500/30 flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-black animate-pulse" />
              <span className="text-sm font-bold">{changeCount} {changeCount === 1 ? 'workout' : 'workouts'} updated</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content Grid */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden pb-[84px]">
        {/* Plan Area */}
        <div className="flex-1 lg:flex-[2] overflow-y-auto p-4 lg:p-8 pb-44 lg:pb-8 border-r border-white/10 bg-zinc-950/30">
          <div className="max-w-3xl mx-auto space-y-6">
            <div className="flex items-center gap-3">
              <div className="w-1.5 h-8 bg-emerald-500 rounded-full" />
              <h2 className="text-xl sm:text-2xl font-heading text-white font-bold tracking-tight">Your Training Plan</h2>
            </div>

            <div className="grid gap-4 lg:gap-6">
              {plan.map((workout, index) => {
                const isChanged = changedIndices.has(index);
                const isDayExpanded = expandedDays.has(index);
                return (
                  <div key={workout.day + workout.focus}>
                    {/* Mobile: Collapsed Glass Pill */}
                    <div className="lg:hidden">
                      <motion.button onClick={() => toggleDayExpanded(index)} initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0, scale: isChanged ? [1, 0.96, 1] : 1 }}
                        transition={{ delay: index * 0.1, scale: isChanged ? { duration: 0.4, times: [0, 0.3, 1], ease: "easeOut" } : undefined }}
                        className={cn("w-full rounded-2xl overflow-hidden transition-all text-left",
                          "bg-white/[0.03] backdrop-blur-xl border border-white/[0.08]",
                          "shadow-[0_4px_24px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.05)]",
                          "hover:bg-white/[0.05] hover:border-white/[0.12]", "active:scale-[0.98]",
                          isChanged && "border-l-2 border-l-emerald-500 shadow-[inset_4px_0_12px_-4px_rgba(16,185,129,0.3)]"
                        )}>
                        <div className="flex items-center justify-between p-4">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center">
                              <span className="text-xs font-bold text-emerald-400 uppercase">{workout.day.slice(0, 3)}</span>
                            </div>
                            <div className="text-left">
                              <p className="text-sm font-medium text-white">{workout.focus}</p>
                              <p className="text-xs text-zinc-500 flex items-center gap-1.5">
                                <Clock className="w-3 h-3" /> {workout.duration} • {workout.exercises.length > 0 ? `${workout.exercises.length} exercises` : workout.mobility?.length ? `${workout.mobility.length} movements` : '0 exercises'}
                              </p>
                            </div>
                          </div>
                          <ChevronDown className={cn("w-5 h-5 text-zinc-500 transition-transform", isDayExpanded && "rotate-180")} />
                        </div>
                      </motion.button>

                      <AnimatePresence>
                        {isDayExpanded && (
                          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                            transition={{ type: "spring", damping: 25, stiffness: 300 }} className="overflow-hidden">
                            <div className={cn("mt-2 rounded-2xl overflow-hidden", "bg-white/[0.02] backdrop-blur-xl border border-white/[0.06]", "shadow-[0_4px_24px_rgba(0,0,0,0.2)]")}>
                              <div className="divide-y divide-white/5">
                                {workout.exercises.length > 0 ? workout.exercises.map((exercise, i) => (
                                  <div key={i} className="flex items-center gap-3 p-3 px-4">
                                    <div className="h-7 w-7 rounded bg-zinc-800/50 flex items-center justify-center text-xs font-mono text-zinc-500">{i + 1}</div>
                                    <div>
                                      <p className="text-sm font-medium text-zinc-200">{exercise.name}</p>
                                      <p className="text-xs text-zinc-500">{exercise.sets} × {exercise.reps}</p>
                                    </div>
                                  </div>
                                )) : workout.mobility?.length ? workout.mobility.map((movement, i) => (
                                  <div key={i} className="flex items-center gap-3 p-3 px-4">
                                    <div className="h-7 w-7 rounded bg-zinc-800/50 flex items-center justify-center text-xs font-mono text-zinc-500">{i + 1}</div>
                                    <div>
                                      <p className="text-sm font-medium text-zinc-200">{movement.name}</p>
                                      <p className="text-xs text-zinc-500">{movement.duration}</p>
                                    </div>
                                  </div>
                                )) : null}
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>

                    {/* Desktop: Full Expanded Cards */}
                    <motion.div className="hidden lg:block" initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0, scale: isChanged ? [1, 0.96, 1] : 1 }}
                      transition={{ delay: index * 0.1, scale: isChanged ? { duration: 0.4, times: [0, 0.3, 1], ease: "easeOut" } : undefined }}>
                      <Card className={cn("glass-card hover:border-white/15 transition-all overflow-hidden group",
                        isChanged && "border-l-2 border-l-emerald-500 shadow-[inset_4px_0_12px_-4px_rgba(16,185,129,0.3)]")}>
                        <CardHeader className="pb-3 pt-4 px-5 border-b border-white/5">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-bold uppercase tracking-wider text-zinc-500">{workout.day}</span>
                            <span className="w-1 h-1 rounded-full bg-zinc-700" />
                            <span className="text-xs text-zinc-500 flex items-center gap-1"><Clock className="w-3 h-3" /> {workout.duration}</span>
                          </div>
                          <CardTitle className="text-lg font-medium text-white">{workout.focus}</CardTitle>
                        </CardHeader>
                        <CardContent className="p-0">
                          {workout.exercises.length > 0 ? (
                            <div className="divide-y divide-white/5">
                              {workout.exercises.map((exercise, i) => {
                                const exerciseKey = `${index}-main-${i}`;
                                const hasDetails = exercise.details && exercise.details.length > 0;
                                const isExpandable = hasDetails;
                                const isExpanded = expandedExercises.has(exerciseKey);

                                return (
                                  <div key={i}>
                                    <div onClick={() => isExpandable && toggleExpanded(exerciseKey)}
                                      className={cn("flex items-center justify-between p-4 px-5 transition-colors group/exercise", isExpandable && "cursor-pointer hover:bg-white/5")}>
                                      <div className="flex items-center gap-4">
                                        <div className="h-8 w-8 rounded bg-zinc-800/50 flex items-center justify-center text-xs font-mono text-zinc-500 group-hover/exercise:bg-zinc-800 group-hover/exercise:text-white transition-colors">{i + 1}</div>
                                        <div>
                                          <p className="text-sm font-medium text-zinc-200 group-hover/exercise:text-white">{exercise.name}</p>
                                          <p className="text-xs text-zinc-500">{exercise.sets} sets × {exercise.reps}</p>
                                        </div>
                                      </div>
                                      {isExpandable && (isExpanded ? <ChevronDown className="w-4 h-4 text-zinc-500 group-hover/exercise:text-zinc-400" /> : <ChevronRight className="w-4 h-4 text-zinc-700 group-hover/exercise:text-zinc-500" />)}
                                    </div>
                                    <AnimatePresence>
                                      {isExpanded && isExpandable && (
                                        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
                                          <div className="px-5 pb-4 pl-16 space-y-2">
                                            {exercise.details!.map((detail, j) => (
                                              <div key={j} className="flex items-center gap-2 text-xs text-zinc-400">
                                                <span className="w-1 h-1 rounded-full bg-zinc-500" /> {detail}
                                              </div>
                                            ))}
                                          </div>
                                        </motion.div>
                                      )}
                                    </AnimatePresence>
                                  </div>
                                );
                              })}
                            </div>
                          ) : workout.mobility?.length ? (
                            <div className="divide-y divide-white/5">
                              {workout.mobility.map((movement, i) => (
                                <div key={i} className="flex items-center justify-between p-4 px-5 transition-colors group/exercise">
                                  <div className="flex items-center gap-4">
                                    <div className="h-8 w-8 rounded bg-zinc-800/50 flex items-center justify-center text-xs font-mono text-zinc-500">{i + 1}</div>
                                    <div>
                                      <p className="text-sm font-medium text-zinc-200">{movement.name}</p>
                                      <p className="text-xs text-zinc-500">{movement.duration}</p>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </CardContent>
                      </Card>
                    </motion.div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Desktop Chat Sidebar */}
        <div className="hidden lg:flex flex-1 flex-col bg-zinc-950 border-l border-white/10">
          <div className="p-4 border-b border-white/10 bg-zinc-900/50 shrink-0">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="w-9 h-9 rounded-full bg-emerald-500 flex items-center justify-center shadow-lg shadow-emerald-500/20"><span className="text-black font-black text-sm tracking-tight">B</span></div>
                <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-400 rounded-full border-2 border-zinc-950" />
              </div>
              <div>
                <h3 className="text-sm font-medium text-white">Brandon</h3>
                <p className="text-xs text-zinc-500">Ask to adjust your plan</p>
              </div>
            </div>
          </div>

          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.map((msg) => (
                <motion.div key={msg.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className={`flex ${msg.sender === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={cn("max-w-[90%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm", msg.sender === "user" ? "bg-white text-black" : "bg-zinc-900 text-zinc-300")}>{msg.text}</div>
                </motion.div>
              ))}
              {isSending && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex justify-start">
                  <div className="bg-zinc-900 rounded-2xl px-4 py-3 flex items-center gap-3">
                    <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center"><span className="text-black font-black text-[10px]">B</span></div>
                    <div className="flex items-center gap-0.5">
                      {[0, 1, 2, 3, 4].map((i) => (
                        <div key={i} className="w-1 bg-emerald-500 rounded-full animate-pulse"
                          style={{ height: `${8 + (i === 2 ? 8 : i === 1 || i === 3 ? 4 : 0)}px`, animationDelay: `${i * 0.1}s`, animationDuration: '0.8s' }} />
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}
              <div ref={messagesEndRef} />
            </div>

            <div className="p-4 bg-black border-t border-white/10 shrink-0">
              {messages.filter(m => m.sender === "user").length === 0 && !isSending && (
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {["Add another workout day", "Make my workouts shorter", "Add more core work", "Swap an exercise", "Change my split", "Add a warm-up routine"].map((suggestion) => (
                    <button key={suggestion} onClick={() => setInputValue(suggestion)}
                      className="px-3 py-1.5 text-xs text-zinc-400 rounded-full border border-zinc-800 bg-zinc-900/50 hover:bg-zinc-800 hover:text-zinc-200 hover:border-zinc-700 transition-all cursor-pointer">{suggestion}</button>
                  ))}
                </div>
              )}
              <div className="relative">
                <Input value={inputValue} onChange={(e) => setInputValue(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleSend()}
                  placeholder="Message Brandon..." className="h-12 pl-4 pr-12 rounded-xl bg-zinc-900 border-zinc-800 text-white placeholder:text-zinc-600 focus:border-zinc-700 focus:bg-zinc-900" />
                <Button onClick={handleSend} disabled={!inputValue.trim() || isSending}
                  className="absolute right-1 top-1 h-10 w-10 rounded-lg bg-emerald-500 text-black hover:bg-emerald-400 p-0 flex items-center justify-center transition-all shadow-lg shadow-emerald-500/25">
                  {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile Floating Bottom Zone */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 z-50 p-4 pb-6 flex justify-center">
        <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
          className={cn("rounded-full flex items-center p-1.5 gap-2", "bg-white/[0.04] backdrop-blur-2xl border border-white/[0.08]", "shadow-[0_8px_32px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.05)]")}>
          <button onClick={() => setIsChatExpanded(true)} className="relative group flex items-center gap-2 pl-1 pr-3 py-1 rounded-full hover:bg-white/10 transition-colors">
            <div className="relative">
              <div className="w-9 h-9 rounded-full bg-emerald-500 flex items-center justify-center group-hover:scale-105 transition-transform shadow-lg shadow-emerald-500/30"><span className="text-black font-bold text-sm">B</span></div>
              <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-400 rounded-full border-2 border-zinc-950" />
            </div>
            <span className="text-zinc-400 text-sm group-hover:text-white transition-colors">Edit plan</span>
            <ChevronUp className="w-3.5 h-3.5 text-zinc-600 group-hover:text-zinc-400" />
          </button>
          <div className="w-px h-6 bg-white/10" />
          <Button data-testid="button-finalize" onClick={handleFinalize} disabled={isFinalizing}
            className={cn("h-9 px-5 rounded-full font-semibold text-sm", "bg-emerald-500 hover:bg-emerald-400 text-black",
              "shadow-[0_0_20px_rgba(16,185,129,0.3),0_4px_16px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.1)]", "transition-all active:scale-95")}>
            <span className="flex items-center gap-1.5">
              {isFinalizing ? <Loader2 className="w-4 h-4 animate-spin" /> : <>{finalizeLabel} <CheckCircle2 className="w-4 h-4" /></>}
            </span>
          </Button>
        </motion.div>
      </div>

      {/* Expanded Chat Sheet Overlay - Mobile */}
      <AnimatePresence>
        {isChatExpanded && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsChatExpanded(false)} className="lg:hidden fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm" />
            <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ type: "spring", damping: 30, stiffness: 300 }}
              className={cn("lg:hidden fixed bottom-0 left-0 right-0 z-[70] h-[70vh]", "rounded-t-3xl overflow-hidden flex flex-col", "bg-zinc-950/95 backdrop-blur-2xl border-t border-white/[0.1]", "shadow-[0_-8px_40px_rgba(0,0,0,0.5)]")}>
              <div className="flex justify-center pt-3 pb-2"><div className="w-12 h-1 rounded-full bg-white/20" /></div>
              <div className="px-4 pb-3 border-b border-white/[0.08]">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-emerald-500 flex items-center justify-center"><span className="text-black font-black text-sm">B</span></div>
                  <div><h3 className="text-sm font-medium text-white">Brandon</h3><p className="text-xs text-zinc-500">Adjust your workout plan</p></div>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {messages.map((msg) => (
                  <motion.div key={msg.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className={`flex ${msg.sender === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={cn("max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed", msg.sender === "user" ? "bg-white text-black" : "bg-zinc-900 text-zinc-300 border border-white/5")}>{msg.text}</div>
                  </motion.div>
                ))}
                {isSending && (
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex justify-start">
                    <div className="bg-zinc-900 rounded-2xl px-4 py-3 flex items-center gap-3 border border-white/5">
                      <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center"><span className="text-black font-black text-[10px]">B</span></div>
                      <div className="flex items-center gap-0.5">
                        {[0, 1, 2, 3, 4].map((i) => (
                          <div key={i} className="w-1 bg-emerald-500 rounded-full animate-pulse"
                            style={{ height: `${8 + (i === 2 ? 8 : i === 1 || i === 3 ? 4 : 0)}px`, animationDelay: `${i * 0.1}s`, animationDuration: '0.8s' }} />
                        ))}
                      </div>
                    </div>
                  </motion.div>
                )}
                <div ref={messagesEndRef} />
              </div>
              <div className="p-4 border-t border-white/[0.08] bg-black/40">
                {messages.filter(m => m.sender === "user").length === 0 && !isSending && (
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {["Add another workout day", "Make my workouts shorter", "Add more core work", "Swap an exercise", "Change my split", "Add a warm-up routine"].map((suggestion) => (
                      <button key={suggestion} onClick={() => setInputValue(suggestion)}
                        className="px-3 py-1.5 text-xs text-zinc-400 rounded-full border border-zinc-800 bg-zinc-900/50 hover:bg-zinc-800 hover:text-zinc-200 hover:border-zinc-700 transition-all cursor-pointer">{suggestion}</button>
                    ))}
                  </div>
                )}
                <div className="relative">
                  <Input value={inputValue} onChange={(e) => setInputValue(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleSend()}
                    placeholder="Message Brandon..." className="h-12 pl-4 pr-12 rounded-xl bg-zinc-900 border-zinc-800 text-white placeholder:text-zinc-600 focus:border-zinc-700 focus:bg-zinc-900" />
                  <Button onClick={handleSend} disabled={!inputValue.trim() || isSending}
                    className="absolute right-1 top-1 h-10 w-10 rounded-lg bg-emerald-500 text-black hover:bg-emerald-400 p-0 flex items-center justify-center transition-all shadow-lg shadow-emerald-500/25">
                    {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Desktop Sticky Finish Bar */}
      <div className="hidden lg:block fixed bottom-0 left-0 right-0 z-50">
        <div className="h-12 bg-gradient-to-t from-black to-transparent pointer-events-none lg:w-2/3" />
        <div className="relative bg-zinc-950/90 backdrop-blur-xl border-t border-zinc-800/50 px-6 min-h-[72px] flex items-center justify-center">
          <div className="flex items-center">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-sm text-zinc-400">Plan ready</span>
              </div>
              <span className="text-zinc-600">•</span>
              <span className="text-sm text-zinc-500">{plan.length} workouts configured</span>
            </div>
          </div>
          <div className="absolute right-6 top-1/2 -translate-y-1/2">
            <Button data-testid="button-finalize" onClick={handleFinalize} disabled={isFinalizing}
              className="relative group bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-sm px-8 h-12 rounded-xl shadow-lg shadow-emerald-500/25 hover:shadow-emerald-400/40 transition-all duration-300">
              <span className="absolute inset-0 rounded-xl bg-emerald-400 blur-xl opacity-30 group-hover:opacity-50 transition-opacity" />
              <span className="relative flex items-center gap-2">
                {isFinalizing ? <Loader2 className="w-4 h-4 animate-spin" /> : <>{finalizeLabel} <CheckCircle2 className="w-4 h-4" /></>}
              </span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
