# hydra-selfhosted

Self-hosted API backend for the [entitybtw/hydra](https://github.com/entitybtw/hydra) fork of Hydra Launcher.

Replaces Hydra Cloud with your own server — cloud saves, achievements, user accounts, profile images, and a web dashboard, all on your own hardware.

## Features

- **Cloud saves** — upload and restore game save backups (`.tar` archives via Ludusavi)
- **Achievements** — store unlocked achievements per user per game
- **User accounts** — register/login with username + password, bcrypt hashing, JWT auth
- **Profile** — display name, bio, profile image, background image, accent color, custom CSS
- **Steam integration** — sync playtime from Steam via Steam Web API (every 30 min)
- **Web dashboard** — manage your profile, Steam integration, and library at `/`
- **Public profiles** — public profile page at `/u/:username`
- **Friends** — friend requests and friend list
- **No subscription required** — always treated as subscribed (unlimited cloud save slots)
- **API token gate** — protect the web dashboard with your `API_TOKEN`

## Requirements

- Docker + Docker Compose

## Quick start

```bash
git clone https://github.com/entitybtw/hydra-selfhosted.git
cd hydra-selfhosted
cp .env.example .env
```

Edit `.env`:

```env
API_TOKEN=your-random-secret        # required — used to sign JWTs and gate the web UI
PORT=3000                           # port to expose
SESSION_TTL_DAYS=30                 # how long launcher sessions last (default: 30)
PUBLIC_URL=http://your-server:3000  # shown in the web dashboard
```

Then start:

```bash
docker compose up -d --build
```

API will be available at `http://localhost:3000`.

## Connecting to Hydra Launcher

1. Open the [entitybtw/hydra](https://github.com/entitybtw/hydra) fork
2. Go to **Settings → Self-Hosted API**
3. Enter your server URL (e.g. `http://192.168.1.100:3000`)
4. Enter your `API_TOKEN` as the instance token
5. Click **Save** — a login/register window will open
6. Register or log in — the launcher connects automatically

## Web dashboard

Open `http://your-server:3000` in a browser, enter your `API_TOKEN`, then log in.

From the dashboard you can:
- Edit display name, bio, accent color, and custom CSS
- Set up Steam integration (SteamID64 + Steam Web API key)
- Browse your Hydra and Steam library
- Change your password
- View your public profile

## Data

All data is stored in `./data/`:

```
data/
├── hydra.db          — SQLite database (users, games, achievements, artifacts)
├── artifacts/        — cloud save tar archives
└── images/           — profile and background images
```

Back up the `data/` folder to preserve everything.

## Updating

```bash
git fetch origin && git checkout origin/main -- api/ docker-compose.yml && docker compose up --build -d
```

Your `.env` and `data/` are never touched by updates.

## Stack

- **Node.js** + **Fastify 5** (TypeScript)
- **SQLite** via `better-sqlite3`
- **bcryptjs** for password hashing
- **JWT** via `jsonwebtoken`
- **Docker** for deployment
