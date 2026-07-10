# Plan: Prevent duplicate websites (unique name & URL per user)

- **Slug:** `prevent-duplicate-websites`
- **Scope:** frontend + backend (single plan, stored in backend repo per plan-template) —
  **backend-only code change**; the frontend already renders the error inline.
- **Status:** implemented (awaiting user manual check → ship)

## Objective / feature request

A user can currently add two websites with the same name and URL (no duplicate check, no
unique constraint). Prevent it: **both the name and the URL must each be unique per user**
— block the add/edit if **either** the name OR the URL already exists on another of the
user's websites, and show a clear message on the offending field.

## Specifications

- **Rule (per user, `req.user.id`-scoped):**
  - **Name** must be unique among the user's websites.
  - **URL** must be unique among the user's websites.
  - Blocked if **either** collides (independent uniqueness, not the pair).
- **Matching / normalization** (comparison only — stored values keep their original text):
  - **Name:** `trim` + case-insensitive (`toLowerCase`).
  - **URL:** `trim` + case-insensitive + strip a single trailing `/` (so `example.com` and
    `example.com/` collide; `EXAMPLE.com` and `example.com` collide).
- **Create** (`POST /pulse/websites`): reject if the new name or URL matches any existing
  website of the user.
- **Update** (`PUT /pulse/websites/:id`): same, but **exclude the row being edited** — so
  saving a website with its own unchanged name/URL is allowed (`200`), while colliding with
  a *different* website is rejected.
- **Error shape (reuses the 422 field-error channel):** on collision, respond `422` with
  `errors: [{ path, msg }]` where `path` is `name` and/or `url`:
  - name → `{ path: 'name', msg: 'A website with this name already exists' }`
  - url  → `{ path: 'url',  msg: 'A website with this URL already exists' }`
  - (both can appear together). Built via `throw new ApiError(422, 'Validation failed',
    errorsArray)` — `ApiError`'s 3rd arg becomes `response.errors` (`api-error.js` +
    `app.js` handler), matching what express-validator produces.
- **Frontend:** **no change.** `WebManagerPage.group422` already buckets `errors` by
  `path` and renders them inline under the name/URL inputs for both the add form
  (`handleAdd`) and the edit form (`saveEdit`); non-422 stays in the banner.

## Requirement alignment

- **R7 (managing the sites a policy attaches to):** keeps the website list clean and
  unambiguous — a policy attaches to a single, non-duplicated site record.
- **Gap:** enforcement is **app-level only** (query-then-write), so a rare concurrent
  double-submit could still slip two rows past the check (TOCTOU). A DB unique index is the
  only true guarantee — deferred (see Design notes) because existing duplicate rows would
  make the index migration fail.
- **Core-principle check (does NOT apply):** website-record bookkeeping; sets/blocks/
  releases no cookie, touches no consent/banner/gatekeeper surface. The `_ga`-release check
  **does not apply**.

## Design

**Backend only — `backend/src/controllers/website.controller.js`** (+ its `ApiError`
import, already present):

1. **Helper** `assertNoDuplicate(userId, name, url, excludeId?)`:
   - Load the user's websites: `select({ id, name, url }).from(websites).where(eq(userId))`.
   - Normalize: `n = name.trim().toLowerCase()`, `u = url.trim().toLowerCase().replace(/\/+$/,'')`.
   - For each row (skip `row.id === excludeId`): compare normalized name/url.
   - Accumulate `errors`: push the name error and/or url error.
   - If `errors.length` → `throw new ApiError(422, 'Validation failed', errors)`.
   - (Small per-user list → in-JS comparison is clear and avoids SQL `ILIKE` wildcard
     escaping of `%`/`_` in user input.)
2. **`createWebsite`:** call `await assertNoDuplicate(req.user.id, name, url)` **before** the
   insert transaction.
3. **`updateWebsite`:** call `await assertNoDuplicate(req.user.id, name, url, req.params.id)`
   before the update (so a website can keep its own name/URL). Ownership of `:id` is still
   enforced by the existing `where(id, userId)` on the update; a non-owned/absent id still
   yields the existing `404`.
4. No route/validator/model/migration/response-shape change. `websiteValidator` (format +
   required) still runs first via `validation`; the duplicate check is an additional
   controller-level guard that emits the same 422 envelope.

**Smoke (`backend/scripts/smoke.js`):** after the current website-create/list block, add:
- create with a **duplicate name** (unique url) → `422`;
- create with a **duplicate url** (unique name) → `422`;
- create with a **unique** name+url → `201` (and clean it up / reuse for the next checks);
- **edit** one website to collide with another's name → `422`; with another's url → `422`;
- **edit** a website to its **own** unchanged name+url → `200` (self-exclusion works).

## Design notes

- **Reusing the 422 field-error channel** means inline messages under the exact field with
  zero frontend work — the cleanest fit for this codebase's "validation is backend-driven,
  frontend renders `errors` by `path`" convention. A `409 Conflict` would be more RESTful
  but would land in the generic banner and lose the per-field placement, so 422 wins here.
- **Normalization is comparison-only.** We store exactly what the user typed; we only
  lower-case/trim/trailing-slash-trim when *comparing*. Trailing-slash on URL is included
  because `example.com` vs `example.com/` is the same site; deeper URL canonicalization
  (protocol, `www.`, query) is intentionally out of scope — flag if more is wanted.
- **Why no DB unique index now.** A `unique(user_id, lower(name))` / `unique(user_id,
  normalized_url)` index is the real integrity guarantee, but `drizzle-kit push` would
  **fail** against the user's existing duplicate rows. Adding it safely requires first
  de-duplicating existing data (and deciding a normalized-URL storage/expression-index
  strategy). Deferred as a follow-up; the app-level check prevents all new duplicates via
  the UI/API in practice.
- **TOCTOU race** (two simultaneous creates racing the check) is acknowledged and accepted
  for this scale; the DB index above is the fix if it ever matters.
- **Update ownership unchanged.** `assertNoDuplicate` runs before the scoped update; it only
  inspects the user's own rows, so it can't leak another user's site names/urls.

## Prompts (instructions given to the AI)

> "now I can enter two websites with same url and name — create a plan for preventing
> duplication." → clarified: "search for name already exist; if exist don't allow; same for
> url also; both should be unique."

## Tasks

1. Add `assertNoDuplicate(userId, name, url, excludeId?)` helper (per-user fetch + normalized
   compare → 422 with `{path,msg}` for name/url) — files:
   `backend/src/controllers/website.controller.js` — satisfies: R7
2. Call it in `createWebsite` (before the insert txn) — files:
   `backend/src/controllers/website.controller.js` — satisfies: R7
3. Call it in `updateWebsite` with `excludeId = req.params.id` (self-exclusion) — files:
   `backend/src/controllers/website.controller.js` — satisfies: R7
4. Extend `scripts/smoke.js`: duplicate-name→422, duplicate-url→422, unique→201, edit-collide
   →422, edit-self→200 — files: `backend/scripts/smoke.js`
5. Sync docs (`sync-claude-md`) — backend Websites resource note (name & URL unique per user,
   422 on duplicate) at ship time; frontend Endpoints/Conventions only if a line needs it.

## Acceptance criteria

- [ ] Adding a website whose **name** already exists (case-insensitively) for the user →
      `422`, message shown inline under the **Name** field; the row is not created.
- [ ] Adding a website whose **URL** already exists (case-insensitive, trailing-slash-
      insensitive) → `422`, inline under the **URL** field; not created.
- [ ] A genuinely new name+URL still creates (`201`).
- [ ] Editing a website to collide with a **different** website's name or URL → `422`
      inline; editing a website while keeping its **own** name/URL → `200` (no false
      positive).
- [ ] Duplicate detection is **per user** (another user's identical name/URL does not
      block).
- [ ] Backend `npm run smoke` passes, including the new duplicate/edit assertions.
- [ ] N/A — no consent/cookie surface touched, so the `_ga`-release check does not apply.

## Supporting documentation

- Backend: `website.controller.js` (`createWebsite` insert txn, `updateWebsite` scoped
  update), `models/websites.js` (no unique constraint today), `validators/website.validator.js`
  (format/required only), `utils/api-error.js` + `app.js` error handler (`error` → `errors`).
- Frontend (no change): `WebManagerPage.jsx` `group422` + `handleAdd`/`saveEdit` (already
  render `errors` by `path` inline).

## Notes / changelog

- Draft. Awaiting manual review/approval. Backend-only code change (+ smoke); no frontend
  change; no DB migration (app-level check; DB unique index deferred pending dedup). Per
  plan-template, this doc ships **with** the feature at ship time.
- **Implemented (2026-07-10):** `website.controller.js` — added `assertNoDuplicate(userId,
  name, url, excludeId?)` (per-user fetch + normalized compare: trim/lowercase, url also
  trailing-slash-trimmed → 422 `{path:'name'|'url', msg}`); called in `createWebsite`
  (before the insert txn) and `updateWebsite` (with `excludeId = req.params.id`).
  `scripts/smoke.js` — +5 assertions (duplicate name→422, duplicate url [trailing slash]
  →422, unique→201, edit-collide→422, edit-self→200; wid2 cleaned up). **Verification:**
  backend syntax OK; container rebuilt; `npm run smoke` = **65 passed, 0 failed**. No
  frontend change — `WebManagerPage.group422` already renders the 422 field errors inline.
  DB unique index still deferred (existing duplicate rows would fail the push).
