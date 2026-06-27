import { FastifyInstance, FastifyRequest } from "fastify";
import axios from "axios";

const STEAM_SEARCH = "https://store.steampowered.com/api/storesearch";
const STEAM_DETAILS = "https://store.steampowered.com/api/appdetails";
const STEAM_FEATURED = "https://store.steampowered.com/api/featured";
const HLTB_API = "https://howlongtobeat.com/api/search";

const detailsCache = new Map<string, { data: any; ts: number }>();
const CACHE_TTL = 1000 * 60 * 60 * 24; // 24h

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

function steamItemToAsset(item: any) {
  const id = String(item.id ?? item.appid);
  return {
    id,
    objectId: id,
    title: item.name,
    shop: "steam" as const,
    genres: [],
    releaseYear: null,
    libraryImageUrl: `https://shared.steamstatic.com/store_item_assets/steam/apps/${id}/header.jpg`,
    coverImageUrl: `https://shared.steamstatic.com/store_item_assets/steam/apps/${id}/library_600x900_2x.jpg`,
    downloadSources: [],
  };
}

export async function catalogueRoutes(app: FastifyInstance) {
  // GET /catalogue/:category — home page sections
  app.get("/catalogue/:category", async (
    req: FastifyRequest<{ Params: { category: string }; Querystring: { take?: string; skip?: string } }>,
  ) => {
    const { category } = req.params;
    const take = parseInt(req.query.take ?? "12");

    const res = await axios.get(STEAM_FEATURED, { timeout: 8000 }).catch(() => null);
    // hot → top_sellers, weekly → new_releases, achievements → specials (fallback to featured_win)
    const steamKey = category === "hot" ? "top_sellers"
      : category === "weekly" ? "new_releases"
      : category === "achievements" ? "specials"
      : "top_sellers";
    const items: any[] = res?.data?.[steamKey]?.items ?? res?.data?.featured_win ?? [];
    return items.slice(0, take).map(steamItemToAsset);
  });

  // GET /catalogue/search/suggestions
  app.get("/catalogue/search/suggestions", async (
    req: FastifyRequest<{ Querystring: { query?: string; limit?: string; shop?: string } }>,
  ) => {
    const { query = "", limit = "5" } = req.query;
    if (!query) return [];
    const res = await axios.get(STEAM_SEARCH, {
      params: { term: query, l: "english", cc: "us", json: 1 },
      timeout: 5000,
    }).catch(() => null);
    const items: any[] = res?.data?.items ?? [];
    return items.slice(0, parseInt(limit)).map((item: any) => ({
      title: item.name,
      objectId: String(item.id),
      shop: "steam",
      iconUrl: null,
    }));
  });

  // POST /catalogue/search
  app.post("/catalogue/search", async (
    req: FastifyRequest<{ Body: { title?: string; take?: number; skip?: number; sortBy?: string; sortOrder?: string; genres?: string[]; developers?: string[]; publishers?: string[] } }>,
  ) => {
    const { title = "", take = 20, skip = 0 } = req.body ?? {};

    const res = await axios.get(STEAM_SEARCH, {
      params: { term: title || "a", l: "english", cc: "us", json: 1 },
      timeout: 8000,
    }).catch(() => null);
    const items: any[] = res?.data?.items ?? [];

    const sliced = items.slice(skip, skip + take);

    const edgesWithDetails = await Promise.all(sliced.map(async (item: any) => {
      const d = await fetchSteamDetails(String(item.id)).catch(() => null);
      const genres: string[] = (d?.genres ?? []).map((g: any) => g.description);
      return {
        id: String(item.id),
        objectId: String(item.id),
        title: item.name,
        shop: "steam" as const,
        genres,
        releaseYear: d?.release_date?.date ? parseInt(d.release_date.date.split(",").pop()?.trim() ?? "0") : null,
        libraryImageUrl: `https://shared.steamstatic.com/store_item_assets/steam/apps/${item.id}/header.jpg`,
        downloadSources: [],
      };
    }));

    const genres: string[] = req.body?.genres ?? [];
    const edges = genres.length
      ? edgesWithDetails.filter(e => genres.some(g => e.genres.includes(g)))
      : edgesWithDetails;

    return { edges, count: items.length };
  });

  // POST /games/shop-details
  app.post("/games/shop-details", async (
    req: FastifyRequest<{ Body: { shop: string; objectIds: string[] } }>,
  ) => {
    const { shop, objectIds = [] } = req.body ?? {};
    if (shop !== "steam") return [];

    const results = await Promise.all(objectIds.map(async (id) => {
      const d = await fetchSteamDetails(id).catch(() => null);
      if (!d) return null;
      return {
        objectId: id,
        shop: "steam",
        data: {
          title: d.name,
          description: d.detailed_description ?? d.short_description ?? "",
          releaseDate: d.release_date?.date ?? null,
          developers: d.developers ?? [],
          publishers: d.publishers ?? [],
          genres: (d.genres ?? []).map((g: any) => g.description),
          headerImage: d.header_image ?? null,
          website: d.website ?? null,
          screenshots: (d.screenshots ?? []).map((s: any) => s.path_full),
          assets: {
            objectId: id,
            shop: "steam",
            title: d.name,
            iconUrl: null,
            libraryHeroImageUrl: `https://shared.steamstatic.com/store_item_assets/steam/apps/${id}/library_hero.jpg`,
            libraryImageUrl: `https://shared.steamstatic.com/store_item_assets/steam/apps/${id}/header.jpg`,
            logoImageUrl: null,
          },
        },
      };
    }));

    return results.filter(Boolean);
  });

  // GET /games/steam/:objectId
  app.get("/games/steam/:objectId", async (
    req: FastifyRequest<{ Params: { objectId: string }; Querystring: { l?: string } }>,
    reply
  ) => {
    const { objectId } = req.params;
    const lang = (req.query as any).l ?? "english";
    const d = await fetchSteamDetails(objectId, lang).catch(() => null);
    if (!d) return reply.code(404).send({ error: "not found" });
    const id = objectId;
    return {
      objectId: id,
      title: d.name,
      iconUrl: null,
      libraryHeroImageUrl: `https://shared.steamstatic.com/store_item_assets/steam/apps/${id}/library_hero.jpg`,
      libraryImageUrl: `https://shared.steamstatic.com/store_item_assets/steam/apps/${id}/header.jpg`,
      logoImageUrl: null,
      logoPosition: null,
      coverImageUrl: `https://shared.steamstatic.com/store_item_assets/steam/apps/${id}/library_600x900_2x.jpg`,
      releaseDate: d.release_date?.date ?? null,
      releaseYear: d.release_date?.date ? parseInt(d.release_date.date.split(",").pop()?.trim() ?? "0") : null,
    };
  });

  // GET /games/:shop/:objectId/how-long-to-beat
  app.get("/games/:shop/:objectId/how-long-to-beat", async (
    req: FastifyRequest<{ Params: { shop: string; objectId: string } }>,
    reply
  ) => {
    const { objectId } = req.params;
    const d = await fetchSteamDetails(objectId).catch(() => null);
    if (!d) return reply.code(404).send({ error: "not found" });

    try {
      const res = await axios.post(HLTB_API, {
        searchType: "games",
        searchTerms: d.name.split(" "),
        searchPage: 1,
        size: 1,
        searchOptions: { games: { userId: 0, platform: "", sortCategory: "popular", rangeCategory: "main", rangeTime: { min: 0, max: 0 }, gameplay: { perspective: "", flow: "", genre: "" }, modifier: "" }, filter: "", sort: 0, randomizer: 0 },
      }, {
        headers: { "Content-Type": "application/json", "Referer": "https://howlongtobeat.com", "User-Agent": "Mozilla/5.0" },
        timeout: 8000,
      }).catch(() => null);

      const game = res?.data?.data?.[0];
      if (!game) return null;
      return {
        mainStory: game.comp_main ? Math.round(game.comp_main / 3600) : null,
        mainExtra: game.comp_plus ? Math.round(game.comp_plus / 3600) : null,
        completionist: game.comp_100 ? Math.round(game.comp_100 / 3600) : null,
      };
    } catch {
      return null;
    }
  });

  // GET /games/:shop/:objectId/protondb
  app.get("/games/:shop/:objectId/protondb", async (
    req: FastifyRequest<{ Params: { shop: string; objectId: string } }>,
    reply
  ) => {
    const { objectId } = req.params;
    try {
      const res = await axios.get(`https://www.protondb.com/api/v1/reports/summaries/${objectId}.json`, {
        timeout: 8000,
      }).catch(() => null);
      if (!res?.data) return reply.code(404).send({ error: "not found" });
      return res.data;
    } catch {
      return reply.code(404).send({ error: "not found" });
    }
  });
}
