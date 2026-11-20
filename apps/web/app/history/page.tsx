"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Clock3, ExternalLink, Headphones, Link2, Play, SkipForward } from "lucide-react";
import { useLanguage } from "../../components/language-provider";
import { usePlayer, type PlayerTrack } from "../../components/player-provider";
import { TrackRow } from "../../components/ui/track-row";
import { ErrorBlock, RowsSkeleton, StateBlock } from "../../components/ui/states";
import { useReveal } from "../../lib/motion";

type HistoryItem = {
  id: string;
  provider_track_id: string;
  title: string;
  artist_name: string;
  album_name: string | null;
  duration_seconds: number;
  artwork_url: string | null;
  license_url: string;
  source_url: string;
  event_type: "play" | "complete" | "skip";
  listened_ms: number;
  occurred_at: string;
};
type ApiResult = { items?: HistoryItem[]; error?: string; session?: { access_token?: string } };
type TrackResult = { items?: PlayerTrack[]; error?: string };
const API = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");

function timeLabel(ms: number) {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
function dateLabel(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
function eventLabel(event: HistoryItem["event_type"]) {
  if (event === "complete") return "Finished";
  if (event === "skip") return "Skipped";
  return "Played";
}

export default function HistoryPage() {
  const { t } = useLanguage();
  const { currentTrack, playTrack, togglePlay } = usePlayer();
  const [startingTrack, setStartingTrack] = useState("");
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [error, setError] = useState("");
  const headReveal = useReveal<HTMLDivElement>();
  const listReveal = useReveal<HTMLDivElement>();

  async function startHistoryTrack(item: HistoryItem) {
    if (currentTrack?.id === item.provider_track_id) {
      togglePlay();
      return;
    }
    setStartingTrack(item.provider_track_id);
    setError("");
    try {
      const params = new URLSearchParams({ id: item.provider_track_id });
      const response = await fetch(`${API}/api/v1/providers/jamendo/tracks?${params.toString()}`);
      const result = await response.json() as TrackResult;
      if (!response.ok) throw new Error(result.error || "Could not load this track for playback.");
      const track = result.items?.[0];
      if (!track || track.id !== item.provider_track_id) throw new Error("This track is no longer available for licensed playback.");
      playTrack(track, [track]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start this track.");
    } finally {
      setStartingTrack("");
    }
  }

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const refresh = await fetch(`/api/auth/refresh`, { method: "POST", credentials: "include" });
        if (!refresh.ok) return;
        const session = await refresh.json() as ApiResult;
        const token = session.session?.access_token;
        if (!token) return;
        if (active) setSignedIn(true);
        const response = await fetch(`${API}/api/v1/provider-history?limit=100`, {
          headers: { Authorization: `Bearer ${token}` }, credentials: "include"
        });
        const result = await response.json() as ApiResult;
        if (!response.ok) throw new Error(result.error || "Could not load listening history.");
        if (active) setItems(result.items ?? []);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Could not load listening history.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, []);

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-4 py-6 pb-36 md:px-8">
      <section className="panel-hero mt-6 px-6 py-8 md:px-10 md:py-11">
        <p className="t-eyebrow flex items-center gap-2 text-sky-200"><Headphones size={13} /> {t("Your listening trail")}</p>
        <h1 className="t-display mt-4">{t("Recently heard.")}</h1>
        <p className="t-meta mt-3 max-w-xl leading-6">{t("Real playback events from your SONORA sessions. Plays, completed tracks and skips are recorded separately.")}</p>
      </section>

      {loading ? <div className="mt-8"><RowsSkeleton count={6} /></div> : !signedIn ? (
        <div className="mt-8">
          <StateBlock
            icon={Clock3}
            tone="sky"
            title={t("Sign in to see your history.")}
            body={t("Real playback events from your SONORA sessions. Plays, completed tracks and skips are recorded separately.")}
            actionHref="/auth"
            actionLabel={t("Sign in")}
          />
        </div>
      ) : items.length === 0 ? (
        <div className="mt-8">
          <StateBlock
            icon={Clock3}
            tone="neutral"
            title={t("Your listening history is empty.")}
            body={t("Play a track in Discover and it will appear here.")}
            actionHref="/discover"
            actionLabel={t("Explore music")}
          />
        </div>
      ) : (
        <section className="mt-8" aria-labelledby="history-heading">
          <div ref={headReveal} className="rv rv-mask mb-3 flex items-end justify-between">
            <div>
              <p className="t-eyebrow">{t("Your activity")}</p>
              <h2 id="history-heading" className="t-h2 mt-1">{t("Listening events")}</h2>
            </div>
            <span className="t-meta">{items.length} {t("events")}</span>
          </div>
          <div ref={listReveal} className="rv rv-flat rv-stagger-x min-w-0 space-y-0.5">
            {items.map((item) => (
              <TrackRow
                key={item.id}
                track={{
                  id: item.provider_track_id,
                  title: item.title,
                  artist: item.artist_name,
                  artworkUrl: item.artwork_url,
                  durationSeconds: item.duration_seconds
                }}
                isCurrent={currentTrack?.id === item.provider_track_id}
                busy={startingTrack === item.provider_track_id}
                onPlay={() => void startHistoryTrack(item)}
                meta={<>
                  <span className="inline-flex items-center gap-1 align-[-2px]">
                    {item.event_type === "complete"
                      ? <CheckCircle2 size={13} className="text-emerald-300" />
                      : item.event_type === "skip"
                        ? <SkipForward size={13} className="text-slate-500" />
                        : <Play size={12} className="text-slate-500" fill="currentColor" />}
                    {t(eventLabel(item.event_type))}
                  </span>
                  {" · "}{dateLabel(item.occurred_at)} · {timeLabel(item.listened_ms)} {t("listened")}
                </>}
                trailing={
                  <a href={item.source_url} target="_blank" rel="noreferrer" aria-label={t("Open track page")} className="btn-icon hidden sm:grid"><Link2 size={16} /></a>
                }
              />
            ))}
          </div>
        </section>
      )}
      {error && <div className="mt-6"><ErrorBlock title={t("Could not load listening history.")} body={error} onRetry={() => window.location.reload()} retryLabel={t("Try again")} /></div>}
    </main>
  );
}
