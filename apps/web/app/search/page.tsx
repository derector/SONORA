"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, AudioLines, ExternalLink, LoaderCircle, Music2, Play, Search, UserRound, Disc3 } from "lucide-react";
import { useLanguage } from "../../components/language-provider";
import { usePlayer, type PlayerTrack } from "../../components/player-provider";

type Track = PlayerTrack & { provider: string; playable: boolean; rightsLabel?: string };
type Artist = { id: string; provider: string; name: string; handle?: string | null; followerCount?: number | null; imageUrl?: string | null; sourceUrl: string };
type Metadata = { id: string; provider: string; title: string; artist: string; album?: string | null; durationSeconds?: number | null; releaseDate?: string | null; sourceUrl: string; playable: false };
type ProviderStatus = { ok: boolean; count: number; error?: string };
type SearchResponse = { tracks?: Track[]; artists?: Artist[]; metadata?: Metadata[]; providers?: Record<string, ProviderStatus>; error?: string };

const API = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");
const duration = (seconds?: number | null) => seconds ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}` : "";

export default function SearchPage() {
  const { t } = useLanguage();
  const { playTrack } = usePlayer();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | "tracks" | "artists">("all");
  const [tracks, setTracks] = useState<Track[]>([]);
  const [artists, setArtists] = useState<Artist[]>([]);
  const [metadata, setMetadata] = useState<Metadata[]>([]);
  const [providers, setProviders] = useState<Record<string, ProviderStatus>>({});
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState("");
  const searchSequence = useRef(0);

  const runSearch = useCallback(async (searchQuery: string, searchKind: "all" | "tracks" | "artists") => {
    if (searchQuery.trim().length < 2) return;
    const sequence = ++searchSequence.current;
    setLoading(true); setError(""); setSearched(true);
    try {
      const params = new URLSearchParams({ q: searchQuery.trim(), type: searchKind, limit: "15" });
      const response = await fetch(`${API}/api/v1/search/music?${params.toString()}`);
      const data = await response.json() as SearchResponse;
      if (sequence !== searchSequence.current) return;
      if (!response.ok) throw new Error(data.error || "Music search is temporarily unavailable.");
      setTracks(data.tracks ?? []);
      setArtists(data.artists ?? []);
      setMetadata(data.metadata ?? []);
      setProviders(data.providers ?? {});
    } catch (err) {
      if (sequence !== searchSequence.current) return;
      setError(err instanceof Error ? err.message : "Music search is temporarily unavailable.");
      setTracks([]); setArtists([]); setMetadata([]); setProviders({});
    } finally {
      if (sequence === searchSequence.current) setLoading(false);
    }
  }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runSearch(query, kind);
  }

  useEffect(() => {
    const initialQuery = new URLSearchParams(window.location.search).get("q") ?? "";
    if (initialQuery.trim().length >= 2) {
      setQuery(initialQuery);
      void runSearch(initialQuery, "all");
    }
  }, [runSearch]);

  const providerLabels: Record<string, string> = {
    jamendo: "Jamendo", audius: "Audius", musicbrainz: "MusicBrainz", spotify: "Spotify", spotifyArtists: "Spotify artists",
    audiusArtists: "Audius artists", musicbrainzArtists: "MusicBrainz artists"
  };

  return (
    <main className="mx-auto w-full min-w-0 max-w-[1440px] overflow-x-clip px-4 py-6 pb-40 md:px-8">
      <header className="flex items-center justify-between">
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white"><ArrowLeft size={17}/> {t("Back to SONORA")}</Link>
        <span className="flex items-center gap-2 text-sm font-semibold tracking-[.2em]"><AudioLines className="text-violet-300"/> SONORA</span>
      </header>
      <section className="mt-10 rounded-[2rem] border border-violet-300/15 bg-gradient-to-br from-[#292044] via-[#171426] to-[#10131c] p-7 md:p-10">
        <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.25em] text-violet-200"><Search size={14}/> {t("Federated music search")}</p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight md:text-5xl">{t("Search across music catalogs.")}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">{t("Search tracks, artists and recordings across connected open catalogs. Playable results stay linked to their original provider and rights information.")}</p>
        <form onSubmit={submit} className="mt-7 flex max-w-3xl gap-2 rounded-2xl border border-white/10 bg-black/25 p-2">
          <Search className="ml-2 mt-2.5 shrink-0 text-slate-400" size={18}/>
          <input value={query} onChange={(event) => { const next = event.target.value; setQuery(next); searchSequence.current += 1; setLoading(false); setError(""); setSearched(false); setTracks([]); setArtists([]); setMetadata([]); setProviders({}); }} minLength={2} placeholder={t("Track title, artist or album")} className="min-w-0 flex-1 bg-transparent px-2 py-2 text-sm outline-none placeholder:text-slate-500"/>
          <button disabled={loading || query.trim().length < 2} className="rounded-xl bg-violet-200 px-5 py-2 text-sm font-semibold text-[#171323] disabled:opacity-50">{loading ? <LoaderCircle className="animate-spin" size={17}/> : t("Search")}</button>
        </form>
        <div className="mt-4 flex flex-wrap gap-2">
          {(["all","tracks","artists"] as const).map((value) => <button key={value} type="button" onClick={() => { setKind(value); if (query.trim().length >= 2) void runSearch(query, value); }} aria-pressed={kind === value} className={`rounded-full px-4 py-2 text-xs transition ${kind === value ? "bg-violet-200 text-[#171323]" : "border border-white/10 text-slate-300 hover:bg-white/5"}`}>{value === "all" ? t("All results") : value === "tracks" ? t("Tracks") : t("Artists")}</button>)}
        </div>
      </section>

      {Object.keys(providers).length > 0 && <section className="mt-6 flex flex-wrap gap-2" aria-label={t("Catalog sources")}>
        {Object.entries(providers).map(([key, status]) => <span key={key} className={`rounded-full border px-3 py-1.5 text-[11px] ${status.ok ? "border-emerald-300/15 bg-emerald-300/5 text-emerald-200" : "border-amber-300/15 bg-amber-300/5 text-amber-200"}`}>{providerLabels[key] || key}: {status.ok ? status.count + " " + t("results") : t("unavailable")}</span>)}
      </section>}

      {error && <p role="alert" className="mt-6 rounded-2xl border border-rose-300/15 bg-rose-300/5 p-4 text-sm text-rose-200">{error}</p>}
      {loading && <div className="flex min-h-48 items-center justify-center gap-3 text-sm text-slate-400"><LoaderCircle className="animate-spin" size={18}/> {t("Searching connected catalogs…")}</div>}
      {!loading && searched && !error && tracks.length === 0 && artists.length === 0 && metadata.length === 0 && <div className="mt-8 rounded-3xl border border-white/10 p-10 text-center text-sm text-slate-400">{t("No matches found. Try another title or artist.")}</div>}

      {!loading && tracks.length > 0 && <section className="mt-9">
        <div className="mb-4 flex items-end justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[.25em] text-violet-300">{t("Playable catalog results")}</p><h2 className="mt-2 text-2xl font-semibold">{t("Tracks")}</h2></div><span className="text-xs text-slate-500">{tracks.length} {t("matches")}</span></div>
        <div className="grid w-full min-w-0 grid-cols-1 gap-3 md:grid-cols-2">
          {tracks.map((track) => <article key={track.id} className="flex w-full min-w-0 max-w-full items-center gap-3 overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.025] p-3">
            <div className="relative grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-xl bg-violet-300/10"><Music2 size={22} className="text-violet-200"/>{track.artworkUrl && <img src={track.artworkUrl} alt="" loading="lazy" onError={(event) => event.currentTarget.remove()} className="absolute inset-0 h-full w-full object-cover"/>}</div>
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{track.title}</p><p className="truncate text-xs text-slate-400">{track.artist}</p><p className="mt-1 truncate text-[10px] text-slate-500">{track.provider} · {track.rightsLabel || track.provider} {track.durationSeconds ? "· " + duration(track.durationSeconds) : ""}</p></div>
            <a href={track.sourceUrl} target="_blank" rel="noreferrer" aria-label={t("Open source")} className="shrink-0 rounded-lg p-2 text-slate-500 hover:text-white"><ExternalLink size={16}/></a>
            <button type="button" onClick={() => { const queue = tracks.filter((item) => item.playable && item.audioUrl); const start = queue.findIndex((item) => item.id === track.id); playTrack(track, start >= 0 ? queue.slice(start) : [track]); }} disabled={!track.playable || !track.audioUrl} aria-label={t("Play track")} className="shrink-0 rounded-full bg-violet-200 p-3 text-[#171323] disabled:cursor-not-allowed disabled:opacity-30"><Play size={16} fill="currentColor"/></button>
          </article>)}
        </div>
      </section>}

      {!loading && artists.length > 0 && <section className="mt-10">
        <h2 className="mb-4 text-2xl font-semibold">{t("Artists")}</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {artists.map((artist) => <a key={artist.id} href={artist.sourceUrl} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-3 hover:bg-white/[0.05]">
            {artist.imageUrl ? <img src={artist.imageUrl} alt="" className="h-12 w-12 rounded-full object-cover"/> : <div className="grid h-12 w-12 place-items-center rounded-full bg-violet-300/10"><UserRound size={20}/></div>}
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{artist.name}</p><p className="text-xs text-slate-500">{artist.provider}{artist.followerCount ? " · " + artist.followerCount.toLocaleString() + " followers" : ""}</p></div><ExternalLink size={15} className="text-slate-500"/>
          </a>)}
        </div>
      </section>}

      {!loading && metadata.length > 0 && <section className="mt-10">
        <div className="mb-4"><p className="text-[10px] font-semibold uppercase tracking-[.25em] text-slate-500">{t("Metadata only")}</p><h2 className="mt-2 text-2xl font-semibold">{t("Recording matches")}</h2><p className="mt-1 text-xs text-slate-500">{t("MusicBrainz identifies recordings and releases. It does not provide audio playback.")}</p></div>
        <div className="w-full min-w-0 space-y-2">{metadata.map((item) => <a key={item.id} href={item.sourceUrl} target="_blank" rel="noreferrer" className="flex w-full min-w-0 items-center gap-3 overflow-hidden rounded-xl border border-white/[0.06] px-4 py-3 hover:bg-white/[0.03]"><Disc3 size={18} className="text-slate-500"/><div className="min-w-0 flex-1"><p className="truncate text-sm">{item.title}</p><p className="truncate text-xs text-slate-500">{item.artist}{item.album ? " · " + item.album : ""}</p></div><span className="text-[10px] text-slate-500">{item.provider}</span><ExternalLink size={14} className="text-slate-500"/></a>)}</div>
      </section>}
      <footer className="mt-14 border-t border-white/[0.07] py-6 text-xs text-slate-600">{t("SONORA · Federated discovery · Every playable result remains attributed to its source")}</footer>
    </main>
  );
}
