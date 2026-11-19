"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ExternalLink, LoaderCircle, Music2, Play } from "lucide-react";
import { usePlayer, type PlayerTrack } from "../../../../components/player-provider";
import { useLanguage } from "../../../../components/language-provider";

type ArtistTrack = Omit<PlayerTrack, "audioUrl"> & {
  audioUrl: string | null;
  provider: string;
  providerTrackId: string;
  playable: boolean;
  licenseUrl: string | null;
  sourceUrl: string;
  artistId: string;
};

type CatalogPage = {
  items?: ArtistTrack[];
  hasMore?: boolean;
  totalCount?: number | null;
  nextOffset?: number | null;
  error?: string;
};

const API = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");
const PAGE_SIZE = 50;
const duration = (seconds?: number | null) =>
  seconds ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}` : "";

export default function ArtistCatalogPage() {
  const params = useParams<{ provider: string; artistId: string }>();
  const provider = params.provider;
  const artistId = params.artistId;
  const { t } = useLanguage();
  const { playTrack } = usePlayer();
  const [tracks, setTracks] = useState<ArtistTrack[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const requestController = useRef<AbortController | null>(null);

  const loadPage = useCallback(async (nextOffset: number, append: boolean) => {
    if (provider !== "audius" || !/^[a-zA-Z0-9_-]{1,64}$/.test(artistId)) {
      setError("This artist catalog provider is not supported yet.");
      setLoading(false);
      setLoadingMore(false);
      return;
    }
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(nextOffset) });
      const response = await fetch(`${API}/api/v1/providers/audius/artists/${encodeURIComponent(artistId)}/tracks?${query.toString()}`, { signal: controller.signal });
      const result = await response.json() as CatalogPage;
      if (!response.ok) throw new Error(result.error || "Artist catalog could not be loaded.");
      const pageItems = result.items ?? [];
      setTracks((current) => append
        ? [...current, ...pageItems.filter((item) => !current.some((existing) => existing.id === item.id))]
        : pageItems);
      setOffset(result.nextOffset ?? nextOffset + pageItems.length);
      setHasMore(result.hasMore === true);
      setTotalCount(typeof result.totalCount === "number" ? result.totalCount : null);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Artist catalog could not be loaded.");
    } finally {
      if (requestController.current === controller) {
        requestController.current = null;
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [provider, artistId]);

  useEffect(() => {
    setTracks([]);
    setOffset(0);
    setHasMore(false);
    setTotalCount(null);
    void loadPage(0, false);
    return () => requestController.current?.abort();
  }, [loadPage]);

  const playable = tracks.filter((track): track is ArtistTrack & { audioUrl: string } =>
    track.playable && typeof track.audioUrl === "string" && track.audioUrl.length > 0
  );

  return (
    <main className="mx-auto min-h-screen max-w-[1100px] px-4 py-6 pb-36 md:px-8">
      <header className="flex items-center justify-between">
        <Link href="/search" className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white"><ArrowLeft size={17}/> {t("Back to search")}</Link>
        <span className="text-sm font-semibold tracking-[.2em]">SONORA</span>
      </header>
      <section className="mt-9 rounded-[2rem] border border-violet-300/15 bg-gradient-to-br from-[#292044] via-[#171426] to-[#10131c] p-7 md:p-9">
        <p className="text-[10px] font-semibold uppercase tracking-[.25em] text-violet-200">Audius · Artist catalog</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">{t("Artist discography")}</h1>
        <p className="mt-2 text-sm text-slate-400">{t("Public tracks from this artist, loaded page by page. Tracks restricted by the provider remain visible but cannot be played here.")}</p>
        <div className="mt-5 flex flex-wrap gap-4 text-xs text-slate-400">
          <span>{tracks.length}{totalCount !== null ? ` / ${totalCount}` : ""} {t("tracks loaded")}</span>
          <span>{playable.length} {t("playable")}</span>
          <a className="inline-flex items-center gap-1 hover:text-white" href={`https://audius.co`} target="_blank" rel="noreferrer">Audius <ExternalLink size={12}/></a>
        </div>
      </section>

      {error && <p role="alert" className="mt-6 rounded-2xl border border-rose-300/15 bg-rose-300/5 p-4 text-sm text-rose-200">{error}</p>}
      {loading ? (
        <div className="flex min-h-48 items-center justify-center gap-3 text-sm text-slate-400"><LoaderCircle className="animate-spin" size={18}/> {t("Loading artist catalog…")}</div>
      ) : tracks.length === 0 && !error ? (
        <div className="mt-8 rounded-2xl border border-white/10 p-8 text-center text-sm text-slate-400">{t("No public tracks were returned for this artist.")}</div>
      ) : (
        <section className="mt-8">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-semibold">{t("Tracks")}</h2>
            <span className="text-xs text-slate-500">{tracks.length} {t("loaded")}</span>
          </div>
          <div className="space-y-2">
            {tracks.map((track, index) => (
              <article key={track.id} className="flex min-w-0 items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-3">
                <span className="w-7 shrink-0 text-center text-xs text-slate-600">{index + 1}</span>
                <div className="relative grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-violet-300/10">
                  <Music2 size={20} className="text-violet-200"/>
                  {track.artworkUrl && <img src={track.artworkUrl} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" onError={(event) => event.currentTarget.remove()}/>}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{track.title}</p>
                  <p className="truncate text-xs text-slate-400">{track.artist}{track.album ? ` · ${track.album}` : ""}</p>
                  <p className="mt-1 text-[10px] text-slate-500">{track.playable ? t("Playable via Audius") : t("Provider-restricted or unavailable")} {track.durationSeconds ? ` · ${duration(track.durationSeconds)}` : ""}</p>
                </div>
                <a href={track.sourceUrl} target="_blank" rel="noreferrer" aria-label={t("Open source")} className="shrink-0 rounded-lg p-2 text-slate-500 hover:text-white"><ExternalLink size={15}/></a>
                <button
                  type="button"
                  disabled={!track.playable || !track.audioUrl}
                  onClick={() => {
                    if (!track.playable || !track.audioUrl) return;
                    const playableTrack: PlayerTrack = { ...track, audioUrl: track.audioUrl };
                    const start = playable.findIndex((item) => item.id === track.id);
                    playTrack(playableTrack, start >= 0 ? playable.slice(start) : [playableTrack]);
                  }}
                  aria-label={t("Play track")}
                  className="shrink-0 rounded-full bg-violet-200 p-3 text-[#171323] disabled:cursor-not-allowed disabled:opacity-30"
                ><Play size={15} fill="currentColor"/></button>
              </article>
            ))}
          </div>
          {hasMore && <div className="mt-6 flex justify-center">
            <button type="button" disabled={loadingMore} onClick={() => void loadPage(offset, true)} className="inline-flex items-center gap-2 rounded-xl border border-violet-200/20 bg-violet-200/10 px-5 py-3 text-sm text-violet-100 disabled:opacity-50">
              {loadingMore && <LoaderCircle size={16} className="animate-spin"/>}
              {t("Load more tracks")}
            </button>
          </div>}
        </section>
      )}
      <footer className="mt-14 border-t border-white/[0.07] py-6 text-xs text-slate-600">SONORA · Audius public artist catalog · Provider playback restrictions are respected</footer>
    </main>
  );
}
