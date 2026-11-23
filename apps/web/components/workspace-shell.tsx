"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MessageCircle, Settings, UserRound } from "lucide-react";
import { useAuth } from "./auth-provider";

const links = [
  { href: "/messenger", label: "Чаты", icon: MessageCircle },
  { href: "/profile", label: "Профиль", icon: UserRound },
  { href: "/settings", label: "Настройки", icon: Settings }
];

export function WorkspaceShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user } = useAuth();
  if (pathname === "/auth" || pathname.startsWith("/auth/") || pathname === "/messenger" || pathname.startsWith("/messenger/")) {
    return <>{children}</>;
  }
  return <div className="mx-auto min-h-screen w-full max-w-6xl px-3 py-4 sm:px-6">
    <header className="sticky top-3 z-40 mb-5 flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-white/15 bg-[#141522]/70 px-4 py-3 shadow-xl backdrop-blur-2xl">
      <Link href="/messenger" className="text-sm font-bold tracking-[.22em] text-violet-100">SONORA <span className="text-xs font-normal tracking-normal opacity-70">Messenger</span></Link>
      <nav aria-label="Основная навигация" className="flex items-center gap-1">
        {links.map(({ href, label, icon: Icon }) => <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined}
          className={`inline-flex items-center gap-2 rounded-2xl px-3 py-2 text-xs transition hover:bg-white/10 sm:text-sm ${pathname === href ? "bg-white/15 text-violet-100" : "text-slate-300"}`}>
          <Icon size={16}/><span className="hidden sm:inline">{label}</span>
        </Link>)}
      </nav>
      <span className="hidden max-w-36 truncate text-xs text-slate-400 md:block">{user?.displayName || user?.username || "SONORA"}</span>
    </header>
    {children}
  </div>;
}
