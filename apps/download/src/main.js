import "./styles.css";

const OWNER = "derector";
const REPO = "SONORA";
const RELEASES_API = `https://api.github.com/repos/${OWNER}/${REPO}/releases?per_page=5`;
const FALLBACK = {
  tag_name: "v0.1.187",
  name: "SONORA Android v0.1.187",
  published_at: "2026-11-21T12:05:18Z",
  body: "Автоматическая CI-сборка #187.\nSHA-256 APK: 625b55444c6f02129e7357e2deef837913b81477b7a5bb55b511613b3e6dcec3\nПодпись V2 стабильным ключом SONORA, мин. Android 8.0 (API 26).",
  assets: [{
    name: "SONORA-latest.apk",
    size: 15892555,
    digest: "sha256:625b55444c6f02129e7357e2deef837913b81477b7a5bb55b511613b3e6dcec3",
    browser_download_url: "https://github.com/derector/SONORA/releases/download/v0.1.187/SONORA-latest.apk"
  }]
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const apkUrl = (release) => release?.assets?.find((asset) => asset.name.toLowerCase().endsWith(".apk"))?.browser_download_url
  || "https://github.com/derector/SONORA/releases/latest";
const sizeLabel = (bytes) => bytes ? `${(bytes / 1024 / 1024).toFixed(1)} МБ` : "Размер уточняется";
const versionLabel = (release) => (release?.tag_name || "v0.1.187").replace(/^v/, "v");
const safeDate = (value) => value ? new Intl.DateTimeFormat("ru-RU", {day:"numeric",month:"long",year:"numeric"}).format(new Date(value)) : "Дата не указана";
const getSha = (release, asset) => {
  const digest = asset?.digest || "";
  if (/^sha256:[a-f0-9]{64}$/i.test(digest)) return digest.slice(7);
  const match = String(release?.body || "").match(/SHA-?256[^a-f0-9]*([a-f0-9]{64})/i);
  return match?.[1] || "";
};

function applyRelease(release, history = []) {
  const asset = release.assets?.find((item) => item.name.toLowerCase().endsWith(".apk"));
  const version = versionLabel(release);
  const url = apkUrl(release);
  const sha = getSha(release, asset);
  $$("[data-version]").forEach((node) => node.textContent = version);
  $$("[data-size]").forEach((node) => node.textContent = sizeLabel(asset?.size));
  $$("[data-apk]").forEach((node) => node.href = url);
  $$("[data-release-title]").forEach((node) => node.textContent = release.name || `SONORA Android ${version}`);
  $$("[data-release-date]").forEach((node) => node.textContent = `Опубликовано: ${safeDate(release.published_at)}`);
  $$("[data-release-notes]").forEach((node) => {
    const body = String(release.body || "Список изменений будет опубликован в GitHub Releases.");
    node.textContent = body.length > 420 ? body.slice(0, 417) + "…" : body;
  });
  $$("[data-sha]").forEach((node) => node.textContent = sha || "Контрольная сумма доступна в официальном релизе");
  const historyNode = $("#releaseHistory");
  if (historyNode) {
    historyNode.replaceChildren();
    history.slice(1, 5).forEach((item) => {
      const row = document.createElement("a");
      row.className = "release-item";
      row.href = item.html_url || "https://github.com/derector/SONORA/releases";
      row.target = "_blank";
      row.rel = "noopener noreferrer";
      const name = document.createElement("b");
      name.textContent = item.name || item.tag_name || "Релиз SONORA";
      const date = document.createElement("span");
      date.textContent = safeDate(item.published_at);
      row.append(name, date);
      historyNode.append(row);
    });
    if (!historyNode.children.length) {
      const fallback = document.createElement("a");
      fallback.className = "release-item";
      fallback.href = "https://github.com/derector/SONORA/releases";
      fallback.textContent = "Открыть историю всех релизов →";
      historyNode.append(fallback);
    }
  }
}

async function loadReleases() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6500);
  try {
    const response = await fetch(RELEASES_API, {
      headers: { Accept: "application/vnd.github+json" },
      signal: controller.signal
    });
    if (!response.ok) throw new Error("Release API unavailable");
    const releases = await response.json();
    const latest = releases.find((item) => !item.draft && !item.prerelease && item.assets?.some((asset) => asset.name.toLowerCase().endsWith(".apk")));
    if (!latest) throw new Error("No published APK release");
    applyRelease(latest, releases.filter((item) => !item.draft && !item.prerelease));
  } catch {
    applyRelease(FALLBACK, [FALLBACK]);
  } finally {
    clearTimeout(timeout);
  }
}

const toggle = $("#menuToggle");
const nav = $("#navLinks");
toggle?.addEventListener("click", () => {
  const open = nav.classList.toggle("open");
  toggle.setAttribute("aria-expanded", String(open));
  toggle.textContent = open ? "×" : "☰";
});
$$(".nav-links a").forEach((link) => link.addEventListener("click", () => {
  nav.classList.remove("open");
  toggle?.setAttribute("aria-expanded", "false");
  if (toggle) toggle.textContent = "☰";
}));

let lastY = 0;
const header = $("#siteHeader");
window.addEventListener("scroll", () => {
  const y = window.scrollY;
  const max = document.documentElement.scrollHeight - window.innerHeight;
  $("#scrollProgress").style.width = `${max > 0 ? y / max * 100 : 0}%`;
  header?.classList.toggle("scrolled", y > 20);
  if (y > 560 && y > lastY + 3) header?.classList.add("hidden");
  else if (y < lastY - 3 || y < 560) header?.classList.remove("hidden");
  lastY = y;
}, { passive: true });

if ("IntersectionObserver" in window && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
  const observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add("is-visible");
      observer.unobserve(entry.target);
    }
  }), { threshold: 0.12 });
  $$(".reveal").forEach((element) => observer.observe(element));
} else {
  $$(".reveal").forEach((element) => element.classList.add("is-visible"));
}

const moods = ["lofi для фокуса", "неон для пробежки", "джаз для вечера", "эмбиент для паузы", "новые музыкальные открытия"];
let moodIndex = 0;
const phoneShots = $(".phone-stack img");
if (phoneShots.length > 1 && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
  let phoneIndex = 0;
  setInterval(() => {
    phoneShots[phoneIndex].classList.remove("active");
    phoneIndex = (phoneIndex + 1) % phoneShots.length;
    phoneShots[phoneIndex].classList.add("active");
  }, 5200);
}

const moodLine = $("#moodLine");
if (!matchMedia("(prefers-reduced-motion: reduce)").matches && moodLine) {
  setInterval(() => {
    moodIndex = (moodIndex + 1) % moods.length;
    moodLine.animate([{opacity:1,transform:"translateY(0)"},{opacity:0,transform:"translateY(-5px)"}],{duration:220}).onfinish = () => {
      moodLine.textContent = moods[moodIndex];
      moodLine.animate([{opacity:0,transform:"translateY(5px)"},{opacity:1,transform:"translateY(0)"}],{duration:260});
    };
  }, 3600);
}

$$(".demo-tab").forEach((button) => button.addEventListener("click", () => {
  $$(".demo-tab").forEach((item) => {
    const active = item === button;
    item.classList.toggle("active", active);
    item.setAttribute("aria-selected", String(active));
  });
  $$(".demo-pane").forEach((pane) => pane.classList.toggle("active", pane.dataset.pane === button.dataset.tab));
}));

const seek = $("#seek");
const currentTime = $("#currentTime");
const waveform = $("#waveform");
if (waveform) {
  for (let i = 0; i < 34; i++) {
    const bar = document.createElement("i");
    bar.style.setProperty("--h", `${8 + ((i * 7 + 3) % 19)}px`);
    bar.style.setProperty("--d", `${(i % 11) * 47}ms`);
    waveform.append(bar);
  }
}
const playToggle = $("#playToggle");
let demoPosition = 42;
let demoPlaying = false;
let demoFrame = null;
const formatTime = (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2,"0")}`;
const paintDemo = () => {
  if (seek) seek.value = String(demoPosition);
  if (currentTime) currentTime.textContent = formatTime(demoPosition);
};
const tick = () => {
  if (!demoPlaying) return;
  demoPosition = demoPosition >= 180 ? 0 : demoPosition + 1;
  paintDemo();
  demoFrame = setTimeout(tick, 1000);
};
seek?.addEventListener("input", () => {
  demoPosition = Number(seek.value);
  paintDemo();
});
playToggle?.addEventListener("click", () => {
  demoPlaying = !demoPlaying;
  playToggle.textContent = demoPlaying ? "Ⅱ" : "▶";
  waveform?.classList.toggle("playing", demoPlaying);
  playToggle.setAttribute("aria-label", demoPlaying ? "Остановить демо" : "Запустить демо");
  if (demoFrame) clearTimeout(demoFrame);
  if (demoPlaying) tick();
});

$("#copySha")?.addEventListener("click", async () => {
  const value = $("[data-sha]")?.textContent || "";
  if (!/^[a-f0-9]{64}$/i.test(value)) return;
  try {
    await navigator.clipboard.writeText(value);
    $("#copySha").textContent = "Скопировано";
    setTimeout(() => $("#copySha").textContent = "Копировать", 1600);
  } catch {
    $("#copySha").textContent = "Не удалось";
  }
});

$("#year").textContent = String(new Date().getFullYear());
loadReleases();
