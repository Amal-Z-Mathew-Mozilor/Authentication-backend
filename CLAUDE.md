# Backend — CLAUDE.md

Guidance for working in the `backend/` folder. This is the Pulse authentication API — an
Express server with Postgres (Drizzle), Redis, JWT cookie auth, and email flows. The React
client lives in a separate repo (`../frontend`).

## Stack

- **Node.js + Express 5**, ES modules (`"type": "module"`) — entry `src/app.js`.
- **Postgres** via **drizzle-orm** (`node-postgres`/`pg`); schema in `src/models/`.
- **Redis** (`redis` client) — refresh-token store, access-token blacklist, per-IP login counter.
- **JWT** (`jsonwebtoken`) access + refresh tokens; **bcrypt** for password hashing.
- **express-validator** for input validation; **nodemailer** + **mailgen** for emails.

## Commands

Run from `backend/`:

```bash
node src/app.js                 # start the server (http://localhost:8000). No npm start script.
npx drizzle-kit push            # apply the schema to the DB (creates tables). No migrations folder.
npx drizzle-kit studio          # DB browser (needs node_modules + DATABASE_URL)
docker compose up --build       # db + redis + backend (backend auto-runs `drizzle-kit push` on start)
docker compose --profile ...    # (studio service was removed; run studio manually)
```

Postgres/Redis run via `compose.yaml`. The `backend` service builds `Dockerfile`, waits for
db/redis healthchecks, and connects by service name (`db:5432`, `redis:6379`).

## Structure

```
src/
├── app.js                       # express app, mounts /pulse/users, global error handler, listen
├── routes/auth.routes.js        # all routes + their middleware chains
├── controllers/auth.controller.js   # signup, verifyMail, login, logout, forgot/reset, rotateToken,
│                                     # changePassword, me, resendVerification, resetResend
├── middlewares/
│   ├── auth.middleware.js        # validation() — turns express-validator errors into 422
│   ├── jwt.middleware.js         # jwtValidation() — verifies accessToken cookie, checks blacklist
│   ├── login.middleware.js       # loginMiddleware() — per-IP rate limit + email validation
│   ├── passwordReset.middleware.js   # tokenValidation() — validates reset token (ACTIVE one)
│   ├── passwordResend.middleware.js  # resetTokenResolve() — reset token → req.user.id (for resend)
│   └── emailVerify.middleware.js     # emailTokenValidation() — verify token → req.user.id (for resend)
├── models/                       # drizzle schemas: userschema, email_verification, password_reset (+ index)
├── validators/user.validator.js  # register/login/forgot/reset/changePassword validators (use .bail())
├── utils/
│   ├── jwt.js                    # acessSign, refreshSign, verifyAccess, verifyRefresh
│   ├── token.js                  # tokenGeneration (raw+sha256), hashToken
│   ├── password.js               # hashPassword, verifyPassword (bcrypt)
│   ├── mail.js                   # emailVerification / passwordResetVerification templates + sendEmail
│   ├── resetBase.js / verifyBase.js  # allowlist validators for client-supplied email link bases
│   ├── api-response.js / api-error.js / async-handler.js
└── db/                           # index.js (drizzle), redis.js (redis client)
```

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

## Endpoints

All under `/pulse/users`. Full spec: **`openapi.yaml`** (keep it updated with changes).
`signup, verifyMail(POST), resend/:token, login, logout(GET), rotateToken, forgotPassword,
resetPassword/:token(POST), resetPassword/:token/check(GET), resetResend/:token, changePassword,
me(GET)`.

The **`GET /resetPassword/:token/check`** endpoint is a **read-only** token pre-check: it runs the
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
`ALLOWED_VERIFY_BASES`, `ALLOWED_RESET_BASES`.

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
