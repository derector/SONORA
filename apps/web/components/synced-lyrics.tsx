"use client";

import { useEffect, useRef, useState } from "react";

type Line = { timeMs: number; text: string };
type LyricsState =
  | { status: "loading" | "unavailable" | "error" }
  | { status: "available"; lines: Line[]; rightsHolder: string };

export function SyncedLyrics({ trackId, positionMs, onSeek }: {
  trackId: string;
  positionMs: number;
  onSeek: (timeMs: number) => void;
}) {
  const [state, setState] = useState<{ id: string; data: LyricsState }>();
  const [attempt, setAttempt] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const active = useRef<HTMLButtonElement>(null);
  const data: LyricsState = state?.id === trackId ? state.data : { status: "loading" };

  useEffect(() => {
    const request = new AbortController();
    const origin = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");
    const timer = window.setTimeout(() => {
      request.abort();
      setState({ id: trackId, data: { status: "error" } });
    }, 8000);
    fetch(`${origin}/api/v1/lyrics?${new URLSearchParams({ id: trackId })}`, { signal: request.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Lyrics unavailable");
        const payload = await response.json() as LyricsState;
        if (!request.signal.aborted) setState({ id: trackId, data: payload });
      })
      .catch(() => {
        if (!request.signal.aborted) setState({ id: trackId, data: { status: "error" } });
      })
      .finally(() => window.clearTimeout(timer));
    return () => { window.clearTimeout(timer); request.abort(); };
  }, [trackId, attempt]);

  let activeIndex = -1;
  if (data.status === "available") {
    for (let i = 0; i < data.lines.length && data.lines[i].timeMs <= positionMs; i++) activeIndex = i;
  }

  useEffect(() => {
    if (list.current && active.current) {
      const container = list.current;
      const line = active.current;
      container.scrollTop = line.offsetTop - container.clientHeight / 2 + line.offsetHeight / 2;
    }
  }, [activeIndex, trackId]);

  return (
    <section aria-label="Текст песни" className="mx-auto mt-4 w-full max-w-xl rounded-2xl border border-white/15 p-4">
      {data.status === "loading" && <p role="status">Загружаю текст…</p>}
      {data.status === "unavailable" && <p>Для этой записи нет лицензированного текста.</p>}
      {data.status === "error" && (
        <div role="status">
          <p>Не удалось загрузить текст.</p>
          <button type="button" className="btn-ghost mt-2" onClick={() => { setState(undefined); setAttempt((value) => value + 1); }}>Повторить</button>
        </div>
      )}
      {data.status === "available" && (
        <>
          <div className="relative max-h-72 space-y-2 overflow-y-auto overscroll-contain" ref={list}>
            {data.lines.map((line, index) => (
              <button type="button" key={`${line.timeMs}-${index}`} ref={index === activeIndex ? active : undefined}
                aria-current={index === activeIndex ? "true" : undefined}
                onClick={() => onSeek(line.timeMs)}
                className={`block w-full break-words rounded-xl px-3 py-2 text-left font-semibold ${index === activeIndex ? "bg-violet-300/15 text-white" : "text-slate-300 hover:bg-white/10"}`}>
                {line.text}
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs text-slate-300">{data.rightsHolder}</p>
        </>
      )}
    </section>
  );
}
