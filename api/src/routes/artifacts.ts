import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { db, ARTIFACTS_DIR } from "../db";
import { requireAuth } from "./auth";
import { signAccess, verifyToken } from "../auth";

interface DbArtifact {
  id: string;
  user_id: string;
  object_id: string;
  shop: string;
  hostname: string;
  wine_prefix_path: string | null;
  home_dir: string;
  download_option_title: string | null;
  platform: string;
  label: string | null;
  artifact_length_in_bytes: number;
  file_path: string | null;
  is_frozen: number;
  download_count: number;
  created_at: number;
  updated_at: number;
}

function formatArtifact(a: DbArtifact) {
  return {
    id: a.id,
    artifactLengthInBytes: a.artifact_length_in_bytes,
    downloadOptionTitle: a.download_option_title,
    createdAt: new Date(a.created_at * 1000).toISOString(),
    updatedAt: new Date(a.updated_at * 1000).toISOString(),
    hostname: a.hostname,
    downloadCount: a.download_count,
    label: a.label,
    isFrozen: Boolean(a.is_frozen),
  };
}

export async function artifactsRoutes(app: FastifyInstance) {
  app.post(
    "/profile/games/artifacts",
    { preHandler: requireAuth },
    async (
      req: FastifyRequest<{
        Body: {
          artifactLengthInBytes: number;
          shop: string;
          objectId: string;
          hostname: string;
          winePrefixPath: string | null;
          homeDir: string;
          downloadOptionTitle: string | null;
          platform: string;
          label?: string;
        };
      }>
    ) => {
      const userId = (req as any).userId;
      const id = crypto.randomUUID();
      const { artifactLengthInBytes, shop, objectId, hostname, winePrefixPath, homeDir, downloadOptionTitle, platform, label } = req.body;

      db.prepare(`
        INSERT INTO artifacts (id, user_id, object_id, shop, hostname, wine_prefix_path, home_dir, download_option_title, platform, label, artifact_length_in_bytes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, userId, objectId, shop, hostname, winePrefixPath ?? null, homeDir, downloadOptionTitle ?? null, platform, label ?? null, artifactLengthInBytes);

      // uploadUrl points back to this server — client will PUT the file here
      const uploadToken = signAccess(userId);
      const host = req.headers.host ?? "localhost:3000";
      const proto = req.headers["x-forwarded-proto"] ?? "http";
      const uploadUrl = `${proto}://${host}/artifacts/${id}/upload?token=${uploadToken}`;

      return { id, uploadUrl };
    }
  );

  app.get(
    "/profile/games/artifacts",
    { preHandler: requireAuth },
    async (req: FastifyRequest<{ Querystring: { objectId?: string; shop?: string } }>) => {
      const userId = (req as any).userId;
      const { objectId, shop } = req.query;
      const artifacts = db
        .prepare(
          "SELECT * FROM artifacts WHERE user_id = ? AND object_id = ? AND shop = ? ORDER BY created_at DESC"
        )
        .all(userId, objectId, shop) as DbArtifact[];
      return artifacts.map(formatArtifact);
    }
  );

  app.get(
    "/profile/games/:shop/:objectId/artifacts",
    { preHandler: requireAuth },
    async (req: FastifyRequest<{ Params: { shop: string; objectId: string } }>) => {
      const userId = (req as any).userId;
      const artifacts = db
        .prepare(
          "SELECT * FROM artifacts WHERE user_id = ? AND object_id = ? AND shop = ? ORDER BY created_at DESC"
        )
        .all(userId, req.params.objectId, req.params.shop) as DbArtifact[];
      return artifacts.map(formatArtifact);
    }
  );

  app.put(
    "/artifacts/:id/upload",
    async (req: FastifyRequest<{ Params: { id: string }; Querystring: { token: string } }>, reply: FastifyReply) => {
      let userId: string;
      try {
        userId = verifyToken(req.query.token, "access");
      } catch {
        return reply.code(401).send({ error: "invalid token" });
      }

      const artifact = db
        .prepare("SELECT * FROM artifacts WHERE id = ? AND user_id = ?")
        .get(req.params.id, userId) as DbArtifact | undefined;

      if (!artifact) return reply.code(404).send({ error: "artifact not found" });

      const filePath = path.join(ARTIFACTS_DIR, `${req.params.id}.tar`);
      const body = req.body as Buffer;

      await fs.promises.writeFile(filePath, body);
      const stat = await fs.promises.stat(filePath);

      db.prepare(
        "UPDATE artifacts SET file_path = ?, artifact_length_in_bytes = ?, updated_at = unixepoch() WHERE id = ?"
      ).run(filePath, stat.size, req.params.id);

      return {};
    }
  );

  app.get(
    "/artifacts/:id/download",
    async (req: FastifyRequest<{ Params: { id: string }; Querystring: { token: string } }>, reply: FastifyReply) => {
      let userId: string;
      try {
        userId = verifyToken(req.query.token, "access");
      } catch {
        return reply.code(401).send({ error: "invalid token" });
      }

      const artifact = db
        .prepare("SELECT * FROM artifacts WHERE id = ? AND user_id = ?")
        .get(req.params.id, userId) as DbArtifact | undefined;

      if (!artifact?.file_path) return reply.code(404).send({ error: "artifact not found" });

      return reply
        .type("application/octet-stream")
        .send(fs.createReadStream(artifact.file_path));
    }
  );

  app.delete(
    "/artifacts/:id",
    { preHandler: requireAuth },
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const userId = (req as any).userId;
      const artifact = db
        .prepare("SELECT * FROM artifacts WHERE id = ? AND user_id = ?")
        .get(req.params.id, userId) as DbArtifact | undefined;

      if (!artifact) return reply.code(404).send({ error: "not found" });

      if (artifact.file_path) {
        await fs.promises.unlink(artifact.file_path).catch(() => {});
      }
      db.prepare("DELETE FROM artifacts WHERE id = ?").run(req.params.id);
      return {};
    }
  );

  app.delete(
    "/profile/games/artifacts/:id",
    { preHandler: requireAuth },
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const userId = (req as any).userId;
      const artifact = db
        .prepare("SELECT * FROM artifacts WHERE id = ? AND user_id = ?")
        .get(req.params.id, userId) as DbArtifact | undefined;
      if (!artifact) return reply.code(404).send({ error: "not found" });
      if (artifact.file_path) await fs.promises.unlink(artifact.file_path).catch(() => {});
      db.prepare("DELETE FROM artifacts WHERE id = ?").run(req.params.id);
      return {};
    }
  );

  // Download URL endpoint — called by launcher before actual download
  app.post(
    "/profile/games/artifacts/:id/download",
    { preHandler: requireAuth },
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const userId = (req as any).userId;
      const artifact = db
        .prepare("SELECT * FROM artifacts WHERE id = ? AND user_id = ?")
        .get(req.params.id, userId) as DbArtifact | undefined;

      if (!artifact?.file_path) return reply.code(404).send({ error: "artifact not found" });

      const downloadToken = signAccess(userId);
      const host = req.headers.host ?? "localhost:3000";
      const proto = (req.headers["x-forwarded-proto"] as string) ?? "http";
      const downloadUrl = `${proto}://${host}/artifacts/${req.params.id}/download?token=${downloadToken}`;

      db.prepare("UPDATE artifacts SET download_count = download_count + 1 WHERE id = ?").run(req.params.id);

      return {
        downloadUrl,
        objectKey: `${req.params.id}.tar`,
        homeDir: artifact.home_dir,
        winePrefixPath: artifact.wine_prefix_path,
      };
    }
  );

  app.put(
    "/profile/games/artifacts/:id/freeze",
    { preHandler: requireAuth },
    async (req: FastifyRequest<{ Params: { id: string } }>) => {
      db.prepare("UPDATE artifacts SET is_frozen = 1 WHERE id = ? AND user_id = ?").run(req.params.id, (req as any).userId);
      return {};
    }
  );

  app.put(
    "/profile/games/artifacts/:id/unfreeze",
    { preHandler: requireAuth },
    async (req: FastifyRequest<{ Params: { id: string } }>) => {
      db.prepare("UPDATE artifacts SET is_frozen = 0 WHERE id = ? AND user_id = ?").run(req.params.id, (req as any).userId);
      return {};
    }
  );
}
