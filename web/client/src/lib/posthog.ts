import posthog from 'posthog-js';

const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
const POSTHOG_HOST = '/ingest'; // Proxied through our server to bypass ad blockers

// Initialize PostHog
export function initPostHog() {
  if (typeof window === 'undefined' || !POSTHOG_KEY) return;

  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    capture_pageview: true,
    capture_pageleave: true,
    autocapture: true,
    // Session recording
    disable_session_recording: false,
    // Don't track localhost in development
    loaded: (posthog) => {
      if (import.meta.env.DEV) {
        posthog.opt_out_capturing();
      }
    },
  });
}

// Identify user after login
export function identifyUser(userId: string, properties?: {
  email?: string;
  name?: string;
  phone?: string;
}) {
  posthog.identify(userId, properties);
}

// Reset on logout
export function resetPostHog() {
  posthog.reset();
}

// Track custom events
export function trackEvent(eventName: string, properties?: Record<string, unknown>) {
  posthog.capture(eventName, properties);
}

// Error tracking helpers
export function trackError(
  errorType: 'api' | 'auth' | 'payment' | 'plan_generation' | 'workout_save' | 'sync' | 'unknown',
  error: unknown,
  context?: Record<string, unknown>
) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorStack = error instanceof Error ? error.stack : undefined;

  posthog.capture(`${errorType}_error`, {
    error_message: errorMessage,
    error_stack: errorStack,
    ...context,
  });
}

export function trackApiError(
  endpoint: string,
  method: string,
  status: number | undefined,
  error: unknown
) {
  trackError('api', error, {
    endpoint,
    method,
    status,
  });
}

export function trackAuthError(type: string, error: unknown) {
  trackError('auth', error, { auth_type: type });
}

export function trackPaymentError(
  error: unknown,
  context: { plan?: string; decline_code?: string; type?: string }
) {
  trackError('payment', error, context);
}

export function trackPlanGenerationError(error: unknown, retryCount?: number) {
  trackError('plan_generation', error, { retry_count: retryCount });
}

export function trackWorkoutSaveError(error: unknown, context: { workout_id?: string; sets_at_risk?: number }) {
  trackError('workout_save', error, context);
}

export { posthog };
