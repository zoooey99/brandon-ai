import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MessageSquare, Send, Check, Loader2, X } from "lucide-react";
import {
  Sheet,
  SheetContent,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { getAuthHeaders } from "@/hooks/use-auth";
import { useIsMobile } from "@/hooks/use-mobile";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";

type FeedbackCategory = "bug" | "feature" | "question" | "other";

interface FeedbackSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const categories: { value: FeedbackCategory; label: string }[] = [
  { value: "bug", label: "Bug Report" },
  { value: "feature", label: "Feature Request" },
  { value: "question", label: "Question" },
  { value: "other", label: "Other" },
];

// Shared form content used by both mobile sheet and desktop dialog
function FeedbackFormContent({
  onClose,
  isSuccess,
  setIsSuccess,
}: {
  onClose: () => void;
  isSuccess: boolean;
  setIsSuccess: (value: boolean) => void;
}) {
  const [category, setCategory] = useState<FeedbackCategory>("question");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async () => {
    if (!message.trim()) {
      toast({
        title: "Message required",
        description: "Please enter your feedback before submitting.",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const headers = await getAuthHeaders();
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify({ message: message.trim(), category }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to send feedback");
      }

      setIsSuccess(true);
    } catch (error: any) {
      toast({
        title: "Failed to send",
        description: error.message || "Please try again later.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AnimatePresence mode="wait">
      {isSuccess ? (
        <motion.div
          key="success"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="text-center py-8"
        >
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 300, damping: 20, delay: 0.1 }}
            className="w-16 h-16 mx-auto mb-5 rounded-full bg-emerald-500/15 flex items-center justify-center"
          >
            <Check className="w-8 h-8 text-emerald-400" />
          </motion.div>
          <h3 className="text-xl font-bold text-white mb-2">
            Thanks for your feedback!
          </h3>
          <p className="text-zinc-400 text-sm mb-6">
            We'll get back to you if needed.
          </p>
          <Button
            onClick={onClose}
            variant="outline"
            className="bg-white/10 border-white/10 hover:bg-white/15 text-white"
          >
            Done
          </Button>
        </motion.div>
      ) : (
        <motion.div
          key="form"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {/* Header */}
          <div className="text-left mb-4">
            <div className="flex items-center gap-3 mb-1">
              <div className="w-10 h-10 rounded-xl bg-white/6 border border-white/8 flex items-center justify-center">
                <MessageSquare className="w-5 h-5 text-zinc-300" />
              </div>
              <h2 className="text-xl font-bold text-white tracking-tight">
                Help & Feedback
              </h2>
            </div>
            <p className="text-zinc-400 text-sm">
              We read every message.
            </p>
          </div>

          {/* Category pills */}
          <div className="flex flex-wrap gap-2 mb-4">
            {categories.map((cat) => (
              <button
                key={cat.value}
                onClick={() => setCategory(cat.value)}
                className={`px-3.5 py-2 rounded-full text-sm font-medium transition-all ${
                  category === cat.value
                    ? "bg-emerald-500/15 border border-emerald-500 text-emerald-400"
                    : "bg-white/6 border border-white/10 text-zinc-300 hover:bg-white/10"
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {/* Textarea */}
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value.slice(0, 2000))}
            placeholder="What's on your mind?"
            className="min-h-[120px] md:min-h-[140px] bg-black/30 border-white/10 rounded-2xl px-4 py-3.5 text-white placeholder:text-zinc-500 focus:border-white/20 focus:ring-white/5 resize-none"
          />
          <div className="text-right text-xs text-zinc-500 mt-2">
            {message.length} / 2000
          </div>

          {/* Submit button */}
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting || !message.trim()}
            className="w-full mt-4 bg-emerald-500 hover:bg-emerald-600 text-white font-semibold py-6 rounded-xl disabled:opacity-50"
          >
            {isSubmitting ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <>
                <Send className="w-4 h-4 mr-2" />
                Send Feedback
              </>
            )}
          </Button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function FeedbackSheet({ open, onOpenChange }: FeedbackSheetProps) {
  const isMobile = useIsMobile();
  const [isSuccess, setIsSuccess] = useState(false);

  const handleClose = () => {
    onOpenChange(false);
    // Reset state after animation completes
    setTimeout(() => {
      setIsSuccess(false);
    }, 300);
  };

  // Mobile: Bottom sheet
  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={handleClose}>
        <SheetContent
          side="bottom"
          className="glass-elevated border-t border-white/10 rounded-t-3xl px-6 pb-8 pt-0"
        >
          {/* Drag handle */}
          <div className="flex justify-center pt-3 pb-5">
            <div className="w-9 h-1 bg-zinc-600 rounded-full" />
          </div>

          <FeedbackFormContent
            onClose={handleClose}
            isSuccess={isSuccess}
            setIsSuccess={setIsSuccess}
          />
        </SheetContent>
      </Sheet>
    );
  }

  // Desktop: Centered modal
  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="glass-elevated border border-white/10 rounded-2xl p-7 !w-[440px] !max-w-[calc(100vw-2rem)] shadow-[0_25px_50px_-12px_rgba(0,0,0,0.5),0_0_80px_rgba(16,185,129,0.06)]">
        <VisuallyHidden>
          <DialogTitle>Help & Feedback</DialogTitle>
        </VisuallyHidden>
        <FeedbackFormContent
          onClose={handleClose}
          isSuccess={isSuccess}
          setIsSuccess={setIsSuccess}
        />
      </DialogContent>
    </Dialog>
  );
}
