import { matchesCatalogSearch } from "./catalog.js";

type BandcampPlayer = { kind: "track" | "album"; id: string };
type Release = {
  title: string;
  album?: string;
} & ({ videoId: string; bandcamp?: BandcampPlayer } | { videoId?: never; bandcamp: BandcampPlayer });

// Artist and label publications, reviewed against the sources in docs/music-providers.md.
const discographies: Array<{ artist: string; aliases: string[]; releases: Release[] }> = [
  {
    artist: "Кишлак", aliases: ["Kishlak"],
    releases: [
      { title: "11:11", album: "11:11", videoId: "T55-Jowa6Lk", bandcamp: { kind: "track", id: "670731413" } },
      { title: "Поцелуями", videoId: "Z30z_Wrr8bY", bandcamp: { kind: "track", id: "2523347187" } },
      { title: "Я уёбываю в джаз", videoId: "KWmz9DPBybk", bandcamp: { kind: "track", id: "1637151982" } },
      { title: "Накуримся, напьемся", album: "СХИК2", videoId: "iWnqB6PGm3M" },
      { title: "11:11 (альбом)", bandcamp: { kind: "album", id: "2944651415" } }
    ]
  },
  {
    artist: "Молодой Рубль", aliases: ["Molodoy Rubl", "Young Ruble"],
    releases: [
      { title: "чисто гипотетически (prod. by arcadeonly)", videoId: "cwoPR0-liOI" },
      { title: "практически ветер", album: "шкёрт", videoId: "AhcyhUscX2M" },
      { title: "партак", album: "шкёрт", videoId: "yeHBXVALo-8" }
    ]
  },
  {
    artist: "N01R", aliases: ["rockin_n01r"],
    releases: [
      { title: "Bad", videoId: "E6VteWOLKlM" },
      { title: "Убежать", videoId: "1_8_42L7KVM" },
      { title: "Холик", videoId: "V-o24vSw9hA" }
    ]
  }
];

const releases = discographies.flatMap(({ artist, aliases, releases }) => releases.map((release) => ({
  ...release, artist, aliases,
  id: release.videoId !== undefined ? `youtube:${release.videoId}` : `bandcamp:${release.bandcamp.kind}:${release.bandcamp.id}`
})));

export function searchOfficialReleases(query: string, limit: number) {
  return releases.filter((item) => matchesCatalogSearch(query, item.title, item.album, item.artist, ...item.aliases))
    .slice(0, limit)
    .map(({ aliases: _aliases, ...item }) => item);
}
