"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

// Wraps the routed page only, so the shell and the player never re-animate.
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [key, setKey] = useState(pathname);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  useEffect(() => { setKey(pathname); }, [pathname]);

  if (reduced) return <>{children}</>;
  return <div key={key} className="page-transition">{children}</div>;
}
