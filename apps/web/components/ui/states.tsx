"use client";

import type { ComponentType } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCcw } from "lucide-react";

// Shared "nothing here yet / something broke" blocks: a gradient illustration
// disc with a 24px stroke icon, a message and one clear CTA. Icons are inline
// stroke SVGs (lucide), never emoji.

type IconType = ComponentType<{ size?: number; className?: string }>;

export function StateBlock({
  icon: Icon,
  title,
  body,
  actionHref,
  actionLabel,
  onRetry,
  tone = "violet"
}: {
  icon: IconType;
  title: string;
  body?: string;
  actionHref?: string;
  actionLabel?: string;
  onRetry?: () => void;
  tone?: "violet" | "rose" | "sky" | "neutral";
}) {
  const disc = tone === "rose"
    ? "from-rose-500/25 to-[#1b1420]"
    : tone === "sky"
      ? "from-sky-500/25 to-[#12203a]"
      : tone === "neutral"
        ? "from-white/10 to-[#101218]"
        : "from-accent/25 to-[#0f2a2a]";
  const ring = tone === "rose" ? "text-rose-200" : tone === "sky" ? "text-sky-200" : tone === "neutral" ? "text-slate-300" : "text-violet-100";

  return (
    <section className="surface flex flex-col items-center px-6 py-12 text-center">
      <div className={`grid h-[72px] w-[72px] place-items-center rounded-full bg-gradient-to-br ${disc} ring-1 ring-white/10`}>
        <Icon size={24} className={ring} />
      </div>
      <p className="mt-5 text-[17px] font-semibold">{title}</p>
      {body ? <p className="t-meta mt-2 max-w-md">{body}</p> : null}
      {(actionHref && actionLabel) || onRetry ? (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          {actionHref && actionLabel ? (
            <Link href={actionHref} className="btn-press btn-primary">{actionLabel}</Link>
          ) : null}
          {onRetry ? (
            <button type="button" onClick={onRetry} className="btn-press btn-ghost">
              <RotateCcw size={15} /> {actionLabel}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export function ErrorBlock({ title, body, onRetry, retryLabel }: { title: string; body?: string; onRetry?: () => void; retryLabel: string }) {
  return (
    <section className="surface flex flex-col items-center px-6 py-10 text-center">
      <div className="grid h-[72px] w-[72px] place-items-center rounded-full bg-gradient-to-br from-rose-500/22 to-[#1b1420] ring-1 ring-white/10">
        <AlertTriangle size={24} className="text-rose-200" />
      </div>
      <p className="mt-5 text-[17px] font-semibold">{title}</p>
      {body ? <p className="t-meta mt-2 max-w-md">{body}</p> : null}
      {onRetry ? (
        <button type="button" onClick={onRetry} className="btn-press btn-ghost mt-6">{retryLabel}</button>
      ) : null}
    </section>
  );
}

// Skeletons keep the exact geometry of the content they replace so nothing
// jumps when data arrives.
export function RailSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="rail mt-6" aria-hidden>
      <div className="mb-4 space-y-2">
        <div className="skeleton h-3 w-24" />
        <div className="skeleton h-6 w-48" />
      </div>
      <div className="flex gap-3 overflow-hidden pb-2">
        {Array.from({ length: count }).map((_, index) => (
          <div key={index} className="rail-item min-w-0">
            <div className="skeleton aspect-square w-full rounded-tile" />
            <div className="skeleton mt-3 h-4 w-3/4" />
            <div className="skeleton mt-2 h-3 w-1/2" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function RowsSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="space-y-1" aria-hidden>
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="flex h-16 min-w-0 items-center gap-3 px-2">
          <div className="skeleton h-11 w-11 shrink-0 rounded-tile" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="skeleton h-4 w-2/5 max-w-full" />
            <div className="skeleton h-3 w-1/4 max-w-full" />
          </div>
          <div className="skeleton hidden h-3 w-8 sm:block" />
        </div>
      ))}
    </div>
  );
}

export function GridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-hidden>
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="flex h-16 min-w-0 items-center gap-3 rounded-card bg-surface p-3">
          <div className="skeleton h-12 w-12 shrink-0 rounded-tile" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="skeleton h-4 w-3/5" />
            <div className="skeleton h-3 w-2/5" />
          </div>
        </div>
      ))}
    </div>
  );
}
