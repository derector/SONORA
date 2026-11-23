import assert from "node:assert/strict";
import { test } from "node:test";
import { createCommonsCatalog } from "./commons-catalog.js";

test("Commons search and queue lookup use original audio with eligible licenses and attribution", async (t) => {
  const license = { value: "http://creativecommons.org/licenses/by-sa/4.0/" };
  const meta = {
    ObjectName: { value: "Test &amp; Sonata" },
    Artist: { value: "<a href=\"/wiki/Composer\">Example Composer</a>" },
    Attribution: { value: "Pianist &#x26; Engineer" },
    LicenseUrl: license
  };
  const info = {
    mime: "application/ogg",
    mediatype: "AUDIO",
    url: "https://upload.wikimedia.org/wikipedia/commons/a/aa/Sonata.oga",
    metadata: [{ name: "length", value: 181.2 }],
    extmetadata: meta
  };
  const file = (pageid: number, imageinfo = info) => ({
    pageid, title: "File:Sonata.oga", index: pageid, imageinfo: [imageinfo]
  });
  let pages = [
    file(1),
    file(2, { ...info, mediatype: "VIDEO" }),
    file(3, { ...info, url: "https://example.org/wikipedia/commons/a/aa/Sonata.oga" }),
    file(4, { ...info, extmetadata: { ...meta, Attribution: { value: "" } } }),
    file(5, { ...info, extmetadata: { ...meta, LicenseUrl: { value: "https://creativecommons.org/licenses/by-nc/4.0/" } } }),
    file(6, { ...info, extmetadata: { ...meta, Restrictions: { value: "Restricted" } } } as typeof info)
  ];
  const fetch = t.mock.method(globalThis, "fetch", async (url: string) => {
    const request = new URL(url);
    assert.equal(request.origin, "https://commons.wikimedia.org");
    assert.equal(request.searchParams.get("iiprop"), "url|mime|mediatype|metadata|extmetadata");
    return Response.json({ query: { pages } });
  });
  const catalog = createCommonsCatalog();
  const tracks = await catalog.search("Test Sonata", 12);
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].id, "commons:1");
  assert.equal(tracks[0].title, "Test & Sonata");
  assert.equal(tracks[0].artist, "Example Composer");
  assert.equal(tracks[0].rightsLabel, "Pianist & Engineer · CC BY-SA 4.0");
  assert.equal(tracks[0].licenseUrl, "https://creativecommons.org/licenses/by-sa/4.0/");
  assert.equal(tracks[0].durationSeconds, 181);
  assert.deepEqual(await catalog.search("test sonata", 12), tracks);
  assert.equal(fetch.mock.callCount(), 1);
  assert.deepEqual(await catalog.lookup("1"), tracks[0]);
  assert.equal(await catalog.lookup("2"), null);
  pages = [];
  assert.equal(await catalog.lookup("1"), null);
});
