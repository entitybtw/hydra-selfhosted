import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-oidc-off-"));

before(async () => {
  process.env.DATA_DIR = dataDir;
  delete process.env.OIDC_ISSUER;
  delete process.env.OIDC_CLIENT_ID;
  const { webRoutes } = await import("../src/routes/web");
  app = (await import("fastify")).default();
  app.register((await import("@fastify/cookie")).default);
  app.register(webRoutes);
  await app.ready();
});

after(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("without OIDC config the login pages and local sign-in are unchanged", async () => {
  for (const page of [await app.inject({ url: "/" }), await app.inject({ url: "/", cookies: { gate_ok: "1" } })]) {
    assert.doesNotMatch(page.body, /oidc|SSO/);
  }
  assert.equal((await app.inject({ url: "/web/oidc/login" })).statusCode, 404);
  assert.equal((await app.inject({ url: "/web/oidc/callback?code=x&state=y" })).statusCode, 404);

  const register = await app.inject({ method: "POST", url: "/web/login", payload: { username: "bob", password: "pw", action: "register" } });
  assert.equal(register.headers.location, "/web/dashboard");
  const login = await app.inject({ method: "POST", url: "/web/login", payload: { username: "bob", password: "pw", action: "login" } });
  assert.equal(login.headers.location, "/web/dashboard");
});
