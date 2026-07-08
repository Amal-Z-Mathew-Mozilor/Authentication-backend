# Backend — CLAUDE.md

Guidance for working in the `backend/` folder. This is the Pulse authentication API — an
Express server with Postgres (Drizzle), Redis, JWT cookie auth, and email flows. The React
client lives in a separate repo (`../frontend`).

## Stack

- **Node.js + Express 5**, ES modules (`"type": "module"`) — entry `src/app.js`.
- **Postgres** via **drizzle-orm** (`node-postgres`/`pg`); schema in `src/models/`.
- **Redis** (`redis` client) — refresh-token store, access-token blacklist, per-IP login counter,
  per-user `iat` cutoff (`session:iat:<userId>` — see Login protection / `AI_DOCS/session_iat_invalidation.md`).
- **JWT** (`jsonwebtoken`) access + refresh tokens; **bcrypt** for password hashing.
- **express-validator** for input validation; **nodemailer** + **mailgen** for emails.

## Commands

Run from `backend/`:

```bash
node src/app.js                 # start the server (http://localhost:8000). No npm start script.
npx drizzle-kit push            # apply the schema to the DB (creates tables). No migrations folder.
npx drizzle-kit studio          # DB browser (needs node_modules + DATABASE_URL)
npm run smoke                   # auth + website CRUD smoke test (needs a running server + DB)
docker compose up --build       # db + redis + backend (backend auto-runs `drizzle-kit push` on start)
docker compose --profile studio up --build  # db + redis + backend + Drizzle Studio (opt-in; port 4983)
```

Postgres/Redis run via `compose.yaml`. The `backend` service builds `Dockerfile`, waits for
db/redis healthchecks, and connects by service name (`db:5432`, `redis:6379`).

## Structure

```
src/
├── app.js                       # express app, mounts /pulse/users + /pulse/websites + /pulse/images, global error handler, listen
├── routes/auth.routes.js        # all auth routes + their middleware chains
├── routes/website.routes.js     # /pulse/websites CRUD + nested cookie-policy routes (all behind jwtValidation)
├── controllers/auth.controller.js   # signup, verifyMail, login, logout, forgot/reset, rotateToken,
│                                     # changePassword, me, resendVerification, resetResend
├── controllers/website.controller.js # listWebsites, createWebsite, updateWebsite, deleteWebsite (user-scoped)
├── controllers/cookiePolicy.controller.js # getCookiePolicy, putSection (per-section jsonb upsert, ownership-checked)
├── controllers/image.controller.js  # uploadImage (multer→Postgres bytea), getImage (streams bytes)
├── routes/image.routes.js       # GET /pulse/images/:id — public image serve
├── middlewares/upload.middleware.js  # multer memory storage, png/jpeg filter (imageUpload)
├── middlewares/
│   ├── auth.middleware.js        # validation() — turns express-validator errors into 422
│   ├── jwt.middleware.js         # jwtValidation() — verifies accessToken cookie, checks blacklist
│   ├── login.middleware.js       # loginMiddleware() — per-IP rate limit + email validation
│   ├── passwordReset.middleware.js   # tokenValidation() — validates reset token (ACTIVE one)
│   ├── passwordResend.middleware.js  # resetTokenResolve() — reset token → req.user.id (for resend)
│   └── emailVerify.middleware.js     # emailTokenValidation() — verify token → req.user.id (for resend)
├── models/                       # drizzle schemas: userschema, email_verification, password_reset, websites, cookie_policy, policy_images (+ index)
├── validators/user.validator.js  # register/login/forgot/reset/changePassword validators (use .bail())
├── validators/website.validator.js  # websiteValidator() — name + url (use .bail())
├── validators/cookiePolicy.validator.js  # cookieSectionValidator() — heading + description (any section)
├── scripts/smoke.js              # auth + website CRUD smoke test (npm run smoke)
├── utils/
│   ├── jwt.js                    # acessSign, refreshSign, verifyAccess, verifyRefresh
│   ├── token.js                  # tokenGeneration (raw+sha256), hashToken
│   ├── password.js               # hashPassword, verifyPassword (bcrypt)
│   ├── mail.js                   # emailVerification / passwordResetVerification templates + sendEmail
│   ├── resetBase.js / verifyBase.js  # allowlist validators for client-supplied email link bases
│   ├── api-response.js / api-error.js / async-handler.js
└── db/                           # index.js (drizzle), redis.js (redis client)
```

## Websites resource (`/pulse/websites`)

Per-user website records (name + URL) — the entity a cookie policy will attach to.
All routes require the `accessToken` cookie (`jwtValidation`) and are scoped to
`req.user.id`. REST verbs: `GET /` (list, newest first), `POST /` (create),
`PUT /:id` (update), `DELETE /:id` (delete). The `websites` table FKs
`users.user_id` (`onDelete: cascade`); a future cookie-policy table will FK
`websites.id` with the same cascade. Responses reuse the shared envelopes
(`422` validation, `404` not-found/not-owned). See `openapi.yaml`.

## Cookie Policy resource (`/pulse/websites/:websiteId/cookie-policy`)

One `cookie_policy` row per website (1:1; `website_id` unique, FK → `websites.id`
`onDelete: cascade`). Section content lives in a single **jsonb `content`** column,
keyed by section — currently `{ aboutCookies: {…}, useOfCookies: { heading, description } }`;
more sections add sibling keys with no migration. Routes (nested, behind `jwtValidation`,
ownership verified via the website's owner): `GET /cookie-policy` returns the whole
`content` (or `{}`); `PUT /cookie-policy/:section` upserts one section (body
`{ heading, description }`), merging so sibling sections are preserved. `:section` is
allowlisted (`aboutCookies`, `useOfCookies`) — unknown → `404`. `description` is HTML
from the Tiptap editor. See `openapi.yaml`.

## Images (`policy_images`)

Editor image uploads are stored **in Postgres** (`bytea`), one row per image, FK →
`cookie_policy.id` (`onDelete: cascade`). `POST /pulse/websites/:websiteId/images`
(jwt + ownership, multer memory storage, png/jpeg + magic-byte check, **no size
limit**; find-or-creates the policy row) → `{ data: { url: "/pulse/images/<id>" } }`.
`GET /pulse/images/:id` streams the bytes with the stored `Content-Type` — **public**
(unguessable UUID) so images render in the editor and on public pages. See `openapi.yaml`.

## Auth model

- On login / email verification / token rotation, the server sets **httpOnly cookies**
  `accessToken` and `refreshToken`. Protected routes read `accessToken`; `rotateToken` reads
  `refreshToken`. There is **no** bearer header.
- **Access token** payload: `{ id, email, jti }`, signed with `ACCESS_SECRETKEY`, `ACCESS_EXPIRY`.
- **Refresh token**: `{ id }`, stored in Redis (`refresh:<token>` → userId). Its Redis TTL is
  **derived from the token's own `exp`** (single source of truth = `REFRESH_EXPIRY`).
- **Rotation** (`rotateToken`): deletes the old refresh from Redis and issues a new access+refresh
  pair (one-time-use refresh).
- **Logout**: blacklists the access token's `jti` in Redis (`blacklist:<jti>`) and clears cookies.
  `jwtValidation` returns `403 "token revoked"` for blacklisted tokens.
- **Login protection:** per-account lockout (5 failed attempts → locked ~2 min, in the `users`
  table) **and** a broader per-IP limit (`MAX_IP_ATTEMPTS = 10`, in Redis, `loginMiddleware`).
  The IP limit is intentionally higher than the account limit so they don't collide.
- **Session invalidation (`session:iat:<userId>`):** a per-user Redis timestamp = the minimum
  acceptable token `iat`. Set (NX + TTL=`REFRESH_EXPIRY_SECONDS`) on login/verifyMail, TTL refreshed
  on `rotateToken`, and **bumped to now on `changePassword`** — which invalidates every existing
  access/refresh token (logs the user out everywhere). Enforced in **both** `jwtValidation` and
  `rotateToken` (`iat < cutoff` → `401 "Session invalidated, please login again"` + cookies cleared
  via `utils/cookies.js` `clearAuthCookies`). Not deleted on logout; `resetPassword` is excluded.
  See `AI_DOCS/session_iat_invalidation.md`.

## Endpoints

All under `/pulse/users`. Full spec: **`openapi.yaml`** (keep it updated with changes).
`signup, verifyMail(POST), resend/:token, login, logout, rotateToken, forgotPassword,
resetPassword/:token(POST), resetPassword/:token/check, resetResend/:token, changePassword,
me`. **All routes are POST** (the former `GET` routes — `logout`, `resetPassword/:token/check`,
`me` — were converted; see `AI_DOCS/all_routes_post.md`).

The **`POST /resetPassword/:token/check`** endpoint is a **read-only** token pre-check: it runs the
same `tokenValidation` middleware and returns `200 "valid"` (or the usual `401`/`403`) **without
consuming the token**, so the client can validate a reset link on page load before showing the
form. See `AI_DOCS/reset_token_precheck.md`.

## Response envelope
- **Success:** `new ApiResponse(code, data, message)` → `{ statuscode, data, message, sucess }`
  (the flag is misspelled **`sucess`** — leave it, clients don't rely on it).
- **Errors:** `throw new ApiError(code, message, error)` → caught by `asyncHandler` → the global
  error handler in `app.js` → `{ success: false, message, errors }`. `422` puts the
  express-validator array in `errors`; the `429` IP limit puts `{ retryAfter }` there.

## Validation
Validators (`user.validator.js`) run in the route chain, then `validation()` throws `422` with the
field errors. Chains use **`.bail()`** after `notEmpty()` so an empty field shows only
"… is required" (not the format errors too).

## Frontend-agnostic design (important)
The backend returns **JSON only** and references **no frontend routes** in code (`verifyMail` does
**not** redirect — it returns JSON; the frontend routes based on the result). The one frontend
reference is the **email link base**, which is **supplied by the client** (`verifyBase`/`resetBase`
in the request body) and **validated against an allowlist** (`resolveVerifyBase`/`resolveResetBase`
→ `ALLOWED_VERIFY_BASES`/`ALLOWED_RESET_BASES`). Keep new work JSON-only; never hardcode a frontend
route or `res.redirect` to the frontend.

## Environment (`.env`, gitignored — see `.env.example` if present)
`PORT`, `NODE_ENV`, `ACCESS_SECRETKEY`, `REFRESH_SECRETKEY`, `ACCESS_EXPIRY`, `REFRESH_EXPIRY`,
`DATABASE_URL`, `REDIS_URL`, `MAIL_HOST`/`MAIL_PORT`/`MAIL_USER`/`MAIL_PASSWORD`,
`ALLOWED_VERIFY_BASES`, `ALLOWED_RESET_BASES`, `TRUST_PROXY_HOPS`, `COOKIE_SAMESITE`, `CORS_ORIGINS`.

- **`CORS_ORIGINS`** — comma-separated allowlist of cross-origin frontends (scheme+host+port, no
  trailing slash) permitted to make credentialed requests. Default `http://localhost:5173` (Vite
  dev). Mounted in `app.js` via the `cors` package with `credentials:true` (cookie auth requires a
  specific echoed origin — `*` is invalid with credentials). Requests with no `Origin` header
  (curl/Postman/server-to-server) are allowed since CORS is browser-enforced only.

- **`COOKIE_SAMESITE`** — `SameSite` attribute for the auth cookies (default `lax`). `lax` for
  local dev and same-site prod (subdomains of one domain, or same origin); `none` only for
  genuinely cross-site deploys (frontend and backend on different registrable domains) — which also
  requires HTTPS on both ends (the code forces `secure:true` when this is `none`), CORS with
  credentials, and CSRF tokens. Note: different ports on `localhost` are **same-site**, so `lax`
  works across the local Docker containers.

- **`TRUST_PROXY_HOPS`** — number of trusted proxies in front of Node (default `0`). Sets
  Express `trust proxy` so `req.ip` reads the real client IP from `X-Forwarded-For` instead of
  the load balancer's IP (otherwise the per-IP login limiter blocks *all* traffic through the
  proxy). Set to `1` behind a single nginx; increase by one per extra hop (CDN/L7 LB). Never
  set higher than the real hop count — the extra entries are client-spoofable.

## Gotchas
- **Secrets must not contain `$`.** Docker Compose interpolates `$word` in `env_file` values →
  blanks them. Use plain hex/base64 for `*_SECRETKEY` (`openssl rand -hex 32`).
- **`REFRESH_EXPIRY`** must include units (`7d`, `12h`) — a bare `"604800"` is parsed as *ms*.
- The active reset-token middleware is **`passwordReset.middleware.js`** (exported as
  `tokenValidation`). Don't confuse the export name with a filename — there is no
  `tokenValidation.middleware.js` (a dead duplicate by that name was removed).
- Tables are created via **`drizzle-kit push`** (no migrations dir). Fresh DB (incl. a new Docker
  volume) has no tables until you push — the compose `backend` command auto-pushes on start.

## AI-assisted docs
Feature plans/specs live in `backend/AI_DOCS/*.md` (one file per feature). Keep them in sync with
the implementation when you change a feature.
