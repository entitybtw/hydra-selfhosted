# hydra-selfhosted

Self-hosted API for [Hydra Launcher](https://github.com/hydralauncher/hydra) — cloud saves, achievements, user accounts.

## Requirements

- Docker + Docker Compose

## Setup

```bash
cp .env.example .env
# Edit .env — set JWT_SECRET to a random string
docker compose up -d --build
```

API will be available at `http://localhost:3000`.

## Connecting to Hydra Launcher

In Hydra: **Settings → Self-hosted** → enter your server URL and register/login.
