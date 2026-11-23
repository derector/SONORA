"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, LoaderCircle, MessageSquareText, Send, Sparkles } from "lucide-react";
import { useAuth } from "../../components/auth-provider";
import { useLanguage } from "../../components/language-provider";
import { usePlayer, type PlayerTrack } from "../../components/player-provider";
import { playbackCommand } from "../../lib/assistant-commands";
import { VoiceInput } from "../../components/voice-input";
import { TrackRow } from "../../components/ui/track-row";
import { ErrorBlock, RowsSkeleton } from "../../components/ui/states";
import { useReveal } from "../../lib/motion";

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
const SUGGESTIONS = ["Мой микс по моим вкусам", "Микс для тренировки", "Подбери спокойную музыку", "Найди фортепиано"];

export default function AssistantPage() {
  const { t } = useLanguage();
  const { accessToken, isAuthenticated } = useAuth();
  const { currentTrack, isPlaying, playTrack, togglePlay, pausePlayback, resumePlayback } = usePlayer();
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);
  const [persona, setPersona] = useState("jarvis");
  const [voiceStatus, setVoiceStatus] = useState("");
  const voiceModeRef = useRef(voiceMode);
  voiceModeRef.current = voiceMode;
  const mountedRef = useRef(true);
  const requestRef = useRef<AbortController | null>(null);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; requestRef.current?.abort(); };
  }, []);
  const sendingRef = useRef(false);
  const voiceRequest = useRef<AbortController | null>(null);
  const voicePlayback = useRef<{ audio: HTMLAudioElement; url: string } | null>(null);
  const stopSpeech = useCallback(() => {
    voiceRequest.current?.abort();
    voiceRequest.current = null;
    const playback = voicePlayback.current;
    if (playback) {
      playback.audio.pause();
      URL.revokeObjectURL(playback.url);
      voicePlayback.current = null;
    }
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  }, []);
  useEffect(() => stopSpeech, [stopSpeech]);

  async function speak(text: string) {
    if (!mountedRef.current) return;
    stopSpeech();
    quietMusic();
    setVoiceStatus("");
    const controller = new AbortController();
    voiceRequest.current = controller;
    if (accessToken) {
      try {
        const response = await fetch(`${API}/api/v1/assistant/speech`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ text: text.slice(0, 900), persona }),
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(9000)])
        });
        if (!response.ok || !response.headers.get("content-type")?.startsWith("audio/")) throw new Error("Speech unavailable");
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        voicePlayback.current = { audio, url };
        audio.onended = () => {
          URL.revokeObjectURL(url);
          if (voicePlayback.current?.audio === audio) voicePlayback.current = null;
        };
        await audio.play();
        return;
      } catch {
        if (controller.signal.aborted) return;
        const playback = voicePlayback.current;
        if (playback) { playback.audio.pause(); URL.revokeObjectURL(playback.url); voicePlayback.current = null; }
      }
    }
    if (!("speechSynthesis" in window)) { setVoiceStatus("Озвучивание недоступно в этом браузере."); return; }
    const voices = window.speechSynthesis.getVoices().filter((voice) => /^ru(?:-|$)/i.test(voice.lang));
    const voice = voices.find((item) => /natural|neural|premium|enhanced/i.test(item.name))
      ?? voices.find((item) => !item.localService) ?? voices[0];
    if (!voice) { setVoiceStatus("Русский голос недоступен. Ответ можно прочитать в чате."); return; }
    const utterance = new SpeechSynthesisUtterance(text.replace(/\bSONORA\b/gi, "Сонора"));
    utterance.lang = "ru-RU";
    utterance.voice = voice;
    utterance.rate = 0.95;
    utterance.onerror = (event) => {
      if (!controller.signal.aborted && event.error !== "interrupted" && event.error !== "canceled")
        setVoiceStatus("Не удалось озвучить ответ. Он доступен в чате.");
    };
    window.speechSynthesis.speak(utterance);
    setVoiceStatus(accessToken ? "Облачный голос недоступен. Используется русский голос браузера." : "В гостевом режиме используется русский голос браузера.");
  }
  function quietMusic() { pausePlayback(); }
  const listRef = useRef<HTMLDivElement>(null);
  const emptyReveal = useReveal<HTMLDivElement>();

  useEffect(() => {
    const node = listRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, sending]);

  // Sends an explicit question so suggestion chips and error retries can
  // reuse the same path without going through the input draft.
  async function sendText(text: string) {
    if (!text.trim() || sendingRef.current) return;
    const command = playbackCommand(text);
    if (command) {
      stopSpeech();
      let reply = "";
      if (command === "pause") { pausePlayback(); reply = "Воспроизведение приостановлено."; }
      if (command === "resume") {
        if (currentTrack) { resumePlayback(); reply = "Возобновляю воспроизведение. Если браузер запросит действие, нажмите кнопку плеера."; }
        else reply = "Сначала выберите трек или попросите подобрать музыку.";
      }
      if (command === "mix") {
        const selection = [...messages].reverse().find((message) => message.tracks?.length)?.tracks;
        if (selection?.length) { if (currentTrack?.id === selection[0].id) resumePlayback(); else playTrack(selection[0], selection); reply = "Запускаю последнюю подборку."; }
        else reply = "Подборки пока нет. Назовите настроение или исполнителя.";
      }
      const id = crypto.randomUUID();
      setMessages((items) => [...items, { id: `user-${id}`, role: "user", text }, { id, role: "assistant", text: reply }]);
      // Playback commands use text confirmation so TTS does not pause the music it just resumed.
      return;
    }
    sendingRef.current = true;
    stopSpeech();
    const createdAt = Date.now();
    setMessages((items) => [
      ...items,
      { id: `user-${createdAt}`, role: "user", text },
      { id: `pending-${createdAt}`, role: "assistant", text: "" }
    ]);
    setSending(true);
    const controller = new AbortController();
    requestRef.current = controller;
    try {
      const response = await fetch(`${API}/api/v1/assistant`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
        },
        body: JSON.stringify({ message: text }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(45000)])
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
        if (voiceModeRef.current && result.reply) speak(result.reply);
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
      sendingRef.current = false;
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
    stopSpeech();
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
          <div ref={emptyReveal} className="rv flex h-full flex-col items-start gap-3 rounded-3xl border border-dashed border-white/10 p-6">
            <MessageSquareText size={20} className="empty-float text-slate-500"/>
            <p className="text-sm text-slate-300">Я — музыкальный помощник SONORA. Помогу найти треки и собрать микс под ваше настроение.</p>
            <p className="text-sm text-slate-400">{t("Start with one of these:")}</p>
            <div className="pop-stagger flex flex-wrap gap-2">
              {SUGGESTIONS.map((suggestion) => (
                <button key={suggestion} type="button" onClick={() => setDraft(suggestion)} className="chip btn-press chip-pop">{t(suggestion)}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map((message) => message.role === "user" ? (
          <div key={message.id} className="msg-in ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-violet-200/90 px-4 py-3 text-sm text-[#171323]">{message.text}</div>
        ) : message.role === "error" ? (
          <div key={message.id} role="alert" className="msg-in mr-auto w-full max-w-[92%]">
            <ErrorBlock title={message.text} onRetry={message.query ? () => void sendText(message.query as string) : undefined} retryLabel={t("Try again")}/>
          </div>
        ) : (
          <div key={message.id} className="msg-in mr-auto max-w-[92%] space-y-3">
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
                <button type="button" className="btn-primary m-2" onClick={() => { stopSpeech(); playTrack(message.tracks![0], message.tracks!); }}>Слушать подборку</button>
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

      <div className="surface mt-4 space-y-3 rounded-2xl p-4">
        <p className="text-xs text-slate-300">Команды: «слушать подборку», «пауза», «продолжить».</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-ghost" aria-pressed={voiceMode} onClick={() => {
            setVoiceMode(!voiceMode); setVoiceStatus("");
            if (!voiceMode) speak("Я — музыкальный помощник SONORA. Помогу найти треки, подобрать музыку под настроение и собрать ваш микс. Нажмите «Сказать голосом», чтобы обратиться ко мне.");
            else stopSpeech();
          }}>{voiceMode ? "Голосовой помощник включён" : "Включить голосового помощника"}</button>
          <button type="button" className="btn-ghost" onClick={stopSpeech}>Остановить озвучивание</button>
        </div>
        <VoiceInput onStart={() => { stopSpeech(); quietMusic(); }} onText={(text) => { setDraft(text); if (voiceMode) void sendText(text); }} disabled={sending} autoSend={voiceMode}/>
        <label className="flex flex-wrap items-center gap-2 text-sm text-slate-300">
          Голос помощника
          <select className="rounded-xl border border-white/15 bg-[#171526] p-2" value={persona} disabled={sending} onChange={(event) => { stopSpeech(); setPersona(event.target.value); }}>
            <option value="alice">Тёплый</option>
            <option value="jarvis">Спокойный</option>
            <option value="dj">Эфир DJ</option>
          </select>
        </label>
        <p className="text-xs text-slate-400">Голос синтезируется ИИ. Для облачной озвучки текст ответа отправляется сервису синтеза речи.</p>
        {voiceStatus && <p role="status" className="text-xs text-violet-200">{voiceStatus}</p>}
      </div>
      <form onSubmit={send} className="sticky bottom-24 mt-5 flex items-center gap-2 rounded-2xl border border-white/10 bg-[#11121d]/95 p-2 backdrop-blur-xl md:bottom-6">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={300}
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
