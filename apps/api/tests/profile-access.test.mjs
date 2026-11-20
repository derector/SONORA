import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerProfileRoutes } from "../dist/profile-routes.js";

function fixture(visibility = "private") {
  const queries = [];
  const target = { id: "owner", username: "alex", display_name: "Alex", visibility, show_history: false };
  const client = {
    auth: { getUser: async (token) => ({ data: { user: token === "owner-token" ? { id: "owner" } : { id: "other" } } }) },
    from(table) {
      queries.push(table);
      const chain = {
        select() { return this; }, eq() { return this; }, order() { return this; },
        async maybeSingle() {
          if (table !== "public_profiles") throw new Error(`Unexpected private read: ${table}`);
          return { data: target, error: null };
        },
        async limit() {
          assert.equal(table, "playlists");
          return { data: [], error: null };
        }
      };
      return chain;
    }
  };
  const app = Fastify();
  registerProfileRoutes(app, {
    authClient: () => client,
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
      assert.equal(result.statusCode, 403);
      assert.match(result.json().error, /private/i);
      assert.deepEqual(queries, ["public_profiles"], "No history, follows or playlists query may run");
    } finally { await app.close(); }
  });
}

test("another signed-in viewer cannot read a private follower list", async () => {
  const { app, queries } = fixture();
  try {
    const result = await app.inject({ method: "GET", url: "/api/v1/users/alex/followers", headers: { authorization: "Bearer viewer-token" } });
    assert.equal(result.statusCode, 403);
    assert.deepEqual(queries, ["public_profiles"]);
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

test("unknown visibility fails closed", async () => {
  const { app, queries } = fixture("invalid");
  try {
    const result = await app.inject({ method: "GET", url: "/api/v1/users/alex/playlists" });
    assert.equal(result.statusCode, 403);
    assert.deepEqual(queries, ["public_profiles"]);
  } finally { await app.close(); }
});
