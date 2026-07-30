"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Star, TrendingUp } from "lucide-react";

interface PRData {
  exercise: string;
  weight: number;
  previousMax: number;
}

interface PRCelebrationProps {
  isOpen: boolean;
  onClose: () => void;
  prs: PRData[];
}

export function PRCelebration({ isOpen, onClose, prs }: PRCelebrationProps) {
  if (!isOpen || prs.length === 0) return null;

  const isSinglePR = prs.length === 1;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] bg-[#050505] flex flex-col items-center justify-center p-6"
        >
          {/* Animated background glow */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            <motion.div
              animate={{
                scale: [1, 1.2, 1],
                opacity: [0.1, 0.2, 0.1],
              }}
              transition={{
                duration: 3,
                repeat: Infinity,
                ease: "easeInOut",
              }}
              className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full"
              style={{
                background: "radial-gradient(circle, rgba(251, 191, 36, 0.3) 0%, transparent 70%)",
              }}
            />
          </div>

          {/* Trophy icon with animation */}
          <motion.div
            initial={{ scale: 0, rotate: -180 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{
              type: "spring",
              damping: 15,
              stiffness: 200,
              delay: 0.1,
            }}
            className="relative mb-6"
          >
            {/* Pulsing ring effect */}
            <motion.div
              animate={{
                scale: [1, 1.4, 1],
                opacity: [0.5, 0, 0.5],
              }}
              transition={{
                duration: 2,
                repeat: Infinity,
                ease: "easeOut",
              }}
              className="absolute inset-0 rounded-full border-2 border-amber-400"
              style={{ width: 100, height: 100, left: 0, top: 0 }}
            />
            <motion.div
              animate={{
                scale: [1, 1.6, 1],
                opacity: [0.3, 0, 0.3],
              }}
              transition={{
                duration: 2,
                repeat: Infinity,
                ease: "easeOut",
                delay: 0.5,
              }}
              className="absolute inset-0 rounded-full border-2 border-amber-400"
              style={{ width: 100, height: 100, left: 0, top: 0 }}
            />

            <div
              className="w-[100px] h-[100px] rounded-full flex items-center justify-center"
              style={{
                background: "linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)",
                boxShadow: "0 0 40px rgba(251, 191, 36, 0.5), 0 0 80px rgba(251, 191, 36, 0.3)",
              }}
            >
              <Star className="w-12 h-12 text-black" fill="currentColor" />
            </div>
          </motion.div>

          {/* Title */}
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="text-3xl font-extrabold text-center mb-2"
            style={{
              background: "linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            {isSinglePR ? "New Personal Record!" : "You Crushed It!"}
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="text-zinc-400 text-center mb-2"
          >
            {isSinglePR ? "You crushed your previous best" : "Incredible workout today"}
          </motion.p>

          {!isSinglePR && (
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.45 }}
              className="text-zinc-500 text-sm mb-6"
            >
              <span className="text-amber-400 font-bold">{prs.length}</span> new personal records
            </motion.p>
          )}

          {/* PR List */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="w-full max-w-[280px] space-y-2.5 mb-8"
          >
            {prs.map((pr, index) => {
              const improvement = pr.previousMax > 0 ? pr.weight - pr.previousMax : null;

              return (
                <motion.div
                  key={pr.exercise}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.6 + index * 0.1 }}
                  className="p-4 rounded-2xl text-left"
                  style={{
                    background: "linear-gradient(135deg, rgba(251, 191, 36, 0.15) 0%, rgba(0,0,0,0.3) 100%)",
                    border: "1px solid rgba(251, 191, 36, 0.3)",
                  }}
                >
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-400 mb-1">
                    {pr.exercise}
                  </p>
                  <p className="text-3xl font-extrabold text-white leading-none">
                    {pr.weight}
                    <span className="text-sm font-semibold text-zinc-400 ml-1">lbs</span>
                  </p>
                  {improvement !== null && improvement > 0 && (
                    <p className="flex items-center gap-1 text-sm text-emerald-400 mt-1">
                      <TrendingUp className="h-3.5 w-3.5" />
                      +{improvement} lbs from previous
                    </p>
                  )}
                </motion.div>
              );
            })}
          </motion.div>

          {/* Continue Button */}
          <motion.button
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.8 }}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={onClose}
            className="px-12 py-4 rounded-2xl font-bold text-lg text-black"
            style={{
              background: "linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)",
              boxShadow: "0 8px 24px rgba(251, 191, 36, 0.4)",
            }}
          >
            Continue
          </motion.button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
