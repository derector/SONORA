"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Clock3, Disc3, Search, X } from "lucide-react";
import { useLanguage } from "../../components/language-provider";
import { usePlayer, type PlayerTrack } from "../../components/player-provider";
import { TrackRow } from "../../components/ui/track-row";
import { ErrorBlock, RowsSkeleton, StateBlock } from "../../components/ui/states";
import { Artwork } from "../../components/ui/artwork";
import { useReveal } from "../../lib/motion";

type Track = PlayerTrack & { provider: string; playable: boolean };
type Artist = { id: string; provider: string; name: string; handle?: string | null; followerCount?: number | null; trackCount?: number | null; imageUrl?: string | null; sourceUrl: string };
type Metadata = { id: string; provider: string; title: string; artist: string; album?: string | null; durationSeconds?: number | null; isrc?: string | null; releaseDate?: string | null; sourceUrl: string; playable: false };
type OfficialRelease = { id: string; title: string; artist: string; album?: string; videoId?: string; bandcamp?: { kind: "track" | "album"; id: string }; soundCloudTrackId?: string };
type OfficialPlayer = { provider: "Bandcamp" | "SoundCloud" | "YouTube"; url: string; layout: "track" | "album" | "video" };
type ProviderStatus = { ok: boolean; count: number; error?: string };
type SearchResponse = { tracks?: Track[]; artists?: Artist[]; metadata?: Metadata[]; officialReleases?: OfficialRelease[]; providers?: Record<string, ProviderStatus>; error?: string };

const RECENT_SEARCHES_KEY = "sonora-recent-searches-v1";

const API = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");

function playersForRelease(release: OfficialRelease): OfficialPlayer[] {
  const players: OfficialPlayer[] = [];
  const bandcamp = release.bandcamp;
  if (bandcamp && (bandcamp.kind === "track" || bandcamp.kind === "album") && /^\d{1,12}$/.test(bandcamp.id)) {
    const tracklist = bandcamp.kind === "album";
    players.push({ provider: "Bandcamp", layout: bandcamp.kind,
      url: `https://bandcamp.com/EmbeddedPlayer/v=2/${bandcamp.kind}=${bandcamp.id}/size=large/tracklist=${tracklist}/artwork=small/` });
  }
  if (release.soundCloudTrackId && /^\d{1,12}$/.test(release.soundCloudTrackId)) {
    const url = encodeURIComponent(`https://api.soundcloud.com/tracks/${release.soundCloudTrackId}`);
    players.push({ provider: "SoundCloud", layout: "track",
      url: `https://w.soundcloud.com/player/?visual=true&url=${url}&show_artwork=true&maxheight=166` });
  }
  if (release.videoId && /^[\w-]{11}$/.test(release.videoId)) {
    players.push({ provider: "YouTube", layout: "video", url: `https://www.youtube.com/embed/${release.videoId}?playsinline=1` });
  }
  return players;
}

const PLAYER_CLASS = {
  track: "min-h-[166px]",
  album: "h-[min(480px,60dvh)]",
  video: "aspect-video min-h-[200px]"
};
const PLAYER_LABEL = {
  Bandcamp: "Play in Bandcamp player",
  SoundCloud: "Play in SoundCloud player",
  YouTube: "Play in YouTube player"
};

function RecordingMatch({ item }: { item: Metadata }) {
  const { t } = useLanguage();
  const { playTrack } = usePlayer();
  const [status, setStatus] = useState<"idle" | "loading" | "empty" | "error">("idle");
  const [candidate, setCandidate] = useState<{ track: Track; matchedVia?: string } | null>(null);

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
      const { playableTrack, matchedVia } = await response.json() as { playableTrack?: Track | null; matchedVia?: string };
      if (playableTrack?.playable && playableTrack.audioUrl?.startsWith("https://")) {
        setCandidate({ track: playableTrack, matchedVia });
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
          {item.isrc && <span className="t-meta mt-0.5 block">ISRC {item.isrc}</span>}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2 px-3 pb-3">
        {candidate ? (
          <>
            <p className="t-meta min-w-0 break-words">{t(candidate.matchedVia === "isrc" ? "ISRC confirmed" : "Possible match")} · {candidate.track.title} · {candidate.track.artist} · {candidate.track.provider}</p>
            <button type="button" className="btn-ghost !min-h-9 !px-3" onClick={() => playTrack(candidate.track)}>{t("Play")}</button>
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
  const { currentTrack, isPlaying, playTrack, togglePlay } = usePlayer();
  const [query, setQuery] = useState("");
  const [recents, setRecents] = useState<string[]>([]);
  const [kind, setKind] = useState<"all" | "tracks" | "artists">("all");
  const [tracks, setTracks] = useState<Track[]>([]);
  const [artists, setArtists] = useState<Artist[]>([]);
  const [metadata, setMetadata] = useState<Metadata[]>([]);
  const [officialReleases, setOfficialReleases] = useState<Array<OfficialRelease & { players: OfficialPlayer[] }>>([]);
  const [officialRelease, setOfficialRelease] = useState<{ title: string; artist: string; player: OfficialPlayer } | null>(null);
  const [providers, setProviders] = useState<Record<string, ProviderStatus>>({});
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState("");
  const searchSequence = useRef(0);
  const releaseDialog = useRef<HTMLDialogElement>(null);
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
      setOfficialReleases((data.officialReleases ?? []).map((item) => ({ ...item, players: playersForRelease(item) }))
        .filter((item) => item.players.length > 0));
      setProviders(data.providers ?? {});
    } catch (err) {
      if (sequence !== searchSequence.current) return;
      setError(err instanceof Error ? err.message : "Music search is temporarily unavailable.");
      setTracks([]); setArtists([]); setMetadata([]); setOfficialReleases([]); setProviders({});
    } finally {
      if (sequence === searchSequence.current) setLoading(false);
    }
  }, []);

  function updateQuery(next: string) {
    setQuery(next);
    searchSequence.current += 1;
    setLoading(false);
    setError("");
    setSearched(false);
    setTracks([]);
    setArtists([]);
    setMetadata([]);
    setOfficialReleases([]);
    setProviders({});
  }

  function rememberSearch(query: string) {
    const term = query.trim().slice(0, 100);
    if (term.length < 2) return;
    const next = [term, ...recents.filter((item) => item.toLowerCase() !== term.toLowerCase())].slice(0, 6);
    setRecents(next);
    try { localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next)); } catch { /* Storage may be disabled. */ }
  }

  useEffect(() => {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY) ?? "[]");
      if (Array.isArray(stored)) setRecents(stored.filter((item): item is string => typeof item === "string" && item.length >= 2 && item.length <= 100).slice(0, 6));
    } catch { /* Search works without local storage. */ }
  }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    rememberSearch(query);
    void runSearch(query, kind);
  }

  useEffect(() => {
    const initialQuery = new URLSearchParams(window.location.search).get("q") ?? "";
    if (initialQuery.trim().length >= 2) {
      setQuery(initialQuery);
      void runSearch(initialQuery, "all");
    }
  }, [runSearch]);

  useEffect(() => {
    if (!officialRelease) return;
    const closeWhenHidden = () => {
      if (document.hidden) releaseDialog.current?.close();
    };
    document.addEventListener("visibilitychange", closeWhenHidden);
    return () => document.removeEventListener("visibilitychange", closeWhenHidden);
  }, [officialRelease]);

  const resultCount = tracks.length + artists.length + metadata.length + officialReleases.length;

  return (
    <main className="mx-auto w-full min-w-0 max-w-[1440px] overflow-x-clip px-4 py-6 pb-40 md:px-8">
      <section className="panel-hero mt-6 px-6 py-8 md:px-10 md:py-11">
        <p className="t-eyebrow flex items-center gap-2 text-violet-200"><Search size={13} /> {t("Catalog search")}</p>
        <h1 className="t-display mt-4">{t("Search the catalog.")}</h1>
        <p className="t-meta mt-3 max-w-2xl leading-6">{t("Search tracks, artists and recordings in one place. Every playable result keeps its attribution and license information.")}</p>
        <form onSubmit={submit} className="sonora-search-lens mt-7 flex max-w-3xl items-center gap-2 rounded-panel border border-white/10 bg-black/25 p-2">
          <Search className="ml-2 shrink-0 text-muted" size={18} />
          <input
            value={query}
            aria-label={t("Title, artist, album or ISRC")}
            onChange={(event) => updateQuery(event.target.value)}
            maxLength={100}
            minLength={2}
            placeholder={t("Title, artist, album or ISRC")}
            className="min-w-0 flex-1 bg-transparent px-2 py-2 text-sm outline-none placeholder:text-[color:var(--fg-faint)]"
          />
          {query && <button type="button" className="btn-icon shrink-0" aria-label={t("Clear search")} onClick={() => updateQuery("")}><X size={17}/></button>}
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

      {!searched && !query.trim() && recents.length > 0 && (
        <section className="surface mt-5 rounded-panel border border-white/10 p-4" aria-label={t("Recent searches")}>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">{t("Recent searches")}</h2>
            <button type="button" className="btn-ghost !min-h-9 !px-3 text-xs" onClick={() => {
              setRecents([]);
              try { localStorage.removeItem(RECENT_SEARCHES_KEY); } catch { /* Storage may be disabled. */ }
            }}>{t("Clear search history")}</button>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {recents.map((term) => <button key={term} type="button" className="chip min-w-0 max-w-full !min-h-9" onClick={() => {
              setQuery(term);
              rememberSearch(term);
              void runSearch(term, kind);
            }}><Clock3 size={14} className="shrink-0" aria-hidden/><span className="min-w-0 truncate">{term}</span></button>)}
          </div>
        </section>
      )}

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
      {!loading && searched && !error && kind !== "artists" && tracks.length === 0 && officialReleases.length === 0 && resultCount > 0 && (
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
                meta={track.rightsLabel ? `${track.artist} · ${track.rightsLabel}` : undefined}
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

      {!loading && officialReleases.length > 0 && (
        <section className="mt-10" aria-labelledby="official-releases-heading">
          <h2 id="official-releases-heading" className="t-h2 mb-3">{t("Official releases")}</h2>
          {officialReleases.map((item) => (
            <article key={item.id} className="surface my-1 flex flex-wrap items-center justify-between gap-3 rounded-card p-3">
              <div className="min-w-0 flex-1 basis-32">
                <p className="t-row">{item.title}</p>
                <p className="t-meta">{item.artist}{item.album ? ` · ${item.album}` : ""}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {item.players.map((player) => (
                  <button key={player.provider} type="button" className="btn-ghost !min-h-9 !px-3"
                    aria-label={t(PLAYER_LABEL[player.provider])} onClick={() => {
                    if (isPlaying) togglePlay();
                    setOfficialRelease({ title: item.title, artist: item.artist, player });
                    releaseDialog.current?.showModal();
                  }}>{player.provider}</button>
                ))}
              </div>
            </article>
          ))}
        </section>
      )}
      <dialog ref={releaseDialog} onClose={() => setOfficialRelease(null)} aria-labelledby="official-release-title"
        className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-card bg-[#151329] p-4 text-white backdrop:bg-black/75">
        {officialRelease && (
          <>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 id="official-release-title" className="t-row">{officialRelease.title}</h2>
              <button type="button" className="btn-ghost !min-h-9 !px-3" onClick={() => releaseDialog.current?.close()}>{t("Close")}</button>
            </div>
            <iframe className={`w-full rounded-tile ${PLAYER_CLASS[officialRelease.player.layout]}`}
              title={`${officialRelease.artist} · ${officialRelease.title} · ${officialRelease.player.provider}`}
              src={officialRelease.player.url}
              referrerPolicy="strict-origin-when-cross-origin"
              allow={officialRelease.player.provider === "SoundCloud" ? "autoplay; encrypted-media" : undefined} allowFullScreen />
          </>
        )}
      </dialog>

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
