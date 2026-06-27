import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { db } from "../db";
import { signAccess, verifyToken } from "../auth";
import { syncSteamGames } from "../steam-sync";

interface DbUser {
  id: string;
  username: string;
  display_name: string;
  bio: string;
  profile_image_url: string | null;
  background_image_url: string | null;
  steam_id: string | null;
  steam_api_key: string | null;
  accent_color: string | null;
  custom_css: string | null;
  created_at: number;
}

interface DbGame {
  object_id: string;
  title: string;
  play_time_in_seconds: number;
  shop: string;
}

function hashPassword(p: string) {
  return bcrypt.hashSync(p, 10);
}

function verifyPassword(p: string, hash: string) {
  // support legacy sha256 hashes during migration
  if (hash.length === 64) {
    const sha = require("node:crypto").createHash("sha256").update(p).digest("hex");
    return sha === hash;
  }
  return bcrypt.compareSync(p, hash);
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
  body{background:#111;color:#e1e1e1;font-family:"Inter",system-ui,sans-serif;min-height:100vh;display:flex;align-items:flex-start;justify-content:center;padding:40px 20px}
  .card{background:#1a1a1a;border:1px solid #2a2a2a;border-radius:10px;padding:32px;width:100%;max-width:420px}
  .card.wide{max-width:720px;padding:0}
  h1{font-size:20px;font-weight:700;color:#fff;margin-bottom:4px;letter-spacing:-.3px}
  h2{font-size:13px;color:#888;margin-bottom:24px;font-weight:400}
  h3{font-size:11px;color:#666;margin:24px 0 10px;text-transform:uppercase;letter-spacing:.1em;font-weight:600}
  label{display:block;font-size:12px;color:#888;margin-bottom:4px;font-weight:500}
  input,textarea{width:100%;background:#111;border:1px solid #2a2a2a;border-radius:6px;padding:9px 12px;color:#e1e1e1;font-family:inherit;font-size:13px;outline:none;transition:border .15s}
  input:focus,textarea:focus{border-color:var(--accent,#7b68ee)}
  textarea{resize:vertical;min-height:60px}
  .field{margin-bottom:14px}
  button,.btn{background:var(--accent,#7b68ee);color:var(--btn-text,#fff);border:none;border-radius:6px;padding:10px 18px;font-family:inherit;font-size:13px;font-weight:500;cursor:pointer;width:100%;transition:opacity .15s}
  button:hover,.btn:hover{opacity:.85}
  .btn-ghost{background:transparent;border:1px solid #2a2a2a;color:#888}
  .btn-ghost:hover{border-color:var(--accent,#7b68ee);color:#e1e1e1}
  .err{background:#1f0f0f;border:1px solid #5a2020;border-radius:6px;padding:10px 14px;font-size:12px;color:#e07070;margin-bottom:14px}
  .ok{background:#0f1f14;border:1px solid #2a6040;border-radius:6px;padding:10px 14px;font-size:12px;color:#5cb87a;margin-bottom:14px}
  a{color:var(--accent,#7b68ee);text-decoration:none}
  a:hover{text-decoration:underline}
  .meta{font-size:12px;color:#666;text-align:center;margin-top:16px}
  .row{display:flex;gap:10px}
  .row button{flex:1}
  .token-box{background:#111;border:1px solid #2a2a2a;border-radius:6px;padding:10px 12px;font-size:12px;word-break:break-all;color:#888}
  .tab-btn{background:#1a1a1a;border:1px solid #2a2a2a;color:#888;width:auto;padding:6px 14px;font-size:12px;border-radius:6px}
  .tab-btn.active{background:var(--accent,#7b68ee);border-color:var(--accent,#7b68ee);color:var(--btn-text,#fff)}
  .tab-btn:hover{opacity:.85}
  th{color:#666;text-align:left;padding:6px 8px;border-bottom:1px solid #2a2a2a;font-size:11px;text-transform:uppercase;letter-spacing:.08em}
  td{padding:8px 8px;border-bottom:1px solid #1a1a1a;color:#e1e1e1;font-size:13px}
  tr:last-child td{border-bottom:none}
  .badge{font-size:10px;background:#222;border:1px solid #2a2a2a;border-radius:4px;padding:1px 6px;color:#888}
  .warn{background:#1a1500;border:1px solid #4a3800;border-radius:6px;padding:10px 14px;font-size:12px;color:#c8a040;margin-bottom:14px}
`;

function contrastColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  // Perceived luminance
  return (r * 299 + g * 587 + b * 114) / 1000 > 128 ? "#111111" : "#ffffff";
}

function page(title: string, body: string, accent = "#7b68ee", customCss = "") {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${h(title)} — Hydra Self-Hosted</title><style>${CSS}:root{--accent:${accent};--btn-text:${contrastColor(accent)}}${customCss ? customCss : ""}</style></head><body>${body}</body></html>`;
}

function tokenGatePage(error?: string) {
  return page("Access", `
    <div class="card">
      <h1>⬡ Hydra Self-Hosted</h1>
      <h2>Enter your API token to continue</h2>
      ${error ? `<div class="err">${h(error)}</div>` : ""}
      <form method="POST" action="/web/gate">
        <div class="field"><label>API Token</label><input name="instance_token" type="password" autofocus required></div>
        <button type="submit">Continue</button>
      </form>
    </div>
  `, "#e0e0e0");
}

function loginPage(error?: string, launcher = false) {
  return page("Sign in", `
    <div class="card">
      <h1>⬡ Hydra Self-Hosted</h1>
      <h2>Sign in to your account</h2>
      ${error ? `<div class="err">${h(error)}</div>` : ""}
      <form method="POST" action="/web/login">
        <input type="hidden" name="launcher" value="${launcher ? "1" : ""}">
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
    <div class="card wide" style="padding:0;overflow:hidden">
      ${user.background_image_url ? `<div style="height:140px;background:url('${h(user.background_image_url)}') center/cover no-repeat"></div>` : `<div style="height:60px;background:var(--bg3)"></div>`}
      <div style="padding:0 32px 32px">
        <div style="display:flex;align-items:flex-end;gap:16px;margin-top:${user.background_image_url ? "-36px" : "-16px"};margin-bottom:16px;position:relative;z-index:1">
          ${user.profile_image_url
            ? `<img src="${h(user.profile_image_url)}" style="width:64px;height:64px;border-radius:50%;border:3px solid var(--bg2);object-fit:cover;flex-shrink:0">`
            : `<div style="width:64px;height:64px;border-radius:50%;border:3px solid var(--bg2);background:var(--bg3);display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0">⬡</div>`}
          <div>
            <div style="font-size:18px;color:var(--accent);font-weight:bold">${h(user.display_name || user.username)}</div>
            <div style="font-size:13px;color:var(--sub)">@${h(user.username)} · ${games.length} games · ${totalHours.toLocaleString()}h</div>
          </div>
        </div>
      ${msg ? `<div class="${msgType}">${h(msg)}</div>` : ""}

      <h3>Security</h3>
      <form method="POST" action="/web/password">
        <div class="field"><label>Current password</label><input name="current_password" type="password" required autocomplete="current-password"></div>
        <div class="field"><label>New password</label><input name="new_password" type="password" required minlength="6" autocomplete="new-password"></div>
        <button type="submit">Change password</button>
      </form>

      <h3>Profile</h3>
      <form method="POST" action="/web/profile">
        <div class="field"><label>Display name</label><input name="display_name" value="${h(user.display_name)}" maxlength="64"></div>
        <div class="field"><label>Bio</label><textarea name="bio" maxlength="200">${h(user.bio)}</textarea></div>
        <div class="field"><label>Accent color</label><div style="display:flex;gap:8px;align-items:center"><input type="color" id="accent_picker" name="accent_color" value="${h(accent)}" style="width:40px;height:32px;padding:2px;cursor:pointer" oninput="document.getElementById('accent_hex').value=this.value"><input id="accent_hex" name="accent_color_hex" value="${h(accent)}" maxlength="7" style="flex:1" placeholder="#7b68ee" oninput="if(/^#[0-9a-fA-F]{6}$/.test(this.value))document.getElementById('accent_picker').value=this.value"></div></div>
        <div class="field"><label>Custom CSS <span style="color:var(--sub);font-size:11px">(applied to dashboard &amp; public profile)</span></label><textarea name="custom_css" rows="6" style="font-family:monospace;font-size:12px" placeholder="/* e.g. body { background: #000; } */">${h(user.custom_css || "")}</textarea></div>
        <button type="submit">Save profile</button>
      </form>

      <h3>Steam integration</h3>
      <div class="warn">Your Steam API key is stored on this server. Use a dedicated key or one with minimal permissions.</div>
      <form method="POST" action="/web/steam">
        <div class="field"><label>SteamID64 <a href="https://steamid.io" target="_blank">↗ find yours</a></label><input name="steam_id" value="${h(user.steam_id ?? "")}" placeholder="76561198xxxxxxxxx"><p style="font-size:11px;color:var(--sub);margin-top:4px">Go to <a href="https://steamid.io" target="_blank">steamid.io</a>, enter your Steam profile URL or username, copy the <strong>steamID64</strong> value.</p></div>
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
    </div>
  `, accent, user.custom_css || "");
}

const DEFAULT_PROFILE_CSS = `*{box-sizing:border-box;margin:0;padding:0}body{background:#111;color:#e1e1e1;font-family:"Inter",system-ui,sans-serif;font-size:14px;min-height:100vh}a{color:inherit;text-decoration:none}.card.wide{max-width:100%;border-radius:0;border:none;background:transparent}.card.wide>div:first-child{height:220px!important;border-radius:0}.card.wide>div:nth-child(2){max-width:960px;margin:0 auto;padding:0 32px 48px!important}.card.wide>div:nth-child(2)>div:first-child{margin-top:-56px!important;margin-bottom:24px!important;align-items:flex-end}.card.wide>div:nth-child(2)>div:first-child img,.card.wide>div:nth-child(2)>div:first-child>div:first-child{width:96px!important;height:96px!important;border-radius:12px!important;border:3px solid #111!important;box-shadow:0 4px 24px rgba(0,0,0,.6)}.card.wide h1{font-size:22px;font-weight:700;letter-spacing:-.3px;color:#fff}.card.wide h2{font-size:13px;font-weight:400;color:#888;margin-top:2px}.card.wide>div:nth-child(2)>div:nth-child(2){background:#1a1a1a;border:1px solid #2a2a2a;border-radius:10px;padding:16px 24px;gap:32px!important;margin:0 0 24px!important;display:inline-flex!important}.card.wide>div:nth-child(2)>div:nth-child(2)>div{text-align:center}.card.wide>div:nth-child(2)>div:nth-child(2) span:first-child{font-size:20px!important;font-weight:700}.tab-btn{background:transparent;border:none;border-bottom:2px solid transparent;color:#888;font-size:13px;font-weight:500;padding:8px 4px;cursor:pointer;transition:color .15s,border-color .15s}.tab-btn.active,.tab-btn:hover{color:var(--btn-text,#111);border-color:var(--accent,#8b5cf6)}.game-grid{display:grid!important;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;margin-top:16px}.game-item{background:#1a1a1a;border:1px solid #2a2a2a;border-radius:8px;overflow:hidden;transition:border-color .15s,transform .15s;cursor:default}.game-item:hover{border-color:var(--accent,#8b5cf6);transform:translateY(-2px)}.game-item img{width:100%;aspect-ratio:3/2;object-fit:cover;display:block}.game-item>div{padding:8px 10px}.game-item strong{font-size:12px;font-weight:500;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.game-item span{font-size:11px;color:#666}.card.wide p:last-child{color:#444!important;margin-top:32px!important}.card.wide p:last-child a{color:var(--accent,#8b5cf6)}`;

function publicProfilePage(user: DbUser, games: DbGame[]) {
  const accent = user.accent_color || "#7b68ee";
  const totalHours = Math.floor(games.reduce((s, g) => s + g.play_time_in_seconds, 0) / 3600);
  const hydraGames = [...games].filter(g => g.shop !== "steam" || !user.steam_id)
    .sort((a, b) => b.play_time_in_seconds - a.play_time_in_seconds);
  const steamGames = [...games].filter(g => g.shop === "steam")
    .sort((a, b) => b.play_time_in_seconds - a.play_time_in_seconds);
  const steamHours = Math.floor(steamGames.reduce((s, g) => s + g.play_time_in_seconds, 0) / 3600);

  return page(`@${user.username}`, `
    <div class="card wide" style="padding:0;overflow:hidden">
      ${user.background_image_url ? `<div style="height:120px;background:url('${h(user.background_image_url)}') center/cover no-repeat;position:relative"></div>` : `<div style="height:60px;background:var(--bg3)"></div>`}
      <div style="padding:0 32px 32px">
        <div style="display:flex;align-items:flex-end;gap:16px;margin-top:${user.background_image_url ? "-40px" : "-20px"};margin-bottom:16px;position:relative;z-index:1">
          ${user.profile_image_url
            ? `<img src="${h(user.profile_image_url)}" style="width:72px;height:72px;border-radius:50%;border:3px solid var(--bg2);object-fit:cover;flex-shrink:0">`
            : `<div style="width:72px;height:72px;border-radius:50%;border:3px solid var(--bg2);background:var(--bg3);display:flex;align-items:center;justify-content:center;font-size:28px;flex-shrink:0">⬡</div>`}
          <div>
            <h1 style="margin:0">⬡ ${h(user.display_name || user.username)}</h1>
            <h2 style="margin:0">@${h(user.username)}${user.bio ? ` · ${h(user.bio)}` : ""}</h2>
          </div>
        </div>
        <div style="display:flex;gap:24px;margin:16px 0;font-size:13px">
          <div><span style="color:${accent};font-size:18px;font-weight:bold">${games.length}</span><br><span style="color:var(--sub)">games</span></div>
          <div><span style="color:${accent};font-size:18px;font-weight:bold">${totalHours.toLocaleString()}</span><br><span style="color:var(--sub)">total hours</span></div>
          ${user.steam_id ? `<div><span style="color:${accent};font-size:18px;font-weight:bold">${steamHours.toLocaleString()}</span><br><span style="color:var(--sub)">steam hours</span></div>` : ""}
        </div>
        ${tabsHtml(hydraGames, steamGames, Boolean(user.steam_id))}
        <p style="font-size:11px;color:var(--sub);margin-top:16px">Powered by <a href="https://github.com/entitybtw/hydra-selfhosted">Hydra Self-Hosted</a></p>
      </div>
    </div>
  `, accent, DEFAULT_PROFILE_CSS + (user.custom_css || ""));
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
  app.get("/", async (req: FastifyRequest<{ Querystring: { launcher?: string } }>, reply: FastifyReply) => {
    const user = getUserFromCookie(req);
    if (user) return reply.redirect("/web/dashboard");
    const gate = (req as any).cookies?.["gate_ok"];
    if (gate !== "1") return reply.type("text/html").send(tokenGatePage());
    const launcher = (req.query as any).launcher === "1";
    return reply.type("text/html").send(loginPage(undefined, launcher));
  });

  // Called by launcher to set gate cookie without exposing token in URL
  app.post("/web/launcher-gate", {
    config: { rawBody: true },
  }, async (req: FastifyRequest<{ Body: Record<string, string> }>, reply: FastifyReply) => {
    const secret = process.env.API_TOKEN;
    if (!secret || req.body?.token !== secret) {
      return reply.code(403).send({ error: "forbidden" });
    }
    return reply
      .setCookie("gate_ok", "1", { path: "/", httpOnly: true, maxAge: 60 * 60 * 24 * 7 })
      .send({ ok: true });
  });

  // Auto-login via launcher userToken
  app.post("/web/auto-login", {
    config: { rawBody: true },
  }, async (
    req: FastifyRequest<{ Body: { userToken?: string } }>,
    reply: FastifyReply
  ) => {
    const userToken = req.body?.userToken;
    if (!userToken) return reply.code(400).send({ error: "missing userToken" });
    let userId: string;
    try {
      userId = verifyToken(userToken, "access");
    } catch (e: any) {
      if (e?.name !== "TokenExpiredError") return reply.code(403).send({ error: "invalid token" });
      const jwt = await import("jsonwebtoken");
      const decoded = jwt.default.decode(userToken) as any;
      userId = decoded?.sub;
      if (!userId) return reply.code(403).send({ error: "invalid token" });
    }
    const user = db.prepare("SELECT id FROM users WHERE id = ?").get(userId);
    if (!user) return reply.code(404).send({ error: "user not found" });
    const webToken = signAccess(userId);
    return reply
      .setCookie("gate_ok", "1", { path: "/", httpOnly: true, maxAge: 60 * 60 * 24 * 7 })
      .setCookie("web_token", webToken, { path: "/", httpOnly: true, maxAge: 60 * 60 * 24 * 30 })
      .send({ ok: true });
  });

  app.post("/web/gate", {
    config: { rawBody: true },
  }, async (req: FastifyRequest<{ Body: Record<string, string> }>, reply: FastifyReply) => {
    const secret = process.env.API_TOKEN;
    if (!secret || req.body?.instance_token !== secret) {
      return reply.type("text/html").send(tokenGatePage("Invalid token."));
    }
    return reply
      .setCookie("gate_ok", "1", { path: "/", httpOnly: true, maxAge: 60 * 60 * 24 * 7 })
      .redirect("/");
  });

  // Login / register form handler
  app.post("/web/login", {
    config: { rawBody: true },
  }, async (req: FastifyRequest<{ Body: Record<string, string> }>, reply: FastifyReply) => {
    const { username, password, action, launcher } = req.body ?? {};
    const isLauncher = launcher === "1";

    if (action === "register") {
      if (!username || !password) return reply.type("text/html").send(loginPage("Username and password required.", isLauncher));
      const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
      if (existing) return reply.type("text/html").send(loginPage("Username already taken.", isLauncher));

      const id = crypto.randomUUID();
      db.prepare("INSERT INTO users (id, username, password_hash, display_name) VALUES (?,?,?,?)")
        .run(id, username, hashPassword(password), username);

      const token = signAccess(id);
      if (isLauncher) return reply.redirect(`hydra-self-hosted://token/${token}`);
      return reply
        .setCookie("web_token", token, { path: "/", httpOnly: true, maxAge: 60 * 60 * 24 * 30 })
        .redirect("/web/dashboard");
    }

    const user = db.prepare("SELECT id, password_hash FROM users WHERE username = ?")
      .get(username) as { id: string; password_hash: string } | undefined;

    if (!user || !verifyPassword(password, user.password_hash)) {
      return reply.type("text/html").send(loginPage("Invalid username or password.", isLauncher));
    }

    const token = signAccess(user.id);
    if (isLauncher) return reply.redirect(`hydra-self-hosted://token/${token}`);
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
    const { display_name, bio, accent_color, accent_color_hex, custom_css } = req.body ?? {};
    const accent = (/^#[0-9a-fA-F]{6}$/.test(accent_color_hex ?? "") ? accent_color_hex
      : /^#[0-9a-fA-F]{6}$/.test(accent_color ?? "") ? accent_color : null);
    db.prepare("UPDATE users SET display_name = ?, bio = ?, accent_color = ?, custom_css = ? WHERE id = ?")
      .run((display_name ?? "").slice(0, 64), (bio ?? "").slice(0, 200), accent, (custom_css ?? "").slice(0, 8000), user.id);
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

  // Change password
  app.post("/web/password", {
    config: { rawBody: true },
  }, async (req: FastifyRequest<{ Body: Record<string, string> }>, reply: FastifyReply) => {
    const user = getUserFromCookie(req);
    if (!user) return reply.redirect("/");
    const { current_password, new_password } = req.body ?? {};
    const row = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(user.id) as { password_hash: string };
    if (!verifyPassword(current_password ?? "", row.password_hash)) {
      const games = db.prepare("SELECT * FROM games WHERE user_id = ? AND is_deleted = 0").all(user.id) as DbGame[];
      return reply.type("text/html").send(dashboardPage(user, games, "Current password is incorrect.", "err"));
    }
    if (!new_password || new_password.length < 6) {
      const games = db.prepare("SELECT * FROM games WHERE user_id = ? AND is_deleted = 0").all(user.id) as DbGame[];
      return reply.type("text/html").send(dashboardPage(user, games, "New password must be at least 6 characters.", "err"));
    }
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(new_password), user.id);
    const games = db.prepare("SELECT * FROM games WHERE user_id = ? AND is_deleted = 0").all(user.id) as DbGame[];
    return reply.type("text/html").send(dashboardPage(user, games, "Password changed.", "ok"));
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
