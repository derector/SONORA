"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Music2, Settings } from "lucide-react";
import { useAuth } from "../../components/auth-provider";
import { useLanguage } from "../../components/language-provider";
import { Camera, CoverDialog, EditProfileDialog, Pencil, ProfileHero, ProfileTabs, Share2, Trash2, type ProfileTab } from "../../components/profile-identity";
import { ErrorBlock, RowsSkeleton, StateBlock } from "../../components/ui/states";
import { Reveal } from "../../components/ui/reveal";
import { imagePayload, profileRequest, type ProfileChanges, type ProfileUser } from "../../lib/profile";

const Favorites = dynamic(() => import("../../components/profile-library").then((module) => module.FavoritesPane), { loading: () => <RowsSkeleton /> });
const Playlists = dynamic(() => import("../../components/profile-library").then((module) => module.PlaylistsPane), { loading: () => <RowsSkeleton /> });
const History = dynamic(() => import("../../components/profile-library").then((module) => module.HistoryPane), { loading: () => <RowsSkeleton /> });
const Collection = dynamic(() => import("../../components/profile-library").then((module) => module.CollectionPane), { loading: () => <RowsSkeleton /> });

export default function ProfilePage() {
  const router = useRouter();
  const { t } = useLanguage();
  const { user, accessToken, loading: authLoading, isAuthenticated, updateProfile, refreshSession } = useAuth();
  const [profile, setProfile] = useState<ProfileUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [extended, setExtended] = useState(false);
  const [tab, setTab] = useState<ProfileTab>("overview");
  const [dialog, setDialog] = useState<"edit" | "cover" | "avatar" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const loadProfile = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true); setError("");
    try {
      const result = await profileRequest<{ user: ProfileUser }>("/profile", accessToken);
      setProfile(result.user);
      // Never claim an extended PATCH succeeded when the deployed GET is still
      // the base contract (the merge at fb07d8b lost that API handler).
      setExtended(Object.prototype.hasOwnProperty.call(result.user, "bio"));
    } catch { setError("Could not load your profile. Try again."); }
    finally { setLoading(false); }
  }, [accessToken]);
  useEffect(() => { if (!authLoading && !isAuthenticated) router.replace("/auth"); }, [authLoading, isAuthenticated, router]);
  useEffect(() => { void loadProfile(); }, [loadProfile]);

  async function save(changes: ProfileChanges) {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = extended
        ? (await profileRequest<{ user: ProfileUser }>("/profile", accessToken, { method: "PATCH", body: JSON.stringify(changes) })).user
        : await updateProfile({ displayName: changes.displayName, username: changes.username });
      setProfile((current) => ({ ...current, ...result }));
      if (extended) { await refreshSession(); await loadProfile(); }
      setDialog(null); setNotice("Profile changes saved.");
    } catch { setError("Could not save your profile."); }
    finally { setBusy(false); }
  }
  async function imageAction(kind: "avatar" | "cover", file?: File) {
    setBusy(true); setError(""); setNotice("");
    try {
      // 2 MB keeps base64 inside the current API's 3 MB request body limit.
      const payload = file ? await imagePayload(file, 2) : undefined;
      const result = await profileRequest<{ user: ProfileUser }>(`/profile/${kind}`, accessToken, { method: file ? "POST" : "DELETE", ...(payload ? { body: JSON.stringify(payload) } : {}) });
      setProfile((current) => ({ ...current, ...result.user }));
      if (kind === "avatar") await refreshSession();
      setDialog(null); setNotice(file ? "Image updated." : "Image removed.");
    } catch { setError("Could not update this image. Use JPG, PNG or WebP up to 2 MB. Profile storage may be unavailable."); }
    finally { setBusy(false); }
  }
  async function preset(id: string) {
    if (!extended) return;
    setBusy(true); setError("");
    try {
      await profileRequest("/profile", accessToken, { method: "PATCH", body: JSON.stringify({ accent: id }) });
      if (profile?.coverUrl) await profileRequest("/profile/cover", accessToken, { method: "DELETE" });
      await loadProfile(); setDialog(null); setNotice("Profile changes saved.");
    } catch { setError("Could not save your profile."); }
    finally { setBusy(false); }
  }
  async function share() {
    if (!profile?.username) return;
    const url = new URL(`/u/${encodeURIComponent(profile.username)}`, window.location.origin).href;
    setNotice(""); setError("");
    try {
      if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(url); setNotice("Profile link copied."); }
      else if (navigator.share) await navigator.share({ title: profile.displayName, url });
      else { window.prompt(t("Copy profile link"), url); }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      if (navigator.share) { try { await navigator.share({ title: profile.displayName, url }); } catch { setError("Could not share your profile."); } }
      else setError("Could not share your profile.");
    }
  }
  if (authLoading || !isAuthenticated || !user || loading) return <main className="mx-auto min-h-screen max-w-6xl px-4 py-8 pb-36 md:px-8" aria-label={t("Loading profile…")}><div className="shimmer h-48 rounded-panel" /><div className="shimmer -mt-10 ml-5 h-24 w-24 rounded-full" /><div className="shimmer mt-5 h-7 w-64" /><div className="mt-8"><RowsSkeleton count={4} /></div></main>;
  if (!profile) return <main className="mx-auto max-w-6xl px-4 py-8"><ErrorBlock title={t(error || "Could not load your profile. Try again.")} onRetry={() => void loadProfile()} /></main>;

  return <main className="mx-auto min-h-screen w-full max-w-6xl px-4 py-6 pb-36 md:px-8">
    <ProfileHero profile={profile} avatarAction={<button type="button" className="btn-icon absolute bottom-0 right-0 !bg-[#252333] !text-white" onClick={() => setDialog("avatar")} aria-label={t("Change avatar")}><Camera size={16} /></button>} actions={<>
      <button type="button" className="btn-ghost" onClick={() => setDialog("cover")}><Camera size={16} />{t("Change cover")}</button>
      <button type="button" className="btn-ghost" onClick={() => setDialog("edit")}><Pencil size={16} />{t("Edit profile")}</button>
      <button type="button" className="btn-icon" onClick={() => void share()} aria-label={t("Share profile")}><Share2 size={18} /></button>
      <Link href="/settings" className="btn-icon" aria-label={t("Settings")}><Settings size={18} /></Link>
    </>} />
    {notice && <p role="status" className="toast-in mt-4 rounded-card border border-emerald-300/15 bg-emerald-300/5 p-3 text-sm text-emerald-200">{t(notice)}</p>}
    {error && <p role="alert" className="mt-4 rounded-card border border-rose-300/15 bg-rose-300/5 p-3 text-sm text-rose-200">{t(error)}</p>}
    <ProfileTabs active={tab} onChange={setTab} />
    <section id="profile-panel" role="tabpanel" aria-labelledby={`profile-tab-${tab}`} className="mt-5 min-w-0">
      <Reveal key={tab} className="profile-pane">
        {tab === "favorites" ? <Favorites /> : tab === "playlists" ? <Playlists /> : tab === "history" ? <History /> : tab === "albums" || tab === "artists" ? <Collection key={tab} kind={tab} /> : <StateBlock icon={Music2} title={t("Your listening space")} body={t("This section is not available yet. Your saved music and listening history are ready in the adjacent tabs.")} actionHref="/discover" actionLabel={t("Explore music")} />}
      </Reveal>
    </section>
    {dialog === "edit" && <EditProfileDialog profile={profile} extended={extended} busy={busy} error={error ? t(error) : ""} onClose={() => setDialog(null)} onSave={save} />}
    {dialog === "cover" && <CoverDialog profile={profile} extended={extended} busy={busy} onClose={() => setDialog(null)} onUpload={(file) => void imageAction("cover", file)} onDelete={() => void imageAction("cover")} onPreset={(id) => void preset(id)} />}
    {dialog === "avatar" && <AvatarDialog hasAvatar={Boolean(profile.avatarUrl)} busy={busy} onClose={() => setDialog(null)} onUpload={(file) => void imageAction("avatar", file)} onDelete={() => void imageAction("avatar")} />}
  </main>;
}

import { ProfileDialog } from "../../components/profile-identity";
function AvatarDialog({ hasAvatar, busy, onClose, onUpload, onDelete }: { hasAvatar: boolean; busy: boolean; onClose: () => void; onUpload: (file: File) => void; onDelete: () => void }) {
  const { t } = useLanguage();
  return <ProfileDialog title={t("Profile photo")} onClose={onClose}>
    <label className="btn-ghost flex w-full cursor-pointer justify-center"><Camera size={16} />{busy ? t("Uploading…") : t("Change avatar")}<input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) onUpload(file); event.target.value = ""; }} /></label>
    <p className="t-meta mt-3">{t("JPG, PNG or WebP. Maximum size: 2 MB.")}</p>
    {hasAvatar && <button type="button" disabled={busy} className="btn-ghost mt-4 w-full !text-rose-200" onClick={onDelete}><Trash2 size={16} />{t("Remove avatar")}</button>}
  </ProfileDialog>;
}
