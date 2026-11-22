import assert from "node:assert/strict";
import { test } from "node:test";
import { groupDiscoveryResults, resolveBestTrack, type DiscoveryResult } from "./discovery.js";
import { matchRecording } from "./recording-match.js";

const recording = { artist: "Тёплый свет", title: "Вечер", durationSeconds: 180 };

test("identity matching keeps known recording differences and normalizes harmless delivery labels", () => {
  assert.equal(matchRecording(recording, { ...recording, artist: "ТЕПЛЫЙ СВЕТ", title: "вечер (Official Audio)", durationSeconds: 190 }), "meta+duration");
  for (const title of ["Вечер (Remix)", "Вечер (Live)", "Вечер – Radio Edit", "Вечер (Take 2)"]) {
    assert.equal(matchRecording(recording, { ...recording, title }), null);
  }
  assert.equal(matchRecording(recording, { ...recording, durationSeconds: 191 }), null);
  assert.equal(matchRecording(recording, { ...recording, durationSeconds: 0 }), null);
  assert.equal(matchRecording({ title: recording.title }, recording), null);
  assert.equal(matchRecording(recording, { ...recording, artist: "Другой артист" }), null);
  assert.equal(matchRecording({ artist: "宇多田ヒカル", title: "が" }, { artist: "宇多田ヒカル", title: "か" }), null);
  assert.equal(matchRecording({ isrc: "US-ABC-26-00001" }, { isrc: "USABC2600001" }), "isrc");
  assert.equal(matchRecording({ ...recording, isrc: "USABC2600001" }, { ...recording, isrc: "USABC2600002" }), null);
});

test("search groups keep alternate takes separate from the original even at the same duration", () => {
  const result: DiscoveryResult = { ...recording, sourceId: "metadata_graph", externalId: "1", access: "metadata", sourcePageUrl: "https://musicbrainz.org/" };
  const groups = groupDiscoveryResults([
    result,
    { ...result, externalId: "2", title: "Вечер (Official Video)" },
    { ...result, externalId: "3", title: "Вечер (Live)" }
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups.find(({ title }) => title === "Вечер")?.alternatives.length, 1);
});

test("playback resolver skips gated tracks and mismatches and selects permitted matching audio", async (t) => {
  const track = (id: string, title: string, duration: number, is_stream_gated = false) => ({
    id, title, duration, is_stream_gated, is_streamable: true, user: { name: recording.artist }
  });
  let results = [
    track("gated", recording.title, 180, true),
    track("remix", "Вечер (Remix)", 180),
    track("length", recording.title, 240),
    track("right", recording.title, 182)
  ];
  t.mock.method(globalThis, "fetch", async (input: string) => {
    assert.equal(new URL(input).host, "api.audius.co");
    return Response.json({ data: results });
  });
  const resolved = await resolveBestTrack({ ...recording, playbackOnly: true }, {});
  assert.equal(resolved.track?.externalId, "right");
  assert.equal(resolved.matched_via, "meta+duration");
  assert.equal(resolved.track?.audioUrl, "https://api.audius.co/v1/tracks/right/stream?app_name=SONORA");
  results = results.slice(0, -1);
  assert.equal((await resolveBestTrack({ ...recording, playbackOnly: true }, {})).found, false);
});
