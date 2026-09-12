"use client";

import { motion, useReducedMotion } from "motion/react";
import React from "react";

interface MotionSectionProps {
  children: React.ReactNode;
  index?: number;
  className?: string;
  id?: string;
  as?: "header" | "section" | "div";
  style?: React.CSSProperties;
}

/**
 * Reusable motion container for major page sections.
 *
 * Implements the RenewCast motion language:
 * - Subtle page-load entrance: opacity 0 -> 1, translateY 4px -> 0
 * - 180ms ease-out
 * - 30-35ms subtle stagger between major sections (max 240ms total)
 * - Strictly respects prefers-reduced-motion
 */
export function MotionSection({
  children,
  index = 0,
  className,
  id,
  as = "section",
  style,
}: MotionSectionProps) {
  const shouldReduceMotion = useReducedMotion();

  if (shouldReduceMotion) {
    const Component = as;
    return (
      <Component id={id} className={className} style={style}>
        {children}
      </Component>
    );
  }

  const MotionComponent =
    as === "header"
      ? motion.header
      : as === "div"
        ? motion.div
        : motion.section;

  return (
    <MotionComponent
      id={id}
      className={className}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.18,
        delay: Math.min(0.24, index * 0.035),
        ease: "easeOut",
      }}
      style={style}
    >
      {children}
    </MotionComponent>
  );
}
