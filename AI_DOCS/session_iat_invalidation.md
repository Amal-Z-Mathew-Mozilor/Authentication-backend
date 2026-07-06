# Per-User Token Cutoff (`iat`-based session invalidation) Feature Plan

> Full-stack change (backend enforcement + frontend redirect). **Status: implemented & verified**
> (15/15 end-to-end checks pass: cutoff reject/allow in `jwtValidation`, rotate-loophole closure +
> stale-refresh deletion, cookies cleared on invalidation but **not** on plain expiry, and the
> Redis NX/bump/EXPIRE semantics). Core idea: a
> per-user Redis timestamp (`session:iat:<userId>`) is the **minimum acceptable `iat`**. Any
> access/refresh token issued *before* that instant is rejected with `401 "Session invalidated,
> please login again"` and the auth cookies are cleared (via a shared `clearAuthCookies` helper). A
> password change bumps the timestamp to "now", instantly invalidating every existing JWT in every
> browser. The key is **not** deleted on logout — it carries a **TTL equal to the refresh-token
> lifetime**, set when the session starts and **refreshed on every token rotation**, so it
> self-expires once the user is fully inactive. On the frontend, `apiFetch` detects the invalidation
> `401` (and any failed rotate) and **redirects to `/login`**.

## 1. Plan

### Objective
Give the server a way to **invalidate already-issued JWTs** without waiting for them to expire, so
that **changing the password logs the user out of every browser/device**. Achieved with a single
per-user cutoff timestamp in Redis, compared against each token's `iat` (issued-at) claim.

### Background — current state (audited)
- Access token payload is `{ id, email, jti }`; `jsonwebtoken` auto-adds **`iat`** and `exp`. So
  `decoded.iat` is already available in `jwtValidation` (`src/middlewares/jwt.middleware.js`).
- Refresh token payload is `{ id }` (+ auto `iat`/`exp`).
- Tokens are minted in **three** places (all via `acessSign`/`refreshSign`): `verifyMail`, `login`,
  `rotateToken`.
- `jwtValidation` currently verifies the token and checks a **per-token** blacklist
  (`blacklist:<jti>`, set on logout). There is **no per-user** invalidation.
- **Gap this fixes:** `changePassword` (the **authenticated** change-password flow) updates the
  password but **does nothing to existing tokens** — a stolen/old session stays valid until its
  natural expiry. This feature closes that gap for the authenticated flow.
- **`resetPassword` (forgot-password flow) is intentionally excluded** — see §2.5. It runs under
  `tokenValidation` (a reset-token, not a logged-in JWT session), i.e. **outside user
  authentication**, so it neither checks nor bumps the `iat` cutoff.

### The rule (as requested)
On every `jwtValidation`, reject when **`token.iat < redisCutoff`** → respond `401` → the frontend
redirects to `/login`. (The backend returns JSON, never redirects — consistent with the app's
frontend-agnostic design; the SPA already routes to `/login` on `401`.)

### ⚠️ Critical addition not in the original description — the rotate-token loophole
If we only check the **access** token in `jwtValidation`, an old session can escape invalidation:
`apiFetch` auto-calls `POST /rotateToken` on a `401`, and `rotateToken` verifies only the **refresh**
token (which is unaffected). It would mint a brand-new access token with `iat = now > cutoff` and the
session survives the password change. **Therefore the cutoff must also be enforced in
`rotateToken`** against the refresh token's `iat`, and the invalidation `401` message must **not**
contain the word "expired" (or `apiFetch` will try to rotate instead of redirecting). Both are
specified below.

### Scope
- **In scope:** a Redis key `session:iat:<userId>`; set on session start (login/verifyMail) with a
  TTL, TTL refreshed on rotation, bumped on **`changePassword`**; enforced in `jwtValidation`
  **and** `rotateToken`; a shared `clearAuthCookies` helper (reused by `logout` and the invalidation
  paths); a frontend `apiFetch` redirect to `/login` on invalidation.
- **Out of scope:** `resetPassword` (forgot-password flow — outside authentication, see §2.5);
  changing token payloads, cookie attributes, CORS. No DB schema change (Redis is the source of
  truth, matching the request).

---

## 2. Specification

### Shared helper — `clearAuthCookies(res)`
Defined once at module scope in `auth.controller.js` and reused by `logout` **and** the two
invalidation paths (§2.3, §2.4). It clears both cookies with the **same attributes** they were set
with (otherwise the browser won't drop them):
```js
function clearAuthCookies(res) {
  const sameSite = process.env.COOKIE_SAMESITE || "lax";
  const options = { httpOnly: true, secure: process.env.NODE_ENV === "production" || sameSite === "none", sameSite };
  res.clearCookie("accessToken", options).clearCookie("refreshToken", options);
}
```
> We deliberately do **not** call `logout()` from the invalidation paths: `logout` returns `200`
> (wrong — we need `401` so the client redirects), reads `req.user.jti`/`exp` (unset in
> `rotateToken`, and refresh tokens carry no `jti`), and throws if the refresh entry is missing.
> Extracting just the cookie-clearing keeps the useful part without that coupling.

### 2.1 Redis key
- **Key:** `session:iat:<userId>`
- **Value:** Unix time in **seconds** (integer, stored as string) = "reject tokens with `iat` below
  this".
- **TTL:** `REFRESH_EXPIRY_SECONDS` (the refresh-token lifetime, e.g. 7d). The key must outlive the
  longest-lived token that could still be used to obtain access — that is the **refresh** token
  (access is only 15m but can be rotated from the refresh). The TTL is set when the session starts
  (§2.2) and **extended on every rotation** (§2.4), so an actively-used session keeps its cutoff
  alive, and a fully-inactive one self-expires ~7d after its last activity (by which point the
  refresh token has expired anyway). **No explicit delete on logout** (§2.6).

### 2.2 Set on session start — `login`, `verifyMail`, `rotateToken`
After minting the access token, initialize the cutoff **only if absent** (`NX`) so multiple
concurrent sessions coexist (a second login must not invalidate the first):
```js
const { iat } = jwt.decode(accessToken);           // iat of the freshly-signed token
await redisClient.set(`session:iat:${userId}`, String(iat), { NX: true, EX: REFRESH_EXPIRY_SECONDS });
```
> `NX` = don't overwrite an existing cutoff. This keeps the cutoff stable across rotations and
> across additional logins, so only a password change (or logout) moves it.

### 2.3 Enforce in `jwtValidation` (after the blacklist check)
```js
const cutoff = await redisClient.get(`session:iat:${decoded.id}`);
if (cutoff && decoded.iat < Number(cutoff)) {
  clearAuthCookies(res);                                                 // wipe the dead cookies
  throw new ApiError(401, "Session invalidated, please login again");    // NOTE: no "expired"
}
```
- Absent key → allow (no cutoff yet); the `jti` blacklist still guards logged-out tokens. This also
  makes already-logged-in users migrate gracefully when the feature ships.
- ⚠️ **Only clear cookies on the cutoff rejection — never on the generic "Token has expired" `401`.**
  A legitimately expired access token must keep its cookies so `apiFetch` can rotate; clearing the
  refresh cookie there would break normal rotation. Keep `clearAuthCookies` inside the
  `if (cutoff && …)` block.

### 2.4 Enforce in `rotateToken` (after `verifyRefresh`) — closes the loophole + refresh the TTL
Approved implementation:
```js
// ...after: decoded = await verifyRefresh(refreshToken)   // decoded = { id, iat, exp }

// cutoff guard — a refresh token issued before the user's cutoff must not mint a fresh access token
const cutoff = await redisClient.get(`session:iat:${decoded.id}`);
if (cutoff && decoded.iat < Number(cutoff)) {
  await redisClient.del(`refresh:${refreshToken}`);      // kill the stale refresh entry
  clearAuthCookies(res);                                 // wipe the dead cookies
  throw new ApiError(401, "Session invalidated, please login again");   // NOT "expired"
}

await redisClient.del(`refresh:${refreshToken}`);
const accessToken = await acessSign(decoded.id);
const refresh = await refreshSign(decoded.id);

// refresh the cutoff key's TTL for this active session (value unchanged — only lifetime extended):
await redisClient.expire(`session:iat:${decoded.id}`, Number(process.env.REFRESH_EXPIRY_SECONDS));
// ...then set cookies + respond 200 as today.
```
> - Use `EXPIRE` (not `SET`) so the cutoff **value** is preserved — only its lifetime is extended.
>   `EXPIRE` on an absent/expired key is a harmless no-op; a fresh login re-initializes it. Re-`SET`
>   here would be unsafe for multi-session (could invalidate other sessions with an earlier `iat`).
> - The guard's `del(refresh:…)` prevents replay of the stale refresh token; the `throw` skips the
>   normal-flow `del` below for that request.

### 2.5 Bump on password change — `changePassword` only
`changePassword` (authenticated) changes the password but mints **no** new token, so setting the
cutoff to "now" invalidates **every** existing access and refresh token for that user (including the
current browser's):
```js
const now = Math.floor(Date.now() / 1000);
await redisClient.set(`session:iat:${req.user.id}`, String(now), { EX: REFRESH_EXPIRY_SECONDS }); // overwrite
```
- Effect: all outstanding tokens have `iat < now` → rejected on their next request → redirected to
  `/login`. **Logged out everywhere, as intended.**

**`resetPassword` (forgot-password flow) is excluded** — it runs under `tokenValidation` (a
reset-token), **outside user authentication**, so this feature does not touch the cutoff there.
> ⚠️ **Trade-off (documented):** excluding `resetPassword` means a password *reset* does **not**
> invalidate other active sessions. For the common case (a user who forgot their password and has no
> active session) this is fine. For the account-recovery-after-compromise case, an attacker's
> existing session would survive the reset. If that threat matters later, add the same one-line
> bump to `resetPassword` (`req.user.id` is available from `tokenValidation`). Left out per the
> current decision.

### 2.6 Logout — **do NOT delete the key**; reuse `clearAuthCookies`
Logout keeps its existing behavior (blacklist `jti` + delete the refresh entry) and now clears
cookies via the shared `clearAuthCookies(res)` helper. The `session:iat:<userId>` cutoff is **left
in place** and simply **self-expires via its TTL**. Rationale: the logged-out access token is
already killed by the `jti` blacklist, and deleting the per-user cutoff would remove protection for
the user's *other* active sessions. Letting the TTL handle cleanup avoids that.

### 2.7 Frontend — `apiFetch` redirects to `/login` on invalidation
Authenticated calls go through `apiFetch` (`frontend/src/apiFetch.js`), so the behavior is
centralized there. The server has already cleared the cookies; the client just navigates to
`/login` (a full navigation, which also drops in-memory React state). It must **not** call
`POST /logout` (that needs a live refresh entry, already gone).
```js
const LOGIN_PATH = '/login';

// server signalled a hard session invalidation (e.g. password changed on another device)
async function isInvalidated(res) {
  try {
    const data = await res.clone().json();
    return /invalidated/i.test(data?.message || '');
  } catch { return false; }
}

export async function apiFetch(url, options = {}) {
  const opts = { credentials: 'include', ...options };
  let res = await fetch(url, opts);

  if (res.status === 401 && (await isExpired(res))) {
    const refreshed = await rotateOnce();
    if (refreshed) {
      res = await fetch(url, opts);          // retry with the refreshed cookie
    } else {
      window.location.href = LOGIN_PATH;     // Scenario B: rotate failed → session dead → login
      return res;
    }
  }

  if (res.status === 401 && (await isInvalidated(res))) {
    window.location.href = LOGIN_PATH;       // Scenario A: direct invalidation 401 → login
    return res;
  }

  return res;
}
```
- **Scenario A** — access token still valid but `iat < cutoff` → direct `401 "Session invalidated"`
  → `isInvalidated` → `/login`.
- **Scenario B** — access token also expired → `apiFetch` rotates → `rotateToken` cutoff guard
  rejects → `rotateOnce()` returns false → the `else` redirects to `/login`.
- The invalidation message deliberately lacks "expired", so `isExpired` is false and the client
  won't pointlessly rotate on Scenario A.

**`ChangePasswordPage` redirect.** On a successful `changePassword`, the current session is now
invalidated too, so the success screen no longer links to `/home` (which would immediately bounce).
It confirms success and **auto-redirects to `/login`** after ~2s (plus a "Go to login now" link).

---

## 3. Verification
1. **Password change logs out everywhere:** log in on two browsers (A, B). Change the password in A.
   On B's next protected request (`POST /me`) → `401` → redirected to `/login`. A too. ✅
2. **Rotate loophole closed:** after the password change, force `apiFetch`'s rotate path
   (`POST /rotateToken` with the old refresh cookie) → `401`, no new token issued. ✅
3. **Multi-session preserved (no password change):** log in on A, then B; confirm A still works
   (second login's `NX` didn't move the cutoff). ✅
4. **Logout does not drop the cutoff:** logout in A; confirm `redis-cli GET session:iat:<id>` still
   returns the value (not nil) and B remains governed by it.
5. **TTL refresh on rotate:** note the key's TTL (`redis-cli TTL`), trigger a rotation, confirm the
   TTL is bumped back to ~`REFRESH_EXPIRY` while the value is unchanged.
6. **Cookies cleared on invalidation:** confirm the invalidation `401` response carries
   `Set-Cookie` clearing `accessToken`/`refreshToken`; confirm a plain "Token has expired" `401`
   does **not** clear them (rotation must still work).
7. **Frontend redirect:** in browser B after A changes the password, confirm `apiFetch` lands the
   user on `/login` (Scenario A); and that a forced failed-rotate also lands on `/login` (Scenario B).
8. **Migration:** an already-logged-in user (no key) keeps working until password-change/next login.

## 4. Risks
- **Rotate loophole (addressed):** must enforce in `rotateToken`, not only `jwtValidation` (§2.4).
- **`apiFetch` auto-rotate on "expired" (addressed):** invalidation message must not match
  `/expired/i` (§2.3), else the client silently rotates instead of logging out.
- **`iat` 1-second granularity:** a token minted in the *same second* as a password change (`iat ==
  now`) would survive the strict `<`. Negligible here (the user logged in earlier), but if paranoid,
  set the cutoff to `now + 1`. Documented, not enabled by default.
- **Redis eviction/flush:** if the key is lost, the cutoff resets and pre-change tokens are accepted
  again — but only until their short access-token expiry (15m) / until the next rotate is rejected…
  which also relies on the key. Mitigation: treat this Redis data as durable (no `maxmemory`
  eviction of these keys), or add a DB `passwordChangedAt` fallback later (out of scope).
- **TTL expiry mid-life:** if the cutoff key expires (inactive longer than `REFRESH_EXPIRY`) it is
  simply re-created on the next login. During the gap there is "no cutoff", but the refresh token has
  also expired by then, so no pre-change token can still be used — safe by construction.
- **TTL only refreshed on rotate (per design):** a long-lived session that never rotates (unlikely,
  since access expiry is 15m and `apiFetch` rotates on expiry) could let the cutoff key expire while
  the refresh token is still valid. In practice rotation happens well within the TTL window; if
  desired, also `EXPIRE`-extend on login for extra safety (noted, not required).

---

## 5. Design Notes
- **Why per-user, not per-session.** The goal ("password change logs out every browser") is
  inherently per-user. One cutoff timestamp compared to each token's `iat` expresses it in O(1) with
  a single key — no need to enumerate sessions.
- **Why `NX` on session start.** Without it, each new login would overwrite the cutoff to a later
  `iat` and silently kill older sessions (accidental single-session enforcement). `NX` keeps the
  cutoff stable so only password-change moves it.
- **Why enforce in two places.** `jwtValidation` guards normal requests; `rotateToken` guards the
  refresh path. Skipping the latter defeats the whole feature via `apiFetch`'s auto-rotate.
- **Why it complements, not replaces, the `jti` blacklist.** The blacklist kills *one specific
  token* on logout; this cutoff kills *all of a user's tokens* on password change. Different
  granularity, both needed.
- **Why TTL instead of delete-on-logout.** Deleting the per-user cutoff when *one* browser logs out
  would strip protection from the user's *other* active sessions. Instead the key carries a TTL =
  refresh-token lifetime, set at session start and extended on each rotation, so an active session
  keeps its cutoff and an abandoned one self-cleans — no cross-session interference, and the
  logged-out token is still handled by the `jti` blacklist.
- **Why Redis (not a DB column).** Matches the request and keeps it a fast per-request `GET`.
  A `passwordChangedAt` DB column would be a more durable source of truth (survives Redis flush) and
  is the natural future hardening, noted under Risks.
- **Why a `clearAuthCookies` helper, not calling `logout()`.** The intent ("invalidation cleans up
  like logout") is right, but `logout` returns `200` (we need `401` so the client redirects), reads
  `req.user.jti`/`exp` (unset in `rotateToken`; refresh tokens have no `jti`), and throws on a
  missing refresh entry. Extracting just the cookie-clearing gives the shared cleanup without the
  coupling. Blacklisting the `jti` in the invalidation path is unnecessary — the cutoff already
  revokes every old token.
- **Why the frontend redirect lives in `apiFetch`.** All authenticated calls flow through it, so one
  check (`isInvalidated` + failed-rotate `else`) centralizes "session dead → `/login`" instead of
  duplicating it per page. A full navigation (`window.location`) also drops stale React state.

## 6. AI-Assisted Development — Prompts
This feature was developed with Claude Code. The user prompts that drove it, in order:

1. "i want to create a new variable in redis based on iat of jwt token … stored for every user
   session and deletes when user logout, validate inside jwtValidation … if incoming jwt iat less
   than redis value redirect to logout … updated when user change password so existing jwt in any
   browser redirect to login … create a plan.md for it" — requested this feature and plan.
2. "dont delete on logout just put an expiry of jwt token during signup and update this whenever
   token is rotated" — refined the lifecycle: replace delete-on-logout with a TTL = token lifetime,
   set at session start and refreshed on rotation (§2.1, §2.4, §2.6).
3. "first issued at verifyMail / login. yes my mistake" — confirmed the cutoff key is created at the
   first token issuance (verifyMail/login), not at signup (signup mints no token).
4. "`resetPassword` there is no need of checking of iat because its outside user authentication" —
   excluded `resetPassword` from the feature; the cutoff is bumped only in `changePassword` (§2.5).
5. "in case of any iat expiration in any place call the logout and logout will do rest of it" →
   clarified that calling `logout` directly won't work (wrong `200` status, `req.user.jti`/`exp`
   unavailable in `rotateToken`, throws on missing refresh); adopted a shared `clearAuthCookies`
   helper instead (§ Shared helper).
6. "show me the code that you implement in rotate token …" → approved the `rotateToken`
   implementation in §2.4.
7. "when frontend get this go to logout … i mean it should go to login" → frontend `apiFetch`
   redirects to `/login` on invalidation (and on failed rotate) — §2.7.

(Implementation-authorizing prompts will be appended as the feature progresses.)

## 7. Supporting Documentation
Files that will be part of this feature's AI-assisted workflow (to be committed):

- `backend/AI_DOCS/session_iat_invalidation.md` — this plan/spec/design document.
- `backend/src/utils/cookies.js` — **NEW** shared `clearAuthCookies(res)` helper. ✅
- `backend/src/middlewares/jwt.middleware.js` — cutoff check + `clearAuthCookies` (§2.3). ✅
- `backend/src/controllers/auth.controller.js` — imports `clearAuthCookies`/`jwt` +
  `REFRESH_EXPIRY_SECONDS`; set (NX + TTL) on `login`/`verifyMail`; bump on `changePassword`; cutoff
  guard + `clearAuthCookies` + TTL refresh in `rotateToken`; `logout` reuses the helper.
  `resetPassword` unchanged. ✅
- `backend/src/utils/jwt.js` — left unchanged; the controller reads `iat` via `jwt.decode` instead. ✅
- `frontend/src/apiFetch.js` — `isInvalidated` check + redirect to `/login` (Scenario A) and the
  failed-rotate `else` redirect (Scenario B) (§2.7). ✅
- `frontend/src/ChangePasswordPage.jsx` — success screen auto-redirects to `/login` (§2.7). ✅
- `backend/CLAUDE.md` — documented the `session:iat:<userId>` key (Redis list + Login protection). ✅
- `frontend/AI_DOCS/session_iat_invalidation.md` — frontend copy of this plan (same content). ✅
- Related: `AI_DOCS/all_routes_post.md`, `AI_DOCS/cookie_samesite.md` (logout/rotate touched there).

### External references
- RFC 7519 — JWT `iat` claim.
- OWASP — Session Management / token revocation guidance.
- Auth pattern — "tokenValidAfter" / password-change token invalidation.
