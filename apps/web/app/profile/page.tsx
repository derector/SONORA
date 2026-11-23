"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Camera, Save, UserRound } from "lucide-react";
import { useAuth } from "../../components/auth-provider";

export default function ProfilePage() {
  const router = useRouter();
  const { user, loading, isAuthenticated, updateProfile, uploadAvatar } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => { if (!loading && !isAuthenticated) router.replace("/auth"); }, [loading, isAuthenticated, router]);
  useEffect(() => { setDisplayName(user?.displayName ?? ""); setUsername(user?.username ?? ""); }, [user]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try { await updateProfile({ displayName: displayName.trim(), username: username.trim() }); setNotice("Профиль сохранён"); }
    catch (e) { setError(e instanceof Error ? e.message : "Не удалось сохранить профиль"); }
    finally { setBusy(false); }
  }
  async function avatar(file?: File) {
    if (!file) return;
    setBusy(true); setError(""); setNotice("");
    try { await uploadAvatar(file); setNotice("Фото обновлено"); }
    catch (e) { setError(e instanceof Error ? e.message : "Не удалось загрузить фото"); }
    finally { setBusy(false); }
  }
  if (loading || !user) return <main className="mx-auto max-w-xl p-6" aria-live="polite">Загрузка профиля…</main>;
  return <main className="mx-auto max-w-xl px-4 py-8">
    <Link href="/messenger" className="inline-flex items-center gap-2 text-sm text-violet-200"><ArrowLeft size={16}/> К чатам</Link>
    <section className="mt-7 rounded-3xl border border-white/15 bg-white/[0.06] p-6 shadow-2xl backdrop-blur-2xl sm:p-8">
      <p className="text-xs tracking-[.22em] text-violet-200">SONORA MESSENGER</p>
      <h1 className="mt-2 text-3xl font-semibold">Мой профиль</h1>
      <div className="mt-7 flex items-center gap-5">
        {user.avatarUrl ? <img src={user.avatarUrl} alt="Фото профиля" className="h-20 w-20 rounded-full object-cover"/> :
          <span className="grid h-20 w-20 place-items-center rounded-full bg-violet-300/15"><UserRound size={34}/></span>}
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-white/15 px-4 py-3 text-sm hover:bg-white/10">
          <Camera size={17}/> Изменить фото
          <input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} className="sr-only" onChange={e => { void avatar(e.target.files?.[0]); e.target.value = ""; }}/>
        </label>
      </div>
      <form onSubmit={save} className="mt-7 space-y-5">
        <label className="block text-sm">Имя<input required maxLength={48} value={displayName} onChange={e=>setDisplayName(e.target.value)} className="mt-2 w-full rounded-xl border border-white/15 bg-black/20 px-4 py-3 outline-none focus:border-violet-300/60"/></label>
        <label className="block text-sm">Имя пользователя<input required minLength={3} maxLength={24} pattern="[A-Za-z0-9_]+" value={username} onChange={e=>setUsername(e.target.value)} className="mt-2 w-full rounded-xl border border-white/15 bg-black/20 px-4 py-3 outline-none focus:border-violet-300/60"/></label>
        <p className="text-xs text-slate-400">{user.email}</p>
        {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
        {notice && <p role="status" className="text-sm text-emerald-300">{notice}</p>}
        <button disabled={busy} className="inline-flex items-center gap-2 rounded-xl bg-violet-400/25 px-5 py-3 text-sm font-semibold hover:bg-violet-400/35 disabled:opacity-50"><Save size={17}/>{busy ? "Сохранение…" : "Сохранить"}</button>
      </form>
    </section>
  </main>;
}
