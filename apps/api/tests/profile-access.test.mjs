import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerProfileRoutes } from "../dist/profile-routes.js";

function fixture(visibility = "private") {
  const queries = [];
  const own = {
    id: "owner", username: "alex", display_name: "Alex",
    privacy: { profile: visibility, history: false },
    bio: null, links: [], favorite_genres: [], created_at: "2026-01-01T00:00:00Z"
  };
  const publicTarget = visibility === "public"
    ? { ...own, visibility: "public", show_history: false }
    : null;
  const clientFor = (token) => ({
    auth: { getUser: async (value) => ({ data: { user: value === "owner-token" ? { id: "owner" } : { id: "other" } } }) },
    from(table) {
      queries.push(table);
      const chain = {
        select() { return this; }, eq() { return this; }, order() { return this; },
        async maybeSingle() {
          if (table === "public_profiles") return { data: publicTarget, error: null };
          if (table === "users") return { data: token === "owner-token" ? own : null, error: null };
          if (table === "playlists") return { data: null, error: null };
          throw new Error(`Unexpected private read: ${table}`);
        },
        async limit() {
          assert.equal(table, "playlists");
          return { data: [], error: null };
        }
      };
      return chain;
    }
  });
  const app = Fastify();
  registerProfileRoutes(app, {
    authClient: (token) => clientFor(token),
    requireUser: async (_request, reply) => { reply.code(401).send({ error: "Sign in" }); return null; },
    authError: (statusCode, error) => ({ statusCode, error })
  });
  return { app, queries };
}

for (const suffix of ["", "/playlists", "/followers", "/following"]) {
  test(`anonymous cannot read private profile${suffix || ' root'}`, async () => {
    const { app, queries } = fixture();
    try {
      const result = await app.inject({ method: "GET", url: `/api/v1/users/alex${suffix}` });
      assert.equal(result.statusCode, 404);
      assert.deepEqual(queries, ["public_profiles"], "No private profile, history, follows or playlists query may run");
    } finally { await app.close(); }
  });
}

test("another signed-in viewer cannot read a private follower list", async () => {
  const { app, queries } = fixture();
  try {
    const result = await app.inject({ method: "GET", url: "/api/v1/users/alex/followers", headers: { authorization: "Bearer viewer-token" } });
    assert.equal(result.statusCode, 404);
    assert.deepEqual(queries, ["public_profiles", "users"]);
  } finally { await app.close(); }
});

test("verified owner can still read own private public-playlist listing", async () => {
  const { app } = fixture();
  try {
    const result = await app.inject({ method: "GET", url: "/api/v1/users/alex/playlists", headers: { authorization: "Bearer owner-token" } });
    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.json(), { username: "alex", items: [] });
  } finally { await app.close(); }
});

test("unknown visibility is omitted from the public projection", async () => {
  const { app, queries } = fixture("invalid");
  try {
    const result = await app.inject({ method: "GET", url: "/api/v1/users/alex/playlists" });
    assert.equal(result.statusCode, 404);
    assert.deepEqual(queries, ["public_profiles"]);
  } finally { await app.close(); }
});
