"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Search, UserRound, UsersRound } from "lucide-react";
import { useAuth } from "./auth-provider";
import { useLanguage } from "./language-provider";
import { useProfileResource } from "./profile-data";
import { ProfileUnavailable } from "./profile-library";
import { profileRequest } from "../lib/profile";
import { RowsSkeleton, StateBlock } from "./ui/states";
import { Reveal } from "./ui/reveal";

type Person = { id: string; username: string; displayName: string; avatarUrl: string | null };
type PeoplePage = { items: Person[]; limit: number; offset: number; nextOffset: number | null; hasMore?: boolean };

function People({ items }: { items: Person[] }) {
  return <Reveal stagger="x" className="space-y-2">{items.map((person) => <Link key={person.id} href={`/u/${encodeURIComponent(person.username)}`} className="card-lift surface flex min-w-0 items-center gap-3 p-4">
    {person.avatarUrl ? <img src={person.avatarUrl} alt="" className="h-11 w-11 shrink-0 rounded-full object-cover" /> : <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-violet-300/10 text-violet-100"><UserRound size={20} /></span>}
    <div className="min-w-0"><p className="t-row break-words">{person.displayName || person.username}</p><p className="t-meta mt-1 break-words">@{person.username}</p></div>
  </Link>)}</Reveal>;
}

function ConnectionList({ username, direction }: { username: string; direction: "followers" | "following" }) {
  const { t } = useLanguage();
  const { accessToken } = useAuth();
  const endpoint = `/users/${encodeURIComponent(username)}/${direction}`;
  const resource = useProfileResource<PeoplePage>(endpoint);
  const moreRequest = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [moreError, setMoreError] = useState(false);
  useEffect(() => () => moreRequest.current?.abort(), []);
  async function more() {
    const current = resource.data;
    if (!current || busy || current.nextOffset === null) return;
    const controller = new AbortController();
    moreRequest.current?.abort(); moreRequest.current = controller;
    setBusy(true); setMoreError(false);
    try {
      const next = await profileRequest<PeoplePage>(`${endpoint}?offset=${current.nextOffset}`, accessToken, { signal: controller.signal });
      if (!controller.signal.aborted) resource.setData((previous) => previous ? {
        ...next, items: [...new Map([...previous.items, ...next.items].map((person) => [person.id, person])).values()]
      } : next);
    } catch { if (!controller.signal.aborted) setMoreError(true); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  if (resource.loading) return <RowsSkeleton count={4} />;
  if (resource.error || !resource.data) return <ProfileUnavailable onRetry={resource.retry} />;
  const data = resource.data;
  const hasMore = data.hasMore ?? (data.items.length === data.limit && data.nextOffset !== null);
  return <div className="space-y-4">{data.items.length ? <People items={data.items} /> : <StateBlock icon={UsersRound} tone="neutral" title={t("No public accounts in this list yet.")} body={t("Private profiles are not shown. You can find public people below.")} />}
    {moreError && <p role="alert" className="text-sm text-rose-200">{t("Could not load the next page. The current list is unchanged.")}</p>}
    {hasMore && <button type="button" className="btn-ghost" disabled={busy} onClick={() => void more()}>{t(busy ? "Loading…" : "Load more people")}</button>}
  </div>;
}

function PeopleSearch() {
  const { t } = useLanguage();
  const { accessToken } = useAuth();
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Person[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const term = query.trim();
  useEffect(() => {
    const controller = new AbortController();
    setItems([]); setError(false);
    if (term.length < 2) { setLoading(false); return () => controller.abort(); }
    setLoading(true);
    const timer = window.setTimeout(() => {
      profileRequest<{ items: Person[] }>(`/users?q=${encodeURIComponent(term)}&limit=20`, accessToken, { signal: controller.signal })
        .then((result) => { if (!controller.signal.aborted) setItems(result.items); })
        .catch(() => { if (!controller.signal.aborted) setError(true); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 300);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [term, accessToken, retry]);
  return <section className="mt-8 space-y-4"><h3 className="t-h2">{t("Find people")}</h3><label className="relative block"><Search size={18} className="absolute left-3 top-3.5 text-muted" aria-hidden /><input type="search" className="field w-full !pl-10" maxLength={48} value={query} onChange={(event) => setQuery(event.target.value)} aria-label={t("Search people by name or username")} placeholder={t("Search people by name or username")} /></label>
    {term.length < 2 ? <p className="t-meta">{t("Enter at least two characters. Only public profiles are searched.")}</p> : loading ? <RowsSkeleton count={3} /> : error ? <ProfileUnavailable onRetry={() => setRetry((value) => value + 1)} /> : items.length ? <People items={items} /> : <StateBlock icon={Search} tone="neutral" title={t("No public people found.")} />}
  </section>;
}

export function FriendsPane({ username }: { username: string }) {
  const { t } = useLanguage();
  const [direction, setDirection] = useState<"followers" | "following">("following");
  return <div><h2 className="t-h2">{t("Your music connections")}</h2><p className="t-meta mt-2">{t("These are follows between SONORA accounts, not artist subscriptions or a mutual-friend count.")}</p>
    <div role="group" aria-label={t("Connection lists")} className="my-5 flex flex-wrap gap-2">{(["following", "followers"] as const).map((value) => <button type="button" key={value} className="chip" aria-pressed={direction === value} onClick={() => setDirection(value)}>{t(value === "following" ? "Following" : "Followers")}</button>)}</div>
    <ConnectionList key={`${username}:${direction}`} username={username} direction={direction} />
    <PeopleSearch />
  </div>;
}
