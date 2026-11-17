import type { Metadata } from "next";
import "./globals.css";
import { PlayerProvider } from "../components/player-provider";

export const metadata: Metadata = {
  title: "SONORA | Music, in your frequency",
  description: "Discover music that moves with you."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><PlayerProvider>{children}</PlayerProvider></body></html>;
}
