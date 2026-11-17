"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { AudioLines, ArrowLeft, CheckCircle2, LoaderCircle, Mail, ShieldCheck } from "lucide-react";

type AuthMode = "login" | "register";
type ApiResult = {
  ok?: boolean;
  message?: string;
  error?: string;
  user?: { id: string; email?: string; username?: string | null; displayName?: string | null };
  session?: { access_token: string; expires_at?: number };
};

const API = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");

export default function AuthPage() {
  const [mode, setMode] = useState<AuthMode>("register");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"details" | "verify" | "signed-in">("details");
  const [accessToken, setAccessToken] = useState("");
  const [user, setUser] = useState<ApiResult["user"]>();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    fetch(`${API}/api/v1/auth/refresh`, { method: "POST", credentials: "include" })
      .then(async (response) => response.ok ? response.json() as Promise<ApiResult> : null)
      .then((result) => {
        if (active && result?.session?.access_token) {
          setAccessToken(result.session.access_token);
          return fetch(`${API}/api/v1/auth/me`, {
            headers: { Authorization: `Bearer ${result.session.access_token}` },
            credentials: "include"
          });
        }
        return null;
      })
      .then(async (response) => response?.ok ? response.json() as Promise<ApiResult> : null)
      .then((result) => {
        if (active && result?.user) {
          setUser(result.user);
          setStep("signed-in");
        }
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  async function submitDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(""); setMessage("");
    try {
      const endpoint = mode === "register" ? "register" : "login";
      const body = mode === "register"
        ? { email, username, displayName }
        : { email };
      const response = await fetch(`${API}/api/v1/auth/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body)
      });
      const result = await response.json() as ApiResult;
      if (!response.ok) throw new Error(result.error || "Could not send the code.");
      setStep("verify");
      setMessage("A sign-in code has been requested. Check your email, including spam.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`${API}/api/v1/auth/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, token: code })
      });
      const result = await response.json() as ApiResult;
      if (!response.ok || !result.session?.access_token) throw new Error(result.error || "The code could not be verified.");
      setAccessToken(result.session.access_token);
      setUser(result.user);
      setStep("signed-in");
      setMessage("Your SONORA session is active.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    try {
      await fetch(`${API}/api/v1/auth/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        credentials: "include"
      });
    } finally {
      setAccessToken(""); setUser(undefined); setStep("details"); setCode(""); setBusy(false);
      setMessage("You have signed out.");
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <Link href="/" className="mb-8 inline-flex items-center gap-2 text-sm text-slate-400 transition hover:text-white"><ArrowLeft size={16}/> Back to SONORA</Link>
        <section className="rounded-[2rem] border border-white/10 bg-[#11111b]/90 p-7 shadow-2xl shadow-violet-950/20 backdrop-blur-xl sm:p-9">
          <div className="mb-8 flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-violet-300/10 text-violet-200"><AudioLines size={23}/></span>
            <div><p className="text-sm font-semibold tracking-[.22em]">SONORA</p><p className="mt-1 text-xs text-slate-500">Your music identity</p></div>
          </div>

          {step === "signed-in" ? (
            <div>
              <CheckCircle2 className="mb-4 text-emerald-300" size={30}/>
              <h1 className="text-2xl font-semibold">You’re in.</h1>
              <p className="mt-2 text-sm text-slate-400">Signed in as {user?.email || email}{user?.username ? ` · @${user.username}` : ""}</p>
              <button onClick={logout} disabled={busy} className="mt-8 w-full rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm font-medium transition hover:bg-white/10 disabled:opacity-50">{busy ? "Signing out…" : "Sign out"}</button>
            </div>
          ) : step === "verify" ? (
            <form onSubmit={verifyCode}>
              <ShieldCheck className="mb-4 text-violet-200" size={28}/>
              <h1 className="text-2xl font-semibold">Check your inbox.</h1>
              <p className="mt-2 text-sm leading-6 text-slate-400">Enter the six-digit code sent to <span className="text-slate-200">{email}</span>.</p>
              <label className="mt-7 block text-xs font-medium text-slate-400">Verification code</label>
              <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" maxLength={6} required placeholder="000000" className="mt-2 w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-4 text-center text-2xl tracking-[.55em] outline-none transition focus:border-violet-300/60"/>
              <button disabled={busy || code.length !== 6} className="mt-5 flex w-full items-center justify-center gap-2 rounded-full bg-violet-200 px-5 py-3 text-sm font-semibold text-[#171323] transition hover:bg-white disabled:opacity-50">{busy && <LoaderCircle className="animate-spin" size={16}/>} Verify and continue</button>
              <button type="button" onClick={() => { setStep("details"); setCode(""); setMessage(""); setError(""); }} className="mt-4 w-full text-xs text-slate-500 hover:text-white">Change email or request another code</button>
            </form>
          ) : (
            <>
              <h1 className="text-2xl font-semibold">{mode === "register" ? "Create your account." : "Welcome back."}</h1>
              <p className="mt-2 text-sm leading-6 text-slate-400">Sign in securely with a one-time code sent to your email.</p>
              <div className="mt-6 grid grid-cols-2 rounded-full border border-white/10 bg-black/20 p-1">
                <button type="button" onClick={() => setMode("register")} className={`rounded-full px-3 py-2 text-xs transition ${mode === "register" ? "bg-violet-200 text-[#171323] font-semibold" : "text-slate-400"}`}>Create account</button>
                <button type="button" onClick={() => setMode("login")} className={`rounded-full px-3 py-2 text-xs transition ${mode === "login" ? "bg-violet-200 text-[#171323] font-semibold" : "text-slate-400"}`}>Sign in</button>
              </div>
              <form onSubmit={submitDetails} className="mt-6 space-y-4">
                {mode === "register" && <>
                  <label className="block text-xs text-slate-400">Display name<input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required minLength={1} maxLength={48} placeholder="How should we call you?" className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none focus:border-violet-300/60"/></label>
                  <label className="block text-xs text-slate-400">Username<input value={username} onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, "").slice(0, 24))} required minLength={3} maxLength={24} placeholder="your_handle" className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none focus:border-violet-300/60"/></label>
                </>}
                <label className="block text-xs text-slate-400">Email address<span className="relative mt-2 block"><Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={16}/><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={254} placeholder="you@example.com" className="w-full rounded-xl border border-white/10 bg-black/20 py-3 pl-11 pr-4 text-sm text-white outline-none focus:border-violet-300/60"/></span></label>
                <button disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-full bg-violet-200 px-5 py-3 text-sm font-semibold text-[#171323] transition hover:bg-white disabled:opacity-50">{busy && <LoaderCircle className="animate-spin" size={16}/>} Send email code</button>
              </form>
            </>
          )}
          {message && <p className="mt-5 rounded-xl border border-emerald-300/15 bg-emerald-300/5 px-4 py-3 text-xs leading-5 text-emerald-200">{message}</p>}
          {error && <p role="alert" className="mt-5 rounded-xl border border-rose-300/15 bg-rose-300/5 px-4 py-3 text-xs leading-5 text-rose-200">{error}</p>}
          <p className="mt-7 text-center text-[10px] leading-5 text-slate-600">Protected by Supabase Auth. Your refresh session is stored in a secure HttpOnly cookie.</p>
        </section>
      </div>
    </main>
  );
}
