"use client";

import { type ReactNode } from "react";
import { Pause, Play } from "lucide-react";
import { Artwork } from "./artwork";
import { useLanguage } from "../language-provider";

// Horizontal-rail card: 1:1 artwork, floating play button revealed on hover,
// title + artist meta underneath. The card body itself is the play target, so
// the component stays honest on touch where hover never happens.
export function TrackCard({
  title,
  artist,
  artworkUrl,
  onPlay,
  isCurrent = false,
  isPlaying = false,
  disabled = false,
  corner,
  footer
}: {
  title: string;
  artist?: string | null;
  artworkUrl?: string | null;
  onPlay: () => void;
  isCurrent?: boolean;
  isPlaying?: boolean;
  disabled?: boolean;
  /** Pinned over the artwork, top-right (favorite toggle). */
  corner?: ReactNode;
  /** Optional node under the meta line (chips, source link). */
  footer?: ReactNode;
}) {
  const { t } = useLanguage();
  const showPause = isCurrent && isPlaying;

  return (
    <article className={`track-card card-lift group min-w-0 rounded-card bg-surface p-2 ${isCurrent ? "bg-accent-soft" : ""}`}>
      <div className="relative">
        <button
          type="button"
          onClick={onPlay}
          disabled={disabled}
          aria-label={`${showPause ? t("Pause") : t("Play track")} ${title}`}
          className="block w-full cursor-pointer"
        >
          <Artwork src={artworkUrl} rounded="rounded-tile" iconSize={28} className="aspect-square w-full" />
          <span
            className="fab-reveal pointer-events-none absolute bottom-2 right-2 z-10 grid h-10 w-10 translate-y-1.5 place-items-center rounded-full bg-accent text-white opacity-0 shadow-float transition duration-[180ms] ease-out group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100"
            aria-hidden
          >
            {showPause ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" className="ml-0.5" />}
          </span>
        </button>
        {corner ? <div className="absolute right-2 top-2 z-10">{corner}</div> : null}
      </div>
      <p className="mt-3 truncate text-[15px] font-medium leading-snug">{title}</p>
      <p className="t-meta mt-0.5 truncate">{artist || t("Unknown artist")}</p>
      {footer ? <div className="mt-2">{footer}</div> : null}
    </article>
  );
}
