import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import bcrypt from "bcryptjs";
import type { FastifyInstance, InjectOptions } from "fastify";

let app: FastifyInstance;
let db: typeof import("../src/db").db;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-admin-"));

const addUser = (id: string) =>
  db.prepare("INSERT INTO users (id, username, password_hash, display_name) VALUES (?, ?, ?, ?)").run(id, id, bcrypt.hashSync("secret", 4), id);
const passwordHash = (id: string) => (db.prepare("SELECT password_hash FROM users WHERE id = ?").get(id) as any).password_hash;

before(async () => {
  process.env.DATA_DIR = dataDir;
  ({ db } = await import("../src/db"));
  const { adminRoutes } = await import("../src/routes/admin");
  app = (await import("fastify")).default();
  app.register(adminRoutes);
  await app.ready();
});

after(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("without INSTANCE_TOKEN every admin route refuses and changes nothing", async () => {
  addUser("victim");
  const requests: InjectOptions[] = [
    { method: "PUT", url: "/admin/users/victim", payload: { password: "pwned" } },
    { method: "DELETE", url: "/admin/users/victim" },
    { method: "POST", url: "/admin/users", payload: { username: "mallory", password: "pwned" } },
    { method: "GET", url: "/admin/users" },
    { method: "GET", url: "/admin/stats" },
  ];
  for (const token of [undefined, ""]) {
    if (token === undefined) delete process.env.INSTANCE_TOKEN;
    else process.env.INSTANCE_TOKEN = token;
    for (const request of requests) {
      const res = await app.inject(request);
      assert.equal(res.statusCode, 403, `${request.method} ${request.url} with INSTANCE_TOKEN=${JSON.stringify(token)}`);
    }
  }
  assert.ok(bcrypt.compareSync("secret", passwordHash("victim")));
  assert.equal(db.prepare("SELECT id FROM users WHERE username = 'mallory'").get(), undefined);
});

test("with INSTANCE_TOKEN set, only that bearer token gets in", async () => {
  addUser("member");
  process.env.INSTANCE_TOKEN = "admin-secret";
  const put = (headers: Record<string, string>) =>
    app.inject({ method: "PUT", url: "/admin/users/member", headers, payload: { password: "changed" } });
  assert.equal((await put({})).statusCode, 401);
  assert.equal((await put({ authorization: "Bearer wrong" })).statusCode, 403);
  assert.ok(bcrypt.compareSync("secret", passwordHash("member")));
  assert.equal((await put({ authorization: "Bearer admin-secret" })).statusCode, 200);
  assert.ok(bcrypt.compareSync("changed", passwordHash("member")));
});
