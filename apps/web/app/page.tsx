"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, AudioLines, Clock3, Compass, Heart, Headphones, Library, ListMusic, Music2, Pause, Play, Search, Settings, Sparkles, LoaderCircle } from "lucide-react";
import { useLanguage } from "../components/language-provider";
import { useAuth } from "../components/auth-provider";
import { usePlayer, type PlayerTrack } from "../components/player-provider";

type CatalogTrack = PlayerTrack & { provider: string; playable?: boolean };
type CatalogResponse = { items?: CatalogTrack[]; error?: string };

const API = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");

function duration(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export default function Home() {
  const { t } = useLanguage();
  const { user, loading } = useAuth();
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
    <main className="mx-auto flex min-h-screen max-w-[1440px] gap-5 px-4 py-5 md:px-8">
      <aside className="hidden w-60 shrink-0 flex-col rounded-3xl border border-white/[0.07] bg-white/[0.025] p-5 md:flex">
        <a href="/" className="mb-12 flex items-center gap-3 text-xl font-semibold tracking-[.22em]"><span className="grid h-9 w-9 place-items-center rounded-xl bg-violet-400/15 text-violet-200"><AudioLines size={20}/></span>SONORA</a>
        <p className="mb-3 text-[10px] font-semibold uppercase tracking-[.24em] text-slate-500">{t("Workspace")}</p>
        <nav className="space-y-2 text-sm text-slate-300">
          <a className="flex items-center gap-3 rounded-xl bg-violet-400/10 px-3 py-3 text-violet-200" href="/"><Compass size={17}/> {t("Discover")}</a>
          <a className="flex items-center gap-3 rounded-xl px-3 py-3 hover:bg-white/5" href="/search"><Search size={17}/> {t("Search")}</a>
          <a className="flex items-center gap-3 rounded-xl px-3 py-3 hover:bg-white/5" href="/playlists"><Library size={17}/> {t("Your library")}</a>
          <a className="flex items-center gap-3 rounded-xl px-3 py-3 hover:bg-white/5" href="/favorites"><Heart size={17}/> {t("Liked tracks")}</a>
          <a className="flex items-center gap-3 rounded-xl px-3 py-3 hover:bg-white/5" href="/history"><Clock3 size={17}/> {t("Listening history")}</a>
          <a className="flex items-center gap-3 rounded-xl px-3 py-3 hover:bg-white/5" href="/playlists"><ListMusic size={17}/> {t("Playlists")}</a>
          <a className="flex items-center gap-3 rounded-xl px-3 py-3 hover:bg-white/5" href="/settings"><Settings size={17}/> {t("Settings")}</a>
        </nav>
        <div className="mt-auto rounded-2xl border border-white/[0.07] bg-gradient-to-br from-violet-500/15 to-transparent p-4">
          <Sparkles className="mb-3 text-violet-200" size={18}/>
          <p className="text-sm font-medium">{t("Your sound, evolving.")}</p>
          <p className="mt-1 text-xs leading-5 text-slate-400">{t("Personalized discovery is coming as your listening story grows.")}</p>
        </div>
      </aside>

      <section className="min-w-0 flex-1 pb-32">
        <header className="flex items-center justify-between gap-4 py-3">
          <div className="flex items-center gap-2 font-semibold tracking-[.2em] md:hidden"><AudioLines className="text-violet-300"/> SONORA</div>
          <div className="hidden text-sm text-slate-400 md:block">{t("Your music, from connected catalogs.")}</div>
          <div className="flex items-center gap-3">
            <a href="/settings" aria-label={t("Settings")} className="rounded-full border border-white/10 p-2 text-slate-300 hover:bg-white/5"><Settings size={16}/></a>
            <a href="/import" className="hidden text-xs text-slate-400 hover:text-white sm:inline">{t("Import tracks")}</a>
            {loading ? <span className="h-9 w-20 animate-pulse rounded-full bg-white/10" /> : user ? <a href="/profile" aria-label={t("Your profile")} className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] p-1.5 pr-3 text-xs text-slate-200 hover:bg-white/10">{user.avatarUrl ? <img src={user.avatarUrl} alt="" className="h-7 w-7 rounded-full object-cover" /> : <span className="grid h-7 w-7 place-items-center rounded-full bg-violet-200/20 text-violet-100">{(user.displayName || user.username || user.email).slice(0,1).toUpperCase()}</span>}<span className="max-w-24 truncate">{user.displayName || user.username || t("Your profile")}</span></a> : <a href="/auth" className="rounded-full bg-violet-200 px-4 py-2 text-xs font-semibold text-[#171323] transition hover:bg-white">{t("Sign in")}</a>}
          </div>
        </header>

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

        <section className="mt-12">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <div><p className="text-[10px] font-semibold uppercase tracking-[.25em] text-violet-300">{t("Live music catalogs")}</p><h2 className="mt-2 text-2xl font-semibold">{t("Music to explore")}</h2><p className="mt-1 text-xs text-slate-500">{t("Live selections from Audius and Jamendo")}</p></div>
            <a href="/discover" className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-white">{t("View full catalog")} <ArrowUpRight size={13}/></a>
          </div>
          {catalogLoading ? <div className="flex min-h-40 items-center justify-center gap-3 text-sm text-slate-400"><LoaderCircle className="animate-spin" size={18}/> {t("Loading the catalog…")}</div> : tracks.length === 0 ? <div className="rounded-3xl border border-white/10 bg-white/[0.025] p-8 text-sm text-slate-400">{catalogError || t("No tracks are available right now.")} <a href="/discover" className="ml-2 text-violet-200 hover:text-white">{t("Open Discover")}</a></div> : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {tracks.map((track) => <article key={track.id} className="group flex min-w-0 items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-3 transition hover:-translate-y-0.5 hover:bg-white/[0.05]">
                <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-violet-300/10"><div className="grid h-full w-full place-items-center"><Music2 className="text-violet-200"/></div>{track.artworkUrl && <img src={track.artworkUrl} alt={track.title} loading="lazy" onError={(event) => { event.currentTarget.style.display = "none"; }} className="absolute inset-0 h-full w-full object-cover"/>}</div>
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
