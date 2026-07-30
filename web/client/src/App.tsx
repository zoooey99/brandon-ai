import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import Loading from "@/pages/loading";
import Login from "@/pages/login";
import Legal from "@/pages/legal";
import Onboarding from "@/pages/onboarding";
import Payment from "@/pages/payment";
import SetupPlan from "@/pages/setup-plan";
import Dashboard from "@/pages/dashboard";
import WorkoutTracker from "@/pages/workout-tracker";
import PlanDraftReview from "@/pages/plan-draft-review";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/loading" component={Loading} />
      <Route path="/login" component={Login} />
      <Route path="/legal" component={Legal} />
      <Route path="/onboarding" component={Onboarding} />
      <Route path="/payment" component={Payment} />
      <Route path="/setup-plan" component={SetupPlan} />
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/track/:token" component={WorkoutTracker} />
      <Route path="/plan/draft/:token" component={PlanDraftReview} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
