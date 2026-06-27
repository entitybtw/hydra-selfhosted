import { FastifyInstance, FastifyRequest } from "fastify";
import axios from "axios";

const STEAM_SEARCH = "https://store.steampowered.com/api/storesearch";
const STEAM_DETAILS = "https://store.steampowered.com/api/appdetails";

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

export async function catalogueRoutes(app: FastifyInstance) {
  // Search — mirrors /catalogue/search
  app.post("/catalogue/search", async (
    req: FastifyRequest<{ Body: { title?: string; take?: number; skip?: number; sortBy?: string; sortOrder?: string; genres?: string[]; developers?: string[]; publishers?: string[] } }>,
    reply
  ) => {
    const { title = "", take = 20, skip = 0, sortBy = "popularity" } = req.body ?? {};

    const params: Record<string, any> = {
      term: title || "a",
      l: "english",
      cc: "us",
      json: 1,
    };

    const res = await axios.get(STEAM_SEARCH, { params, timeout: 8000 }).catch(() => null);
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

  // Shop details — mirrors /games/shop-details
  app.post("/games/shop-details", async (
    req: FastifyRequest<{ Body: { shop: string; objectIds: string[] } }>,
    reply
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

  // Single game basic info — mirrors /games/steam/:objectId
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

}
