"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight, Disc3, Plus, Trash2 } from "lucide-react";
import { useLanguage } from "../../components/language-provider";
import { GridSkeleton, StateBlock } from "../../components/ui/states";

type Playlist = {
  id: string;
  title: string;
  description: string | null;
  is_public: boolean;
  created_at: string;
  updated_at: string;
};

type ApiResponse = {
  items?: Playlist[];
  playlist?: Playlist;
  session?: { access_token: string };
  error?: string;
};

const API = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");

export default function PlaylistsPage() {
  const { t } = useLanguage();
  const [token, setToken] = useState("");
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function loadPlaylists(accessToken: string) {
    const response = await fetch(`${API}/api/v1/playlists`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      credentials: "include"
    });
    const result = await response.json() as ApiResponse;
    if (!response.ok) throw new Error(result.error || "Could not load your playlists.");
    setPlaylists(result.items ?? []);
  }

  useEffect(() => {
    let active = true;
    fetch(`/api/auth/refresh`, { method: "POST", credentials: "include" })
      .then(async (response) => response.ok ? response.json() as Promise<ApiResponse> : null)
      .then(async (result) => {
        const accessToken = result?.session?.access_token;
        if (!active || !accessToken) return;
        setToken(accessToken);
        await loadPlaylists(accessToken);
      })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : "Could not restore your session."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function createPlaylist(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    setSaving(true); setError(""); setNotice("");
    try {
      const response = await fetch(`${API}/api/v1/playlists`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        credentials: "include",
        body: JSON.stringify({ title, description, isPublic: false })
      });
      const result = await response.json() as ApiResponse;
      if (!response.ok) throw new Error(result.error || "Could not create the playlist.");
      setTitle(""); setDescription("");
      await loadPlaylists(token);
      setNotice("Playlist created.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the playlist.");
    } finally {
      setSaving(false);
    }
  }

  async function deletePlaylist(id: string) {
    if (!token) return;
    setError(""); setNotice("");
    try {
      const response = await fetch(`${API}/api/v1/playlists/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
        credentials: "include"
      });
      const result = await response.json() as ApiResponse;
      if (!response.ok) throw new Error(result.error || "Could not delete the playlist.");
      setPlaylists((items) => items.filter((item) => item.id !== id));
      setNotice("Playlist deleted.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the playlist.");
    }
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-4 py-6 pb-36 md:px-8">
      <section className="panel-hero mt-6 px-6 py-8 md:px-10 md:py-11">
        <p className="t-eyebrow">{t("Your personal collection")}</p>
        <h1 className="t-display mt-3">{t("Sound, in your order.")}</h1>
        <p className="t-meta mt-3 max-w-xl leading-6">{t("Create and manage your own playlists. They are stored in your SONORA account, not just in this browser.")}</p>
      </section>

      {loading ? <div className="mt-8"><GridSkeleton count={4} /></div> : !token ? (
        <div className="mt-8">
          <StateBlock
            icon={Disc3}
            title={t("Sign in to see your library.")}
            body={t("Your playlists are private to your account until you choose otherwise.")}
            actionHref="/auth"
            actionLabel={t("Sign in or create account")}
          />
        </div>
      ) : (
        <>
          <form onSubmit={createPlaylist} className="surface mt-8 p-5 md:p-6" aria-labelledby="playlist-create-heading">
            <h2 id="playlist-create-heading" className="flex items-center gap-2 text-[15px] font-semibold"><Plus size={17} className="text-violet-200" /> {t("Create a playlist")}</h2>
            <div className="mt-5 grid gap-3 md:grid-cols-[1fr_1.4fr_auto]">
              <input value={title} onChange={(event) => setTitle(event.target.value)} required minLength={1} maxLength={80} placeholder={t("Playlist name")} className="field min-w-0" />
              <input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} placeholder={t("A short description (optional)")} className="field min-w-0" />
              <button disabled={saving} className="btn-press btn-primary">{saving ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden /> : <Plus size={16} />} {t("Create")}</button>
            </div>
          </form>
          <section className="mt-8" aria-labelledby="playlists-heading">
            <div className="mb-4 flex items-end justify-between gap-3">
              <div>
                <p className="t-eyebrow">{t("Your library")}</p>
                <h2 id="playlists-heading" className="t-h2 mt-1">{t("Your playlists")}</h2>
              </div>
              <span className="t-meta">{playlists.length} {t("total")}</span>
            </div>
            {playlists.length === 0 ? (
              <StateBlock
                icon={Disc3}
                tone="neutral"
                title={t("Your first playlist starts here.")}
                body={t("Create one above. You can add catalog tracks as the music catalog is connected.")}
              />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {playlists.map((playlist) => (
                  <article key={playlist.id} className="card-lift surface group flex min-w-0 items-center gap-4 rounded-card p-3">
                    <Link href={`/playlists/${playlist.id}`} aria-label={`${t("Open")} ${playlist.title}`} className="grid h-12 w-12 shrink-0 place-items-center rounded-tile bg-gradient-to-br from-accent/40 to-accent-teal/22 shadow-card">
                      <Disc3 size={20} className="text-white/85" strokeWidth={1.6} />
                    </Link>
                    <Link href={`/playlists/${playlist.id}`} className="min-w-0 flex-1">
                      <h3 className="t-row truncate group-hover:text-white">{playlist.title}</h3>
                      <p className="t-meta mt-0.5 truncate">{playlist.description || t("No description")} · {playlist.is_public ? t("Public") : t("Private")}</p>
                    </Link>
                    <Link href={`/playlists/${playlist.id}`} aria-hidden tabIndex={-1} className="btn-icon hidden sm:grid"><ChevronRight size={17} /></Link>
                    <button type="button" onClick={() => void deletePlaylist(playlist.id)} aria-label={`${t("Delete")} ${playlist.title}`} className="btn-icon hover:!text-rose-200"><Trash2 size={15} /></button>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}
      {notice && <p role="status" className="mt-5 rounded-card border border-emerald-300/15 bg-emerald-300/5 px-4 py-3 text-xs text-emerald-200">{t(notice) || notice}</p>}
      {error && <p role="alert" className="mt-5 rounded-card border border-rose-300/15 bg-rose-300/5 px-4 py-3 text-xs text-rose-200">{error}</p>}
    </main>
  );
}
