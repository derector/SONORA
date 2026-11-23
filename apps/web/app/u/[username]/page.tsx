"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, UserRound } from "lucide-react";
import { useAuth } from "../../../components/auth-provider";
import { profileRequest } from "../../../lib/profile";

type PublicProfile = {
  id: string; username: string; displayName: string; avatarUrl: string | null;
  bio?: string | null; status?: string | null;
};
export default function PublicProfilePage() {
  const { username } = useParams<{ username: string }>();
  const { accessToken } = useAuth();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError("");
    try {
      if (!/^[a-z0-9_]{3,24}$/i.test(username || "")) throw new Error("Некорректное имя пользователя");
      const result = await profileRequest<{ profile: PublicProfile }>(`/users/${encodeURIComponent(username)}`, accessToken, { signal });
      if (!signal?.aborted) setProfile(result.profile);
    } catch {
      if (!signal?.aborted) { setProfile(null); setError("Профиль недоступен или не найден"); }
    } finally { if (!signal?.aborted) setLoading(false); }
  }, [username, accessToken]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  return <main className="mx-auto max-w-2xl px-4 py-8">
    <Link href="/messenger" className="inline-flex items-center gap-2 text-sm text-violet-200"><ArrowLeft size={16}/> К чатам</Link>
    <section className="mt-7 rounded-3xl border border-white/15 bg-white/[0.06] p-7 shadow-2xl backdrop-blur-2xl">
      {loading ? <p role="status">Загрузка профиля…</p> : error || !profile ? <p role="alert">{error}</p> : <>
        <div className="flex items-center gap-5">
          {profile.avatarUrl ? <img src={profile.avatarUrl} alt="" className="h-20 w-20 rounded-full object-cover"/> : <span className="grid h-20 w-20 place-items-center rounded-full bg-violet-300/15"><UserRound size={32}/></span>}
          <div><h1 className="text-2xl font-semibold">{profile.displayName || profile.username}</h1><p className="mt-1 text-sm opacity-70">@{profile.username}</p></div>
        </div>
        {profile.status && <p className="mt-6 text-sm text-violet-200">{profile.status}</p>}
        {profile.bio && <p className="mt-3 whitespace-pre-wrap break-words text-sm opacity-80">{profile.bio}</p>}
      </>}
    </section>
  </main>;
}
