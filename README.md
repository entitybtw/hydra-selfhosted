# hydra-selfhosted

Self-hosted API backend for the [entitybtw/hydra](https://github.com/entitybtw/hydra) fork of Hydra Launcher.

Replaces the official Hydra Cloud with your own server — cloud saves, achievements, user accounts, and profile images, all running on your own hardware.

## Features

- **Cloud saves** — upload and restore game save backups (`.tar` archives via Ludusavi)
- **Achievements** — store unlocked achievements per user per game
- **User accounts** — register/login with username + password, JWT auth
- **Profile** — display name, bio, profile image, background image
- **Friends** — friend requests, friend list
- **Web profiles** — public profile page at `/u/:username`
- **No subscription required** — self-hosted instance always treats users as subscribed
- **Instance token** — optional access restriction so only your users can register

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
JWT_SECRET=your-random-secret-here        # required — change this
PORT=3000                                  # port to expose
INSTANCE_TOKEN=your-instance-token        # optional — restricts who can connect
API_TOKEN=                                 # optional — for web profile API access
```

Then start:

```bash
docker compose up -d --build
```

API will be available at `http://localhost:3000`.

## Connecting to Hydra Launcher

1. Open Hydra Launcher (fork version)
2. Go to **Settings → Self-Hosted API**
3. Enter your server URL (e.g. `http://192.168.1.100:3000`)
4. Enter the `INSTANCE_TOKEN` from your `.env` (leave empty if not set)
5. Register or log in

After connecting, cloud saves and achievements will use your server instead of Hydra Cloud.

## Data

All data is stored in the `./data/` directory:

```
data/
├── hydra.db          — SQLite database (users, games, achievements, artifacts)
├── artifacts/        — cloud save tar archives
└── images/           — profile and background images
```

Back up the `data/` folder to preserve all user data.

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/auth/register` | Register new user |
| POST | `/auth/login` | Login |
| POST | `/auth/refresh` | Refresh access token |
| POST | `/auth/logout` | Logout |
| POST | `/auth/verify-instance` | Verify instance token |
| POST | `/auth/ws` | Get WebSocket token (stub) |
| GET | `/profile/me` | Get own profile |
| PATCH | `/profile` | Update profile (display name, bio) |
| POST | `/profile/image` | Upload profile image |
| POST | `/profile/background-image` | Upload background image |
| GET | `/profile/games/batch` | Get multiple games |
| POST | `/profile/games/batch` | Sync game library |
| PUT | `/profile/games/:shop/:objectId` | Update single game |
| GET | `/profile/games/:shop/:objectId/achievements` | Get game achievements |
| PUT | `/profile/games/:shop/:objectId/achievements` | Sync achievements |
| DELETE | `/profile/games/achievements/:id` | Delete achievement |
| POST | `/profile/games/artifacts` | Create artifact upload slot |
| GET | `/profile/games/artifacts` | List artifacts |
| DELETE | `/profile/games/artifacts/:id` | Delete artifact |
| POST | `/profile/games/artifacts/:id/download` | Get download URL |
| PUT | `/artifacts/:id` | Upload artifact file |
| GET | `/games/:shop/:objectId/achievements` | Get achievement definitions |
| GET | `/friends` | Get friend list |
| POST | `/friends/:userId` | Send friend request |
| DELETE | `/friends/:userId` | Remove friend |
| GET | `/u/:username` | Public web profile |

## Stack

- **Node.js** + **Fastify 5** (TypeScript)
- **SQLite** via `better-sqlite3`
- **JWT** via `jsonwebtoken`
- **Docker** for deployment
