import type { SonoraUser } from "../components/auth-provider";

export const API = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");
// IDs match apps/api/src/profile-routes.ts ACCENT_PRESETS exactly.
export const ACCENT_PRESETS = [
  { id: "aurora", label: "Aurora", gradient: "linear-gradient(120deg, #292044, #584096 45%, #176d68)" },
  { id: "violet", label: "Violet", gradient: "linear-gradient(120deg, #201a34, #673db0, #382653)" },
  { id: "ocean", label: "Ocean", gradient: "linear-gradient(120deg, #152734, #195d77, #237b79)" },
  { id: "sunset", label: "Sunset", gradient: "linear-gradient(120deg, #382036, #8c435f, #ac6c50)" },
  { id: "forest", label: "Forest", gradient: "linear-gradient(120deg, #182b2a, #346047, #617b4a)" },
  { id: "mono", label: "Mono", gradient: "linear-gradient(120deg, #191b25, #454653, #252733)" }
] as const;
export function coverGradient(accent?: string | null) {
  return (ACCENT_PRESETS.find((preset) => preset.id === accent) || ACCENT_PRESETS[0]).gradient;
}
export const ROLE_LABELS: Record<string, string> = { listener: "Listener", creator: "Creator", curator: "Curator", dj: "DJ" };
export type ProfileLink = { platform: string; url: string };
export type ProfileUser = SonoraUser & {
  coverUrl?: string | null; bio?: string | null; accent?: string | null;
  role?: string | null; status?: string | null; links?: ProfileLink[];
  favoriteGenres?: string[];
  privacy?: { history: boolean; profile: "public" | "private"; comments: boolean };
};
export type ProfileIdentity = Pick<ProfileUser,
  "username" | "displayName" | "avatarUrl" | "coverUrl" | "bio" | "accent" | "role" | "status" | "links"
>;
export type ProfileChanges = {
  displayName?: string; username?: string; bio?: string | null; status?: string | null;
  accent?: string | null; role?: string | null; links?: ProfileLink[]; favoriteGenres?: string[];
};
export class ProfileRequestError extends Error {
  constructor(public status: number) { super("Profile request failed."); }
}
export async function profileRequest<T>(path: string, token = "", init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body) headers.set("Content-Type", "application/json");
  const response = await fetch(`${API}/api/v1${path}`, { ...init, headers, credentials: "include", cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ProfileRequestError(response.status);
  return data as T;
}
export async function imagePayload(file: File, limitMb: number) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > limitMb * 1024 * 1024) {
    throw new Error("Invalid image");
  }
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || "").split(",")[1] || "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  return { contentType: file.type, base64 };
}
