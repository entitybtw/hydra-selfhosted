# hydra-selfhosted

Self-hosted backend for the [entitybtw/hydra](https://github.com/entitybtw/hydra) fork of Hydra Launcher — cloud saves, accounts, profiles and game data on your own server, without a Hydra Cloud subscription.

![Web dashboard](images/screenshot.png)

## Features

- **Accounts** — register / login, sessions, optional passkeys (WebAuthn) and single sign-on (OpenID Connect, e.g. authentik)
- **Public profiles** — shareable page at `/u/username` with playtime, library and recent activity; avatar, banner, bio, accent color and custom CSS
- **Steam integration** — connect Steam to show hours and library (synced every 30 min)
- **Cloud saves** — unlimited slots on your own server, 50 MB per upload by default
- **Library management** — pin / favorite games, playtime tracking, per-tab section order and visibility
- **Web dashboard** — full UI at `/` (profile editing, library, password change, admin panel)
- **API docs** — built-in reference at `/docs`
- **Launcher compatibility** — Big Picture, friendships stub and `/download-sources` proxy all work out of the box

## Quick start

```bash
git clone https://github.com/entitybtw/hydra-selfhosted.git
cd hydra-selfhosted
cp .env.example .env
# edit .env — set API_TOKEN to a random secret string
docker compose up -d
```

The prebuilt image [`entbtw/hydra-selfhosted`](https://hub.docker.com/r/entbtw/hydra-selfhosted) is pulled automatically, so nothing is compiled locally. The server runs on port 3000 by default.

## Configuration (`.env`)

| Variable | Default | Description |
|---|---|---|
| `API_TOKEN` | — | **Required.** Secret used to sign sessions and for the launcher |
| `PORT` | `3000` | Host port to expose |
| `TAG` | `latest` | Image tag: `latest` or a pinned version (e.g. `v0.0.1`) |
| `SESSION_TTL_DAYS` | `30` | Launcher session duration |
| `PUBLIC_URL` | — | Public URL shown in the web dashboard |
| `MAX_SAVE_SIZE_MB` | `50` | Cloud save upload limit |
| `INITIAL_ADMIN_USERNAME` | — | Create this admin user on first run |
| `INSTANCE_TOKEN` | — | Bearer token for the admin API (`/admin/*`), which is off while unset. If set, it must equal `API_TOKEN` (the launcher checks it too when saving its settings), so every launcher user gets admin API access |
| `WEBAUTHN_RP_ID` / `WEBAUTHN_ORIGIN` | — | Passkeys: bare domain / full origin URL |
| `OIDC_ISSUER` | — | Single sign-on: issuer URL of your OpenID Connect provider (see below) |
| `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` | — | Single sign-on: client credentials from the provider |
| `CORS_ORIGINS` | — | Comma-separated allowed origins |

## Single sign-on (OIDC)

Users can sign in and register through any OpenID Connect provider (authentik, Keycloak, Authelia, …). It stays off until `OIDC_ISSUER` and `OIDC_CLIENT_ID` are set, and local accounts keep working either way.

Example with authentik:

1. **Applications → Providers → Create → OAuth2/OpenID Provider**
   - Client type: **Confidential**
   - Redirect URI (strict): `<PUBLIC_URL>/web/oidc/callback`, e.g. `https://hydra.example.com/web/oidc/callback`
   - Keep the default scopes (`openid`, `email`, `profile`)
   - Keep the default subject mode (**Based on the User's hashed ID**): username or email subjects can be changed by users, which would let one user sign in as another
2. **Applications → Applications → Create**, slug e.g. `hydra`, with that provider. Bind the users or groups allowed to sign in: without bindings, every authentik user can.
3. Add to `.env` and run `docker compose up -d`:

   ```
   PUBLIC_URL=https://hydra.example.com
   OIDC_ISSUER=https://auth.example.com/application/o/hydra/
   OIDC_CLIENT_ID=<Client ID from the provider>
   OIDC_CLIENT_SECRET=<Client Secret from the provider>
   ```

A **Sign in with SSO** button then shows on the sign-in page, in the browser and in the launcher. SSO users skip the API token prompt, so control access in your provider.

The first SSO sign-in creates an account named after `preferred_username` (with a suffix if that name is taken). Existing local accounts are never linked automatically. Accounts are linked to the provider's `sub` claim: before switching to a *different* provider, clear the old links by running `UPDATE users SET oidc_sub = NULL;` on `data/hydra.db`.

## Connecting to Hydra Launcher

1. Open the [entitybtw/hydra](https://github.com/entitybtw/hydra) fork
2. **Settings → Integrations → Self-Hosted API**
3. Enter your server URL and `API_TOKEN`, click **Save**
4. Register or sign in — the launcher syncs your library automatically

## Updating

```bash
docker compose pull && docker compose up -d
```

To pin a release, set `TAG=v0.0.1` in `.env`.

## Data & backup

Everything lives in `./data/` — back up this folder to preserve all user data:

```
data/
  hydra.db        # SQLite database (users, games, achievements, artifacts)
  images/         # uploaded avatars and banners
  artifacts/      # cloud save archives
```

`.env` and `data/` are never touched by updates.

## Building the image yourself

```bash
docker build -t entbtw/hydra-selfhosted:latest ./api
```

## Requirements

- Docker + Docker Compose
