import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import crypto from "node:crypto";
import { db } from "../db";
import { signAccess, verifyToken } from "../auth";
import { syncSteamGames } from "../steam-sync";

interface DbUser {
  id: string;
  username: string;
  display_name: string;
  bio: string;
  profile_image_url: string | null;
  steam_id: string | null;
  steam_api_key: string | null;
  accent_color: string | null;
  created_at: number;
}

interface DbGame {
  object_id: string;
  title: string;
  play_time_in_seconds: number;
  shop: string;
}

function hashPassword(p: string) {
  return crypto.createHash("sha256").update(p).digest("hex");
}

function h(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fmtHours(seconds: number) {
  const h = Math.floor(seconds / 3600);
  if (h >= 1000) return `${h.toLocaleString()}h`;
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const CSS = `
  :root{--bg:#0d0d0d;--bg2:#151515;--bg3:#1e1e1e;--border:#2a2a2a;--accent:#7b68ee;--text:#e0e0e0;--sub:#888;--err:#e05c5c}
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:var(--bg);color:var(--text);font-family:'Courier New',monospace;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
  .card{background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:32px;width:100%;max-width:480px}
  .card.wide{max-width:720px}
  h1{font-size:18px;color:var(--accent);margin-bottom:6px}
  h2{font-size:15px;color:var(--sub);margin-bottom:24px;font-weight:normal}
  h3{font-size:13px;color:var(--sub);margin:24px 0 12px;text-transform:uppercase;letter-spacing:.08em}
  label{display:block;font-size:12px;color:var(--sub);margin-bottom:4px}
  input,textarea{width:100%;background:var(--bg3);border:1px solid var(--border);border-radius:4px;padding:8px 10px;color:var(--text);font-family:inherit;font-size:13px;outline:none;transition:border .15s}
  input:focus,textarea:focus{border-color:var(--accent)}
  textarea{resize:vertical;min-height:60px}
  .field{margin-bottom:14px}
  button,.btn{background:var(--accent);color:#fff;border:none;border-radius:4px;padding:9px 18px;font-family:inherit;font-size:13px;cursor:pointer;width:100%;transition:opacity .15s}
  button:hover,.btn:hover{opacity:.85}
  .btn-ghost{background:transparent;border:1px solid var(--border);color:var(--sub)}
  .btn-ghost:hover{border-color:var(--accent);color:var(--text)}
  .err{background:#2a1010;border:1px solid var(--err);border-radius:4px;padding:8px 12px;font-size:12px;color:var(--err);margin-bottom:14px}
  .ok{background:#0f2a1a;border:1px solid #3a7a4a;border-radius:4px;padding:8px 12px;font-size:12px;color:#5cb87a;margin-bottom:14px}
  a{color:var(--accent);text-decoration:none}
  a:hover{text-decoration:underline}
  .meta{font-size:12px;color:var(--sub);text-align:center;margin-top:16px}
  .row{display:flex;gap:10px}
  .row button{flex:1}
  .token-box{background:var(--bg3);border:1px solid var(--border);border-radius:4px;padding:8px 10px;font-size:12px;word-break:break-all;color:var(--sub)}
  .tab-btn{background:var(--bg3);border:1px solid var(--border);color:var(--sub);width:auto;padding:6px 14px;font-size:12px}
  .tab-btn.active{background:var(--accent);border-color:var(--accent);color:#fff}
  .tab-btn:hover{opacity:.85}
  th{color:var(--sub);text-align:left;padding:6px 8px;border-bottom:1px solid var(--border)}
  td{padding:6px 8px;border-bottom:1px solid #1a1a1a;color:var(--text)}
  tr:last-child td{border-bottom:none}
  .badge{font-size:10px;background:var(--bg3);border:1px solid var(--border);border-radius:3px;padding:1px 5px;color:var(--sub)}
  .warn{background:#1e1a00;border:1px solid #5a4a00;border-radius:4px;padding:8px 12px;font-size:12px;color:#c8a040;margin-bottom:14px}
`;

function page(title: string, body: string, accent = "#7b68ee") {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${h(title)} — Hydra Self-Hosted</title><style>${CSS.replace(/var\(--accent\)/g, "VAR_ACCENT").replace(/VAR_ACCENT/g, accent)}</style></head><body>${body}</body></html>`;
}

function tokenGatePage(error?: string) {
  return page("Access", `
    <div class="card">
      <h1>⬡ Hydra Self-Hosted</h1>
      <h2>Enter instance token to continue</h2>
      ${error ? `<div class="err">${h(error)}</div>` : ""}
      <form method="POST" action="/web/gate">
        <div class="field"><label>Instance Token</label><input name="instance_token" type="password" autofocus required></div>
        <button type="submit">Continue</button>
      </form>
    </div>
  `, "#e0e0e0");
}

function loginPage(error?: string) {
  return page("Sign in", `
    <div class="card">
      <h1>⬡ Hydra Self-Hosted</h1>
      <h2>Sign in to your account</h2>
      ${error ? `<div class="err">${h(error)}</div>` : ""}
      <form method="POST" action="/web/login">
        <div class="field"><label>Username</label><input name="username" autocomplete="username" required autofocus></div>
        <div class="field"><label>Password</label><input name="password" type="password" autocomplete="current-password" required></div>
        <div class="row">
          <button type="submit" name="action" value="login">Sign in</button>
          <button type="submit" name="action" value="register" class="btn-ghost">Register</button>
        </div>
      </form>
      <p class="meta">This is a Hydra Launcher self-hosted instance</p>
    </div>
  `, "#e0e0e0");
}

function tabsHtml(hydraGames: DbGame[], steamGames: DbGame[], hasSteam: boolean) {
  const mkRows = (list: DbGame[]) => list.slice(0, 100).map(g =>
    `<tr><td>${h(g.title)}</td><td>${fmtHours(g.play_time_in_seconds)}</td></tr>`
  ).join("") || `<tr><td colspan="2" style="color:var(--sub)">No games yet.</td></tr>`;

  const hydraRows = mkRows(hydraGames);
  const steamRows = mkRows(steamGames);

  const steamTab = hasSteam ? `<button class="tab-btn" data-tab="steam">Steam (${steamGames.length})</button>` : "";
  const steamPanel = hasSteam ? `
    <div class="tab-panel" id="tab-steam" style="display:none">
      <table><thead><tr><th>Game</th><th>Playtime</th></tr></thead><tbody>${steamRows}</tbody></table>
    </div>` : "";

  return `
    <div class="tabs" style="margin-top:16px">
      <div style="display:flex;gap:8px;margin-bottom:12px">
        <button class="tab-btn active" data-tab="hydra">Hydra (${hydraGames.length})</button>
        ${steamTab}
      </div>
      <div class="tab-panel" id="tab-hydra">
        <table><thead><tr><th>Game</th><th>Playtime</th></tr></thead><tbody>${hydraRows}</tbody></table>
      </div>
      ${steamPanel}
    </div>
    <script>
      document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
          document.querySelectorAll('.tab-panel').forEach(p => p.style.display = 'none');
          btn.classList.add('active');
          document.getElementById('tab-' + btn.dataset.tab).style.display = '';
        });
      });
    </script>
  `;
}

function dashboardPage(user: DbUser, games: DbGame[], msg?: string, msgType: "ok"|"err" = "ok") {
  const accent = user.accent_color || "#7b68ee";
  const totalHours = Math.floor(games.reduce((s, g) => s + g.play_time_in_seconds, 0) / 3600);
  const hydraGames = [...games].filter(g => g.shop !== "steam" || !user.steam_id)
    .sort((a, b) => b.play_time_in_seconds - a.play_time_in_seconds);
  const steamGames = [...games].filter(g => g.shop === "steam")
    .sort((a, b) => b.play_time_in_seconds - a.play_time_in_seconds);

  return page("Dashboard", `
    <div class="card wide">
      <h1>⬡ ${h(user.display_name || user.username)}</h1>
      <h2>@${h(user.username)} · ${games.length} games · ${totalHours.toLocaleString()}h total</h2>
      ${msg ? `<div class="${msgType}">${h(msg)}</div>` : ""}

      <h3>Profile</h3>
      <form method="POST" action="/web/profile">
        <div class="field"><label>Display name</label><input name="display_name" value="${h(user.display_name)}" maxlength="64"></div>
        <div class="field"><label>Bio</label><textarea name="bio" maxlength="200">${h(user.bio)}</textarea></div>
        <div class="field"><label>Accent color</label><div style="display:flex;gap:8px;align-items:center"><input type="color" name="accent_color" value="${h(accent)}" style="width:40px;height:32px;padding:2px;cursor:pointer"><input name="accent_color_hex" value="${h(accent)}" maxlength="7" style="flex:1" placeholder="#7b68ee"></div></div>
        <button type="submit">Save profile</button>
      </form>

      <h3>Steam integration</h3>
      <div class="warn">Your Steam API key is stored on this server. Use a dedicated key or one with minimal permissions.</div>
      <form method="POST" action="/web/steam">
        <div class="field"><label>SteamID64</label><input name="steam_id" value="${h(user.steam_id ?? "")}" placeholder="76561198xxxxxxxxx"></div>
        <div class="field"><label>Steam Web API Key <a href="https://steamcommunity.com/dev/apikey" target="_blank">↗</a></label><input name="steam_api_key" type="password" value="${user.steam_api_key ? "••••••••" : ""}" placeholder="Leave blank to keep current" autocomplete="off"></div>
        <button type="submit">Save &amp; sync Steam now</button>
      </form>

      <h3>Library</h3>
      ${tabsHtml(hydraGames, steamGames, Boolean(user.steam_id))}

      <h3>API access</h3>
      <p style="font-size:12px;color:var(--sub);margin-bottom:8px">Use this URL in Hydra Launcher settings:</p>
      <div class="token-box">${h(process.env.PUBLIC_URL ?? "http://localhost:" + (process.env.PORT ?? "3000"))}</div>

      <div style="margin-top:24px">
        <a href="/u/${h(user.username)}" target="_blank" class="btn btn-ghost" style="display:inline-block;padding:8px 14px;font-size:12px">View public profile ↗</a>
        &nbsp;
        <a href="/web/logout" style="font-size:12px;color:var(--sub)">Sign out</a>
      </div>
    </div>
  `, accent);
}

function publicProfilePage(user: DbUser, games: DbGame[]) {
  const accent = user.accent_color || "#7b68ee";
  const totalHours = Math.floor(games.reduce((s, g) => s + g.play_time_in_seconds, 0) / 3600);
  const hydraGames = [...games].filter(g => g.shop !== "steam" || !user.steam_id)
    .sort((a, b) => b.play_time_in_seconds - a.play_time_in_seconds);
  const steamGames = [...games].filter(g => g.shop === "steam")
    .sort((a, b) => b.play_time_in_seconds - a.play_time_in_seconds);
  const steamHours = Math.floor(steamGames.reduce((s, g) => s + g.play_time_in_seconds, 0) / 3600);

  return page(`@${user.username}`, `
    <div class="card wide">
      <h1>⬡ ${h(user.display_name || user.username)}</h1>
      <h2>@${h(user.username)}${user.bio ? ` · ${h(user.bio)}` : ""}</h2>
      <div style="display:flex;gap:24px;margin:16px 0;font-size:13px">
        <div><span style="color:${accent};font-size:18px;font-weight:bold">${games.length}</span><br><span style="color:var(--sub)">games</span></div>
        <div><span style="color:${accent};font-size:18px;font-weight:bold">${totalHours.toLocaleString()}</span><br><span style="color:var(--sub)">total hours</span></div>
        ${user.steam_id ? `<div><span style="color:${accent};font-size:18px;font-weight:bold">${steamHours.toLocaleString()}</span><br><span style="color:var(--sub)">steam hours</span></div>` : ""}
      </div>
      ${tabsHtml(hydraGames, steamGames, Boolean(user.steam_id))}
      <p style="font-size:11px;color:var(--sub);margin-top:16px">Powered by <a href="https://github.com/entitybtw/hydra-selfhosted">Hydra Self-Hosted</a></p>
    </div>
  `, accent);
}

function getUserFromCookie(req: FastifyRequest): DbUser | null {
  const token = (req as any).cookies?.["web_token"];
  if (!token) return null;
  try {
    const userId = verifyToken(token, "access");
    return db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as DbUser | null;
  } catch {
    return null;
  }
}

export async function webRoutes(app: FastifyInstance) {
  // Landing — show token gate if INSTANCE_TOKEN is set, else login directly
  app.get("/", async (req: FastifyRequest, reply: FastifyReply) => {
    const user = getUserFromCookie(req);
    if (user) return reply.redirect("/web/dashboard");
    const instanceToken = process.env.INSTANCE_TOKEN;
    if (instanceToken) {
      const gate = (req as any).cookies?.["gate_ok"];
      if (gate !== "1") return reply.type("text/html").send(tokenGatePage());
    }
    return reply.type("text/html").send(loginPage());
  });

  // Token gate handler
  app.post("/web/gate", {
    config: { rawBody: true },
  }, async (req: FastifyRequest<{ Body: Record<string, string> }>, reply: FastifyReply) => {
    const instanceToken = process.env.INSTANCE_TOKEN;
    if (!instanceToken) return reply.redirect("/");
    if (req.body?.instance_token !== instanceToken) {
      return reply.type("text/html").send(tokenGatePage("Invalid instance token."));
    }
    return reply
      .setCookie("gate_ok", "1", { path: "/", httpOnly: true, maxAge: 60 * 60 * 24 * 7 })
      .redirect("/");
  });

  // Login / register form handler
  app.post("/web/login", {
    config: { rawBody: true },
  }, async (req: FastifyRequest<{ Body: Record<string, string> }>, reply: FastifyReply) => {
    const { username, password, action } = req.body ?? {};

    if (action === "register") {
      if (!username || !password) return reply.type("text/html").send(loginPage("Username and password required."));
      const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
      if (existing) return reply.type("text/html").send(loginPage("Username already taken."));

      const id = crypto.randomUUID();
      db.prepare("INSERT INTO users (id, username, password_hash, display_name) VALUES (?,?,?,?)")
        .run(id, username, hashPassword(password), username);

      const token = signAccess(id);
      return reply
        .setCookie("web_token", token, { path: "/", httpOnly: true, maxAge: 60 * 60 * 24 * 30 })
        .redirect("/web/dashboard");
    }

    const user = db.prepare("SELECT id, password_hash FROM users WHERE username = ?")
      .get(username) as { id: string; password_hash: string } | undefined;

    if (!user || user.password_hash !== hashPassword(password)) {
      return reply.type("text/html").send(loginPage("Invalid username or password."));
    }

    const token = signAccess(user.id);
    return reply
      .setCookie("web_token", token, { path: "/", httpOnly: true, maxAge: 60 * 60 * 24 * 30 })
      .redirect("/web/dashboard");
  });

  // Dashboard
  app.get("/web/dashboard", async (req: FastifyRequest, reply: FastifyReply) => {
    const user = getUserFromCookie(req);
    if (!user) return reply.redirect("/");
    const games = db.prepare("SELECT * FROM games WHERE user_id = ? AND is_deleted = 0").all(user.id) as DbGame[];
    return reply.type("text/html").send(dashboardPage(user, games));
  });

  // Update profile
  app.post("/web/profile", {
    config: { rawBody: true },
  }, async (req: FastifyRequest<{ Body: Record<string, string> }>, reply: FastifyReply) => {
    const user = getUserFromCookie(req);
    if (!user) return reply.redirect("/");
    const { display_name, bio, accent_color, accent_color_hex } = req.body ?? {};
    const accent = (/^#[0-9a-fA-F]{6}$/.test(accent_color_hex ?? "") ? accent_color_hex
      : /^#[0-9a-fA-F]{6}$/.test(accent_color ?? "") ? accent_color : null);
    db.prepare("UPDATE users SET display_name = ?, bio = ?, accent_color = ? WHERE id = ?")
      .run((display_name ?? "").slice(0, 64), (bio ?? "").slice(0, 200), accent, user.id);
    const updated = db.prepare("SELECT * FROM users WHERE id = ?").get(user.id) as DbUser;
    const games = db.prepare("SELECT * FROM games WHERE user_id = ? AND is_deleted = 0").all(user.id) as DbGame[];
    return reply.type("text/html").send(dashboardPage(updated, games, "Profile updated.", "ok"));
  });

  // Steam settings + immediate sync
  app.post("/web/steam", {
    config: { rawBody: true },
  }, async (req: FastifyRequest<{ Body: Record<string, string> }>, reply: FastifyReply) => {
    const user = getUserFromCookie(req);
    if (!user) return reply.redirect("/");
    const { steam_id, steam_api_key } = req.body ?? {};

    const newKey = steam_api_key && !steam_api_key.startsWith("•") ? steam_api_key : user.steam_api_key;
    db.prepare("UPDATE users SET steam_id = ?, steam_api_key = ? WHERE id = ?")
      .run(steam_id || null, newKey || null, user.id);

    await syncSteamGames(user.id).catch(() => {});

    const updated = db.prepare("SELECT * FROM users WHERE id = ?").get(user.id) as DbUser;
    const games = db.prepare("SELECT * FROM games WHERE user_id = ? AND is_deleted = 0").all(user.id) as DbGame[];
    return reply.type("text/html").send(dashboardPage(updated, games, "Steam synced.", "ok"));
  });

  // Logout
  app.get("/web/logout", async (_req: FastifyRequest, reply: FastifyReply) => {
    return reply.clearCookie("web_token", { path: "/" }).redirect("/");
  });

  // Public profile — HTML
  app.get("/u/:username", async (
    req: FastifyRequest<{ Params: { username: string }; Querystring: { format?: string } }>,
    reply: FastifyReply
  ) => {
    const user = db.prepare("SELECT * FROM users WHERE username = ?")
      .get(req.params.username) as DbUser | undefined;
    if (!user) return reply.code(404).type("text/plain").send("User not found\n");

    const games = db.prepare("SELECT * FROM games WHERE user_id = ? AND is_deleted = 0")
      .all(user.id) as DbGame[];

    if (req.query.format === "json") {
      const totalSeconds = games.reduce((s, g) => s + g.play_time_in_seconds, 0);
      return reply.send({
        username: user.username,
        displayName: user.display_name,
        bio: user.bio,
        steamId: user.steam_id ?? undefined,
        games: games.length,
        totalHours: Math.floor(totalSeconds / 3600),
      });
    }

    return reply.type("text/html").send(publicProfilePage(user, games));
  });
}
