import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { db } from "../db";
import { requireAuth } from "./auth";

export async function gamesRoutes(app: FastifyInstance) {
  app.get(
    "/games/:shop/:objectId/achievements",
    { preHandler: requireAuth },
    async (req: FastifyRequest<{ Params: { shop: string; objectId: string } }>) => {
      return [];
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
