import { ArrowUpRight, AudioLines, Compass, Headphones, Heart, Library, ListMusic, Search, Sparkles } from "lucide-react";

const mixes = [
  { title: "Afterglow", detail: "Warm electronic · 42 tracks", color: "from-fuchsia-500/35 to-violet-950", mark: "✳" },
  { title: "Blue hour", detail: "Indie & alternative · 36 tracks", color: "from-sky-400/30 to-blue-950", mark: "◒" },
  { title: "Deep focus", detail: "Ambient · 58 tracks", color: "from-emerald-400/25 to-teal-950", mark: "⌁" }
];

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-[1440px] gap-5 px-4 py-5 md:px-8">
      <aside className="hidden w-60 shrink-0 flex-col rounded-3xl border border-white/[0.07] bg-white/[0.025] p-5 md:flex">
        <a href="#" className="mb-12 flex items-center gap-3 text-xl font-semibold tracking-[.22em]"><span className="grid h-9 w-9 place-items-center rounded-xl bg-violet-400/15 text-violet-200"><AudioLines size={20}/></span>SONORA</a>
        <p className="mb-3 text-[10px] font-semibold uppercase tracking-[.24em] text-slate-500">Workspace</p>
        <nav className="space-y-2 text-sm text-slate-300">
          <a className="flex items-center gap-3 rounded-xl bg-violet-400/10 px-3 py-3 text-violet-200" href="#"><Compass size={17}/> Discover</a>
          <a className="flex items-center gap-3 rounded-xl px-3 py-3 hover:bg-white/5" href="#"><Search size={17}/> Search</a>
          <a className="flex items-center gap-3 rounded-xl px-3 py-3 hover:bg-white/5" href="#"><Library size={17}/> Your library</a>
          <a className="flex items-center gap-3 rounded-xl px-3 py-3 hover:bg-white/5" href="#"><Heart size={17}/> Liked tracks</a>
          <a className="flex items-center gap-3 rounded-xl px-3 py-3 hover:bg-white/5" href="#"><ListMusic size={17}/> Playlists</a>
        </nav>
        <div className="mt-auto rounded-2xl border border-white/[0.07] bg-gradient-to-br from-violet-500/15 to-transparent p-4">
          <Sparkles className="mb-3 text-violet-200" size={18}/>
          <p className="text-sm font-medium">Your sound, evolving.</p>
          <p className="mt-1 text-xs leading-5 text-slate-400">Personalized discovery is coming as your listening story grows.</p>
        </div>
      </aside>

      <section className="min-w-0 flex-1 pb-28">
        <header className="flex items-center justify-between gap-4 py-3">
          <div className="md:hidden flex items-center gap-2 font-semibold tracking-[.2em]"><AudioLines className="text-violet-300"/> SONORA</div>
          <div className="hidden text-sm text-slate-400 md:block">Tuesday, your next favorite is waiting.</div>
          <div className="flex items-center gap-2"><a href="/auth" className="rounded-full bg-violet-200 px-4 py-2 text-xs font-semibold text-[#171323] transition hover:bg-white">Sign in</a><span className="hidden rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-xs text-slate-300 sm:inline-flex"><span className="mr-2 mt-1 h-2 w-2 rounded-full bg-amber-300"/> Preview experience</span></div>
        </header>

        <div className="relative mt-8 overflow-hidden rounded-[2rem] border border-violet-300/15 bg-gradient-to-br from-[#292044] via-[#171426] to-[#10131c] p-7 shadow-glow md:p-12">
          <div className="absolute -right-16 -top-24 h-72 w-72 rounded-full bg-fuchsia-500/15 blur-3xl"/>
          <div className="relative max-w-2xl">
            <p className="mb-5 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.28em] text-violet-200"><Sparkles size={14}/> A new way to feel music</p>
            <h1 className="text-4xl font-semibold leading-[1.08] tracking-tight md:text-6xl">Find your<br/><span className="bg-gradient-to-r from-violet-200 via-fuchsia-200 to-sky-200 bg-clip-text text-transparent">own frequency.</span></h1>
            <p className="mt-5 max-w-lg text-sm leading-6 text-slate-300 md:text-base">A calmer space for discovering sounds, collecting moments, and building a soundtrack that feels like yours.</p>
            <a href="/discover" className="mt-8 inline-flex items-center gap-2 rounded-full bg-violet-200 px-5 py-3 text-sm font-semibold text-[#171323] transition hover:bg-white">Explore your sound <ArrowUpRight size={16}/></a>
          </div>
          <div className="absolute bottom-8 right-10 hidden h-48 w-48 rotate-[-12deg] items-center justify-center rounded-[2.5rem] border border-white/15 bg-white/[0.04] shadow-2xl backdrop-blur-xl lg:flex">
            <div className="absolute inset-4 rounded-full border border-violet-200/20"/>
            <div className="absolute inset-8 rounded-full border border-fuchsia-200/20"/>
            <div className="absolute inset-12 rounded-full bg-gradient-to-br from-violet-300/30 to-fuchsia-400/10"/>
            <AudioLines size={54} strokeWidth={1} className="text-violet-100"/>
          </div>
        </div>

        <section id="mixes" className="mt-12">
          <div className="mb-5 flex items-end justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[.25em] text-violet-300">Curated starting points</p><h2 className="mt-2 text-2xl font-semibold">Made for the moment</h2></div><a href="#" className="text-xs text-slate-400 hover:text-white">View all</a></div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {mixes.map((mix) => <article key={mix.title} className="group rounded-3xl border border-white/[0.07] bg-white/[0.025] p-3 transition hover:-translate-y-1 hover:bg-white/[0.05]"><div className={`relative grid aspect-[1.55] place-items-center overflow-hidden rounded-2xl bg-gradient-to-br ${mix.color}`}><span className="text-7xl text-white/75 transition group-hover:scale-110">{mix.mark}</span><span className="absolute bottom-3 right-3 rounded-full border border-white/15 bg-black/20 px-3 py-1 text-[10px] uppercase tracking-widest text-white/70">Editorial mood</span></div><h3 className="mt-4 font-medium">{mix.title}</h3><p className="mt-1 text-xs text-slate-400">{mix.detail}</p></article>)}
          </div>
        </section>

        <section className="mt-12 rounded-3xl border border-white/[0.07] bg-white/[0.025] p-6 md:p-8">
          <div className="flex items-center gap-3"><Headphones className="text-violet-200"/><div><h2 className="font-semibold">A listening space, not just a feed.</h2><p className="mt-1 text-xs text-slate-400">The foundation is being built. Playback will be enabled only through licensed sources.</p></div></div>
        </section>
        <footer className="mt-12 border-t border-white/[0.07] pt-5 text-xs text-slate-500">SONORA · Early foundation · Music rights first</footer>
      </section>
    </main>
  );
}
