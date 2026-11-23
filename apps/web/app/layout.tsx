import type { Metadata } from "next";
import "./globals.css";
import "./motion.css";
import { PlayerProvider } from "../components/player-provider";
import { LanguageProvider } from "../components/language-provider";
import { AuthProvider } from "../components/auth-provider";
import { WorkspaceShell } from "../components/workspace-shell";
import { SeasonalEffects } from "../components/seasonal-effects";
import { PageTransition } from "../components/page-transition";
import { RouteProgress } from "../components/route-progress";

export const metadata: Metadata = {
  title: "SONORA Messenger | Общение в твоём ритме",
  description: "SONORA Messenger — общение, сообщения и звонки в современном интерфейсе.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru"><body><RouteProgress/><LanguageProvider><AuthProvider><PlayerProvider><SeasonalEffects/><WorkspaceShell><PageTransition>{children}</PageTransition></WorkspaceShell></PlayerProvider></AuthProvider></LanguageProvider></body></html>;
}
