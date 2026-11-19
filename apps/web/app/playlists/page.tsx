"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, AudioLines, Disc3, LoaderCircle, Plus, Trash2, ChevronRight } from "lucide-react";
import { useLanguage } from "../../components/language-provider";

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
    fetch(`${API}/api/auth/refresh`, { method: "POST", credentials: "include" })
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
    <main className="mx-auto min-h-screen max-w-5xl px-4 py-6 md:px-8">
      <section className="mt-10 rounded-[2rem] border border-violet-300/15 bg-gradient-to-br from-[#292044] via-[#171426] to-[#10131c] p-7 md:p-10">
        <p className="text-[10px] font-semibold uppercase tracking-[.25em] text-violet-200">{t("Your personal collection")}</p>
        <h1 className="mt-3 text-3xl font-semibold md:text-5xl">{t("Sound, in your order.")}</h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-slate-300">{t("Create and manage your own playlists. They are stored in your SONORA account, not just in this browser.")}</p>
      </section>

      {loading ? <div className="flex min-h-48 items-center justify-center gap-3 text-sm text-slate-400"><LoaderCircle className="animate-spin" size={18}/> {t("Restoring your session…")}</div> : !token ? (
        <section className="mt-8 rounded-3xl border border-white/10 bg-white/[0.025] p-7">
          <h2 className="text-xl font-semibold">{t("Sign in to see your library.")}</h2>
          <p className="mt-2 text-sm text-slate-400">{t("Your playlists are private to your account until you choose otherwise.")}</p>
          <Link href="/auth" className="mt-5 inline-flex rounded-full bg-violet-200 px-5 py-3 text-sm font-semibold text-[#171323]">{t("Sign in or create account")}</Link>
        </section>
      ) : (
        <>
          <form onSubmit={createPlaylist} className="mt-8 rounded-3xl border border-white/10 bg-white/[0.025] p-6">
            <div className="flex items-center gap-2"><Plus className="text-violet-200" size={18}/><h2 className="font-semibold">{t("Create a playlist")}</h2></div>
            <div className="mt-5 grid gap-3 md:grid-cols-[1fr_1.4fr_auto]">
              <input value={title} onChange={(event) => setTitle(event.target.value)} required minLength={1} maxLength={80} placeholder={t("Playlist name")} className="rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none focus:border-violet-300/60"/>
              <input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} placeholder={t("A short description (optional)")} className="rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none focus:border-violet-300/60"/>
              <button disabled={saving} className="inline-flex items-center justify-center gap-2 rounded-xl bg-violet-200 px-5 py-3 text-sm font-semibold text-[#171323] transition hover:bg-white disabled:opacity-50">{saving ? <LoaderCircle className="animate-spin" size={16}/> : <Plus size={16}/>} Create</button>
            </div>
          </form>
          <section className="mt-9">
            <div className="mb-4 flex items-end justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[.25em] text-violet-300">{t("Your library")}</p><h2 className="mt-2 text-2xl font-semibold">{t("Your playlists")}</h2></div><span className="text-xs text-slate-500">{playlists.length} total</span></div>
            {playlists.length === 0 ? <div className="rounded-3xl border border-dashed border-white/10 p-10 text-center"><Disc3 className="mx-auto text-slate-500" size={28}/><p className="mt-3 font-medium">{t("Your first playlist starts here.")}</p><p className="mt-1 text-sm text-slate-500">{t("Create one above. You can add catalog tracks as the music catalog is connected.")}</p></div> : (
              <div className="grid gap-3 sm:grid-cols-2">
                {playlists.map((playlist) => <article key={playlist.id} className="flex items-center gap-4 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4"><div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-violet-300/10 text-violet-200"><Disc3 size={22}/></div><div className="min-w-0 flex-1"><h3 className="truncate font-medium">{playlist.title}</h3><p className="mt-1 truncate text-xs text-slate-500">{playlist.description || t("No description")} · {playlist.is_public ? t("Public") : t("Private")}</p></div><Link href={`/playlists/${playlist.id}`} aria-label={t("Open") + " " + playlist.title} className="rounded-lg p-2 text-violet-200 transition hover:bg-violet-300/10"><ChevronRight size={18}/></Link><button type="button" onClick={() => void deletePlaylist(playlist.id)} aria-label={t("Delete") + " " + playlist.title} className="rounded-lg p-2 text-slate-500 transition hover:bg-rose-400/10 hover:text-rose-200"><Trash2 size={16}/></button></article>)}
              </div>
            )}
          </section>
        </>
      )}
      {notice && <p className="mt-5 rounded-xl border border-emerald-300/15 bg-emerald-300/5 px-4 py-3 text-xs text-emerald-200">{notice}</p>}
      {error && <p role="alert" className="mt-5 rounded-xl border border-rose-300/15 bg-rose-300/5 px-4 py-3 text-xs text-rose-200">{error}</p>}
    </main>
  );
}
