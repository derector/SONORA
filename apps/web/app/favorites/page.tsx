"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, AudioLines, Heart, LoaderCircle, Music2, Play, Trash2 } from "lucide-react";
import { useLanguage } from "../../components/language-provider";
import { usePlayer, type PlayerTrack } from "../../components/player-provider";

type Favorite = {
  provider_track_id: string;
  title: string;
  artist_name: string;
  album_name: string | null;
  duration_seconds: number | null;
  artwork_url: string | null;
  license_url: string;
  source_url: string;
  created_at: string;
};
type ApiResult = { items?: Favorite[]; error?: string; session?: { access_token?: string } };
type TrackResult = { items?: PlayerTrack[]; error?: string };
const API = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");

function duration(seconds: number | null) {
  if (!seconds) return "Duration unavailable";
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export default function FavoritesPage() {
  const { t } = useLanguage();
  const { currentTrack, isPlaying, playTrack, togglePlay } = usePlayer();
  const [token, setToken] = useState("");
  const [startingTrack, setStartingTrack] = useState("");
  const [items, setItems] = useState<Favorite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch(`/api/auth/refresh`, { method: "POST", credentials: "include" })
      .then(async (response) => response.ok ? response.json() as Promise<ApiResult> : null)
      .then(async (result) => {
        const accessToken = result?.session?.access_token;
        if (!active || !accessToken) return;
        setToken(accessToken);
        const response = await fetch(`${API}/api/v1/provider-favorites`, {
          headers: { Authorization: `Bearer ${accessToken}` }, credentials: "include"
        });
        const data = await response.json() as ApiResult;
        if (!response.ok) throw new Error(data.error || "Could not load your favorites.");
        if (active) setItems(data.items ?? []);
      })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : "Could not load your favorites."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function startFavorite(item: Favorite) {
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
      if (!track || track.id !== item.provider_track_id) {
        throw new Error("This track is no longer available for licensed playback.");
      }
      playTrack(track, [track]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start this track.");
    } finally {
      setStartingTrack("");
    }
  }

  async function removeFavorite(id: string) {
    if (!token) return;
    setError("");
    try {
      const response = await fetch(`${API}/api/v1/provider-favorites/${encodeURIComponent(id)}`, {
        method: "DELETE", headers: { Authorization: `Bearer ${token}` }, credentials: "include"
      });
      const result = await response.json() as ApiResult;
      if (!response.ok) throw new Error(result.error || "Could not remove this track.");
      setItems((current) => current.filter((item) => item.provider_track_id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove this track.");
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-4 py-6 pb-36 md:px-8">
      <section className="mt-10 rounded-[2rem] border border-rose-300/15 bg-gradient-to-br from-[#352033] via-[#1c1725] to-[#10131c] p-7 md:p-10">
        <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.25em] text-rose-200"><Heart size={13}/> {t("Your saved music")}</p>
        <h1 className="mt-4 text-3xl font-semibold md:text-5xl">{t("Keep the good ones close.")}</h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-slate-300">{t("Tracks you save are stored in your SONORA account with their original source and license details.")}</p>
      </section>
      {loading ? <div className="flex min-h-48 items-center justify-center gap-3 text-sm text-slate-400"><LoaderCircle className="animate-spin" size={18}/> {t("Loading your favorites…")}</div> : !token ? (
        <section className="mt-8 rounded-3xl border border-white/10 bg-white/[0.025] p-7"><h2 className="text-xl font-semibold">{t("Sign in to see your saved tracks.")}</h2><Link href="/auth" className="mt-5 inline-flex rounded-full bg-violet-200 px-5 py-3 text-sm font-semibold text-[#171323]">{t("Sign in or create account")}</Link></section>
      ) : items.length === 0 ? (
        <section className="mt-8 rounded-3xl border border-dashed border-white/10 p-10 text-center"><Music2 className="mx-auto text-slate-500" size={30}/><p className="mt-3 font-medium">{t("Your favorites shelf is empty.")}</p><p className="mt-1 text-sm text-slate-500">{t("Save a track from Discover and it will appear here.")}</p><Link href="/discover" className="mt-5 inline-flex rounded-full bg-violet-200 px-5 py-3 text-sm font-semibold text-[#171323]">{t("Explore music")}</Link></section>
      ) : (
        <section className="mt-8 space-y-3">
          <div className="mb-4 flex items-end justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[.25em] text-rose-300">{t("Your collection")}</p><h2 className="mt-2 text-2xl font-semibold">{t("Saved tracks")}</h2></div><span className="text-xs text-slate-500">{items.length} {t("tracks")}</span></div>
          {items.map((item) => <article key={item.provider_track_id} className="flex items-center gap-4 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-3">
            {item.artwork_url ? <img src={item.artwork_url} alt="" className="h-16 w-16 rounded-xl object-cover"/> : <div className="grid h-16 w-16 place-items-center rounded-xl bg-violet-300/10"><Music2 className="text-violet-200"/></div>}
            <div className="min-w-0 flex-1"><h3 className="truncate font-medium">{item.title}</h3><p className="mt-1 truncate text-sm text-slate-400">{item.artist_name}</p><p className="mt-1 text-xs text-slate-500">{item.album_name || t("Independent release")} · {duration(item.duration_seconds)}</p><div className="mt-2 flex gap-3 text-xs text-slate-400"><a href={item.license_url} target="_blank" rel="noreferrer" className="hover:text-white">{t("License")}</a><Link href="/legal" className="hover:text-white">{t("Licensing and attribution")}</Link></div></div>
            <button type="button" onClick={() => void startFavorite(item)} disabled={startingTrack === item.provider_track_id} aria-label={`${currentTrack?.id === item.provider_track_id && isPlaying ? t("Pause") : t("Play")} ${item.title}`} className="rounded-lg p-2 text-violet-200 transition hover:bg-violet-300/10 disabled:opacity-40">{startingTrack === item.provider_track_id ? <LoaderCircle size={17} className="animate-spin"/> : <Play size={17} fill="currentColor"/>}</button>
            <button type="button" onClick={() => void removeFavorite(item.provider_track_id)} aria-label={`${t("Remove from favorites")}: ${item.title}`} className="rounded-lg p-2 text-slate-500 transition hover:bg-rose-400/10 hover:text-rose-200"><Trash2 size={17}/></button>
          </article>)}
        </section>
      )}
      {error && <p role="alert" className="mt-5 rounded-xl border border-rose-300/15 bg-rose-300/5 px-4 py-3 text-xs text-rose-200">{error}</p>}
    </main>
  );
}
