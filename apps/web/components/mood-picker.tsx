"use client";

import Link from "next/link";
import { useLanguage } from "./language-provider";

// Six listening moods. Each tile is a gradient first, so the section still
// looks finished when the artwork layer has not been published yet: the image
// removes itself on error and the gradient stays behind.
type Mood = {
  slug: string;
  label: string;
  caption: string;
  query: string;
  gradient: string;
};

const MOODS: Mood[] = [
  { slug: "focus", label: "Focus", caption: "Lo-fi and steady", query: "lofi study focus", gradient: "from-[#2b2148] via-[#1c1830] to-[#121420]" },
  { slug: "energy", label: "Energy", caption: "Bright and fast", query: "upbeat electronic energy", gradient: "from-[#123a5e] via-[#14243c] to-[#101020]" },
  { slug: "relax", label: "Relax", caption: "Wide and quiet", query: "calm ambient relaxation", gradient: "from-[#0f3b41] via-[#14212e] to-[#101420]" },
  { slug: "party", label: "Party", caption: "Loud and warm", query: "party dance", gradient: "from-[#4b1a55] via-[#2a1838] to-[#131022]" },
  { slug: "sleep", label: "Sleep", caption: "Low and slow", query: "sleep dreamy", gradient: "from-[#1e2452] via-[#151827] to-[#0e1018]" },
  { slug: "discovery", label: "Discovery", caption: "New to you", query: "trending acoustic discovery", gradient: "from-[#0f4a55] via-[#123044] to-[#111522]" }
];

export function MoodPicker() {
  const { t } = useLanguage();
  return (
    <section className="mt-12" aria-labelledby="mood-picker-heading">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="t-eyebrow text-violet-200">{t("Made for the moment")}</p>
          <h2 id="mood-picker-heading" className="t-h2 mt-1">{t("Pick a mood")}</h2>
          <p className="t-meta mt-1">{t("Each mood opens the catalog with a ready-made search.")}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {MOODS.map((mood, index) => (
          <Link
            key={mood.slug}
            href={`/search?q=${encodeURIComponent(mood.query)}`}
            className="card-enter btn-press card-lift group relative flex min-w-0 flex-col justify-end overflow-hidden rounded-card border border-white/[0.07] bg-gradient-to-br p-4"
            style={{ animationDelay: `${Math.min(index * 25, 300)}ms` }}
          >
            <span className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${mood.gradient}`} aria-hidden />
            <span className="mood-shimmer pointer-events-none" aria-hidden />
            <img
              src={`/moods/${mood.slug}.png`}
              alt=""
              loading="lazy"
              onError={(event) => event.currentTarget.remove()}
              className="absolute inset-0 h-full w-full object-cover opacity-45 mix-blend-screen transition duration-300 group-hover:opacity-65"
            />
            <span className="relative block truncate text-[15px] font-semibold text-white">{t(mood.label)}</span>
            <span className="relative mt-0.5 block truncate text-xs text-white/65">{t(mood.caption)}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
