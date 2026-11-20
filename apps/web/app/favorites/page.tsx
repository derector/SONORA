"use client";

import { useEffect, useState } from "react";
import { FileText, Heart, Link2, Trash2 } from "lucide-react";
import { useLanguage } from "../../components/language-provider";
import { usePlayer, type PlayerTrack } from "../../components/player-provider";
import { TrackRow } from "../../components/ui/track-row";
import { ErrorBlock, RowsSkeleton, StateBlock } from "../../components/ui/states";

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
    <main className="mx-auto min-h-screen w-full max-w-5xl px-4 py-6 pb-36 md:px-8">
      <section className="panel-hero mt-6 px-6 py-8 md:px-10 md:py-11">
        <p className="t-eyebrow flex items-center gap-2 text-rose-200"><Heart size={13} /> {t("Your saved music")}</p>
        <h1 className="t-display mt-4">{t("Keep the good ones close.")}</h1>
        <p className="t-meta mt-3 max-w-xl leading-6">{t("Tracks you save are stored in your SONORA account with their original source and license details.")}</p>
      </section>

      {loading ? <div className="mt-8"><RowsSkeleton count={5} /></div> : !token ? (
        <div className="mt-8">
          <StateBlock
            icon={Heart}
            title={t("Sign in to see your saved tracks.")}
            body={t("Tracks you save are stored in your SONORA account with their original source and license details.")}
            actionHref="/auth"
            actionLabel={t("Sign in or create account")}
          />
        </div>
      ) : items.length === 0 ? (
        <div className="mt-8">
          <StateBlock
            icon={Heart}
            tone="neutral"
            title={t("Your favorites shelf is empty.")}
            body={t("Save a track from Discover and it will appear here.")}
            actionHref="/discover"
            actionLabel={t("Explore music")}
          />
        </div>
      ) : (
        <section className="mt-8" aria-labelledby="favorites-heading">
          <div className="mb-3 flex items-end justify-between">
            <div>
              <p className="t-eyebrow">{t("Your collection")}</p>
              <h2 id="favorites-heading" className="t-h2 mt-1">{t("Saved tracks")}</h2>
            </div>
            <span className="t-meta">{items.length} {t("tracks")}</span>
          </div>
          <div className="min-w-0 space-y-0.5">
            {items.map((item) => (
              <TrackRow
                key={item.provider_track_id}
                track={{
                  id: item.provider_track_id,
                  title: item.title,
                  artist: item.artist_name,
                  artworkUrl: item.artwork_url,
                  durationSeconds: item.duration_seconds
                }}
                isCurrent={currentTrack?.id === item.provider_track_id}
                isPlaying={isPlaying}
                busy={startingTrack === item.provider_track_id}
                meta={<>{item.artist_name}{item.album_name ? ` · ${item.album_name}` : ""}</>}
                onPlay={() => void startFavorite(item)}
                trailing={
                  <>
                    <a href={item.license_url} target="_blank" rel="noreferrer" aria-label={t("Read license terms")} className="btn-icon hidden sm:grid"><FileText size={16} /></a>
                    <a href={item.source_url} target="_blank" rel="noreferrer" aria-label={t("Open track page")} className="btn-icon hidden sm:grid"><Link2 size={16} /></a>
                    <button type="button" onClick={() => void removeFavorite(item.provider_track_id)} aria-label={`${t("Remove from favorites")}: ${item.title}`} className="btn-icon hover:!text-rose-200"><Trash2 size={16} /></button>
                  </>
                }
              />
            ))}
          </div>
        </section>
      )}
      {error && <div className="mt-6"><ErrorBlock title={t("Could not load your favorites.")} body={error} retryLabel={t("Try again")} onRetry={() => window.location.reload()} /></div>}
    </main>
  );
}
