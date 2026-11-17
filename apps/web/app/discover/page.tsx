"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, AudioLines, ExternalLink, LoaderCircle, Music2, Search, ShieldCheck } from "lucide-react";

type Track = {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  durationSeconds: number;
  artworkUrl: string | null;
  audioUrl: string;
  licenseUrl: string;
  sourceUrl: string;
  provider: string;
};

type Result = { items?: Track[]; error?: string };

const API = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");

function duration(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export default function DiscoverPage() {
  const [query, setQuery] = useState("");
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTrack, setActiveTrack] = useState<string | null>(null);

  async function loadTracks(search = "") {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ limit: "24" });
      if (search.trim()) params.set("q", search.trim());
      const response = await fetch(`${API}/api/v1/providers/jamendo/tracks?${params.toString()}`);
      const result = await response.json() as Result;
      if (!response.ok) throw new Error(result.error || "The catalog could not be loaded.");
      setTracks(result.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The catalog could not be loaded.");
      setTracks([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadTracks(); }, []);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadTracks(query);
  }

  return (
    <main className="mx-auto min-h-screen max-w-[1440px] px-4 py-6 md:px-8">
      <header className="flex items-center justify-between">
        <Link href="/" className="inline-flex items-center gap-3 text-sm text-slate-400 transition hover:text-white"><ArrowLeft size={17}/> Back to SONORA</Link>
        <div className="flex items-center gap-2 text-sm font-semibold tracking-[.2em]"><AudioLines className="text-violet-300"/> SONORA</div>
      </header>

      <section className="mt-10 rounded-[2rem] border border-violet-300/15 bg-gradient-to-br from-[#292044] via-[#171426] to-[#10131c] p-7 md:p-10">
        <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.25em] text-violet-200"><Music2 size={14}/> Discover independent music</p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight md:text-5xl">Find your next frequency.</h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-slate-300">Explore independent tracks from Jamendo. Every playable result includes its creator, source and Creative Commons license.</p>
        <form onSubmit={submitSearch} className="mt-7 flex max-w-2xl gap-2 rounded-2xl border border-white/10 bg-black/25 p-2">
          <Search className="ml-2 mt-2.5 shrink-0 text-slate-400" size={18}/>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search tracks, artists or moods" className="min-w-0 flex-1 bg-transparent px-2 py-2 text-sm outline-none placeholder:text-slate-500"/>
          <button disabled={loading} className="rounded-xl bg-violet-200 px-5 py-2 text-sm font-semibold text-[#171323] transition hover:bg-white disabled:opacity-50">Search</button>
        </form>
      </section>

      <div className="mt-9 flex items-end justify-between gap-4">
        <div><p className="text-[10px] font-semibold uppercase tracking-[.25em] text-violet-300">Open catalog</p><h2 className="mt-2 text-2xl font-semibold">Tracks to explore</h2></div>
        <span className="text-xs text-slate-500">Powered by Jamendo</span>
      </div>

      {loading ? (
        <div className="flex min-h-48 items-center justify-center gap-3 text-sm text-slate-400"><LoaderCircle className="animate-spin" size={18}/> Loading the catalog…</div>
      ) : error ? (
        <div className="mt-6 rounded-2xl border border-amber-300/15 bg-amber-300/5 p-6">
          <p className="font-medium text-amber-100">Catalog connection is not ready.</p>
          <p className="mt-2 text-sm leading-6 text-slate-400">{error}</p>
          <p className="mt-3 text-xs text-slate-500">The provider API key must be configured server-side. No demo tracks are substituted.</p>
        </div>
      ) : tracks.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.025] p-8 text-center text-sm text-slate-400">No tracks found. Try another search.</div>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {tracks.map((track) => (
            <article key={track.id} className="overflow-hidden rounded-3xl border border-white/[0.08] bg-white/[0.025] p-3">
              <div className="flex gap-4">
                {track.artworkUrl ? <img src={track.artworkUrl} alt="" className="h-20 w-20 rounded-2xl object-cover" loading="lazy"/> : <div className="grid h-20 w-20 place-items-center rounded-2xl bg-gradient-to-br from-violet-500/30 to-sky-500/20"><Music2 className="text-violet-100" size={28}/></div>}
                <div className="min-w-0 flex-1 py-1">
                  <h3 className="truncate font-medium">{track.title}</h3>
                  <p className="mt-1 truncate text-sm text-slate-400">{track.artist}</p>
                  <p className="mt-2 text-xs text-slate-500">{track.album || "Independent release"} · {duration(track.durationSeconds)}</p>
                </div>
              </div>
              <audio controls preload="none" src={track.audioUrl} onPlay={() => setActiveTrack(track.id)} onPause={() => setActiveTrack((current) => current === track.id ? null : current)} className="mt-4 h-10 w-full" aria-label={`Play ${track.title} by ${track.artist}`}/>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.07] pt-3 text-[11px]">
                <span className="inline-flex items-center gap-1 text-emerald-200"><ShieldCheck size={13}/> CC license</span>
                <div className="flex items-center gap-3 text-slate-400">
                  <a href={track.licenseUrl} target="_blank" rel="noreferrer" className="hover:text-white">License</a>
                  <a href={track.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-white">Jamendo <ExternalLink size={11}/></a>
                </div>
              </div>
              <p className="mt-2 text-[10px] leading-4 text-slate-600">Artist: {track.artist} · Source: Jamendo · License terms apply.</p>
            </article>
          ))}
        </div>
      )}

      <footer className="mt-14 border-t border-white/[0.07] py-6 text-xs text-slate-600">SONORA · Independent music discovery · Rights and attribution stay attached to every track</footer>
    </main>
  );
}
