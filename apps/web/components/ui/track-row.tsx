"use client";

import { type ReactNode } from "react";
import { Pause, Play } from "lucide-react";
import { Artwork } from "./artwork";
import { useLanguage } from "../language-provider";

// One 64px row shape shared by search results, favorites, history, playlist
// detail and assistant answers: 44px rounded artwork with a gradient
// fallback, title + artist on single truncated lines, duration right, hover
// reveals the play control on the artwork. Playback handlers stay with the
// pages through the onPlay prop.
export type RowTrack = {
  id: string;
  title: string;
  artist?: string | null;
  artworkUrl?: string | null;
  durationSeconds?: number | null;
};

export function formatDuration(seconds?: number | null) {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return "";
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

export function TrackRow({
  track,
  onPlay,
  isCurrent = false,
  isPlaying = false,
  busy = false,
  disabled = false,
  meta,
  trailing,
  leading
}: {
  track: RowTrack;
  onPlay: () => void;
  isCurrent?: boolean;
  isPlaying?: boolean;
  busy?: boolean;
  disabled?: boolean;
  /** Second line under the title; defaults to artist. */
  meta?: ReactNode;
  /** Actions rendered after the duration (remove, source link, add...). */
  trailing?: ReactNode;
  /** Optional node before the artwork (index, icon). */
  leading?: ReactNode;
}) {
  const { t } = useLanguage();
  const showPause = isCurrent && isPlaying;
  const duration = formatDuration(track.durationSeconds);

  return (
    <article className={`track-row group ${isCurrent ? "is-current" : ""}`}>
      {leading}
      <button
        type="button"
        onClick={onPlay}
        disabled={disabled}
        aria-label={`${showPause ? t("Pause") : t("Play")} ${track.title}`}
        className="relative h-11 w-11 shrink-0 rounded-tile"
      >
        <Artwork src={track.artworkUrl} rounded="rounded-tile" iconSize={18} className="h-11 w-11" />
        <span className="track-row__overlay absolute inset-0 grid place-items-center rounded-tile bg-black/45">
          {busy
            ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" aria-hidden />
            : showPause
              ? <Pause size={16} fill="currentColor" className="text-white" />
              : <Play size={16} fill="currentColor" className="ml-0.5 text-white" />}
        </span>
      </button>
      <div className="min-w-0 flex-1">
        <p className="t-row truncate">{track.title}</p>
        <div className="t-meta mt-0.5 truncate">
          {meta !== undefined ? meta : track.artist || t("Unknown artist")}
        </div>
      </div>
      {duration ? <span className="t-meta hidden shrink-0 tabular-nums sm:block">{duration}</span> : null}
      {trailing ? <div className="flex shrink-0 items-center gap-1">{trailing}</div> : null}
    </article>
  );
}
