import type { Metadata } from "next";
import "./globals.css";
import { PlayerProvider } from "../components/player-provider";
import { LanguageProvider } from "../components/language-provider";
import { AuthProvider } from "../components/auth-provider";
import { MobileNavigation } from "../components/mobile-navigation";

export const metadata: Metadata = {
  title: "SONORA | Music, in your frequency",
  description: "Discover music that moves with you."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><LanguageProvider><AuthProvider><PlayerProvider><MobileNavigation />{children}</PlayerProvider></AuthProvider></LanguageProvider></body></html>;
}
