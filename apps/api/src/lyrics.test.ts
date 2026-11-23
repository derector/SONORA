import { strict as assert } from "node:assert";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import Fastify from "fastify";
import { parseLrc, registerLyricsRoutes } from "./lyrics.js";

test("LRC parser sorts repeated timestamps and applies the offset", () => {
  const lines = parseLrc("[offset:+25]\n[ar:SONORA]\n[00:02.7]last\n[00:01.02][00:02.03]repeat\n[00:83]invalid");
  assert.deepEqual(lines, [
    { timeMs: 1045, text: "repeat" },
    { timeMs: 2055, text: "repeat" },
    { timeMs: 2725, text: "last" }
  ]);
});

test("lyrics route exposes only entries with an active display license and rechecks the manifest", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "sonora-lyrics-"));
  const file = join(dir, "manifest.json");
  const app = Fastify();
  registerLyricsRoutes(app, { SONORA_LICENSED_LYRICS_FILE: file });
  t.after(async () => { await app.close(); await rm(dir, { recursive: true, force: true }); });
  const entry = { id: "sonora:original", displayAllowed: true, displayUntil: null, rightsHolder: "Demo author", licenseRef: "demo-rights", lrc: "[00:01]Demo line" };
  await writeFile(file, JSON.stringify([
    entry,
    { ...entry, id: "sonora:expired", displayUntil: "2000-01-01T00:00:00Z" },
    { ...entry, id: "sonora:audio-only", displayAllowed: false },
    { ...entry, id: "sonora:unknown-expiry", displayUntil: undefined }
  ]));
  const result = await app.inject("/api/v1/lyrics?id=sonora%3Aoriginal");
  assert.equal(result.statusCode, 200);
  assert.equal(result.headers["cache-control"], "no-store");
  assert.deepEqual(result.json(), { status: "available", lines: [{ timeMs: 1000, text: "Demo line" }], rightsHolder: "Demo author" });
  for (const id of ["sonora:expired", "sonora:audio-only", "sonora:unknown-expiry"]) {
    assert.deepEqual((await app.inject(`/api/v1/lyrics?id=${encodeURIComponent(id)}`)).json(), { status: "unavailable" });
  }
  assert.equal((await app.inject("/api/v1/lyrics?id=%2e%2e%2fsecret")).statusCode, 400);
  await writeFile(file, JSON.stringify([{ ...entry, displayAllowed: false }]));
  assert.deepEqual((await app.inject("/api/v1/lyrics?id=sonora%3Aoriginal")).json(), { status: "unavailable" });
  await writeFile(file, "invalid");
  assert.equal((await app.inject("/api/v1/lyrics?id=sonora%3Aoriginal")).statusCode, 503);
});
