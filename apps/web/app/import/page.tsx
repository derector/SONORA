"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, AudioLines, Check, ExternalLink, FileUp, LoaderCircle, Music2, Search, ShieldCheck } from "lucide-react";
import { useLanguage } from "../../components/language-provider";

type Track = {
  id: string; title: string; artist: string; album: string | null; durationSeconds: number;
  artworkUrl: string | null; audioUrl: string; licenseUrl: string; sourceUrl: string; provider: string;
};
type Candidate = Track;
type ImportRow = { key: string; title: string; artist: string; candidates: Candidate[]; selectedId: string; imported: boolean; error?: string };
type ApiResult = { items?: Track[]; error?: string; session?: { access_token?: string } };
const API = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"' && line[i + 1] === '"' && quoted) { current += '"'; i++; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { values.push(current.trim()); current = ""; }
    else current += char;
  }
  values.push(current.trim());
  return values;
}
function parseRows(raw: string): { title: string; artist: string }[] {
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return [];
  const header = parseCsvLine(lines[0]).map((v) => v.toLowerCase().replace(/[^a-z]/g, ""));
  const titleIndex = header.findIndex((v) => ["trackname", "track", "title", "song", "songname"].includes(v));
  const artistIndex = header.findIndex((v) => ["artistname", "artist", "artists", "performer"].includes(v));
  const albumIndex = header.findIndex((v) => ["album", "albumname"].includes(v));
  if (titleIndex >= 0) {
    return lines.slice(1).map((line) => {
      const cells = parseCsvLine(line);
      const title = cells[titleIndex] || "";
      const artist = artistIndex >= 0 ? cells[artistIndex] || "" : "";
      return { title: title.trim(), artist: artist.trim() };
    }).filter((row) => row.title);
  }
  return lines.map((line) => {
    const cleaned = line.replace(/https?:\/\/\S+/gi, "").replace(/^[-*•\s]+/, "").trim();
    const split = cleaned.split(/\s+[–—-]\s+/, 2);
    if (split.length === 2) return { artist: split[0].trim(), title: split[1].trim() };
    return { artist: "", title: cleaned };
  }).filter((row) => row.title && !/^https?:/i.test(row.title));
}

export default function ImportPage() {
  const { t } = useLanguage();
  const [source, setSource] = useState("Spotify");
  const [raw, setRaw] = useState("");
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [matching, setMatching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const parsed = useMemo(() => parseRows(raw), [raw]);

  useEffect(() => {
    let active = true;
    fetch(`${API}/api/v1/auth/refresh`, { method: "POST", credentials: "include" })
      .then(async (response) => response.ok ? response.json() as Promise<ApiResult> : null)
      .then((result) => { if (active) setToken(result?.session?.access_token ?? ""); })
      .catch(() => undefined)
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function findMatches() {
    if (!token) return;
    setError(""); setNotice("");
    if (!parsed.length) { setError(t("Paste a playlist CSV or track list first.")); return; }
    if (parsed.length > 100) { setError(t("Import is limited to 100 tracks per batch.")); return; }
    setMatching(true);
    try {
      const matched = await Promise.all(parsed.map(async (item, index): Promise<ImportRow> => {
        const q = [item.title, item.artist].filter(Boolean).join(" ");
        try {
          const response = await fetch(`${API}/api/v1/providers/jamendo/tracks?${new URLSearchParams({ q, limit: "5" })}`);
          const result = await response.json() as ApiResult;
          if (!response.ok) throw new Error(result.error || t("Search failed."));
          const candidates = result.items ?? [];
          return { key: `${index}-${item.title}`, title: item.title, artist: item.artist, candidates, selectedId: candidates[0]?.id ?? "", imported: false, error: candidates.length ? undefined : t("No licensed match found.") };
        } catch (err) {
          return { key: `${index}-${item.title}`, title: item.title, artist: item.artist, candidates: [], selectedId: "", imported: false, error: err instanceof Error ? err.message : t("Search failed.") };
        }
      }));
      setRows(matched);
      const found = matched.filter((row) => row.candidates.length).length;
      setNotice(t("Matching complete:") + ` ${found}/${matched.length} ` + t("tracks found."));
    } finally {
      setMatching(false);
    }
  }

  async function importSelected() {
    if (!token) return;
    const selected = rows.filter((row) => row.selectedId && !row.imported);
    if (!selected.length) { setError(t("Select at least one matched track.")); return; }
    setSaving(true); setError(""); setNotice("");
    let success = 0;
    const next = [...rows];
    for (const row of selected) {
      try {
        const response = await fetch(`${API}/api/v1/provider-favorites`, {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ providerTrackId: row.selectedId })
        });
        const result = await response.json() as ApiResult;
        if (!response.ok) throw new Error(result.error || t("Could not save this track."));
        const index = next.findIndex((item) => item.key === row.key);
        if (index >= 0) next[index] = { ...next[index], imported: true };
        success++;
      } catch (err) {
        const index = next.findIndex((item) => item.key === row.key);
        if (index >= 0) next[index] = { ...next[index], error: err instanceof Error ? err.message : t("Import failed.") };
      }
    }
    setRows(next);
    setNotice(t("Added to your SONORA library:") + ` ${success}/${selected.length}`);
    setSaving(false);
  }

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-4 py-6 pb-36 md:px-8">
      <header className="flex items-center justify-between">
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white"><ArrowLeft size={17}/> SONORA</Link>
        <span className="flex items-center gap-2 text-sm font-semibold tracking-[.2em]"><FileUp className="text-violet-300"/> {t("IMPORT")}</span>
      </header>
      <section className="mt-10 rounded-[2rem] border border-violet-300/15 bg-gradient-to-br from-[#292044] via-[#171426] to-[#10131c] p-7 md:p-10">
        <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.25em] text-violet-200"><Music2 size={14}/> {t("Bring your music together")}</p>
        <h1 className="mt-4 text-3xl font-semibold md:text-5xl">{t("Import tracks from other platforms.")}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">{t("Bring in a playlist export or a list of tracks. SONORA will search its licensed catalog, show possible matches and let you save the tracks you choose.")}</p>
      </section>

      {loading ? <div className="flex min-h-40 items-center justify-center gap-3 text-sm text-slate-400"><LoaderCircle className="animate-spin" size={18}/>{t("Restoring your session…")}</div> : !token ? (
        <section className="mt-8 rounded-3xl border border-white/10 p-7">
          <h2 className="text-xl font-semibold">{t("Sign in to import music.")}</h2>
          <Link href="/auth" className="mt-5 inline-flex rounded-full bg-violet-200 px-5 py-3 text-sm font-semibold text-[#171323]">{t("Sign in or create account")}</Link>
        </section>
      ) : (
        <>
          <section className="mt-8 rounded-3xl border border-white/10 bg-white/[0.025] p-6 md:p-8">
            <label className="block text-xs font-medium text-slate-400">{t("Source platform")}
              <select value={source} onChange={(event) => setSource(event.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-[#11111b] px-4 py-3 text-sm text-white outline-none focus:border-violet-300/60">
                {["Spotify","Apple Music","YouTube Music","SoundCloud","Yandex Music","VK Music","Telegram","Other / CSV"].map((name) => <option key={name}>{name}</option>)}
              </select>
            </label>
            <label className="mt-5 block text-xs font-medium text-slate-400">{t("Playlist export or track list")}
              <textarea value={raw} onChange={(event) => setRaw(event.target.value)} rows={8} placeholder={t("Paste CSV rows or one track per line: Artist - Track title")} className="mt-2 w-full resize-y rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-600 focus:border-violet-300/60"/>
            </label>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-slate-500">{parsed.length} {t("tracks detected")} · {t("up to 100 per import")}</p>
              <button type="button" disabled={matching || !raw.trim()} onClick={() => void findMatches()} className="inline-flex items-center gap-2 rounded-full bg-violet-200 px-5 py-3 text-sm font-semibold text-[#171323] hover:bg-white disabled:opacity-50">{matching ? <LoaderCircle className="animate-spin" size={16}/> : <Search size={16}/>} {t("Find matches")}</button>
            </div>
          </section>

          {rows.length > 0 && <section className="mt-8">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.25em] text-violet-300">{t("Import review")}</p><h2 className="mt-2 text-2xl font-semibold">{t("Choose your matches")}</h2></div><button type="button" onClick={() => void importSelected()} disabled={saving || !rows.some((row) => row.selectedId && !row.imported)} className="inline-flex items-center gap-2 rounded-full bg-violet-200 px-5 py-3 text-sm font-semibold text-[#171323] disabled:opacity-50">{saving ? <LoaderCircle className="animate-spin" size={16}/> : <Check size={16}/>} {t("Import selected")}</button></div>
            <div className="space-y-3">
              {rows.map((row) => <article key={row.key} className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2"><div className="min-w-0"><h3 className="truncate text-sm font-medium">{row.title}</h3><p className="mt-1 text-xs text-slate-500">{row.artist || source}</p></div>{row.imported ? <span className="inline-flex items-center gap-1 text-xs text-emerald-200"><Check size={14}/>{t("Imported")}</span> : row.error && !row.candidates.length ? <span className="text-xs text-amber-200">{row.error}</span> : null}</div>
                {row.candidates.length > 0 && <div className="mt-3 grid gap-2">
                  {row.candidates.map((candidate) => <label key={candidate.id} className={"flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 " + (row.selectedId === candidate.id ? "border-violet-300/40 bg-violet-300/10" : "border-white/5 bg-black/10")}>
                    <input type="radio" name={row.key} checked={row.selectedId === candidate.id} disabled={row.imported} onChange={() => setRows((items) => items.map((item) => item.key === row.key ? { ...item, selectedId: candidate.id } : item))} className="accent-violet-300"/>
                    {candidate.artworkUrl ? <img src={candidate.artworkUrl} alt="" className="h-10 w-10 rounded-lg object-cover"/> : <div className="grid h-10 w-10 place-items-center rounded-lg bg-violet-300/10"><Music2 size={16}/></div>}
                    <span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium">{candidate.title}</span><span className="block truncate text-[11px] text-slate-500">{candidate.artist}</span></span>
                    <span className="inline-flex items-center gap-1 text-[10px] text-emerald-200"><ShieldCheck size={12}/> CC</span>
                    <a href={candidate.sourceUrl} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()} aria-label={t("Open source")} className="text-slate-500 hover:text-white"><ExternalLink size={14}/></a>
                  </label>)}
                </div>}
              </article>)}
            </div>
          </section>}
        </>
      )}
      <section className="mt-8 rounded-2xl border border-sky-300/10 bg-sky-300/[0.04] p-5">
        <h2 className="text-sm font-semibold">{t("How importing works")}</h2>
        <p className="mt-2 text-xs leading-5 text-slate-400">{t("Export a playlist as CSV from the source service, or paste lines in Artist - Track title format. Plain playlist URLs alone do not expose protected track metadata. SONORA imports matches from its own licensed Jamendo catalog; it does not download audio from Spotify, Apple Music or other services.")}</p>
      </section>
      {notice && <p className="mt-5 rounded-xl border border-emerald-300/15 bg-emerald-300/5 px-4 py-3 text-xs text-emerald-200">{notice}</p>}
      {error && <p role="alert" className="mt-5 rounded-xl border border-rose-300/15 bg-rose-300/5 px-4 py-3 text-xs text-rose-200">{error}</p>}
    </main>
  );
}
