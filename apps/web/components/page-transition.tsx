"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useMotionPreference } from "../lib/motion";

// Order the primary nav follows. Forward moves (index grows) slide the new
// page in from the right, backward moves from the left — the same ±12px
// directional enter the landing page uses.
const ROUTE_ORDER = [
  "/", "/search", "/discover", "/playlists", "/favorites", "/history",
  "/import", "/assistant", "/settings", "/profile", "/auth", "/signup", "/legal"
];

function rankOf(pathname: string): number {
  const exact = ROUTE_ORDER.indexOf(pathname);
  if (exact >= 0) return exact;
  const root = `/${pathname.split("/")[1] ?? ""}`;
  return ROUTE_ORDER.indexOf(root);
}

// Wraps the routed page only, so the shell and the player never re-animate.
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const reduced = useMotionPreference();
  const [entry, setEntry] = useState({ key: pathname, cls: "" });
  const prevRank = useRef(-1);

  useEffect(() => {
    const rank = rankOf(pathname);
    const prev = prevRank.current;
    if (rank >= 0) prevRank.current = rank;
    let cls = "";
    if (prev >= 0 && rank >= 0 && rank !== prev) cls = rank > prev ? "page-from-forward" : "page-from-back";
    setEntry((current) => (current.key === pathname && current.cls === cls ? current : { key: pathname, cls }));
  }, [pathname]);

  if (reduced) return <>{children}</>;
  return <div key={entry.key} className={entry.cls ? `page-transition ${entry.cls}` : "page-transition"}>{children}</div>;
}
