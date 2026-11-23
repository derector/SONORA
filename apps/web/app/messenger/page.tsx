"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useAuth } from "../../components/auth-provider";

const API = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");
type Chat = { id: string; kind: string; title: string | null; created_at: string };
type Message = { id: string; conversation_id: string; sender_id: string; body: string; created_at: string };

async function requestJson<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}/api/v1/messenger${path}`, {
    ...init, cache: "no-store",
    headers: { Authorization: `Bearer ${token}`, ...(init?.body ? { "Content-Type": "application/json" } : {}) }
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((json as { error?: string }).error || "Ошибка сервера");
  return json as T;
}

export default function MessengerPage() {
  const { user, accessToken, loading } = useAuth();
  const [chats, setChats] = useState<Chat[]>([]);
  const [selected, setSelected] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [recipient, setRecipient] = useState("");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const pendingNonce = useRef<{ chatId: string; body: string; nonce: string } | null>(null);

  const loadChats = useCallback(async () => {
    if (!accessToken) return;
    const data = await requestJson<{ chats: Chat[] }>("/chats", accessToken);
    setChats(data.chats);
  }, [accessToken]);

  const loadMessages = useCallback(async () => {
    if (!accessToken || !selected) return;
    const data = await requestJson<{ messages: Message[] }>(`/chats/${selected}/messages`, accessToken);
    setMessages(data.messages.slice().reverse());
  }, [accessToken, selected]);

  useEffect(() => {
    if (!accessToken) return;
    void loadChats().catch((e: Error) => setError(e.message));
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadChats().catch(() => {});
    }, 10000);
    return () => window.clearInterval(timer);
  }, [accessToken, loadChats]);

  // Polling provides real persisted updates until private Realtime subscriptions are integrated.
  useEffect(() => {
    if (!selected || !accessToken) return;
    void loadMessages().catch((e: Error) => setError(e.message));
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadMessages().catch(() => {});
    }, 3000);
    return () => window.clearInterval(timer);
  }, [selected, accessToken, loadMessages]);

  async function openChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    try {
      const result = await requestJson<{ chatId: string }>("/chats/direct", accessToken, {
        method: "POST", body: JSON.stringify({ recipientId: recipient.trim() })
      });
      await loadChats();
      setSelected(result.chatId);
      setRecipient("");
    } catch (e) { setError((e as Error).message); }
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.trim() || !selected || sending) return;
    setSending(true);
    setError("");
    try {
      const body = draft.trim();
      const nonce = pendingNonce.current?.chatId === selected && pendingNonce.current.body === body
        ? pendingNonce.current.nonce : crypto.randomUUID();
      pendingNonce.current = { chatId: selected, body, nonce };
      await requestJson(`/chats/${selected}/messages`, accessToken, {
        method: "POST", body: JSON.stringify({ body, clientNonce: nonce })
      });
      pendingNonce.current = null;
      setDraft("");
      await loadMessages();
    } catch (e) { setError((e as Error).message); }
    finally { setSending(false); }
  }

  if (loading) return <main className="mx-auto max-w-5xl p-8">Загрузка аккаунта…</main>;
  if (!user || !accessToken) return <main className="mx-auto max-w-xl p-8"><h1 className="text-3xl font-semibold">SONORA Messenger</h1><p className="my-5">Для переписки сначала зарегистрируйтесь или войдите по электронной почте.</p><Link href="/auth" className="rounded-2xl bg-white/20 px-5 py-3">Регистрация и вход</Link></main>;

  return <main className="mx-auto min-h-[80vh] max-w-6xl p-4 text-inherit">
    <h1 className="mb-5 text-3xl font-semibold">SONORA Messenger</h1>
    <div className="grid min-h-[65vh] gap-4 md:grid-cols-[300px_1fr]">
      <aside className="rounded-3xl border border-white/20 bg-white/10 p-4 shadow-xl backdrop-blur-xl">
        <h2 className="mb-3 text-lg font-medium">Переписки</h2>
        <form onSubmit={openChat} className="mb-5 space-y-2">
          <label htmlFor="recipient" className="text-sm">ID пользователя для нового диалога</label>
          <input id="recipient" required value={recipient} onChange={e => setRecipient(e.target.value)}
            placeholder="UUID получателя" className="w-full rounded-xl border border-white/20 bg-black/10 p-3 text-sm" />
          <button className="rounded-xl bg-violet-500 px-4 py-2 text-white" type="submit">Открыть чат</button>
        </form>
        <div className="space-y-2">{chats.map(chat =>
          <button key={chat.id} onClick={() => { setSelected(chat.id); setMessages([]); }}
            className={`block w-full rounded-2xl border p-3 text-left text-sm ${selected === chat.id ? "border-violet-400 bg-violet-500/20" : "border-white/10 bg-white/5"}`}>
            {chat.title || (chat.kind === "direct" ? "Личный диалог" : "Группа")}<span className="mt-1 block truncate text-xs opacity-60">{chat.id}</span>
          </button>
        )}</div>
        {!chats.length && <p className="text-sm opacity-60">Переписок пока нет.</p>}
      </aside>
      <section className="flex min-h-[55vh] flex-col rounded-3xl border border-white/20 bg-white/10 p-4 shadow-xl backdrop-blur-xl">
        {selected ? <>
          <div className="border-b border-white/10 pb-3 font-medium">Диалог</div>
          <div aria-live="polite" className="flex flex-1 flex-col justify-end gap-2 overflow-y-auto py-5">
            {messages.map(message => <div key={message.id} className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${message.sender_id === user.id ? "self-end bg-violet-500/30" : "self-start bg-white/15"}`}>
              <p className="whitespace-pre-wrap break-words">{message.body}</p>
              <time className="mt-1 block text-right text-xs opacity-60" dateTime={message.created_at}>{new Date(message.created_at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</time>
            </div>)}
          </div>
          <form onSubmit={send} className="flex gap-2">
            <input aria-label="Сообщение" maxLength={4096} value={draft} onChange={e => setDraft(e.target.value)} placeholder="Написать сообщение…" className="min-w-0 flex-1 rounded-2xl border border-white/20 bg-white/10 p-3" />
            <button disabled={sending || !draft.trim()} className="rounded-2xl bg-violet-500 px-5 py-3 text-white disabled:opacity-50">Отправить</button>
          </form>
        </> : <div className="m-auto text-center opacity-60">Выберите переписку или создайте новую.</div>}
      </section>
    </div>
    {error && <p role="alert" className="mt-4 rounded-xl border border-red-400/40 p-3 text-red-400">{error}</p>}
  </main>;
}
