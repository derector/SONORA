"use client";

import Link from "next/link";
import { ArrowLeft, AudioLines, Check } from "lucide-react";
import { useLanguage } from "../../components/language-provider";

export default function SettingsPage() {
  const { language, setLanguage, t } = useLanguage();
  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-8 md:px-8">
      <Link href="/" className="inline-flex items-center gap-2 text-sm text-slate-400 transition hover:text-white"><ArrowLeft size={16}/> {t("Back to SONORA")}</Link>
      <section className="mt-8 rounded-[2rem] border border-white/10 bg-[#11111b]/90 p-6 shadow-2xl shadow-violet-950/20 sm:p-9">
        <div className="flex items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-violet-300/10 text-violet-200"><AudioLines size={24}/></span>
          <div><p className="text-sm font-semibold tracking-[.22em]">SONORA</p><p className="mt-1 text-xs text-slate-500">{t("Site settings")}</p></div>
        </div>
        <h1 className="mt-8 text-3xl font-semibold">{t("Settings")}</h1>
        <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.025] p-5">
          <h2 className="text-base font-semibold">{t("Language")}</h2>
          <p className="mt-2 text-sm leading-6 text-slate-400">{t("Choose the interface language")}</p>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <button type="button" onClick={() => setLanguage("en")} aria-pressed={language === "en"} className={`flex items-center justify-between rounded-xl border px-4 py-3 text-sm transition ${language === "en" ? "border-violet-200/50 bg-violet-200/10 text-violet-100" : "border-white/10 bg-black/20 text-slate-300 hover:bg-white/5"}`}>
              <span>English</span>{language === "en" && <Check size={17}/>}
            </button>
            <button type="button" onClick={() => setLanguage("ru")} aria-pressed={language === "ru"} className={`flex items-center justify-between rounded-xl border px-4 py-3 text-sm transition ${language === "ru" ? "border-violet-200/50 bg-violet-200/10 text-violet-100" : "border-white/10 bg-black/20 text-slate-300 hover:bg-white/5"}`}>
              <span>Русский</span>{language === "ru" && <Check size={17}/>}
            </button>
          </div>
          <p className="mt-4 text-xs text-slate-500">{t("Your language choice is saved on this device.")}</p>
        </div>
      </section>
    </main>
  );
}
