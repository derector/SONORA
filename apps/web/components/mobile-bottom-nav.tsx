"use client";

import { Compass, Search, Library, Heart, Settings } from "lucide-react";
import { useLanguage } from "./language-provider";

const items = [
  { href: "/", label: "Discover", Icon: Compass },
  { href: "/search", label: "Search", Icon: Search },
  { href: "/playlists", label: "Your library", Icon: Library },
  { href: "/favorites", label: "Liked tracks", Icon: Heart },
  { href: "/settings", label: "Settings", Icon: Settings },
];

export function MobileBottomNav() {
  const { t } = useLanguage();
  return (
    <nav aria-label={t("Mobile navigation")} className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#10121b]/95 px-2 pt-2 backdrop-blur-xl md:hidden" style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}>
      <div className="mx-auto grid max-w-lg grid-cols-5 gap-1">
        {items.map(({ href, label, Icon }) => (
          <a key={href} href={href} className="flex min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 py-1.5 text-[10px] leading-none text-slate-400 transition hover:bg-white/5 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-300">
            <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
            <span className="max-w-full truncate">{t(label)}</span>
          </a>
        ))}
      </div>
    </nav>
  );
}