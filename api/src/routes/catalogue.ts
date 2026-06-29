import { FastifyInstance, FastifyRequest } from "fastify";
import axios from "axios";

const STEAM_DETAILS = "https://store.steampowered.com/api/appdetails";
const detailsCache = new Map<string, { data: any; ts: number }>();
const CACHE_TTL = 86_400_000;

async function fetchSteamDetails(appId: string, language = "english") {
  const key = `${appId}:${language}`;
  const cached = detailsCache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;
  const res = await axios.get(STEAM_DETAILS, {
    params: { appids: appId, l: language, cc: "us" },
    timeout: 8000,
  }).catch(() => null);
  const data = res?.data?.[appId];
  if (data?.success) {
    detailsCache.set(key, { data: data.data, ts: Date.now() });
    return data.data;
  }
  return null;
}

export async function catalogueRoutes(app: FastifyInstance) {
  // HowLongToBeat proxy (used when self-hosted hltb toggle is on)
  app.get("/games/:shop/:objectId/how-long-to-beat", async (
    req: FastifyRequest<{ Params: { shop: string; objectId: string } }>,
    reply
  ) => {
    const { objectId } = req.params;
    const d = await fetchSteamDetails(objectId).catch(() => null);
    if (!d) return reply.code(404).send({ error: "not found" });
    const res = await axios.post("https://howlongtobeat.com/api/search", {
      searchType: "games", searchTerms: d.name.split(" "), searchPage: 1, size: 1,
      searchOptions: { games: { userId: 0, platform: "", sortCategory: "popular", rangeCategory: "main", rangeTime: { min: 0, max: 0 }, gameplay: { perspective: "", flow: "", genre: "" }, modifier: "" }, filter: "", sort: 0, randomizer: 0 },
    }, { headers: { "Content-Type": "application/json", "Referer": "https://howlongtobeat.com", "User-Agent": "Mozilla/5.0" }, timeout: 8000 }).catch(() => null);
    const game = res?.data?.data?.[0];
    if (!game) return null;
    const fmt = (secs: number) => secs < 3600
      ? `${Math.round(secs / 60)} Mins`
      : `${Math.round(secs / 3600)} Hours`;
    const categories = [];
    if (game.comp_main) categories.push({ title: "Main Story", duration: fmt(game.comp_main), accuracy: "average" });
    if (game.comp_plus) categories.push({ title: "Main + Extras", duration: fmt(game.comp_plus), accuracy: "average" });
    if (game.comp_100) categories.push({ title: "Completionist", duration: fmt(game.comp_100), accuracy: "average" });
    return categories;
  });

  // ProtonDB proxy (used when self-hosted protondb toggle is on)
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
