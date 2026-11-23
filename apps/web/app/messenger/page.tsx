"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useAuth } from "../../components/auth-provider";

const API = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");
type Chat = { id: string; kind: string; title: string | null; created_at: string };
type Person = { id: string; username: string; displayName: string; avatarUrl: string | null };
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
  const [people, setPeople] = useState<Person[]>([]);
  const [searching, setSearching] = useState(false);
  const [openingChat, setOpeningChat] = useState(false);
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

  useEffect(() => {
    const query = recipient.trim().replace(/^@/, "");
    if (query.length < 2 || /^[0-9a-f-]{36}$/i.test(query)) { setPeople([]); setSearching(false); return; }
    setPeople([]);
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const response = await fetch(`${API}/api/v1/users?q=${encodeURIComponent(query)}&limit=8`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("Поиск пользователей временно недоступен");
        const result = await response.json() as { items: Person[] };
        if (!controller.signal.aborted) setPeople(result.items.filter(person => person.id !== user?.id));
      } catch (e) {
        if (!controller.signal.aborted) { setPeople([]); setError(e instanceof Error ? e.message : "Ошибка поиска"); }
      } finally { if (!controller.signal.aborted) setSearching(false); }
    }, 350);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [recipient, user?.id]);

  async function startDirectChat(recipientId: string) {
    if (!accessToken || openingChat) return;
    setOpeningChat(true);
    setError("");
    try {
      const result = await requestJson<{ chatId: string }>("/chats/direct", accessToken, {
        method: "POST", body: JSON.stringify({ recipientId })
      });
      await loadChats();
      setSelected(result.chatId);
      setMessages([]);
      setRecipient("");
      setPeople([]);
    } catch (e) { setError(e instanceof Error ? e.message : "Не удалось открыть диалог"); }
    finally { setOpeningChat(false); }
  }

  async function openChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = recipient.trim();
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      await startDirectChat(id);
    } else if (people.length === 1) {
      await startDirectChat(people[0].id);
    } else {
      setError("Выберите пользователя из результатов поиска");
    }
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
          <label htmlFor="recipient" className="text-sm">Найти пользователя по имени или @username</label>
          <input id="recipient" required value={recipient} onChange={e => setRecipient(e.target.value)}
            placeholder="Имя, @username или UUID" className="w-full rounded-xl border border-white/20 bg-black/10 p-3 text-sm" />
          <button disabled={openingChat} className="rounded-xl bg-violet-500 px-4 py-2 text-white disabled:opacity-50" type="submit">{openingChat ? "Открываем…" : "Открыть чат"}</button>
          {searching && <p role="status" className="text-xs opacity-60">Поиск…</p>}
          {people.length > 0 && <div className="space-y-1" aria-label="Результаты поиска">{people.map(person => <button key={person.id} type="button" disabled={openingChat} onClick={() => void startDirectChat(person.id)} className="flex w-full items-center gap-3 rounded-xl p-2 text-left text-sm hover:bg-white/10">{person.avatarUrl ? <img src={person.avatarUrl} alt="" className="h-9 w-9 rounded-full object-cover"/> : <span className="grid h-9 w-9 place-items-center rounded-full bg-violet-400/20">{person.displayName.slice(0,1).toUpperCase()}</span>}<span className="min-w-0"><span className="block truncate">{person.displayName}</span><span className="block truncate text-xs opacity-60">@{person.username}</span></span></button>)}</div>}
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
