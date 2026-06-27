import axios from "axios";
import crypto from "crypto";
import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { db } from "../db";
import { requireAuth } from "./auth";

const STEAM_ACHIEVEMENTS = "https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/";

function getAnyApiKey(): string | null {
  const row = db.prepare("SELECT steam_api_key FROM users WHERE steam_api_key IS NOT NULL AND steam_api_key != '' LIMIT 1").get() as { steam_api_key: string } | undefined;
  return row?.steam_api_key ?? null;
}

// Cache source JSON files for 1 hour
const sourceCache = new Map<string, { data: any; ts: number }>();
const SOURCE_TTL = 3600_000;

async function fetchSourceJson(url: string): Promise<any[]> {
  const cached = sourceCache.get(url);
  if (cached && Date.now() - cached.ts < SOURCE_TTL) return cached.data;
  const res = await axios.get(url, { timeout: 15000 });
  const data = Array.isArray(res.data) ? res.data : (res.data?.downloads ?? []);
  sourceCache.set(url, { data, ts: Date.now() });
  return data;
}

export async function gamesRoutes(app: FastifyInstance) {
  app.get(
    "/games/:shop/:objectId/achievements",
    async (req: FastifyRequest<{ Params: { shop: string; objectId: string } }>) => {
      const { shop, objectId } = req.params;
      if (shop !== "steam") return [];
      const apiKey = getAnyApiKey();
      if (!apiKey) return [];
      const res = await axios.get(STEAM_ACHIEVEMENTS, {
        params: { key: apiKey, appid: objectId, l: "english" },
        timeout: 8000,
      }).catch(() => null);
      const achievements = res?.data?.game?.availableGameStats?.achievements ?? [];
      return achievements.map((a: any) => ({
        name: a.name,
        displayName: a.displayName,
        description: a.description ?? "",
        icon: a.icon,
        icongray: a.icongray,
      }));
    }
  );

  // Called by launcher when self-hosted catalogue is enabled
  app.post(
    "/games/:shop/:objectId/download-sources",
    async (req: FastifyRequest<{ Params: { shop: string; objectId: string }; Body: { sourceUrls?: string[] } }>, reply: FastifyReply) => {
      const { objectId } = req.params;
      const sourceUrls: string[] = req.body?.sourceUrls ?? [];
      if (!sourceUrls.length) return [];

      const results: any[] = [];
      await Promise.allSettled(sourceUrls.map(async (url) => {
        const entries = await fetchSourceJson(url).catch(() => [] as any[]);
        const sourceId = crypto.createHash("md5").update(url).digest("hex").slice(0, 8);
        const sourceName = url.split("/").pop()?.replace(/\.json$/, "") ?? url;
        for (const entry of entries) {
          const entryId = String(entry.objectID ?? entry.objectId ?? entry.steam_appid ?? "");
          if (entryId !== objectId) continue;
          const uris: string[] = Array.isArray(entry.uris) ? entry.uris
            : Array.isArray(entry.magnetLinks) ? entry.magnetLinks
            : entry.magnet ? [entry.magnet]
            : entry.uri ? [entry.uri]
            : [];
          results.push({
            id: `${sourceId}-${results.length}`,
            title: entry.title ?? entry.name ?? "",
            fileSize: entry.fileSize ?? entry.file_size ?? null,
            uris,
            unavailableUris: [],
            uploadDate: entry.uploadDate ?? entry.upload_date ?? null,
            downloadSourceId: sourceId,
            downloadSourceName: sourceName,
            createdAt: new Date().toISOString(),
          });
        }
      }));

      return results;
    }
  );

  app.get(
    "/games/:shop/:objectId/stats",
    { preHandler: requireAuth },
    async (_req: FastifyRequest<{ Params: { shop: string; objectId: string } }>, reply: FastifyReply) => {
      return reply.code(404).send({ error: "not found" });
    }
  );

  app.get(
    "/games/:shop/:objectId",
    { preHandler: requireAuth },
    async (_req: FastifyRequest<{ Params: { shop: string; objectId: string } }>, reply: FastifyReply) => {
      return reply.code(404).send({ error: "not found" });
    }
  );

  app.post(
    "/download-sources/changes",
    { preHandler: requireAuth },
    async () => {
      return [];
    }
  );
}
