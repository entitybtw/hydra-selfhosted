import { FastifyInstance, FastifyRequest } from "fastify";
import axios from "axios";

const HYDRA_API = "https://hydra-api-us-east-1.losbroxas.org";

export async function catalogueRoutes(app: FastifyInstance) {
  app.get("/games/:shop/:objectId/how-long-to-beat", async (
    req: FastifyRequest<{ Params: { shop: string; objectId: string } }>,
    reply
  ) => {
    const { shop, objectId } = req.params;
    const res = await axios.get(`${HYDRA_API}/games/${shop}/${objectId}/how-long-to-beat`, {
      timeout: 10000,
    }).catch(() => null);
    if (!res?.data) return reply.code(404).send({ error: "not found" });
    return res.data;
  });

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
