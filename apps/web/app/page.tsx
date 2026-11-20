"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, AudioLines, Clock3, Compass, Heart, Headphones, Library, ListMusic, Music2, Pause, Play, Search, Settings, Sparkles, LoaderCircle } from "lucide-react";
import { useLanguage } from "../components/language-provider";
import { usePlayer, type PlayerTrack } from "../components/player-provider";
import { MoodPicker } from "../components/mood-picker";

type CatalogTrack = PlayerTrack & { provider: string; playable?: boolean };
type CatalogResponse = { items?: CatalogTrack[]; error?: string };

const API = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");

function duration(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export default function Home() {
  const { t } = useLanguage();
  const { currentTrack, isPlaying, playTrack, togglePlay } = usePlayer();
  const [tracks, setTracks] = useState<CatalogTrack[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState("");

  useEffect(() => {
    let active = true;
    async function loadCatalog() {
      setCatalogLoading(true);
      setCatalogError("");
      const sources = [
        fetch(`${API}/api/v1/providers/audius/tracks?sort=trending&limit=8`).then(async (response) => {
          const data = await response.json() as CatalogResponse;
          if (!response.ok) throw new Error(data.error || "Audius catalog is unavailable.");
          return data.items ?? [];
        }),
        fetch(`${API}/api/v1/providers/jamendo/tracks?q=music&limit=8`).then(async (response) => {
          const data = await response.json() as CatalogResponse;
          if (!response.ok) throw new Error(data.error || "Jamendo catalog is unavailable.");
          return data.items ?? [];
        })
      ];
      const results = await Promise.allSettled(sources);
      if (!active) return;
      const audiusTracks = results[0].status === "fulfilled" ? results[0].value : [];
      const jamendoTracks = results[1].status === "fulfilled" ? results[1].value : [];
      const available = Array.from(
        { length: Math.max(audiusTracks.length, jamendoTracks.length) },
        (_, index) => [audiusTracks[index], jamendoTracks[index]]
      ).flat().filter((track): track is CatalogTrack => Boolean(track));
      const unique = available.filter((track, index, all) => track.audioUrl && all.findIndex((item) => item.id === track.id) === index);
      setTracks(unique.slice(0, 12));
      if (!unique.length) {
        const failure = results.find((result) => result.status === "rejected");
        setCatalogError(failure?.status === "rejected" && failure.reason instanceof Error
          ? failure.reason.message
          : "No playable tracks are available right now.");
      }
      setCatalogLoading(false);
    }
    void loadCatalog();
    return () => { active = false; };
  }, []);

  const playableTracks = tracks.filter((track) => track.playable !== false && Boolean(track.audioUrl));
  function startTrack(track: CatalogTrack) {
    if (currentTrack?.id === track.id) {
      togglePlay();
      return;
    }
    playTrack(track, playableTracks);
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[1440px] px-4 py-5 md:px-8">
      <section className="min-w-0 flex-1 pb-32">

        <div className="relative mt-8 overflow-hidden rounded-[2rem] border border-violet-300/15 bg-gradient-to-br from-[#292044] via-[#171426] to-[#10131c] p-7 shadow-glow md:p-12">
          <div className="absolute -right-16 -top-24 h-72 w-72 rounded-full bg-fuchsia-500/15 blur-3xl"/>
          <div className="relative max-w-2xl">
            <p className="mb-5 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.28em] text-violet-200"><Sparkles size={14}/> {t("A new way to feel music")}</p>
            <h1 className="text-4xl font-semibold leading-[1.08] tracking-tight md:text-6xl">{t("Find your")}<br/><span className="bg-gradient-to-r from-violet-200 via-fuchsia-200 to-sky-200 bg-clip-text text-transparent">{t("own frequency.")}</span></h1>
            <p className="mt-5 max-w-lg text-sm leading-6 text-slate-300 md:text-base">{t("Discover independent music, play tracks from their original providers, and build a soundtrack that feels like yours.")}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href="/discover" className="inline-flex items-center gap-2 rounded-full bg-violet-200 px-5 py-3 text-sm font-semibold text-[#171323] transition hover:bg-white">{t("Explore your sound")} <ArrowUpRight size={16}/></a>
              <a href="/search" className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-5 py-3 text-sm font-medium text-white transition hover:bg-white/10"><Search size={16}/> {t("Search music")}</a>
            </div>
          </div>
          <div className="absolute bottom-8 right-10 hidden h-48 w-48 rotate-[-12deg] items-center justify-center rounded-[2.5rem] border border-white/15 bg-white/[0.04] shadow-2xl backdrop-blur-xl lg:flex">
            <div className="absolute inset-4 rounded-full border border-violet-200/20"/>
            <div className="absolute inset-8 rounded-full border border-fuchsia-200/20"/>
            <div className="absolute inset-12 rounded-full bg-gradient-to-br from-violet-300/30 to-fuchsia-400/10"/>
            <AudioLines size={54} strokeWidth={1} className="text-violet-100"/>
          </div>
        </div>

        <MoodPicker/>

        <section className="mt-12">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <div><p className="text-[10px] font-semibold uppercase tracking-[.25em] text-violet-300">{t("Live music catalogs")}</p><h2 className="mt-2 text-2xl font-semibold">{t("Music to explore")}</h2><p className="mt-1 text-xs text-slate-500">{t("Live selections from Audius and Jamendo")}</p></div>
            <a href="/discover" className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-white">{t("View full catalog")} <ArrowUpRight size={13}/></a>
          </div>
          {catalogLoading ? <div className="flex min-h-40 items-center justify-center gap-3 text-sm text-slate-400"><LoaderCircle className="animate-spin" size={18}/> {t("Loading the catalog…")}</div> : tracks.length === 0 ? <div className="rounded-3xl border border-white/10 bg-white/[0.025] p-8 text-sm text-slate-400">{catalogError || t("No tracks are available right now.")} <a href="/discover" className="ml-2 text-violet-200 hover:text-white">{t("Open Discover")}</a></div> : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {tracks.map((track) => <article key={track.id} className="group flex min-w-0 items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-3 transition hover:-translate-y-0.5 hover:bg-white/[0.05]">
                <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-violet-300/10">{track.artworkUrl ? <img src={track.artworkUrl} alt="" loading="lazy" className="h-full w-full object-cover"/> : <div className="grid h-full place-items-center"><Music2 className="text-violet-200"/></div>}</div>
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{track.title}</p><p className="truncate text-xs text-slate-400">{track.artist}</p><p className="mt-1 text-[10px] text-slate-500">{track.provider} · {duration(track.durationSeconds)}</p></div>
                <button type="button" onClick={() => startTrack(track)} disabled={!track.audioUrl || track.playable === false} aria-label={currentTrack?.id === track.id && isPlaying ? t("Pause") : t("Play")} className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-violet-200 text-[#171323] transition hover:scale-105 disabled:opacity-40">{currentTrack?.id === track.id && isPlaying ? <Pause size={16} fill="currentColor"/> : <Play size={16} fill="currentColor"/>}</button>
              </article>)}
            </div>
          )}
        </section>

        <section className="mt-12 rounded-3xl border border-white/[0.07] bg-white/[0.025] p-6 md:p-8">
          <div className="flex items-center gap-3"><Headphones className="text-violet-200"/><div><h2 className="font-semibold">{t("A listening space, not just a feed.")}</h2><p className="mt-1 text-xs text-slate-400">{t("Playback stays connected to the original provider, with source and license details preserved.")}</p></div></div>
        </section>
        <footer className="mt-12 border-t border-white/[0.07] pt-5 text-xs text-slate-500">{t("SONORA · Independent music · Music rights first")}</footer>
      </section>
    </main>
  );
}
