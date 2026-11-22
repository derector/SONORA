import assert from "node:assert/strict";
import { test } from "node:test";
import { searchOfficialReleases } from "./official-releases.js";

test("official releases are selected by artist, alias, or recording title", () => {
  assert.deepEqual(searchOfficialReleases("Кишлак", 20).map((item) => item.title), ["11:11", "Поцелуями"]);
  assert.equal(searchOfficialReleases("Molodoy Rubl", 20)[0]?.videoId, "cwoPR0-liOI");
  assert.equal(searchOfficialReleases("N01R Bad", 20)[0]?.videoId, "E6VteWOLKlM");
  assert.equal(searchOfficialReleases("rockin n01r", 20).length, 2);
  assert.deepEqual(searchOfficialReleases("Кишлак Bad", 20), []);
});
