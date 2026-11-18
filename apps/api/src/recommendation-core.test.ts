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
  it("ranks matching liked genres and penalizes skipped genres", () => {
    const result = rankRecommendations([
      { id: "liked", title: "Track L", artist: "Artist L", genres: ["electronic"] },
      { id: "skipped", title: "Track S", artist: "Artist S", genres: ["metal"] },
      { id: "neutral", title: "Track N", artist: "Artist N", genres: ["ambient"] }
    ], [
      { artist: "Favorite", genres: ["electronic"], liked: true },
      { artist: "Avoid", genres: ["metal"], skipped: true }
    ]);
    assert.equal(result[0]?.id, "liked");
    assert.ok(result.find((track) => track.id === "skipped")!.score < result.find((track) => track.id === "neutral")!.score);
  });

  it("sorts equal-score candidates deterministically by normalized title", () => {
    const result = rankRecommendations([
      { id: "z", title: "Zebra", artist: "Z" },
      { id: "a", title: "Alpha", artist: "A" }
    ], []);
    assert.deepEqual(result.map((track) => track.id), ["a", "z"]);
  });

});
