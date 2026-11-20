"use client";

import Link from "next/link";
import { Activity, Clock3, Heart, Music2, Sparkles } from "lucide-react";
import { useLanguage } from "./language-provider";
import { useProfileResource, type Stats, type Taste } from "./profile-data";
import { ProfileUnavailable } from "./profile-library";
import { RowsSkeleton, StateBlock } from "./ui/states";
import { Reveal } from "./ui/reveal";

function Metrics({ stats }: { stats: Stats }) {
  const { t, language } = useLanguage();
  const number = (n: number) => new Intl.NumberFormat(language === "ru" ? "ru-RU" : "en-US", { maximumFractionDigits: 1 }).format(n);
  return <Reveal className="grid grid-cols-2 gap-3 lg:grid-cols-4">
    {([ ["Last 7 days · minutes", stats.minutes.week], ["This month · minutes", stats.minutes.month], ["Saved tracks", stats.counts.favorites + stats.counts.catalogFavorites], ["Activity streak · days", stats.streakDays] ] as const).map(([label, value]) => <div className="surface min-w-0 p-4" key={label}><p className="text-2xl font-semibold tabular-nums">{number(value)}</p><p className="t-meta mt-2">{t(label)}</p></div>)}
  </Reveal>;
}

function Bars({ entries, unit }: { entries: { name: string; value: number }[]; unit: string }) {
  const { t, language } = useLanguage();
  const maximum = Math.max(1, ...entries.map((item) => item.value));
  const number = (n: number) => new Intl.NumberFormat(language === "ru" ? "ru-RU" : "en-US", { maximumFractionDigits: 1 }).format(n);
  return <ul className="space-y-4">{entries.map((item) => <li key={item.name} className="min-w-0"><div className="mb-2 flex min-w-0 items-start justify-between gap-3 text-sm"><span className="min-w-0 break-words">{item.name}</span><span className="shrink-0 text-xs text-muted">{number(item.value)} {t(unit)}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-white/5" aria-hidden><div className="h-full rounded-full bg-gradient-to-r from-violet-400 to-teal-300 transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${Math.max(0, item.value) / maximum * 100}%` }} /></div></li>)}</ul>;
}

function ArtistStats({ stats }: { stats: Stats }) {
  const { t } = useLanguage();
  return <section className="surface p-5"><h3 className="t-h2 mb-5">{t("Top artists in your history")}</h3>{stats.topArtists.length ? <Bars entries={stats.topArtists.map((artist) => ({ name: artist.name, value: artist.minutes }))} unit="min" /> : <p className="t-meta">{t("No listening highlights yet.")}</p>}</section>;
}

export function OverviewPane({ onOpen }: { onOpen: (tab: "favorites" | "playlists" | "history" | "taste" | "stats" | "friends") => void }) {
  const { t } = useLanguage();
  const resource = useProfileResource<Stats>("/profile/stats");
  if (resource.loading) return <RowsSkeleton count={4} />;
  if (resource.error || !resource.data) return <ProfileUnavailable onRetry={resource.retry} />;
  const stats = resource.data;
  return <div className="space-y-5"><h2 className="t-h2">{t("Your music at a glance")}</h2><Metrics stats={stats} />
    <div className="flex flex-wrap gap-2">{([ ["favorites", "Saved tracks", Heart], ["history", "Listening history", Clock3], ["taste", "Music taste", Sparkles], ["stats", "Statistics", Activity] ] as const).map(([tab, label, Icon]) => <button type="button" key={tab} className="btn-ghost" onClick={() => onOpen(tab)}><Icon size={16} />{t(label)}</button>)}</div>
    {!stats.counts.events && <StateBlock icon={Music2} title={t("Your listening story starts here.")} body={t("Play music and return to see real listening activity. No sample statistics are inserted.")} actionHref="/discover" actionLabel={t("Explore music")} />}
    <ArtistStats stats={stats} />
    <p className="t-meta">{t("Available listening history · days")}: {stats.windowDays}</p>
  </div>;
}

export function StatisticsPane() {
  const { t, language } = useLanguage();
  const resource = useProfileResource<Stats>("/profile/stats");
  if (resource.loading) return <RowsSkeleton />;
  if (resource.error || !resource.data) return <ProfileUnavailable onRetry={resource.retry} />;
  const stats = resource.data;
  const monthName = (key: string) => new Intl.DateTimeFormat(language === "ru" ? "ru-RU" : "en-US", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${key}-01T12:00:00Z`));
  return <div className="space-y-5"><h2 className="t-h2">{t("Listening statistics")}</h2><Metrics stats={stats} />
    <div className="surface flex flex-wrap gap-x-8 gap-y-3 p-5 text-sm"><span>{t("Recorded events")}: {stats.counts.events}</span><span>{t("Artists")}: {stats.counts.artists}</span><span>{t("Playlists")}: {stats.counts.playlists}</span><span>{t("Minutes in the available history")}: {stats.minutes.total}</span></div>
    <Reveal className="grid gap-4 lg:grid-cols-2"><ArtistStats stats={stats} /><section className="surface p-5"><h3 className="t-h2 mb-5">{t("Listening by month")}</h3>{stats.monthly.length ? <Bars entries={stats.monthly.map((item) => ({ name: monthName(item.month), value: item.minutes }))} unit="min" /> : <p className="t-meta">{t("No listening highlights yet.")}</p>}</section></Reveal>
    <p className="t-meta">{t("Available listening history · days")}: {stats.windowDays}. {t("Statistics cover the returned history, not your lifetime listening.")}</p>
    {stats.historyMayBeTruncated && <p role="status" className="t-meta">{t("Some older events may be outside the response limit.")}</p>}
  </div>;
}

export function TastePane() {
  const { t } = useLanguage();
  const resource = useProfileResource<Taste>("/profile/taste");
  if (resource.loading) return <RowsSkeleton />;
  if (resource.error || !resource.data) return <ProfileUnavailable onRetry={resource.retry} />;
  const taste = resource.data;
  const bands = { fast: "Fast", moderate: "Moderate", "mid-tempo": "Mid-tempo", slow: "Slow" };
  const affinities = taste.artistAffinity.filter((item) => item.weight > 0);
  return <div className="space-y-5"><h2 className="t-h2">{t("Your music taste")}</h2>
    <section className="surface p-5"><h3 className="t-h2 mb-4">{t("Favorite genres")}</h3>
      {taste.genres.source === "listening" && taste.genres.measured.length ? <Bars entries={taste.genres.measured.map((genre) => ({ name: genre.name, value: genre.events }))} unit="events" /> : taste.genres.declared.length ? <div className="flex flex-wrap gap-2">{taste.genres.declared.map((genre) => <span className="rounded-pill bg-violet-300/10 px-3 py-2 text-sm" key={genre}>{genre}</span>)}</div> : <p className="t-meta">{t("No genre signals yet. Add genres in Edit profile or build your listening history.")}</p>}
      <p className="t-meta mt-4">{t(taste.genres.source === "listening" ? "Based on available listening tags." : "These are your declared genres, not an analysis of audio.")}</p>
    </section>
    <Reveal className="grid gap-4 sm:grid-cols-2"><section className="surface p-5"><h3 className="text-sm font-medium">{t("Energy from music metadata")}</h3><p className="mt-3 text-2xl font-semibold">{taste.energy === null ? t("Not available") : `${Math.round(Math.min(1, Math.max(0, taste.energy)) * 100)}%`}</p><p className="t-meta mt-3">{t("A metadata estimate, not a measured audio characteristic.")}</p></section>
      <section className="surface p-5"><h3 className="text-sm font-medium">{t("Tempo mood")}</h3><p className="mt-3 text-2xl font-semibold">{taste.tempoBand ? t(bands[taste.tempoBand]) : t("Not available")}</p><p className="t-meta mt-3">{t("No BPM is reported because it is not supplied by the catalog.")}</p></section></Reveal>
    {taste.moodError && <p role="status" className="t-meta">{t("Mood metadata is unavailable or your history is too small.")}</p>}
    <section className="surface p-5"><h3 className="t-h2 mb-5">{t("Positive artist signals")}</h3>{affinities.length ? <Bars entries={affinities.map((item) => ({ name: item.artist, value: item.weight }))} unit="signal weight" /> : <p className="t-meta">{t("No positive artist signals yet.")}</p>}</section>
    <Link href="/assistant" className="btn-ghost"><Sparkles size={16} />{t("Open music assistant")}</Link>
  </div>;
}
