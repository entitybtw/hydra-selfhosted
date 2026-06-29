import { FastifyInstance, FastifyRequest } from "fastify";
import axios from "axios";

const HLTB_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export async function catalogueRoutes(app: FastifyInstance) {
  app.get("/games/:shop/:objectId/how-long-to-beat", async (
    req: FastifyRequest<{ Params: { shop: string; objectId: string } }>,
    reply
  ) => {
    const { shop, objectId } = req.params;

    const steamRes = await axios.get("https://store.steampowered.com/api/appdetails", {
      params: { appids: objectId, l: "english", cc: "us" }, timeout: 8000,
    }).catch(() => null);
    const name = steamRes?.data?.[objectId]?.data?.name;
    if (!name) return reply.code(404).send({ error: "not found" });

    const auth = await axios.get(`https://howlongtobeat.com/api/bleed/init?t=${Date.now()}`, {
      headers: { "User-Agent": HLTB_UA, "Referer": "https://howlongtobeat.com" }, timeout: 8000,
    }).catch(() => null);
    if (!auth?.data?.token) return reply.code(503).send({ error: "hltb unavailable" });

    const { token, hpKey, hpVal } = auth.data;
    const res = await axios.post("https://howlongtobeat.com/api/bleed", {
      [hpKey]: hpVal,
      searchType: "games", searchTerms: name.split(" "), searchPage: 1, size: 1,
      searchOptions: { games: { userId: 0, platform: "", sortCategory: "popular", rangeCategory: "main", rangeTime: { min: 0, max: 0 }, gameplay: { perspective: "", flow: "", genre: "" }, modifier: "" }, filter: "", sort: 0, randomizer: 0 },
    }, {
      headers: { "Content-Type": "application/json", "Accept": "*/*", "User-Agent": HLTB_UA, "Referer": "https://howlongtobeat.com", "X-Auth-Token": token, "X-Hp-Key": hpKey, "X-Hp-Val": hpVal },
      timeout: 10000,
    }).catch(() => null);

    const game = res?.data?.data?.[0];
    if (!game) return null;

    const fmt = (secs: number) => secs < 3600 ? `${Math.round(secs / 60)} Mins` : `${Math.round(secs / 3600)} Hours`;
    const categories = [];
    if (game.comp_main) categories.push({ title: "Main Story", duration: fmt(game.comp_main), accuracy: "average" });
    if (game.comp_plus) categories.push({ title: "Main + Extras", duration: fmt(game.comp_plus), accuracy: "average" });
    if (game.comp_100) categories.push({ title: "Completionist", duration: fmt(game.comp_100), accuracy: "average" });
    return categories;
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
