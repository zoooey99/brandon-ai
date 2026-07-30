import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Lock, Loader2, CheckCircle, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { useLocation, useSearch } from "wouter";
import { AppHeader } from "@/components/app-header";
import { signupProgressApi } from "@/lib/api";
import { useAuth, getAuthHeaders } from "@/hooks/use-auth";
import { trackEvent, trackPaymentError } from "@/lib/posthog";

let stripePromise: Promise<any> | null = null;

async function getStripe() {
  if (!stripePromise) {
    const response = await fetch("/api/stripe/config");
    const { publishableKey } = await response.json();
    stripePromise = loadStripe(publishableKey);
  }
  return stripePromise;
}

const darkAppearance = {
  theme: 'night' as const,
  variables: {
    colorPrimary: '#ffffff',
    colorBackground: '#18181b',
    colorText: '#fafafa',
    colorTextSecondary: '#a1a1aa',
    colorTextPlaceholder: '#52525b',
    colorDanger: '#ef4444',
    colorIcon: '#a1a1aa',
    colorIconHover: '#ffffff',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSizeBase: '14px',
    spacingUnit: '4px',
    borderRadius: '8px',
    focusBoxShadow: '0 0 0 2px rgba(255,255,255,0.2)',
    focusOutline: 'none',
  },
  rules: {
    '.Tab': {
      backgroundColor: '#27272a',
      border: '1px solid #3f3f46',
    },
    '.Tab--selected': {
      backgroundColor: '#3f3f46',
      borderColor: '#ffffff',
    },
    '.Tab:hover': {
      backgroundColor: '#3f3f46',
    },
    '.Input': {
      backgroundColor: '#27272a',
      border: '1px solid #3f3f46',
    },
    '.Input:focus': {
      borderColor: '#71717a',
    },
    '.Label': {
      color: '#a1a1aa',
    },
    '.Block': {
      backgroundColor: '#27272a',
      border: '1px solid #3f3f46',
    },
    // Accordion item styling for payment method selection
    '.AccordionItem': {
      backgroundColor: '#27272a',
      border: '1px solid #3f3f46',
      borderRadius: '12px',
    },
    '.AccordionItem--selected': {
      backgroundColor: '#18181b',
      border: '2px solid #10b981',
      boxShadow: '0 0 0 1px #10b981',
    },
  },
};

interface PriceOption {
  price_id: string;
  product_name: string;
  unit_amount: number;
  currency: string;
  recurring: { interval: string; interval_count: number } | null;
}

interface CouponInfo {
  id: string;
  percentOff: number | null;
  amountOff: number | null;
  duration: string;
  durationInMonths: number | null;
  valid: boolean;
}

interface CheckoutFormProps {
  onSuccess: () => void;
  selectedPriceId: string | null;
  selectedPlan: "monthly" | "yearly";
  selectedAmount: number | undefined;
  couponId: string | null;
  setupCustomerId: string;
  // Coupon UI props
  couponCode: string;
  setCouponCode: (code: string) => void;
  couponLoading: boolean;
  couponError: string | null;
  setCouponError: (error: string | null) => void;
  couponInfo: CouponInfo | null;
  setCouponInfo: (info: CouponInfo | null) => void;
  validateCoupon: () => void;
}

function CheckoutForm({
  onSuccess,
  selectedPriceId,
  selectedPlan,
  selectedAmount,
  couponId,
  setupCustomerId,
  couponCode,
  setCouponCode,
  couponLoading,
  couponError,
  setCouponError,
  couponInfo,
  setCouponInfo,
  validateCoupon,
}: CheckoutFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements || !selectedPriceId) {
      console.error("[Payment] Missing required:", { stripe: !!stripe, elements: !!elements, selectedPriceId });
      return;
    }

    setProcessing(true);
    setError(null);
    trackEvent('payment_initiated', { plan: selectedPlan });
    console.log("[Payment] Starting SetupIntent payment flow...");

    // 1. Validate the form
    const { error: submitError } = await elements.submit();
    if (submitError) {
      console.error("[Payment] Submit error:", submitError);
      trackPaymentError(submitError, {
        plan: selectedPlan,
        type: submitError.type,
        decline_code: (submitError as any).decline_code,
      });
      setError(submitError.message || "Payment failed");
      setProcessing(false);
      return;
    }
    console.log("[Payment] Form validated successfully");

    // 2. Confirm the SetupIntent (handles both inline and redirect methods)
    const { error: setupError, setupIntent } = await stripe.confirmSetup({
      elements,
      redirect: 'if_required',
      confirmParams: {
        return_url: `${window.location.origin}/payment?setup_return=true&priceId=${selectedPriceId}&plan=${selectedPlan}${couponId ? `&couponId=${couponId}` : ''}`,
      },
    });

    if (setupError) {
      console.error("[Payment] Setup error:", setupError);
      trackPaymentError(setupError, {
        plan: selectedPlan,
        type: setupError.type,
        decline_code: (setupError as any).decline_code,
      });
      setError(setupError.message || "Failed to process payment method");
      setProcessing(false);
      return;
    }

    // If we get here, it was an inline method (card, Apple Pay, Google Pay)
    // Redirect methods won't reach here — user gets redirected away
    console.log("[Payment] SetupIntent confirmed inline:", setupIntent.id);
    const paymentMethodId = typeof setupIntent.payment_method === 'string'
      ? setupIntent.payment_method
      : setupIntent.payment_method?.id;

    if (!paymentMethodId) {
      setError("No payment method returned. Please try again.");
      setProcessing(false);
      return;
    }

    // 3. Create subscription with the payment method
    await createSubscription(paymentMethodId, selectedPriceId, couponId, selectedPlan, onSuccess, setError, setProcessing);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <PaymentElement
        options={{
          layout: {
            type: 'accordion',
            defaultCollapsed: true,
            radios: false,
            spacedAccordionItems: true,
          },
          paymentMethodOrder: ['apple_pay', 'google_pay', 'card', 'amazon_pay'],
          wallets: {
            applePay: 'auto',
            googlePay: 'auto',
          },
          ...(selectedAmount ? {
            applePay: {
              recurringPaymentRequest: {
                paymentDescription: 'Brandon AI Coaching',
                managementURL: 'https://app.brandonai.co/dashboard',
                regularBilling: {
                  amount: selectedAmount || 0,
                  label: `Brandon ${selectedPlan === 'yearly' ? 'Yearly' : 'Monthly'}`,
                  recurringPaymentIntervalUnit: selectedPlan === 'yearly' ? 'year' : 'month',
                  recurringPaymentIntervalCount: 1,
                  recurringPaymentStartDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                },
                trialBilling: {
                  amount: 0,
                  label: 'Free Trial',
                  recurringPaymentIntervalUnit: 'day',
                  recurringPaymentIntervalCount: 7,
                },
              },
            },
          } : {}),
        }}
      />

      {/* Coupon Code - Single row: Promo | Input | Apply */}
      <div className="space-y-1.5">
        {couponInfo ? (
          /* Success state - coupon applied */
          <div className="flex items-center h-11 bg-emerald-500/[0.06] border border-emerald-500/20 rounded-lg overflow-hidden">
            <div className="flex items-center gap-2 px-3 h-full border-r border-emerald-500/20">
              <Check className="h-3.5 w-3.5 text-emerald-400" />
              <span className="text-emerald-400 text-sm font-medium">
                {couponInfo.percentOff === 100 && couponInfo.duration === "once"
                  ? "+1 month free"
                  : couponInfo.percentOff === 100
                  ? "100% off"
                  : couponInfo.percentOff
                  ? `${couponInfo.percentOff}% off`
                  : couponInfo.amountOff
                  ? `$${couponInfo.amountOff / 100} off`
                  : "Applied"}
              </span>
            </div>
            <div className="flex-1 flex items-center justify-between px-3">
              <span className="text-white text-sm font-medium tracking-wide">
                {couponCode}
              </span>
              <span className="text-zinc-500 text-xs">
                added
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                setCouponInfo(null);
                setCouponCode("");
              }}
              className="h-full px-3 text-zinc-500 hover:text-white hover:bg-white/5 transition-colors"
              aria-label="Remove coupon"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        ) : (
          /* Input state - single row */
          <div className={`
            flex items-center h-11 rounded-lg overflow-hidden
            bg-[#27272a] border transition-all duration-200
            ${couponError
              ? 'border-red-500/50'
              : 'border-[#3f3f46] focus-within:border-zinc-500 hover:border-zinc-600'
            }
          `}>
            <span className="px-3 text-zinc-500 text-sm font-medium whitespace-nowrap">
              Promo
            </span>
            <input
              type="text"
              value={couponCode}
              onChange={(e) => {
                setCouponCode(e.target.value.toUpperCase());
                setCouponError(null);
              }}
              placeholder="Enter code"
              className="flex-1 h-full bg-transparent text-white text-sm outline-none placeholder:text-zinc-600"
              data-testid="input-coupon-code"
            />
            <button
              type="button"
              onClick={validateCoupon}
              disabled={couponLoading || !couponCode.trim()}
              className={`
                h-full px-4 text-sm font-medium transition-all duration-200
                ${couponCode.trim()
                  ? 'bg-white text-black hover:bg-zinc-200'
                  : 'bg-zinc-700/50 text-zinc-500 cursor-not-allowed'
                }
                disabled:opacity-50
              `}
              data-testid="button-validate-coupon"
            >
              {couponLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                'Apply'
              )}
            </button>
          </div>
        )}

        {couponError && (
          <p className="text-red-400 text-xs">{couponError}</p>
        )}
      </div>

      {error && (
        <p className="text-red-400 text-sm text-center">{error}</p>
      )}

      <Button
        type="submit"
        disabled={!stripe || processing}
        className="w-full h-12 bg-emerald-500 hover:bg-emerald-400 text-black font-semibold rounded-lg transition-colors"
        data-testid="button-pay"
      >
        {processing ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : couponInfo?.percentOff === 100 && couponInfo?.duration === "once" ? (
          "Start 1-Month Free Trial"
        ) : couponInfo ? (
          "Start Free Trial"
        ) : (
          "Start 7-Day Free Trial"
        )}
      </Button>

      <p className="text-center text-zinc-500 text-sm">
        You won't be charged today
      </p>
    </form>
  );
}

// Shared helper to create subscription after getting a payment method
async function createSubscription(
  paymentMethodId: string,
  priceId: string,
  couponId: string | null,
  plan: string,
  onSuccess: () => void,
  setError: (err: string | null) => void,
  setProcessing: (p: boolean) => void,
) {
  try {
    console.log("[Payment] Creating subscription with PM:", paymentMethodId, "Price:", priceId, "Coupon:", couponId);
    const authHeaders = await getAuthHeaders();
    const response = await fetch("/api/stripe/create-subscription-with-pm", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        priceId,
        paymentMethodId,
        couponId: couponId || undefined,
      }),
    });

    const data = await response.json();
    console.log("[Payment] Server response:", response.status, data);

    if (!response.ok) {
      trackPaymentError(new Error(data.error || 'Subscription failed'), {
        plan,
        type: data.type || 'api_error',
        decline_code: data.decline_code,
      });
      setError(data.error || "Failed to start subscription");
      setProcessing(false);
      return;
    }

    // Success!
    trackEvent('subscription_created', { plan });
    if (typeof window.fbq === 'function') {
      window.fbq('track', 'Subscribe', { plan });
    }
    onSuccess();
  } catch (err) {
    console.error("Failed to create subscription:", err);
    trackPaymentError(err, { plan, type: 'network_error' });
    setError("Failed to start subscription. Please try again.");
    setProcessing(false);
  }
}

export default function Payment() {
  const [selectedPlan, setSelectedPlan] = useState<"monthly" | "yearly">("yearly");
  const [prices, setPrices] = useState<PriceOption[]>([]);
  const [stripeInstance, setStripeInstance] = useState<any>(null);
  const [success, setSuccess] = useState(false);

  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const { isAuthenticated, isLoading: authLoading } = useAuth();

  const [couponCode, setCouponCode] = useState("");
  const [couponLoading, setCouponLoading] = useState(false);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [couponInfo, setCouponInfo] = useState<CouponInfo | null>(null);

  // SetupIntent state
  const [setupClientSecret, setSetupClientSecret] = useState<string | null>(null);
  const [setupCustomerId, setSetupCustomerId] = useState<string | null>(null);
  const [customerSessionSecret, setCustomerSessionSecret] = useState<string | null>(null);
  const [redirectError, setRedirectError] = useState<string | null>(null);
  const [redirectProcessing, setRedirectProcessing] = useState(false);
  const redirectHandled = useRef(false);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      window.location.href = "/login?returnTo=/payment";
    }
  }, [authLoading, isAuthenticated]);

  useEffect(() => {
    if (authLoading || !isAuthenticated || success) return;

    signupProgressApi.get().then((progress) => {
      if (progress.signupStage === "complete") {
        setLocation("/dashboard");
      } else if (progress.signupStage === "plan_pending") {
        setLocation("/setup-plan");
      } else if (progress.signupStage === "onboarding_incomplete") {
        setLocation("/onboarding");
      }
    }).catch(() => {});
  }, [authLoading, isAuthenticated, setLocation, success]);

  // Fetch prices and Stripe instance
  useEffect(() => {
    fetch("/api/stripe/prices")
      .then((res) => res.json())
      .then((data) => {
        if (data.prices) {
          setPrices(data.prices);
        }
      })
      .catch(console.error);

    getStripe().then(setStripeInstance);
  }, []);

  // Create SetupIntent on mount (skip for fully free coupons)
  useEffect(() => {
    if (authLoading || !isAuthenticated) return;

    // Check if this is a redirect return — don't create a new SetupIntent
    const params = new URLSearchParams(searchString);
    if (params.get("setup_return") === "true") return;

    const fetchSetupIntent = async () => {
      try {
        const authHeaders = await getAuthHeaders();
        const response = await fetch("/api/stripe/create-setup-intent", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders },
        });
        const data = await response.json();
        if (response.ok) {
          setSetupClientSecret(data.clientSecret);
          setSetupCustomerId(data.customerId);
          setCustomerSessionSecret(data.customerSessionClientSecret);
        } else {
          console.error("[Payment] Failed to create SetupIntent:", data);
        }
      } catch (err) {
        console.error("[Payment] Error creating SetupIntent:", err);
      }
    };
    fetchSetupIntent();
  }, [authLoading, isAuthenticated]);

  // Handle redirect return from payment methods like Amazon Pay
  useEffect(() => {
    if (!stripeInstance || redirectHandled.current) return;

    const params = new URLSearchParams(searchString);
    if (params.get("setup_return") !== "true") return;

    const clientSecret = params.get("setup_intent_client_secret");
    if (!clientSecret) return;

    redirectHandled.current = true;
    setRedirectProcessing(true);

    const handleRedirectReturn = async () => {
      try {
        const { setupIntent, error } = await stripeInstance.retrieveSetupIntent(clientSecret);

        if (error) {
          setRedirectError(error.message || "Payment setup failed");
          setRedirectProcessing(false);
          return;
        }

        if (setupIntent.status === 'succeeded') {
          const paymentMethodId = typeof setupIntent.payment_method === 'string'
            ? setupIntent.payment_method
            : setupIntent.payment_method?.id;

          const priceId = params.get("priceId");
          const plan = params.get("plan") || "yearly";
          const couponId = params.get("couponId") || null;

          if (!paymentMethodId || !priceId) {
            setRedirectError("Missing payment details. Please try again.");
            setRedirectProcessing(false);
            return;
          }

          await createSubscription(
            paymentMethodId,
            priceId,
            couponId,
            plan,
            () => setSuccess(true),
            setRedirectError,
            setRedirectProcessing,
          );
        } else {
          setRedirectError(`Payment setup ${setupIntent.status}. Please try again.`);
          setRedirectProcessing(false);
        }
      } catch (err) {
        console.error("[Payment] Redirect return error:", err);
        setRedirectError("Something went wrong. Please try again.");
        setRedirectProcessing(false);
      }
    };

    handleRedirectReturn();
  }, [stripeInstance, searchString]);

  const monthlyPrice = prices.find((p) => p.recurring?.interval === "month");
  const yearlyPrice = prices.find((p) => p.recurring?.interval === "year");

  // Get the selected price ID and amount based on plan
  const selectedPriceId = selectedPlan === "monthly" ? monthlyPrice?.price_id : yearlyPrice?.price_id;
  const selectedAmount = selectedPlan === "monthly" ? monthlyPrice?.unit_amount : yearlyPrice?.unit_amount;

  // Plan change just updates local state - Elements will re-render with new amount
  const handlePlanChange = (plan: "monthly" | "yearly") => {
    setSelectedPlan(plan);
  };

  const validateCoupon = async () => {
    if (!couponCode.trim()) return;

    setCouponLoading(true);
    setCouponError(null);
    setCouponInfo(null);

    try {
      const authHeaders = await getAuthHeaders();

      const response = await fetch("/api/stripe/validate-coupon", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ couponId: couponCode.trim().toUpperCase() }),
      });

      const data = await response.json();

      if (!response.ok) {
        setCouponError(data.error || "Invalid coupon code");
        setCouponLoading(false);
        return;
      }

      // Coupon is valid
      console.log("[Coupon] Validated:", data);
      setCouponInfo({
        id: data.id,
        percentOff: data.percent_off,
        amountOff: data.amount_off,
        duration: data.duration,
        durationInMonths: data.duration_in_months ?? null,
        valid: true,
      });

      // Force monthly plan for 100% off "once" coupons (1 month free)
      // This prevents users from getting a free year on yearly plan
      if (data.percent_off === 100 && data.duration === "once") {
        console.log("[Coupon] 100% off 'once' coupon detected - forcing monthly plan");
        setSelectedPlan("monthly");
      }
    } catch (error) {
      setCouponError("Failed to validate coupon");
    } finally {
      setCouponLoading(false);
    }
  };


  // 100% off coupon — skip credit card entirely regardless of duration
  const isFullyFree = couponInfo?.percentOff === 100;

  const [freeProcessing, setFreeProcessing] = useState(false);
  const [freeError, setFreeError] = useState<string | null>(null);

  const handleFreeSubscription = async () => {
    if (!selectedPriceId || !couponInfo) return;
    setFreeProcessing(true);
    setFreeError(null);
    try {
      const authHeaders = await getAuthHeaders();
      const response = await fetch("/api/stripe/create-subscription-with-pm", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({
          priceId: selectedPriceId,
          couponId: couponInfo.id,
        }),
      });
      const data = await response.json();
      if (response.ok) {
        trackEvent('subscription_created', { plan: selectedPlan });
        if (typeof window.fbq === 'function') {
          window.fbq('track', 'Subscribe', { plan: selectedPlan });
        }
        setSuccess(true);
      } else {
        setFreeError(data.error || "Failed to start subscription");
      }
    } catch (err) {
      console.error("Failed to create free subscription:", err);
      setFreeError("Failed to start subscription. Please try again.");
    } finally {
      setFreeProcessing(false);
    }
  };

  const monthlyAmount = monthlyPrice ? monthlyPrice.unit_amount / 100 : 15;
  const yearlyAmount = yearlyPrice ? yearlyPrice.unit_amount / 100 : 90;
  const yearlyMonthlyEquivalent = (yearlyAmount / 12).toFixed(2);
  const yearlySavings = Math.round((monthlyAmount * 12 - yearlyAmount) / (monthlyAmount * 12) * 100);

  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => {
        setLocation("/loading");
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [success, setLocation]);

  if (success) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center"
        >
          <motion.svg
            className="w-16 h-16 mx-auto mb-6"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <motion.path
              d="M5 12l5 5L20 7"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.5, ease: "easeOut" }}
              className="text-emerald-500"
            />
          </motion.svg>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="text-white text-xl font-medium"
          >
            You're in
          </motion.p>
        </motion.div>
      </div>
    );
  }

  // Show loading state during redirect return processing
  if (redirectProcessing) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-500 mb-4" />
        <p className="text-white text-lg font-medium">Completing setup...</p>
        <p className="text-zinc-500 text-sm mt-2">Please wait while we finalize your subscription.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black flex flex-col">
      <AppHeader showSubscriptionManagement={false} />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="flex-1 flex flex-col items-center px-6 py-8"
      >
        <div className="w-full max-w-[320px] sm:max-w-sm space-y-6">

          {/* Header */}
          <div className="text-center space-y-2">
            <h1 className="text-2xl font-semibold text-white">
              Start your free trial
            </h1>
            <p className="text-zinc-400">
              Try Brandon free for 7 days. Cancel anytime.
            </p>
          </div>

          {/* Plan Selection Card - combines toggle and price */}
          <div className="max-w-[260px] mx-auto glass-card p-5 space-y-4">
            {/* Plan Toggle */}
            <div className="flex justify-center">
              <div className="flex bg-zinc-800 rounded-lg p-1">
                <button
                  onClick={() => handlePlanChange("monthly")}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                    selectedPlan === "monthly"
                      ? "bg-white text-black"
                      : "text-zinc-400 hover:text-white"
                  }`}
                  data-testid="plan-monthly"
                >
                  Monthly
                </button>
                <button
                  onClick={() => handlePlanChange("yearly")}
                  disabled={couponInfo?.percentOff === 100 && couponInfo?.duration === "once"}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-1.5 ${
                    selectedPlan === "yearly"
                      ? "bg-white text-black"
                      : couponInfo?.percentOff === 100 && couponInfo?.duration === "once"
                      ? "text-zinc-600 cursor-not-allowed"
                      : "text-zinc-400 hover:text-white"
                  }`}
                  data-testid="plan-yearly"
                >
                  Yearly
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                    selectedPlan === "yearly"
                      ? "bg-emerald-100 text-emerald-700"
                      : couponInfo?.percentOff === 100 && couponInfo?.duration === "once"
                      ? "bg-zinc-700 text-zinc-500"
                      : "bg-emerald-500/20 text-emerald-400"
                  }`}>
                    -{yearlySavings}%
                  </span>
                </button>
              </div>
            </div>

            {/* Price Display */}
            <div className="text-center">
              <div className="text-3xl font-bold text-white">
                ${selectedPlan === "yearly" ? (yearlyAmount / 12).toFixed(2) : monthlyAmount}
                <span className="text-base font-normal text-zinc-500">
                  /mo
                </span>
              </div>
              {selectedPlan === "yearly" && (
                <p className="text-xs text-zinc-500 mt-1">
                  ${yearlyAmount} billed annually
                </p>
              )}
            </div>
          </div>

          {/* Benefits Card */}
          <div className="glass-card p-4 space-y-3">
            <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">What you get</p>
            <ul className="space-y-2">
              {[
                "AI-generated workout plan",
                "24/7 AI coaching",
                "Daily check-ins",
                "Unlimited plan edits",
              ].map((feature) => (
                <li key={feature} className="flex items-center gap-2 text-sm text-zinc-300">
                  <Check className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0" />
                  {feature}
                </li>
              ))}
            </ul>
          </div>

          {/* Redirect error */}
          {redirectError && (
            <p className="text-red-400 text-sm text-center">{redirectError}</p>
          )}

          {/* Payment Form */}
          {isFullyFree ? (
            <div className="space-y-6">
              {/* Coupon applied banner */}
              <div className="flex items-center h-11 bg-emerald-500/[0.06] border border-emerald-500/20 rounded-lg overflow-hidden">
                <div className="flex items-center gap-2 px-3 h-full border-r border-emerald-500/20">
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                  <span className="text-emerald-400 text-sm font-medium">
                    {couponInfo?.durationInMonths
                      ? `${couponInfo.durationInMonths} months free`
                      : couponInfo?.duration === 'once'
                      ? '1 month free'
                      : '100% off'}
                  </span>
                </div>
                <div className="flex-1 flex items-center justify-between px-3">
                  <span className="text-white text-sm font-medium tracking-wide">
                    {couponCode}
                  </span>
                  <span className="text-zinc-500 text-xs">added</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setCouponInfo(null);
                    setCouponCode("");
                  }}
                  className="h-full px-3 text-zinc-500 hover:text-white hover:bg-white/5 transition-colors"
                  aria-label="Remove coupon"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <p className="text-center text-zinc-400 text-sm">
                {couponInfo?.durationInMonths
                  ? `You're covered for ${couponInfo.durationInMonths} months — no card needed.`
                  : couponInfo?.duration === 'once'
                  ? "You're covered for 1 month — no card needed."
                  : "You're covered — no card needed."}
              </p>

              {freeError && (
                <p className="text-red-400 text-sm text-center">{freeError}</p>
              )}

              <Button
                onClick={handleFreeSubscription}
                disabled={freeProcessing || !selectedPriceId}
                className="w-full h-12 bg-emerald-500 hover:bg-emerald-400 text-black font-semibold rounded-lg transition-colors"
                data-testid="button-free-start"
              >
                {freeProcessing ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  "Start for Free"
                )}
              </Button>

              <p className="text-center text-zinc-500 text-sm">
                No credit card required
              </p>
            </div>
          ) : stripeInstance && setupClientSecret ? (
            <Elements
              stripe={stripeInstance}
              options={{
                clientSecret: setupClientSecret,
                appearance: darkAppearance,
                ...(customerSessionSecret ? { customerSessionClientSecret: customerSessionSecret } : {}),
              }}
            >
              <CheckoutForm
                onSuccess={() => setSuccess(true)}
                selectedPriceId={selectedPriceId || null}
                selectedPlan={selectedPlan}
                selectedAmount={selectedAmount}
                couponId={couponInfo?.id || null}
                setupCustomerId={setupCustomerId || ""}
                couponCode={couponCode}
                setCouponCode={setCouponCode}
                couponLoading={couponLoading}
                couponError={couponError}
                setCouponError={setCouponError}
                couponInfo={couponInfo}
                setCouponInfo={setCouponInfo}
                validateCoupon={validateCoupon}
              />
            </Elements>
          ) : !isFullyFree ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
            </div>
          ) : null}

          {/* Trust Footer */}
          <div className="text-center pt-4 border-t border-zinc-800/50">
            <div className="flex items-center justify-center gap-2 text-zinc-500 text-sm">
              <Lock className="h-4 w-4" />
              <span>Secure checkout powered by Stripe</span>
            </div>
          </div>

        </div>
      </motion.div>
    </div>
  );
}
