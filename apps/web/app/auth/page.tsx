"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AudioLines, ArrowLeft, LoaderCircle, Mail, ShieldCheck } from "lucide-react";
import { useLanguage } from "../../components/language-provider";
import { useAuth } from "../../components/auth-provider";

type AuthResult = {
  error?: string;
  user?: { id: string; email: string; username?: string | null; displayName?: string | null; avatarUrl?: string | null };
  session?: { access_token: string; expires_at?: number };
};
type AuthMode = "login" | "register";

export default function AuthPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const { loading: sessionLoading, isAuthenticated, acceptSession } = useAuth();
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"details" | "verify">("details");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!sessionLoading && isAuthenticated) router.replace("/");
  }, [sessionLoading, isAuthenticated, router]);

  async function submitDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(""); setMessage("");
    try {
      const endpoint = mode === "register" ? "register" : "login";
      const body = mode === "register" ? { email, username, displayName } : { email };
      const response = await fetch(`/api/auth/${endpoint}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        credentials: "include", body: JSON.stringify(body)
      });
      const result = await response.json() as AuthResult;
      if (!response.ok) throw new Error(result.error || "Could not send the code.");
      setStep("verify");
      setMessage(t("A sign-in code has been requested. Check your email, including spam."));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally { setBusy(false); }
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/auth/verify`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        credentials: "include", body: JSON.stringify({ email, token: code })
      });
      const result = await response.json() as AuthResult;
      if (!response.ok || !result.session?.access_token || !result.user) {
        throw new Error(result.error || "The code could not be verified.");
      }
      acceptSession(result.session.access_token, result.user, result.session.expires_at);
      router.replace("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally { setBusy(false); }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <Link href="/" className="mb-8 inline-flex items-center gap-2 text-sm text-slate-400 transition hover:text-white"><ArrowLeft size={16}/> {t("Back to SONORA")}</Link>
        <section className="rounded-[2rem] border border-white/10 bg-[#11111b]/90 p-7 shadow-2xl shadow-violet-950/20 backdrop-blur-xl sm:p-9">
          <div className="mb-8 flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-violet-300/10 text-violet-200"><AudioLines size={23}/></span>
            <div><p className="text-sm font-semibold tracking-[.22em]">SONORA</p><p className="mt-1 text-xs text-slate-500">{t("Your music identity")}</p></div>
          </div>
          {sessionLoading ? <div className="flex items-center gap-3 py-10 text-sm text-slate-400"><LoaderCircle className="animate-spin" size={18}/>{t("Restoring your session…")}</div> : isAuthenticated ? (
            <div className="py-8 text-center text-sm text-slate-300">{t("Your SONORA session is active.")}</div>
          ) : step === "verify" ? (
            <form onSubmit={verifyCode}>
              <ShieldCheck className="mb-4 text-violet-200" size={28}/>
              <h1 className="text-2xl font-semibold">{t("Check your inbox.")}</h1>
              <p className="mt-2 text-sm leading-6 text-slate-400">{t("Enter the eight-digit code sent to")} <span className="text-slate-200">{email}</span>.</p>
              <label className="mt-7 block text-xs font-medium text-slate-400">{t("Verification code")}</label>
              <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 8))} inputMode="numeric" autoComplete="one-time-code" maxLength={8} required placeholder="00000000" className="mt-2 w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-4 text-center text-2xl tracking-[.55em] outline-none transition focus:border-violet-300/60"/>
              <button disabled={busy || code.length !== 8} className="mt-5 flex w-full items-center justify-center gap-2 rounded-full bg-violet-200 px-5 py-3 text-sm font-semibold text-[#171323] transition hover:bg-white disabled:opacity-50">{busy && <LoaderCircle className="animate-spin" size={16}/>} {t("Verify and continue")}</button>
              <button type="button" onClick={() => { setStep("details"); setCode(""); setMessage(""); setError(""); }} className="mt-4 w-full text-xs text-slate-500 hover:text-white">{t("Change email or request another code")}</button>
            </form>
          ) : (
            <>
              <h1 className="text-2xl font-semibold">{mode === "register" ? t("Create your account.") : t("Welcome back.")}</h1>
              <p className="mt-2 text-sm leading-6 text-slate-400">{t("Sign in securely with a one-time code sent to your email.")}</p>
              <div className="mt-6 grid grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-black/20 p-1.5" aria-label={t("Account access")}>
                <button type="button" disabled={busy} aria-pressed={mode === "register"} onClick={() => { setMode("register"); setError(""); setMessage(""); }} className={`min-h-11 rounded-xl px-3 py-2 text-xs font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-200 disabled:cursor-not-allowed ${mode === "register" ? "bg-violet-200 text-[#171323] shadow-lg shadow-violet-950/20" : "text-slate-400 hover:bg-white/5 hover:text-white"}`}>{t("Create account")}</button>
                <button type="button" disabled={busy} aria-pressed={mode === "login"} onClick={() => { setMode("login"); setError(""); setMessage(""); }} className={`min-h-11 rounded-xl px-3 py-2 text-xs font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-200 disabled:cursor-not-allowed ${mode === "login" ? "bg-violet-200 text-[#171323] shadow-lg shadow-violet-950/20" : "text-slate-400 hover:bg-white/5 hover:text-white"}`}>{t("I already have an account")}</button>
              </div>
              <form onSubmit={submitDetails} className="mt-6 space-y-4">
                {mode === "register" && <>
                  <label className="block text-xs text-slate-400">{t("Display name")}<input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required minLength={1} maxLength={48} placeholder={t("How should we call you?")} className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none focus:border-violet-300/60"/></label>
                  <label className="block text-xs text-slate-400">{t("Username")}<input value={username} onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, "").slice(0, 24))} required minLength={3} maxLength={24} placeholder={t("Username")} className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none focus:border-violet-300/60"/></label>
                </>}
                <label className="block text-xs text-slate-400">{t("Email address")}<span className="relative mt-2 block"><Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={16}/><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={254} placeholder={t("Email address")} className="w-full rounded-xl border border-white/10 bg-black/20 py-3 pl-11 pr-4 text-sm text-white outline-none focus:border-violet-300/60"/></span></label>
                <button disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-full bg-violet-200 px-5 py-3 text-sm font-semibold text-[#171323] transition hover:bg-white disabled:opacity-50">{busy && <LoaderCircle className="animate-spin" size={16}/>} {t("Send email code")}</button>
              </form>
            </>
          )}
          {message && <p className="mt-5 rounded-xl border border-emerald-300/15 bg-emerald-300/5 px-4 py-3 text-xs leading-5 text-emerald-200">{message}</p>}
          {error && <p role="alert" className="mt-5 rounded-xl border border-rose-300/15 bg-rose-300/5 px-4 py-3 text-xs leading-5 text-rose-200">{error}</p>}
          <p className="mt-7 text-center text-[10px] leading-5 text-slate-600">{t("Protected by Supabase Auth. Your refresh session is stored in a secure HttpOnly cookie.")}</p>
        </section>
      </div>
    </main>
  );
}
