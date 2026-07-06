# Trust Proxy — Real Client IP Behind nginx Feature Plan

> Backend-only change. **Status: implemented.** Decisions taken: (1) hop count is driven by the
> `TRUST_PROXY_HOPS` env var (default `0`) rather than a hardcoded `true`/`1`; (2) no change to the
> existing per-IP rate-limit keys — they inherit the corrected `req.ip` automatically.

## 1. Plan

### Objective
Make `req.ip` resolve to the **real client IP** when the app runs behind an nginx load balancer,
instead of the load balancer's IP.

### Problem
The per-IP login limiter uses `login:ip:${req.ip}` (in `login.middleware.js` and
`auth.controller.js`). By default Express sets `req.ip` from the TCP socket's remote address. When
an nginx reverse proxy / load balancer sits in front of Node, **every** connection to Node
originates from nginx, so `req.ip` is the proxy's IP for all clients.

Consequences:
- The per-IP counter collapses into a **single global bucket**. Ten failed logins from *any*
  client trip the `MAX_IP_ATTEMPTS = 10` limit and return `429` to **all** users coming through
  that proxy — a self-inflicted denial of service.
- Per-IP telemetry / limiting is meaningless because it cannot distinguish clients.

### Root cause
The real client IP is carried in the `X-Forwarded-For` (XFF) header that nginx adds. Express does
**not** read XFF unless it is told to trust the proxy via the `trust proxy` setting.

### Scope
- **In scope:** enable and configure Express `trust proxy`; document the required env var and the
  matching nginx headers.
- **Out of scope:** changing the rate-limit keys or thresholds; changing rate-limit semantics
  (tracked separately as the IP+email composite-key plan).

---

## 2. Specification

### 2.1 Application change (`src/app.js`)
```js
// Behind nginx/CDN, the socket IP is the proxy's — the real client IP is in
// X-Forwarded-For. Trust exactly TRUST_PROXY_HOPS proxies so Express derives
// req.ip from XFF without trusting client-spoofed entries. Local dev has no
// proxy, so this defaults to 0 (trust nothing → req.ip = socket IP).
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS) || 0)
```

### 2.2 Why a hop **count**, not `true`
`X-Forwarded-For` is a client-writable header. `app.set('trust proxy', true)` trusts the entire
chain, so an attacker can prepend a forged `X-Forwarded-For: <spoofed ip>` to rotate their apparent
IP (bypassing the limiter) or impersonate another IP (framing a victim). Setting the value to the
**exact number of trusted proxies** makes Express take the correct entry from the right of the XFF
list and ignore anything the client injected further left.

- `0` (default) — no proxy trusted; `req.ip` = socket IP. Correct for **local dev / no proxy**.
- `1` — one nginx in front of Node. Correct for the described production setup.
- `n` — increase by one per additional hop (e.g. CDN/L7 LB → nginx → Node = `2`).

> **Invariant:** `TRUST_PROXY_HOPS` must never exceed the real number of proxies in front of Node.
> Any excess entries are attacker-controlled.

### 2.3 Environment (`.env`)
New variable `TRUST_PROXY_HOPS` (documented in `backend/CLAUDE.md`):

| Env | Local dev | Single nginx (prod) |
|-----|-----------|---------------------|
| `TRUST_PROXY_HOPS` | unset / `0` | `1` |

### 2.4 Required nginx configuration (deployment)
nginx must forward the client address so XFF contains a trustworthy value:
```nginx
location / {
    proxy_pass http://backend;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

### 2.5 Unchanged by design
The rate-limit keys `login:ip:${req.ip}` in `src/middlewares/login.middleware.js` and
`src/controllers/auth.controller.js` are **not** modified. Once `trust proxy` is set, `req.ip`
already returns the real client IP, so these keys become correct with no code change.

---

## 3. Verification
1. Deploy with `TRUST_PROXY_HOPS=1` behind nginx configured as in §2.4.
2. Temporarily log `req.ip` on a login request; confirm it shows a real client IP, **not** the
   nginx / Docker-network address.
3. From two different client IPs, exceed `MAX_IP_ATTEMPTS` on one; confirm only that IP receives
   `429` and the other IP can still log in.
4. Locally (`TRUST_PROXY_HOPS` unset), confirm login still works and `req.ip` is the socket IP.

## 4. Risks
- **Misconfigured hop count** silently reverts to the original bug (too low) or enables IP spoofing
  (too high). Mitigated by the verification step §3.2 and the §2.2 invariant.
- **Missing nginx headers** leave XFF empty; `req.ip` may fall back to the proxy IP. Mitigated by
  §2.4 being part of the deployment checklist.

---

## 5. Design Notes
Rationale behind the decisions, for future maintainers:

- **Why a hop count env var instead of `app.set('trust proxy', true)`.** `X-Forwarded-For` is
  client-writable. Trusting the whole chain (`true`) lets an attacker prepend a forged XFF entry to
  spoof or rotate their apparent IP, defeating the per-IP limiter. Trusting an exact *count* makes
  Express read the correct entry from the right of the list and ignore client-injected ones.
- **Why default to `0`.** Local dev and the current Docker setup have no proxy in front of Node.
  `0` = trust nothing → `req.ip` is the socket IP, which is correct there. A non-zero default would
  make Express read a (nonexistent) XFF hop locally and misreport `req.ip`.
- **Why no change to the rate-limit keys.** The keys `login:ip:${req.ip}` are already correct *once*
  `req.ip` resolves to the real client IP. Enabling `trust proxy` fixes the input to those keys, so
  touching the keys themselves would be redundant and risk regressions.
- **Relationship to the per-IP limiter's purpose.** The IP counter (incremented in the `!user`
  branch) is an account-enumeration guard; it must stay keyed on IP alone. The trust-proxy fix is
  what makes that IP meaningful in the first place — without it the counter is a single global
  bucket that blocks all proxied traffic at once.

## 6. AI-Assisted Development — Prompts
This feature was developed with Claude Code. The user prompts that drove it, in order:

1. "`const key = login:ip:${req.ip}` this req.ip has some problem … there is an nginx balancer in
   front of me so it will only give the ip of load balancer … what are the required plans we should
   implement" — identified the load-balancer-IP problem and requested a plan.
2. "ok what should i do to change it" — authorized the implementation.
3. "before implementing write a plan.md file for the previous trust proxy modification …" followed
   by "now only make plan.md file for trust proxy …" — requested this plan document, per the
   AI-assisted development requirements.
4. "the plan.md file should contain all these properties" / "yes update the trust proxy plan too" —
   added the Design Notes, Prompts, and Supporting Documentation sections.

## 7. Supporting Documentation
Files that are part of this feature's AI-assisted workflow, all committed to the repo:

- `backend/AI_DOCS/trust_proxy_client_ip.md` — this plan/spec/design document.
- `backend/src/app.js` — implementation (`app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS) || 0)`).
- `backend/src/middlewares/login.middleware.js`, `backend/src/controllers/auth.controller.js` —
  consumers of `req.ip` (the per-IP login limiter) that this change makes correct; unchanged by design.
- `backend/CLAUDE.md` — Environment section documents `TRUST_PROXY_HOPS`.
- nginx configuration (deployment-side, §2.4) — `proxy_set_header X-Forwarded-For` etc.
- Related plan: `backend/AI_DOCS/cookie_samesite.md` — cookie/security hardening from the same session.

### External references
- Express — "Express behind proxies" (`trust proxy` setting).
- MDN — `X-Forwarded-For` header.
- OWASP — guidance on trusting proxy headers / IP spoofing.
