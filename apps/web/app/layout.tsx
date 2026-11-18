import type { Metadata } from "next";
import "./globals.css";
import { PlayerProvider } from "../components/player-provider";
import { LanguageProvider } from "../components/language-provider";
import { AuthProvider } from "../components/auth-provider";
import { MobileBottomNav } from "../components/mobile-bottom-nav";

export const metadata: Metadata = {
  title: "SONORA | Music, in your frequency",
  description: "Discover music that moves with you."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><LanguageProvider><AuthProvider><PlayerProvider>{children}<MobileBottomNav /></PlayerProvider></AuthProvider></LanguageProvider></body></html>;
}
