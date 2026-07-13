# Plan: Reorganize utils/ into domain folders

- **Slug:** utils-domain-restructure
- **Scope:** backend only (single plan, stored in backend repo)
- **Status:** ~~draft → approved~~ → **implemented**

## Objective / feature request

Group `src/utils/` by domain instead of a flat list: authentication helpers in one
folder, AWS/storage in one, cookie-policy in one. Each domain folder exposes a
**barrel `index.js`** so consumers import from the folder (`../utils/auth`). Pure
reorganization — **no behavior change**, no API/route change.

## Specifications

Target layout (user-chosen options baked in):

```
src/utils/
├── async-handler.js      # stays at root — the single foundational async→next(err) wrapper
├── response/
│   ├── index.js          # barrel: re-exports the two response types (named)
│   ├── api-response.js   # ApiResponse — success envelope
│   └── api-error.js      # ApiError — error type (Error subclass w/ status)
├── auth/
│   ├── index.js          # barrel: re-exports the files below
│   ├── jwt.js
│   ├── token.js
│   ├── password.js
│   ├── cookies.js
│   ├── mail.js           # auth + policy email templates + shared transport
│   ├── resetBase.js
│   └── verifyBase.js
├── aws/
│   ├── index.js          # barrel
│   └── s3.js
└── cookiePolicy/
    ├── index.js          # barrel
    ├── cookiePolicy.js
    ├── defaultCookiePolicy.js
    └── policyHtml.js
```

Decisions (from review):

- **`api-response.js` + `api-error.js` → `utils/response/`** — they are the two HTTP
  response _types_ (success + error). Descriptive folder, not a vague "common".
- **`async-handler.js` stays at `utils/` root** — it's a promise wrapper that
  forwards async rejections to the global error handler; the single foundational
  wrapper every controller uses. Not put in a `utils/middleware/` folder because that
  would clash with the existing top-level `src/middlewares/`. Its ~7 imports are
  left untouched (path unchanged).
- **`mail.js` goes in `auth/`** — the cookie-policy controller reaches into
  `../utils/auth` for `policyInstallEmail` (accepted slight cross-domain reach).
- **Barrel `index.js` per folder** — consumers import `{ … } from '../utils/auth'`
  etc. `auth`/`aws`/`cookiePolicy` files use only named exports (`export *` is
  unambiguous — no name collisions). `response/` files are **default** exports, so its
  barrel re-exports them as **named**: `export { default as ApiError } from './api-error.js'`.
- **No `website/` folder** — there is no website-specific util (that logic lives in
  the website controller/repository/validator). Not created.

### Barrel vs direct imports (production rule)

- **Consumers** (controllers, middlewares, scripts) import from the **barrel**:
  `import { acessSign, hashToken } from '../utils/auth'`,
  `import { ApiError, ApiResponse } from '../utils/response'`.
- **`asyncHandler`** is imported from its unchanged root path:
  `import { asyncHandler } from '../utils/async-handler.js'`.
- **Intra-utils cross-folder** imports use the **direct file** (not the barrel), to
  keep the dependency graph explicit and avoid barrel-to-barrel cycles:
  - `auth/mail.js` → `../cookiePolicy/policyHtml.js` (needs `escapeHtml`)
  - `cookiePolicy/cookiePolicy.js` → `../aws/s3.js` (needs `deleteObject`)
  - files needing `ApiError` → `../response/api-error.js` (direct default import)

### API contract / data model

Unchanged. No routes, endpoints, request/response shapes, tables, or env vars change.

## Requirement alignment

N/A — internal maintainability refactor. Preserves 100% of behavior, so every
requirement already satisfied stays satisfied. Proven by the smoke suite staying
**69/69**.

## Design

### Moves (git mv to preserve history)

- **response/**: `api-error.js`, `api-response.js`
- **auth/**: `jwt.js`, `token.js`, `password.js`, `cookies.js`, `mail.js`,
  `resetBase.js`, `verifyBase.js`
- **aws/**: `s3.js`
- **cookiePolicy/**: `cookiePolicy.js`, `defaultCookiePolicy.js`, `policyHtml.js`
- **stays at root**: `async-handler.js`

### Internal import fixes in moved files (depth +1)

- `auth/jwt.js`: `../db/redis.js` → `../../db/redis.js`;
  `../repositories/user.repository.js` → `../../repositories/user.repository.js`;
  `./api-error.js` → `../response/api-error.js`
- `auth/resetBase.js`, `auth/verifyBase.js`: `./api-error.js` → `../response/api-error.js`
- `auth/mail.js`: `./policyHtml.js` → `../cookiePolicy/policyHtml.js`
- `cookiePolicy/cookiePolicy.js`: `./api-error.js` → `../response/api-error.js`;
  `../repositories/*` → `../../repositories/*`; `./s3.js` → `../aws/s3.js`
- `response/api-error.js`, `response/api-response.js`: standalone classes, **no**
  relative imports → no change.
- (`token.js`, `password.js`, `cookies.js`, `aws/s3.js`,
  `cookiePolicy/defaultCookiePolicy.js`, `cookiePolicy/policyHtml.js` have no
  intra-repo relative imports → no change.)

### Barrels

```js
// utils/response/index.js  (files are DEFAULT exports → re-export as named)
export { default as ApiError } from './api-error.js'
export { default as ApiResponse } from './api-response.js'

// utils/auth/index.js
export * from './jwt.js'
export * from './token.js'
export * from './password.js'
export * from './cookies.js'
export * from './mail.js'
export * from './resetBase.js'
export * from './verifyBase.js'

// utils/aws/index.js
export * from './s3.js'

// utils/cookiePolicy/index.js
export * from './cookiePolicy.js'
export * from './defaultCookiePolicy.js'
export * from './policyHtml.js'
```

### Consumer import rewrites (barrel paths)

`ApiError`/`ApiResponse` become **named** imports from the response barrel
(`import { ApiError, ApiResponse } from '../utils/response'`); `asyncHandler` keeps
its unchanged root path (`from '../utils/async-handler.js'`).

- `controllers/auth.controller.js`: collapse `jwt`/`token`/`password`/`cookies`/
  `mail`/`resetBase`/`verifyBase` → one `from '../utils/auth'`; `ApiError`+`ApiResponse`
  → `'../utils/response'`; `asyncHandler` unchanged.
- `controllers/cookiePolicy.controller.js`: `cookiePolicy`/`defaultCookiePolicy`/
  `policyHtml` → `'../utils/cookiePolicy'`; `mail` → `'../utils/auth'`; `s3` →
  `'../utils/aws'`; `ApiError`+`ApiResponse` → `'../utils/response'`; `asyncHandler` unchanged.
- `controllers/image.controller.js`: `s3` → `'../utils/aws'`; `ApiError`+`ApiResponse`
  → `'../utils/response'`; `asyncHandler` unchanged.
- `controllers/website.controller.js`: `defaultCookiePolicy` → `'../utils/cookiePolicy'`;
  `ApiError`+`ApiResponse` → `'../utils/response'`; `asyncHandler` unchanged.
- `middlewares/jwt.middleware.js`: `cookies` + `jwt` → `'../utils/auth'`; `ApiError` → `'../utils/response'`.
- `middlewares/auth.middleware.js`, `login.middleware.js`, `upload.middleware.js`:
  `ApiError` (and `ApiResponse` where used) → `'../utils/response'`; `asyncHandler` unchanged.
- `middlewares/emailVerify.middleware.js`, `passwordResend.middleware.js`,
  `passwordReset.middleware.js`: `token` → `'../utils/auth'`; `ApiError` → `'../utils/response'`.
- `scripts/smoke.js`: `password` → `'../src/utils/auth'`.
- All `async-handler` imports stay as `../utils/async-handler.js` (unchanged).

## Design notes

- `git mv` keeps blame/history across the move.
- Cross-folder intra-utils imports deliberately use direct files, not barrels, to
  avoid a barrel importing a barrel (keeps the load graph a clean DAG:
  auth → cookiePolicy → aws, with no path back).
- `export *` is safe because no two files in a folder export the same name (verified).
- JSDoc/behavior of the functions is untouched — only file locations and import
  specifiers change.

## Prompts (instructions given to the AI)

> Refactor my utils folder — put everything auth (jwt, mail, verify, etc.) in one
> folder, everything AWS in one, everything cookie-policy in one, website — how to
> do this production-level. [Decisions: shared helpers stay at utils root; mail →
> auth/; barrel index.js per folder.]

## Tasks

1. Create `utils/response/`, `utils/auth/`, `utils/aws/`, `utils/cookiePolicy/`; `git mv` each file to its folder (`async-handler.js` stays at root).
2. Fix internal relative imports in the moved files (depth +1; cross-folder direct-file paths).
3. Add `index.js` barrels to the four folders (`response/` re-exports its two defaults as named).
4. Rewrite consumer imports (controllers, middlewares, `scripts/smoke.js`) to the barrels.
5. Run Prettier on changed files; `node --check` all touched files; grep to confirm no stale `utils/<movedfile>` paths remain.
6. Boot + smoke suite → confirm **69/69** unchanged.
7. Update `backend/CLAUDE.md` Structure tree (utils subtree) via `sync-claude-md`.

## Acceptance criteria

- [ ] `utils/` has `response/`, `auth/`, `aws/`, `cookiePolicy/` (each with an `index.js`); only `async-handler.js` remains at root.
- [ ] No import references a moved file's old flat path (`../utils/jwt.js`, `../utils/api-error.js`, etc.); consumers use the barrels; `asyncHandler` still imported from `../utils/async-handler.js`.
- [ ] `node --check` clean on all `src/` files; Prettier clean; app boots clean.
- [ ] No function renamed; no route/API/response/env change.
- [ ] Smoke suite **69/69** (unchanged).

## Supporting documentation

- `backend/CLAUDE.md` (Structure), prior refactor plan `repository-layer-extraction.md`.

## Notes / changelog

- draft — awaiting review/approval. Decisions captured: mail→auth, barrels per
  folder, no website/ folder.
- revised — response types (`api-error`, `api-response`) go in a descriptive
  **`utils/response/`** folder (not "common"); **`async-handler.js` stays at root**
  (single async→next(err) wrapper; avoided `utils/middleware/` to not clash with
  `src/middlewares/`). `response/` barrel re-exports the two default exports as named.
- implemented (2026-07-13) — `git mv`'d all files into `response/`, `auth/`, `aws/`,
  `cookiePolicy/`; `async-handler.js` left at root. Added the 4 barrels; fixed moved
  files' relative imports; rewrote all consumer imports (controllers, middlewares,
  `scripts/smoke.js`) to the barrels. **Deviation from the plan's literal import
  strings:** barrels are imported with an explicit **`/index.js`** suffix
  (`'../utils/auth/index.js'`) because this is raw Node ESM — bare directory imports
  throw `ERR_UNSUPPORTED_DIR_IMPORT` (no bundler/index resolution). Behavior
  unchanged. `node --check` clean, Prettier clean, no stale flat paths, clean boot,
  **smoke 69/69**. CLAUDE.md Structure tree updated. Awaiting the user's manual check
  before ship.
