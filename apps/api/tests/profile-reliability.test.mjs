import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerProfileRoutes } from "../dist/profile-routes.js";

function fixture({ failTable = "", privatePeople = false, failCards = false } = {}) {
  const owner = { id: "owner", username: "alex", display_name: "Alex", visibility: "public", favorite_genres: [] };
  const people = Array.from({ length: 50 }, (_, i) => ({ id: `person-${i}`, username: `user_${i}`, display_name: `Person ${i}`, avatar_url: null, visibility: privatePeople ? "private" : "public" }));
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: "owner" } } }) },
    from(table) {
      let single = false, count = false, cards = false, ranged = false;
      const chain = {
        select(_columns, options) { count = Boolean(options?.head); return this; },
        eq() { return this; }, gte() { return this; }, lt() { return this; }, order() { return this; },
        limit() { return this; }, in() { cards = true; return this; }, range() { ranged = true; return this; },
        maybeSingle() { single = true; return this; },
        then(resolve, reject) {
          const failed = table === failTable || (failCards && table === "public_profiles" && cards);
          let data = [];
          if (single) data = owner;
          else if (table === "public_profiles" && cards) data = people;
          else if (table === "user_follows" && ranged) data = people.map((p) => ({ follower_id: p.id, followee_id: p.id, created_at: "2026-11-20T00:00:00Z" }));
          return Promise.resolve({ data: failed ? null : data, error: failed ? { code: "42P01", message: "Fixture failure" } : null, count: count ? 0 : null }).then(resolve, reject);
        }
      };
      return chain;
    }
  };
  const app = Fastify();
  registerProfileRoutes(app, {
    authClient: () => client,
    requireUser: async () => ({ user: { id: "owner" }, client }),
    authError: (statusCode, error) => ({ statusCode, error })
  });
  return app;
}

async function get(path, options) {
  const app = fixture(options);
  try { return await app.inject({ method: "GET", url: `/api/v1${path}`, headers: { authorization: "Bearer fixture" } }); }
  finally { await app.close(); }
}

test("genuinely empty statistics return real zeros", async () => {
  const result = await get("/profile/stats");
  assert.equal(result.statusCode, 200);
  assert.equal(result.json().minutes.total, 0);
  assert.equal(result.json().windowDays, 180);
  assert.equal(result.json().historyMayBeTruncated, false);
});

for (const table of ["provider_listening_events", "listening_events", "users", "user_follows", "user_provider_favorites"]) {
  test(`statistics failure in ${table} is unavailable, not a fake empty profile`, async () => {
    const result = await get("/profile/stats", { failTable: table });
    assert.equal(result.statusCode, 503);
    assert.equal(result.json().minutes, undefined);
  });
}

for (const table of ["users", "track_feedback"]) {
  test(`taste failure in ${table} is not fabricated empty preference data`, async () => {
    const result = await get("/profile/taste", { failTable: table });
    assert.equal(result.statusCode, 503);
    assert.equal(result.json().genres, undefined);
  });
}

test("a full raw page of hidden people still offers the next page", async () => {
  const result = await get("/users/alex/followers", { privatePeople: true });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.json().items, []);
  assert.equal(result.json().hasMore, true);
  assert.equal(result.json().nextOffset, 50);
});

test("pagination ends at its bounded offset instead of looping", async () => {
  const result = await get("/users/alex/followers?offset=5000");
  assert.equal(result.statusCode, 200);
  assert.equal(result.json().hasMore, false);
  assert.equal(result.json().nextOffset, null);
});

test("people-card lookup failure is not displayed as an empty follower list", async () => {
  const result = await get("/users/alex/followers", { failCards: true });
  assert.equal(result.statusCode, 503);
  assert.equal(result.json().items, undefined);
});
