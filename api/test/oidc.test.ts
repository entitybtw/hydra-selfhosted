import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";

// Minimal OpenID provider that checks client auth, redirect_uri and PKCE like a real one.
const codes = new Map<string, { challenge: string; redirectUri: string }>();
let claims: Record<string, string> = { sub: "sub-1", preferred_username: "pablo", name: "Pablo" };
let issuer = "";
const idp = http.createServer(async (req, res) => {
  const url = new URL(req.url!, issuer);
  const json = (status: number, body: object) => res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
  if (url.pathname === "/.well-known/openid-configuration") {
    return json(200, { issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, userinfo_endpoint: `${issuer}/userinfo` });
  }
  if (url.pathname === "/authorize") {
    const p = url.searchParams;
    assert.equal(p.get("client_id"), "hydra");
    assert.equal(p.get("code_challenge_method"), "S256");
    assert.match(p.get("scope")!, /\bopenid\b/);
    const code = crypto.randomUUID();
    codes.set(code, { challenge: p.get("code_challenge")!, redirectUri: p.get("redirect_uri")! });
    return res.writeHead(302, { Location: `${p.get("redirect_uri")}?code=${code}&state=${p.get("state")}` }).end();
  }
  if (url.pathname === "/token") {
    let body = "";
    for await (const chunk of req) body += chunk;
    const p = new URLSearchParams(body);
    const grant = codes.get(p.get("code")!);
    codes.delete(p.get("code")!);
    const pkceOk = grant && crypto.createHash("sha256").update(p.get("code_verifier") ?? "").digest("base64url") === grant.challenge;
    if (req.headers.authorization !== `Basic ${Buffer.from("hydra:s3cret").toString("base64")}` || !pkceOk || p.get("redirect_uri") !== grant.redirectUri) {
      return json(400, { error: "invalid_grant" });
    }
    return json(200, { access_token: `at-${JSON.stringify(claims)}`, token_type: "Bearer" });
  }
  if (url.pathname === "/userinfo" && req.headers.authorization?.startsWith("Bearer at-")) {
    return json(200, JSON.parse(req.headers.authorization.slice("Bearer at-".length)));
  }
  json(404, {});
});

let app: FastifyInstance;
let db: typeof import("../src/db").db;
let verifyToken: typeof import("../src/auth").verifyToken;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-oidc-"));
const logs: string[] = [];

before(async () => {
  await new Promise<void>(resolve => idp.listen(0, "127.0.0.1", resolve));
  issuer = `http://127.0.0.1:${(idp.address() as AddressInfo).port}`;
  Object.assign(process.env, { DATA_DIR: dataDir, OIDC_ISSUER: `${issuer}/`, OIDC_CLIENT_ID: "hydra", OIDC_CLIENT_SECRET: "s3cret", PUBLIC_URL: "http://hydra.test" });
  ({ db } = await import("../src/db"));
  ({ verifyToken } = await import("../src/auth"));
  const { webRoutes } = await import("../src/routes/web");
  app = (await import("fastify")).default({ logger: { level: "warn", stream: { write: (line: string) => { logs.push(line); } } } });
  app.register((await import("@fastify/cookie")).default);
  app.register(webRoutes);
  await app.ready();
});

after(async () => {
  await app.close();
  idp.close();
  idp.closeAllConnections();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

// Walks the browser through login -> provider -> callback, as the launcher's auth window does.
async function signIn(query = "", tamperState = false) {
  const start = await app.inject({ url: `/web/oidc/login${query}` });
  assert.equal(start.statusCode, 302);
  const cookie = start.cookies.find(c => c.name === "oidc_state")!;
  const authorize = await fetch(start.headers.location as string, { redirect: "manual" });
  const callback = new URL(authorize.headers.get("location")!);
  assert.equal(callback.origin + callback.pathname, "http://hydra.test/web/oidc/callback");
  if (tamperState) callback.searchParams.set("state", "forged");
  return app.inject({ url: callback.pathname + callback.search, cookies: { oidc_state: cookie.value } });
}

test("login pages offer SSO and keep the launcher flag", async () => {
  const gate = await app.inject({ url: "/?launcher=1" });
  assert.match(gate.body, /href="\/web\/oidc\/login\?launcher=1"/);
  const login = await app.inject({ url: "/", cookies: { gate_ok: "1" } });
  assert.match(login.body, /href="\/web\/oidc\/login"/);
});

test("first launcher sign-in registers the user and hands the token to the launcher", async () => {
  const res = await signIn("?launcher=1");
  assert.equal(res.statusCode, 302);
  const location = res.headers.location as string;
  assert.ok(location.startsWith("hydra-self-hosted://token/"), location);
  const userId = verifyToken(location.slice("hydra-self-hosted://token/".length), "access");
  const user = db.prepare("SELECT username, display_name, oidc_sub, password_hash FROM users WHERE id = ?").get(userId);
  assert.deepEqual(user, { username: "pablo", display_name: "Pablo", oidc_sub: "sub-1", password_hash: "" });
});

test("next browser sign-in reuses the account and sets the web session", async () => {
  const res = await signIn();
  assert.equal(res.headers.location, "/web/dashboard");
  const userId = verifyToken(res.cookies.find(c => c.name === "web_token")!.value, "access");
  assert.equal((db.prepare("SELECT oidc_sub FROM users WHERE id = ?").get(userId) as any).oidc_sub, "sub-1");
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM users").get() as any).n, 1);
});

test("SSO never takes over a local account with the same username", async () => {
  db.prepare("INSERT INTO users (id, username, password_hash, display_name) VALUES ('local-alice', 'alice', 'x', 'alice')").run();
  claims = { sub: "sub-2", preferred_username: "alice" };
  const res = await signIn();
  const userId = verifyToken(res.cookies.find(c => c.name === "web_token")!.value, "access");
  assert.notEqual(userId, "local-alice");
  assert.match((db.prepare("SELECT username FROM users WHERE id = ?").get(userId) as any).username, /^alice_[0-9a-f]{4}$/);
  assert.equal((db.prepare("SELECT oidc_sub FROM users WHERE id = 'local-alice'").get() as any).oidc_sub, null);
});

test("a forged state is rejected without creating a user", async () => {
  const before = (db.prepare("SELECT COUNT(*) AS n FROM users").get() as any).n;
  claims = { sub: "sub-3", preferred_username: "mallory" };
  const res = await signIn("", true);
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Single sign-on failed/);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM users").get() as any).n, before);
});

test("a provider error, e.g. the user cancelling, fails cleanly and is logged as such", async () => {
  const start = await app.inject({ url: "/web/oidc/login" });
  const cookie = start.cookies.find(c => c.name === "oidc_state")!;
  const state = new URL(start.headers.location as string).searchParams.get("state");
  const res = await app.inject({ url: `/web/oidc/callback?error=access_denied&state=${state}`, cookies: { oidc_state: cookie.value } });
  assert.match(res.body, /Single sign-on failed/);
  assert.match(logs.at(-1)!, /provider returned access_denied/);
});

test("an SSO-only account cannot sign in with a password", async () => {
  for (const password of ["", "anything"]) {
    const res = await app.inject({ method: "POST", url: "/web/login", payload: { username: "pablo", password, action: "login" } });
    assert.match(res.body, /Invalid username or password/);
  }
});
