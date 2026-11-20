"use client";

import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Camera, CheckCircle2, LoaderCircle, LogOut, Music2, Settings, ShieldCheck, UserRound } from "lucide-react";
import { useAuth } from "../../components/auth-provider";
import { useLanguage } from "../../components/language-provider";

export default function ProfilePage() {
  const router = useRouter();
  const { t } = useLanguage();
  const { user, loading, isAuthenticated, updateProfile, uploadAvatar, logout } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (user) {
      setDisplayName(user.displayName || "");
      setUsername(user.username || "");
    }
  }, [user]);

  useEffect(() => {
    if (!loading && !isAuthenticated) router.replace("/auth");
  }, [loading, isAuthenticated, router]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true); setError(""); setMessage("");
    try {
      await updateProfile({ displayName, username });
      setMessage(t("Profile changes saved."));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Could not save your profile."));
    } finally { setSaving(false); }
  }

  async function changeAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true); setError(""); setMessage("");
    try {
      await uploadAvatar(file);
      setMessage(t("Profile photo updated."));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Could not upload this image."));
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  }

  async function signOut() {
    await logout();
    router.replace("/");
  }

  if (loading || !isAuthenticated || !user) {
    return <main className="flex min-h-screen items-center justify-center px-4 text-sm text-slate-400"><LoaderCircle className="mr-3 animate-spin" size={18}/>{t("Restoring your session…")}</main>;
  }

  const initial = (user.displayName || user.username || user.email).slice(0, 1).toUpperCase();

  return (
    <main className="mx-auto min-h-screen max-w-4xl px-4 py-8 pb-16 md:px-8">
      
      <div className="mt-8 grid gap-5 lg:grid-cols-[260px_1fr]">
        <aside className="surface h-fit p-5">
          <div className="flex items-center gap-3">
            {user.avatarUrl ? <img src={user.avatarUrl} alt="" className="h-12 w-12 rounded-2xl object-cover"/> : <span className="grid h-12 w-12 place-items-center rounded-2xl bg-violet-300/15 text-lg text-violet-100">{initial}</span>}
            <div className="min-w-0"><p className="truncate text-sm font-semibold">{user.displayName || user.username}</p><p className="truncate text-xs text-slate-500">@{user.username}</p></div>
          </div>
          <nav className="mt-6 space-y-2 text-sm">
            <a href="#profile-details" className="flex items-center gap-3 rounded-xl bg-violet-300/10 px-3 py-3 text-violet-100"><UserRound size={17}/>{t("Profile details")}</a>
            <Link href="/settings" className="flex items-center gap-3 rounded-xl px-3 py-3 text-slate-300 hover:bg-white/5"><Settings size={17}/>{t("Settings")}</Link>
            <Link href="/playlists" className="flex items-center gap-3 rounded-xl px-3 py-3 text-slate-300 hover:bg-white/5"><Music2 size={17}/>{t("Your library")}</Link>
          </nav>
          <button onClick={signOut} className="mt-6 flex w-full items-center gap-3 rounded-xl border border-white/10 px-3 py-3 text-left text-sm text-slate-300 hover:bg-white/5"><LogOut size={17}/>{t("Sign out")}</button>
        </aside>

        <section className="space-y-5">
          <div className="rounded-panel border border-white/10 bg-panel/90 p-6 sm:p-8">
            <div className="flex items-center gap-3"><ShieldCheck className="text-emerald-200" size={22}/><div><h1 className="text-2xl font-semibold">{t("Your profile")}</h1><p className="mt-1 text-sm text-slate-400">{t("Manage your SONORA identity and account details.")}</p></div></div>
            <div id="profile-details" className="mt-8 flex flex-col gap-5 border-b border-white/10 pb-7 sm:flex-row sm:items-center">
              {user.avatarUrl ? <img src={user.avatarUrl} alt={t("Profile avatar")} className="h-24 w-24 rounded-panel border border-white/10 object-cover"/> : <div className="grid h-24 w-24 place-items-center rounded-panel border border-white/10 bg-violet-300/10 text-3xl text-violet-100">{initial}</div>}
              <div className="flex-1"><h2 className="font-medium">{t("Profile photo")}</h2><p className="mt-1 text-xs leading-5 text-slate-500">{t("JPG, PNG or WebP. Maximum size: 2 MB.")}</p><label className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-xs font-medium hover:bg-white/10">{uploading ? <LoaderCircle className="animate-spin" size={15}/> : <Camera size={15}/>} {uploading ? t("Uploading…") : t("Change avatar")}<input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={uploading} onChange={changeAvatar}/></label></div>
            </div>
            <form onSubmit={save} className="mt-7 space-y-5">
              <label className="block text-xs text-slate-400">{t("Display name")}<input value={displayName} onChange={(e) => setDisplayName(e.target.value)} minLength={1} maxLength={48} required className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none focus:border-violet-300/60"/></label>
              <label className="block text-xs text-slate-400">{t("Username")}<div className="mt-2 flex items-center rounded-xl border border-white/10 bg-black/20 px-4"><span className="text-slate-500">@</span><input value={username} onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, "").slice(0,24))} minLength={3} maxLength={24} required className="w-full bg-transparent py-3 pl-2 text-sm text-white outline-none"/></div></label>
              <label className="block text-xs text-slate-400">{t("Email address")}<input value={user.email} disabled className="mt-2 w-full cursor-not-allowed rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-500"/></label>
              <button disabled={saving || (displayName === user.displayName && username === user.username)} className="inline-flex items-center gap-2 rounded-full bg-violet-200 px-5 py-3 text-sm font-semibold text-[#171323] hover:bg-white disabled:cursor-not-allowed disabled:opacity-40">{saving ? <LoaderCircle className="animate-spin" size={16}/> : <CheckCircle2 size={16}/>} {saving ? t("Saving…") : t("Save profile")}</button>
            </form>
            {message && <p className="mt-5 rounded-xl border border-emerald-300/15 bg-emerald-300/5 px-4 py-3 text-xs text-emerald-200">{message}</p>}
            {error && <p role="alert" className="mt-5 rounded-xl border border-rose-300/15 bg-rose-300/5 px-4 py-3 text-xs text-rose-200">{error}</p>}
          </div>

          <div className="surface p-6 sm:p-8">
            <h2 className="font-semibold">{t("Account security")}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-400">{t("Your session is restored from a secure HttpOnly cookie. Access tokens are refreshed automatically while you use SONORA and when you return to the site.")}</p>
            <div className="mt-4 flex items-center gap-2 text-xs text-emerald-200"><span className="h-2 w-2 rounded-full bg-emerald-300"/>{t("Account session active")}</div>
          </div>
        </section>
      </div>
    </main>
  );
}
