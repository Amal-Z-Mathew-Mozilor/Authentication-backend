# Plan: Website management ("Web Manager")

- **Slug:** website-management
- **Scope:** frontend + backend (single plan, committed to backend repo)
- **Status:** implemented

## Context

This is assignment feature **2.1 Website management**: before a cookie policy can
exist, a user needs a website to attach it to. We add a **"Web Manager"** entry in
the authenticated header (on `/home`, the page reached after `/me`) that opens a
new page where the user can **add, edit, delete, and list** their websites
(name + URL). A `websites` table stores each site with a foreign key to the owning
user. It is designed so a **later** cookie-policy table can FK to `websites.id`
with `onDelete: cascade` — so deleting a website will later remove its cookie
policy too (the spec requires a confirm before delete).

Governing requirements (from the 2.1 spec screenshot):
- **Add** — form to register a website (name + URL is enough).
- **Edit** — update name/URL of an existing website.
- **Delete** — remove a website; must **confirm** first; later also removes the
  associated cookie policy (handled by the FK cascade once that table exists).
- **List view** — show all the user's websites, each with edit / delete / open
  cookie policy actions.

## Specifications

**Data model** — new `websites` table:
| column | type | notes |
|--------|------|-------|
| id | uuid PK | `defaultRandom()` |
| name | varchar(255) | not null |
| url | varchar(2048) | not null |
| user_id | uuid | not null, FK → `users.user_id`, `onDelete: cascade` |
| created_at | timestamptz | `defaultNow()` |
| updated_at | timestamptz | `defaultNow()`, `$onUpdate` |

Designed so a future `cookie_policy` table FKs `websites.id` (`onDelete: cascade`).

**API contract** — all under `/pulse/websites`, all require `accessToken` cookie
(`jwtValidation`), all scoped to the authenticated user:
| Method | Path | Body | Success |
|--------|------|------|---------|
| GET | `/pulse/websites` | — | `200` `{ data: [ {id,name,url,createdAt} ] }` (user's sites) |
| POST | `/pulse/websites` | `{ name, url }` | `201` `{ data: {id,name,url} }` |
| PUT | `/pulse/websites/:id` | `{ name, url }` | `200` updated site; `404` if not owned |
| DELETE | `/pulse/websites/:id` | — | `200`; `404` if not owned |

Error envelopes reuse the existing shapes: `401` (no/expired token), `403` (revoked),
`404` (not found / not owned), `422` (validation) with `ValidationErrorResponse`.

**Validation rules:** `name` — required, ≤255 chars. `url` — required, valid URL
(`isURL`, i.e. requires scheme like `https://`).

**Behaviours:** list shows only the current user's sites; add prepends to the list;
edit updates in place; delete requires an explicit confirm; a user cannot see or
mutate another user's websites (enforced by `user_id` in every where-clause).

## Design

### Backend (new resource `websites`, mounted at `/pulse/websites`)

New files mirroring the existing auth resource conventions:

- **`src/models/websites.js`** — Drizzle table, mirroring `userschema.js` style and
  the FK idiom in `email_verification.js`:
  ```js
  export const websites = pgTable('websites', {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 255 }).notNull(),
    url: varchar('url', { length: 2048 }).notNull(),
    userId: uuid('user_id').notNull()
      .references(() => users.userId, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow()
      .$onUpdate(() => new Date()).notNull(),
  })
  ```
  Deleting a user cascades to their websites. (Later: cookie-policy table FKs
  `websites.id` with the same cascade.)
- **`src/models/index.js`** — add `export { websites } from './websites.js'`
  (**required** — `drizzle.config.js` discovers tables only via this file).
- **`src/validators/website.validator.js`** — `websiteValidator()` factory,
  express-validator with `.bail()` per convention:
  `name` → trim, notEmpty ("Name is required"), bail, isLength max 255;
  `url` → trim, notEmpty ("URL is required"), bail, isURL ("Invalid URL").
- **`src/controllers/website.controller.js`** — `asyncHandler` handlers, all scoped
  to `req.user.id` (set by `jwtValidation`). Uses `db`, `eq`, `and` (add `and` to
  the drizzle-orm import), `ApiResponse`, `ApiError`:
  - `listWebsites` — `select … where eq(websites.userId, req.user.id)` (newest first).
  - `createWebsite` — `insert … values({ name, url, userId }).returning(...)`.
  - `updateWebsite` — `update … set({ name, url }).where(and(eq(id), eq(userId)))`;
    404 via `ApiError(404, 'website not found')` if no row (ownership enforced by
    the userId in the where-clause).
  - `deleteWebsite` — `delete … where(and(eq(id), eq(userId)))`; 404 if nothing deleted.
- **`src/routes/website.routes.js`** — `export const website_route = express.Router()`,
  every route behind `jwtValidation`:
  ```
  GET    /            → listWebsites
  POST   /            → websiteValidator(), validation, createWebsite
  PUT    /:id         → websiteValidator(), validation, updateWebsite
  DELETE /:id         → deleteWebsite
  ```
- **`src/app.js`** — add `app.use('/pulse/websites', website_route)` next to the
  existing users mount.
- **Schema apply:** `npx drizzle-kit push` (creates the `websites` table; no
  migrations folder).

### Frontend (new page + header entry)

- **`src/Header.jsx`** — add a **"Web Manager"** nav link in the header bar, shown
  when `account` is true (i.e. on authenticated pages), navigating to
  `/web-manager`. Place it between the logo and the Account menu; style as a header
  nav link (new small class, tokens-based).
- **`src/App.jsx`** — add `<Route path="/web-manager" element={<WebManagerPage />} />`
  and import it (no route guard — page self-checks, per existing convention).
- **`src/WebManagerPage.jsx`** — new page, mirroring `ChangePasswordPage.jsx`
  patterns (state: `form`, `errors`, `banner`, `status`; errors clear on edit;
  422 grouped by `er.path`; 401/403 → `navigate('/login')`; network error → banner).
  All calls through **`apiFetch`** (cookies + rotation):
  - On mount: `GET /pulse/websites` → render list.
  - **Add form** (name + URL) → `POST /pulse/websites`; on success prepend to list, clear form.
  - **Edit** — inline edit (row switches to name/URL inputs) → `PUT /pulse/websites/:id`.
  - **Delete** — inline confirm ("Delete <name>? This will also remove its cookie
    policy.") → `DELETE /pulse/websites/:id`; remove row on success.
  - **Cookie policy** action — stub: a disabled/"coming soon" button (real link
    lands with the cookie-policy feature).
- **`src/signup.css`** — add the few missing styles (no list/table or secondary
  button classes exist today): a `.wm-list`/`.wm-row` list, a `.btn-secondary`
  (Cancel/edit), small action buttons — all using existing tokens (`--card`,
  `--border`, `--accent`, `--error`, ~9–14px radii, soft shadow), light theme only.

### API docs
Extend **`backend/openapi.yaml`** via the `update-openapi` skill: add the four
`/pulse/websites` paths, `security: accessTokenCookie`, reuse the shared
`SuccessResponse` / `ErrorResponse` / `ValidationErrorResponse` schemas, add a new
`Websites` tag.

## Design notes
- **REST verbs** chosen for this resource (not the codebase's all-POST convention) —
  confirmed with the user; CORS already permits PUT/DELETE. Trade-off: diverges from
  existing style, but cleaner for CRUD.
- **"Open cookie policy" action = placeholder stub** — the cookie-policy table/page
  is a later feature; the action is wired now but disabled/"coming soon".
- **Ownership** is enforced purely via `user_id` in every where-clause (no separate
  authorization layer) — mirrors how the codebase scopes data. A cross-user id
  simply matches no row → `404`.
- **No route guard on the frontend** — the page self-checks by calling the API and
  redirecting on 401/403, matching every other authed page here.
- **Cascade**: FK `onDelete: cascade` on `user_id` (delete user → delete sites) and,
  later, on the cookie-policy FK (delete site → delete its policy) — this is why the
  spec's "delete also removes the cookie policy" is satisfied by the schema, not app code.
- **`url` uses `isURL()`** (requires a scheme). Open question for the user: allow bare
  domains like `example.com`? Currently rejected.

## Prompts (instructions given to the AI)
Verbatim user instruction that produced this plan:
> "create a section like this in header of the main page and call it web manager
> that is the page that we reach on /me and on calling the header we go to a page
> where we have all the options mentioned in the above image where we can add a url
> and name of the website edit delete view already add websites for it create db
> schema where we store url name and foreign reference to user id — we will generate
> another table later with foreign reference to this table to store cookie policy
> info. can you create a plan using skills and use planmode while planning"

Plus two screenshots: the "2.1 Website management" spec (Add/Edit/Delete/List) and a
header nav item labelled "Cookie Manager" (used as the visual model for the new
"Web Manager" header entry).

## Tasks
1. **Commit the plan first** (plan-template rule): this plan lives at
   `backend/cookiegenerator-plan/website-management.md`; `git -C backend add` +
   commit before writing code. — satisfies: workflow discipline
2. Backend model `websites.js` + export in `models/index.js`. — Add/Edit/Delete/List
3. Backend validator `website.validator.js`. — Add/Edit
4. Backend controller `website.controller.js` (list/create/update/delete, user-scoped). — all four
5. Backend router `website.routes.js` + mount in `app.js`. — all four
6. `drizzle-kit push` to create the table. — persistence
7. Frontend Header "Web Manager" entry + `App.jsx` route. — List view entry point
8. Frontend `WebManagerPage.jsx` (list + add + edit + delete-with-confirm + cookie-policy stub). — all four
9. Frontend CSS additions in `signup.css`. — List view / forms
10. Update `backend/openapi.yaml` (update-openapi skill). — docs
11. Extend `backend/scripts/smoke.js` with a website CRUD happy-path (create → list → edit → delete). — regression

## Acceptance criteria
- [ ] A logged-in user sees **"Web Manager"** in the header on `/home` and clicking it opens `/web-manager`.
- [ ] The page lists only the current user's websites (user-scoped by `req.user.id`).
- [ ] Add (name + URL) creates a website; it appears in the list; invalid/empty input returns inline 422 errors.
- [ ] Edit updates name/URL and persists.
- [ ] Delete asks for confirmation, then removes the website; another user cannot edit/delete it (404).
- [ ] `websites` table exists with FK to `users.userId` (`onDelete: cascade`), ready for a future cookie-policy FK.
- [ ] `openapi.yaml` documents the four endpoints consistently with the existing spec.
- [ ] Unauthenticated access to `/pulse/websites` returns 401; the page redirects to `/login`.

## Verification (via verify-and-ship skill, token-cheap)
- **Backend:** `node --check` changed files; `drizzle-kit push` succeeds; boot clean.
- **Frontend:** `npm --prefix frontend run build` + `run lint` pass.
- **Smoke (in a subagent):** run `npm --prefix backend run smoke` — existing auth
  flow still green **and** the new website CRUD happy-path passes.
- **Manual:** log in, open Web Manager, add/edit/delete a website; confirm the list
  is user-scoped and delete prompts a confirm.
- On all-green: commit **both** repos and push to **`main`** (per project prefs),
  flipping the plan doc status to `implemented`.

## Supporting documentation
- Assignment spec: **"2.1 Website management"** screenshot (Add / Edit / Delete /
  List view) — the governing requirement for this feature.
- Header visual model: **"Cookie Manager"** header nav-item screenshot.
- Existing patterns reused: `frontend/src/ChangePasswordPage.jsx` (validated-form
  pattern), `frontend/src/Header.jsx` (Account menu), `backend/src/models/email_verification.js`
  (FK-to-users idiom), `backend/src/controllers/auth.controller.js` (drizzle CRUD style).
- Related skills: `plan-template`, `plan-from-assignment`, `update-openapi`,
  `verify-and-ship`. API surface: `backend/openapi.yaml`.
- Related backend CLAUDE.md and `frontend/CLAUDE.md` for conventions.

## Notes / changelog
- _draft_ — plan created via plan mode + `plan-template`/`plan-from-assignment` rules
  (applied manually). Anchored to the 2.1 website-management spec (not the CookieYes
  `references/assignment.md`).
- _implemented_ — backend (model/validator/controller/routes/mount + `drizzle-kit push`),
  frontend (Header entry, `/web-manager` route, `WebManagerPage`, CSS), openapi paths,
  and smoke-test CRUD added. Verified: smoke 18/18, frontend build pass. Shipped with
  this feature commit.
