# Plan: Cookie Policy — "Use of cookies" section

- **Slug:** cookie-policy-use-of-cookies
- **Scope:** frontend + backend (single plan, stored in backend repo)
- **Status:** implemented

## Objective / feature request

Add a **"Use of cookies"** section to the cookie-policy editor: a **Heading** field
and a rich-text **Description** field (the Tiptap `RichTextDescription` editor from
the `rich-text-description` skill), exactly mirroring the shipped **"About cookies"**
section. The screenshot shows Heading `How do we use cookies?` and a multi-paragraph
Description about first-/third-party cookies. Store the section as a **sibling key**
`useOfCookies` in the existing `cookie_policy.content` jsonb — **no DB migration**.
Reuse the existing image upload/serve mechanism with **no schema change**.

## Specifications

**Data model (no schema change):**
- `cookie_policy.content` jsonb gains a sibling key:
  `{ aboutCookies: { heading, description }, useOfCookies: { heading, description } }`.
  `description` is Tiptap HTML. New key → no `drizzle-kit push` needed (the schema
  comment already anticipates this: "Later sections add sibling keys — no migration").
- `policy_images` — **unchanged**. Images stay FK'd to `cookie_policy.id`. See the
  image-mapping decision in **Design notes**.

**API contract:**
| Method | Path | Body | Success |
|--------|------|------|---------|
| GET | `/pulse/websites/:websiteId/cookie-policy` | — | `200` `{ data: { content } }` (all sections; `{}` if none) — **unchanged** |
| PUT | `/pulse/websites/:websiteId/cookie-policy/:section` | `{ heading, description }` | `200` `{ data: { content } }` (upserts `content[section]`) |

- `:section` ∈ allowlist `{ aboutCookies, useOfCookies }`; anything else → `404
  "unknown cookie policy section"`. Ownership checked via the website's owner (as today).
- The current section-less `PUT /:websiteId/cookie-policy` (always wrote `aboutCookies`)
  is **replaced** by the `:section` route — the frontend and smoke are the only callers.

**Validation:** reuse the existing heading/description rules (optional, `heading`
≤255, `description` ≤20000) — they are already section-agnostic; rename the validator
to reflect general use.

**Behaviours:**
- Sidebar "Use of cookies" becomes active; clicking a sidebar item switches the edited
  section without a page reload (full `content` is already fetched on mount).
- Each section edits/saves independently to its own key; the other section's content is
  preserved on save (object-merge upsert, as today).
- Image button works identically in both sections' Description editors (same upload
  endpoint); an image inserted in one section renders only where its `<img>` URL lives.

## Requirement alignment

The cookie-policy editor is the **policy-document / transparency** surface of the CMP,
distinct from the consent-enforcement mechanics. This section maps to:
- **R6 (privacy-law compliance)** — a published, accurate cookie policy describing how
  the site uses cookies is a GDPR/CCPA transparency obligation; "Use of cookies" is a
  standard clause of that document.
- **R7 (automatic config updates)** — policy copy is editable via the UI with no code
  change; adding a section is a jsonb sibling key, no migration.

Also implements the **Heading + rich-text Description** capability from the
`rich-text-description` skill spec, reused verbatim.

**Gaps (honest):** does **not** touch R1–R5, R8 (scanning, gatekeeper, banner,
geo-targeting, consent recording, release-on-accept) — those are the consent engine, a
separate track. **Core principle:** not violated — this feature stores/serves editor
content only; it creates **no** cookies.

## Design

### Backend
- **`src/controllers/cookiePolicy.controller.js`** — replace `putAboutCookies` with a
  generalized **`putSection`**:
  - `const SECTIONS = ['aboutCookies', 'useOfCookies']` (module const).
  - Read `req.params.section`; if not in `SECTIONS` → `throw new ApiError(404,
    'unknown cookie policy section')`.
  - `assertOwnedWebsite` (unchanged), then the same find-or-insert / merge-upsert logic,
    writing `content[section] = { heading, description }` instead of a hardcoded key.
  - `getCookiePolicy` — unchanged (already returns the whole `content`).
- **`src/routes/website.routes.js`** — change the PUT route to
  `'/:websiteId/cookie-policy/:section'` → `jwtValidation, cookieSectionValidator(),
  validation, putSection`. GET route unchanged. Update the import name.
- **`src/validators/cookiePolicy.validator.js`** — rename `aboutCookiesValidator` →
  `cookieSectionValidator` (same body rules); update the import in the route.

### Frontend
- **`src/CookiePolicyPage.jsx`** — make it section-aware (minimal refactor):
  - `SECTIONS` config gains per-section metadata: `key` (sidebar), `sectionKey`
    (jsonb/API key), `title`, `headingPlaceholder`, `descPlaceholder`. Set both
    `about` and `use` `active: true`; leave `preferences` disabled.
  - Add `active` state (default `'about'`). Store fetched content per section in a
    `data` map `{ aboutCookies: {heading, description}, useOfCookies: {…} }` seeded
    from the fetched `content` on mount (no refetch on switch).
  - Sidebar buttons set `active`; the main panel derives title/placeholders/values/
    errors from the active section. Editing updates that section's entry in `data`.
  - `handleSave` PUTs to `/pulse/websites/${websiteId}/cookie-policy/${sectionKey}`
    with the active section's `{ heading, description }`; same 422/validation handling.
  - `onImageUpload` prop is **unchanged** (endpoint is section-agnostic) — reused for
    both sections' editors.
  - `use` placeholders: Heading `How do we use cookies?`, Description
    `Describe how this website uses first- and third-party cookies…`.
- **`RichTextDescription.jsx`** — no change (reused as-is).

### API docs
- **`backend/openapi.yaml`** — change the cookie-policy PUT path to
  `…/cookie-policy/{section}`, add the `section` path param with the enum
  `[aboutCookies, useOfCookies]`, and note the `404` for an unknown section. GET spec
  and the images endpoints unchanged.

## Design notes

- **The image-mapping doubt — resolved: no schema change, and no need to differentiate
  images by section.** `policy_images.cookie_policy_id` exists **only for cascade
  cleanup** (website → cookie_policy → images). It is *not* how the app decides where an
  image renders. The section→image association is already stored **implicitly in each
  Description's HTML** — every image is an `<img src="/pulse/images/<uuid>">` tag with a
  **unique** UUID, living inside `aboutCookies.description` **or** `useOfCookies.
  description`. Rendering a section pulls only the image UUIDs its own HTML references,
  so the two sections can never be confused even though both images FK the same
  `cookie_policy` row. → **No `section` column on `policy_images`; no change at all.**
- **Rejected: adding a `section` column to `policy_images`.** Would only help a future
  per-section media library or orphan garbage-collection — neither is in scope, and the
  HTML remains the source of truth regardless. YAGNI.
- **Orphaned uploads** (image uploaded, then removed from the editor before Save) already
  exist for About cookies today; adding Use of cookies neither worsens nor fixes this,
  and a `section` column wouldn't fix it either. Out of scope.
- **Generalized `:section` endpoint over a duplicate `putUseOfCookies`.** DRYer and
  scales to the next sidebar section ("Cookie preferences") with zero new controller
  code — just an allowlist entry. The section-less PUT had a single caller (this
  frontend) so replacing it is safe.
- **No refetch on section switch:** the mount GET already returns the whole `content`,
  so switching sections is pure client state — snappier, fewer requests.

## Prompts (instructions given to the AI)

> "now i want to implement this page in the image [Use of cookies screenshot] i want a
> header field and description field and it should be as in the description skill,
> update cookie table schema to add the use[…] schema[.] only doubt remains how i will
> map the images in description field of use of cookies because i already have a image
> table which is referenced using cookie table id but i have images of about cookies and
> use of cookies how will i differentiate between them"

Answer given (drove the design): don't differentiate — the section→image mapping lives
in each Description's HTML; `policy_images` FK is for cascade cleanup only, so no schema
change to `policy_images` and only a jsonb sibling key on `cookie_policy`.

## Tasks

1. Backend: rename `aboutCookiesValidator` → `cookieSectionValidator` (same rules). —
   files: `backend/src/validators/cookiePolicy.validator.js` — satisfies: R6
2. Backend: generalize `putAboutCookies` → `putSection` (SECTIONS allowlist + `:section`
   param, 404 on unknown). — files: `backend/src/controllers/cookiePolicy.controller.js`
   — satisfies: R6, R7
3. Backend: route PUT `/:websiteId/cookie-policy/:section` → `putSection`; update
   imports. — files: `backend/src/routes/website.routes.js` — satisfies: R7
4. Frontend: make `CookiePolicyPage` section-aware (per-section config + state, sidebar
   switching, section-scoped save), enable "Use of cookies". — files:
   `frontend/src/CookiePolicyPage.jsx` — satisfies: R6, R7
5. Docs: update `openapi.yaml` PUT path to `…/cookie-policy/{section}` (+ enum + 404). —
   files: `backend/openapi.yaml` — satisfies: R7
6. Regression: extend `backend/scripts/smoke.js` — PUT `useOfCookies`, GET returns both
   sections, unknown section → 404. — files: `backend/scripts/smoke.js`

## Acceptance criteria

- [ ] Sidebar "Use of cookies" is active; clicking it shows a Heading + rich-text
      Description panel titled "Use of cookies".
- [ ] Saving Use of cookies persists `content.useOfCookies` and **preserves**
      `content.aboutCookies` (and vice-versa).
- [ ] Reloading the page restores both sections' Heading + Description from the server.
- [ ] Image upload works in the Use of cookies Description; an image inserted there
      renders only in that section (About cookies is unaffected) — confirming no
      cross-section confusion despite the shared `policy_images` FK.
- [ ] `PUT …/cookie-policy/aboutCookies` and `…/useOfCookies` both `200`; an unknown
      section → `404`.
- [ ] **No** `drizzle-kit push` required (jsonb sibling key); `policy_images` unchanged.
- [ ] Verification: `node --check` on changed backend files; backend boots clean;
      frontend `build` + `lint`; `npm run smoke` green incl. the new section checks;
      manual: edit both sections, add an image to each, Save, reload → both intact.

## Supporting documentation

- Screenshot: "Use of cookies" panel (Heading `How do we use cookies?` + first/third-party
  Description) — the target UI.
- Reuses: `frontend/src/RichTextDescription.jsx` (`onImageUpload` prop),
  `frontend/src/apiFetch.js`, backend `cookiePolicy.controller.js` ownership + upsert
  pattern, `image.controller.js` (unchanged upload/serve).
- Related plans: `backend/cookiegenerator-plan/cookie-policy-about-cookies.md`,
  `backend/cookiegenerator-plan/cookie-policy-image-upload.md`.
- Skills: `rich-text-description`, `plan-template`, `update-openapi`, `sync-claude-md`,
  `verify-and-ship`.

## Notes / changelog

- _draft_ — planned via `plan-from-assignment` (PLAN mode), conforming to `plan-template`.
  Key decision confirmed in-thread: no `policy_images` schema change and no
  `cookie_policy` migration — section→image mapping is carried by the Description HTML;
  the `policy_images` FK is cascade-cleanup only. Generalized the cookie-policy PUT to a
  `:section` endpoint.
- _implemented_ — Backend: `putSection` (SECTIONS allowlist, 404 on unknown) +
  `PUT /:websiteId/cookie-policy/:section` route; validator renamed
  `aboutCookiesValidator` → `cookieSectionValidator`. Frontend: `CookiePolicyPage`
  section-aware (per-section config/state, sidebar switching, "Use of cookies" enabled,
  editor remounts per section via `key`), image upload reused unchanged. Docs: openapi
  PUT moved under `{section}` (+enum, +404). Smoke: PUT both sections, assert coexist,
  unknown section → 404. No migration / no `policy_images` change. Verified: backend
  `node --check` (4 files), frontend `build` + `lint`, openapi YAML valid + structure
  asserted. Deferred to ship time (fresh boot): `npm run smoke`. Awaiting user manual
  check → `verify-and-ship` (commits plan + feature together).
