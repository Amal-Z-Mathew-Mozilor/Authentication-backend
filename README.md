# Pulse — Backend

Authentication API for Pulse: **Express 5**, **Postgres** (Drizzle ORM), **Redis**, JWT httpOnly
cookie auth, and email verification / password-reset flows. The React client lives in a separate
repo (`../frontend`).

> Deeper architecture notes for contributors are in [`CLAUDE.md`](./CLAUDE.md); the full HTTP
> contract is in [`openapi.yaml`](./openapi.yaml).

## Prerequisites

- **Docker** + **Docker Compose** (recommended path — brings up Postgres, Redis, and the API), **or**
- **Node.js 22+** with your own Postgres and Redis if you prefer to run it on the host.

## 1. Configure environment

```bash
cp .env.example .env
```

Then edit `.env`:

- Generate the two JWT secrets: `openssl rand -hex 32` (must **not** contain a `$`).
- Fill in your SMTP credentials (`MAIL_*`) — e.g. a [Mailtrap](https://mailtrap.io) sandbox inbox.
- Leave `DATABASE_URL` / `REDIS_URL` as-is for the Docker path (Compose overrides them internally).

`.env` is gitignored — never commit real secrets. `.env.example` is the shared template.

## 2. Run with Docker (recommended)

```bash
docker compose up --build
```

This starts three services (defined in [`compose.yaml`](./compose.yaml)):

| Service | What | Host port |
|---------|------|-----------|
| `db` | Postgres 17 | `5434` → 5432 |
| `redis` | Redis 8 | `6379` |
| `backend` | the API (Node 22) | `8000` |

The `backend` service waits for the db/redis healthchecks, then **auto-runs `drizzle-kit push`**
(creates the tables on first boot) before starting the server. The API is then at
**http://localhost:8000**.

Stop with `Ctrl-C`; add `-d` to run detached. Reset everything (including the DB volume) with
`docker compose down -v`.

### Optional: Drizzle Studio (DB browser)

Studio is opt-in behind a Compose profile (it does **not** start on a plain `up`):

```bash
docker compose --profile studio up --build
```

Then open the URL it prints (**https://local.drizzle.studio**, port `4983`).

## 3. Run on the host (without Docker)

Requires Postgres and Redis reachable at the URLs in your `.env`.

```bash
npm install
npx drizzle-kit push     # create tables (no migrations folder)
node src/app.js          # start on http://localhost:8000
```

## API

All routes are under **`/pulse/users`**. See [`openapi.yaml`](./openapi.yaml) for the complete
spec. Auth uses **httpOnly cookies** (`accessToken`, `refreshToken`) — clients must send
`credentials: 'include'`. The frontend proxies `/pulse` → this server.

## Common commands

```bash
node src/app.js                              # start the server
npx drizzle-kit push                         # apply schema to the DB
npx drizzle-kit studio                       # DB browser (host)
docker compose up --build                    # db + redis + backend
docker compose --profile studio up --build   # + Drizzle Studio (port 4983)
docker compose down -v                       # stop and wipe the DB volume
```

## Troubleshooting

- **`Cannot GET /...` (404) for a route you just added** → the image is stale; rebuild with
  `docker compose up --build`.
- **`Failed query: select ...` / missing tables** → run `npx drizzle-kit push` (a fresh DB volume
  has no tables). The Compose `backend` command does this automatically on start.
- **Secret looks blanked in the container** → it contained a `$`; regenerate with
  `openssl rand -hex 32`.
- **Port 8000 already in use** → a stray host `node src/app.js` is running; stop it before
  `docker compose up`.
