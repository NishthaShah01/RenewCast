"use client";

import { usePathname } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";

/**
 * Subtle route-level transition.
 *
 * Requirements:
 * - opacity 0 → 1
 * - translateY: 4–6px
 * - 180ms ease-out
 * - respects prefers-reduced-motion
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const shouldReduceMotion = useReducedMotion();

  if (shouldReduceMotion) {
    return <>{children}</>;
  }

  return (
    <motion.div
      key={pathname}
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className="w-full flex-1"
    >
      {children}
    </motion.div>
  );
}
