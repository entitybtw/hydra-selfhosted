import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { db } from "../db";

interface DbUser {
  id: string;
  username: string;
  display_name: string;
  bio: string;
  created_at: number;
}

interface DbGame {
  title: string;
  play_time_in_seconds: number;
  shop: string;
}

function msToHours(seconds: number) {
  return Math.floor(seconds / 3600);
}

function asciiProfile(user: DbUser, games: DbGame[]): string {
  const top5 = games
    .sort((a, b) => b.play_time_in_seconds - a.play_time_in_seconds)
    .slice(0, 5);

  const w = 52;
  const line = "─".repeat(w);
  const pad = (s: string, len: number) => s.slice(0, len).padEnd(len);

  const rows = [
    `╭${line}╮`,
    `│  ${"HYDRA SELF-HOSTED".padEnd(w - 2)}│`,
    `│${" ".repeat(w)}│`,
    `│  👤 ${pad(user.display_name || user.username, w - 5)}│`,
    `│  @${pad(user.username, w - 3)}│`,
    user.bio ? `│  ${pad('"' + user.bio + '"', w - 2)}│` : null,
    `│${" ".repeat(w)}│`,
    `│  ${"── TOP GAMES ──".padEnd(w - 2)}│`,
    ...top5.map((g) =>
      `│  ${pad(`▶ ${g.title}`, w - 10)}${String(msToHours(g.play_time_in_seconds)).padStart(4)}h  │`
    ),
    top5.length === 0 ? `│  ${"no games yet".padEnd(w - 2)}│` : null,
    `│${" ".repeat(w)}│`,
    `╰${line}╯`,
  ].filter(Boolean) as string[];

  return rows.join("\n");
}

export async function webRoutes(app: FastifyInstance) {
  // Middleware: require API_TOKEN if configured
  app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.url.startsWith("/u/")) return;
    const apiToken = process.env.API_TOKEN;
    if (!apiToken) return; // no token configured = open access
    const provided = req.headers["x-api-token"] ?? req.query?.["token"];
    if (provided !== apiToken) {
      return reply
        .type("text/plain")
        .code(401)
        .send("Unauthorized. Provide X-Api-Token header or ?token=... query param.\n");
    }
  });
  app.get("/u/:username", async (
    req: FastifyRequest<{ Params: { username: string }; Querystring: { format?: string } }>,
    reply: FastifyReply
  ) => {
    const user = db
      .prepare("SELECT * FROM users WHERE username = ?")
      .get(req.params.username) as DbUser | undefined;

    if (!user) return reply.code(404).send("User not found\n");

    const games = db
      .prepare("SELECT * FROM games WHERE user_id = ? AND is_deleted = 0")
      .all(user.id) as DbGame[];

    const ascii = asciiProfile(user, games);

    if (req.query.format === "json") {
      return reply.send({ username: user.username, displayName: user.display_name, bio: user.bio, games: games.length });
    }

    return reply
      .type("text/plain; charset=utf-8")
      .send(ascii + "\n");
  });
}
