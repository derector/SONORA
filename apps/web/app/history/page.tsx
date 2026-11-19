"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Clock3, Headphones, ListMusic, LoaderCircle, Music2, Play, SkipForward } from "lucide-react";
import { useLanguage } from "../../components/language-provider";
import { usePlayer, type PlayerTrack } from "../../components/player-provider";

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
    <main className="mx-auto min-h-screen max-w-5xl px-4 py-6 pb-36 md:px-8">
      <section className="mt-10 rounded-[2rem] border border-sky-300/15 bg-gradient-to-br from-[#1d2d43] via-[#171b2a] to-[#10131c] p-7 md:p-10">
        <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.25em] text-sky-200"><Headphones size={14}/> {t("Your listening trail")}</p>
        <h1 className="mt-4 text-3xl font-semibold md:text-5xl">{t("Recently heard.")}</h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-slate-300">{t("Real playback events from your SONORA sessions. Plays, completed tracks and skips are recorded separately.")}</p>
      </section>
      {loading ? <div className="flex min-h-48 items-center justify-center gap-3 text-sm text-slate-400"><Clock3 className="animate-pulse" size={18}/> {t("Loading listening history…")}</div> : !signedIn ? (
        <section className="mt-8 rounded-3xl border border-white/10 p-8"><h2 className="text-xl font-semibold">{t("Sign in to see your history.")}</h2><Link href="/auth" className="mt-5 inline-flex rounded-full bg-violet-200 px-5 py-3 text-sm font-semibold text-[#171323]">{t("Sign in")}</Link></section>
      ) : items.length === 0 ? (
        <section className="mt-8 rounded-3xl border border-dashed border-white/10 p-10 text-center"><ListMusic className="mx-auto text-slate-500" size={30}/><p className="mt-3 font-medium">{t("Your listening history is empty.")}</p><p className="mt-1 text-sm text-slate-500">{t("Play a track in Discover and it will appear here.")}</p><Link href="/discover" className="mt-5 inline-flex rounded-full bg-violet-200 px-5 py-3 text-sm font-semibold text-[#171323]">{t("Explore music")}</Link></section>
      ) : (
        <section className="mt-8 space-y-3">
          <div className="mb-4 flex items-end justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[.25em] text-sky-300">{t("Your activity")}</p><h2 className="mt-2 text-2xl font-semibold">{t("Listening events")}</h2></div><span className="text-xs text-slate-500">{items.length} events</span></div>
          {items.map((item) => <article key={item.id} className="flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-3">
            {item.artwork_url ? <img src={item.artwork_url} alt="" className="h-14 w-14 rounded-xl object-cover"/> : <div className="grid h-14 w-14 place-items-center rounded-xl bg-violet-300/10"><Music2 size={20}/></div>}
            <div className="min-w-0 flex-1"><h3 className="truncate text-sm font-medium">{item.title}</h3><p className="mt-1 truncate text-xs text-slate-400">{item.artist_name} · {item.album_name || "Independent release"}</p><p className="mt-1 text-[11px] text-slate-500">{dateLabel(item.occurred_at)} · {timeLabel(item.listened_ms)} listened</p></div>
            <span className="hidden items-center gap-1 text-[11px] text-slate-400 sm:inline-flex">{item.event_type === "complete" ? <CheckCircle2 size={13}/> : item.event_type === "skip" ? <SkipForward size={13}/> : <Headphones size={13}/>} {t(eventLabel(item.event_type))}</span>
            <button type="button" onClick={() => void startHistoryTrack(item)} disabled={startingTrack === item.provider_track_id} className="rounded-lg p-2 text-violet-200 transition hover:bg-violet-300/10 disabled:opacity-40" aria-label={t("Play") + " " + item.title}>{startingTrack === item.provider_track_id ? <LoaderCircle size={16} className="animate-spin"/> : <Play size={16} fill="currentColor"/>}</button>
            <a href={item.source_url} target="_blank" rel="noreferrer" className="rounded-lg p-2 text-slate-500 hover:bg-white/5 hover:text-white" aria-label={t("Open Jamendo source")}><Music2 size={16}/></a>
          </article>)}
        </section>
      )}
      {error && <p role="alert" className="mt-5 rounded-xl border border-rose-300/15 bg-rose-300/5 px-4 py-3 text-xs text-rose-200">{error}</p>}
    </main>
  );
}
