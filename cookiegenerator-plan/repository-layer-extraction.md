# Plan: Repository layer — extract Drizzle queries from controllers

- **Slug:** repository-layer-extraction
- **Scope:** backend only (no frontend change; single plan stored in backend repo)
- **Status:** ~~draft → approved~~ → **implemented**
- **Extraction scope (chosen):** controllers **+ middlewares + utils** — every
  Drizzle query in the backend routes through a repository (not just controllers).

## Objective / feature request

Extract **all Drizzle ORM database queries out of the controllers, middlewares, and
utils** into a new `src/repositories/` layer — one file per table/entity. Callers
import repository functions and call them instead of building queries inline. No
architecture change (no service layer), no behavior change, no route/API change.

## Specifications

- New folder `backend/src/repositories/`, one file per **Drizzle table**:
  - `user.repository.js` (`users`)
  - `emailVerification.repository.js` (`emailVerify`)
  - `passwordReset.repository.js` (`passwordReset`)
  - `website.repository.js` (`websites`)
  - `cookiePolicy.repository.js` (`cookie_policy`)
  - `policyImage.repository.js` (`policy_images`)
- Move into repositories ONLY: `db.select/insert/update/delete`, `db.transaction`,
  joins, `where`/`orderBy` clauses, `.returning(...)`, and the drizzle operators
  (`eq`, `and`, `desc`, `inArray`) + model imports those queries need.
- Do NOT move: controller flow, req/res, `ApiResponse`, `ApiError`, validation,
  token generation, email sending, S3 logic, Redis, or business logic
  (`defaultCookieContent`, `sniffMime`, duplicate-detection, HTML rendering, etc.).
- Each repository function **reproduces the exact query at its call site** — same
  column projection, same `where`, same `.returning(...)` — so the controller's
  behavior is byte-identical. Identical queries used in multiple places collapse to
  **one** shared function; queries with different projections get their own
  descriptively-named function.
- Callers (controllers, middlewares, utils) change ONLY by replacing an inline query
  with a repo call. **No function is renamed; no property access or control flow
  changes.** Non-DB logic that lived alongside a query stays put: S3 `deleteObject`
  in `sweepOrphanImages`, Redis in `jwt.js`, `ApiError` ownership throw in
  `assertOwnedWebsite`, etc.
- Remove now-unused `db`, `drizzle-orm`, and `../models` imports from every caller
  once its queries are gone.

### API contract / data model

Unchanged. No routes, request/response shapes, tables, or columns are modified.

## Requirement alignment

N/A for feature requirements — this is an **internal maintainability refactor**.
It preserves 100% of existing behavior, so every requirement the backend already
satisfies stays satisfied. Acceptance is proven by the existing smoke suite passing
unchanged (currently **69/69**).

## Design

### New layer

`src/repositories/*.repository.js`. Each imports `db` from `../db/index.js`, the
relevant model(s) from `../models/index.js`, and the drizzle operators it needs.
Functions are named, exported, and JSDoc'd (per the `jsdoc-functions` skill). They
return the raw Drizzle result (usually an array); controllers keep their existing
`const [row] = await repo.fn(...)` destructuring, matching the requested example.

### Function inventory (grouped by repository)

**user.repository.js** (`users`)

- `findByEmail(email)` → `select({ id: userId, email }).where(eq(email))` — used by
  `signup` (existence check) **and** `forgotPassword` (shared).
- `findAuthByEmail(email)` → login projection
  (`id, locked, lockedUntil, limit, verified, password`) for `login`.
- `createUser({ email, password })` → `insert(...).returning({ id: userId })`.
- `markVerified(userId)` → `update({ isVerified: true }).where(userId)`.
- `clearLock(userId)` → `update({ isLocked:false, lockedUntil:null, failedLoginAttempts:0 })`.
- `applyLock(userId, { failedLoginAttempts, isLocked, lockedUntil })` — login lockout set.
- `setFailedAttempts(userId, count)` → `update({ failedLoginAttempts: count })`.
- `resetFailedAttempts(userId)` → `update({ failedLoginAttempts: 0 })` (login success).
- `findCredentialsById(userId)` → `select({ password, email }).where(userId)` (`resetPassword`).
- `findPasswordById(userId)` → `select({ password }).where(userId)` (`changePassword`).
- `updatePassword(userId, hash)` → `update({ password: hash })` — shared by
  `resetPassword` **and** `changePassword`.
- `findEmailAndVerifiedById(userId)` → `select({ email, verified: isVerified })` (`resendVerification`).
- `findEmailById(userId)` → `select({ email }).where(userId)` (`resetResend`).
- `findIdAndEmailById(userId)` → `select({ id: userId, email }).where(userId)` —
  the access-token payload lookup in **`utils/jwt.js` `acessSign`**.

**emailVerification.repository.js** (`emailVerify`)

- `create({ token, tokenExpiry, userId })` — shared by `signup` + `resendVerification`.
- `findByToken(hashedToken)` → `select({ id: userId, expiry: tokenExpiry, isUsed })` (`verifyMail`).
- `findUserIdByToken(hashedToken)` → `select({ userId }).where(eq(token))` —
  **`middlewares/emailVerify.middleware.js` `emailTokenValidation`**.
- `markUsed(hashedToken)` → `update({ isUsed: true }).where(eq(token))` (`verifyMail`).

**passwordReset.repository.js** (`passwordReset`)

- `create({ userId, token, tokenExpiry })` — shared by `forgotPassword` + `resetResend`.
- `findByToken(hashedToken)` → `select({ id: userId, expiry: tokenExpiry, isUsed })` —
  **`middlewares/passwordReset.middleware.js` `tokenValidation`**.
- `findUserIdByToken(hashedToken)` → `select({ userId }).where(eq(token))` —
  **`middlewares/passwordResend.middleware.js` `resetTokenResolve`**.
- `markUsed(hashedToken)` → `update({ isUsed: true }).where(eq(token))` (`resetPassword`).

**website.repository.js** (`websites`, + the create transaction)

- `findByUserId(userId)` → `select({ id, name, url }).where(userId)` (used by
  `assertNoDuplicate`).
- `listByUserId(userId)` → full list projection ordered `desc(createdAt)` (`listWebsites`).
- `createWithPolicy({ name, url, userId, policyContent })` → **the transaction**:
  insert website `.returning({...})` + insert its `cookie_policy` seed row. The
  controller still computes `policyContent = defaultCookieContent(today)` (business
  logic stays in the controller); the repo only runs the two inserts atomically.
- `updateByIdForUser(id, userId, { name, url })` → update `.where(and(id,userId)).returning({...})`.
- `deleteByIdForUser(id, userId)` → delete `.where(and(id,userId)).returning({ id })`.
- `findIdByIdForUser(websiteId, userId)` → `select({ id }).where(and(id,userId))` —
  shared by `image.controller`'s `ensureOwnedPolicy` **and** `utils/cookiePolicy.js`
  `assertOwnedWebsite` (identical query → one function).

**cookiePolicy.repository.js** (`cookie_policy`)

- `findContentByWebsiteId(websiteId)` → `select({ content, updatedAt })` (`getCookiePolicy`).
- `findByWebsiteId(websiteId)` → `select({ id, content, updatedAt })` (`buildPolicyHtml`).
- `findIdAndContentByWebsiteId(websiteId)` → `select({ id, content })` (`putSection`, `putPolicyMeta`).
- `findIdByWebsiteId(websiteId)` → `select({ id })` (`deleteCookiePolicy`, `ensureOwnedPolicy`).
- `create({ websiteId, content })` → `insert(...).returning({ id })` (`putSection`,
  `putPolicyMeta`, `deleteCookiePolicy`, `ensureOwnedPolicy` — content `{}` there).
- `updateContentByWebsiteId(websiteId, content)` → `update({ content }).where(websiteId)`.
- `getWebsiteUrlById(websiteId)` → `select({ url }).from(websites).where(id)` used by
  `buildPolicyHtml`. **(Lives in website.repository.js as `findUrlById` — it queries
  `websites`, not `cookie_policy`.)**

**policyImage.repository.js** (`policy_images`)

- `findByPolicyAndIds(cookiePolicyId, ids)` → `select({ id, key, mime }).where(and(eq(cookiePolicyId), inArray(id, ids)))` (`buildPolicyHtml`).
- `create({ cookiePolicyId, key, mime, byteSize })` → `insert(...).returning({ id })` (`uploadImage`).
- `findKeyByIdForUser(imageId, userId)` → the **3-table join**
  `policy_images → cookie_policy → websites` with `where(and(eq(policyImages.id), eq(websites.userId)))` (`getImage`).
- `findByPolicyId(cookiePolicyId)` → `select({ id, key }).where(eq(cookiePolicyId))` —
  **`utils/cookiePolicy.js` `sweepOrphanImages`** (the mark step). The S3 delete +
  orphan filtering stays in the util.
- `deleteByIdsForPolicy(cookiePolicyId, ids)` → `delete(...).where(and(eq(cookiePolicyId), inArray(id, ids)))` —
  **`sweepOrphanImages`** (the sweep step).

### Files touched

Controllers:

- `controllers/auth.controller.js` — all `users`/`emailVerify`/`passwordReset` queries → repos.
- `controllers/website.controller.js` — `assertNoDuplicate` (query only), `listWebsites`,
  `createWebsite` (transaction), `updateWebsite`, `deleteWebsite`.
- `controllers/cookiePolicy.controller.js` — `getCookiePolicy`, `buildPolicyHtml`,
  `putSection`, `deleteCookiePolicy`, `putPolicyMeta`.
- `controllers/image.controller.js` — `ensureOwnedPolicy`, `uploadImage`, `getImage`.

Middlewares:

- `middlewares/emailVerify.middleware.js` — `emailTokenValidation` token lookup.
- `middlewares/passwordReset.middleware.js` — `tokenValidation` token lookup.
- `middlewares/passwordResend.middleware.js` — `resetTokenResolve` token lookup.

Utils (DB parts only; S3/Redis/throws stay):

- `utils/cookiePolicy.js` — `assertOwnedWebsite` (ownership select), `sweepOrphanImages`
  (image select + delete).
- `utils/jwt.js` — `acessSign` user-payload select.

## Design notes

- **Projection-preserving over max-reuse.** Where two call sites select different
  columns (e.g. `findByEmail` vs `findAuthByEmail`), they stay as separate functions
  so the exact query — and thus behavior — is preserved. Reuse is applied only when
  the query is genuinely identical (`updatePassword`, both `create` helpers, the
  shared `findByEmail`). This honors "preserve all behavior" and "reuse when
  possible" together.
- **The create-website transaction** stays a transaction, moved wholesale into
  `website.repository.createWithPolicy`. Only the DB work moves; `defaultCookieContent`
  (business) is computed in the controller and passed in.
- **Cross-table queries go to the repo of their primary table:** `buildPolicyHtml`'s
  `websites.url` lookup → `website.repository.findUrlById`; the image ownership join
  → `policyImage.repository.findKeyByIdForUser`.
- **No `refreshToken.repository.js`.** Refresh tokens live in **Redis**
  (`utils/jwt.js` + `redisClient`), not Drizzle/Postgres — there is no refresh-token
  table. A "Drizzle query extraction" has nothing to put there. (Flagged from the
  example list; a Redis repository would be a separate, different change — not done here.)
- **Middlewares + utils are in scope (chosen).** Their DB queries also move to the
  repositories so every Drizzle query in the backend lives in one layer. Only the DB
  access moves — S3 (`sweepOrphanImages`), Redis (`jwt.js`), and the `ApiError`
  ownership throw (`assertOwnedWebsite`) stay exactly where they are. This lets
  identical queries dedupe across layers (e.g. `findIdByIdForUser` shared by a
  controller helper and a util).
- **Still out of scope:** nothing DB-related remains inline. The only Drizzle usage
  left outside `repositories/` is the schema definitions in `src/models/` (that's
  where they belong) and `drizzle.config.js`.
- **JSDoc:** every new repository function gets a house-style JSDoc block (per the
  `jsdoc-functions` skill).

## Prompts (instructions given to the AI)

> Refactor the existing backend by extracting all Drizzle ORM database queries from
> controllers into repository files without changing the project's architecture or
> behavior. Create `repositories/`, one file per table; move only DB code
> (select/insert/update/delete, transactions, joins, where, returning); do NOT move
> controller/req-res/ApiResponse/ApiError/validation/token/email/S3/business logic.
> Controllers import and call repository functions. Preserve behavior; don't modify
> routes/APIs; don't rename controllers; reuse methods; dedupe duplicate queries;
> remove unused DB imports; no service layer.

## Tasks

1. Create `src/repositories/` and `user.repository.js` (incl. `findIdAndEmailById` for jwt); wire `auth.controller.js` users queries.
2. `emailVerification.repository.js` + `passwordReset.repository.js` (incl. the middleware `findByToken`/`findUserIdByToken`); wire the remaining `auth.controller.js` queries.
3. Wire the three token **middlewares** (`emailVerify`, `passwordReset`, `passwordResend`) and `utils/jwt.js` `acessSign` to the repos; clean their imports.
4. `website.repository.js` (incl. `createWithPolicy` transaction + `findUrlById` + shared `findIdByIdForUser`); wire `website.controller.js`; clean imports.
5. `cookiePolicy.repository.js`; wire `cookiePolicy.controller.js` (getCookiePolicy, buildPolicyHtml, putSection, deleteCookiePolicy, putPolicyMeta); clean imports.
6. `policyImage.repository.js`; wire `image.controller.js` (ensureOwnedPolicy, uploadImage, getImage) **and** `utils/cookiePolicy.js` (`assertOwnedWebsite`, `sweepOrphanImages`); clean imports.
7. Remove unused `db` / `drizzle-orm` / `../models` imports from every touched controller, middleware, and util.
8. JSDoc all new repository functions. Run Prettier on changed files; `node --check` all touched files.
9. Boot + run the smoke suite; confirm **69/69** unchanged.

## Acceptance criteria

- [ ] `src/repositories/` has the 6 table-scoped files; every DB query from controllers, middlewares, and the two utils now lives in a repo function.
- [ ] Controllers, middlewares, `utils/cookiePolicy.js`, and `utils/jwt.js` contain **zero** `db.`/`drizzle-orm` operator/`../models` usage; unused imports removed. (Drizzle remains only in `src/models/`, `drizzle.config.js`, and `repositories/`.)
- [ ] No function renamed; no route/API/response shape changed; S3/Redis/throw logic unchanged.
- [ ] Duplicate queries deduped (`updatePassword`, both token `create`s, shared `findByEmail`, shared `findIdByIdForUser`).
- [ ] `node --check` clean on all touched files; Prettier clean.
- [ ] Smoke suite passes **69/69** (same as before the refactor).

## Supporting documentation

- `backend/CLAUDE.md` (Structure / resources), controller sources, `src/models/`.
- Related conventions: `jsdoc-functions`, env-consts, Prettier (already applied repo-wide).

## Notes / changelog

- draft — initial plan (controllers only).
- revised — user chose to **also include middlewares + utils** (every Drizzle query
  routes through the repositories, not just controllers). Function inventory, files
  touched, tasks, and acceptance criteria updated accordingly. `refreshToken`
  repository still not created (Redis, not Drizzle). Awaiting approval to implement.
- implemented (2026-07-13) — created `src/repositories/` with 6 table files
  (user, emailVerification, passwordReset, website, cookiePolicy, policyImage) and
  routed all Drizzle queries from the 4 controllers, 3 token middlewares,
  `utils/cookiePolicy.js`, and `utils/jwt.js` through them. Deduped shared queries
  (`updatePassword`, both token `create`s, `findByEmail`, `findIdByIdForUser`,
  `create`/`updateContentByWebsiteId`/`findIdByWebsiteId` on cookie_policy). Removed
  unused `db`/`drizzle-orm`/`../models` imports from every caller. No renames, no
  route/API changes. `scripts/smoke.js` intentionally keeps its direct DB
  seed/teardown (test harness, not app code). **Smoke: 69/69 passed** on a fresh boot
  (SMOKE_BASE=:8099); Prettier + `node --check` clean. Awaiting the user's manual
  check before ship.
