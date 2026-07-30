import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Pencil, ChevronUp, Plus, Check, Clock, ChevronDown } from "lucide-react";
import { format } from "date-fns";
import { workoutPlanApi, type WorkoutPlanData } from "@/lib/api";

interface PlanManagerProps {
  plans: WorkoutPlanData[];
  activePlan: WorkoutPlanData | null;
  onEdit: () => void;
  onSwitch: (planId: number) => Promise<void>;
  onCreateNew: () => void;
}

export function PlanManager({
  plans,
  activePlan,
  onEdit,
  onSwitch,
  onCreateNew,
}: PlanManagerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);
  const [archivedPlans, setArchivedPlans] = useState<WorkoutPlanData[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [loadingArchived, setLoadingArchived] = useState(false);

  // Load archived plans when popover opens
  useEffect(() => {
    if (isOpen && archivedPlans.length === 0 && !loadingArchived) {
      setLoadingArchived(true);
      workoutPlanApi.getArchived()
        .then(setArchivedPlans)
        .catch((err) => console.error("Failed to load archived plans:", err))
        .finally(() => setLoadingArchived(false));
    }
  }, [isOpen, archivedPlans.length, loadingArchived]);

  const handleSwitch = async (planId: number) => {
    if (isSwitching) return;
    setIsSwitching(true);
    try {
      await onSwitch(planId);
      setIsOpen(false);
    } finally {
      setIsSwitching(false);
    }
  };

  const getPlanDisplayName = (plan: WorkoutPlanData) => {
    if (plan.name) return plan.name;
    // Auto-generate name from creation date
    const date = plan.createdAt ? new Date(plan.createdAt) : new Date();
    return `Plan - ${format(date, "MMM d")}`;
  };

  const getPlanDate = (plan: WorkoutPlanData) => {
    const date = plan.updatedAt ? new Date(plan.updatedAt) :
                 plan.createdAt ? new Date(plan.createdAt) : new Date();
    return format(date, "MMM d");
  };

  // If no active plan, show minimal state
  if (!activePlan) {
    return (
      <div className="mt-auto pt-4 border-t border-white/5">
        <button
          onClick={onCreateNew}
          className="w-full flex items-center justify-center gap-2 px-3 py-3
                     rounded-lg bg-zinc-900/80 border border-zinc-800/50
                     text-zinc-400 hover:text-emerald-400 hover:border-emerald-500/30
                     hover:bg-emerald-500/10 transition-colors"
        >
          <Plus className="h-4 w-4" />
          <span className="text-sm font-medium">Create Your Plan</span>
        </button>
      </div>
    );
  }

  return (
    <div className="relative mt-auto pt-4 border-t border-white/5">
      {/* Collapsed Bar — Always Visible */}
      <div
        className="flex items-center justify-between px-3 py-2.5
                   bg-zinc-900/80 rounded-lg border border-zinc-800/50
                   hover:border-zinc-700/50 transition-colors"
      >
        {/* Plan indicator + expand trigger */}
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2 flex-1 text-left group"
        >
          {/* Active indicator dot */}
          <span
            className="h-2 w-2 rounded-full bg-emerald-500
                       shadow-[0_0_8px_rgba(16,185,129,0.6)] animate-pulse"
          />

          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-zinc-300 truncate">
              {getPlanDisplayName(activePlan)}
            </p>
            <p className="text-[10px] text-zinc-500">{getPlanDate(activePlan)}</p>
          </div>

          <ChevronUp
            className={`h-4 w-4 text-zinc-500 transition-transform ${
              isOpen ? "rotate-180" : ""
            }`}
          />
        </button>

        {/* Edit button — always accessible */}
        <button
          onClick={onEdit}
          className="ml-2 p-2 rounded-md text-zinc-500
                     hover:text-emerald-400 hover:bg-emerald-500/10
                     transition-colors"
          title="Edit Plan"
        >
          <Pencil className="h-4 w-4" />
        </button>
      </div>

      {/* Expanded Popover */}
      <AnimatePresence>
        {isOpen && (
          <>
            {/* Invisible overlay to catch outside clicks */}
            <div
              className="fixed inset-0 z-40"
              onClick={() => setIsOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.15 }}
              className="absolute bottom-full left-0 right-0 mb-2
                         bg-zinc-900 border border-zinc-800 rounded-lg
                         shadow-xl shadow-black/50 overflow-hidden z-50"
            >
            {/* Header */}
            <div className="px-3 py-2 border-b border-zinc-800/50">
              <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                Saved Plans
              </p>
            </div>

            {/* Plan List */}
            <div className="max-h-48 overflow-y-auto">
              {plans.map((plan) => {
                const isActive = plan.status === "active";
                return (
                  <button
                    key={plan.id}
                    onClick={() => plan.id && handleSwitch(plan.id)}
                    disabled={isActive || isSwitching}
                    className={`w-full flex items-center gap-3 px-3 py-2.5
                               text-left transition-colors
                               ${isActive
                                 ? "bg-emerald-500/10 cursor-default"
                                 : "hover:bg-zinc-800/50 cursor-pointer"}
                               ${isSwitching ? "opacity-50" : ""}`}
                  >
                    {/* Radio-style indicator */}
                    <span
                      className={`h-3 w-3 rounded-full border-2
                                  flex items-center justify-center shrink-0
                                  ${isActive
                                    ? "border-emerald-500 bg-emerald-500"
                                    : "border-zinc-600"}`}
                    >
                      {isActive && <Check className="h-2 w-2 text-black" />}
                    </span>

                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-zinc-300 truncate">
                        {getPlanDisplayName(plan)}
                      </p>
                      <p className="text-[10px] text-zinc-500">
                        {plan.createdAt
                          ? `Created ${format(new Date(plan.createdAt), "MMM d, yyyy")}`
                          : ""}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Create New */}
            <div className="border-t border-zinc-800/50 p-2">
              <button
                onClick={() => {
                  setIsOpen(false);
                  onCreateNew();
                }}
                className="w-full flex items-center justify-center gap-2
                           py-2 rounded-md text-sm text-zinc-400
                           hover:text-emerald-400 hover:bg-emerald-500/10
                           transition-colors"
              >
                <Plus className="h-4 w-4" />
                Create New Plan
              </button>
            </div>

            {/* Plan History Section */}
            {(archivedPlans.length > 0 || loadingArchived) && (
              <div className="border-t border-zinc-800/50">
                <button
                  onClick={() => setShowArchived(!showArchived)}
                  className="w-full flex items-center justify-between px-3 py-2.5
                             text-left hover:bg-zinc-800/30 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Clock className="h-3.5 w-3.5 text-zinc-500" />
                    <span className="text-xs font-medium text-zinc-500">
                      Plan History
                    </span>
                    {archivedPlans.length > 0 && (
                      <span className="text-[10px] text-zinc-600">
                        ({archivedPlans.length})
                      </span>
                    )}
                  </div>
                  <ChevronDown
                    className={`h-3.5 w-3.5 text-zinc-500 transition-transform ${
                      showArchived ? "rotate-180" : ""
                    }`}
                  />
                </button>

                <AnimatePresence>
                  {showArchived && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="max-h-32 overflow-y-auto bg-zinc-950/50">
                        {loadingArchived ? (
                          <div className="px-3 py-4 text-center">
                            <span className="text-xs text-zinc-500">Loading...</span>
                          </div>
                        ) : archivedPlans.length === 0 ? (
                          <div className="px-3 py-4 text-center">
                            <span className="text-xs text-zinc-500">No archived plans</span>
                          </div>
                        ) : (
                          archivedPlans.map((plan) => (
                            <div
                              key={plan.id}
                              className="flex items-center gap-3 px-3 py-2.5 border-b border-zinc-800/30 last:border-b-0"
                            >
                              <span className="h-2.5 w-2.5 rounded-full bg-zinc-700 shrink-0" />
                              <div className="flex-1 min-w-0">
                                <p className="text-xs text-zinc-400 truncate">
                                  {getPlanDisplayName(plan)}
                                </p>
                                <p className="text-[10px] text-zinc-600">
                                  {plan.archivedAt
                                    ? `Archived ${format(new Date(plan.archivedAt), "MMM d, yyyy")}`
                                    : plan.createdAt
                                    ? `Created ${format(new Date(plan.createdAt), "MMM d, yyyy")}`
                                    : ""}
                                </p>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
