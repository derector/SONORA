"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Check, Snowflake, ArrowLeft } from "lucide-react";
import { useLanguage } from "../../components/language-provider";

export default function SettingsPage() {
  const { language, setLanguage } = useLanguage();
  const [seasonalEffects, setSeasonalEffects] = useState(true);
  useEffect(() => {
    try { setSeasonalEffects(localStorage.getItem("sonora-seasonal-effects") !== "off"); } catch {}
  }, []);
  function toggle() {
    const next = !seasonalEffects;
    setSeasonalEffects(next);
    try { localStorage.setItem("sonora-seasonal-effects", next ? "on" : "off"); window.dispatchEvent(new Event("sonora-seasonal-effects-change")); } catch {}
  }
  return <main className="mx-auto min-h-screen max-w-3xl px-4 py-8">
    <Link href="/messenger" className="inline-flex items-center gap-2 text-sm text-violet-200"><ArrowLeft size={16}/> К перепискам</Link>
    <section className="mt-8 rounded-3xl border border-white/15 bg-white/[0.06] p-6 shadow-2xl backdrop-blur-2xl sm:p-9">
      <p className="text-xs font-semibold tracking-[.24em] text-violet-200">SONORA MESSENGER</p>
      <h1 className="mt-3 text-3xl font-semibold">Настройки</h1>
      <Link href="/profile" className="mt-7 block rounded-2xl border border-white/10 bg-white/5 p-4 hover:bg-white/10">Мой профиль →</Link>
      <div className="mt-6 rounded-2xl border border-white/10 p-5">
        <h2 className="font-semibold">Язык интерфейса</h2>
        <div className="mt-4 flex flex-wrap gap-3">{(["ru", "en"] as const).map(value =>
          <button key={value} type="button" onClick={() => setLanguage(value)} aria-pressed={language === value}
            className={`flex items-center gap-2 rounded-xl border px-4 py-3 text-sm ${language === value ? "border-violet-300/60 bg-violet-400/20" : "border-white/15 bg-white/5"}`}>
            {value === "ru" ? "Русский" : "English"}{language === value && <Check size={16}/>}
          </button>)}</div>
      </div>
      <div className="mt-6 rounded-2xl border border-white/10 p-5">
        <h2 className="flex items-center gap-2 font-semibold"><Snowflake size={18}/> Сезонные эффекты</h2>
        <p className="mt-2 text-sm opacity-70">Снег, дождь и листья по сезону. Системная настройка уменьшения анимации соблюдается.</p>
        <button type="button" role="switch" aria-checked={seasonalEffects} onClick={toggle}
          className="mt-4 rounded-xl border border-white/15 bg-white/5 px-5 py-3">{seasonalEffects ? "Включены" : "Выключены"}</button>
      </div>
    </section>
  </main>;
}
