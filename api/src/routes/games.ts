import axios from "axios";
import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { db } from "../db";
import { requireAuth } from "./auth";

const STEAM_ACHIEVEMENTS = "https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/";

function getAnyApiKey(): string | null {
  const row = db.prepare("SELECT steam_api_key FROM users WHERE steam_api_key IS NOT NULL AND steam_api_key != '' LIMIT 1").get() as { steam_api_key: string } | undefined;
  return row?.steam_api_key ?? null;
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

  app.get(
    "/games/:shop/:objectId/stats",
    { preHandler: requireAuth },
    async (req: FastifyRequest<{ Params: { shop: string; objectId: string } }>, reply: FastifyReply) => {
      return reply.code(404).send({ error: "not found" });
    }
  );

  app.get(
    "/games/:shop/:objectId",
    { preHandler: requireAuth },
    async (req: FastifyRequest<{ Params: { shop: string; objectId: string } }>, reply: FastifyReply) => {
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
