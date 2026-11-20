"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AudioLines, Check, ExternalLink, Music2, Snowflake } from "lucide-react";
import { useLanguage } from "../../components/language-provider";

export default function SettingsPage() {
  const { language, setLanguage, t } = useLanguage();
  const [seasonalEffects, setSeasonalEffects] = useState(true);

  useEffect(() => {
    try { setSeasonalEffects(window.localStorage.getItem("sonora-seasonal-effects") !== "off"); } catch {}
  }, []);

  function toggleSeasonalEffects() {
    setSeasonalEffects((current) => {
      const next = !current;
      try { window.localStorage.setItem("sonora-seasonal-effects", next ? "on" : "off"); } catch {}
      return next;
    });
  }
  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-8 md:px-8">
      
      <section className="mt-8 rounded-[2rem] border border-white/10 bg-[#11111b]/90 p-6 shadow-2xl shadow-violet-950/20 sm:p-9">
        <div className="flex items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-violet-300/10 text-violet-200"><AudioLines size={24}/></span>
          <div><p className="text-sm font-semibold tracking-[.22em]">SONORA</p><p className="mt-1 text-xs text-slate-500">{t("Site settings")}</p></div>
        </div>
        <h1 className="mt-8 text-3xl font-semibold">{t("Settings")}</h1>
        <Link href="/profile" className="mt-6 flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.025] p-5 transition hover:bg-white/[0.05]">
          <span><span className="block text-sm font-semibold">{t("Your profile")}</span><span className="mt-1 block text-xs text-slate-500">{t("Manage your SONORA identity and account details.")}</span></span>
          <span className="text-violet-200">→</span>
        </Link>
        <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.025] p-5">
          <div className="flex items-center gap-2">
            <Music2 size={18} className="text-violet-200" />
            <h2 className="text-base font-semibold">{t("Music sources")}</h2>
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-400">{t("SONORA plays one unified catalog built from licensed music sources. Other services appear only when an official playback integration is available.")}</p>
          <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">VK Музыка</p>
                <p className="mt-1 text-xs text-slate-500">{t("Official catalog playback is not available through the public VK API.")}</p>
              </div>
              <a href="https://music.vk.com/" target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-xs text-slate-200 transition hover:bg-white/5">
                {t("Open VK Music")} <ExternalLink size={14}/>
              </a>
            </div>
            <p className="mt-3 text-xs leading-5 text-amber-200/80">{t("VK ID sign-in alone does not grant access to the private VK Music catalog or audio streams. SONORA will not ask for your VK password or use unofficial private endpoints.")}</p>
            <a href="https://id.vk.com/about/business/go" target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-2 text-xs text-violet-200 underline decoration-violet-200/30 underline-offset-4 hover:text-white">
              {t("Open VK ID developer setup")} <ExternalLink size={13}/>
            </a>
          </div>
          <div className="mt-4 rounded-xl border border-sky-300/15 bg-sky-300/[0.035] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">Moozza · внешний плеер VK</p>
                <p className="mt-1 max-w-xl text-xs leading-5 text-slate-400">{t("Moozza can access your VK music inside its own Android app. It does not currently expose a documented public API or account-linking flow for SONORA, so this opens Moozza separately and does not sync its library or stream into the SONORA player.")}</p>
              </div>
              <a href="https://play.google.com/store/apps/details?id=ru.euphoria.moozza.new" target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-sky-200/20 bg-sky-200/10 px-3 py-2 text-xs text-sky-100 transition hover:bg-sky-200/15">
                {t("Open Moozza in Google Play")} <ExternalLink size={14}/>
              </a>
            </div>
            <a href="https://www.mozza.tech/" target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-2 text-xs text-sky-200 underline decoration-sky-200/30 underline-offset-4 hover:text-white">
              {t("Moozza official website")} <ExternalLink size={13}/>
            </a>
          </div>
          <div className="mt-4 flex flex-wrap gap-2 text-[11px] text-slate-400">
            <span className="rounded-full border border-emerald-300/15 bg-emerald-300/5 px-3 py-1.5 text-emerald-200">{t("Licensed catalogs")} · {t("playable")}</span>
            <span className="rounded-full border border-emerald-300/15 bg-emerald-300/5 px-3 py-1.5 text-emerald-200">{t("Creator uploads")} · {t("playable when streamable")}</span>
            <span className="rounded-full border border-white/10 px-3 py-1.5">{t("Catalog records")} · {t("metadata only")}</span>
            <span className="rounded-full border border-amber-300/15 bg-amber-300/5 px-3 py-1.5 text-amber-200">VK · {t("external service only")}</span>
          </div>
        </div>
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
        <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.025] p-5">
          <div className="flex items-center gap-2">
            <Snowflake size={18} className="text-violet-200" />
            <h2 className="text-base font-semibold">{t("Seasonal effects")}</h2>
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-400">{t("Snow, rain and falling leaves follow the calendar. Nothing animates when your device asks for reduced motion.")}</p>
          <button type="button" role="switch" aria-checked={seasonalEffects} onClick={toggleSeasonalEffects} className="mt-5 flex w-full items-center justify-between rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm transition hover:bg-white/5">
            <span className="font-medium">{seasonalEffects ? t("On") : t("Off")}</span>
            <span className={`relative h-6 w-11 rounded-full transition ${seasonalEffects ? "bg-violet-300/70" : "bg-white/15"}`}>
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${seasonalEffects ? "left-[22px]" : "left-0.5"}`} />
            </span>
          </button>
          <p className="mt-3 text-xs text-slate-500">{t("This choice is saved on this device only.")}</p>
        </div>
      </section>
    </main>
  );
}
