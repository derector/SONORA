"use client";
import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
type Recognition = {
  lang: string; interimResults: boolean; continuous: boolean;
  onresult: ((event: { results: { transcript: string }[][] }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void; abort(): void;
};
type SpeechWindow = Window & { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
export function VoiceInput({ onText, disabled, onStart, autoSend }: { onText: (text: string) => void; disabled: boolean; onStart: () => void; autoSend: boolean }) {
  const ref = useRef<Recognition | null>(null);
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState("");
  useEffect(() => () => {
    if (ref.current) { ref.current.onresult = null; ref.current.onerror = null; ref.current.onend = null; ref.current.abort(); }
  }, []);
  function toggle() {
    if (listening) { ref.current?.abort(); setListening(false); return; }
    const api = window as SpeechWindow;
    const Engine = api.SpeechRecognition ?? api.webkitSpeechRecognition;
    if (!Engine) { setStatus("Голосовой ввод недоступен в этом браузере. Введите запрос текстом."); return; }
    onStart();
    const recognition = new Engine(); ref.current = recognition;
    recognition.lang = "ru-RU"; recognition.interimResults = false; recognition.continuous = false;
    recognition.onresult = (event) => {
      const text = event.results[0]?.[0]?.transcript?.trim();
      if (text) { onText(text.slice(0, 300)); setStatus(autoSend ? "Запрос распознан и отправлен помощнику." : "Запрос распознан. Проверьте текст и нажмите отправить."); }
    };
    recognition.onerror = (event) => {
      setListening(false);
      setStatus(event.error === "not-allowed" ? "Доступ к микрофону запрещён. Разрешите его в настройках браузера или введите текст." : "Не удалось распознать речь. Попробуйте ещё раз или введите текст.");
    };
    recognition.onend = () => setListening(false);
    try { setListening(true); setStatus("Слушаю…"); recognition.start(); }
    catch { setListening(false); setStatus("Микрофон недоступен. Попробуйте ввести текст."); }
  }
  return <div className="flex flex-col items-start gap-2">
    <button type="button" className="btn-ghost" onClick={toggle} disabled={disabled} aria-pressed={listening}>
      {listening ? <Square size={16}/> : <Mic size={16}/>} {listening ? "Остановить запись" : "Сказать голосом"}
    </button>
    <p className="text-xs text-slate-400">Речь распознаёт сервис браузера. SONORA получает текст запроса. {autoSend ? "В голосовом режиме запрос отправляется сразу." : "Перед отправкой можно исправить текст."}</p>
    {status && <p role="status" className="text-xs text-violet-200">{status}</p>}
  </div>;
}
