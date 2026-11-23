import assert from "node:assert/strict";
import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import Fastify from "fastify";
import { createLicensedCatalog } from "./licensed-catalog.js";

test("licensed catalog serves only permitted tracks and stops resolving revoked entries", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "sonora-catalog-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "catalog.json");
  const entry = {
    id: "owner-recording",
    title: "Демонстрационная запись",
    artist: "Тестовый артист",
    isrc: "USABC2600001",
    audioPath: "tracks/owner-recording.mp3",
    rightsHolder: "Demo label",
    licenseRef: "internal-demo-reference",
    streamingAllowed: true,
    availableUntil: null
  };
  await writeFile(path, JSON.stringify([
    entry,
    { ...entry, id: "expired", availableUntil: "2000-01-01T00:00:00Z" },
    { ...entry, id: "unlicensed", streamingAllowed: false },
    { ...entry, id: "external", audioPath: "https://untrusted.example/example.mp3" }
  ]));
  const catalog = createLicensedCatalog({
    SONORA_LICENSED_CATALOG_FILE: path,
    SONORA_LICENSED_AUDIO_ORIGIN: "https://audio.example",
    SONORA_LICENSED_API_ORIGIN: "https://api.example"
  });
  const app = Fastify();
  t.after(() => app.close());
  catalog.register(app);

  const found = await catalog.search("тестовый артист", 10);
  assert.deepEqual(found.map((track) => track.id), ["sonora:owner-recording"]);
  assert.equal(found[0].audioUrl, "https://api.example/api/v1/providers/sonora/tracks/owner-recording/audio");
  assert.equal(found[0].rightsLabel, "Demo label");
  assert(!JSON.stringify(found).includes(entry.licenseRef));
  assert.equal((await catalog.match({ isrc: "US-ABC-26-00001" }))?.matchedVia, "isrc");
  assert.equal(await catalog.match({ artist: entry.artist, title: entry.title, isrc: "USABC2600002" }), null);

  for (const id of ["expired", "unlicensed", "external"]) {
    assert.equal((await app.inject(`/api/v1/providers/sonora/tracks/${id}/audio`)).statusCode, 404);
  }
  const stream = await app.inject("/api/v1/providers/sonora/tracks/owner-recording/audio");
  assert.equal(stream.statusCode, 302);
  assert.equal(stream.headers.location, "https://audio.example/tracks/owner-recording.mp3");
  assert.equal(stream.headers["cache-control"], "no-store");

  const lookup = await app.inject("/api/v1/providers/sonora/tracks?id=owner-recording");
  assert.equal(lookup.json().items[0].id, found[0].id);
  const replacement = join(dir, "replacement.json");
  await writeFile(replacement, JSON.stringify([{ ...entry, streamingAllowed: false }]));
  await rename(replacement, path);
  assert.deepEqual(await catalog.search("Тестовый артист", 10), []);
  assert.equal((await app.inject("/api/v1/providers/sonora/tracks/owner-recording/audio")).statusCode, 404);
});

test("opt-in licensed proxy preserves a byte range and refuses a multipart request", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "sonora-range-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "catalog.json");
  await writeFile(path, JSON.stringify([{
    id: "recording", title: "Recording", artist: "Artist", isrc: "USABC2600001",
    audioPath: "tracks/recording.mp3", rightsHolder: "Rights holder", licenseRef: "license",
    streamingAllowed: true, availableUntil: null
  }]));
  const catalog = createLicensedCatalog({
    SONORA_LICENSED_CATALOG_FILE: path,
    SONORA_LICENSED_AUDIO_ORIGIN: "https://audio.example",
    SONORA_LICENSED_API_ORIGIN: "https://api.example",
    SONORA_LICENSED_PROXY_AUDIO: "true"
  });
  const app = Fastify();
  t.after(() => app.close());
  catalog.register(app);
  const fetchMock = t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.equal(url, "https://audio.example/tracks/recording.mp3");
    assert.equal(init.redirect, "error");
    assert.equal(new Headers(init.headers).get("range"), "bytes=2-4");
    return new Response(new Uint8Array([2, 3, 4]), { status: 206, headers: {
      "Content-Type": "audio/mpeg", "Content-Range": "bytes 2-4/10", "Content-Length": "3"
    } });
  });
  const endpoint = "/api/v1/providers/sonora/tracks/recording/audio";
  const partial = await app.inject({ url: endpoint, headers: { range: "bytes=2-4" } });
  assert.equal(partial.statusCode, 206);
  assert.equal(partial.headers["content-range"], "bytes 2-4/10");
  assert.equal(partial.headers["accept-ranges"], "bytes");
  assert.deepEqual([...partial.rawPayload], [2, 3, 4]);
  const multipart = await app.inject({ url: endpoint, headers: { range: "bytes=0-1,3-4" } });
  assert.equal(multipart.statusCode, 400);
  assert.equal(fetchMock.mock.callCount(), 1);
  assert.equal((await catalog.search("isrc: us-abc-26-00001", 4))[0]?.id, "sonora:recording");
});
