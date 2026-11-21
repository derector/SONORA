"use client";
import Link from "next/link";
import { useLanguage } from "../../components/language-provider";
import { ArrowLeft, FileText, Music2, ShieldCheck } from "lucide-react";

// Attribution and licensing live here so the listening interface can stay
// unified: no source names on cards, rows or player bars.
export default function LegalPage() {
  const { t } = useLanguage();
  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-6 pb-36 md:px-8">
      <header className="flex items-center justify-between">
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white"><ArrowLeft size={17}/> {t("Back")}</Link>
        <span className="flex items-center gap-2 text-sm font-semibold tracking-[.2em]"><Music2 size={16} className="text-violet-300"/> SONORA</span>
      </header>

      <section className="panel-hero mt-10 p-7 md:p-10">
        <p className="t-eyebrow flex items-center gap-2 !text-violet-200"><ShieldCheck size={14}/> {t("Licensing and attribution")}</p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight md:text-4xl">{t("Music rights stay attached to every track.")}</h1>
        <p className="mt-3 text-sm leading-6 text-slate-300">{t("SONORA plays one unified catalog built from licensed music sources. Each recording keeps its creator, license deed and source page, and playback follows the terms attached to it.")}</p>
      </section>

      <section className="mt-8 space-y-6 text-sm leading-6 text-slate-300">
        <div className="surface p-6">
          <h2 className="flex items-center gap-2 text-base font-semibold text-white"><FileText size={17} className="text-violet-200"/> {t("Where to find attribution")}</h2>
          <p className="mt-3">{t("Open the full player and use")} <span className="font-medium text-white">{t("About track")}</span>. {t("It shows the album, the license applied to that recording, a direct link to the source page and the license deed itself. License and attribution links are also available on saved tracks and playlist rows.")}</p>
        </div>
        <div className="surface p-6">
          <h2 className="text-base font-semibold text-white">{t("Catalogs and terms")}</h2>
          <p className="mt-3">{t("Tracks come from independent, licensed catalogs. Most are released under Creative Commons deeds; the deed shown for a track is authoritative, and it may require credit, forbid commercial use or both. SONORA does not relicense recordings and does not remove or rewrite the terms attached to them.")}</p>
          <p className="mt-3">{t("If a recording is withdrawn at its source, SONORA reports that honestly instead of substituting another take, and the queue moves on.")}</p>
        </div>
        <div className="surface p-6">
          <h2 className="text-base font-semibold text-white">{t("Imports, external apps and data")}</h2>
          <p className="mt-3">{t("Import matches titles you already own inside SONORA's licensed catalogs. SONORA never downloads audio from other services and never streams protected files it is not allowed to serve. Playback history and favorites are stored in your SONORA account; your language and seasonal effects choices stay on this device.")}</p>
        </div>
        <div className="surface p-6">
          <h2 className="text-base font-semibold text-white">{t("Profile privacy and account data")}</h2>
          <p className="mt-3">{t("Your profile visibility and listening-history sharing are controlled in Profile → Privacy. Private profiles are excluded from public profile, people-search and follower-list results.")}</p>
        </div>
        <div className="surface p-6">
          <h2 className="text-base font-semibold text-white">{t("Account data")}</h2>
          <p className="mt-3">{t("Your email is used for sign-in and is not part of your public profile. Favorites, playlists and listening history are associated with your SONORA account.")}</p>
          <p className="mt-3">{t("Language and seasonal appearance preferences are stored on this device.")}</p>
        </div>
        <div className="surface p-6">
          <h2 className="text-base font-semibold text-white">{t("Rights holders")}</h2>
          <p className="mt-3">{t("If you hold rights to a recording and believe it is presented without a valid deed, contact the source that published it and use the license or report link on that source page. SONORA honors withdrawals received from its catalogs.")}</p>
        </div>
      </section>

      <footer className="mt-12 border-t border-white/[0.07] pt-5 text-xs text-slate-500">{t("SONORA · Independent music · Music rights first")}</footer>
    </main>
  );
}
