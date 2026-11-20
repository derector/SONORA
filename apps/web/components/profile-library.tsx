"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, Disc3, Heart, History, Link2, Music2, Plus, Trash2, UsersRound } from "lucide-react";
import { useAuth } from "./auth-provider";
import { useLanguage } from "./language-provider";
import { Artwork } from "./ui/artwork";
import { TrackRow } from "./ui/track-row";
import { ErrorBlock, GridSkeleton, RowsSkeleton, StateBlock } from "./ui/states";
import { Reveal } from "./ui/reveal";
import { profileRequest } from "../lib/profile";
import { rowTrack, useProfileResource, useSavedPlayback, type HistoryTrack, type Playlist, type SavedTrack } from "./profile-data";

export function ProfileUnavailable({ onRetry }: { onRetry: () => void }) {
  const { t } = useLanguage();
  return <ErrorBlock title={t("This profile section is unavailable.")} body={t("Your data could not be loaded. The service or profile storage may not be ready. No sample data is shown.")} onRetry={onRetry} retryLabel={t("Try again")} />;
}
function PlaybackError({ visible }: { visible: boolean }) {
  const { t } = useLanguage();
  return visible ? <p role="alert" className="mt-3 rounded-card border border-rose-300/15 bg-rose-300/5 p-3 text-sm text-rose-200">{t("This track is no longer available.")}</p> : null;
}
export function FavoritesPane() {
  const { t } = useLanguage();
  const { accessToken } = useAuth();
  const resource = useProfileResource<{ items: SavedTrack[] }>("/provider-favorites");
  const playback = useSavedPlayback();
  const [removing, setRemoving] = useState("");
  const [mutationError, setMutationError] = useState(false);
  async function remove(id: string) {
    setRemoving(id); setMutationError(false);
    try {
      await profileRequest(`/provider-favorites/${encodeURIComponent(id)}`, accessToken, { method: "DELETE" });
      resource.setData((current) => current ? { items: current.items.filter((item) => item.provider_track_id !== id) } : current);
    } catch { setMutationError(true); }
    finally { setRemoving(""); }
  }
  if (resource.loading) return <RowsSkeleton />;
  if (resource.error) return <ProfileUnavailable onRetry={resource.retry} />;
  const items = resource.data?.items || [];
  return <><div className="mb-4 flex items-center justify-between"><h2 className="t-h2">{t("Saved tracks")}</h2><span className="t-meta">{items.length} {t("tracks")}</span></div>
    {!items.length ? <StateBlock icon={Heart} tone="neutral" title={t("Your favorites shelf is empty.")} body={t("Save a track from Discover and it will appear here.")} actionHref="/discover" actionLabel={t("Explore music")} /> : <Reveal stagger="x">{items.map((item) => <TrackRow key={item.provider_track_id} track={rowTrack(item)} onPlay={() => void playback.play(item)} isCurrent={playback.currentTrack?.id === item.provider_track_id} isPlaying={playback.isPlaying} busy={playback.busy === item.provider_track_id} trailing={<><a href={item.source_url} target="_blank" rel="noreferrer" className="btn-icon hidden sm:grid" aria-label={t("Open track page")}><Link2 size={16} /></a><button type="button" disabled={removing === item.provider_track_id} onClick={() => void remove(item.provider_track_id)} className="btn-icon hover:!text-rose-200" aria-label={`${t("Remove from favorites")}: ${item.title}`}><Trash2 size={16} /></button></>} />)}</Reveal>}
    <PlaybackError visible={playback.error} />{mutationError && <p role="alert" className="mt-3 text-sm text-rose-200">{t("Could not remove this saved track.")}</p>}
  </>;
}
export function PlaylistsPane() {
  const { t } = useLanguage();
  const resource = useProfileResource<{ items: Playlist[] }>("/playlists");
  if (resource.loading) return <GridSkeleton count={4} />;
  if (resource.error) return <ProfileUnavailable onRetry={resource.retry} />;
  const items = resource.data?.items || [];
  return <><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="t-h2">{t("Your playlists")}</h2><Link href="/playlists" className="btn-ghost"><Plus size={16} />{t("Create a playlist")}</Link></div>
    {items.length ? <Reveal stagger="up" className="grid gap-3 sm:grid-cols-2">{items.map((playlist) => <Link key={playlist.id} href={`/playlists/${playlist.id}`} className="card-lift surface flex min-w-0 items-center gap-3 p-4"><span className="grid h-14 w-14 shrink-0 place-items-center rounded-tile bg-accent-soft text-violet-100"><Disc3 size={24} /></span><div className="min-w-0"><h3 className="t-row truncate">{playlist.title}</h3><p className="t-meta mt-1 truncate">{playlist.description || t("No description")}</p><p className="mt-2 text-xs text-muted">{playlist.is_public ? t("Public") : t("Private")}</p></div></Link>)}</Reveal> : <StateBlock icon={Disc3} tone="neutral" title={t("Your first playlist starts here.")} body={t("Create and manage your own playlists. They are stored in your SONORA account, not just in this browser.")} actionHref="/playlists" actionLabel={t("Create a playlist")} />}
  </>;
}
export function HistoryPane() {
  const { t, language } = useLanguage();
  const resource = useProfileResource<{ items: HistoryTrack[] }>("/provider-history?limit=100");
  const playback = useSavedPlayback();
  if (resource.loading) return <RowsSkeleton />;
  if (resource.error) return <ProfileUnavailable onRetry={resource.retry} />;
  const items = resource.data?.items || [];
  return <><h2 className="t-h2">{t("Listening history")}</h2><p className="t-meta mt-2 mb-4">{t("History clearing is not supported by this server yet.")}</p>
    {!items.length ? <StateBlock icon={History} tone="neutral" title={t("Your listening history is empty.")} body={t("Play a track in Discover and it will appear here.")} actionHref="/discover" actionLabel={t("Explore music")} /> : <Reveal stagger="x">{items.map((item) => <TrackRow key={item.id} track={rowTrack(item)} onPlay={() => void playback.play(item)} isCurrent={playback.currentTrack?.id === item.provider_track_id} isPlaying={playback.isPlaying} busy={playback.busy === item.provider_track_id} meta={<>{t(item.event_type === "complete" ? "Finished" : item.event_type === "skip" ? "Skipped" : "Played")} · {new Date(item.occurred_at).toLocaleString(language === "ru" ? "ru-RU" : "en-US", { dateStyle: "short", timeStyle: "short" })}</>} trailing={<a href={item.source_url} target="_blank" rel="noreferrer" className="btn-icon hidden sm:grid" aria-label={t("Open track page")}><Link2 size={16} /></a>} />)}</Reveal>}
    <PlaybackError visible={playback.error} />
  </>;
}
export function CollectionPane({ kind }: { kind: "artists" | "albums" }) {
  const { t } = useLanguage();
  const resource = useProfileResource<{ items: SavedTrack[] }>("/provider-favorites");
  const playback = useSavedPlayback();
  const [open, setOpen] = useState("");
  if (resource.loading) return <GridSkeleton count={4} />;
  if (resource.error) return <ProfileUnavailable onRetry={resource.retry} />;
  const groups = new Map<string, { title: string; artist: string; artwork: string | null; tracks: SavedTrack[] }>();
  for (const item of resource.data?.items || []) {
    const title = kind === "artists" ? item.artist_name : item.album_name?.trim();
    if (!title) continue;
    const key = kind === "artists" ? title : `${item.artist_name}::${title}`;
    const group = groups.get(key) || { title, artist: item.artist_name, artwork: item.artwork_url, tracks: [] };
    group.tracks.push(item); groups.set(key, group);
  }
  return <><h2 className="t-h2">{t(kind === "artists" ? "Artists" : "Albums")}</h2><p className="t-meta mt-2 mb-4">{t("Grouped from your saved tracks, not a separate subscription list.")}</p>
    {groups.size ? <Reveal stagger="up" className="space-y-3">{[...groups.entries()].map(([key, group]) => <article key={key} className="surface overflow-hidden"><button type="button" className="flex w-full items-center gap-3 p-4 text-left" aria-expanded={open === key} onClick={() => setOpen(open === key ? "" : key)}><Artwork src={group.artwork} className="h-14 w-14 shrink-0" /><div className="min-w-0 flex-1"><h3 className="t-row truncate">{group.title}</h3><p className="t-meta mt-1">{kind === "albums" ? `${group.artist} · ` : ""}{group.tracks.length} {t("tracks")}</p></div><ChevronDown size={18} className={`text-muted transition-transform ${open === key ? "rotate-180" : ""}`} /></button>{open === key && <Reveal className="border-t border-white/5 p-2">{group.tracks.map((item) => <TrackRow key={item.provider_track_id} track={rowTrack(item)} onPlay={() => void playback.play(item)} isCurrent={playback.currentTrack?.id === item.provider_track_id} isPlaying={playback.isPlaying} busy={playback.busy === item.provider_track_id} />)}</Reveal>}</article>)}</Reveal> : <StateBlock icon={kind === "albums" ? Disc3 : UsersRound} tone="neutral" title={t("No saved collection here yet.")} body={t("Save tracks with artist and album details to grow this collection.")} actionHref="/discover" actionLabel={t("Explore music")} />}
    <PlaybackError visible={playback.error} />
  </>;
}
