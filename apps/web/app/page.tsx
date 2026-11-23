"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, AudioLines, Search, Sparkles, Heart, History, ListMusic } from "lucide-react";
import { useLanguage } from "../components/language-provider";
import { usePlayer, type PlayerTrack } from "../components/player-provider";
import { MoodPicker } from "../components/mood-picker";
import { Rail } from "../components/ui/rail";
import { TrackCard } from "../components/ui/track-card";
import { ErrorBlock, RailSkeleton } from "../components/ui/states";
import { useReveal } from "../lib/motion";

type CatalogTrack = PlayerTrack & { provider: string; playable?: boolean };
type CatalogResponse = { items?: CatalogTrack[]; error?: string };

const API = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");

export default function Home() {
  const { t } = useLanguage();
  const { currentTrack, isPlaying, playTrack, togglePlay } = usePlayer();
  const [tracks, setTracks] = useState<CatalogTrack[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState("");
  const notesReveal = useReveal<HTMLElement>();

  useEffect(() => {
    let active = true;
    async function loadCatalog() {
      setCatalogLoading(true);
      setCatalogError("");
      // Two catalogs are fetched to keep the shelf full, but they are presented
      // as one unified selection: no source names ever reach the interface.
      const sources = [
        fetch(`${API}/api/v1/providers/audius/tracks?sort=trending&limit=8`).then(async (response) => {
          const data = await response.json() as CatalogResponse;
          if (!response.ok) throw new Error(data.error || "The music catalog is temporarily unavailable.");
          return data.items ?? [];
        }),
        fetch(`${API}/api/v1/providers/jamendo/tracks?q=music&limit=8`).then(async (response) => {
          const data = await response.json() as CatalogResponse;
          if (!response.ok) throw new Error(data.error || "The music catalog is temporarily unavailable.");
          return data.items ?? [];
        })
      ];
      const results = await Promise.allSettled(sources);
      if (!active) return;
      const firstCatalog = results[0].status === "fulfilled" ? results[0].value : [];
      const secondCatalog = results[1].status === "fulfilled" ? results[1].value : [];
      const available = Array.from(
        { length: Math.max(firstCatalog.length, secondCatalog.length) },
        (_, index) => [firstCatalog[index], secondCatalog[index]]
      ).flat().filter((track): track is CatalogTrack => Boolean(track));
      const unique = available.filter((track, index, all) => track.audioUrl && all.findIndex((item) => item.id === track.id) === index);
      setTracks(unique.slice(0, 12));
      if (!unique.length) {
        const failure = results.find((result) => result.status === "rejected");
        setCatalogError(failure?.status === "rejected" && failure.reason instanceof Error
          ? failure.reason.message
          : "No tracks are available right now.");
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
    <main className="mx-auto flex min-h-screen w-full max-w-[1440px] px-4 py-6 pb-36 md:px-8">
      <section className="min-w-0 flex-1 pb-safe">

        <div className="panel-hero relative mt-6 overflow-hidden px-6 py-8 md:px-12 md:py-14">
          <div className="absolute -right-16 -top-24 h-72 w-72 rounded-full bg-fuchsia-500/12 blur-3xl" />
          <div className="relative max-w-2xl">
            <p className="t-eyebrow flex items-center gap-2 text-violet-200"><Sparkles size={13} /> {t("A new way to feel music")}</p>
            <h1 className="t-display mt-4">{t("Find your")}<br /><span className="bg-gradient-to-r from-violet-200 via-fuchsia-200 to-teal-200 bg-clip-text text-transparent">{t("own frequency.")}</span></h1>
            <p className="t-meta mt-4 max-w-lg leading-6">{t("Discover independent music, play every track from one unified catalog, and build a soundtrack that feels like yours.")}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href="/discover" className="btn-press btn-primary">{t("Explore your sound")} <ArrowUpRight size={16} /></a>
              <a href="/search" className="btn-press btn-ghost"><Search size={16} /> {t("Search music")}</a>
            </div>
          </div>
          <div className="absolute bottom-8 right-10 hidden h-48 w-48 rotate-[-12deg] items-center justify-center rounded-panel border border-white/15 bg-white/[0.04] shadow-float backdrop-blur-xl lg:flex">
            <div className="absolute inset-4 rounded-full border border-violet-200/20" />
            <div className="absolute inset-8 rounded-full border border-fuchsia-200/20" />
            <div className="absolute inset-12 rounded-full bg-gradient-to-br from-violet-300/30 to-teal-400/10" />
            <AudioLines size={54} strokeWidth={1} className="text-violet-100" />
          </div>
        </div>

        <nav aria-label={t("Your library")} className="listening-shortcuts">
          {[
            { href: "/favorites", label: t("Favorites"), Icon: Heart },
            { href: "/history", label: t("Recently played"), Icon: History },
            { href: "/playlists", label: t("Playlists"), Icon: ListMusic }
          ].map(({ href, label, Icon }) => (
            <a key={href} href={href} className="listening-shortcut">
              <span className="shortcut-icon"><Icon size={20} aria-hidden="true" /></span>
              <span>{label}</span><ArrowUpRight size={16} aria-hidden="true" />
            </a>
          ))}
        </nav>

        <MoodPicker />

        {catalogLoading ? <div className="mt-2"><RailSkeleton count={6} /></div> : tracks.length === 0 ? (
          <div className="mt-8">
            <ErrorBlock
              title={catalogError || t("No tracks are available right now.")}
              body={t("Live selections from the licensed catalogs")}
              actionHref="/discover"
              actionLabel={t("Open Discover")}
            />
          </div>
        ) : (
          <Rail
            eyebrow={t("Catalog")}
            title={t("Music to explore")}
            titleId="home-catalog-heading"
            subtitle={t("Live selections from the licensed catalogs")}
            viewAllHref="/discover"
          >
            {playableTracks.map((track) => (
              <div key={track.id} className="rail-item">
                <TrackCard
                  title={track.title}
                  artist={track.artist}
                  artworkUrl={track.artworkUrl}
                  isCurrent={currentTrack?.id === track.id}
                  isPlaying={isPlaying}
                  onPlay={() => startTrack(track)}
                  disabled={!track.audioUrl || track.playable === false}
                />
              </div>
            ))}
          </Rail>
        )}

        <section ref={notesReveal} className="surface mt-10 rv flex items-center gap-3 p-5 md:p-6">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-tile bg-accent-soft text-violet-200"><AudioLines size={19} /></span>
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold leading-snug">{t("A listening space, not just a feed.")}</h2>
            <p className="t-meta mt-0.5">{t("One catalog, one player. Licensing and attribution stay attached to every track.")}</p>
          </div>
          <a href="/legal" className="btn-press ml-auto hidden shrink-0 items-center gap-1 text-sm text-muted hover:text-white sm:inline-flex">{t("Licensing and attribution")} <ArrowUpRight size={13} /></a>
        </section>
        <footer className="mt-10 border-t border-white/[0.06] pt-5 text-[13px] text-muted">{t("SONORA · Independent music · Music rights first")}</footer>
      </section>
    </main>
  );
}
