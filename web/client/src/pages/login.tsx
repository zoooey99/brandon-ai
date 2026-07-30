import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { trackEvent, trackAuthError } from "@/lib/posthog";

export default function Login() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { isAuthenticated, isLoading } = useAuth();
  const [isSigningIn, setIsSigningIn] = useState(false);

  // Track page view
  useEffect(() => {
    trackEvent('get_started_page_viewed');
  }, []);

  // Redirect if already authenticated - go to loading page which handles stage-based routing
  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      setLocation("/loading");
    }
  }, [isAuthenticated, isLoading, setLocation]);

  const handleGoogleSignIn = async () => {
    setIsSigningIn(true);
    trackEvent('signup_started', { provider: 'google' });
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          // Redirect to loading page which handles stage-based routing
          redirectTo: `${window.location.origin}/loading`,
        },
      });

      if (error) {
        throw error;
      }
    } catch (error: any) {
      trackAuthError('google_signin', error);
      toast({
        title: "Sign in failed",
        description: error.message || "Unable to sign in with Google",
        variant: "destructive",
      });
      setIsSigningIn(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black">
        <div className="text-white">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-black px-4 relative overflow-hidden">
      {/* Subtle background glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-white/[0.02] rounded-full blur-[100px] pointer-events-none" />

      {/* Glass card container */}
      <div className="w-full max-w-md glass-card p-8 space-y-8 text-center relative z-10">
        {/* Logo */}
        <div className="flex items-center justify-center gap-2">
          <span className="font-heading font-black text-4xl tracking-tighter uppercase text-white">
            Brandon
          </span>
          <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.8)] animate-pulse mt-0.5"></div>
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-white">Welcome</h1>
          <p className="text-zinc-400">Sign in to start your fitness journey</p>
        </div>

        {/* Google Sign In Button */}
        <Button
          onClick={handleGoogleSignIn}
          disabled={isSigningIn}
          className="glass-button w-full h-14 font-medium text-base flex items-center justify-center gap-3"
        >
          {isSigningIn ? (
            <span>Signing in...</span>
          ) : (
            <>
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path
                  fill="currentColor"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="currentColor"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="currentColor"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="currentColor"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              Continue with Google
            </>
          )}
        </Button>

        <p className="text-xs text-zinc-500">
          By continuing, you agree to our{" "}
          <Link href="/legal" className="underline hover:text-zinc-300 transition-colors">
            Terms of Service and Privacy Policy
          </Link>
        </p>
      </div>
    </div>
  );
}
