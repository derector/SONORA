import assert from "node:assert/strict";
import { test } from "node:test";
import { searchOfficialReleases } from "./official-releases.js";

test("official releases are selected by artist, alias, or recording title", () => {
  assert.deepEqual(searchOfficialReleases("Кишлак", 20).map((item) => item.title),
    ["11:11", "Поцелуями", "Я уёбываю в джаз", "Накуримся, напьемся", "11:11 (альбом)", "Существо"]);
  assert.deepEqual(searchOfficialReleases("Кишлак 11:11", 20).map((item) => item.bandcamp?.kind), ["track", "album"]);
  assert.equal(searchOfficialReleases("Кишлак 11:11", 1)[0]?.id, "youtube:T55-Jowa6Lk");
  assert.equal(searchOfficialReleases("Кишлак Поцелуями", 1)[0]?.soundCloudTrackId, "2273330789");
  assert.equal(searchOfficialReleases("Кишлак Существо", 1)[0]?.id, "soundcloud:2273329559");
  assert.equal(searchOfficialReleases("Molodoy Rubl", 20)[0]?.videoId, "cwoPR0-liOI");
  assert.equal(searchOfficialReleases("Молодой Рубль шкерт", 20).length, 2);
  assert.equal(searchOfficialReleases("N01R Bad", 20)[0]?.videoId, "E6VteWOLKlM");
  assert.equal(searchOfficialReleases("rockin n01r", 20).length, 3);
  assert.deepEqual(searchOfficialReleases("Кишлак Bad", 20), []);
});
