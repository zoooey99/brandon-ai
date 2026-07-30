import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ConfirmNewPlanModalProps {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  isLoading?: boolean;
}

export function ConfirmNewPlanModal({
  isOpen,
  onConfirm,
  onCancel,
  isLoading = false,
}: ConfirmNewPlanModalProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onCancel}
            className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm"
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ type: "spring", stiffness: 300, damping: 25 }}
            className="fixed inset-0 z-[101] flex items-center justify-center p-4"
          >
            <div className="w-full max-w-md bg-zinc-950 border border-white/10 rounded-2xl overflow-hidden shadow-2xl">
              {/* Icon header */}
              <div className="h-28 bg-gradient-to-br from-emerald-500/15 via-emerald-500/5 to-transparent flex items-center justify-center">
                <div className="w-14 h-14 rounded-full bg-emerald-500/20 flex items-center justify-center">
                  <CheckCircle2 className="w-7 h-7 text-emerald-400" />
                </div>
              </div>

              {/* Content */}
              <div className="p-6 text-center">
                <h3 className="text-xl font-semibold text-white mb-3">
                  Start Fresh?
                </h3>
                <p className="text-zinc-400 text-sm leading-relaxed mb-6">
                  Your current plan will be archived. You can always view it in Plan History. Your new journey begins now.
                </p>

                {/* Actions */}
                <div className="flex gap-3">
                  <Button
                    onClick={onCancel}
                    disabled={isLoading}
                    variant="outline"
                    className="flex-1 h-12 bg-zinc-900 border-zinc-800 text-zinc-300 hover:bg-zinc-800 hover:text-white rounded-xl"
                  >
                    Keep Editing
                  </Button>
                  <Button
                    onClick={onConfirm}
                    disabled={isLoading}
                    className="flex-1 h-12 bg-emerald-500 hover:bg-emerald-400 text-black font-semibold rounded-xl"
                  >
                    {isLoading ? (
                      <span className="flex items-center gap-2">
                        <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                        Saving...
                      </span>
                    ) : (
                      "Start New Plan"
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
