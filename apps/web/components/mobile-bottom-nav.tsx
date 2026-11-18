"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Compass, Search, Library, Heart, Clock3, Settings } from "lucide-react";
import { useLanguage } from "./language-provider";
import { usePlayer } from "./player-provider";

const items = [
  { href: "/", label: "Discover", Icon: Compass },
  { href: "/search", label: "Search", Icon: Search },
  { href: "/playlists", label: "Your library", Icon: Library },
  { href: "/favorites", label: "Liked tracks", Icon: Heart },
  { href: "/history", label: "Listening history", Icon: Clock3 },
  { href: "/settings", label: "Settings", Icon: Settings },
];

export function MobileBottomNav() {
  const { t } = useLanguage();
  const pathname = usePathname();
  const { currentTrack } = usePlayer();
  const offset = currentTrack ? "bottom-[88px]" : "bottom-0";

  return (
    <nav aria-label={t("Mobile navigation")} className={`fixed inset-x-0 ${offset} z-40 border-t border-white/10 bg-[#10121b]/95 px-1 pt-2 backdrop-blur-xl md:hidden`} style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}>
      <div className="mx-auto grid max-w-lg grid-cols-6 gap-0.5">
        {items.map(({ href, label, Icon }) => {
          const active = pathname === href || (href === "/playlists" && pathname.startsWith("/playlists/"));
          return (
            <Link key={href} href={href} aria-current={active ? "page" : undefined} className={`flex min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-0.5 py-1.5 text-[9px] leading-none transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-300 ${active ? "text-violet-200" : "text-slate-400 hover:bg-white/5 hover:text-white"}`}>
              <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
              <span className="max-w-full truncate">{t(label)}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
