# Pulse — Backend

API for Pulse: **Express 5**, **Postgres** (Drizzle ORM), **Redis**, JWT httpOnly cookie auth, and
email verification / password-reset flows. On top of auth it powers the **cookie-consent** product:
per-user **websites**, a **cookie policy** per website (a section-based editor with rich text and
image uploads), and one-click **HTML export / email** of the finished policy. Uploaded images are
stored in **Amazon S3**. The React client lives in a separate repo (`../frontend`).

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
- Fill in the **AWS / S3** vars (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`,
  `S3_BUCKET`) — cookie-policy image uploads are stored in a **private** S3 bucket. `S3_BUCKET` is
  the bare bucket name and `AWS_REGION` the region code (e.g. `ap-south-1`); the IAM creds need
  `s3:PutObject`/`GetObject`/`DeleteObject`. (`S3_ENDPOINT` is only for LocalStack/MinIO.)
- Leave `DATABASE_URL` / `REDIS_URL` as-is for the Docker path (Compose overrides them internally).

`.env` is gitignored — never commit real secrets. `.env.example` is the shared template.

## 2. Run with Docker (recommended)

```bash
docker compose up --build
```

This starts three services (defined in [`compose.yaml`](./compose.yaml)):

| Service   | What              | Host port     |
| --------- | ----------------- | ------------- |
| `db`      | Postgres 17       | `5434` → 5432 |
| `redis`   | Redis 8           | `6379`        |
| `backend` | the API (Node 22) | `8000`        |

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

Routes are grouped by resource — see [`openapi.yaml`](./openapi.yaml) for the complete spec:

- **`/pulse/users`** — auth (signup, verify, login/logout, password reset, token rotation, `me`).
- **`/pulse/websites`** — per-user website CRUD, each seeded with a default cookie policy on create.
- **`/pulse/websites/:id/cookie-policy`** — the cookie policy for a website: read the content, upsert
  a section or the policy meta (effective date), `GET .../html` for a self-contained HTML snippet,
  `POST .../send-code` to email that snippet to a teammate, and `DELETE` to reset it to defaults.
- **`/pulse/websites/:id/images`** + **`/pulse/images/:id`** — upload (png/jpeg → S3) and serve
  cookie-policy images; serving is authenticated and owner-scoped.

Auth uses **httpOnly cookies** (`accessToken`, `refreshToken`) — clients must send
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
