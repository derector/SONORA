import { catalogSearchKey, matchesCatalogSearch, PLAYABLE_MAX_DURATION_SECONDS } from "./catalog.js";

const API = "https://commons.wikimedia.org/w/api.php";
const PAGE_ID = /^[1-9]\d{0,14}$/;
const MIME_TYPES = new Set(["application/ogg", "audio/ogg", "audio/mpeg", "audio/flac", "audio/wav", "audio/x-wav"]);
const AUDIO_EXTENSION = /\.(ogg|oga|opus|mp3|flac|wav)$/i;
const ENTITIES: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " };
const PROPERTIES = "ObjectName|Artist|Attribution|AttributionRequired|LicenseUrl|Restrictions";

type CommonsPage = {
  pageid?: number;
  title?: string;
  index?: number;
  imageinfo?: Array<{
    url?: string;
    mime?: string;
    mediatype?: string;
    metadata?: Array<{ name: string; value: unknown }>;
    extmetadata?: Record<string, { value?: string }>;
  }>;
};

function plainText(value: unknown) {
  if (typeof value !== "string") return "";
  return value.replace(/<[^>]*>/g, " ").replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, token: string) => {
    if (!token.startsWith("#")) return ENTITIES[token.toLowerCase()] ?? entity;
    const hex = token[1]?.toLowerCase() === "x";
    const code = Number.parseInt(token.slice(hex ? 2 : 1), hex ? 16 : 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
  }).replace(/\s+/g, " ").trim();
}

function allowedLicense(value = "") {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.host !== "creativecommons.org" ||
        url.username || url.password) return null;
    const path = url.pathname.replace(/\/$/, "");
    if (path === "/publicdomain/zero/1.0") return { url: `https://creativecommons.org${path}/`, label: "CC0 1.0" };
    const match = /^\/licenses\/(by|by-sa)\/(3\.0|4\.0)$/.exec(path);
    return match ? { url: `https://creativecommons.org${path}/`, label: `CC ${match[1].toUpperCase()} ${match[2]}` } : null;
  } catch {
    return null;
  }
}

function audioUrl(value: string | undefined) {
  try {
    const url = new URL(value ?? "");
    if (url.origin !== "https://upload.wikimedia.org" || url.username || url.password ||
        !/^\/wikipedia\/commons\/[a-f0-9]\/[a-f0-9]{2}\/[^/]+$/i.test(url.pathname) ||
        !AUDIO_EXTENSION.test(url.pathname)) return null;
    return url.href;
  } catch {
    return null;
  }
}

function parseTrack(page: CommonsPage) {
  const id = String(page.pageid);
  const info = page.imageinfo?.[0];
  if (!PAGE_ID.test(id) || !page.title?.startsWith("File:") || info?.mediatype !== "AUDIO" ||
      !info.mime || !MIME_TYPES.has(info.mime)) return null;
  const stream = audioUrl(info.url);
  const meta = info.extmetadata;
  const license = allowedLicense(meta?.LicenseUrl?.value);
  const credit = plainText(meta?.Attribution?.value);
  const artist = plainText(meta?.Artist?.value) || credit;
  const title = plainText(meta?.ObjectName?.value) || page.title.slice(5).replace(AUDIO_EXTENSION, "");
  const length = info.metadata?.find((item) => item.name === "length")?.value;
  const duration = typeof length === "number" && Number.isFinite(length) ? Math.round(length) : 0;
  if (!stream || !license || !title || !artist || duration > PLAYABLE_MAX_DURATION_SECONDS ||
      plainText(meta?.Restrictions?.value) ||
      ((license.label !== "CC0 1.0" || meta?.AttributionRequired?.value === "true") && !credit)) return null;
  return {
    id: `commons:${id}`, providerTrackId: id, provider: "Wikimedia Commons",
    title, artist, album: null, artworkUrl: null, durationSeconds: Math.max(0, duration),
    audioUrl: stream, licenseUrl: license.url,
    sourceUrl: `https://commons.wikimedia.org/wiki/Special:Redirect/page/${id}`,
    rightsLabel: credit ? `${credit} · ${license.label}` : license.label,
    playable: true
  };
}

async function fetchPages(params: Record<string, string>) {
  const query = new URLSearchParams({
    action: "query", format: "json", formatversion: "2", prop: "imageinfo", iilimit: "1",
    iiprop: "url|mime|mediatype|metadata|extmetadata", iiextmetadatafilter: PROPERTIES, ...params
  });
  const response = await fetch(`${API}?${query}`, {
    headers: { Accept: "application/json", "User-Agent": "SONORA/0.2 (https://github.com/derector/SONORA)" },
    signal: AbortSignal.timeout(3000)
  });
  if (!response.ok) throw new Error(`Commons HTTP ${response.status}`);
  const payload = await response.json() as { error?: unknown; query?: { pages?: CommonsPage[] } };
  if (payload.error) throw new Error("Commons returned an API error.");
  return payload.query?.pages ?? [];
}

export function createCommonsCatalog() {
  type Track = NonNullable<ReturnType<typeof parseTrack>>;
  const searches = new Map<string, { expires: number; result: Promise<Track[]> }>();
  return {
    async search(query: string, limit: number) {
      const key = catalogSearchKey(query);
      if (key.length < 2) return [];
      let entry = searches.get(key);
      if (!entry || entry.expires <= Date.now()) {
        const result = fetchPages({
          generator: "search", gsrnamespace: "6", gsrlimit: "20",
          gsrsearch: `${key} filetype:audio`
        }).then((pages) => pages.sort((a, b) => (a.index ?? Infinity) - (b.index ?? Infinity))
          .flatMap((page) => {
            const track = parseTrack(page);
            return track && matchesCatalogSearch(key, track.title, track.artist) ? [track] : [];
          }));
        searches.delete(key);
        if (searches.size >= 64) {
          const oldest = searches.keys().next().value;
          if (oldest !== undefined) searches.delete(oldest);
        }
        entry = { expires: Date.now() + 120_000, result };
        searches.set(key, entry);
        void result.catch(() => {
          if (searches.get(key)?.result === result) searches.delete(key);
        });
      }
      return (await entry.result).slice(0, limit);
    },
    async lookup(id: string) {
      if (!PAGE_ID.test(id)) return null;
      const pages = await fetchPages({ pageids: id });
      const page = pages.find((item) => String(item.pageid) === id);
      return page ? parseTrack(page) : null;
    }
  };
}
