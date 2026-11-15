import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { db } from "../db";

function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10);
}

// This API speaks a single role; users keep a JSON roles array, as the web admin panel writes it.
const ROLES = ["admin", "user"];

function roleOf(roles: string | null): string {
  try {
    const parsed = JSON.parse(roles || "[]");
    if (Array.isArray(parsed) && parsed.includes("admin")) return "admin";
  } catch {}
  return "user";
}

function verifyInstanceToken(req: FastifyRequest, reply: FastifyReply): boolean {
  const token = process.env.INSTANCE_TOKEN;
  if (!token) {
    reply.code(403).send({ error: "admin API disabled: INSTANCE_TOKEN is not set" });
    return false;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    reply.code(401).send({ error: "missing or invalid authorization header" });
    return false;
  }

  const provided = authHeader.slice(7);
  if (provided !== token) {
    reply.code(403).send({ error: "invalid instance token" });
    return false;
  }

  return true;
}

export async function adminRoutes(app: FastifyInstance) {
  app.get("/admin/stats", async (req: FastifyRequest, reply: FastifyReply) => {
    if (!verifyInstanceToken(req, reply)) return;

    const userCount = (db.prepare("SELECT COUNT(*) as count FROM users").get() as any).count;
    const gameCount = (db.prepare("SELECT COUNT(*) as count FROM games").get() as any).count;
    // Saves live in artifacts (backups) and cs_snapshots (Saves v2).
    const saveCount = (db.prepare("SELECT (SELECT COUNT(*) FROM artifacts) + (SELECT COUNT(*) FROM cs_snapshots) as count").get() as any).count;

    return { users: userCount, games: gameCount, saves: saveCount };
  });

  app.get("/admin/users", async (req: FastifyRequest, reply: FastifyReply) => {
    if (!verifyInstanceToken(req, reply)) return;

    const users = db.prepare(
      "SELECT id, username, display_name, roles, created_at, steam_id FROM users ORDER BY created_at DESC"
    ).all() as { roles: string | null }[];

    return { users: users.map(({ roles, ...user }) => ({ ...user, role: roleOf(roles) })) };
  });

  app.post("/admin/users", async (req: FastifyRequest<{ Body: { username: string; password: string; role?: string } }>, reply: FastifyReply) => {
    if (!verifyInstanceToken(req, reply)) return;

    const { username, password, role = "user" } = req.body;
    if (!username || !password) {
      return reply.code(400).send({ error: "username and password required" });
    }
    if (!ROLES.includes(role)) {
      return reply.code(400).send({ error: "role must be admin or user" });
    }

    const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
    if (existing) {
      return reply.code(409).send({ error: "username taken" });
    }

    const id = crypto.randomUUID();
    db.prepare(
      "INSERT INTO users (id, username, password_hash, display_name, roles) VALUES (?, ?, ?, ?, ?)"
    ).run(id, username, hashPassword(password), username, JSON.stringify(role === "admin" ? ["admin"] : []));

    return { id, username, role };
  });

  app.put("/admin/users/:id", async (req: FastifyRequest<{ Params: { id: string }; Body: { username?: string; password?: string; role?: string } }>, reply: FastifyReply) => {
    if (!verifyInstanceToken(req, reply)) return;

    const { id } = req.params;
    const { username, password, role } = req.body;
    if (role !== undefined && !ROLES.includes(role)) {
      return reply.code(400).send({ error: "role must be admin or user" });
    }

    const user = db.prepare("SELECT id FROM users WHERE id = ?").get(id);
    if (!user) {
      return reply.code(404).send({ error: "user not found" });
    }

    if (username) {
      const existing = db.prepare("SELECT id FROM users WHERE username = ? AND id != ?").get(username, id);
      if (existing) {
        return reply.code(409).send({ error: "username taken" });
      }
    }

    const updates: string[] = [];
    const values: any[] = [];

    if (username) {
      updates.push("username = ?", "display_name = ?");
      values.push(username, username);
    }
    if (password) {
      updates.push("password_hash = ?");
      values.push(hashPassword(password));
    }
    if (role) {
      updates.push("roles = ?");
      values.push(JSON.stringify(role === "admin" ? ["admin"] : []));
    }

    if (updates.length === 0) {
      return reply.code(400).send({ error: "no fields to update" });
    }

    values.push(id);
    db.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`).run(...values);

    return { ok: true };
  });

  app.delete("/admin/users/:id", async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    if (!verifyInstanceToken(req, reply)) return;

    const { id } = req.params;
    const user = db.prepare("SELECT id FROM users WHERE id = ?").get(id);
    if (!user) {
      return reply.code(404).send({ error: "user not found" });
    }

    db.prepare("DELETE FROM users WHERE id = ?").run(id);
    return { ok: true };
  });
}
