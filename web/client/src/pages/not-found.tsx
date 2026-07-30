import { motion } from "framer-motion";
import { Link } from "wouter";
import { Home, Dumbbell, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center bg-background overflow-hidden relative">
      {/* Animated grid background */}
      <div className="absolute inset-0 overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `
              linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px),
              linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)
            `,
            backgroundSize: '60px 60px',
          }}
        />
        {/* Radial gradient overlay */}
        <div
          className="absolute inset-0"
          style={{
            background: 'radial-gradient(ellipse at center, transparent 0%, hsl(0 0% 2%) 70%)',
          }}
        />
      </div>

      {/* Floating particles */}
      {[...Array(6)].map((_, i) => (
        <motion.div
          key={i}
          className="absolute w-1 h-1 bg-white/20 rounded-full"
          initial={{
            x: Math.random() * (typeof window !== 'undefined' ? window.innerWidth : 1000),
            y: Math.random() * (typeof window !== 'undefined' ? window.innerHeight : 800),
            opacity: 0
          }}
          animate={{
            y: [null, -100],
            opacity: [0, 0.5, 0],
          }}
          transition={{
            duration: 4 + Math.random() * 3,
            repeat: Infinity,
            delay: i * 0.8,
            ease: "easeOut"
          }}
        />
      ))}

      {/* Main content */}
      <div className="relative z-10 flex flex-col items-center px-6 text-center">

        {/* 404 Display with glow effect */}
        <motion.div
          className="relative mb-8"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        >
          {/* Glow layer */}
          <div
            className="absolute inset-0 blur-3xl opacity-20"
            style={{
              background: 'radial-gradient(circle, white 0%, transparent 70%)',
            }}
          />

          {/* The 404 number with dumbbell integration */}
          <div className="relative flex items-center gap-2">
            <motion.span
              className="font-heading text-[120px] sm:text-[180px] font-bold leading-none text-white/90 tracking-tighter"
              style={{ textShadow: '0 0 80px rgba(255,255,255,0.15)' }}
              initial={{ x: -50, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: 0.1, duration: 0.5 }}
            >
              4
            </motion.span>

            <motion.div
              initial={{ scale: 0, rotate: -180 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ delay: 0.3, duration: 0.6, type: "spring", stiffness: 200 }}
            >
              <Dumbbell
                className="w-20 h-20 sm:w-28 sm:h-28 text-white/80"
                strokeWidth={1.5}
              />
            </motion.div>

            <motion.span
              className="font-heading text-[120px] sm:text-[180px] font-bold leading-none text-white/90 tracking-tighter"
              style={{ textShadow: '0 0 80px rgba(255,255,255,0.15)' }}
              initial={{ x: 50, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: 0.1, duration: 0.5 }}
            >
              4
            </motion.span>
          </div>
        </motion.div>

        {/* Message */}
        <motion.div
          className="space-y-4 max-w-md"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.5 }}
        >
          <h1 className="font-heading text-2xl sm:text-3xl font-medium text-white tracking-tight">
            Wrong turn, champ
          </h1>
          <p className="text-muted-foreground text-base sm:text-lg leading-relaxed">
            This page doesn't exist. But hey, even the best athletes take a
            wrong step sometimes. Let's get you back on track.
          </p>
        </motion.div>

        {/* CTA Buttons */}
        <motion.div
          className="flex flex-col sm:flex-row gap-4 mt-10"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6, duration: 0.5 }}
        >
          <Link href="/">
            <Button
              size="lg"
              className="group relative overflow-hidden bg-white text-black hover:bg-white/90 px-8 h-12 text-base font-medium"
            >
              <Home className="w-4 h-4 mr-2" />
              Back to Home
              <motion.div
                className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full"
                whileHover={{ translateX: '100%' }}
                transition={{ duration: 0.5 }}
              />
            </Button>
          </Link>

          <Link href="/dashboard">
            <Button
              variant="outline"
              size="lg"
              className="group border-white/20 bg-transparent hover:bg-white/5 hover:border-white/40 px-8 h-12 text-base font-medium text-white"
            >
              Go to Dashboard
              <ArrowRight className="w-4 h-4 ml-2 transition-transform group-hover:translate-x-1" />
            </Button>
          </Link>
        </motion.div>

        {/* Decorative bottom line */}
        <motion.div
          className="mt-16 flex items-center gap-3 text-muted-foreground text-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8, duration: 0.5 }}
        >
          <div className="w-8 h-px bg-white/20" />
          <span>Error 404</span>
          <div className="w-8 h-px bg-white/20" />
        </motion.div>
      </div>

      {/* Corner accent */}
      <motion.div
        className="absolute bottom-0 left-0 w-64 h-64 opacity-5"
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.05 }}
        transition={{ delay: 1, duration: 1 }}
        style={{
          background: 'radial-gradient(circle at bottom left, white 0%, transparent 70%)',
        }}
      />
    </div>
  );
}
