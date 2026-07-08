# Plan: Cookie Policy — "Cookie preferences" tab + effective date

- **Slug:** cookie-policy-preferences
- **Scope:** frontend + backend (single plan, stored in backend repo)
- **Status:** implemented

## Objective / feature request

Add the third and final cookie-policy section, **"Cookie preferences"** (Heading +
rich-text Description, mirroring About/Use of cookies), and a policy-level **effective
date** field. Clicking the effective-date field opens a **custom calendar picker** (no
UI library); it displays a formatted date like `July 07, 2026`, stores ISO
`YYYY-MM-DD`, and **defaults to today** when nothing is selected. The mockup's
**"Revisit consent widget"** field is **intentionally omitted** per the user.

## Specifications

**Cookie preferences section (same shape as existing sections):**
- Stored as sibling key `cookiePreferences: { heading, description }` in the
  `cookie_policy.content` jsonb. `description` is Tiptap HTML. **No migration.**
- Reuses the generalized `PUT /cookie-policy/:section` endpoint; `cookiePreferences`
  is added to the backend `SECTIONS` allowlist.

**Effective date (policy-level scalar, not a section):**
- Stored as a **top-level** key `content.effectiveDate` (ISO `"YYYY-MM-DD"` string).
- Saved via the **base-path** `PUT /pulse/websites/:websiteId/cookie-policy` with body
  `{ effectiveDate }` — merge-upserts into `content`, distinct path from
  `/cookie-policy/:section` (no route collision). Returns the full updated `content`.
- `GET /cookie-policy` already returns the whole `content` (so `effectiveDate` comes
  back with it). **No migration.**

**API contract:**
| Method | Path | Body | Success |
|--------|------|------|---------|
| GET | `/pulse/websites/:websiteId/cookie-policy` | — | `200` `{ data: { content } }` — unchanged |
| PUT | `/pulse/websites/:websiteId/cookie-policy` | `{ effectiveDate }` | `200` `{ data: { content } }` (merge-upsert `content.effectiveDate`) |
| PUT | `/pulse/websites/:websiteId/cookie-policy/:section` | `{ heading, description }` | `200` (`:section` now also accepts `cookiePreferences`) |

**Validation:** `effectiveDate` — optional; must be a valid `YYYY-MM-DD` date
(`isISO8601({ strict: true })` / `matches(/^\d{4}-\d{2}-\d{2}$/)`), else `422`.
Section rules unchanged.

**Custom DatePicker (frontend, confirmed with user — no UI library):**
- A `DatePicker.jsx`: a read-only text input showing the formatted value
  (`Month DD, YYYY`) or a placeholder; clicking it toggles a calendar popover.
- Popover: header `‹  <Month YYYY>  ›` with inline-SVG prev/next month arrows; weekday
  row `Su…Sa`; a 6-row day grid (days outside the month muted); the selected day
  highlighted with `--accent`. Selecting a day sets the value + closes. Closes on
  outside-click / `Escape`. Built with plain React + `signup.css` tokens.
- Value in/out is ISO `YYYY-MM-DD`; all date math uses **local** Y/M/D (no UTC
  shift). "Today" default computed at render if the stored value is empty.

**Behaviours:**
- Sidebar "Cookie preferences" becomes active; it shows Heading + Description + the
  effective-date DatePicker (below Description) + the footnote *By clicking "Generate
  cookie policy", you agree to our Terms and Conditions & Privacy Policy.*
- Saving on the preferences tab persists **both** the `cookiePreferences` section and
  the effective date (defaulting to today if the field is empty).
- The effective-date field appears **only** on the preferences tab (it is policy-level
  but edited there, per the mockup). About/Use tabs are unchanged.

## Requirement alignment

- **R6 (privacy-law compliance / transparency)** — a compliant cookie policy states an
  **effective date** and tells users **how to manage or withdraw consent** (the
  Cookie preferences copy: browser-management links + revisit instructions). Both are
  standard GDPR/CCPA transparency elements.
- **R7 (automatic config updates)** — all of it is editable via the UI with no code
  change; the new section is a jsonb sibling key and the date is a jsonb scalar — **no
  migration**.

**Gaps (honest):** This tab **documents** consent-revisit/management as text; it does
**not** implement the actual mechanism. The mockup's "Revisit consent widget"
(`<a class="cky-banner-element">…`) — which would re-open the live consent banner — is
**omitted per the user**, and the banner/gatekeeper/release-on-accept machinery
(**R2, R3, R8**) remains a separate, unbuilt track. **Core principle:** not violated —
this stores/serves editor content and a date; it creates **no** cookies.

## Design

### Backend
- **`src/controllers/cookiePolicy.controller.js`**
  - Add `'cookiePreferences'` to `const SECTIONS`.
  - New `putPolicyMeta` (asyncHandler): `assertOwnedWebsite`; read `{ effectiveDate }`;
    find-or-insert the policy row; **merge** `{ ...content, effectiveDate }` (reusing
    the same upsert shape as `putSection`); return full `content`.
- **`src/validators/cookiePolicy.validator.js`** — add `effectiveDateValidator()`
  (`body('effectiveDate').optional().matches(/^\d{4}-\d{2}-\d{2}$/).bail().isISO8601()`).
- **`src/routes/website.routes.js`** — add
  `PUT '/:websiteId/cookie-policy'` → `jwtValidation, effectiveDateValidator(),
  validation, putPolicyMeta` (base path; declared alongside the existing `:section`
  route — different paths, no collision).
- **`openapi.yaml`** — document the base-path PUT (`effectiveDate` body); extend the
  `:section` enum to include `cookiePreferences`; note `effectiveDate` in the GET
  content example.

### Frontend
- **`src/DatePicker.jsx`** (new) — the custom calendar component described above.
  Helpers: `toISO(y,m,d)`, `formatLong(iso)` → `"July 07, 2026"`, `todayISO()`.
- **`src/CookiePolicyPage.jsx`**
  - `SECTIONS`: set `preferences` `active: true` with
    `sectionKey: 'cookiePreferences'`, `title: 'Cookie preferences'`,
    `headingPlaceholder: 'Manage cookie preferences'`, and a preferences
    `descPlaceholder`.
  - New state `effectiveDate` seeded from `content.effectiveDate` on load, falling
    back to `todayISO()` if empty.
  - Render, **only when `active === 'preferences'`**, below the Description: a
    "What is the effective date for this Cookie Policy?" label + `<DatePicker>` and
    the Terms/Privacy footnote.
  - `handleSave`: on the preferences tab, after the section PUT succeeds, also
    `PUT /pulse/websites/:websiteId/cookie-policy` with `{ effectiveDate }` (default
    today if empty). Both must succeed for the "Saved ✓".
- **`src/signup.css`** — add `.cp-datepicker`, `.cp-cal*` classes using existing
  tokens (light theme; accent-highlighted selected day). No new design system.

### API docs / regression
- `openapi.yaml` as above.
- `backend/scripts/smoke.js`: PUT `cookiePreferences` → 200; PUT base
  `{ effectiveDate: '2026-07-07' }` → 200; GET shows `content.effectiveDate ===
  '2026-07-07'` and `content.cookiePreferences.heading`; invalid date `{ effectiveDate:
  'nope' }` → 422.

## Design notes

- **Effective date in jsonb (`content.effectiveDate`) over a dedicated `effective_date`
  column.** Keeps the project's migration-free posture, reuses the existing merge-upsert
  helper, and rides the same 1:1 `cookie_policy` row. Trade-off: it's a scalar living in
  a bag described as "section content" (frontend/section loops just ignore unknown
  keys). A typed `date` column would be more queryable but needs a `drizzle-kit push`
  and buys nothing here (the date is only displayed/rendered) — rejected as premature.
- **Base-path PUT for policy meta, `:section` PUT for sections.** Different URL paths →
  no Express param collision, and it reads well: the policy resource's own attributes
  (effectiveDate, future meta) live at the base; per-section content lives under
  `/:section`. The base PUT was previously removed when the section route was added;
  this repurposes it for meta.
- **Custom DatePicker, not native `<input type="date">` or a library** (confirmed with
  user). Native can't render `July 07, 2026` and its popup look is browser-controlled;
  a library breaks the repo's "no UI library" rule. The custom component matches the
  mockup and the design system, and is reusable.
- **Local-date math only.** Storing `YYYY-MM-DD` and constructing dates from local
  Y/M/D avoids the classic `new Date('2026-07-07')`-is-UTC-midnight off-by-one that
  shows the previous day in negative-offset timezones.
- **Default-to-today applied client-side** (seed empty → `todayISO()`), so a user who
  never opens the calendar still saves a sensible effective date. The server accepts
  whatever valid ISO date it's given.
- **Revisit consent widget omitted** per explicit instruction; if the consent-banner
  track later lands, the widget snippet + its info tooltip can be added to this tab then.

## Prompts (instructions given to the AI)

> "now i want you to generate cookie preferences tab remove the revisit consent widget
> [field] on 'What is the effective date for this Cookie Policy?' field when on clicking
> the field a calendar should appear like in the above image[;] if no date is selected
> select todays date as effective date[.] create a plan for this feature"

Clarification captured (AskUserQuestion): the calendar is a **custom component** (plain
React + `signup.css`, no UI library). Three screenshots: the Cookie preferences tab
(Heading, Revisit consent widget, Description with browser links), the effective-date
field showing `July 07, 2026` + the Generate/Terms footnote, and the open calendar
popover (month nav, selected day highlighted).

## Tasks

1. Backend: add `cookiePreferences` to `SECTIONS`; new `putPolicyMeta` controller. —
   files: `backend/src/controllers/cookiePolicy.controller.js` — satisfies: R6, R7
2. Backend: `effectiveDateValidator()`. — files:
   `backend/src/validators/cookiePolicy.validator.js` — satisfies: R6
3. Backend: base-path `PUT /:websiteId/cookie-policy` → `putPolicyMeta`. — files:
   `backend/src/routes/website.routes.js` — satisfies: R7
4. Frontend: `DatePicker.jsx` custom calendar (format/ISO/today helpers). — files:
   `frontend/src/DatePicker.jsx` — satisfies: R6
5. Frontend: enable preferences tab; render Heading + Description + DatePicker +
   footnote; save section + effectiveDate. — files:
   `frontend/src/CookiePolicyPage.jsx` — satisfies: R6, R7
6. Frontend: DatePicker/calendar styles in `signup.css` (tokens, light theme). — files:
   `frontend/src/signup.css` — satisfies: R6
7. Docs: `openapi.yaml` (base PUT + `cookiePreferences` enum + effectiveDate in GET). —
   files: `backend/openapi.yaml` — satisfies: R7
8. Regression: extend `backend/scripts/smoke.js` (cookiePreferences PUT, effectiveDate
   PUT + persist, invalid date → 422). — files: `backend/scripts/smoke.js`

## Acceptance criteria

- [ ] Sidebar "Cookie preferences" is active; shows Heading + rich-text Description
      titled "Cookie preferences". **No** "Revisit consent widget" field.
- [ ] The effective-date field shows below the Description (only on this tab); clicking
      it opens a calendar popover matching the mockup (month nav, selected day
      highlighted); picking a day fills the field as `Month DD, YYYY`.
- [ ] If no date is chosen, the field defaults to **today** and that date is saved.
- [ ] Saving persists `content.cookiePreferences` **and** `content.effectiveDate`;
      reload restores both (and About/Use sections are untouched).
- [ ] `PUT …/cookie-policy` `{ effectiveDate }` → `200`; invalid date → `422`;
      `PUT …/cookie-policy/cookiePreferences` → `200`.
- [ ] **No** `drizzle-kit push` required (jsonb only).
- [ ] Verification: `node --check` on changed backend files; backend boots clean
      (Docker rebuild to load routes); frontend `build` + `lint` (changed files clean);
      `npm run smoke` green incl. the new checks; manual: fill the preferences tab, pick
      a date, Save, reload → intact; leave date empty → today saved.
- [ ] N/A — release-on-accept (`_ga`) check: this feature sets no cookies and has no
      consent gate, so the canonical GA test does not apply.

## Supporting documentation

- Screenshots: Cookie preferences tab; effective-date field (`July 07, 2026`) + Terms
  footnote; open calendar popover (selected day highlighted).
- Reuses: `frontend/src/RichTextDescription.jsx`, `frontend/src/apiFetch.js`, backend
  `cookiePolicy.controller.js` merge-upsert + ownership pattern.
- Related plans: `backend/cookiegenerator-plan/cookie-policy-about-cookies.md`,
  `…/cookie-policy-use-of-cookies.md`, `…/cookie-policy-image-upload.md`.
- Skills: `rich-text-description`, `plan-template`, `update-openapi`, `sync-claude-md`,
  `verify-and-ship`.

## Notes / changelog

- _draft_ — planned via `plan-from-assignment` (PLAN mode), conforming to
  `plan-template`. Decisions confirmed in-thread: custom DatePicker (no UI library);
  Revisit consent widget omitted; effective date stored as `content.effectiveDate`
  (jsonb, no migration) via a base-path PUT distinct from the `:section` route.
- _implemented_ — Backend: `cookiePreferences` added to `SECTIONS`; new `putPolicyMeta`
  controller + `effectiveDateValidator` (ISO YYYY-MM-DD, optional); base-path
  `PUT /:websiteId/cookie-policy` route (distinct from `/:section`). Frontend: new
  `dateUtils.js` (local-date helpers) + custom `DatePicker.jsx` calendar; `signup.css`
  calendar styles; `CookiePolicyPage` enables the preferences tab, renders the DatePicker
  + Terms/Privacy footnote on it, defaults effective date to today, saves section + date.
  Docs: openapi base PUT + `cookiePreferences` enum + effectiveDate in GET. Smoke: +5
  checks. No migration / no `policy_images` change. Verified: backend `node --check` (4
  files); frontend `build` + `lint` (fixed react-refresh by extracting helpers to
  `dateUtils.js`, and set-state-in-effect by setting view in the toggle handler);
  openapi YAML valid; backend Docker rebuilt; `npm run smoke` → 34/34. Awaiting user
  manual check → `verify-and-ship`.
