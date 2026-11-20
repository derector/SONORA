"use client";

import { useRef, type ReactNode } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useLanguage } from "../language-provider";

// Spotify-style horizontal rail: snap-scrolling row of cards, section header
// with an optional "View all" link, hover arrows on desktop and a masked edge
// fade. Only the presentation lives here; cards and their handlers are passed
// in as children so pages keep ownership of playback logic.
export function Rail({
  eyebrow,
  title,
  titleId,
  subtitle,
  viewAllHref,
  viewAllLabel,
  aside,
  children
}: {
  eyebrow?: string;
  title: string;
  titleId?: string;
  subtitle?: string;
  viewAllHref?: string;
  viewAllLabel?: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useLanguage();
  const scroller = useRef<HTMLDivElement>(null);

  function scroll(direction: -1 | 1) {
    const node = scroller.current;
    if (!node) return;
    node.scrollBy({ left: direction * Math.max(240, node.clientWidth * 0.8), behavior: "smooth" });
  }

  return (
    <section className="rail mt-6" aria-labelledby={titleId}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          {eyebrow && <p className="t-eyebrow">{eyebrow}</p>}
          <h2 id={titleId} className={`t-h2 ${eyebrow ? "mt-1" : ""}`}>{title}</h2>
          {subtitle && <p className="t-meta mt-1">{subtitle}</p>}
        </div>
        {viewAllHref ? (
          <Link href={viewAllHref} className="btn-press shrink-0 text-sm text-muted transition hover:text-white">
            {viewAllLabel || t("View all")} <ChevronRight size={14} className="ml-0.5 inline align-[-2px]" />
          </Link>
        ) : aside || null}
      </div>
      <div className="relative">
        <button type="button" className="rail-arrow is-left" onClick={() => scroll(-1)} aria-label={t("Scroll left")}>
          <ChevronLeft size={18} />
        </button>
        <div ref={scroller} className="rail-scroll">
          {children}
        </div>
        <button type="button" className="rail-arrow is-right" onClick={() => scroll(1)} aria-label={t("Scroll right")}>
          <ChevronRight size={18} />
        </button>
      </div>
    </section>
  );
}
