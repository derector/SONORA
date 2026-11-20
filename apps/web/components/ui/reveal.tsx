"use client";

import type { CSSProperties, ReactNode } from "react";
import { useReveal } from "../../lib/motion";

// One lightweight wrapper for every scroll reveal in the app. It renders a
// single div, registers it with the shared IntersectionObserver and lets CSS
// do the rest (.rv in motion.css). `stagger` animates the direct children in
// 60ms steps (capped at 300ms) without adding a wrapper per item.
type RevealProps = {
  children: ReactNode;
  className?: string;
  /** Extra enter delay in ms for hand-tuned sequences. */
  delay?: number;
  /** Heading wipe: clip-path opens bottom-up together with the fade. */
  mask?: boolean;
  /** Slide in from the right (24px) instead of rising. */
  x?: boolean;
  /** Animate direct children in stagger steps instead of the block itself. */
  stagger?: "up" | "x";
};

export function Reveal({ children, className = "", delay = 0, mask = false, x = false, stagger }: RevealProps) {
  const ref = useReveal<HTMLDivElement>();
  const style = delay > 0 ? ({ "--rv-delay": `${delay}ms` } as CSSProperties) : undefined;
  const classes = [
    "rv",
    stagger ? "rv-flat" : x ? "rv-x" : "",
    mask ? "rv-mask" : "",
    stagger === "x" ? "rv-stagger-x" : stagger === "up" ? "rv-stagger" : "",
    className
  ].filter(Boolean).join(" ");
  return <div ref={ref} className={classes} style={style}>{children}</div>;
}
