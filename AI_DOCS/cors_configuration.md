# CORS Configuration (env-driven allowed origins) Feature Plan

> Backend-only change. **Status: implemented.** Decisions taken: (1) allowed origins come from a
> comma-separated `CORS_ORIGINS` env var (default `http://localhost:5173`); (2) `credentials: true`
> (auth uses cookies); (3) an origin not on the list is rejected (no `Access-Control-Allow-Origin`
> header; the thrown CORS error surfaces as `500`) so the browser blocks the response; (4) the
> `cors` npm package is mounted before routes in `app.js`.
>
> **Verified** (on an isolated port, since Docker holds `:8000`): allowed origin → `204` with
> `Access-Control-Allow-Origin` + `Allow-Credentials: true`; disallowed origin → no CORS headers
> (blocked by browser); no-`Origin` request → allowed.

## 1. Plan

### Objective
Allow the browser-based frontend (a different origin from the API) to make **credentialed**
requests to the backend, by adding a CORS layer whose allowed origins are configured per
environment via an env var — without hardcoding origins in source.

### Problem / motivation
- Frontend and backend run on **different origins**. Locally that's `http://localhost:5173`
  (Vite frontend) → `http://localhost:8000` (API). Different port = **cross-origin**, so the browser
  enforces CORS. (Note: different ports on `localhost` are cross-**origin** but same-**site**, which
  is why `SameSite=Lax` still works — see `cookie_samesite.md`. CORS and SameSite are independent.)
- There is currently **no CORS middleware** (`grep` for `cors` in `src/` returns nothing), so
  cross-origin `fetch`/XHR from the frontend are blocked by the browser and, for credentialed
  requests, preflight (`OPTIONS`) requests are unanswered.
- Auth is **cookie-based** (`httpOnly` cookies). Credentialed CORS has strict rules:
  `Access-Control-Allow-Credentials: true` **and** a specific echoed origin — `*` is **not allowed**
  with credentials.
- Allowed origins differ per environment (local vs prod domains), so they must be **configurable**,
  not hardcoded.

### Scope
- **In scope:** install/mount the `cors` package in `app.js`; read allowed origins from
  `CORS_ORIGINS`; enable credentials; allow the methods/headers the API uses; document the env var.
- **Out of scope:** authentication logic, cookie attributes (see `cookie_samesite.md`), rate
  limiting, CSRF tokens. CORS is **not** a security boundary for non-browser clients — it only
  constrains browsers; server-side authz still applies.

---

## 2. Specification

### 2.1 Dependency
Add the `cors` middleware package:
```bash
npm install cors
```

### 2.2 Middleware (`src/app.js`, mounted BEFORE routes)
```js
import cors from "cors";

const allowedOrigins = (process.env.CORS_ORIGINS || "http://localhost:5173")
  .split(",")
  .map(o => o.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    // allow non-browser clients (curl/Postman) that send no Origin header
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true,                       // required for cookie auth
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));
```
Mount order in `app.js`: `express.json()` → `cookieParser()` → **`cors(...)`** → routes →
error handler. (CORS before routes so preflight `OPTIONS` is handled for every route.)

### 2.3 Environment variable
New variable `CORS_ORIGINS` — comma-separated list of allowed origins (scheme + host + port, no
trailing slash), documented in `backend/CLAUDE.md`:

| Env | Value | When |
|-----|-------|------|
| `CORS_ORIGINS` | unset / `http://localhost:5173` | local dev (default) |
| `CORS_ORIGINS` | `https://app.yourdomain.com` | same-domain prod |
| `CORS_ORIGINS` | `https://app.a.com,https://app.b.com` | multiple frontends |

`backend/.env` (local): `CORS_ORIGINS=http://localhost:5173`.

### 2.4 Behavior
- **Origin allowed** → response carries `Access-Control-Allow-Origin: <that origin>` and
  `Access-Control-Allow-Credentials: true`; browser lets the frontend read the response.
- **Origin not allowed** → no CORS headers echoed; the browser blocks the response (the server may
  still process it — CORS is browser-enforced, so keep real authz on the server).
- **No `Origin` header** (curl/Postman/server-to-server) → allowed, since CORS is a browser concern.

---

## 3. Verification
1. Local: from the `localhost:5173` frontend, perform a login `fetch` with `credentials:'include'`;
   confirm it succeeds and the `Set-Cookie` is stored (check DevTools → Network → response has
   `Access-Control-Allow-Origin: http://localhost:5173` and `Access-Control-Allow-Credentials: true`).
2. Confirm a preflight `OPTIONS` to a `POST` route returns `204`/`200` with the CORS headers.
3. Negative: call the API from an origin **not** in `CORS_ORIGINS`; confirm the browser blocks it.
4. Confirm non-browser calls (curl without `Origin`) still work (health of server-to-server paths).

## 4. Risks
- **`credentials:true` with wildcard origin is invalid.** Never combine `origin:"*"` with
  credentials — the browser rejects it. The allowlist approach avoids this.
- **Trailing slash / scheme mismatch.** `https://app.com` ≠ `https://app.com/` ≠ `http://app.com`.
  Origins must match exactly; document the no-trailing-slash rule.
- **CORS is not authorization.** It only restricts *browser* JS. Non-browser clients ignore it, so
  it must not be relied on as an access-control mechanism — server-side auth stays authoritative.
- **Preflight caching / missing methods.** If a method or header the frontend uses isn't in the
  config, requests fail with an opaque CORS error; keep the lists in sync with actual API usage.

---

## 5. Design Notes
- **Why env-driven (`CORS_ORIGINS`) not hardcoded.** Allowed origins are a deployment property (they
  change between local, staging, prod, and per frontend). A comma-separated env var lets ops change
  them without a code edit — mirrors the pattern already used for `ALLOWED_VERIFY_BASES` /
  `ALLOWED_RESET_BASES` and `COOKIE_SAMESITE`.
- **Why an allowlist function, not a static string.** Credentialed CORS forbids `*` and requires
  echoing the *specific* requesting origin. The `origin` callback validates against the list and
  echoes the match, which is the correct pattern for `credentials:true`.
- **Why allow requests with no `Origin`.** Server-to-server tools and health checks send no `Origin`
  header; CORS is a browser-only mechanism, so blocking them adds no security and breaks tooling.
- **Why `credentials:true` is mandatory here.** Auth is via `httpOnly` cookies; without
  `Access-Control-Allow-Credentials: true` (and `credentials:'include'` on the client) the browser
  will neither send nor store the cookie cross-origin.
- **Relationship to SameSite.** SameSite decides whether the *cookie* rides along; CORS decides
  whether the *frontend JS may read the response*. Both are needed for the cross-origin cookie flow;
  neither replaces the other. See `cookie_samesite.md`.

## 6. AI-Assisted Development — Prompts
This feature was developed with Claude Code. The user prompts that drove it, in order:

1. "i want to put a cors in my env give a plan.md for it" — requested an env-driven CORS layer and
   this plan document (before implementation).
2. "ok implement it" — authorized implementation: installed `cors`, mounted the middleware in
   `app.js`, added `CORS_ORIGINS` to `.env` and `CLAUDE.md`, and verified preflight behavior.

## 7. Supporting Documentation
Files that will be part of this feature's AI-assisted workflow, committed to the repo:

- `backend/AI_DOCS/cors_configuration.md` — this plan/spec/design document.
- `backend/src/app.js` — implementation (import + `app.use(cors(...))` before routes). ✅
- `backend/package.json` / `package-lock.json` — `cors` dependency (`^2.8.6`). ✅
- `backend/.env` — `CORS_ORIGINS=http://localhost:5173` for local dev (gitignored; mirror in any
  `.env.example`). ✅
- `backend/CLAUDE.md` — Environment section documents `CORS_ORIGINS`. ✅
- Related plans: `backend/AI_DOCS/cookie_samesite.md`, `backend/AI_DOCS/trust_proxy_client_ip.md`.

### External references
- MDN — Cross-Origin Resource Sharing (CORS); `Access-Control-Allow-Credentials`.
- `expressjs/cors` — package documentation and options.
- OWASP — CORS security considerations.
