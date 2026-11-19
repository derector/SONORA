"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Clock3, Compass, Heart, Library, Search, Settings, Upload } from "lucide-react";
import { useLanguage } from "./language-provider";

const links = [
  { href: "/", label: "Discover", icon: Compass },
  { href: "/search", label: "Search", icon: Search },
  { href: "/playlists", label: "Your library", icon: Library },
  { href: "/favorites", label: "Liked tracks", icon: Heart },
  { href: "/history", label: "Listening history", icon: Clock3 },
  { href: "/import", label: "Import tracks", icon: Upload },
  { href: "/settings", label: "Settings", icon: Settings }
];

export function MobileNavigation() {
  const pathname = usePathname();
  const { language, t } = useLanguage();

  return (
    <nav aria-label={language === "ru" ? "Главная навигация" : "Main navigation"} className="sticky top-0 z-40 border-b border-white/[0.07] bg-[#090b10]/90 px-3 py-2 backdrop-blur-xl md:hidden">
      <div className="mx-auto flex max-w-full gap-2 overflow-x-auto overscroll-x-contain pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {links.map(({ href, label, icon: Icon }, index) => {
          const active = index === 0 ? pathname === "/" || pathname === "/discover" : pathname === href || (href === "/playlists" && pathname.startsWith("/playlists"));
          return (
            <Link
              key={label}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-2 text-xs transition ${active ? "border-violet-200/30 bg-violet-200/10 text-violet-100" : "border-white/10 text-slate-400 hover:bg-white/5 hover:text-white"}`}
            >
              <Icon size={14} aria-hidden="true" />
              <span>{t(label)}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
