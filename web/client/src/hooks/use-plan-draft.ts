import { useState, useEffect, useCallback, useRef } from "react";
import type { GeneratedPlan, PlanConversationMessage } from "@/lib/api";

const DRAFT_STORAGE_KEY = "workout-plan-draft";
const DRAFT_VERSION = 1;

interface PlanDraft {
  version: number;
  plan: GeneratedPlan;
  messages: PlanConversationMessage[];
  updatedAt: string;
  mode: "edit" | "new" | "initial";
}

interface UsePlanDraftOptions {
  mode: "edit" | "new" | "initial";
  debounceMs?: number;
}

interface UsePlanDraftReturn {
  loadDraft: () => PlanDraft | null;
  saveDraft: (plan: GeneratedPlan, messages: PlanConversationMessage[]) => void;
  clearDraft: () => void;
  hasDraft: boolean;
}

/**
 * Hook for persisting workout plan drafts to localStorage.
 * Survives page refreshes and browser closes.
 *
 * Usage:
 * ```tsx
 * const { loadDraft, saveDraft, clearDraft, hasDraft } = usePlanDraft({ mode: "edit" });
 *
 * // On mount, try to restore from draft
 * useEffect(() => {
 *   const draft = loadDraft();
 *   if (draft) {
 *     setPlan(draft.plan);
 *     setMessages(draft.messages);
 *   }
 * }, []);
 *
 * // On plan/message changes, save to draft
 * useEffect(() => {
 *   if (plan && messages.length > 0) {
 *     saveDraft(plan, messages);
 *   }
 * }, [plan, messages]);
 *
 * // On successful commit, clear draft
 * const handleCommit = async () => {
 *   await api.createPlan(plan);
 *   clearDraft();
 * };
 * ```
 */
export function usePlanDraft({ mode, debounceMs = 1000 }: UsePlanDraftOptions): UsePlanDraftReturn {
  const [hasDraft, setHasDraft] = useState(false);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Check if draft exists on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(DRAFT_STORAGE_KEY);
      if (stored) {
        const draft = JSON.parse(stored) as PlanDraft;
        // Only consider it valid if version matches and mode matches
        if (draft.version === DRAFT_VERSION && draft.mode === mode) {
          setHasDraft(true);
        }
      }
    } catch {
      // Invalid stored data, ignore
    }
  }, [mode]);

  const loadDraft = useCallback((): PlanDraft | null => {
    try {
      const stored = localStorage.getItem(DRAFT_STORAGE_KEY);
      if (!stored) return null;

      const draft = JSON.parse(stored) as PlanDraft;

      // Validate version and mode
      if (draft.version !== DRAFT_VERSION || draft.mode !== mode) {
        return null;
      }

      // Validate structure
      if (!draft.plan || !Array.isArray(draft.messages)) {
        return null;
      }

      return draft;
    } catch {
      return null;
    }
  }, [mode]);

  const saveDraft = useCallback((plan: GeneratedPlan, messages: PlanConversationMessage[]) => {
    // Clear any pending save
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Debounce the save
    saveTimeoutRef.current = setTimeout(() => {
      try {
        const draft: PlanDraft = {
          version: DRAFT_VERSION,
          plan,
          messages,
          updatedAt: new Date().toISOString(),
          mode,
        };
        localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
        setHasDraft(true);
      } catch (error) {
        console.error("Failed to save plan draft to localStorage:", error);
      }
    }, debounceMs);
  }, [mode, debounceMs]);

  const clearDraft = useCallback(() => {
    // Clear any pending save
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }

    try {
      localStorage.removeItem(DRAFT_STORAGE_KEY);
      setHasDraft(false);
    } catch (error) {
      console.error("Failed to clear plan draft from localStorage:", error);
    }
  }, []);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  return {
    loadDraft,
    saveDraft,
    clearDraft,
    hasDraft,
  };
}
