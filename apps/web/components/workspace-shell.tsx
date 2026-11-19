"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AudioLines, Compass, Search, Library, Heart, Clock3, FileUp, Settings, UserRound, Sparkles } from "lucide-react";
import { useAuth } from "./auth-provider";
import { useLanguage } from "./language-provider";
import { usePlayer } from "./player-provider";

const links = [
  { href: "/", label: "Discover", icon: Compass },
  { href: "/search", label: "Search", icon: Search },
  { href: "/discover", label: "Browse catalog", icon: AudioLines },
  { href: "/playlists", label: "Your library", icon: Library },
  { href: "/favorites", label: "Liked tracks", icon: Heart },
  { href: "/history", label: "Listening history", icon: Clock3 },
  { href: "/import", label: "Import tracks", icon: FileUp },
  { href: "/settings", label: "Settings", icon: Settings }
];

export function WorkspaceShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, loading } = useAuth();
  const { language, setLanguage, t } = useLanguage();
  const { currentTrack } = usePlayer();

  if (pathname === "/auth" || pathname.startsWith("/auth/")) return <>{children}</>;

  const active = (href: string) => href === "/" ? pathname === "/" : pathname === href || (href === "/playlists" && pathname.startsWith("/playlists/"));
  const profileHref = user ? "/profile" : "/auth";

  return (
    <div className="sonora-workspace mx-auto flex min-h-screen w-full max-w-[1680px] gap-4 px-3 py-3 md:gap-5 md:px-5 lg:px-7">
      <aside className="sonora-sidebar sticky top-3 hidden h-[calc(100vh-24px)] w-[244px] shrink-0 flex-col rounded-[28px] border border-white/[0.08] bg-[#10111a]/90 p-4 shadow-2xl shadow-black/20 backdrop-blur-xl md:flex">
        <Link href="/" className="mb-9 flex items-center gap-3 rounded-2xl px-2 py-3">
          <span className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-violet-300/25 to-cyan-300/10 text-violet-100 ring-1 ring-white/10"><AudioLines size={21}/></span>
          <span><span className="block text-[15px] font-bold tracking-[.24em]">SONORA</span><span className="mt-1 block text-[9px] uppercase tracking-[.22em] text-slate-500">Music universe</span></span>
        </Link>
        <p className="mb-3 px-3 text-[9px] font-semibold uppercase tracking-[.25em] text-slate-600">{t("Workspace")}</p>
        <nav className="space-y-1">
          {links.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} aria-current={active(href) ? "page" : undefined}
              className={`group flex items-center gap-3 rounded-2xl px-3 py-3 text-[13px] transition-all duration-200 ${active(href) ? "bg-gradient-to-r from-violet-300/15 to-cyan-300/[0.04] text-violet-100 ring-1 ring-violet-200/10" : "text-slate-400 hover:bg-white/[0.045] hover:text-white"}`}>
              <Icon size={17} className={active(href) ? "text-violet-200" : "text-slate-500 group-hover:text-slate-200"}/>{t(label)}
            </Link>
          ))}
        </nav>
        <div className="mt-auto rounded-2xl border border-violet-200/10 bg-gradient-to-br from-violet-400/[0.10] via-transparent to-cyan-300/[0.06] p-4">
          <Sparkles size={17} className="mb-3 text-violet-200"/>
          <p className="text-xs font-semibold text-slate-200">{t("Your sound, evolving.")}</p>
          <p className="mt-1 text-[11px] leading-5 text-slate-500">{t("Personalized discovery is coming as your listening story grows.")}</p>
        </div>
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-white/[0.07] pt-3">
          <Link href={profileHref} className="flex min-w-0 items-center gap-2 rounded-xl p-2 text-xs text-slate-300 hover:bg-white/5">
            {user?.avatarUrl ? <img src={user.avatarUrl} alt="" className="h-8 w-8 rounded-full object-cover"/> : <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-violet-200/15 text-violet-100"><UserRound size={15}/></span>}
            <span className="min-w-0"><span className="block truncate font-medium">{loading ? t("Restoring your session…") : user?.displayName || user?.username || t("Sign in")}</span><span className="block text-[10px] text-slate-600">{user ? "SONORA account" : "Account"}</span></span>
          </Link>
          <div className="flex shrink-0 rounded-full border border-white/10 bg-black/20 p-0.5" aria-label={t("Language")}>
            <button type="button" onClick={() => setLanguage("en")} aria-pressed={language === "en"} className={`rounded-full px-2 py-1 text-[9px] ${language === "en" ? "bg-violet-200 text-[#171323]" : "text-slate-500"}`}>EN</button>
            <button type="button" onClick={() => setLanguage("ru")} aria-pressed={language === "ru"} className={`rounded-full px-2 py-1 text-[9px] ${language === "ru" ? "bg-violet-200 text-[#171323]" : "text-slate-500"}`}>RU</button>
          </div>
        </div>
      </aside>

      <div className={`min-w-0 flex-1 ${currentTrack ? "pb-44" : "pb-24"} md:pb-10`}>
        {children}
      </div>

      <nav className={`sonora-mobile-nav fixed inset-x-3 z-40 mx-auto grid max-w-[520px] grid-cols-5 gap-1 rounded-[22px] border border-white/10 bg-[#11121d]/95 p-2 shadow-2xl shadow-black/50 backdrop-blur-2xl md:hidden ${currentTrack ? "bottom-[94px]" : "bottom-3"}`} aria-label={t("Workspace")}>
        {[
          { href: "/", label: "Discover", icon: Compass },
          { href: "/search", label: "Search", icon: Search },
          { href: "/playlists", label: "Library", icon: Library },
          { href: "/favorites", label: "Liked tracks", icon: Heart },
          { href: profileHref, label: "Your profile", icon: UserRound }
        ].map(({ href, label, icon: Icon }) => (
          <Link key={label} href={href} aria-current={active(href) ? "page" : undefined} className={`flex min-w-0 flex-col items-center justify-center gap-1 rounded-2xl py-2 text-[9px] transition ${active(href) ? "bg-violet-300/15 text-violet-100" : "text-slate-500 hover:text-slate-200"}`}>
            <Icon size={18}/><span className="max-w-full truncate">{t(label)}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
