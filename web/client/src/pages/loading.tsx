import { useEffect } from "react";
import { useLocation } from "wouter";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { signupProgressApi } from "@/lib/api";

export default function Loading() {
  const [, setLocation] = useLocation();
  const { isAuthenticated, isLoading: authLoading } = useAuth();

  useEffect(() => {
    if (authLoading) return;

    // Not authenticated - go to login
    if (!isAuthenticated) {
      setLocation("/login");
      return;
    }

    // Authenticated - check signup progress and route accordingly
    signupProgressApi.get().then((progress) => {
      if (progress.signupStage === "complete") {
        setLocation("/dashboard");
      } else if (progress.signupStage === "payment_pending") {
        setLocation("/payment");
      } else if (progress.signupStage === "plan_pending") {
        // Plan pending: route to /onboarding which will detect profile exists
        // and jump to PLAN_GEN_CHAT step
        // Temporary fallback: users WITH draftPlanData still go to /setup-plan
        if (progress.draftPlanData?.plan) {
          setLocation("/setup-plan");
        } else {
          setLocation("/onboarding");
        }
      } else if (progress.signupStage === "onboarding_incomplete") {
        setLocation("/onboarding");
      } else {
        // Fallback to onboarding
        setLocation("/onboarding");
      }
    }).catch(() => {
      // If error, default to onboarding
      setLocation("/onboarding");
    });
  }, [isAuthenticated, authLoading, setLocation]);

  return (
    <div className="min-h-screen bg-black flex items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-white" />
    </div>
  );
}
