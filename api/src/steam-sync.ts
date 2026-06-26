import axios from "axios";
import { db } from "./db";

interface SteamGame {
  appid: number;
  playtime_forever: number; // minutes
  name?: string;
}

export const syncSteamGames = async (userId: string) => {
  const user = db
    .prepare("SELECT steam_id, steam_api_key FROM users WHERE id = ?")
    .get(userId) as { steam_id: string | null; steam_api_key: string | null } | undefined;

  if (!user?.steam_id || !user?.steam_api_key) return;

  const res = await axios
    .get("https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/", {
      params: {
        key: user.steam_api_key,
        steamid: user.steam_id,
        include_appinfo: true,
        include_played_free_games: true,
      },
      timeout: 10000,
    })
    .catch(() => null);

  if (!res) return;

  const games: SteamGame[] = res.data?.response?.games ?? [];

  const upsert = db.prepare(`
    INSERT INTO games (id, user_id, object_id, shop, title, play_time_in_seconds, is_deleted)
    VALUES (lower(hex(randomblob(16))), ?, ?, 'steam', ?, ?, 0)
    ON CONFLICT(user_id, object_id, shop) DO UPDATE SET
      play_time_in_seconds = MAX(play_time_in_seconds, excluded.play_time_in_seconds),
      title = CASE WHEN title = '' THEN excluded.title ELSE title END
  `);

  const syncMany = db.transaction((rows: SteamGame[]) => {
    for (const g of rows) {
      if (!g.name) continue;
      upsert.run(userId, String(g.appid), g.name, g.playtime_forever * 60);
    }
  });

  syncMany(games);
};

// Sync all users with Steam configured every 30 minutes
export const startSteamSyncScheduler = () => {
  const run = async () => {
    const users = db
      .prepare("SELECT id FROM users WHERE steam_id IS NOT NULL AND steam_api_key IS NOT NULL")
      .all() as { id: string }[];
    for (const u of users) {
      await syncSteamGames(u.id).catch(() => {});
    }
  };

  run();
  setInterval(run, 30 * 60 * 1000);
};
