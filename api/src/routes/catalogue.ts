import { FastifyInstance, FastifyRequest } from "fastify";
import axios from "axios";

export async function catalogueRoutes(app: FastifyInstance) {
  app.get("/games/:shop/:objectId/protondb", async (
    req: FastifyRequest<{ Params: { shop: string; objectId: string } }>,
    reply
  ) => {
    const { objectId } = req.params;
    const res = await axios.get(`https://www.protondb.com/api/v1/reports/summaries/${objectId}.json`, { timeout: 8000 }).catch(() => null);
    if (!res?.data) return reply.code(404).send({ error: "not found" });
    return res.data;
  });
}
