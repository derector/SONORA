"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, LoaderCircle, MessageSquareText, Send, Sparkles } from "lucide-react";
import { useAuth } from "../../components/auth-provider";
import { useLanguage } from "../../components/language-provider";
import { usePlayer, type PlayerTrack } from "../../components/player-provider";
import { TrackRow } from "../../components/ui/track-row";
import { ErrorBlock, RowsSkeleton } from "../../components/ui/states";

// The assistant answers with a reply, the intent it detected, playable tracks
// from the unified catalog and, occasionally, a playlist it created.
type AssistantTrack = Partial<PlayerTrack> & { id: string; title: string; artist: string };
type AssistantResponse = {
  reply?: string;
  intent?: string;
  tracks?: AssistantTrack[];
  playlist?: { id: string; title?: string } | null;
  error?: string;
};
type Message = {
  id: string;
  role: "user" | "assistant" | "error";
  text: string;
  tracks?: PlayerTrack[];
  playlistId?: string;
  /** The query a failed answer was for, so the retry can resend it verbatim. */
  query?: string;
};

const API = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");
const SUGGESTIONS = ["Make something for late-night focus", "Find calm piano", "Something upbeat for the drive"];

export default function AssistantPage() {
  const { t } = useLanguage();
  const { accessToken, isAuthenticated } = useAuth();
  const { currentTrack, isPlaying, playTrack, togglePlay } = usePlayer();
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = listRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, sending]);

  // Sends an explicit question so suggestion chips and error retries can
  // reuse the same path without going through the input draft.
  async function sendText(text: string) {
    if (!text || sending) return;
    const createdAt = Date.now();
    setMessages((items) => [
      ...items,
      { id: `user-${createdAt}`, role: "user", text },
      { id: `pending-${createdAt}`, role: "assistant", text: "" }
    ]);
    setSending(true);
    try {
      const response = await fetch(`${API}/api/v1/assistant`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
        },
        body: JSON.stringify({ message: text })
      });
      const result = await response.json().catch(() => ({})) as AssistantResponse;
      const tracks: PlayerTrack[] = (result.tracks ?? []).filter((item) => item.audioUrl).map((item) => ({
        id: item.id,
        title: item.title,
        artist: item.artist,
        album: item.album ?? null,
        durationSeconds: item.durationSeconds ?? 0,
        artworkUrl: item.artworkUrl ?? null,
        audioUrl: item.audioUrl ?? "",
        licenseUrl: item.licenseUrl ?? "",
        sourceUrl: item.sourceUrl ?? ""
      }));
      if (!response.ok) {
        setMessages((items) => items.map((item) => item.id === `pending-${createdAt}`
          ? { ...item, id: `error-${createdAt}`, role: "error", query: text, text: result.error || t("The assistant could not answer right now. Try again in a moment.") }
          : item));
      } else {
        setMessages((items) => items.map((item) => item.id === `pending-${createdAt}`
          ? {
            ...item,
            text: result.reply || t("No results this time. Try asking for a mood instead."),
            tracks: tracks.length ? tracks : undefined,
            playlistId: result.playlist?.id
          }
          : item));
      }
    } catch {
      setMessages((items) => items.map((item) => item.id === `pending-${createdAt}`
        ? { ...item, id: `error-${createdAt}`, role: "error", query: text, text: t("Connection failed. The assistant could not be reached.") }
        : item));
    } finally {
      setSending(false);
    }
  }

  function send(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    void sendText(text);
  }

  function playFromAnswer(message: Message, track: PlayerTrack) {
    if (currentTrack?.id === track.id) { togglePlay(); return; }
    playTrack(track, message.tracks ?? [track]);
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col px-4 py-6 pb-40 md:px-8">
      <section className="panel-hero mt-8 p-7 md:p-9">
        <p className="t-eyebrow flex items-center gap-2 !text-violet-200"><Sparkles size={14}/> {t("Ask SONORA")}</p>
        <h1 className="t-h2 mt-4 md:text-4xl">{t("What should we play?")}</h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-slate-300">{t("Describe a mood, an activity or an artist you like. Answers come with playable tracks from the licensed catalog.")}</p>
        {!isAuthenticated && <p className="mt-4 text-xs text-muted">{t("Signed-in conversations can build playlists. Guest answers stay limited to the public catalog.")} <Link href="/auth" className="text-violet-200 hover:text-white">{t("Sign in")}</Link></p>}
      </section>

      <div ref={listRef} className="mt-6 min-h-64 flex-1 space-y-3 overflow-y-auto pr-1" aria-live="polite">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-start gap-3 rounded-3xl border border-dashed border-white/10 p-6">
            <MessageSquareText size={20} className="text-slate-500"/>
            <p className="text-sm text-slate-400">{t("Start with one of these:")}</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((suggestion) => (
                <button key={suggestion} type="button" onClick={() => setDraft(suggestion)} className="chip btn-press">{t(suggestion)}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map((message) => message.role === "user" ? (
          <div key={message.id} className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-violet-200/90 px-4 py-3 text-sm text-[#171323]">{message.text}</div>
        ) : message.role === "error" ? (
          <div key={message.id} role="alert" className="mr-auto w-full max-w-[92%]">
            <ErrorBlock title={message.text} onRetry={message.query ? () => void sendText(message.query as string) : undefined} retryLabel={t("Try again")}/>
          </div>
        ) : (
          <div key={message.id} className="mr-auto max-w-[92%] space-y-3">
            {message.text ? (
              <div className="rounded-2xl rounded-bl-md border border-white/[0.08] bg-white/[0.035] px-4 py-3 text-sm leading-6 text-slate-200">{message.text}</div>
            ) : (
              <div aria-hidden className="space-y-3">
                <div className="skeleton h-12 w-2/3 rounded-card"/>
                <div className="rounded-card border border-white/[0.08] bg-surface p-1"><RowsSkeleton count={3}/></div>
              </div>
            )}
            {message.tracks?.length ? (
              <div className="rounded-card border border-white/[0.08] bg-surface p-1">
                {message.tracks.map((track) => (
                  <TrackRow key={`${message.id}-${track.id}`} track={track}
                    onPlay={() => playFromAnswer(message, track)}
                    isCurrent={currentTrack?.id === track.id} isPlaying={isPlaying && currentTrack?.id === track.id}
                    disabled={!track.audioUrl}/>
                ))}
              </div>
            ) : null}
            {message.playlistId ? (
              <Link href={`/playlists/${message.playlistId}`} className="inline-flex items-center gap-2 rounded-pill border border-violet-200/25 bg-violet-200/10 px-4 py-2 text-xs text-violet-100 transition hover:bg-violet-200/20">
                {t("Open the playlist")} <ArrowUpRight size={13}/>
              </Link>
            ) : null}
          </div>
        ))}
      </div>

      <form onSubmit={send} className="sticky bottom-24 mt-5 flex items-center gap-2 rounded-2xl border border-white/10 bg-[#11121d]/95 p-2 backdrop-blur-xl md:bottom-6">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={400}
          placeholder={t("Describe a mood, an artist or a plan for the evening")}
          aria-label={t("Message")}
          className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-slate-500"
        />
        <button type="submit" disabled={sending || draft.trim().length === 0} className="btn-press grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-200 text-[#171323] transition hover:bg-white disabled:opacity-40" aria-label={t("Send")}>
          {sending ? <LoaderCircle size={17} className="animate-spin"/> : <Send size={17}/>}
        </button>
      </form>
    </main>
  );
}
