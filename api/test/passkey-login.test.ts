import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-passkey-"));

before(async () => {
  process.env.DATA_DIR = dataDir;
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

test("the launcher's passkey page sends the token to its numeric callback port", async () => {
  const res = await app.inject({ url: "/web/passkey-login?launcher=1&callback_port=51234" });
  assert.match(res.body, /window\.location\.href = "http:\/\/127\.0\.0\.1:51234\/token\/"/);
});

test("a callback_port that is not a number is ignored instead of written into the script", async () => {
  for (const port of ['1";alert(document.domain);"', '";alert(document.domain);//1']) {
    const res = await app.inject({ url: `/web/passkey-login?launcher=1&callback_port=${encodeURIComponent(port)}` });
    assert.doesNotMatch(res.body, /127\.0\.0\.1|alert\(document\.domain\)/);
  }
});
