import { useState, useEffect, useCallback, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { ChevronLeft, CalendarIcon, Camera, X, Loader2, Info, MessageCircle, Download } from "lucide-react";
import PhoneInput, { isValidPhoneNumber } from "react-phone-number-input";
import "react-phone-number-input/style.css";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Link, useLocation } from "wouter";
import { profileApi, signupProgressApi, authApi, workoutPlanApi, type DraftOnboardingData, type GeneratedPlan, type PlanConversationMessage } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { AppHeader } from "@/components/app-header";
import { trackEvent } from "@/lib/posthog";
import { PlanGenerationView } from "@/components/plan-builder/PlanGenerationView";

// --- Helpers ---

// Format phone number to E164 format (e.g., +15555555555)
// Handles both new E.164 format from PhoneInput and legacy formats
function formatPhoneToE164(phone: string): string {
  // If already in E.164 format (starts with +), return as-is
  if (phone.startsWith('+')) {
    return phone;
  }

  // Remove all non-digit characters
  const digits = phone.replace(/\D/g, '');

  // If it's a 10-digit US number, add +1 prefix
  if (digits.length === 10) {
    return `+1${digits}`;
  }

  // If it already has country code (11 digits starting with 1)
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }

  // Otherwise, assume it needs +1 prefix
  return `+1${digits}`;
}

// --- Schemas ---

// Phone schema (Step 1)
const phoneSchema = z.object({
  phone: z.string().min(10, "That doesn't look right. Try (555) 555-5555"),
});

// Demographics schema (Step 2 - Age + Sex)
const demographicsSchema = z.object({
  age: z.string().refine((val) => !isNaN(Number(val)) && Number(val) > 0 && Number(val) <= 105, "Enter a valid age (1–105)"),
  sex: z.enum(["male", "female", "other"], {
    errorMap: () => ({ message: "Select one to continue" })
  }),
});

// Single Goal Schema
const goalSchema = z.object({
  goal: z.enum(["lift_heavier", "build_muscle", "lean_defined", "lose_weight"], { 
    required_error: "Please select your primary goal." 
  }),
});

// Consistency Schema
const consistencySchema = z.object({
  consistency: z.enum(["never", "returning", "struggle", "consistent"], {
    required_error: "Please select the option that best describes you.",
  }),
});

// Experience Schema
const experienceSchema = z.object({
  experience: z.enum(["brand_new", "under_1_year", "1_2_years", "2_4_years", "4_plus_years"], {
    required_error: "Please select your experience level.",
  }),
});

// Equipment Schema
const equipmentSchema = z.object({
  equipment: z.array(z.string()).min(1, "Select at least one piece of equipment."),
});

// Split + Days combined Schema (Step 8)
const splitDaysSchema = z.object({
  split: z.enum(["full_body", "upper_lower", "push_pull_legs", "upper_body_only", "legs_only", "custom"], {
    required_error: "Please select a plan type.",
  }),
  workoutDays: z.array(z.string()).min(1, "Select at least one day"),
});

// Plan Mode Schema (Step 9)
const planModeSchema = z.object({
  planMode: z.enum(["existing", "scratch"]),
});

const textTimeSchema = z.object({
  preferredTextTime: z.string().min(1, "Please select a time."),
  timezone: z.string().min(1, "Please select your timezone."),
});

// --- Components ---

// Brandon's phone number for SMS deep link
const BRANDON_PHONE = "+16289978087";
const SMS_LINK = `sms:${BRANDON_PHONE}?body=${encodeURIComponent("tap send to get started \u2192")}`;

// Step Constants - named strings (order-independent, survives reordering)
const STEPS = {
  PHONE: "phone",
  VERIFY_PHONE: "verify_phone",
  DOWNLOAD_CONTACT: "download_contact",
  SEND_MESSAGE: "send_message",
  DEMOGRAPHICS: "demographics",
  GOAL: "goal",
  CONSISTENCY: "consistency",
  EXPERIENCE: "experience",
  PLAN_MODE: "plan_mode",
  EXISTING_PLAN: "existing_plan",   // Fork A (planMode === "existing")
  EQUIPMENT: "equipment",           // Fork B (planMode !== "existing")
  SPLIT_DAYS: "split_days",         // Fork B only
  PLAN_DETAIL: "plan_detail",
  TEXT_TIME: "text_time",
  PLAN_GEN_CHAT: "plan_gen_chat",
} as const;

type StepName = typeof STEPS[keyof typeof STEPS];

// Linear step order for each fork path (used for progress bar)
const STEPS_FORK_A: StepName[] = [
  STEPS.PHONE, STEPS.VERIFY_PHONE, STEPS.DOWNLOAD_CONTACT, STEPS.SEND_MESSAGE,
  STEPS.DEMOGRAPHICS, STEPS.GOAL, STEPS.CONSISTENCY, STEPS.EXPERIENCE,
  STEPS.PLAN_MODE, STEPS.EXISTING_PLAN, STEPS.TEXT_TIME, STEPS.PLAN_GEN_CHAT,
];
const STEPS_FORK_B: StepName[] = [
  STEPS.PHONE, STEPS.VERIFY_PHONE, STEPS.DOWNLOAD_CONTACT, STEPS.SEND_MESSAGE,
  STEPS.DEMOGRAPHICS, STEPS.GOAL, STEPS.CONSISTENCY, STEPS.EXPERIENCE,
  STEPS.PLAN_MODE, STEPS.EQUIPMENT, STEPS.SPLIT_DAYS, STEPS.PLAN_DETAIL, STEPS.TEXT_TIME, STEPS.PLAN_GEN_CHAT,
];

// Shared animation variants for step transitions
// Framer Motion automatically respects prefers-reduced-motion, but we use
// useReducedMotion for explicit control and smoother behavior
const stepAnimationVariants = {
  initial: { opacity: 0, scale: 0.98 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.98 },
};

const reducedMotionVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
};

export default function Onboarding() {
  const [step, setStep] = useState<StepName | null>(null);
  const [, setLocation] = useLocation();
  const { user, isLoading, isAuthenticated } = useAuth();
  const { toast } = useToast();
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [profileSubmitted, setProfileSubmitted] = useState(false);
  const [verifiedPhone, setVerifiedPhone] = useState("");
  const [draftPlanData, setDraftPlanData] = useState<{ plan: GeneratedPlan | null; messages: PlanConversationMessage[] } | null>(null);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [contactDownloaded, setContactDownloaded] = useState(false);
  const [messageSent, setMessageSent] = useState(false);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const shouldReduceMotion = useReducedMotion();
  
  // Redirect to login if not authenticated
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      window.location.href = "/login?returnTo=/onboarding";
    }
  }, [isLoading, isAuthenticated]);

  const [formData, setFormData] = useState({
    phone: "",
    age: "",
    sex: "",
    goal: "",
    consistency: "",
    experience: "",
    equipment: [] as string[],
    split: "",
    notes: "",
    workoutDays: [] as string[],
    preferredTextTime: "",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    planMode: "" as "" | "existing" | "scratch",
    workoutImage: null as string | null,
    useExactPlan: false,
  });

  // Load signup progress and draft data on mount
  useEffect(() => {
    if (!isAuthenticated || draftLoaded) return;

    const loadProgress = async () => {
      try {
        const progress = await signupProgressApi.get();

        // Smart routing based on signup stage
        if (progress.signupStage === "plan_pending") {
          // Profile exists, need plan gen - jump to plan gen step
          if (progress.draftPlanData) {
            setDraftPlanData(progress.draftPlanData);
          }
          setStep(STEPS.PLAN_GEN_CHAT);
          setDraftLoaded(true);
          return;
        } else if (progress.signupStage === "payment_pending") {
          setLocation("/payment");
          return;
        } else if (progress.signupStage === "complete") {
          setLocation("/dashboard");
          return;
        }

        // Load draft data if available
        if (progress.draftOnboardingData) {
          const draft = progress.draftOnboardingData;
          setFormData(prev => ({
            ...prev,
            phone: draft.phone || "",
            age: draft.age || "",
            sex: draft.sex || "",
            goal: draft.goal || "",
            consistency: draft.consistency || "",
            experience: draft.experience || "",
            equipment: draft.equipment || [],
            split: draft.split || "",
            notes: draft.notes || "",
            workoutDays: draft.workoutDays || [],
            preferredTextTime: draft.preferredTextTime || "",
            timezone: draft.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
            planMode: ((draft.planMode as string) === "mix" ? "" : (draft.planMode || "")) as "" | "existing" | "scratch",
            workoutImage: draft.workoutImage || null,
            useExactPlan: draft.useExactPlan || false,
          }));

          // Resume from saved step (now stored as a string name)
          const resumeStep = draft.currentStep as StepName | undefined;

          if (resumeStep && resumeStep !== STEPS.PHONE) {
            // Guard: plan_detail requires planMode
            if (resumeStep === STEPS.PLAN_DETAIL && !draft.planMode) {
              setStep(STEPS.PLAN_MODE);
            } else {
              setStep(resumeStep);
            }
          } else {
            setStep(STEPS.PHONE);
          }

          // Restore action completion flags
          if (draft.contactDownloaded) setContactDownloaded(true);
          if (draft.messageSent) setMessageSent(true);

          // If user was past verification, their phone is already verified
          const stepsOrder = getStepsOrder(draft.planMode || "");
          const resumeIndex = resumeStep ? stepsOrder.indexOf(resumeStep) : -1;
          const verifyIndex = stepsOrder.indexOf(STEPS.VERIFY_PHONE);
          if (resumeIndex > verifyIndex && draft.phone) {
            setVerifiedPhone(formatPhoneToE164(draft.phone));
          }
        } else {
          // No draft data — start from beginning
          setStep(STEPS.PHONE);
        }

        setDraftLoaded(true);
      } catch (error) {
        console.error("Failed to load signup progress:", error);
        setStep(STEPS.PHONE);
        setDraftLoaded(true);
      }
    };
    
    loadProgress();
  }, [isAuthenticated, draftLoaded, setLocation]);

  // Auto-save form data with debounce
  const saveDraft = useCallback((data: typeof formData, currentStep: string, extras?: { contactDownloaded?: boolean; messageSent?: boolean }) => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    
    saveTimeoutRef.current = setTimeout(async () => {
      try {
        const draftData: DraftOnboardingData = {
          phone: data.phone,
          age: data.age,
          sex: data.sex,
          goal: data.goal,
          consistency: data.consistency,
          experience: data.experience,
          equipment: data.equipment,
          split: data.split,
          notes: data.notes,
          workoutDays: data.workoutDays,
          preferredTextTime: data.preferredTextTime,
          timezone: data.timezone,
          planMode: data.planMode || undefined,
          workoutImage: data.workoutImage || undefined,
          useExactPlan: data.useExactPlan,
          currentStep: currentStep,
          contactDownloaded: extras?.contactDownloaded,
          messageSent: extras?.messageSent,
        };
        await signupProgressApi.saveDraft(draftData);
      } catch (error) {
        console.error("Failed to save draft:", error);
      }
    }, 1000); // Debounce 1 second
  }, []);

  // Save draft whenever form data or step changes (but not after profile is submitted)
  useEffect(() => {
    if (draftLoaded && isAuthenticated && !profileSubmitted && step) {
      saveDraft(formData, step, { contactDownloaded, messageSent });
    }
  }, [formData, step, draftLoaded, isAuthenticated, saveDraft, profileSubmitted, contactDownloaded, messageSent]);

  // Get the ordered step list for the current fork path
  const getStepsOrder = (planMode?: string): StepName[] => {
    return planMode === "existing" ? STEPS_FORK_A : STEPS_FORK_B;
  };

  // Fork-aware navigation: just walk the ordered list
  // overridePlanMode lets callers pass the freshly-selected planMode so we
  // don't read stale React state (e.g. PlanMode step calls nextStep before
  // the setState from updateFormData has flushed).
  const nextStep = (overridePlanMode?: string) => {
    if (!step) return;
    trackEvent('onboarding_step_completed', { step: step });
    const order = getStepsOrder(overridePlanMode ?? formData.planMode);
    const idx = order.indexOf(step);
    if (idx < order.length - 1) {
      setStep(order[idx + 1]);
    }
  };

  const prevStep = () => {
    if (!step) return;
    const order = getStepsOrder(formData.planMode);
    const idx = order.indexOf(step);
    if (idx > 0) {
      setStep(order[idx - 1]);
    }
  };

  const updateFormData = (data: Partial<typeof formData>) => {
    setFormData((prev) => ({ ...prev, ...data }));
  };

  const handleFinishOnboarding = async (data: any) => {
    // Stop auto-saving immediately
    setProfileSubmitted(true);
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }

    updateFormData(data);
    const finalData = { ...formData, ...data };

    // Validate required fields before submitting
    const requiredFields = [
      { field: 'phone', label: 'Phone', step: STEPS.PHONE },
      { field: 'goal', label: 'Goal', step: STEPS.GOAL },
    ];

    for (const { field, label, step: requiredStep } of requiredFields) {
      if (!finalData[field]) {
        setProfileSubmitted(false);
        toast({
          title: "Missing Information",
          description: `Please complete the ${label} step.`,
          variant: "destructive",
        });
        setStep(requiredStep);
        return;
      }
    }

    if (!user?.id) {
      toast({
        title: "Error",
        description: "Please log in to continue.",
        variant: "destructive",
      });
      window.location.href = "/login";
      return;
    }

    try {
      // Use name from Google OAuth (firstName + lastName)
      const googleName = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email?.split('@')[0] || 'User';

      // Clean up irrelevant fields based on planMode
      const planMode = finalData.planMode || undefined;
      let useExactPlan = finalData.useExactPlan;
      let workoutImage = finalData.workoutImage;

      if (planMode !== "existing") {
        useExactPlan = false;
      }
      if (planMode === "scratch") {
        workoutImage = null;
      }

      const profilePayload = {
        userId: user.id,
        name: googleName,
        phone: formatPhoneToE164(finalData.phone),
        age: finalData.age ? parseInt(finalData.age) : undefined,
        sex: finalData.sex,
        goal: finalData.goal,
        consistency: finalData.consistency,
        experience: finalData.experience,
        equipment: finalData.equipment,
        split: finalData.split,
        notes: finalData.notes || undefined,
        workoutDays: finalData.workoutDays,
        preferredTextTime: finalData.preferredTextTime,
        timezone: finalData.timezone,
        planMode: planMode as "existing" | "scratch" | undefined,
      };

      const createdProfile = await profileApi.create(profilePayload);

      // Verify profile was created before redirecting
      if (!createdProfile?.id) {
        throw new Error("Profile creation did not return a valid ID");
      }

      trackEvent('onboarding_completed', {
        goal: finalData.goal,
        experience: finalData.experience,
        split: finalData.split,
        workout_days_count: finalData.workoutDays?.length || 0,
        plan_mode: planMode,
      });

      // Move to plan generation step (inline, not separate page)
      setStep(STEPS.PLAN_GEN_CHAT);
    } catch (error) {
      console.error("Failed to save profile:", error);
      setProfileSubmitted(false); // Re-enable auto-save on error
      toast({
        title: "Error",
        description: "Failed to save your profile. Please try again.",
        variant: "destructive",
      });
    }
  };

  // Handle plan finalization from PlanGenerationView
  const handlePlanFinalize = async (plan: GeneratedPlan, messages: PlanConversationMessage[]) => {
    if (!user?.id) return;
    setIsFinalizing(true);

    try {
      await workoutPlanApi.create({
        userId: user.id,
        planData: {
          weeklyVolume: plan.weeklyVolume || "12 Sets/Muscle Group",
          workouts: plan.workouts,
        },
        status: "active",
      }, messages);

      trackEvent('plan_finalized_onboarding', { workout_count: plan.workouts.length });

      // Redirect to payment
      setLocation("/payment");
    } catch (error) {
      console.error("Failed to save workout plan:", error);
      setIsFinalizing(false);
      toast({
        title: "Error",
        description: "Failed to save your workout plan. Please try again.",
        variant: "destructive",
      });
    }
  };

  // Helper to determine progress percentage
  const getProgress = () => {
    if (!step) return 0;
    const order = getStepsOrder(formData.planMode);
    const idx = order.indexOf(step);
    if (idx <= 0) return 0;
    return (idx / (order.length - 1)) * 100;
  };

  // Loading screen while fetching signup progress
  if (!step) {
    return (
      <div className="min-h-screen bg-background flex flex-col font-sans">
        <AppHeader showSubscriptionManagement={false} />
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
        </div>
      </div>
    );
  }

  // If we're at the plan gen step, render full-screen PlanGenerationView
  if (step === STEPS.PLAN_GEN_CHAT) {
    return (
      <div className="min-h-screen bg-black flex flex-col font-sans">
        <AppHeader showBorder showSubscriptionManagement={false} />
        <PlanGenerationView
          userId={user?.id || ""}
          initialPlan={draftPlanData?.plan || undefined}
          initialMessages={draftPlanData?.messages}
          onFinalize={handlePlanFinalize}
          isFinalizing={isFinalizing}
          finalizeLabel="Finish & Start"
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col font-sans relative overflow-hidden">

      {/* Header */}
      <AppHeader showSubscriptionManagement={false} />

      {/* Very Subtle Background Elements */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-white/[0.02] rounded-full blur-[100px] pointer-events-none"></div>

      <div className="flex-1 flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-2xl relative z-10 min-h-[600px] flex flex-col">
          {/* Minimal Progress Bar */}
          <div className="mb-10 px-2 flex-shrink-0">
           <div className="h-[2px] w-full bg-zinc-900 overflow-hidden">
              <motion.div
                 className="h-full bg-white"
                 initial={{ width: "0%" }}
                 animate={{ width: `${getProgress()}%` }}
                 transition={{ duration: 0.5, ease: "circOut" }}
              />
           </div>
        </div>

        <div className="flex-grow flex items-center justify-center relative">
          {/* Glass card wrapper - only visible on md: screens */}
          <div className="w-full max-w-lg glass-card-desktop flex flex-col justify-center">
          <AnimatePresence mode={shouldReduceMotion ? "sync" : "wait"}>
          {step === STEPS.PHONE && (
            <StepPhone
              key="step-phone"
              defaultValues={{ phone: formData.phone }}
              onNext={(data) => {
                updateFormData(data);
                nextStep();
              }}
            />
          )}

          {step === STEPS.VERIFY_PHONE && (
            <StepVerifyPhone
              key="step-verify-phone"
              phone={formData.phone}
              verifiedPhone={verifiedPhone}
              onNext={() => {
                setVerifiedPhone(formatPhoneToE164(formData.phone));
                nextStep();
              }}
              onBack={prevStep}
            />
          )}

          {step === STEPS.DOWNLOAD_CONTACT && (
            <StepDownloadContact
              key="step-download-contact"
              onNext={nextStep}
              onBack={prevStep}
              initialDownloaded={contactDownloaded}
              onDownloaded={() => setContactDownloaded(true)}
            />
          )}

          {step === STEPS.SEND_MESSAGE && (
            <StepSendMessage
              key="step-send-message"
              onNext={nextStep}
              onBack={prevStep}
              initialTapped={messageSent}
              onTapped={() => setMessageSent(true)}
            />
          )}

          {step === STEPS.DEMOGRAPHICS && (
            <StepDemographics
              key="step-demographics"
              defaultValues={{ age: formData.age, sex: formData.sex }}
              onNext={(data) => {
                updateFormData(data);
                nextStep();
              }}
              onBack={prevStep}
            />
          )}

          {step === STEPS.GOAL && (
            <StepGoal
              key="step-goal"
              defaultValues={{ goal: formData.goal }}
              onNext={(data) => {
                updateFormData(data);
                nextStep();
              }}
              onBack={prevStep}
            />
          )}

          {step === STEPS.CONSISTENCY && (
            <StepConsistency
              key="step-consistency"
              defaultValues={{ consistency: formData.consistency }}
              onNext={(data) => {
                updateFormData(data);
                nextStep();
              }}
              onBack={prevStep}
            />
          )}

          {step === STEPS.EXPERIENCE && (
            <StepExperience
              key="step-experience"
              defaultValues={{ experience: formData.experience }}
              onNext={(data) => {
                updateFormData(data);
                nextStep();
              }}
              onBack={prevStep}
            />
          )}

          {step === STEPS.PLAN_MODE && (
            <StepPlanMode
              key="step-plan-mode"
              defaultValues={{ planMode: formData.planMode }}
              onNext={(data) => {
                updateFormData(data);
                nextStep(data.planMode);
              }}
              onBack={prevStep}
            />
          )}

          {/* Fork A: Existing plan upload (step 10 when planMode === "existing") */}
          {step === STEPS.EXISTING_PLAN && (
            <StepPlanDetail
              key="step-existing-plan"
              planMode="existing"
              defaultValues={{
                notes: formData.notes,
                workoutImage: formData.workoutImage,
                useExactPlan: formData.useExactPlan,
              }}
              onNext={(data) => {
                updateFormData(data);
                nextStep();
              }}
              onBack={prevStep}
            />
          )}

          {/* Fork B: Equipment (step 10 when planMode !== "existing") */}
          {step === STEPS.EQUIPMENT && (
            <StepEquipment
              key="step-equipment"
              defaultValues={{ equipment: formData.equipment }}
              onNext={(data) => {
                updateFormData(data);
                nextStep();
              }}
              onBack={prevStep}
            />
          )}

          {step === STEPS.SPLIT_DAYS && (
            <StepSplitDays
              key="step-split-days"
              defaultValues={{ split: formData.split, workoutDays: formData.workoutDays }}
              onNext={(data) => {
                updateFormData(data);
                nextStep();
              }}
              onBack={prevStep}
            />
          )}

          {step === STEPS.PLAN_DETAIL && (
            <StepPlanDetail
              key="step-plan-detail"
              planMode={formData.planMode as "existing" | "scratch"}
              defaultValues={{
                notes: formData.notes,
                workoutImage: formData.workoutImage,
                useExactPlan: formData.useExactPlan,
              }}
              onNext={(data) => {
                updateFormData(data);
                nextStep();
              }}
              onBack={prevStep}
            />
          )}

          {step === STEPS.TEXT_TIME && (
            <StepTextTime
              key="step-text-time"
              defaultValues={{ preferredTextTime: formData.preferredTextTime, timezone: formData.timezone }}
              onNext={handleFinishOnboarding}
              onBack={prevStep}
            />
          )}
          </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  </div>
  );
}

// --- Step 1: Phone Number (Liquid Glass) ---

function StepPhone({ defaultValues, onNext }: { defaultValues: { phone: string }; onNext: (data: { phone: string }) => void }) {
  const [phone, setPhone] = useState<string | undefined>(defaultValues.phone || undefined);
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);
  const { logout } = useAuth();

  const handleLoginRedirect = () => {
    logout();
    // Logout will redirect to login page
  };

  const handleSubmit = async () => {
    setError(null);
    setDuplicateError(null);

    // Validate phone number
    if (!phone) {
      setError("Please enter your phone number");
      return;
    }

    if (!isValidPhoneNumber(phone)) {
      setError("Please enter a valid phone number");
      return;
    }

    setIsChecking(true);

    try {
      // Phone is already in E.164 format from the library
      const { exists } = await authApi.checkPhoneExists(phone);

      if (exists) {
        setDuplicateError("This number is already registered.");
        setIsChecking(false);
        return;
      }

      // Phone is available, proceed with E.164 format
      onNext({ phone });
    } catch (error) {
      console.error("Failed to check phone:", error);
      // On error, let them proceed (we'll catch it later if needed)
      onNext({ phone });
    } finally {
      setIsChecking(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.4, ease: "circOut" }}
      className="w-full px-6 md:px-0"
    >
      <div className="space-y-8">
        {/* Header */}
        <div className="space-y-3">
          <h1 className="text-3xl md:text-4xl font-heading text-white font-medium tracking-tight">
            Your number
          </h1>
          <p className="text-zinc-400 text-lg">
            We'll text your workouts here.
          </p>
        </div>

        {/* Input */}
        <div className="space-y-4">
          <PhoneInput
            international
            countryCallingCodeEditable={false}
            defaultCountry="US"
            placeholder="(555) 555-5555"
            value={phone}
            onChange={setPhone}
            disabled={isChecking}
            data-testid="input-phone"
            className="phone-input-dark"
          />

          {/* Error messages */}
          <AnimatePresence mode="wait">
            {(error || duplicateError) && (
              <motion.p
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="text-amber-400 text-sm flex items-center gap-2"
              >
                <span className="text-amber-400/60">↳</span>
                {duplicateError || error}
                {duplicateError && (
                  <button
                    type="button"
                    onClick={handleLoginRedirect}
                    className="underline underline-offset-2 hover:text-white transition-colors"
                  >
                    Log in instead →
                  </button>
                )}
              </motion.p>
            )}
          </AnimatePresence>
        </div>

        {/* CTA Button */}
        <Button
          className="glass-button w-full h-14 text-lg font-medium touch-target"
          onClick={handleSubmit}
          disabled={isChecking}
          data-testid="button-next-phone"
        >
          {isChecking ? (
            <span className="flex items-center gap-2">
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Checking...
            </span>
          ) : (
            "Continue"
          )}
        </Button>
      </div>
    </motion.div>
  );
}

// --- Step 2: Phone Verification (Liquid Glass) ---

function StepVerifyPhone({ phone, verifiedPhone, onNext, onBack }: { phone: string; verifiedPhone: string; onNext: () => void; onBack: () => void }) {
  const [code, setCode] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [codeSent, setCodeSent] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const isMobile = useIsMobile();
  const [isFocused, setIsFocused] = useState(false);
  const hiddenInputRef = useRef<HTMLInputElement>(null);

  const e164Phone = formatPhoneToE164(phone);

  // Skip verification if this phone is already verified
  useEffect(() => {
    if (e164Phone && e164Phone === verifiedPhone) {
      onNext();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Format phone for display (e.g., +15551234567 → (555) 123-4567)
  const displayPhone = phone.startsWith("+1") && phone.length === 12
    ? `(${phone.slice(2, 5)}) ${phone.slice(5, 8)}-${phone.slice(8)}`
    : phone;

  const sendCode = useCallback(async () => {
    setIsSending(true);
    setError(null);
    try {
      const result = await authApi.sendCode(e164Phone);
      if (result.sent) {
        setCodeSent(true);
        setResendCooldown(60);
      } else {
        setError(result.error || "Failed to send code");
      }
    } catch (err) {
      console.error("Send code error:", err);
      setError("Failed to send verification code. Please try again.");
    } finally {
      setIsSending(false);
    }
  }, [e164Phone]);

  // Auto-send code on first mount only (not on page refresh)
  useEffect(() => {
    const key = `otp_sent_${e164Phone}`;
    if (!sessionStorage.getItem(key)) {
      sessionStorage.setItem(key, "1");
      sendCode();
    } else {
      // Code was already sent this session — just show the input
      setCodeSent(true);
    }
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  // Resend cooldown timer
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  const handleVerify = async () => {
    if (code.length !== 6) {
      setError("Please enter the 6-digit code");
      return;
    }

    setError(null);
    setIsVerifying(true);

    try {
      const result = await authApi.verifyPhone(e164Phone, code);

      if (result.verified) {
        onNext();
      } else {
        setError(result.error || "Invalid code. Please try again.");
      }
    } catch (err) {
      console.error("Verification error:", err);
      setError("Something went wrong. Please try again.");
    } finally {
      setIsVerifying(false);
    }
  };


  // Sent status card (inline JSX, not a nested component)
  const sendCodeCard = (
    <div className="bg-white/[0.02] border border-white/[0.06] rounded-2xl p-5">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
          {isSending ? (
            <Loader2 className="w-5 h-5 text-emerald-400 animate-spin" />
          ) : codeSent ? (
            <span className="text-emerald-400 text-lg">✓</span>
          ) : (
            <span className="text-zinc-500 text-lg">·</span>
          )}
        </div>
        <div className="flex-1">
          <p className="text-white text-sm font-medium">
            {isSending ? "Sending code..." : codeSent ? `Code sent to ${displayPhone}` : "Sending code..."}
          </p>
          <p className="text-zinc-500 text-xs mt-0.5">Check your text messages</p>
        </div>
      </div>
      {codeSent && (
        <button
          onClick={sendCode}
          disabled={resendCooldown > 0 || isSending}
          className="mt-3 w-full text-center text-sm text-zinc-400 hover:text-zinc-200 disabled:text-zinc-600 disabled:cursor-not-allowed transition-colors"
        >
          {resendCooldown > 0 ? `Resend code (${resendCooldown}s)` : "Resend code"}
        </button>
      )}
    </div>
  );

  // Code input section (inline JSX, not a nested component — avoids remount on every keystroke)
  const activeIndex = code.length < 6 ? code.length : 5;

  const codeInputSection = (
    <div className="space-y-4">
      <label className="block text-zinc-400 text-sm text-center">
        Enter the 6-digit code we sent you
      </label>
      <div
        className="relative flex justify-center gap-2 cursor-text"
        onClick={() => hiddenInputRef.current?.focus()}
      >
        {/* Hidden input for OTP autofill & paste */}
        <input
          ref={hiddenInputRef}
          type="text"
          autoComplete="one-time-code"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={6}
          value={code}
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, "").slice(0, 6);
            setCode(digits);
            if (error) setError(null);
          }}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          disabled={isVerifying}
          className="absolute inset-0 w-full h-full opacity-0"
          style={{ caretColor: "transparent" }}
          aria-label="Verification code"
          data-testid="input-otp-code"
        />

        {/* Display boxes */}
        {[0, 1, 2, 3, 4, 5].map((index) => {
          const isFilled = !!code[index];
          const isActive = isFocused && index === activeIndex;
          return (
            <div
              key={index}
              className={`w-12 h-14 flex items-center justify-center text-xl bg-white/5 border-2 ${
                isFilled
                  ? "border-emerald-500 bg-emerald-500/10"
                  : isActive
                    ? "border-emerald-500 bg-emerald-500/5"
                    : "border-zinc-700"
              } rounded-xl text-white text-center font-semibold transition-all`}
              data-testid={`display-code-${index}`}
            >
              {code[index] || ""}
            </div>
          );
        })}
      </div>

      {/* Error message */}
      <AnimatePresence mode="wait">
        {error && (
          <motion.p
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="text-amber-400 text-sm text-center flex items-center justify-center gap-2"
          >
            <span className="text-amber-400/60">↳</span>
            {error}
          </motion.p>
        )}
      </AnimatePresence>

      <Button
        className={`w-full h-12 ${
          code.length === 6
            ? "bg-emerald-500 hover:bg-emerald-600 text-white"
            : "bg-zinc-800 text-zinc-400 border border-zinc-700"
        } font-semibold rounded-xl transition-all`}
        onClick={handleVerify}
        disabled={isVerifying || code.length !== 6}
        data-testid="button-verify-phone"
      >
        {isVerifying ? (
          <span className="flex items-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin" />
            Verifying...
          </span>
        ) : (
          "Continue"
        )}
      </Button>
    </div>
  );

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.4, ease: "circOut" }}
      className="w-full px-6 md:px-0"
    >
      <div className="space-y-6 max-w-sm mx-auto">
        {/* Header */}
        <div className="text-center mb-2">
          <h1 className="text-2xl md:text-3xl font-heading text-white font-semibold tracking-tight">
            Verify your number
          </h1>
        </div>

        {sendCodeCard}
        {codeInputSection}

        {/* Back button */}
        <button
          onClick={onBack}
          className="w-full text-center text-zinc-500 hover:text-zinc-300 transition-colors py-2 text-sm"
          disabled={isVerifying}
        >
          ← Change phone number
        </button>
      </div>
    </motion.div>
  );
}

// --- Step 3: Download Contact Card ---

// Brandon contact photo (base64 JPEG)
const BRANDON_PHOTO_B64 = "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";

// Generate a vCard file for Brandon
function generateBrandonVCard(): string {
  // vCard 3.0 spec requires PHOTO lines to be folded at 75 chars
  // with continuation lines starting with a space
  const photoLines: string[] = [];
  const photoPrefix = "PHOTO;ENCODING=b;TYPE=JPEG:";
  const fullLine = photoPrefix + BRANDON_PHOTO_B64;
  // First line: up to 75 chars; continuation lines: space + up to 74 chars
  photoLines.push(fullLine.substring(0, 75));
  for (let i = 75; i < fullLine.length; i += 74) {
    photoLines.push(" " + fullLine.substring(i, i + 74));
  }

  return [
    "BEGIN:VCARD",
    "VERSION:3.0",
    "FN:Brandon",
    "TEL;TYPE=CELL:+16289978087",
    "NOTE:Your AI fitness coach",
    ...photoLines,
    "END:VCARD",
  ].join("\r\n");
}

function downloadVCard() {
  const vcard = generateBrandonVCard();
  const blob = new Blob([vcard], { type: "text/vcard" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "Brandon.vcf";
  a.click();
  URL.revokeObjectURL(url);
}

function StepDownloadContact({ onNext, onBack, initialDownloaded, onDownloaded }: { onNext: () => void; onBack: () => void; initialDownloaded?: boolean; onDownloaded?: () => void }) {
  const [hasDownloaded, setHasDownloaded] = useState(initialDownloaded || false);

  const handleDownload = () => {
    downloadVCard();
    setHasDownloaded(true);
    onDownloaded?.();
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.4, ease: "circOut" }}
      className="w-full px-6 md:px-0"
    >
      <div className="space-y-8">
        <div className="space-y-3">
          <h1 className="text-3xl md:text-4xl font-heading text-white font-medium tracking-tight">
            Add to Contacts
          </h1>
          <div className="space-y-2 text-zinc-400">
            <div className="flex items-start gap-3">
              <span className="text-zinc-500 font-mono text-sm mt-0.5 w-5 text-right shrink-0">1.</span>
              <span>Tap the contact card below</span>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-zinc-500 font-mono text-sm mt-0.5 w-5 text-right shrink-0">2.</span>
              <span>Scroll to the bottom</span>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-zinc-500 font-mono text-sm mt-0.5 w-5 text-right shrink-0">3.</span>
              <span>Select <span className="text-emerald-400 font-medium">Create New Contact</span></span>
            </div>
          </div>
        </div>

        {/* Contact Card */}
        <div className="flex justify-center">
          <button
            onClick={handleDownload}
            className="group cursor-pointer transition-all hover:scale-[1.02] active:scale-[0.98]"
          >
            <div className={`bg-zinc-800/60 backdrop-blur-xl rounded-2xl border p-6 w-64 shadow-2xl shadow-black/40 transition-colors ${hasDownloaded ? 'border-emerald-500/30' : 'border-zinc-600 group-hover:border-emerald-500/30'}`}>
              {/* Avatar */}
              <div className="flex justify-center mb-4">
                <img src="/brandon-avatar.png" alt="Brandon" className="w-20 h-20 rounded-full shadow-lg shadow-emerald-500/20 object-cover" />
              </div>
              {/* Name */}
              <p className="text-white font-heading font-semibold text-lg text-center">
                Brandon
              </p>
              {/* Phone */}
              <p className="text-emerald-400 text-sm text-center mt-1">
                +1 (628) 997-8087
              </p>
              {/* Download hint */}
              <div className="mt-4 pt-3 border-t border-white/5 flex justify-center">
                <div className="flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30">
                  <Download className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-xs text-emerald-400 font-medium">Tap to save contact</span>
                </div>
              </div>
            </div>
          </button>
        </div>

        <div className="flex gap-3 pt-4">
          <Button
            variant="outline"
            onClick={onBack}
            className="h-12 px-4 rounded-xl bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-800"
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button
            onClick={onNext}
            disabled={!hasDownloaded}
            data-testid="button-next-download-contact"
            className={`flex-1 h-12 rounded-xl font-medium transition-colors ${hasDownloaded ? 'bg-white text-black hover:bg-zinc-200' : 'bg-zinc-700 text-zinc-400 cursor-not-allowed'}`}
          >
            Continue
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

// --- Step 4: Send First Message ---

function StepSendMessage({ onNext, onBack, initialTapped, onTapped }: { onNext: () => void; onBack: () => void; initialTapped?: boolean; onTapped?: () => void }) {
  const [hasTapped, setHasTapped] = useState(initialTapped || false);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.4, ease: "circOut" }}
      className="w-full px-6 md:px-0"
    >
      <div className="space-y-8">
        <div className="space-y-3">
          <h1 className="text-3xl md:text-4xl font-heading text-white font-medium tracking-tight">
            Say hi to Brandon
          </h1>
          <p className="text-zinc-400 text-lg">
            Tap below to send your first message. Brandon will walk you through everything.
          </p>
        </div>

        <a href={SMS_LINK} onClick={() => { setHasTapped(true); onTapped?.(); }}>
          <Button className="w-full h-14 bg-emerald-500 hover:bg-emerald-400 text-black font-semibold rounded-xl text-lg shadow-lg shadow-emerald-500/25 transition-all hover:shadow-emerald-500/40 hover:scale-[1.02] active:scale-[0.98]">
            <MessageCircle className="h-5 w-5 mr-3" />
            Text Brandon
          </Button>
        </a>

        <div className="flex gap-3 pt-4">
          <Button
            variant="outline"
            onClick={onBack}
            className="h-12 px-4 rounded-xl bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-800"
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button
            onClick={onNext}
            disabled={!hasTapped}
            data-testid="button-next-send-message"
            className={`flex-1 h-12 rounded-xl font-medium transition-colors ${hasTapped ? 'bg-white text-black hover:bg-zinc-200' : 'bg-zinc-700 text-zinc-400 cursor-not-allowed'}`}
          >
            Continue
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

// --- Step 5: Demographics (Age + Sex) - Liquid Glass ---

function StepDemographics({ defaultValues, onNext, onBack }: { defaultValues: { age: string; sex: string }; onNext: (data: any) => void; onBack: () => void }) {
  const form = useForm({
    resolver: zodResolver(demographicsSchema),
    defaultValues,
  });

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.4, ease: "circOut" }}
      className="w-full px-6 md:px-0"
    >
      <div className="space-y-8">
        {/* Header */}
        <div className="space-y-3">
          <h1 className="text-3xl md:text-4xl font-heading text-white font-medium tracking-tight">
            About you
          </h1>
          <p className="text-zinc-400 text-lg">
            Helps us personalize your program.
          </p>
        </div>

        {/* Age Input */}
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm text-zinc-400 ml-1">Age</label>
            <Input
              type="number"
              placeholder="28"
              className="glass-input h-14 w-32 text-lg text-white placeholder:text-zinc-500 px-5"
              data-testid="input-age"
              {...form.register("age")}
            />
            <AnimatePresence mode="wait">
              {form.formState.errors.age && (
                <motion.p
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="text-amber-400 text-sm flex items-center gap-2"
                >
                  <span className="text-amber-400/60">↳</span>
                  {String(form.formState.errors.age.message)}
                </motion.p>
              )}
            </AnimatePresence>
          </div>

          {/* Sex Selection - Glass Pills */}
          <div className="space-y-2 pt-4">
            <label className="text-sm text-zinc-400 ml-1">Sex</label>
            <div className="grid grid-cols-3 gap-3" data-testid="input-sex">
              {["Male", "Female", "Other"].map((option) => {
                const value = option.toLowerCase();
                const isSelected = form.watch("sex") === value;
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => form.setValue("sex", value as any, { shouldValidate: true })}
                    className={cn(
                      "glass-pill h-14 flex items-center justify-center text-base font-medium touch-target",
                      isSelected && "selected"
                    )}
                  >
                    {option}
                  </button>
                );
              })}
            </div>
            <AnimatePresence mode="wait">
              {form.formState.errors.sex && (
                <motion.p
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="text-amber-400 text-sm flex items-center gap-2 pt-1"
                >
                  <span className="text-amber-400/60">↳</span>
                  {String(form.formState.errors.sex.message)}
                </motion.p>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Navigation */}
        <div className="flex gap-3 pt-4">
          <Button
            variant="ghost"
            onClick={onBack}
            className="h-14 w-14 rounded-xl p-0 flex-shrink-0 glass-pill text-zinc-400 hover:text-white"
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <Button
            className="glass-button flex-1 h-14 text-lg font-medium touch-target"
            onClick={form.handleSubmit(onNext)}
            data-testid="button-next-demographics"
          >
            Continue
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

// --- Step 3: Goal Selection (Liquid Glass) ---

function StepGoal({ defaultValues, onNext, onBack }: { defaultValues: any; onNext: (data: any) => void; onBack: () => void }) {
  const form = useForm({
    resolver: zodResolver(goalSchema),
    defaultValues,
  });

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.4, ease: "circOut" }}
      className="w-full px-6 md:px-0"
    >
      <div className="space-y-8">
        {/* Header */}
        <div className="space-y-3">
          <h1 className="text-3xl md:text-4xl font-heading text-white font-medium tracking-tight">
            Your goal
          </h1>
          <p className="text-zinc-400 text-lg">
            What matters most to you right now?
          </p>
        </div>

        {/* Options */}
        <div className="space-y-3">
          {[
            { value: "lift_heavier", label: "Lift Heavier" },
            { value: "build_muscle", label: "Build Muscle" },
            { value: "lean_defined", label: "Lean and Defined" },
            { value: "lose_weight", label: "Lose Weight" },
          ].map((option) => {
            const isSelected = form.watch("goal") === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => form.setValue("goal", option.value as any, { shouldValidate: true })}
                className={cn(
                  "glass-pill w-full h-16 flex items-center justify-start px-6 text-lg font-medium touch-target",
                  isSelected && "selected"
                )}
              >
                {option.label}
              </button>
            );
          })}

          <AnimatePresence mode="wait">
            {form.formState.errors.goal && (
              <motion.p
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="text-amber-400 text-sm flex items-center gap-2"
              >
                <span className="text-amber-400/60">↳</span>
                Pick one to continue
              </motion.p>
            )}
          </AnimatePresence>
        </div>

        {/* Navigation */}
        <div className="flex gap-3 pt-4">
          <Button
            variant="ghost"
            onClick={onBack}
            className="h-14 w-14 rounded-xl p-0 flex-shrink-0 glass-pill text-zinc-400 hover:text-white"
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <Button
            className="glass-button flex-1 h-14 text-lg font-medium touch-target"
            onClick={form.handleSubmit(onNext)}
            data-testid="button-next-goal"
          >
            Continue
          </Button>
        </div>
      </div>
    </motion.div>
  );
}


// --- Step 4: Consistency (Liquid Glass) ---

function StepConsistency({ defaultValues, onNext, onBack }: { defaultValues: any; onNext: (data: any) => void; onBack: () => void }) {
  const form = useForm({
    resolver: zodResolver(consistencySchema),
    defaultValues,
  });

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.4, ease: "circOut" }}
      className="w-full px-6 md:px-0"
    >
      <div className="space-y-8">
        {/* Header */}
        <div className="space-y-3">
          <h1 className="text-3xl md:text-4xl font-heading text-white font-medium tracking-tight">
            Your consistency
          </h1>
          <p className="text-zinc-400 text-lg">
            Be honest — it helps us plan.
          </p>
        </div>

        {/* Options */}
        <div className="space-y-3">
          {[
            { value: "never", label: "Never had a consistent routine" },
            { value: "returning", label: "Returning from a break" },
            { value: "struggle", label: "I struggle with consistency" },
            { value: "consistent", label: "I train consistently" },
          ].map((option) => {
            const isSelected = form.watch("consistency") === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => form.setValue("consistency", option.value as any, { shouldValidate: true })}
                className={cn(
                  "glass-pill w-full h-16 flex items-center justify-start px-6 text-lg font-medium touch-target text-left",
                  isSelected && "selected"
                )}
              >
                {option.label}
              </button>
            );
          })}

          <AnimatePresence mode="wait">
            {form.formState.errors.consistency && (
              <motion.p
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="text-amber-400 text-sm flex items-center gap-2"
              >
                <span className="text-amber-400/60">↳</span>
                Select one to continue
              </motion.p>
            )}
          </AnimatePresence>
        </div>

        {/* Navigation */}
        <div className="flex gap-3 pt-4">
          <Button
            variant="ghost"
            onClick={onBack}
            className="h-14 w-14 rounded-xl p-0 flex-shrink-0 glass-pill text-zinc-400 hover:text-white"
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <Button
            className="glass-button flex-1 h-14 text-lg font-medium touch-target"
            onClick={form.handleSubmit(onNext)}
            data-testid="button-next-consistency"
          >
            Continue
          </Button>
        </div>
      </div>
    </motion.div>
  );
}


// --- Step 5: Experience Level (Liquid Glass) ---

function StepExperience({ defaultValues, onNext, onBack }: { defaultValues: any; onNext: (data: any) => void; onBack: () => void }) {
  const form = useForm({
    resolver: zodResolver(experienceSchema),
    defaultValues,
  });

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.4, ease: "circOut" }}
      className="w-full px-6 md:px-0"
    >
      <div className="space-y-8">
        {/* Header */}
        <div className="space-y-3">
          <h1 className="text-3xl md:text-4xl font-heading text-white font-medium tracking-tight">
            Your experience
          </h1>
          <p className="text-zinc-400 text-lg">
            We'll match your experience level.
          </p>
        </div>

        {/* Options */}
        <div className="space-y-3">
          {[
            { value: "brand_new", label: "Brand new" },
            { value: "under_1_year", label: "Under 1 year" },
            { value: "1_2_years", label: "1-2 years" },
            { value: "2_4_years", label: "2-4 years" },
            { value: "4_plus_years", label: "4+ years" },
          ].map((option) => {
            const isSelected = form.watch("experience") === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => form.setValue("experience", option.value as any, { shouldValidate: true })}
                className={cn(
                  "glass-pill w-full h-14 flex items-center justify-start px-6 text-lg font-medium touch-target",
                  isSelected && "selected"
                )}
              >
                {option.label}
              </button>
            );
          })}

          <AnimatePresence mode="wait">
            {form.formState.errors.experience && (
              <motion.p
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="text-amber-400 text-sm flex items-center gap-2"
              >
                <span className="text-amber-400/60">↳</span>
                Select one to continue
              </motion.p>
            )}
          </AnimatePresence>
        </div>

        {/* Navigation */}
        <div className="flex gap-3 pt-4">
          <Button
            variant="ghost"
            onClick={onBack}
            className="h-14 w-14 rounded-xl p-0 flex-shrink-0 glass-pill text-zinc-400 hover:text-white"
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <Button
            className="glass-button flex-1 h-14 text-lg font-medium touch-target"
            onClick={form.handleSubmit(onNext)}
            data-testid="button-next-experience"
          >
            Continue
          </Button>
        </div>
      </div>
    </motion.div>
  );
}


// --- Step 6: Equipment (Liquid Glass) ---

function StepEquipment({ defaultValues, onNext, onBack }: { defaultValues: any; onNext: (data: any) => void; onBack: () => void }) {
  const form = useForm({
    resolver: zodResolver(equipmentSchema),
    defaultValues: {
      equipment: defaultValues.equipment || [],
    },
  });

  const toggleEquipment = (equipValue: string) => {
    const currentEquip = form.getValues("equipment") || [];
    const newEquip = currentEquip.includes(equipValue)
      ? currentEquip.filter((e: string) => e !== equipValue)
      : [...currentEquip, equipValue];
    form.setValue("equipment", newEquip, { shouldValidate: true });
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.4, ease: "circOut" }}
      className="w-full px-6 md:px-0"
    >
      <div className="space-y-8">
        {/* Header */}
        <div className="space-y-3">
          <h1 className="text-3xl md:text-4xl font-heading text-white font-medium tracking-tight">
            Your equipment
          </h1>
          <p className="text-zinc-400 text-lg">
            Select everything you have access to.
          </p>
        </div>

        {/* Options - Multi-select, 2-col grid on desktop */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[
            { value: "barbell", label: "Barbell" },
            { value: "dumbbells", label: "Dumbbells" },
            { value: "cable_machine", label: "Cable Machine" },
            { value: "machines", label: "Machines" },
            { value: "bands", label: "Bands" },
            { value: "bodyweight_only", label: "Bodyweight Only" },
          ].map((option) => {
            const isSelected = (form.watch("equipment") || []).includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => toggleEquipment(option.value)}
                className={cn(
                  "glass-pill w-full h-14 flex items-center justify-center md:justify-start px-6 text-lg font-medium touch-target",
                  isSelected && "selected"
                )}
              >
                {option.label}
              </button>
            );
          })}

          <AnimatePresence mode="wait">
            {form.formState.errors.equipment && (
              <motion.p
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="text-amber-400 text-sm flex items-center gap-2"
              >
                <span className="text-amber-400/60">↳</span>
                Select at least one
              </motion.p>
            )}
          </AnimatePresence>
        </div>

        {/* Navigation */}
        <div className="flex gap-3 pt-4">
          <Button
            variant="ghost"
            onClick={onBack}
            className="h-14 w-14 rounded-xl p-0 flex-shrink-0 glass-pill text-zinc-400 hover:text-white"
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <Button
            className="glass-button flex-1 h-14 text-lg font-medium touch-target"
            onClick={form.handleSubmit(onNext)}
            data-testid="button-next-equipment"
          >
            Continue
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

// --- Step 8: Split + Days Combined (Liquid Glass) ---

function StepSplitDays({ defaultValues, onNext, onBack }: { defaultValues: { split: string; workoutDays: string[] }; onNext: (data: any) => void; onBack: () => void }) {
  const form = useForm({
    resolver: zodResolver(splitDaysSchema),
    defaultValues: {
      split: defaultValues.split || "",
      workoutDays: defaultValues.workoutDays || [],
    },
  });

  const selectedDays = form.watch("workoutDays") || [];

  const days = [
    { id: "M", label: "M" },
    { id: "T", label: "T" },
    { id: "W", label: "W" },
    { id: "Th", label: "T" },
    { id: "F", label: "F" },
    { id: "S", label: "S" },
    { id: "Su", label: "S" },
  ];

  const toggleDay = (dayId: string) => {
    const current = form.getValues("workoutDays") || [];
    const updated = current.includes(dayId)
      ? current.filter((d: string) => d !== dayId)
      : [...current, dayId];
    form.setValue("workoutDays", updated, { shouldValidate: true });
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.4, ease: "circOut" }}
      className="w-full px-6 md:px-0"
    >
      <div className="space-y-8">
        {/* Header */}
        <div className="space-y-3">
          <h1 className="text-3xl md:text-4xl font-heading text-white font-medium tracking-tight">
            Your split & schedule
          </h1>
          <p className="text-zinc-400 text-lg">
            Pick your split and the days you train.
          </p>
        </div>

        {/* Split Selection - 2-col grid */}
        <div className="space-y-3">
          <label className="text-sm text-zinc-400 ml-1">Split</label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {[
              { value: "full_body", label: "Full Body" },
              { value: "upper_lower", label: "Upper / Lower" },
              { value: "push_pull_legs", label: "Push / Pull / Legs" },
              { value: "upper_body_only", label: "Upper Body Only" },
              { value: "legs_only", label: "Legs Only" },
              { value: "custom", label: "Choose for me" },
            ].map((option) => {
              const isSelected = form.watch("split") === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => form.setValue("split", option.value as any, { shouldValidate: true })}
                  className={cn(
                    "glass-pill w-full h-14 flex items-center justify-center md:justify-start px-6 text-lg font-medium touch-target text-left",
                    isSelected && "selected"
                  )}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
          <AnimatePresence mode="wait">
            {form.formState.errors.split && (
              <motion.p
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="text-amber-400 text-sm flex items-center gap-2"
              >
                <span className="text-amber-400/60">↳</span>
                Pick a split to continue
              </motion.p>
            )}
          </AnimatePresence>
        </div>

        {/* Day Picker */}
        <div className="space-y-3">
          <label className="text-sm text-zinc-400 ml-1">Workout Days</label>
          <div className="flex justify-between gap-2" data-testid="input-workout-days">
            {days.map((day) => {
              const isSelected = selectedDays.includes(day.id);
              return (
                <button
                  key={day.id}
                  type="button"
                  onClick={() => toggleDay(day.id)}
                  className={cn(
                    "h-12 w-12 rounded-full flex items-center justify-center text-sm font-medium transition-all touch-target",
                    isSelected
                      ? "bg-white text-black"
                      : "glass-pill text-zinc-400 hover:text-white"
                  )}
                >
                  {day.label}
                </button>
              );
            })}
          </div>
          <AnimatePresence mode="wait">
            {form.formState.errors.workoutDays && (
              <motion.p
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="text-amber-400 text-sm flex items-center gap-2"
              >
                <span className="text-amber-400/60">↳</span>
                Pick at least one day
              </motion.p>
            )}
          </AnimatePresence>
        </div>

        {/* Navigation */}
        <div className="flex gap-3 pt-4">
          <Button
            variant="ghost"
            onClick={onBack}
            className="h-14 w-14 rounded-xl p-0 flex-shrink-0 glass-pill text-zinc-400 hover:text-white"
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <Button
            className="glass-button flex-1 h-14 text-lg font-medium touch-target"
            onClick={form.handleSubmit(onNext)}
            data-testid="button-next-split-days"
          >
            Continue
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

// --- Step 9: Plan Mode Selection ---

function StepPlanMode({ defaultValues, onNext, onBack }: { defaultValues: { planMode: string }; onNext: (data: { planMode: "" | "existing" | "scratch" }) => void; onBack: () => void }) {
  const [selected, setSelected] = useState(defaultValues.planMode || "");
  const [error, setError] = useState("");

  const options = [
    {
      value: "existing",
      title: "Use my existing plan",
      description: "I already have something and want Brandon to take it over",
    },
    {
      value: "scratch",
      title: "Start from scratch",
      description: "Let Brandon build me a plan based on my goals and schedule",
    },
  ];

  const handleSubmit = () => {
    if (!selected) {
      setError("Pick one to continue");
      return;
    }
    setError("");
    onNext({ planMode: selected as "existing" | "scratch" });
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.4, ease: "circOut" }}
      className="w-full px-6 md:px-0"
    >
      <div className="space-y-8">
        {/* Header */}
        <div className="space-y-3">
          <h1 className="text-3xl md:text-4xl font-heading text-white font-medium tracking-tight">
            How do you want to start?
          </h1>
          <p className="text-zinc-400 text-lg">
            Pick the option that best describes your situation.
          </p>
        </div>

        {/* Cards */}
        <div className="space-y-3">
          {options.map((option) => {
            const isSelected = selected === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => { setSelected(option.value); setError(""); }}
                className={cn(
                  "glass-pill w-full py-5 px-6 flex flex-col items-start gap-1.5 text-left touch-target",
                  isSelected && "selected"
                )}
              >
                <span className={cn("text-lg font-medium", isSelected ? "text-black" : "text-white")}>{option.title}</span>
                <span className={cn("text-sm", isSelected ? "text-black/70" : "text-zinc-400")}>{option.description}</span>
              </button>
            );
          })}

          <AnimatePresence mode="wait">
            {error && (
              <motion.p
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="text-amber-400 text-sm flex items-center gap-2"
              >
                <span className="text-amber-400/60">↳</span>
                {error}
              </motion.p>
            )}
          </AnimatePresence>
        </div>

        {/* Footer */}
        <p className="text-sm text-zinc-500 text-center">You can change this later.</p>

        {/* Navigation */}
        <div className="flex gap-3 pt-4">
          <Button
            variant="ghost"
            onClick={onBack}
            className="h-14 w-14 rounded-xl p-0 flex-shrink-0 glass-pill text-zinc-400 hover:text-white"
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <Button
            className="glass-button flex-1 h-14 text-lg font-medium touch-target"
            onClick={handleSubmit}
            data-testid="button-next-plan-mode"
          >
            Continue
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

// --- Step 10: Plan Detail (branching based on planMode) ---

// Shared image resize helper
const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const MAX_IMAGE_SIZE_MB = 10;
const MAX_IMAGE_DIMENSION = 2048;

function resizeImage(file: File, maxDimension: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    img.onload = () => {
      let { width, height } = img;
      if (width > maxDimension || height > maxDimension) {
        if (width > height) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        } else {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
      }
      canvas.width = width;
      canvas.height = height;
      ctx?.drawImage(img, 0, 0, width, height);
      const isPng = file.type === 'image/png';
      resolve(isPng ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.85));
    };

    img.onerror = () => reject(new Error('Failed to load image'));
    const reader = new FileReader();
    reader.onload = (e) => { img.src = e.target?.result as string; };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

function StepPlanDetail({ planMode, defaultValues, onNext, onBack }: {
  planMode: "existing" | "scratch";
  defaultValues: { notes: string; workoutImage: string | null; useExactPlan: boolean };
  onNext: (data: any) => void;
  onBack: () => void;
}) {
  const [notes, setNotes] = useState(defaultValues.notes || "");
  const [workoutImage, setWorkoutImage] = useState<string | null>(defaultValues.workoutImage || null);
  const [useExactPlan, setUseExactPlan] = useState(defaultValues.useExactPlan || false);
  const [imageError, setImageError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      setImageError('Please use PNG, JPEG, WEBP, or GIF');
      return;
    }
    if (file.size > MAX_IMAGE_SIZE_MB * 1024 * 1024) {
      setImageError(`Image must be under ${MAX_IMAGE_SIZE_MB}MB`);
      return;
    }
    setImageError(null);
    try {
      const base64 = await resizeImage(file, MAX_IMAGE_DIMENSION);
      setWorkoutImage(base64);
    } catch {
      setImageError('Failed to process image');
    }
  };

  const removeImage = () => {
    setWorkoutImage(null);
    setImageError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Shared photo upload UI
  const PhotoUpload = () => (
    <div className="space-y-3">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={handleImageSelect}
        className="hidden"
        data-testid="input-photo-file"
      />
      {!workoutImage ? (
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="w-full glass-input flex items-center justify-center gap-3 py-4 text-zinc-400 hover:text-white hover:border-zinc-600 transition-colors"
          data-testid="button-upload-photo"
        >
          <Camera className="h-5 w-5" />
          <span>Upload a photo of your plan</span>
        </button>
      ) : (
        <div className="glass-input p-2 flex items-center gap-3">
          <img src={workoutImage} alt="Uploaded workout" className="h-16 w-16 object-cover rounded-lg" />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-emerald-400">Photo attached</p>
            <p className="text-xs text-zinc-500">We'll use this to build your plan</p>
          </div>
          <button type="button" onClick={removeImage} className="p-2 text-zinc-500 hover:text-white transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>
      )}
      {imageError && <p className="text-sm text-red-400">{imageError}</p>}
    </div>
  );

  // --- 2A: Existing Plan ---
  if (planMode === "existing") {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.98 }}
        transition={{ duration: 0.4, ease: "circOut" }}
        className="w-full px-6 md:px-0"
      >
        <div className="space-y-8">
          <div className="space-y-3">
            <h1 className="text-3xl md:text-4xl font-heading text-white font-medium tracking-tight">
              Give Brandon your plan
            </h1>
            <p className="text-zinc-400 text-lg">
              Upload a photo or paste your current workout below.
            </p>
          </div>

          <PhotoUpload />

          <div className="flex items-center gap-4">
            <div className="flex-1 h-px bg-zinc-800" />
            <span className="text-zinc-600 text-sm">or type below</span>
            <div className="flex-1 h-px bg-zinc-800" />
          </div>

          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Paste your workout plan here..."
            className="glass-input w-full h-32 text-white placeholder:text-zinc-500 p-4 resize-none text-base"
            maxLength={3000}
            data-testid="textarea-plan-notes"
          />

          {/* Follow my plan exactly toggle */}
          <div className="flex items-center gap-2">
            <Checkbox
              id="useExactPlan"
              checked={useExactPlan}
              onCheckedChange={(checked) => setUseExactPlan(checked === true)}
              className="border-zinc-600 data-[state=checked]:bg-emerald-500 data-[state=checked]:border-emerald-500"
              data-testid="checkbox-use-exact-plan"
            />
            <label htmlFor="useExactPlan" className="text-sm text-zinc-300 cursor-pointer select-none">
              Follow my plan exactly
            </label>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-4 w-4 text-zinc-500 cursor-help" />
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[250px] text-center">
                  <p>Check this to have Brandon follow your workout exactly as written, without modifications.</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>

          <div className="flex gap-3 pt-4">
            <Button variant="ghost" onClick={onBack} className="h-14 w-14 rounded-xl p-0 flex-shrink-0 glass-pill text-zinc-400 hover:text-white">
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <Button
              className="glass-button flex-1 h-14 text-lg font-medium touch-target"
              onClick={() => onNext({ notes, workoutImage, useExactPlan })}
              data-testid="button-next-plan-detail"
            >
              Let Brandon configure this
            </Button>
          </div>
        </div>
      </motion.div>
    );
  }

  // --- 2B: Start from Scratch ---
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.4, ease: "circOut" }}
      className="w-full px-6 md:px-0"
    >
      <div className="space-y-8">
        <div className="space-y-3">
          <h1 className="text-3xl md:text-4xl font-heading text-white font-medium tracking-tight">
            Anything else Brandon should know?
          </h1>
          <p className="text-zinc-400 text-lg">
            Optional — Brandon will build your plan from your profile.
          </p>
        </div>

        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. bad shoulder, prefer supersets, hate leg press..."
          className="glass-input w-full h-32 text-white placeholder:text-zinc-500 p-4 resize-none text-base"
          maxLength={3000}
        />

        <div className="flex gap-3 pt-4">
          <Button variant="ghost" onClick={onBack} className="h-14 w-14 rounded-xl p-0 flex-shrink-0 glass-pill text-zinc-400 hover:text-white">
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <Button
            className="glass-button flex-1 h-14 text-lg font-medium touch-target"
            onClick={() => onNext({ notes })}
            data-testid="button-next-plan-detail"
          >
            Build my plan
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

// --- Step 12: Preferred Text Time ---

// Helper to parse 24h time string to hour/minute/period
function parseTime(time24: string): { hour: string; minute: string; period: "AM" | "PM" } {
  if (!time24) return { hour: "", minute: "", period: "AM" };
  const [h, m] = time24.split(":");
  const hour24 = parseInt(h, 10);
  const period = hour24 >= 12 ? "PM" : "AM";
  let hour12 = hour24 % 12;
  if (hour12 === 0) hour12 = 12;
  return { hour: hour12.toString(), minute: m, period };
}

// Helper to combine hour/minute/period to 24h format
function combineTime(hour: string, minute: string, period: "AM" | "PM"): string {
  if (!hour || !minute) return "";
  let hour24 = parseInt(hour, 10);
  if (period === "PM" && hour24 !== 12) hour24 += 12;
  if (period === "AM" && hour24 === 12) hour24 = 0;
  return `${hour24.toString().padStart(2, "0")}:${minute}`;
}

// Generate hour options (1-12)
const HOURS = Array.from({ length: 12 }, (_, i) => (i + 1).toString());

// Generate minute options (00-59)
const MINUTES = Array.from({ length: 60 }, (_, i) => i.toString().padStart(2, "0"));

// Common US timezones with friendly labels
const TIMEZONES = [
  { value: "America/New_York", label: "Eastern Time (ET)", offset: "UTC-5" },
  { value: "America/Chicago", label: "Central Time (CT)", offset: "UTC-6" },
  { value: "America/Denver", label: "Mountain Time (MT)", offset: "UTC-7" },
  { value: "America/Los_Angeles", label: "Pacific Time (PT)", offset: "UTC-8" },
  { value: "America/Phoenix", label: "Arizona (MST)", offset: "UTC-7" },
  { value: "America/Anchorage", label: "Alaska Time (AKT)", offset: "UTC-9" },
  { value: "Pacific/Honolulu", label: "Hawaii Time (HST)", offset: "UTC-10" },
  { value: "America/Puerto_Rico", label: "Atlantic Time (AST)", offset: "UTC-4" },
];

function StepTextTime({ defaultValues, onNext, onBack }: { defaultValues: any; onNext: (data: any) => void; onBack: () => void }) {
  // Parse initial time into hour/minute/period
  const initialTime = parseTime(defaultValues.preferredTextTime || "");
  const [hour, setHour] = useState(initialTime.hour);
  const [minute, setMinute] = useState(initialTime.minute);
  const [period, setPeriod] = useState<"AM" | "PM">(initialTime.period);
  const [timezone, setTimezone] = useState(defaultValues.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [error, setError] = useState("");

  const selectedTz = TIMEZONES.find(tz => tz.value === timezone);

  const handleSubmit = () => {
    if (!hour || !minute) {
      setError("Select a time");
      return;
    }
    if (!timezone) {
      setError("Select your timezone");
      return;
    }
    setError("");
    const preferredTextTime = combineTime(hour, minute, period);
    onNext({ preferredTextTime, timezone });
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.4, ease: "circOut" }}
      className="w-full px-6 md:px-0"
    >
      <div className="space-y-8">
        {/* Header */}
        <div className="space-y-3">
          <h1 className="text-3xl md:text-4xl font-heading text-white font-medium tracking-tight">
            Text time
          </h1>
          <p className="text-zinc-400 text-lg">
            Brandon will check in at this time.
          </p>
        </div>

        {/* Timezone Selector */}
        <div className="space-y-3">
          <label className="text-sm text-zinc-400 ml-1">Your Timezone</label>
          <Select value={timezone} onValueChange={setTimezone}>
            <SelectTrigger
              className="glass-input w-full h-14 text-white text-base"
              data-testid="input-timezone"
            >
              <SelectValue placeholder="Select your timezone">
                {selectedTz ? (
                  <span className="flex items-center gap-3">
                    <span>{selectedTz.label}</span>
                    <span className="text-zinc-500 text-sm">{selectedTz.offset}</span>
                  </span>
                ) : (
                  "Select your timezone"
                )}
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="bg-zinc-900 border-zinc-800 rounded-xl max-h-[280px]">
              {TIMEZONES.map((tz) => (
                <SelectItem
                  key={tz.value}
                  value={tz.value}
                  className="text-white hover:bg-white/10 focus:bg-white/10 focus:text-white cursor-pointer py-3"
                >
                  <span className="flex items-center justify-between w-full gap-4">
                    <span>{tz.label}</span>
                    <span className="text-zinc-500 text-sm">{tz.offset}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Time Selector */}
        <div className="space-y-3">
          <label className="text-sm text-zinc-400 ml-1">Preferred Time</label>
          <div className="flex gap-2" data-testid="input-text-time">
            {/* Hour */}
            <Select value={hour} onValueChange={setHour}>
              <SelectTrigger className="glass-input flex-1 h-14 text-white text-lg">
                <SelectValue placeholder="Hour" />
              </SelectTrigger>
              <SelectContent className="bg-zinc-900 border-zinc-800 rounded-xl max-h-[280px]">
                {HOURS.map((h) => (
                  <SelectItem
                    key={h}
                    value={h}
                    className="text-white hover:bg-white/10 focus:bg-white/10 focus:text-white cursor-pointer py-2 text-center"
                  >
                    {h}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <span className="flex items-center text-zinc-500 text-2xl font-light">:</span>

            {/* Minute */}
            <Select value={minute} onValueChange={setMinute}>
              <SelectTrigger className="glass-input flex-1 h-14 text-white text-lg">
                <SelectValue placeholder="Min" />
              </SelectTrigger>
              <SelectContent className="bg-zinc-900 border-zinc-800 rounded-xl max-h-[280px]">
                {MINUTES.map((m) => (
                  <SelectItem
                    key={m}
                    value={m}
                    className="text-white hover:bg-white/10 focus:bg-white/10 focus:text-white cursor-pointer py-2 text-center"
                  >
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* AM/PM */}
            <Select value={period} onValueChange={(v) => setPeriod(v as "AM" | "PM")}>
              <SelectTrigger className="glass-input w-24 h-14 text-white text-lg">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-zinc-900 border-zinc-800 rounded-xl">
                <SelectItem value="AM" className="text-white hover:bg-white/10 focus:bg-white/10 focus:text-white cursor-pointer py-2">
                  AM
                </SelectItem>
                <SelectItem value="PM" className="text-white hover:bg-white/10 focus:bg-white/10 focus:text-white cursor-pointer py-2">
                  PM
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Error */}
        <AnimatePresence mode="wait">
          {error && (
            <motion.p
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="text-amber-400 text-sm flex items-center gap-2"
            >
              <span className="text-amber-400/60">↳</span>
              {error}
            </motion.p>
          )}
        </AnimatePresence>

        {/* Navigation */}
        <div className="flex gap-3 pt-4">
          <Button
            variant="ghost"
            onClick={onBack}
            className="h-14 w-14 rounded-xl p-0 flex-shrink-0 glass-pill text-zinc-400 hover:text-white"
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <Button
            className="glass-button flex-1 h-14 text-lg font-medium touch-target"
            onClick={handleSubmit}
            data-testid="button-finish"
          >
            Finish
          </Button>
        </div>
      </div>
    </motion.div>
  );
}
