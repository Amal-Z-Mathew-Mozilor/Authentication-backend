# Cookie `SameSite` Attribute + CSRF Hardening Feature Plan

> Backend-only change. **Status: implemented.** Decisions taken: (1) default `sameSite` is `"lax"`;
> (2) the value is env-driven via `COOKIE_SAMESITE` so it can be switched per environment without a
> code change; (3) `secure` is forced `true` whenever `sameSite === "none"` (browser requirement);
> (4) `logout` clears cookies with matching attributes.

## 1. Plan

### Objective
Set an explicit `SameSite` attribute on the auth cookies (`accessToken`, `refreshToken`) to defend
against CSRF, and make the value configurable per deployment topology.

### Problem
The auth cookies were set with only `{ httpOnly, secure }` and **no `sameSite`**:
- Relying on the browser's implicit `Lax` default is fragile (older clients, inconsistent behavior)
  and leaves CSRF posture undocumented.
- The correct `SameSite` value depends on where the frontend and backend are deployed relative to
  each other (same-site vs cross-site), so a single hardcoded value cannot serve every environment.
- `logout` called `clearCookie` with **no options**; a cookie set with attributes is only reliably
  removed when `clearCookie` is given matching attributes.

### Background — how `SameSite` is evaluated
`SameSite` is decided on the **registrable domain (eTLD+1)**. **Port is NOT part of the "site."**
So `localhost:3000` (frontend) and `localhost:8000` (backend) are **same-site**, and `Lax` cookies
are sent between them. Different registrable domains (e.g. `myapp.vercel.app` vs
`ec2-…​.amazonaws.com`) are **cross-site**, where `Lax` would suppress the cookie on `fetch`/XHR.

### Deployment matrix (drives the chosen value)

| Deployment | Site relationship | `sameSite` | Notes |
|-----------|-------------------|-----------|-------|
| Local Docker (`localhost:*`) | same-site | `lax` | current setup |
| `app.example.com` + `api.example.com` | same-site (subdomains) | `lax` | recommended prod |
| One origin via reverse proxy | same-origin | `lax`/`strict` | no CORS |
| `vercel.app` + `amazonaws.com` | cross-site | `none` | requires HTTPS both ends; also add CSRF tokens |

### Scope
- **In scope:** add explicit `sameSite` to all cookie set/clear calls; make it env-configurable;
  guard `secure` for the `none` case.
- **Out of scope:** CORS configuration (separate task); CSRF tokens (only needed if `none` is ever
  used cross-site); the per-IP / per-account rate-limit work (separate plans).

---

## 2. Specification

### 2.1 Cookie options (all set-cookie sites: `verifyMail`, `login`, `rotateToken`)
```js
const sameSite = process.env.COOKIE_SAMESITE || "lax";
const options = {
  httpOnly: true,
  // SameSite=None is only honored on Secure (HTTPS) cookies, so force secure in that case.
  secure: process.env.NODE_ENV === "production" || sameSite === "none",
  sameSite,
};
```

### 2.2 Logout must clear with matching attributes
```js
const options = { httpOnly:true, secure: process.env.NODE_ENV === "production" || sameSite === "none", sameSite };
res.clearCookie("accessToken", options).clearCookie("refreshToken", options)
```

### 2.3 Environment variable
New optional variable `COOKIE_SAMESITE` (documented in `backend/CLAUDE.md`):

| Env | Value | When |
|-----|-------|------|
| `COOKIE_SAMESITE` | unset / `lax` | local dev; same-site prod (default) |
| `COOKIE_SAMESITE` | `strict` | same-origin, maximum CSRF hardening |
| `COOKIE_SAMESITE` | `none` | genuinely cross-site prod (implies HTTPS + CORS credentials + CSRF tokens) |

**Current state:** `backend/.env` sets `COOKIE_SAMESITE=lax` (correct for the local Docker setup —
frontend/backend on different `localhost` ports are same-site). Change it to `none` per environment
only if the frontend and backend are ever deployed on different registrable domains.

### 2.4 Values and their meaning
- **`lax`** (default) — cookie sent on same-site requests and top-level cross-site GET navigations,
  but not on cross-site POST/`fetch`/XHR. Blocks classic CSRF while keeping normal use working.
- **`strict`** — cookie sent only on same-site requests. Strongest, but breaks "click a link from
  elsewhere and stay logged in."
- **`none`** — cookie sent on all cross-site requests; **requires `Secure`**. Removes the SameSite
  CSRF protection, so pair with CSRF tokens.

---

## 3. Verification
1. Local (`COOKIE_SAMESITE` unset): log in; confirm `Set-Cookie` shows `SameSite=Lax`, no `Secure`
   (HTTP localhost), and the frontend container's authenticated `fetch` calls succeed.
2. Log out; confirm both cookies are removed from the browser (matching-attribute clear works).
3. Simulate cross-site (`COOKIE_SAMESITE=none`, `NODE_ENV=production`): confirm `Set-Cookie` shows
   `SameSite=None; Secure`.

## 4. Risks
- **`none` without HTTPS** → browser silently drops the cookie. Mitigated by forcing `secure:true`
  when `sameSite==="none"` (§2.1) — the cookie still needs a real HTTPS endpoint to be stored.
- **`none` reduces CSRF protection** → must be paired with CSRF tokens; noted as out-of-scope
  follow-up, not enabled by default.
- **CORS is independent** — cross-origin (even cross-port, same-site) still needs CORS with
  credentials; a working `SameSite` does not imply requests are allowed.

---

## 5. Design Notes
Rationale behind the decisions, for future maintainers:

- **Why env-driven instead of hardcoded `"lax"`.** The correct value is a *deployment* property,
  not a code property — it depends on the site relationship between frontend and backend, which
  changes per environment. Hardcoding would force a code edit + redeploy to move between local,
  same-site prod, and cross-site prod. `process.env.COOKIE_SAMESITE || "lax"` keeps the safe default
  while allowing a per-environment override.
- **Why default to `lax`, not `strict`.** `strict` breaks the common "user clicks an email/verify
  or reset link and lands authenticated" flow (the cookie isn't sent on the inbound cross-site
  navigation). `lax` still blocks the dangerous cross-site POST/`fetch` CSRF vector, so it's the
  standard balanced default for auth cookies.
- **Why `secure` uses `NODE_ENV==="production" || sameSite==="none"`.** Two *independent* reasons to
  require HTTPS: (a) prod should always be HTTPS; (b) browsers reject a `SameSite=None` cookie that
  is not also `Secure`, in **any** environment. The OR guarantees the invalid "None-without-Secure"
  combination can never ship, even if someone sets `COOKIE_SAMESITE=none` outside production.
- **Why declared locally in each handler.** The existing code already re-declared the `options`
  object inside `verifyMail`/`login`/`logout`/`rotateToken`. The change matched that style rather
  than introducing a shared module-level helper, to keep the diff minimal and consistent. A future
  refactor could hoist a single `cookieOptions()` helper.
- **Why `logout` had to change too.** `res.clearCookie(name)` only removes a cookie when the given
  attributes match those it was set with; clearing without options could leave the cookie in place
  in some browsers. Logout now clears with the same `{httpOnly, secure, sameSite}`.
- **Relationship to `localhost` ports.** A key realization during design: different ports on
  `localhost` are same-**site** (port is not part of the site) but cross-**origin**. So `lax` is
  correct for the local Docker containers, while CORS is still separately required.

## 6. AI-Assisted Development — Prompts
This feature was developed with Claude Code. The user prompts that drove it, in order:

1. "before that we didnt put same site=lax for setting cookies" — flagged the missing attribute.
2. "so in case of same site property what if i deployed my front somewhere and backend in amazon
   ec2 something how same site will work?" — led to the deployment matrix (§1) and the same-site vs
   cross-site analysis.
3. "actually the front end and backend are not deployed they are just docker containers in separate
   repo i also dont have domain" — established the local `localhost:*` context → `lax` is correct.
4. "COOKIE_SAMESITE env var ? what is this" — led to explaining/adopting the env-driven approach.
5. "ok do it create a plan.md file for the same site property added" — authorized implementation +
   this plan document.
6. "NODE_ENV === \"production\" || sameSite===\"none\" why like this both are needed?" — clarified
   and documented the `secure` guard rationale (§5).
7. "define it in env also" — added `COOKIE_SAMESITE=lax` to `backend/.env`.
8. "the plan.md file should contain all these properties" — added the Design Notes, Prompts, and
   Supporting Documentation sections to satisfy the AI-assisted development requirements.

## 7. Supporting Documentation
Files that are part of this feature's AI-assisted workflow, all committed to the repo:

- `backend/AI_DOCS/cookie_samesite.md` — this plan/spec/design document.
- `backend/src/controllers/auth.controller.js` — implementation (cookie set sites `verifyMail`,
  `login`, `rotateToken`; cookie clear in `logout`).
- `backend/.env` — `COOKIE_SAMESITE=lax` for local development (gitignored; mirror the key in any
  `.env.example`).
- `backend/CLAUDE.md` — Environment section documents `COOKIE_SAMESITE`.
- Related plan: `backend/AI_DOCS/trust_proxy_client_ip.md` — the `trust proxy` / real-client-IP
  change that also touched request/security handling in the same session.

### External references
- MDN — Set-Cookie `SameSite` attribute.
- OWASP — Cross-Site Request Forgery (CSRF) Prevention Cheat Sheet.
- Express — `res.cookie` / `res.clearCookie` options.
