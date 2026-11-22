import { matchesCatalogSearch } from "./catalog.js";

// Artist and label publications, reviewed against the linked release pages.
const releases = [
  { artist: "Кишлак", aliases: ["Kishlak"], title: "11:11", videoId: "T55-Jowa6Lk" },
  { artist: "Кишлак", aliases: ["Kishlak"], title: "Поцелуями", videoId: "Z30z_Wrr8bY" },
  { artist: "Молодой Рубль", aliases: ["Molodoy Rubl", "Young Ruble"], title: "чисто гипотетически (prod. by arcadeonly)", videoId: "cwoPR0-liOI" },
  { artist: "N01R", aliases: ["rockin_n01r"], title: "Bad", videoId: "E6VteWOLKlM" },
  { artist: "N01R", aliases: ["rockin_n01r"], title: "Убежать", videoId: "1_8_42L7KVM" }
] as const;

export function searchOfficialReleases(query: string, limit: number) {
  return releases.filter((item) => matchesCatalogSearch(query, item.title, item.artist, ...item.aliases))
    .slice(0, limit)
    .map(({ title, artist, videoId }) => ({
      id: `youtube:${videoId}`, title, artist, videoId
    }));
}
