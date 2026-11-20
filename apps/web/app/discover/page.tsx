"use client";

import { FormEvent, useEffect, useState } from "react";
import { Heart, Music2, Play, Search } from "lucide-react";
import { usePlayer } from "../../components/player-provider";
import { useLanguage } from "../../components/language-provider";
import { Rail } from "../../components/ui/rail";
import { TrackCard } from "../../components/ui/track-card";
import { ErrorBlock, RailSkeleton, StateBlock } from "../../components/ui/states";

type Track = {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  durationSeconds: number;
  artworkUrl: string | null;
  audioUrl: string;
  licenseUrl: string;
  sourceUrl: string;
  provider: string;
};

type Result = { items?: Track[]; error?: string };
type CatalogSource = "jamendo" | "audius";
type AudiusSort = "trending" | "latest";
// Recommendations arrive as catalog tracks plus the short reasons the API used
// to pick them. Source identity stays inside the data, never on the card.
type Recommendation = Track & { reasons?: string[] };
type RecommendationResult = { items?: Recommendation[]; tracks?: Recommendation[]; error?: string };

const API = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");

export default function DiscoverPage() {
  const { t } = useLanguage();
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<CatalogSource>("jamendo");
  const [audiusSort, setAudiusSort] = useState<AudiusSort>("trending");
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [token, setToken] = useState("");
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [savingFavorite, setSavingFavorite] = useState<string>("");
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const { currentTrack, isPlaying, playTrack, togglePlay } = usePlayer();

  async function loadTracks(search = "", selectedSource: CatalogSource = source, selectedSort: AudiusSort = audiusSort) {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ limit: "24" });
      if (selectedSource === "audius") params.set("sort", selectedSort);
      else params.set("q", search.trim() || "music");
      const endpoint = selectedSource === "audius" ? "audius" : "jamendo";
      const response = await fetch(`${API}/api/v1/providers/${endpoint}/tracks?${params.toString()}`);
      const result = await response.json() as Result;
      if (!response.ok) throw new Error(result.error || "The catalog could not be loaded.");
      setTracks(result.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The catalog could not be loaded.");
      setTracks([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadTracks();
    fetch(`/api/auth/refresh`, { method: "POST", credentials: "include" })
      .then(async (response) => response.ok ? response.json() as Promise<{ session?: { access_token?: string } }> : null)
      .then(async (result) => {
        const accessToken = result?.session?.access_token;
        if (!accessToken) return;
        setToken(accessToken);
        const response = await fetch(`${API}/api/v1/provider-favorites`, {
          headers: { Authorization: `Bearer ${accessToken}` }, credentials: "include"
        });
        if (response.ok) {
          const saved = await response.json() as { items?: Array<{ provider_track_id: string }> };
          setFavoriteIds((saved.items ?? []).map((item) => item.provider_track_id));
        }
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!token) return;
    let active = true;
    // Personal picks are optional: any failure simply keeps the section hidden.
    void fetch(`${API}/api/v1/recommendations?limit=12`, {
      headers: { Authorization: `Bearer ${token}` }, credentials: "include", cache: "no-store"
    })
      .then(async (response) => response.ok ? await response.json() as RecommendationResult : null)
      .then((result) => { if (active) setRecommendations(result?.items ?? result?.tracks ?? []); })
      .catch(() => { if (active) setRecommendations([]); });
    return () => { active = false; };
  }, [token]);

  async function toggleFavorite(track: Track) {
    if (!token) {
      setError("Sign in to save tracks to your library.");
      return;
    }
    setSavingFavorite(track.id);
    setError("");
    try {
      const isSaved = favoriteIds.includes(track.id);
      const response = await fetch(`${API}/api/v1/provider-favorites${isSaved ? `/${encodeURIComponent(track.id)}` : ""}`, {
        method: isSaved ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        credentials: "include",
        ...(isSaved ? {} : { body: JSON.stringify({ providerTrackId: track.id }) })
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Could not update favorites.");
      setFavoriteIds((ids) => isSaved ? ids.filter((id) => id !== track.id) : [...ids, track.id]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update favorites.");
    } finally {
      setSavingFavorite("");
    }
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (query.trim().length >= 2) window.location.assign(`/search?q=${encodeURIComponent(query.trim())}`);
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-[1440px] px-4 py-6 pb-36 md:px-8">

      <section className="panel-hero mt-6 px-6 py-8 md:px-10 md:py-11">
        <p className="t-eyebrow flex items-center gap-2 text-violet-200"><Music2 size={13} /> {t("Discover independent music")}</p>
        <h1 className="t-display mt-4">{t("Find your next frequency.")}</h1>
        <p className="t-meta mt-3 max-w-xl leading-6">{t("Explore independent releases from licensed catalogs. Every track plays in full, with creator attribution and license terms preserved.")}</p>
        <form onSubmit={submitSearch} className="mt-7 flex max-w-2xl items-center gap-2 rounded-panel border border-white/10 bg-black/25 p-2">
          <Search className="ml-2 shrink-0 text-muted" size={18} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Search tracks, artists or moods")} className="min-w-0 flex-1 bg-transparent px-2 py-2 text-sm outline-none placeholder:text-[color:var(--fg-faint)]" />
          <button disabled={loading} className="btn-press btn-primary !px-5 !py-2 text-sm">{t("Search")}</button>
        </form>
      </section>

      {recommendations.length > 0 && (
        <Rail eyebrow={t("Picked from your listening")} title={t("For you")} titleId="discover-for-you-heading">
          {recommendations.map((track, index) => (
            <div key={track.id} className="rail-item card-enter" style={{ animationDelay: `${Math.min(index * 45, 300)}ms` }}>
              <TrackCard
                title={track.title}
                artist={track.artist}
                artworkUrl={track.artworkUrl}
                isCurrent={currentTrack?.id === track.id}
                isPlaying={isPlaying}
                onPlay={() => currentTrack?.id === track.id ? togglePlay() : playTrack(track, recommendations)}
                footer={track.reasons?.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {track.reasons.slice(0, 2).map((reason) => (
                      <span key={reason} className="rounded-pill border border-violet-200/15 bg-violet-200/[0.07] px-2 py-0.5 text-[11px] text-violet-100">{t(reason)}</span>
                    ))}
                  </div>
                ) : null}
              />
            </div>
          ))}
        </Rail>
      )}

      <div className="mt-10 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="t-eyebrow">{t("Open catalogs")}</p>
          <h2 className="t-h2 mt-1">{t("Tracks to explore")}</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => { setSource("jamendo"); void loadTracks("", "jamendo"); }} aria-pressed={source === "jamendo"} className="btn-press chip">{t("Collections")}</button>
          <button type="button" onClick={() => { setSource("audius"); void loadTracks("", "audius", audiusSort); }} aria-pressed={source === "audius"} className="btn-press chip">{t("Creator uploads")}</button>
        </div>
      </div>
      {source === "audius" && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => { setAudiusSort("trending"); void loadTracks("", "audius", "trending"); }} aria-pressed={audiusSort === "trending"} className="chip !px-3 !py-1 text-xs">{t("Trending this week")}</button>
          <button type="button" onClick={() => { setAudiusSort("latest"); void loadTracks("", "audius", "latest"); }} aria-pressed={audiusSort === "latest"} className="chip !px-3 !py-1 text-xs">{t("Latest uploads")}</button>
          <span className="t-meta">{t("Public tracks shared directly by their creators")}</span>
        </div>
      )}

      {loading ? <div className="mt-4"><RailSkeleton count={7} /></div> : error ? (
        <div className="mt-8">
          <ErrorBlock
            title={t("Catalog connection is not ready.")}
            body={error}
            onRetry={() => void loadTracks()}
            retryLabel={t("Try again")}
          />
          <p className="t-meta mt-3 text-center">{t("The provider API key must be configured server-side. No demo tracks are substituted.")}</p>
        </div>
      ) : tracks.length === 0 ? (
        <div className="mt-8">
          <StateBlock
            icon={Music2}
            tone="neutral"
            title={t("No tracks found. Try another search.")}
            body={t("Search tracks, artists or moods")}
            actionHref="/search"
            actionLabel={t("Search music")}
          />
        </div>
      ) : (
        <Rail eyebrow={source === "jamendo" ? t("Collections") : t("Creator uploads")} title={t("Music to explore")} titleId="discover-catalog-heading" viewAllHref="/search" viewAllLabel={t("Catalog search")}>
          {tracks.map((track, index) => (
            <div key={track.id} className="rail-item card-enter" style={{ animationDelay: `${Math.min(index * 45, 300)}ms` }}>
              <TrackCard
                title={track.title}
                artist={track.artist}
                artworkUrl={track.artworkUrl}
                isCurrent={currentTrack?.id === track.id}
                isPlaying={isPlaying}
                onPlay={() => currentTrack?.id === track.id ? togglePlay() : playTrack(track, tracks)}
                corner={source === "jamendo" ? (
                  <button
                    type="button"
                    onClick={() => void toggleFavorite(track)}
                    disabled={savingFavorite === track.id}
                    aria-label={favoriteIds.includes(track.id) ? t("Remove from favorites") : t("Add to favorites")}
                    className={`grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-black/45 backdrop-blur-md transition hover:text-rose-200 ${favoriteIds.includes(track.id) ? "text-rose-300" : "text-white/80"}`}
                  >
                    <Heart size={15} fill={favoriteIds.includes(track.id) ? "currentColor" : "none"} />
                  </button>
                ) : null}
              />
            </div>
          ))}
        </Rail>
      )}

      <footer className="mt-14 border-t border-white/[0.06] py-6 text-[13px] text-muted">{t("SONORA · Independent music discovery · Rights and attribution stay attached to every track")}</footer>
    </main>
  );
}
