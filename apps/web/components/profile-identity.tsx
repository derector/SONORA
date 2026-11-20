"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type FormEvent } from "react";
import { Camera, Check, Link2, Pencil, Share2, Trash2, UserRound, X } from "lucide-react";
import { useLanguage } from "./language-provider";
import { ACCENT_PRESETS, coverGradient, ROLE_LABELS, type ProfileChanges, type ProfileIdentity, type ProfileUser } from "../lib/profile";

export const PROFILE_TABS = [
  { id: "overview", label: "Overview" }, { id: "favorites", label: "Favorites" },
  { id: "playlists", label: "Playlists" }, { id: "albums", label: "Albums" },
  { id: "artists", label: "Artists" }, { id: "history", label: "History" },
  { id: "taste", label: "Music taste" }, { id: "friends", label: "Friends" },
  { id: "stats", label: "Statistics" }
] as const;
export type ProfileTab = typeof PROFILE_TABS[number]["id"];

export function ProfileTabs({ active, onChange }: { active: ProfileTab; onChange: (tab: ProfileTab) => void }) {
  const { t, language } = useLanguage();
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const [pill, setPill] = useState<{ left: number; width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const node = refs.current.get(active);
      if (node) setPill({ left: node.offsetLeft, width: node.offsetWidth, height: node.offsetHeight });
    };
    measure();
    const observer = new ResizeObserver(measure);
    const node = refs.current.get(active);
    if (node) observer.observe(node);
    window.addEventListener("resize", measure);
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); };
  }, [active, language]);
  return <div className="mt-6 overflow-x-auto pb-2">
    <div role="tablist" aria-label={t("Profile sections")} className="relative flex w-max min-w-full gap-1 rounded-pill bg-white/[0.025] p-1">
      {pill && <span className="nav-pill" aria-hidden style={{ transform: `translate(${pill.left}px, 4px)`, width: pill.width, height: pill.height }} />}
      {PROFILE_TABS.map(({ id, label }, index) => <button key={id} ref={(node) => { if (node) refs.current.set(id, node); }} id={`profile-tab-${id}`} type="button" role="tab" aria-selected={active === id} aria-controls="profile-panel" tabIndex={active === id ? 0 : -1} onClick={() => onChange(id)} onKeyDown={(event) => {
        let next = index;
        if (event.key === "ArrowRight") next = (index + 1) % PROFILE_TABS.length;
        else if (event.key === "ArrowLeft") next = (index + PROFILE_TABS.length - 1) % PROFILE_TABS.length;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = PROFILE_TABS.length - 1;
        else return;
        event.preventDefault(); onChange(PROFILE_TABS[next].id); refs.current.get(PROFILE_TABS[next].id)?.focus();
      }} className={`relative z-[1] whitespace-nowrap rounded-pill px-4 py-3 text-sm transition-colors ${active === id ? "text-white" : "text-muted hover:text-white"}`}>{t(label)}</button>)}
    </div>
  </div>;
}

export function ProfileHero({ profile, actions, avatarAction }: { profile: ProfileIdentity; actions?: ReactNode; avatarAction?: ReactNode }) {
  const { t } = useLanguage();
  return <section className="surface overflow-hidden">
    <div className="relative h-36 sm:h-48" style={{ background: coverGradient(profile.accent) }}>
      {profile.coverUrl && <img src={profile.coverUrl} alt={t("Profile cover")} className="h-full w-full object-cover" />}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#11121a]/60 to-transparent" />
    </div>
    <div className="relative px-5 pb-6 sm:px-7">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end">
        <div className="relative -mt-12 w-fit shrink-0 rounded-full border-4 border-[#12131c] bg-[#12131c]">
          {profile.avatarUrl ? <img src={profile.avatarUrl} alt={t("Profile avatar")} className="h-24 w-24 rounded-full object-cover sm:h-28 sm:w-28" /> : <div className="grid h-24 w-24 place-items-center rounded-full bg-violet-300/15 text-3xl text-violet-100 sm:h-28 sm:w-28">{(profile.displayName || profile.username).slice(0, 1).toUpperCase() || <UserRound size={32} />}</div>}
          {avatarAction}
        </div>
        <div className="min-w-0 flex-1 sm:pt-5">
          <div className="flex flex-wrap items-center gap-3"><h1 className="t-display break-words !text-3xl sm:!text-4xl">{profile.displayName || profile.username}</h1><span className="rounded-pill border border-white/10 bg-white/5 px-3 py-1 text-xs text-violet-100">{t(ROLE_LABELS[profile.role || "listener"] || "Listener")}</span></div>
          <p className="mt-2 text-sm text-muted">@{profile.username}</p>
        </div>
        {actions && <div className="flex flex-wrap gap-2 sm:pt-5">{actions}</div>}
      </div>
      {profile.status && <p className="mt-5 text-sm text-violet-100">{profile.status}</p>}
      {profile.bio && <p className="mt-3 max-w-2xl whitespace-pre-wrap text-sm leading-6 text-muted">{profile.bio}</p>}
      {profile.links?.length ? <div className="mt-4 flex flex-wrap gap-3">{profile.links.map((link) => <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-white"><Link2 size={14} />{link.platform}</a>)}</div> : null}
    </div>
  </section>;
}

export function ProfileDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { node?.close(); document.body.style.overflow = previous; };
  }, []);
  const { t } = useLanguage();
  return <dialog ref={dialog} onCancel={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }} className="state-in m-auto max-h-[85dvh] w-[calc(100%-32px)] max-w-xl overflow-y-auto rounded-panel border border-white/10 bg-[#151621] p-0 text-white shadow-float backdrop:bg-black/70">
    <div className="flex items-center justify-between border-b border-white/10 px-5 py-4"><h2 className="t-h2">{title}</h2><button type="button" onClick={onClose} className="btn-icon" aria-label={t("Close")}><X size={20} /></button></div>
    <div className="p-5">{children}</div>
  </dialog>;
}

export function EditProfileDialog({ profile, extended, busy, error, onSave, onClose }: { profile: ProfileUser; extended: boolean; busy: boolean; error: string; onSave: (changes: ProfileChanges) => Promise<void>; onClose: () => void }) {
  const { t } = useLanguage();
  const [name, setName] = useState(profile.displayName);
  const [username, setUsername] = useState(profile.username);
  const [bio, setBio] = useState(profile.bio || "");
  const [status, setStatus] = useState(profile.status || "");
  const [links, setLinks] = useState(profile.links?.slice(0, 3) || []);
  const [genres, setGenres] = useState(profile.favoriteGenres || []);
  const [genreDraft, setGenreDraft] = useState("");
  async function save(event: FormEvent) {
    event.preventDefault();
    await onSave({ displayName: name.trim(), username: username.trim().toLowerCase(), ...(extended ? { bio, status, links: links.filter((link) => link.url || link.platform), favoriteGenres: genres } : {}) });
  }
  return <ProfileDialog title={t("Edit profile")} onClose={onClose}><form onSubmit={(event) => void save(event)} className="space-y-4">
    <label className="block text-xs text-muted">{t("Display name")}<input autoFocus className="field mt-2 w-full" value={name} onChange={(event) => setName(event.target.value)} required minLength={1} maxLength={48} /></label>
    <label className="block text-xs text-muted">{t("Username")}<input className="field mt-2 w-full" value={username} onChange={(event) => setUsername(event.target.value.toLowerCase())} required minLength={3} maxLength={24} pattern="[a-z0-9_]{3,24}" /><span className="mt-1 block">{t("3–24 lowercase letters, numbers or underscores.")}</span></label>
    {!extended && <p className="rounded-card border border-amber-200/15 bg-amber-200/5 p-3 text-xs leading-5 text-amber-100">{t("Only name and username can be saved on this deployment. Extended profile fields are not available yet.")}</p>}
    <fieldset disabled={!extended || busy} className="space-y-4 disabled:opacity-50">
      <label className="block text-xs text-muted">{t("About me")}<textarea className="field mt-2 min-h-24 w-full resize-y" value={bio} onChange={(event) => setBio(event.target.value)} maxLength={280} /></label>
      <label className="block text-xs text-muted">{t("Status")}<input className="field mt-2 w-full" value={status} onChange={(event) => setStatus(event.target.value)} maxLength={60} /></label>
      <div><p className="mb-2 text-xs text-muted">{t("Favorite genres")}</p><div className="flex flex-wrap gap-2">{genres.map((genre) => <button key={genre} type="button" onClick={() => setGenres(genres.filter((item) => item !== genre))} className="chip">{genre}<X size={12} /></button>)}</div><div className="mt-2 flex gap-2"><input value={genreDraft} onChange={(event) => setGenreDraft(event.target.value)} maxLength={32} className="field min-w-0 flex-1" placeholder={t("Add a genre")} /><button type="button" disabled={!genreDraft.trim() || genres.length >= 12} className="btn-ghost" onClick={() => { if (!genres.includes(genreDraft.trim())) setGenres([...genres, genreDraft.trim()]); setGenreDraft(""); }}>{t("Add")}</button></div></div>
      <div><p className="text-xs text-muted">{t("Links · up to 3")}</p>{links.map((link, index) => <div className="mt-2 flex flex-wrap gap-2" key={index}><input className="field w-28" maxLength={24} required value={link.platform} placeholder={t("Label")} onChange={(event) => setLinks(links.map((item, i) => i === index ? { ...item, platform: event.target.value } : item))} /><input className="field min-w-0 flex-1" type="url" pattern="https://.*" required value={link.url} placeholder="https://" onChange={(event) => setLinks(links.map((item, i) => i === index ? { ...item, url: event.target.value } : item))} /><button type="button" className="btn-icon" aria-label={t("Remove link")} onClick={() => setLinks(links.filter((_, i) => i !== index))}><Trash2 size={16} /></button></div>)}{links.length < 3 && <button type="button" className="btn-ghost mt-2" onClick={() => setLinks([...links, { platform: "", url: "" }])}>{t("Add link")}</button>}</div>
    </fieldset>
    {error && <p role="alert" className="text-sm text-rose-200">{error}</p>}
    <button type="submit" disabled={busy} className="btn-primary w-full"><Check size={16} />{busy ? t("Saving…") : t("Save profile")}</button>
  </form></ProfileDialog>;
}

export function CoverDialog({ profile, extended, busy, onUpload, onDelete, onPreset, onClose }: { profile: ProfileUser; extended: boolean; busy: boolean; onUpload: (file: File) => void; onDelete: () => void; onPreset: (id: string) => void; onClose: () => void }) {
  const { t } = useLanguage();
  return <ProfileDialog title={t("Change cover")} onClose={onClose}>
    <label className={`btn-ghost flex w-full cursor-pointer justify-center ${busy ? "pointer-events-none opacity-50" : ""}`}><Camera size={16} />{busy ? t("Uploading…") : t("Upload cover")}<input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) onUpload(file); event.target.value = ""; }} /></label>
    <p className="t-meta mt-2">{t("JPG, PNG or WebP. Maximum size: 2 MB.")}</p>
    <p className="mt-5 text-sm font-medium">{t("Cover styles")}</p>
    {!extended && <p className="t-meta mt-1">{t("Cover styles need extended profile support. Image uploads may require storage setup.")}</p>}
    <div className="mt-3 grid grid-cols-3 gap-2">{ACCENT_PRESETS.map((preset) => <button type="button" disabled={busy || !extended} onClick={() => onPreset(preset.id)} key={preset.id} aria-pressed={profile.accent === preset.id} className="overflow-hidden rounded-tile border border-white/10 disabled:cursor-not-allowed disabled:opacity-50"><span className="block h-16" style={{ background: preset.gradient }} /><span className="block py-2 text-xs">{t(preset.label)}</span></button>)}</div>
    {profile.coverUrl && <button type="button" disabled={busy} className="btn-ghost mt-5 w-full !text-rose-200" onClick={onDelete}><Trash2 size={16} />{t("Remove cover")}</button>}
  </ProfileDialog>;
}

export { Camera, Pencil, Share2, Trash2 };
