"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export type SonoraUser = {
  id: string;
  email: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  createdAt?: string;
};

type AuthContextValue = {
  user: SonoraUser | null;
  accessToken: string;
  loading: boolean;
  isAuthenticated: boolean;
  refreshSession: () => Promise<boolean>;
  acceptSession: (token: string, user?: (Pick<SonoraUser, "id" | "email"> & { username?: string | null; displayName?: string | null; avatarUrl?: string | null; createdAt?: string }) | null, expiresAt?: number) => void;
  updateProfile: (changes: { displayName?: string; username?: string }) => Promise<SonoraUser>;
  uploadAvatar: (file: File) => Promise<SonoraUser>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const API = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((data as { error?: string }).error || "Request failed.");
  return data as T;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SonoraUser | null>(null);
  const [accessToken, setAccessToken] = useState("");
  const [loading, setLoading] = useState(true);
  const expiresAtRef = useRef(0);
  const tokenRef = useRef("");
  const refreshPromiseRef = useRef<Promise<boolean> | null>(null);

  const acceptSession = useCallback((token: string, nextUser?: (Pick<SonoraUser, "id" | "email"> & { username?: string | null; displayName?: string | null; avatarUrl?: string | null; createdAt?: string }) | null, expiresAt?: number) => {
    tokenRef.current = token;
    setAccessToken(token);
    if (expiresAt) expiresAtRef.current = expiresAt;
    if (nextUser?.id && nextUser.email) {
      setUser({
        id: nextUser.id,
        email: nextUser.email,
        username: nextUser.username ?? "",
        displayName: nextUser.displayName ?? nextUser.username ?? "",
        avatarUrl: nextUser.avatarUrl ?? null,
        createdAt: nextUser.createdAt
      });
    }
  }, []);

  const refreshSession = useCallback(async () => {
    if (refreshPromiseRef.current) return refreshPromiseRef.current;
    const task = (async () => {
      try {
        const response = await fetch(`/api/auth/refresh`, {
          method: "POST",
          credentials: "include",
          cache: "no-store"
        });
        if (!response.ok) {
          // Only a definitive auth rejection should clear the session.
          // A temporary API outage or rate limit must not sign the user out.
          if (response.status === 401 || response.status === 403) {
            tokenRef.current = "";
            setAccessToken("");
            setUser(null);
            expiresAtRef.current = 0;
            return false;
          }
          return Boolean(tokenRef.current);
        }
        const result = await response.json() as {
          session?: { access_token?: string; expires_at?: number };
          user?: SonoraUser;
        };
        const token = result.session?.access_token;
        if (!token) throw new Error("Session refresh returned no access token.");
        tokenRef.current = token;
        setAccessToken(token);
        expiresAtRef.current = result.session?.expires_at ?? Math.floor(Date.now() / 1000) + 3600;

        // Restore the user and token from the same refresh response. A second
        // /me request created a race where the token was renewed but the profile
        // stayed null, sending an already signed-in user back to /auth.
        if (result.user?.id && result.user.email) {
          setUser(result.user);
          return true;
        }

        const meResponse = await fetch(`${API}/api/v1/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
          credentials: "include",
          cache: "no-store"
        });
        const me = await readJson<{ user: SonoraUser }>(meResponse);
        setUser(me.user);
        return true;
      } catch {
        // Keep an already-valid in-memory session during a transient network failure.
        if (!tokenRef.current) setUser(null);
        return Boolean(tokenRef.current);
      }
    })();
    refreshPromiseRef.current = task;
    try { return await task; }
    finally { refreshPromiseRef.current = null; }
  }, []);

  const updateProfile = useCallback(async (changes: { displayName?: string; username?: string }) => {
    const token = tokenRef.current;
    if (!token) throw new Error("Sign in to update your profile.");
    const response = await fetch(`${API}/api/v1/profile`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(changes)
    });
    const result = await readJson<{ user: SonoraUser }>(response);
    setUser(result.user);
    return result.user;
  }, []);

  const uploadAvatar = useCallback(async (file: File) => {
    const token = tokenRef.current;
    if (!token) throw new Error("Sign in to change your avatar.");
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      throw new Error("Choose a JPG, PNG or WebP image.");
    }
    if (file.size > 2 * 1024 * 1024) throw new Error("The image must be 2 MB or smaller.");
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const value = String(reader.result || "");
        resolve(value.includes(",") ? value.slice(value.indexOf(",") + 1) : value);
      };
      reader.onerror = () => reject(new Error("Could not read this image."));
      reader.readAsDataURL(file);
    });
    const response = await fetch(`${API}/api/v1/profile/avatar`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ contentType: file.type, base64 })
    });
    const result = await readJson<{ user: SonoraUser }>(response);
    setUser(result.user);
    return result.user;
  }, []);

  const logout = useCallback(async () => {
    const token = tokenRef.current;
    try {
      if (token) {
        await fetch(`/api/auth/logout`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          credentials: "include"
        });
      }
    } finally {
      tokenRef.current = "";
      expiresAtRef.current = 0;
      setAccessToken("");
      setUser(null);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void refreshSession().finally(() => { if (active) setLoading(false); });
    const onFocus = () => {
      if (document.visibilityState === "visible" &&
          (!expiresAtRef.current || expiresAtRef.current * 1000 - Date.now() < 5 * 60 * 1000)) {
        void refreshSession();
      }
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      active = false;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [refreshSession]);

  useEffect(() => {
    if (!accessToken || !expiresAtRef.current) return;
    const delay = Math.max(30_000, expiresAtRef.current * 1000 - Date.now() - 5 * 60 * 1000);
    const timer = window.setTimeout(() => { void refreshSession(); }, delay);
    return () => window.clearTimeout(timer);
  }, [accessToken, refreshSession]);

  const value = useMemo<AuthContextValue>(() => ({
    user, accessToken, loading, isAuthenticated: Boolean(user && accessToken),
    refreshSession, acceptSession, updateProfile, uploadAvatar, logout
  }), [user, accessToken, loading, refreshSession, acceptSession, updateProfile, uploadAvatar, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
