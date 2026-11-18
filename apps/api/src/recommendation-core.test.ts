import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rankRecommendations } from "./recommendation-core.js";

describe("rankRecommendations", () => {
  it("ranks tracks by liked artists", () => {
    const result = rankRecommendations([
      { id: "a", title: "Track A", artist: "Artist A" },
      { id: "b", title: "Track B", artist: "Artist B" }
    ], [{ artist: "Artist A", liked: true }]);
    assert.equal(result[0]?.id, "a");
  });

  it("penalizes skipped artists", () => {
    const result = rankRecommendations([
      { id: "a", title: "Track A", artist: "Skipped" },
      { id: "b", title: "Track B", artist: "Other" }
    ], [{ artist: "Skipped", skipped: true }]);
    assert.equal(result[0]?.id, "b");
  });

  it("normalizes Russian ё/e in artist names", () => {
    const result = rankRecommendations([
      { id: "a", title: "Track A", artist: "Елка" },
      { id: "b", title: "Track B", artist: "Other" }
    ], [{ artist: "Ёлка", liked: true }]);
    assert.equal(result[0]?.id, "a");
  });

  it("limits each artist to two results and clamps output limit to 50", () => {
    const candidates = Array.from({ length: 70 }, (_, i) => ({
      id: String(i), title: `Track ${i}`, artist: i < 5 ? "Same" : `Artist ${i}`
    }));
    const result = rankRecommendations(candidates, [], 99);
    assert.ok(result.length <= 50);
    assert.ok(result.filter((track) => track.artist === "Same").length <= 2);
  });

  it("returns no recommendations when the requested limit is zero", () => {
    const result = rankRecommendations([
      { id: "a", title: "Track A", artist: "Artist A" }
    ], [], 0);
    assert.deepEqual(result, []);
  });

  it("returns an empty result for an empty catalog", () => {
    assert.deepEqual(rankRecommendations([], [], 20), []);
  });
});
