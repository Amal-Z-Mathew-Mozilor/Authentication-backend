# Plan: Cookie Policy — About cookies section

- **Slug:** cookie-policy-about-cookies
- **Scope:** frontend + backend (single plan, committed to backend repo)
- **Status:** draft → (approve) → implemented

## Context

Website management shipped; a website now needs a **cookie policy** attached to it
(the entity the earlier Web Manager delete-confirm already anticipated). This is the
first slice of the cookie-policy editor: **only the "About cookies" section** — a
**Heading** input and a **Description** textarea (per the screenshot). Reached from
the Web Manager "Cookie policy" action (currently a disabled stub) for a specific
website. Content is stored as **jsonb** so the later sections (Language settings,
Use of cookies, Types of cookies, Cookie preferences) extend the same record
without a schema migration. No Preview/Next buttons; a **"Save draft"** button
persists the section.

## Decisions (confirmed with user)
- **Save via a "Save draft" button** (not auto-save; not Preview/Next).
- **Include the left sidebar** for visual match (website URL + all section names),
  but only **About cookies** is active; other sections render disabled/"coming
  soon"; the Preview button is omitted.
- **jsonb content blob**, one `cookie_policy` row per website (1:1).

## Specifications

**Data model** — new `cookie_policy` table (1:1 with a website):
| column | type | notes |
|--------|------|-------|
| id | uuid PK | `defaultRandom()` |
| website_id | uuid | not null, **unique**, FK → `websites.id`, `onDelete: cascade` |
| content | jsonb | not null, default `{}` |
| created_at | timestamptz | `defaultNow()` |
| updated_at | timestamptz | `defaultNow()`, `$onUpdate` |

`content` shape (extensible): `{ "aboutCookies": { "heading": string, "description": string } }`.
Later sections add sibling keys (`useOfCookies`, `typesOfCookies`, …) — no schema change.

**API contract** — nested under the owning website, both require `accessToken`
cookie and verify the website belongs to `req.user.id`:
| Method | Path | Body | Success |
|--------|------|------|---------|
| GET | `/pulse/websites/:websiteId/cookie-policy` | — | `200` `{ data: { content } }` (empty `{}` if none yet) |
| PUT | `/pulse/websites/:websiteId/cookie-policy` | `{ heading, description }` | `200` upserts `content.aboutCookies`; returns updated `content` |

Errors reuse shared envelopes: `401`/`403` auth, `404` if the website isn't found
/ not owned, `422` validation.

**Validation (About cookies):** Heading and Description are **both required** on the
client (CookieYes-style) — Save is blocked and each empty field shows a red border
with "This field cannot be empty." Lengths: `heading` ≤255, `description` (HTML) ≤20000.
(Backend stays lenient — the frontend enforces required.)

**Behaviours:** opening the page for a website loads its policy (or blank fields if
none). "Save draft" upserts the About cookies content. The policy is user-scoped
via the website's owner; deleting the website cascades to the policy.

## Design

### Backend (mirror the `websites` resource conventions)
- **`src/models/cookie_policy.js`** — Drizzle table above; import `jsonb` from
  `drizzle-orm/pg-core` and `websites` from `./websites.js`; FK
  `.references(() => websites.id, { onDelete: 'cascade' })`, `.unique()` on
  `websiteId`. Export from **`src/models/index.js`**.
- **`src/validators/cookiePolicy.validator.js`** — `aboutCookiesValidator()`:
  `body('heading').optional()...isLength({max:255})`, `body('description').optional()...isLength({max:20000})`.
- **`src/controllers/cookiePolicy.controller.js`** — `asyncHandler`, `db`, `eq`,
  `and`. Helper: assert the website is owned (`select … from websites where
  and(eq(id, req.params.websiteId), eq(userId, req.user.id))` → else `ApiError(404)`).
  - `getCookiePolicy` — return the row's `content` (or `{}` if no row).
  - `putAboutCookies` — upsert: if no row, insert `{ websiteId, content: { aboutCookies } }`;
    else merge `aboutCookies` into existing `content` and update. (Use
    `.onConflictDoUpdate({ target: cookiePolicy.websiteId, set: {...} })` or
    select-then-insert/update.)
- **Routes** — extend **`src/routes/website.routes.js`** (or a small include) with:
  `GET /:websiteId/cookie-policy` and `PUT /:websiteId/cookie-policy`, both behind
  `jwtValidation` (+ `aboutCookiesValidator(), validation` on PUT). These live under
  the already-mounted `/pulse/websites` router.
- **Schema apply:** `drizzle-kit push` (the running compose backend auto-pushes on
  restart; or run push directly).

### Frontend
- **`src/WebManagerPage.jsx`** — enable the **Cookie policy** button (remove
  `disabled`/"coming soon"); `onClick` → `navigate('/cookie-policy/' + w.id)`.
- **`src/App.jsx`** — add `<Route path="/cookie-policy/:websiteId" element={<CookiePolicyPage />} />`.
- **`src/CookiePolicyPage.jsx`** — new page. On mount: read `:websiteId`, load the
  website (to show its URL in the sidebar) via `GET /pulse/websites` (find by id) and
  the policy via `GET /pulse/websites/:id/cookie-policy`; 401/403 → `/login`.
  Layout mirrors the screenshot: a **sidebar** (title "Cookie Policy", "Generating
  cookie policy for <url>", section list — **About cookies** active, **Use of
  cookies** + **Cookie preferences** disabled; Language settings & Types of cookies
  are NOT in the assignment so they are omitted) and a **main panel** with the
  "About cookies" heading, a **Heading** input, a **Description** rich-text editor,
  and a **Save draft** button. Save → `PUT …/cookie-policy` with
  `{ heading, description }` (description = HTML); 422 → inline errors.
- **`src/RichTextDescription.jsx`** — the Description field MUST use the
  `rich-text-description` skill's reusable Tiptap editor (toolbar: bold, italic,
  underline, strikethrough, numbered/bulleted list, link, image), **not** a plain
  textarea. HTML output stored in `content.aboutCookies.description`. Tiptap deps
  installed via npm (StarterKit v3 bundles bold/italic/strike/underline/link/lists;
  add Image + Placeholder). Image button uses URL insertion (no upload mechanism).
- **`src/signup.css`** — add cookie-policy layout classes (`.cp-shell` two-column,
  `.cp-side`, `.cp-side-item` + `.active`/`.disabled`, `.cp-main`, textarea sizing),
  reusing tokens; light theme only.

### API docs
Extend **`backend/openapi.yaml`** (via `update-openapi`): the two
`/pulse/websites/{websiteId}/cookie-policy` paths, `security: accessTokenCookie`,
reuse the shared envelopes, add a `Cookie Policy` tag.

## Design notes
- **Nested under the website** (`/pulse/websites/:websiteId/cookie-policy`) rather
  than a top-level resource — ownership is inherited from the website (one check),
  and it reads naturally as "this website's policy". 1:1 enforced by `unique` websiteId.
- **jsonb single `content` blob** keyed by section — chosen so later sections are
  added by writing new keys, with **no migration**. Alternative (a column per
  section) rejected: it would need a schema change per section.
- **Upsert on PUT** so the first save creates the row and later saves update it —
  the page never has to distinguish "create" vs "edit".
- **Fields optional** (draft semantics): "Save draft" can persist partial content.
- **Sidebar other sections disabled** — visual match to the screenshot without
  implying they work yet; they light up as each is built.

## Prompts (instructions given to the AI)
> "now lets start to implement cookie policy first we only implement About cookie
> section … it should have a heading and description as shown in the image dont add
> any other buttons like save draft preview ,next and all now just create a
> aboutcookies page just like shown in the screen … create a db table for cookie
> policy with foreign reference to websites and on delete cascade … use jsonb format
> to store about cookeies later sections will be added into the schema … create a
> plan for this using plan mode"
>
> Follow-up: "give the save draft button that shown in the page for now" (→ include
> a Save draft button after all).

Plus the screenshot of the CookieYes-style Cookie Policy editor (About cookies
section: Heading + Description, left section nav).

## Tasks
1. Backend model `cookie_policy.js` + export in `models/index.js`. — schema
2. Backend validator `cookiePolicy.validator.js`. — validation
3. Backend controller `cookiePolicy.controller.js` (get + upsert, ownership-checked). — API
4. Add the two routes to `website.routes.js`. — API
5. `drizzle-kit push` to create the table. — persistence
6. Frontend: enable the Web Manager "Cookie policy" button + `App.jsx` route. — entry point
7. Frontend `CookiePolicyPage.jsx` (sidebar + About cookies form + Save draft). — the page
8. Frontend CSS additions in `signup.css`. — layout
9. Update `backend/openapi.yaml` (update-openapi). — docs
10. Extend `backend/scripts/smoke.js` with cookie-policy GET/PUT for a created website. — regression

## Acceptance criteria
- [ ] From Web Manager, clicking a website's "Cookie policy" opens `/cookie-policy/:id`.
- [ ] The page shows the sidebar (website URL, section list; About cookies active) and the About cookies Heading + Description fields.
- [ ] Editing + "Save draft" persists heading/description; reloading the page shows the saved values.
- [ ] `cookie_policy` row is 1:1 with the website; `content.aboutCookies` holds `{ heading, description }`.
- [ ] Deleting the website removes its cookie policy (FK cascade).
- [ ] A user cannot read/write the cookie policy of a website they don't own (404).
- [ ] `openapi.yaml` documents both endpoints consistently.

## Supporting documentation
- Screenshot: CookieYes-style Cookie Policy editor (About cookies section).
- Reuses: `backend/src/models/websites.js` (table + FK idiom), `website.controller.js`
  (drizzle CRUD + ownership scoping), `frontend/src/WebManagerPage.jsx` &
  `ChangePasswordPage.jsx` (form/apiFetch patterns), `backend/scripts/smoke.js`.
- Related: `backend/cookiegenerator-plan/website-management.md`, `openapi.yaml`,
  skills `plan-template` / `update-openapi` / `verify-and-ship`.

## Notes / changelog
- _draft_ — planned via plan mode.
- _implemented_ — backend cookie_policy (model/validator/controller/routes) + jsonb
  content, frontend page, openapi, smoke. Verified: smoke 22/22, build pass.
- _revised_ — corrected two misses flagged by the user: (1) the **Description now
  uses the `rich-text-description` skill's Tiptap editor** with a toolbar (was a
  plain textarea); (2) sidebar trimmed to the assignment's required sections
  (**About cookies / Use of cookies / Cookie preferences**) — Language settings and
  Types of cookies removed. Awaiting manual check before `verify-and-ship`.
- _revised_ — link UX polished to match CookieYes (floating create popover with
  selected-text prefill; single-click preview bubble `Visit URL … Edit | Remove`;
  non-inclusive links; pending-mark formatting; instant active states). Both fields
  made **required** (client-side: "This field cannot be empty.").
