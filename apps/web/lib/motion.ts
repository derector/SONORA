"use client";

// Motion primitives shared across the app: the reduced-preference hook,
// a stagger delay calculator and the scroll-reveal plumbing backed by ONE
// lazy IntersectionObserver for the whole page, so hundreds of revealed
// elements still cost a single observer.

export const REDUCE_QUERY = "(prefers-reduced-motion: reduce)";

/** True when the device currently asks for reduced motion (SSR-safe: false). */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(REDUCE_QUERY).matches
  );
}

/** Reactive version of prefersReducedMotion() — re-renders on system change. */
export function useMotionPreference(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(REDUCE_QUERY);
    const apply = () => setReduced(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);
  return reduced;
}

/** Delay for the index-th item of a staggered group, capped so long rows never
 *  wait longer than `cap` ms. Default 60ms step / 300ms cap per the motion spec. */
export function stagger(index: number, step = 60, cap = 300): number {
  return Math.min(Math.max(0, index) * step, cap);
}

const REVEAL_CLASS = "rv-in";
let sharedObserver: IntersectionObserver | null = null;

function revealObserver(): IntersectionObserver | null {
  if (typeof window === "undefined" || typeof window.IntersectionObserver !== "function") return null;
  if (!sharedObserver) {
    sharedObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add(REVEAL_CLASS);
          sharedObserver?.unobserve(entry.target);
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -4% 0px" }
    );
  }
  return sharedObserver;
}

/**
 * Ref callback that reveals a `.rv` element once it scrolls into view.
 * Reduced-motion devices and browsers without IntersectionObserver get the
 * final state immediately; the CSS kill-switch keeps it static.
 */
export function useReveal<T extends HTMLElement = HTMLDivElement>() {
  const seen = useRef<WeakSet<Element>>(new WeakSet());
  return useCallback((node: T | null) => {
    if (!node || seen.current.has(node)) return;
    seen.current.add(node);
    if (prefersReducedMotion()) {
      node.classList.add(REVEAL_CLASS);
      return;
    }
    const observer = revealObserver();
    if (!observer) {
      node.classList.add(REVEAL_CLASS);
      return;
    }
    observer.observe(node);
  }, []);
}

// React imports live at the bottom so the pure helpers above stay tree-shakeable
// in any non-React consumer.
import { useCallback, useEffect, useRef, useState } from "react";
