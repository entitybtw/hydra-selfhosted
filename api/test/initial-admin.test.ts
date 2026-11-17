import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let db: typeof import("../src/db").db;
let enforceInitialAdmin: typeof import("../src/db").enforceInitialAdmin;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-initial-admin-"));

before(async () => {
  Object.assign(process.env, { DATA_DIR: dataDir, INITIAL_ADMIN_USERNAME: "admin" });
  ({ db, enforceInitialAdmin } = await import("../src/db"));
});

after(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const addUser = (id: string, username: string) =>
  db.prepare("INSERT INTO users (id, username, password_hash, display_name) VALUES (?, ?, 'x', ?)").run(id, username, username);
const rename = (id: string, username: string) => db.prepare("UPDATE users SET username = ? WHERE id = ?").run(username, id);
const isAdmin = (id: string) => JSON.parse((db.prepare("SELECT roles FROM users WHERE id = ?").get(id) as { roles: string | null }).roles || "[]").includes("admin");

test("only the account named INITIAL_ADMIN_USERNAME is promoted", () => {
  addUser("u-mallory", "mallory");
  enforceInitialAdmin();
  assert.equal(isAdmin("u-mallory"), false);

  addUser("u-operator", "admin");
  enforceInitialAdmin();
  assert.equal(isAdmin("u-operator"), true);
  assert.equal(isAdmin("u-mallory"), false);
});

test("taking the name after the admin renamed their account gives no admin role", () => {
  rename("u-operator", "pablo");
  rename("u-mallory", "admin");
  enforceInitialAdmin();
  assert.equal(isAdmin("u-mallory"), false);
  assert.equal(isAdmin("u-operator"), true);
});
