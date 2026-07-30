import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { identifyUser, resetPostHog, trackEvent, trackAuthError, trackApiError } from "@/lib/posthog";
import type { User } from "@shared/models/auth";
import type { Session } from "@supabase/supabase-js";

async function fetchUser(session: Session | null): Promise<User | null> {
  if (!session) return null;

  const response = await fetch("/api/auth/user", {
    headers: {
      Authorization: `Bearer ${session.access_token}`,
    },
  });

  if (response.status === 401) {
    return null;
  }

  if (!response.ok) {
    const error = new Error(`${response.status}: ${response.statusText}`);
    trackApiError('/api/auth/user', 'GET', response.status, error);
    throw error;
  }

  return response.json();
}

export function useAuth() {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setSessionLoading(false);
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
    });

    return () => subscription.unsubscribe();
  }, [queryClient]);

  const { data: user, isLoading: userLoading } = useQuery<User | null>({
    queryKey: ["/api/auth/user", session?.access_token],
    queryFn: () => fetchUser(session),
    enabled: !sessionLoading,
    retry: false,
    staleTime: 1000 * 60 * 5,
  });

  // Track if we've identified this user to PostHog
  const identifiedUserRef = useRef<string | null>(null);

  // Identify user to PostHog when they log in
  useEffect(() => {
    if (user && user.id !== identifiedUserRef.current) {
      const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ') || undefined;
      identifyUser(user.id, {
        email: user.email ?? undefined,
        name: fullName,
      });
      trackEvent('signup_completed', { provider: 'google' });
      identifiedUserRef.current = user.id;
    }
  }, [user]);

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await supabase.auth.signOut();
    },
    onSuccess: () => {
      resetPostHog();
      identifiedUserRef.current = null;
      queryClient.setQueryData(["/api/auth/user"], null);
      window.location.href = "/";
    },
    onError: (error) => {
      trackAuthError('logout', error);
    },
  });

  return {
    user,
    session,
    isLoading: sessionLoading || userLoading,
    isAuthenticated: !!session && !!user,
    logout: logoutMutation.mutate,
    isLoggingOut: logoutMutation.isPending,
  };
}

// Helper to get auth headers for API calls
export async function getAuthHeaders(): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session ? { Authorization: `Bearer ${session.access_token}` } : {};
}
