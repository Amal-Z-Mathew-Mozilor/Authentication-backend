# Convert All Routes to POST Feature Plan

> Full-stack change (backend routes + frontend callers + API docs). **Status: implemented.**
> Decisions taken: (1) the three remaining `GET` routes (`/logout`, `/resetPassword/:token/check`,
> `/me`) become `POST`; (2) all other routes are already `POST` — no change; (3) frontend callers
> updated to send `method: 'POST'`; (4) `openapi.yaml` and both `CLAUDE.md` files updated.
>
> **Verified** (isolated port): old `GET` methods now return `404`; new `POST` methods are reachable
> (`POST /me` → `401` no-token, `POST /logout` → `401`, `POST …/check` → `403` invalid-token — i.e.
> they hit their middleware, not a 404). Frontend files lint clean.

## 1. Plan

### Objective
Make **every** backend route use the `POST` HTTP method, and update the frontend and docs to match,
so the API surface is uniform.

### Current state
Routes in `backend/src/routes/auth.routes.js` — only **three** are not `POST`:

| # | Route | Current method | Becomes |
|---|-------|----------------|---------|
| 1 | `/logout` | `GET` | `POST` |
| 2 | `/resetPassword/:token/check` | `GET` | `POST` |
| 3 | `/me` | `GET` | `POST` |

All other routes (`/signup`, `/verifyEmail/:token`, `/login`, `/forgotPassword`,
`/resetPassword/:token`, `/rotateToken`, `/changePassword`, `/resend/:token`, `/resetResend/:token`)
are already `POST`.

### Rationale / trade-offs
- **`/logout` → POST is a genuine improvement.** A state-changing action behind `GET` is
  CSRF-prone and can be triggered by prefetch/link-crawling. POST is the correct method.
- **`/me` → POST** is unconventional (reads should be `GET`) but harmless; POST bodies are simply
  empty. A minor upside: POST responses are not cached by browsers/proxies, avoiding any stale
  `/me` caching.
- **`/resetPassword/:token/check` → POST** is also unconventional for a read-only pre-check, but
  acceptable; it remains side-effect-free on the server regardless of method.
- **No path collision:** `POST /resetPassword/:token/check` and `POST /resetPassword/:token` stay
  distinct — the `/check` route has an extra path segment, so Express matches them separately.

### Scope
- **In scope:** change the three route method declarations; update the three frontend callers; keep
  all middleware chains and controllers unchanged; update `openapi.yaml` and both `CLAUDE.md` docs.
- **Out of scope:** request/response bodies, auth logic, validation, cookie behavior, CORS.

---

## 2. Specification

### 2.1 Backend — `backend/src/routes/auth.routes.js`
```js
// before → after
user_route.get("/logout", jwtValidation, logout)                    → user_route.post("/logout", jwtValidation, logout)
user_route.get("/resetPassword/:token/check", tokenValidation, checkResetToken)
                                                                    → user_route.post("/resetPassword/:token/check", tokenValidation, checkResetToken)
user_route.get("/me", jwtValidation, me)                            → user_route.post("/me", jwtValidation, me)
```
Middleware order and controllers are unchanged — only the HTTP verb changes.

### 2.2 Frontend callers
| File | Before | After |
|------|--------|-------|
| `frontend/src/Header.jsx:41` | `apiFetch('/pulse/users/logout')` | `apiFetch('/pulse/users/logout', { method: 'POST' })` |
| `frontend/src/HomePage.jsx:20` | `apiFetch(ME_URL)` | `apiFetch(ME_URL, { method: 'POST' })` |
| `frontend/src/ResetPasswordPage.jsx:27` | `fetch(\`…/check\`, { credentials:'include' })` | `fetch(\`…/check\`, { method:'POST', credentials:'include' })` |

Notes:
- `apiFetch` defaults to no method → the browser's `fetch` default is `GET`; adding
  `method:'POST'` is required. `apiFetch` already injects `credentials:'include'` and preserves
  `opts` across its rotate-and-retry, so POST is retained on retry.
- No request bodies are added — these endpoints take none; an empty POST is valid.

### 2.3 Documentation
- `backend/openapi.yaml` — change `get:` → `post:` for the three paths.
- `backend/CLAUDE.md` — endpoint list: `logout(GET)` → `logout(POST)`; `me(GET)` → `me(POST)`;
  the reset-check note.
- `frontend/CLAUDE.md` — Endpoints table: flip the three `GET` rows to `POST`.

---

## 3. Verification
1. `node --check` the changed backend file; boot the server (isolated port) and confirm:
   - `POST /me` with a valid `accessToken` cookie → `200`; `GET /me` → `404` (method no longer bound).
   - `POST /logout` with a valid token → `200` and cookies cleared.
   - `POST /resetPassword/:token/check` → same `200`/`401`/`403` behavior as before.
2. Frontend: log in, load `/home` (calls `POST /me`), log out (calls `POST /logout`), and open a
   reset link (calls `POST …/check`) — all flows work as before.
3. Confirm the token-rotation retry path still works (an expired `/me` triggers `POST /rotateToken`
   then retries `POST /me`).

## 4. Risks
- **Missed caller** → a frontend call left as GET will now hit an unbound method and get `404`.
  Mitigated by the exhaustive caller list in §2.2 (grep-verified: only three GET callers exist).
- **Semantic drift (REST):** `/me` and the reset-check are reads served over POST; documented as an
  accepted trade-off per the explicit requirement. If reverted later, only these two would change.
- **External API consumers** (if any beyond this frontend) relying on the old GET methods would
  break. Within this repo pair the only consumer is the React frontend, which is updated in lockstep.

---

## 5. Design Notes
- **Why only three lines change on the backend.** An audit of `auth.routes.js` shows the API was
  already POST-first; only `/logout`, `/me`, and the reset pre-check used GET. The change is
  therefore small and low-risk.
- **Why controllers/middleware are untouched.** The HTTP method is a routing concern; the handlers
  read from `req.params`/`req.cookies`/`req.body`, none of which depend on the verb. Changing only
  the verb keeps the diff minimal.
- **Why `apiFetch` callers just need `{method:'POST'}`.** `apiFetch` spreads caller `options` over
  its defaults (`{ credentials:'include', ...options }`) and reuses the same `opts` on its
  rotate-and-retry, so specifying the method once is sufficient and survives a token refresh.
- **CSRF angle.** Moving `/logout` off GET removes a real CSRF/prefetch foot-gun. Combined with the
  `SameSite=Lax` cookies (see `cookie_samesite.md`), state-changing requests now require a genuine
  same-site POST.

## 6. AI-Assisted Development — Prompts
This feature was developed with Claude Code. The user prompts that drove it, in order:

1. "i want all my routes to be in post method make the required changes in frontend and backend
   first create a plan.md file for it" — requested the uniform-POST change across both repos, with
   this plan authored first.

(Implementation-authorizing and refinement prompts will be appended as the feature progresses.)

## 7. Supporting Documentation
Files that are part of this feature's AI-assisted workflow, committed to the repo:

- `backend/AI_DOCS/all_routes_post.md` — this plan (backend copy).
- `frontend/AI_DOCS/all_routes_post.md` — this plan (frontend copy, same content).
- `backend/src/routes/auth.routes.js` — the three verb changes.
- `frontend/src/Header.jsx`, `frontend/src/HomePage.jsx`, `frontend/src/ResetPasswordPage.jsx` —
  updated callers.
- `backend/openapi.yaml`, `backend/CLAUDE.md`, `frontend/CLAUDE.md` — doc updates.

### External references
- MDN — HTTP request methods (`GET` vs `POST`), method safety/idempotency.
- OWASP — CSRF prevention (avoid state-changing `GET`).
