import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;
let db: typeof import("../src/db").db;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-admin-routes-"));
const headers = { authorization: "Bearer instance-secret" };

before(async () => {
  Object.assign(process.env, { DATA_DIR: dataDir, INSTANCE_TOKEN: "instance-secret" });
  ({ db } = await import("../src/db"));
  const { adminRoutes } = await import("../src/routes/admin");
  app = (await import("fastify")).default();
  app.register(adminRoutes);
  await app.ready();

  // Roles as the rest of the server stores them: a JSON array, NULL after a normal sign-up.
  const user = db.prepare("INSERT INTO users (id, username, password_hash, display_name, roles, steam_id, created_at) VALUES (?, ?, 'x', ?, ?, ?, ?)");
  user.run("u-alice", "alice", "Alice", '["admin"]', "76561198000000001", 1000);
  user.run("u-bob", "bob", "Bob", null, null, 2000);
  user.run("u-carol", "carol", "Carol", "[]", null, 3000);
  user.run("u-dave", "dave", "Dave", "not json", null, 4000);
  db.prepare("INSERT INTO games (id, user_id, object_id, shop, title) VALUES ('g1', 'u-bob', '42', 'steam', 'Game')").run();
  db.prepare("INSERT INTO artifacts (id, user_id, object_id, shop, hostname, home_dir, platform) VALUES ('a1', 'u-bob', '42', 'steam', 'pc', '/home/bob', 'linux')").run();
  const snapshot = db.prepare("INSERT INTO cs_snapshots (id, user_id, shop, object_id, version, aggregate_hash) VALUES (?, 'u-bob', 'steam', '42', ?, 'h')");
  snapshot.run("s1", 1);
  snapshot.run("s2", 2);
});

after(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const rolesOf = (id: string) => JSON.parse((db.prepare("SELECT roles FROM users WHERE id = ?").get(id) as { roles: string }).roles);

test("stats count saves from both cloud save stores", async () => {
  const res = await app.inject({ url: "/admin/stats", headers });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { users: 4, games: 1, saves: 3 });
});

test("the user list shows admin or user from the roles array", async () => {
  const res = await app.inject({ url: "/admin/users", headers });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json().users, [
    { id: "u-dave", username: "dave", display_name: "Dave", role: "user", created_at: 4000, steam_id: null },
    { id: "u-carol", username: "carol", display_name: "Carol", role: "user", created_at: 3000, steam_id: null },
    { id: "u-bob", username: "bob", display_name: "Bob", role: "user", created_at: 2000, steam_id: null },
    { id: "u-alice", username: "alice", display_name: "Alice", role: "admin", created_at: 1000, steam_id: "76561198000000001" },
  ]);
});

test("creating a user stores the role the way the web admin panel does", async () => {
  const admin = await app.inject({ method: "POST", url: "/admin/users", headers, payload: { username: "erin", password: "pw", role: "admin" } });
  assert.equal(admin.statusCode, 200);
  assert.equal(admin.json().role, "admin");
  assert.deepEqual(rolesOf(admin.json().id), ["admin"]);

  const plain = await app.inject({ method: "POST", url: "/admin/users", headers, payload: { username: "frank", password: "pw" } });
  assert.equal(plain.statusCode, 200);
  assert.equal(plain.json().role, "user");
  assert.deepEqual(rolesOf(plain.json().id), []);

  const bad = await app.inject({ method: "POST", url: "/admin/users", headers, payload: { username: "gina", password: "pw", role: "owner" } });
  assert.equal(bad.statusCode, 400);
  assert.equal(db.prepare("SELECT id FROM users WHERE username = 'gina'").get(), undefined);
});

test("updating a user's role promotes and demotes, other updates keep it", async () => {
  const put = (id: string, payload: object) => app.inject({ method: "PUT", url: `/admin/users/${id}`, headers, payload });

  assert.equal((await put("u-bob", { role: "admin" })).statusCode, 200);
  assert.deepEqual(rolesOf("u-bob"), ["admin"]);
  assert.equal((await put("u-bob", { role: "user" })).statusCode, 200);
  assert.deepEqual(rolesOf("u-bob"), []);
  assert.equal((await put("u-bob", { role: "owner" })).statusCode, 400);
  assert.deepEqual(rolesOf("u-bob"), []);

  assert.equal((await put("u-alice", { password: "new" })).statusCode, 200);
  assert.deepEqual(rolesOf("u-alice"), ["admin"]);
});

test("deleting a user removes them", async () => {
  assert.equal((await app.inject({ method: "DELETE", url: "/admin/users/u-carol", headers })).statusCode, 200);
  assert.equal(db.prepare("SELECT id FROM users WHERE id = 'u-carol'").get(), undefined);
  assert.equal((await app.inject({ method: "DELETE", url: "/admin/users/u-carol", headers })).statusCode, 404);
});
