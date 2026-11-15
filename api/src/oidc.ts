import crypto from "node:crypto";

// Single sign-on through any OpenID Connect provider (authorization code flow + PKCE).
const ISSUER = (process.env.OIDC_ISSUER ?? "").replace(/\/+$/, "");
const CLIENT_ID = process.env.OIDC_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.OIDC_CLIENT_SECRET ?? "";
const PUBLIC_URL = (process.env.PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? "3000"}`).replace(/\/+$/, "");
const REDIRECT_URI = `${PUBLIC_URL}/web/oidc/callback`;

export const OIDC_ENABLED = !!(ISSUER && CLIENT_ID);

interface OidcConfig {
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
}

export interface OidcUser {
  sub: string;
  username: string;
  displayName: string;
}

let config: Promise<OidcConfig> | null = null;

function discover(): Promise<OidcConfig> {
  config ??= fetch(`${ISSUER}/.well-known/openid-configuration`)
    .then(res => {
      if (!res.ok) throw new Error(`OIDC discovery failed: HTTP ${res.status}`);
      return res.json() as Promise<OidcConfig>;
    })
    .catch(err => { config = null; throw err; }); // retry on the next sign-in
  return config;
}

export async function oidcAuthUrl() {
  const { authorization_endpoint } = await discover();
  const state = crypto.randomBytes(16).toString("base64url");
  const verifier = crypto.randomBytes(32).toString("base64url");
  const url = new URL(authorization_endpoint);
  for (const [k, v] of Object.entries({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: "openid profile email",
    state,
    code_challenge: crypto.createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  })) url.searchParams.set(k, v);
  return { url: url.toString(), state, verifier };
}

export async function oidcUser(code: string, verifier: string): Promise<OidcUser> {
  const { token_endpoint, userinfo_endpoint } = await discover();
  const tokenRes = await fetch(token_endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      // client_secret_basic: the client auth method every provider must support (RFC 6749 2.3.1)
      Authorization: "Basic " + Buffer.from(`${encodeURIComponent(CLIENT_ID)}:${encodeURIComponent(CLIENT_SECRET)}`).toString("base64"),
    },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: REDIRECT_URI, code_verifier: verifier }),
  });
  if (!tokenRes.ok) throw new Error(`OIDC token request failed: HTTP ${tokenRes.status}`);
  const { access_token } = await tokenRes.json() as { access_token?: string };

  const infoRes = await fetch(userinfo_endpoint, { headers: { Authorization: `Bearer ${access_token}` } });
  if (!infoRes.ok) throw new Error(`OIDC userinfo request failed: HTTP ${infoRes.status}`);
  const info = await infoRes.json() as { sub?: string; preferred_username?: string; email?: string; name?: string };
  if (!info.sub) throw new Error("OIDC userinfo has no sub claim");

  const username = (info.preferred_username ?? info.email?.split("@")[0] ?? "").replace(/[^a-zA-Z0-9_]/g, "").slice(0, 32) || "user";
  return { sub: info.sub, username, displayName: (info.name || username).slice(0, 64) };
}
