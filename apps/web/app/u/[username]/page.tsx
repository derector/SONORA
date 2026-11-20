"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Disc3, Heart, LockKeyhole, Music2, UserRound, UserRoundCheck, UserRoundPlus } from "lucide-react";
import { useAuth } from "../../../components/auth-provider";
import { useLanguage } from "../../../components/language-provider";
import { ProfileHero } from "../../../components/profile-identity";
import { ErrorBlock, RowsSkeleton, StateBlock } from "../../../components/ui/states";
import { Reveal } from "../../../components/ui/reveal";
import { ProfileRequestError, profileRequest, type ProfileIdentity } from "../../../lib/profile";

type PublicProfile = ProfileIdentity & {
  id: string;
  historyVisible: boolean;
  minutes90: number | null;
  topArtists: { name: string; minutes: number; events: number }[];
  publicPlaylists: { id: string; title: string; description: string | null }[];
  counts: { followers: number; following: number; favorites: number; publicPlaylists: number };
  relationship: { isSelf: boolean; isFollowing: boolean; followsViewer: boolean };
};

export default function PublicProfilePage() {
  const { username } = useParams<{ username: string }>();
  const { t, language } = useLanguage();
  const { accessToken, isAuthenticated, loading: authLoading } = useAuth();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(0);
  const [busy, setBusy] = useState(false);
  const [followError, setFollowError] = useState(false);
  const validUsername = /^[a-z0-9_]{3,24}$/.test(username || "");
  const endpoint = `/users/${encodeURIComponent(username || "")}`;
  const number = (value: number) => new Intl.NumberFormat(language === "ru" ? "ru-RU" : "en-US").format(value);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!validUsername) { setStatus(404); setLoading(false); return; }
    setStatus(0);
    try {
      const result = await profileRequest<{ profile: PublicProfile }>(endpoint, accessToken, { signal });
      if (!signal?.aborted) setProfile(result.profile);
    } catch (error) {
      if (!signal?.aborted) {
        setProfile(null);
        setStatus(error instanceof ProfileRequestError ? error.status : 503);
      }
    } finally { if (!signal?.aborted) setLoading(false); }
  }, [endpoint, accessToken, validUsername]);

  useEffect(() => {
    if (authLoading) return;
    const controller = new AbortController();
    setProfile(null); setLoading(true); setFollowError(false);
    void load(controller.signal);
    return () => controller.abort();
  }, [authLoading, load]);

  async function toggleFollow() {
    if (!profile || !isAuthenticated || profile.relationship.isSelf || busy) return;
    setBusy(true); setFollowError(false);
    try {
      const result = await profileRequest<{ following: boolean; followers: number }>(`${endpoint}/follow`, accessToken, {
        method: profile.relationship.isFollowing ? "DELETE" : "POST"
      });
      // Change the button and count only after server success; no pretend follow.
      setProfile((current) => current ? {
        ...current, counts: { ...current.counts, followers: result.followers },
        relationship: { ...current.relationship, isFollowing: result.following }
      } : current);
    } catch { setFollowError(true); }
    finally { setBusy(false); }
  }

  if (authLoading || loading) return <main className="mx-auto min-h-screen w-full max-w-6xl px-4 py-8 pb-36 md:px-8" aria-label={t("Loading profile…")}><div className="shimmer h-48 rounded-panel" /><div className="mt-6"><RowsSkeleton count={4} /></div></main>;
  if (!profile) return <main className="mx-auto w-full max-w-6xl px-4 py-8 pb-36 md:px-8">
    {status === 403 ? <StateBlock icon={LockKeyhole} title={t("This profile is private.")} body={t("The owner has limited profile visibility. No private listening data is shown.")} actionHref="/discover" actionLabel={t("Explore music")} />
      : status === 404 ? <StateBlock icon={UserRound} tone="neutral" title={t("Profile not found.")} body={t("Check the username or ask the owner for a new link.")} actionHref="/discover" actionLabel={t("Explore music")} />
      : <ErrorBlock title={t("This profile section is unavailable.")} body={t("Your data could not be loaded. The service or profile storage may not be ready. No sample data is shown.")} onRetry={() => { setLoading(true); void load(); }} />}
  </main>;

  return <main className="mx-auto min-h-screen w-full max-w-6xl px-4 py-6 pb-36 md:px-8">
    <p className="t-eyebrow mb-4">{t("Public profile")}</p>
    <ProfileHero profile={profile} actions={profile.relationship.isSelf
      ? <Link href="/profile" className="btn-ghost">{t("Edit profile")}</Link>
      : isAuthenticated ? <button type="button" disabled={busy} onClick={() => void toggleFollow()} className={profile.relationship.isFollowing ? "btn-ghost" : "btn-primary"} aria-pressed={profile.relationship.isFollowing}>
        {profile.relationship.isFollowing ? <UserRoundCheck size={16} /> : <UserRoundPlus size={16} />}
        {t(busy ? "Saving…" : profile.relationship.isFollowing ? "Unfollow" : "Follow")}
      </button> : <Link href="/auth" className="btn-primary"><UserRoundPlus size={16} />{t("Sign in to follow")}</Link>} />
    {followError && <p role="alert" className="mt-4 rounded-card border border-rose-300/15 bg-rose-300/5 p-3 text-sm text-rose-200">{t("Could not update this follow. Your previous choice is unchanged.")}</p>}
    {profile.relationship.followsViewer && !profile.relationship.isSelf && <p className="mt-3 text-sm text-violet-100">{t("Follows you")}</p>}
    <Reveal className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {([["Followers", profile.counts.followers], ["Following", profile.counts.following], ["Saved tracks", profile.counts.favorites], ["Public playlists", profile.counts.publicPlaylists]] as const).map(([label, count]) => <div key={label} className="surface p-4"><p className="text-2xl font-semibold tabular-nums">{number(count)}</p><p className="t-meta mt-1">{t(label)}</p></div>)}
    </Reveal>
    <Reveal className="mt-6">
      <h2 className="t-h2 mb-4">{t("Public playlists")}</h2>
      {profile.publicPlaylists.length ? <div className="grid gap-3 sm:grid-cols-2">{profile.publicPlaylists.map((playlist) => <article key={playlist.id} className="surface flex min-w-0 items-center gap-3 p-4"><span className="grid h-12 w-12 shrink-0 place-items-center rounded-tile bg-violet-300/10 text-violet-100"><Disc3 size={24} /></span><div className="min-w-0"><h3 className="t-row break-words">{playlist.title}</h3><p className="t-meta mt-1 break-words">{playlist.description || t("No description")}</p></div></article>)}</div>
        : <StateBlock icon={Disc3} tone="neutral" title={t("No public playlists yet.")} />}
    </Reveal>
    <Reveal className="mt-6">
      <h2 className="t-h2 mb-4">{t("Listening highlights")}</h2>
      {!profile.historyVisible ? <StateBlock icon={LockKeyhole} tone="neutral" title={t("Listening history is hidden.")} body={t("The owner chose not to share listening activity.")} />
        : profile.topArtists.length ? <div className="surface p-5">{profile.minutes90 !== null && <p className="t-meta mb-4">{number(Math.round(profile.minutes90))} {t("minutes listened in the last 90 days")}</p>}<ul className="space-y-3">{profile.topArtists.slice(0, 5).map((artist) => <li key={artist.name} className="flex min-w-0 items-center gap-3"><Music2 size={18} className="shrink-0 text-violet-100" /><span className="min-w-0 break-words">{artist.name}</span></li>)}</ul></div>
        : <StateBlock icon={Heart} tone="neutral" title={t("No listening highlights yet.")} />}
    </Reveal>
  </main>;
}
