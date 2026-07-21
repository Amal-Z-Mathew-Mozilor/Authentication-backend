# Plan: Backend-driven auth via typed error codes

- **Slug:** auth-typed-error-codes
- **Scope:** frontend + backend (single plan, stored in backend repo)
- **Status:** draft → approved → implemented

## Objective / feature request

Today the frontend decides which page to show by **parsing the backend's English error
messages** (`/expired/i`, `/used/i`, `429 && /lock/i`, …). That couples routing to prose — a
copy-edit or translation silently breaks navigation.

Make it **backend-driven**: the backend returns a stable machine-readable **`code`** on every
error; the frontend **switches on the code**, never on the message. Messages become
display-only.

## Specifications

- Add an optional `code` to `ApiError` and emit it from the global error handler as a
  top-level field: `{ success, code, message, errors }`.
- Set a stable `code` at each auth throw site. v1 enum:
  `TOKEN_EXPIRED`, `TOKEN_USED`, `TOKEN_INVALID`, `ACCESS_TOKEN_EXPIRED`,
  `SESSION_INVALIDATED`, `ACCOUNT_LOCKED`, `IP_RATE_LIMIT`, `EMAIL_UNVERIFIED`, `EMAIL_TAKEN`.
- Frontend routes/acts on `code` (a `ROUTE_BY_CODE` map / `switch`), not regex on `message`.
- **Backward compatible:** `message` is unchanged; `code` is additive. Phased rollout so
  nothing breaks mid-migration.

## Requirement alignment

- **Assignment mapping:** the assignment (R1–R8) is about the **cookie-policy generator**;
  this is a **cross-cutting robustness/maintainability refactor of the auth layer**, not one
  of R1–R8. Honest classification: it does **not** implement an assignment requirement.
- **Supports R8 (development workflow / clean, maintainable increments):** removes duplicated,
  fragile logic and makes the contract explicit — a quality improvement, shipped incrementally.
- **Gap / caveat:** because it's outside the assignment's feature scope, treat it as **tech-debt
  paydown**, prioritized on its own merits (it touches the whole auth flow), not as assignment
  progress.
- **Core principle (scope discipline):** no out-of-scope product surface added. N/A to consent.

## Design

Two backend choke points (`ApiError`, global handler) + per-throw codes; frontend switches on
code. See exact before/after in **Tasks**.

## Design notes

- **Why `code` as a top-level field** (not inside `errors[]`): `errors[]` is the
  express-validator array for `422`; error codes are a different concept (one per failure), so a
  sibling field is cleaner and doesn't overload the validation array.
- **`ApiError` signature:** add `code` as the **3rd** parameter (after `message`), shifting
  `error`/`stack`. The only existing call affected is the `429` lock error that passes
  `{ retryAfter }` as the `error` arg — it moves to the 4th position (shown in Task 3).
- **Keep messages human-friendly** — they're still shown to users; only _routing_ stops reading
  them. Codes are for machines, messages for humans.
- **Unknown/absent code** → frontend falls back to a generic error branch (never crashes).
- **Phased + backward-compatible:** add code (ignored by old FE) → FE switches on code with a
  regex fallback → remove the fallback. Each phase ships independently.

## Prompts (instructions given to the AI)

- "make auth error handling backend-driven via typed error codes … show WHICH files change and
  WHAT changes with concrete before/after code snippets. Backward-compatible phased rollout."

## Tasks (file-by-file, with before/after)

### Task 1 — `ApiError` gains `code` · file: `backend/src/utils/response/api-error.js` · satisfies: R8

```js
// BEFORE
constructor(statuscode, message = 'request invalid', error = [], stack = '') {
  super(message)
  this.statuscode = statuscode
  this.error = error
  this.sucess = false
  ...
}

// AFTER
constructor(statuscode, message = 'request invalid', code = null, error = [], stack = '') {
  super(message)
  this.statuscode = statuscode
  this.code = code            // ← NEW: stable machine-readable code
  this.error = error
  this.sucess = false
  ...
}
```

### Task 2 — global handler emits `code` · file: `backend/src/app.js` · satisfies: R8

```js
// BEFORE
res.status(status).json({
  success: false,
  message: err.message || 'Internal Server Error',
  errors: err.error || [],
})

// AFTER
res.status(status).json({
  success: false,
  code: err.code || null, // ← NEW
  message: err.message || 'Internal Server Error',
  errors: err.error || [],
})
```

### Task 3 — set codes at auth throw sites · files: `jwt.middleware.js`, `passwordReset.middleware.js`, `auth.controller.js` · satisfies: R8

```diff
# jwt.middleware.js
- throw new ApiError(401, 'Token has expired')
+ throw new ApiError(401, 'Token has expired', 'ACCESS_TOKEN_EXPIRED')
- throw new ApiError(401, 'Session invalidated, please login again')
+ throw new ApiError(401, 'Session invalidated, please login again', 'SESSION_INVALIDATED')

# passwordReset.middleware.js
- throw new ApiError(401, 'Token expired')
+ throw new ApiError(401, 'Token expired', 'TOKEN_EXPIRED')
- throw new ApiError(401, 'token already  used')
+ throw new ApiError(401, 'token already  used', 'TOKEN_USED')

# auth.controller.js
- throw new ApiError(409, 'email already exist')
+ throw new ApiError(409, 'email already exist', 'EMAIL_TAKEN')
- throw new ApiError(401, 'Token expired')                       // verifyMail
+ throw new ApiError(401, 'Token expired', 'TOKEN_EXPIRED')
- throw new ApiError(401, 'token already used')
+ throw new ApiError(401, 'token already used', 'TOKEN_USED')
- throw new ApiError(429, 'Account is locked. Too many failed attempts.', { retryAfter })
+ throw new ApiError(429, 'Account is locked. Too many failed attempts.', 'ACCOUNT_LOCKED', { retryAfter })
# IP-limit throw → add 'IP_RATE_LIMIT'; unverified-email login → add 'EMAIL_UNVERIFIED'
```

(Also add `TOKEN_INVALID` on the `403` invalid-token path if present.)

### Task 4 — `apiFetch` switches on code · file: `frontend/src/lib/apiFetch.js` · satisfies: R8

```js
// BEFORE
const isExpired = (data) => /expired/i.test(data?.message || '')
const isInvalidated = (data) => /invalidated/i.test(data?.message || '')

// AFTER
const isExpired = (body) => body?.code === 'ACCESS_TOKEN_EXPIRED'
const isInvalidated = (body) => body?.code === 'SESSION_INVALIDATED'
```

### Task 5 — `VerifyEmailPage` routes on code · file: `frontend/src/pages/VerifyEmailPage.jsx` · satisfies: R8

```jsx
// BEFORE
if (res.status === 401 && /expired/i.test(msg))
  navigate(`/verification-expired/${token}`)
else if (res.status === 401 && /used/i.test(msg)) navigate('/already-verified')
else if (res.status === 403) navigate('/verification-invalid')

// AFTER
const ROUTE_BY_CODE = {
  TOKEN_EXPIRED: `/verification-expired/${token}`,
  TOKEN_USED: '/already-verified',
  TOKEN_INVALID: '/verification-invalid',
}
const dest = ROUTE_BY_CODE[body.code]
if (dest) navigate(dest)
else navigate('/verification-invalid') // safe fallback
```

### Task 6 — `ResetPasswordPage` routes on code · file: `frontend/src/pages/ResetPasswordPage.jsx` · satisfies: R8

```jsx
// BEFORE
if (res.status === 401 && /(expired|used)/i.test(msg)) {
  const reason = /used/i.test(msg) ? 'used' : 'expired'
  navigate(`/reset-expired/${token}`, { state: { reason } })
}

// AFTER
if (body.code === 'TOKEN_EXPIRED' || body.code === 'TOKEN_USED') {
  const reason = body.code === 'TOKEN_USED' ? 'used' : 'expired'
  navigate(`/reset-expired/${token}`, { state: { reason } })
} else if (body.code === 'TOKEN_INVALID') {
  // inline invalid-link state
}
```

### Task 7 — `LoginPage` + `SignupPage` switch on code · files: `LoginPage.jsx`, `SignupPage.jsx` · satisfies: R8

```jsx
// LoginPage — BEFORE
if (res.status === 429 && /lock/i.test(msg)) setBanner('Account is locked.')
else if (res.status === 429) setBanner('Too many login attempts.')
else if (res.status === 403 && /verify/i.test(msg))
  navigate('/verification-required')

// LoginPage — AFTER
switch (body.code) {
  case 'ACCOUNT_LOCKED':
    setBanner('Account is locked.')
    break
  case 'IP_RATE_LIMIT':
    setBanner('Too many login attempts.')
    break
  case 'EMAIL_UNVERIFIED':
    navigate('/verification-required')
    break
  default:
    setBanner(body.message)
}

// SignupPage — BEFORE:  if (res.status === 409 && /email/i.test(msg)) …
// SignupPage — AFTER:   if (body.code === 'EMAIL_TAKEN') …
```

### Task 8 — docs · files: `backend/openapi.yaml`, `backend/CLAUDE.md`, `frontend/CLAUDE.md`

Document the `code` field + the enum in the error-envelope section of each.

## Acceptance criteria

- [ ] Every auth error response includes a `code` from the v1 enum; `message` is unchanged.
- [ ] Frontend routing/handling uses `code` only — no `regex.test(message)` for routing remains
      in apiFetch / VerifyEmailPage / ResetPasswordPage / LoginPage / SignupPage.
- [ ] Verify-email: expired → `/verification-expired`, used → `/already-verified`, invalid →
      `/verification-invalid`, driven by `code`.
- [ ] Login: `ACCOUNT_LOCKED` vs `IP_RATE_LIMIT` vs `EMAIL_UNVERIFIED` handled by code.
- [ ] Token rotation triggers on `ACCESS_TOKEN_EXPIRED`; forced logout on `SESSION_INVALIDATED`.
- [ ] Unknown/absent `code` → safe generic fallback (no crash).
- [ ] Backward compatible: with only the backend deployed (Phase 1), the old frontend still works.
- [ ] `openapi.yaml` + both `CLAUDE.md` document the enum.

## Rollout (phased, each shippable)

1. **Backend** — Tasks 1–3 (+ docs). Additive; old frontend ignores `code` → nothing breaks.
2. **Frontend** — Tasks 4–7, switching on `code` **with a regex fallback** (`code === 'X' || /x/i.test(msg)`).
3. **Cleanup** — remove the regex fallbacks once all errors carry codes.

## Supporting documentation

- `rfc-backend-driven-architecture.md` (§5.1 error envelope + enum — this plan implements Move 1).
- Audit findings (Category 2 — message-string routing) list the exact sites.
- Touch points: `utils/response/api-error.js`, `app.js`, `jwt.middleware.js`,
  `passwordReset.middleware.js`, `auth.controller.js`; frontend `lib/apiFetch.js`,
  `pages/VerifyEmailPage.jsx`, `ResetPasswordPage.jsx`, `LoginPage.jsx`, `SignupPage.jsx`.

## Notes / changelog

- <date TBD> — draft (PLAN mode). Awaiting review/approval. Note: this is a cross-cutting auth
  refactor (not an assignment R# feature); prioritize as tech-debt paydown.
