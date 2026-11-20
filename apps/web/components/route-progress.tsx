"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

// Top 2px gradient shimmer bar, same idea as the landing nav: it starts when
// an internal link is pressed (so the wait after a click feels intentional)
// and retires on arrival — or after a safety timeout when the click never
// turns into a navigation (same-page anchor, cancelled prefetch, etc.).
export function RouteProgress() {
  const pathname = usePathname();
  const [active, setActive] = useState(false);
  const safetyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const clear = () => {
      if (safetyTimer.current) clearTimeout(safetyTimer.current);
      safetyTimer.current = null;
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      const link = target?.closest?.("a");
      if (!link) return;
      const href = link.getAttribute("href");
      if (!href || !href.startsWith("/") || href === window.location.pathname) return;
      if (link.target === "_blank" || link.hasAttribute("download")) return;
      clear();
      setActive(true);
      safetyTimer.current = setTimeout(() => setActive(false), 2400);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      clear();
    };
  }, []);

  // Arrival: fade the bar out.
  useEffect(() => {
    setActive(false);
  }, [pathname]);

  return <div aria-hidden className={active ? "route-progress is-active" : "route-progress"} />;
}
