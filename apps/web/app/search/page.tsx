"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Disc3, Search } from "lucide-react";
import { useLanguage } from "../../components/language-provider";
import { usePlayer, type PlayerTrack } from "../../components/player-provider";
import { TrackRow } from "../../components/ui/track-row";
import { ErrorBlock, RowsSkeleton, StateBlock } from "../../components/ui/states";
import { Artwork } from "../../components/ui/artwork";
import { useReveal } from "../../lib/motion";

type Track = PlayerTrack & { provider: string; playable: boolean; rightsLabel?: string };
type Artist = { id: string; provider: string; name: string; handle?: string | null; followerCount?: number | null; trackCount?: number | null; imageUrl?: string | null; sourceUrl: string };
type Metadata = { id: string; provider: string; title: string; artist: string; album?: string | null; durationSeconds?: number | null; isrc?: string | null; releaseDate?: string | null; sourceUrl: string; playable: false };
type ProviderStatus = { ok: boolean; count: number; error?: string };
type SearchResponse = { tracks?: Track[]; artists?: Artist[]; metadata?: Metadata[]; providers?: Record<string, ProviderStatus>; error?: string };

const API = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");

function RecordingMatch({ item }: { item: Metadata }) {
  const { t } = useLanguage();
  const { playTrack } = usePlayer();
  const [status, setStatus] = useState<"idle" | "loading" | "empty" | "error">("idle");
  const [candidate, setCandidate] = useState<Track | null>(null);

  async function findPlayableVersion() {
    setStatus("loading");
    setCandidate(null);
    try {
      const response = await fetch(`${API}/api/v1/discovery/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: item.title, artist: item.artist, isrc: item.isrc,
          durationSeconds: item.durationSeconds, playbackOnly: true
        })
      });
      if (!response.ok) throw new Error("Track lookup failed");
      const { playableTrack } = await response.json() as { playableTrack?: Track | null };
      if (playableTrack?.playable && playableTrack.audioUrl?.startsWith("https://")) {
        setCandidate(playableTrack);
        setStatus("idle");
      } else {
        setStatus("empty");
      }
    } catch {
      setStatus("error");
    }
  }

  return (
    <article className="surface min-w-0 rounded-card">
      <div className="track-row min-w-0 max-w-full">
        <span className="artwork grid h-11 w-11 shrink-0 place-items-center rounded-tile">
          <Disc3 size={18} className="text-white/50" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="t-row block truncate">{item.title}</span>
          <span className="t-meta mt-0.5 block truncate">{item.artist}{item.album ? ` · ${item.album}` : ""} · {item.provider}</span>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2 px-3 pb-3">
        {candidate ? (
          <>
            <p className="t-meta min-w-0 break-words">{t("Possible match")} · {candidate.title} · {candidate.artist} · {candidate.provider}</p>
            <button type="button" className="btn-ghost !min-h-9 !px-3" onClick={() => playTrack(candidate)}>{t("Play")}</button>
          </>
        ) : (
          <button type="button" className="btn-ghost !min-h-9 !px-3" disabled={status === "loading"} onClick={() => void findPlayableVersion()}>
            {t(status === "error" ? "Try again" : "Find a playable version")}
          </button>
        )}
        <span role="status" className="t-meta">
          {status === "loading" ? t("Searching connected catalogs…") :
            status === "empty" ? t("No playable match was found.") :
            status === "error" ? t("The track lookup failed.") : ""}
        </span>
      </div>
    </article>
  );
}

export default function SearchPage() {
  const { t } = useLanguage();
  const { currentTrack, isPlaying, playTrack } = usePlayer();
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
  const tracksHead = useReveal<HTMLDivElement>();
  const tracksList = useReveal<HTMLDivElement>();
  const artistsList = useReveal<HTMLDivElement>();
  const metaList = useReveal<HTMLDivElement>();

  const runSearch = useCallback(async (searchQuery: string, searchKind: "all" | "tracks" | "artists") => {
    if (searchQuery.trim().length < 2) return;
    const sequence = ++searchSequence.current;
    setLoading(true); setError(""); setSearched(true);
    try {
      const params = new URLSearchParams({ q: searchQuery.trim(), type: searchKind, limit: "15", inApp: "true" });
      const response = await fetch(`${API}/api/v1/search/music?${params.toString()}`);
      const data = await response.json() as SearchResponse;
      if (sequence !== searchSequence.current) return;
      if (!response.ok) throw new Error(data.error || "Music search is temporarily unavailable.");
      setTracks((data.tracks ?? []).filter((track) => track.playable && track.audioUrl?.startsWith("https://")));
      setArtists(data.artists ?? []);
      setMetadata((data.metadata ?? []).filter((item) => item.provider === "MusicBrainz"));
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

  const resultCount = tracks.length + artists.length + metadata.length;

  return (
    <main className="mx-auto w-full min-w-0 max-w-[1440px] overflow-x-clip px-4 py-6 pb-40 md:px-8">
      <section className="panel-hero mt-6 px-6 py-8 md:px-10 md:py-11">
        <p className="t-eyebrow flex items-center gap-2 text-violet-200"><Search size={13} /> {t("Catalog search")}</p>
        <h1 className="t-display mt-4">{t("Search the catalog.")}</h1>
        <p className="t-meta mt-3 max-w-2xl leading-6">{t("Search tracks, artists and recordings in one place. Every playable result keeps its attribution and license information.")}</p>
        <form onSubmit={submit} className="mt-7 flex max-w-3xl items-center gap-2 rounded-panel border border-white/10 bg-black/25 p-2">
          <Search className="ml-2 shrink-0 text-muted" size={18} />
          <input
            value={query}
            aria-label={t("Track title, artist or album")}
            onChange={(event) => { const next = event.target.value; setQuery(next); searchSequence.current += 1; setLoading(false); setError(""); setSearched(false); setTracks([]); setArtists([]); setMetadata([]); setProviders({}); }}
            minLength={2}
            placeholder={t("Track title, artist or album")}
            className="min-w-0 flex-1 bg-transparent px-2 py-2 text-sm outline-none placeholder:text-[color:var(--fg-faint)]"
          />
          <button disabled={loading || query.trim().length < 2} className="btn-press btn-primary !px-5 !py-2 text-sm">{t("Search")}</button>
        </form>
        <div className="mt-4 flex flex-wrap gap-2">
          {(["all", "tracks", "artists"] as const).map((value) => (
            <button key={value} type="button" onClick={() => { setKind(value); if (query.trim().length >= 2) void runSearch(query, value); }} aria-pressed={kind === value} className="btn-press chip">
              {value === "all" ? t("All results") : value === "tracks" ? t("Tracks") : t("Artists")}
            </button>
          ))}
        </div>
      </section>

      {!loading && searched && resultCount > 0 && <p className="t-meta mt-6">{resultCount} {t("results")}</p>}

      {error && <div className="mt-8"><ErrorBlock title={t("Search failed.")} body={error} onRetry={() => void runSearch(query, kind)} retryLabel={t("Try again")} /></div>}
      {loading && <div className="mt-8"><RowsSkeleton count={6} /><p className="t-meta mt-4 text-center">{t("Searching connected catalogs…")}</p></div>}
      {!loading && searched && !error && resultCount === 0 && (
        <div className="mt-8">
          <StateBlock
            icon={Search}
            tone="neutral"
            title={t("No matches found. Try another title or artist.")}
            body={t("Describe a mood, an activity or an artist you like. Answers come with playable tracks from the licensed catalog.")}
            actionHref="/discover"
            actionLabel={t("Explore music")}
          />
        </div>
      )}
      {!loading && searched && !error && kind !== "artists" && tracks.length === 0 && resultCount > 0 && (
        <p className="t-meta mt-6" role="status">{t("No tracks available to play in SONORA for this search.")}</p>
      )}

      {!loading && tracks.length > 0 && (
        <section className="mt-8" aria-labelledby="search-tracks-heading">
          <div ref={tracksHead} className="rv rv-mask mb-3 flex items-end justify-between">
            <div>
              <p className="t-eyebrow">{t("Playable catalog results")}</p>
              <h2 id="search-tracks-heading" className="t-h2 mt-1">{t("Tracks")}</h2>
            </div>
            <span className="t-meta">{tracks.length} {t("matches")}</span>
          </div>
          <div ref={tracksList} className="rv rv-flat rv-stagger-x min-w-0 space-y-0.5">
            {tracks.map((track) => (
              <TrackRow
                key={track.id}
                track={track}
                meta={track.provider === "SONORA" && track.rightsLabel ? `${track.artist} · ${track.rightsLabel}` : undefined}
                isCurrent={currentTrack?.id === track.id}
                isPlaying={isPlaying}
                disabled={!track.playable || !track.audioUrl}
                onPlay={() => {
                  const queue = tracks.filter((item) => item.playable && item.audioUrl);
                  const start = queue.findIndex((item) => item.id === track.id);
                  playTrack(track, start >= 0 ? queue.slice(start) : [track]);
                }}
              />
            ))}
          </div>
        </section>
      )}

      {!loading && artists.length > 0 && (
        <section className="mt-10" aria-labelledby="search-artists-heading">
          <h2 id="search-artists-heading" className="t-h2 mb-4">{t("Artists")}</h2>
          <div ref={artistsList} className="rv rv-flat rv-stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {artists.map((artist) => (
              <button key={artist.id} type="button" className="card-lift surface flex min-w-0 items-center gap-3 rounded-card p-3 text-left" onClick={() => {
                const artistQuery = artist.handle || artist.name;
                setQuery(artistQuery);
                setKind("tracks");
                void runSearch(artistQuery, "tracks");
              }}>
                <Artwork src={artist.imageUrl} rounded="rounded-full" iconSize={20} className="h-12 w-12" />
                <div className="min-w-0 flex-1">
                  <p className="t-row truncate">{artist.name}</p>
                  <p className="t-meta mt-0.5 truncate">{artist.trackCount === 0
                    ? t("No tracks uploaded to this profile")
                    : artist.followerCount ? `${artist.followerCount.toLocaleString()} ${t("followers")}` : t("Recording artist")}</p>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {!loading && metadata.length > 0 && (
        <section className="mt-10" aria-labelledby="search-meta-heading">
          <div className="mb-3">
            <p className="t-eyebrow">{t("Metadata only")}</p>
            <h2 id="search-meta-heading" className="t-h2 mt-1">{t("Recording matches")}</h2>
            <p className="t-meta mt-1">{t("Catalog records identify recordings and releases. They do not provide audio playback.")}</p>
          </div>
          <div ref={metaList} className="rv rv-flat rv-stagger-x min-w-0 space-y-0.5">
            {metadata.map((item) => <RecordingMatch key={`${item.provider}:${item.id}`} item={item} />)}
          </div>
        </section>
      )}
      <footer className="mt-14 border-t border-white/[0.06] py-6 text-[13px] text-muted">{t("SONORA · One catalog · Every playable result keeps its attribution and license information")}</footer>
    </main>
  );
}
