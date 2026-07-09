# Plan: Seed cookie_policy with default content at website creation

- **Slug:** cookie-policy-default-content-on-website-create
- **Scope:** frontend + backend (single plan, stored in backend repo). Change is
  **backend-only** in practice; the frontend already renders whatever `content` the
  GET returns, so it needs no code change.
- **Status:** implemented

## Objective / feature request

Create the `cookie_policy` row **together with the website** (in `createWebsite`), pre-filled
with **default heading + description content** for all three sections and an **effective date
= today**. So the very first time the user opens the cookie-policy editor for a new website,
the Heading and Description fields for About cookies, Use of cookies, and Cookie preferences
are already populated with sensible defaults (instead of blank).

## Specifications

**When:** inside `POST /pulse/websites` (`createWebsite`). Insert the website, then insert its
`cookie_policy` row in the **same transaction** (atomic — if the policy insert fails, the
website insert rolls back). The API response is unchanged (still returns the website object).

**Default `content` seeded** (jsonb on `cookie_policy`):

- **aboutCookies.heading:** `What are cookies?`
- **aboutCookies.description** (HTML):
  > `<p>This Cookie Policy explains what cookies are, how we use them, the types of cookies we use (i.e., the information we collect using cookies and how that information is used), and how to manage your cookie settings.</p><p>Cookies are small text files used to store small pieces of information. They are stored on your device when a website loads in your browser. These cookies help ensure that the website functions properly, enhance security, provide a better user experience, and analyse performance to identify what works and where improvements are needed.</p>`

- **useOfCookies.heading:** `How do we use cookies?`
- **useOfCookies.description** (HTML):
  > `<p>Like most online services, our website uses both first-party and third-party cookies for various purposes. First-party cookies are primarily necessary for the website to function properly and do not collect any personally identifiable data.</p><p>The third-party cookies used on our website primarily help us understand how the website performs, track how you interact with it, keep our services secure, deliver relevant advertisements, and enhance your overall user experience while improving the speed of your future interactions with our website.</p>`

- **cookiePreferences.heading:** `Manage cookie preferences`
- **cookiePreferences.description** (HTML — paragraphs + browser support links; the
  screenshot's separate "Revisit consent widget" field is **ignored**, not modelled):
  > `<p>You can modify your cookie settings anytime by clicking the 'Consent Preferences' button above. This will allow you to revisit the cookie consent banner and update your preferences or withdraw your consent immediately.</p><p>Additionally, different browsers offer various methods to block and delete cookies used by websites. You can adjust your browser settings to block or delete cookies. Below are links to support documents on how to manage and delete cookies in major web browsers.</p><p>Chrome: <a href="https://support.google.com/accounts/answer/32050">https://support.google.com/accounts/answer/32050</a></p><p>Safari: <a href="https://support.apple.com/en-in/guide/safari/sfri11471/mac">https://support.apple.com/en-in/guide/safari/sfri11471/mac</a></p><p>Firefox: <a href="https://support.mozilla.org/en-US/kb/clear-cookies-and-site-data-firefox?redirectslug=delete-cookies-remove-info-websites-stored&amp;redirectlocale=en-US">https://support.mozilla.org/en-US/kb/clear-cookies-and-site-data-firefox?redirectslug=delete-cookies-remove-info-websites-stored&amp;redirectlocale=en-US</a></p><p>Internet Explorer: <a href="https://support.microsoft.com/en-us/topic/how-to-delete-cookie-files-in-internet-explorer-bca9446f-d873-78de-77ba-d42645fa52fc">https://support.microsoft.com/en-us/topic/how-to-delete-cookie-files-in-internet-explorer-bca9446f-d873-78de-77ba-d42645fa52fc</a></p><p>If you are using a different web browser, please refer to its official support documentation.</p>`

- **effectiveDate:** **today** as ISO `YYYY-MM-DD`, computed on the server at creation (NOT
  the `August 20, 2025` shown in the screenshot).

**Behaviours:**
- New website → its `cookie_policy` row exists immediately with the above content; opening
  the editor shows the defaults in every section's Heading/Description and the effective-date
  picker shows today. No save needed to see them.
- Editing then saving a section still merge-upserts that section (existing behaviour);
  defaults for untouched sections are preserved.
- Image upload's `ensureOwnedPolicy` now always **finds** the row (never creates an empty
  one), so no `content:{}` clobber.

## Requirement alignment

- **R7 (automatic config updates):** a new site gets a ready-to-use, editable cookie-policy
  configuration with no developer code — the strongest fit; this is config provisioning.
- **R6 (privacy-law compliance):** ships compliant *default policy text* (what cookies are,
  how they're used, how to manage them) as a starting scaffold — partial support (text, not
  enforcement).
- **Core principle — NOT violated:** we store *policy text only*; we do not create or set any
  tracking cookies. (The text describes cookies; the CMP still gates the real ones.)

**Gaps:**
- **Pre-existing websites** (created before this ships) have no policy row and keep the old
  lazy behaviour (blank until first save). Not backfilled here — could add a one-off backfill
  or a GET-time default fallback later if wanted.
- Does not implement consent gating/recording (R2/R5/R8) — out of scope; this only seeds
  editor defaults.
- `effectiveDate` uses the server date (UTC ISO); near midnight it may differ from the user's
  local date by a day (acceptable; matches how the field is later editable anyway).

## Design

**Backend**
- **New `src/utils/defaultCookiePolicy.js`** — exports the default section content and a
  builder:
  ```js
  export const DEFAULT_COOKIE_SECTIONS = {
    aboutCookies:      { heading: 'What are cookies?',        description: '…HTML…' },
    useOfCookies:      { heading: 'How do we use cookies?',   description: '…HTML…' },
    cookiePreferences: { heading: 'Manage cookie preferences',description: '…HTML…' },
  }
  export function defaultCookieContent(effectiveDate) {
    return { ...DEFAULT_COOKIE_SECTIONS, effectiveDate }
  }
  ```
  (Keys and section allowlist match `utils/cookiePolicy.js` `SECTIONS`.)
- **`src/controllers/website.controller.js` `createWebsite`** — wrap in a transaction:
  ```js
  const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD (server/UTC)
  const website = await db.transaction(async (tx) => {
    const [w] = await tx.insert(websites).values({ name, url, userId: req.user.id })
      .returning({ id, name, url, createdAt })
    await tx.insert(cookiePolicy)
      .values({ websiteId: w.id, content: defaultCookieContent(today) })
    return w
  })
  ```
  Add imports: `cookiePolicy` from `../models/index.js`, `defaultCookieContent` from
  `../utils/defaultCookiePolicy.js`. Response unchanged.

**Frontend** — **no change.** `CookiePolicyPage` already loads `content` via GET and fills
Heading/Description per section and the effective-date picker from `content.effectiveDate`;
seeded defaults simply appear. (Verify only.)

**Docs / tests**
- `openapi.yaml`: note on `POST /pulse/websites` that it also seeds a default cookie policy
  (response shape unchanged).
- `scripts/smoke.js`: after website create, GET cookie-policy and assert
  `content.aboutCookies.heading === 'What are cookies?'` and `content.effectiveDate` is
  today's ISO date. (The existing "GET → 200 (empty ok)" check still passes — it only checks
  status.)

## Design notes
- **Seed at creation, in a transaction** (not lazily) so the 1:1 website↔policy invariant
  holds from the start and the editor never opens blank for a new site. Atomicity avoids a
  website with no policy row if the second insert fails.
- **Default content lives in one backend util** (`defaultCookiePolicy.js`) — single source of
  truth, reused if we later add a backfill or a "reset to defaults" action.
- **`&` in the Firefox URL is stored as `&amp;`** in the HTML so the seeded `content` is
  valid HTML the Tiptap editor round-trips cleanly.
- **effectiveDate computed server-side** so it can't be spoofed by the client and is
  consistent for every new site.
- **No new validation path:** the seed is inserted directly via Drizzle (not through the
  express-validator PUT chain); default headings/descriptions are well within the field
  limits (heading ≤255, description ≤20000).

## Prompts (instructions given to the AI)
> "ok i want this cookie policy row created along with website creation and i will give
> default content to put in the table, on the first click of cookie policy this should be
> visible in header field and description field for about cookies: […] for use of cookies:
> […] for cookie preferences (ignore revisit consent widget): […] effective date should be
> current date not one in the image create a plan for it in planmode"

Plus three screenshots providing the exact default Heading + Description text for About
cookies, Use of cookies, and Cookie preferences.

## Tasks
1. Add `src/utils/defaultCookiePolicy.js` with the three sections' default heading+description
   HTML and `defaultCookieContent(effectiveDate)`. — files: `backend/src/utils/defaultCookiePolicy.js` — satisfies: R7
2. Update `createWebsite` to insert website + seeded `cookie_policy` (content =
   `defaultCookieContent(today)`) in a transaction. — files: `backend/src/controllers/website.controller.js` — satisfies: R7
3. Extend smoke: after create, GET cookie-policy → assert seeded `aboutCookies.heading` +
   today's `effectiveDate`. — files: `backend/scripts/smoke.js` — satisfies: R7
4. openapi note on `POST /pulse/websites` (seeds default policy; response unchanged). — files: `backend/openapi.yaml` — satisfies: R7

## Acceptance criteria
- [ ] Creating a website inserts a `cookie_policy` row for it in the same transaction.
- [ ] Opening the editor for a new website shows the exact default Heading + Description for
      About cookies, Use of cookies, and Cookie preferences (per the screenshots).
- [ ] The effective-date picker shows **today's** date, not a hard-coded one.
- [ ] Editing + saving a section preserves the other sections' defaults (merge upsert).
- [ ] Image upload before first save finds the existing policy row (no empty clobber).
- [ ] Pre-existing websites are unaffected (documented gap: not backfilled).
- [ ] Core principle honoured: no cookies are set by this change (text only).
- [ ] Verification: `node --check` (changed .js); backend boots; `drizzle-kit push` (no schema
      change expected); frontend `build` + `lint`; smoke (subagent) — existing green + new
      seed checks; manual: create website → open editor → defaults + today visible.

## Supporting documentation
- Screenshots: default Heading + Description for About cookies, Use of cookies, Cookie
  preferences (effective date in the image is `August 20, 2025` — we use today instead).
- Reuses: `createWebsite` (`website.controller.js`), `cookiePolicy` model, `utils/cookiePolicy.js`
  `SECTIONS`, `CookiePolicyPage.jsx` load/GET path, `apiFetch`.
- Related plans: `cookie-policy-image-upload.md`, `cookie-policy-orphan-image-cleanup.md`,
  `cookie-policy-preferences.md`, `cookie-policy-about-cookies.md`, `cookie-policy-use-of-cookies.md`.
- Skills: `plan-template`, `update-openapi`, `sync-claude-md`, `verify-and-ship`.

## Notes / changelog
- _draft_ — planned via PLAN mode; `plan-template` conformed. Backend-only implementation
  (seed at creation, in a transaction); frontend renders it unchanged. Default content taken
  verbatim from the user's three screenshots; effective date = server today. Awaiting review
  → "implement the plan" → manual check → `verify-and-ship`.
- _implemented_ — backend only. Added `utils/defaultCookiePolicy.js` (three sections'
  default heading+description HTML + `defaultCookieContent(effectiveDate)`); `createWebsite`
  now inserts website + seeded `cookie_policy` (content = defaults, `effectiveDate` = server
  today) in a `db.transaction`; openapi note on `POST /pulse/websites`; smoke extended with 3
  seed checks. No frontend change (editor renders the seeded content via the existing GET).
  Verified: `node --check` (util/controller/smoke) OK; openapi YAML valid; backend rebuilt +
  booted clean (drizzle push applied, no schema change); smoke 40/40 incl. the new seed
  checks (effectiveDate = 2026-07-09). Awaiting user's manual check → ship.
