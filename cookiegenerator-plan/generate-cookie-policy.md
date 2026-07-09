# Plan: Generate cookie policy (final step → Policy Preview page)

> On approval, this plan is saved verbatim to
> `backend/cookiegenerator-plan/generate-cookie-policy.md` (per `plan-template`)
> and committed together with the feature at ship time — never separately.

- **Slug:** generate-cookie-policy
- **Scope:** frontend + backend (single plan, stored in backend repo) — this
  feature is **frontend-only**; backend untouched
- **Status:** implemented

## Context

The cookie-policy wizard (`/cookie-policy/:websiteId`) walks three steps —
About cookies → Use of cookies → Cookie preferences — with a Previous/Next nav
that auto-saves each section (`cookie-policy-wizard-nav-autosave.md`), a
sidebar "% complete" bar that follows the current step
(`cookie-policy-progress-bar.md`, About 0% → Use 40% → Preferences 80%; **100%
was explicitly reserved for "the future Generate step"**), and a "Preview
cookie policy" **modal** (`preview-cookie-policy.md`). What's missing is the
**final generation step**: on the last wizard step the primary action is still
"Next" (which is a no-op — there is no next section), and there is no landing
page that presents the finished policy as its own screen. CookieYes ends the
wizard with a **"Generate cookie policy"** button that navigates to a dedicated
**Policy preview** page (`app.cookieyes.com/cookie-policy/preview`) showing the
rendered policy, an "Add policy to site" action, and 100% progress.

## Objective / feature request

On the **Cookie preferences** (final) step, replace the **Next** button with a
**Generate cookie policy** button. Clicking it saves the current step (same
auto-save as Next) then navigates to a new **Policy Preview page** that shows:

- **Sidebar:** "Cookie Policy" title; "Generating cookie policy for `<url>`";
  an amber **Disclaimer** box; an **Edit cookie policy** button (→ the About
  cookies first wizard step); a **100% complete** progress bar.
- **Main:** "Policy preview" heading; a **disabled** green **Add policy to
  site** button with a **disabled** 3-dots (kebab) menu beside it; a static
  **English** language chip pair; and the composed policy rendering (title,
  effective/last-updated dates, each section's heading + rich-text HTML, footer).
- A green **success toast** on arrival ("Your edits to the cookie policy for
  `<url>` have been saved. Now, add it to your website.").

## Specifications

### Wizard change (`CookiePolicyPage.jsx`)

- On the **last** step only (`!nextKey`, i.e. `active === 'preferences'`), the
  right-hand primary button renders **"Generate cookie policy"** instead of
  **"Next"**. On earlier steps it stays "Next" exactly as today. "Previous" and
  "Save draft" are unchanged (screenshot 1: `Previous | Save draft | Generate
  cookie policy`).
- Clicking "Generate cookie policy" calls the existing `saveCurrent()` (which,
  on the preferences step, also persists the policy-level `effectiveDate`); on a
  clean save it `navigate(\`/cookie-policy/${websiteId}/preview\`)`. On a
  validation/request failure it stays put and shows the inline errors/banner
  (same contract as Next). Disabled while `saving`.

### New Policy Preview page (`PolicyPreviewPage.jsx`, route
`/cookie-policy/:websiteId/preview`)

- Auth + load pattern identical to `CookiePolicyPage`: on mount, `apiFetch`
  `GET /pulse/websites` (for the site `url`) and
  `GET /pulse/websites/:websiteId/cookie-policy` (for `content`) in parallel;
  `401/403` → `/login`; `404` → "Website not found." banner. Renders the
  **saved** content (this page is reached only after a successful save).
- **Sidebar** (`<aside className="cp-side">`, reused):
  - Title "Cookie Policy"; sub "Generating cookie policy for `<url>`" (reuses
    `.cp-side-title` / `.cp-side-sub`).
  - **Disclaimer** box (new `.cp-disclaimer`): speech-bubble icon + "Disclaimer"
    heading + the CookieYes legal text ("We do not take any responsibility… seek
    the services of an attorney."). Static copy.
  - **Edit cookie policy** button (new `.cp-edit-btn`, pinned near the bottom):
    edit icon + label; `onClick` → `navigate(\`/cookie-policy/${websiteId}\`)`,
    which opens the wizard on **About cookies** (its default `active='about'` —
    the first step).
  - **100% complete** progress block: reuse `.cp-progress` /
    `.cp-progress-label` / `.cp-progress-track` / `.cp-progress-fill` with a
    hard-coded `pct = 100` (full green bar).
- **Main** (`<main className="cp-main">`, reused):
  - Header row: **"Policy preview"** heading on the left; on the right a
    **disabled** green **"Add policy to site"** button (new `.cp-add-policy`)
    and a **disabled** 3-dots kebab icon button (new `.cp-kebab`). Both carry
    `disabled` + `title="Coming soon"` / `aria-disabled` (feature not built yet).
  - **Language chip row** (new `.cp-lang-row`): a selected "English" chip (blue
    check circle + label) and a dropdown-chevron chip. Purely presentational and
    non-interactive (the app has no i18n) — matches screenshot 3.
  - **Policy body:** the composed policy via the shared `PolicyDocument`
    component (see Design) — "Cookie Policy" h1, "Effective date: …", "Last
    updated: …", each non-empty section's heading + rich-text HTML, footer.
- **Success toast** on mount: reuse the existing `.toast.toast-success` markup +
  the 4s auto-dismiss `useEffect` already used in `CookiePolicyPage`. Message:
  "Your edits to the cookie policy for `<url>` have been saved. Now, add it to
  your website." Shown once per arrival.
- A **Back to Dashboard** button in the top bar (reuse `.cp-topbar` /
  `.cp-back`) → `navigate('/home')`, consistent with the wizard page.

### Shared rendering

Extract the policy-body render (currently inside `PolicyPreview.jsx`'s
`.cp-preview-body`) into a small presentational **`PolicyDocument.jsx`** used by
both the existing preview **modal** and the new preview **page**, so the two
renderings never drift. No behavioural change to the modal.

### No backend / API change

No new endpoints, no request/response shape change, no `openapi.yaml` change,
no new smoke assertions. This is a frontend-only feature (like
`preview-cookie-policy.md`).

## Requirement alignment

- **§2.4 Preview / "final generation"** (assignment policy-generator section,
  per the user's screenshots): the "required before final generation" preview
  clause noted as a gap in `preview-cookie-policy.md` is now **addressed** — this
  adds the explicit final-generation action and a rendered-page (not form-dump)
  presentation of the finished policy. **Satisfied.**
- **§2.3 Progress tracking:** completes the scale — the Generate step is the
  100% end state the progress-bar plan reserved. **Strengthened.**
- **R1–R8** (`references/assignment.md` CMP requirements): **not touched.** The
  page creates **no cookies** — it only renders stored policy content — so the
  core principle ("a CMP does not create cookies") is intact.
- **Gaps flagged (deliberately deferred, rendered disabled):**
  - **"Add policy to site"** is disabled. The real action is the embed/snippet
    that installs the consent banner + script gatekeeper on the site
    (toward **R2** script gatekeeper / **R7** no-code config updates). Not built
    yet — matches the user's instruction to keep it disabled for now.
  - **English language chip** is static/disabled — the app has no i18n; the
    chip mirrors the CookieYes UI without implying multi-language support.
  - **No persisted `generated` flag.** The progress-bar plan speculated a future
    `content.generated` flag; this feature does **not** add one. The preview
    page shows a static 100% and the wizard's position-based bar is unchanged.
    Deferred to whenever "Add policy to site" is built (that is the real
    "published" milestone). Documented here so it isn't silently assumed done.

## Design

All in `frontend/` (React 19 + Vite, plain JS/JSX, plain CSS in `signup.css`):

1. **`frontend/src/PolicyDocument.jsx`** (new, ~35 lines) — presentational.
   Props `{ url, sections, effectiveDate }`. Contains the exact JSX currently in
   `PolicyPreview.jsx` lines 63–85 (the `.cp-preview-body` block: h1, the two
   `.cp-preview-date` lines via `formatLong`/`todayISO`, the `sections.map`
   with the `hasText` empty-skip + `dangerouslySetInnerHTML`, and the
   `.cp-preview-footer`). Same trust boundary as today (user's own Tiptap HTML).

2. **`frontend/src/PolicyPreview.jsx`** (edit) — replace the inline body with
   `<PolicyDocument url={url} sections={sections} effectiveDate={effectiveDate}
   />` inside the existing `.cp-modal` / `.cp-modal-head`. No prop or behaviour
   change for callers.

3. **`frontend/src/PolicyPreviewPage.jsx`** (new, ~140 lines) — the route
   component. Reuses `Header account`, `.cp-topbar`/`.cp-back` (Back to
   Dashboard), `.cp-shell`, `.cp-side`, `.cp-main`. Load logic copied from
   `CookiePolicyPage.loadAll` (parallel `GET /pulse/websites` +
   `GET …/cookie-policy`; same 401/403/404 handling; builds the ordered
   `sections` array + `effectiveDate` the same way). Renders: sidebar
   (title/sub, `.cp-disclaimer`, `.cp-edit-btn`, 100% `.cp-progress`); main
   (header row with "Policy preview" + disabled `.cp-add-policy` + disabled
   `.cp-kebab`; `.cp-lang-row` chips; `<PolicyDocument …/>`); success toast
   (reused `.toast.toast-success` + 4s dismiss effect). The `SECTIONS` order is
   imported/duplicated from the wizard's list (only `sectionKey`s are needed —
   `['aboutCookies','useOfCookies','cookiePreferences']`).

4. **`frontend/src/CookiePolicyPage.jsx`** (edit) — on the last step render the
   Generate button in place of Next:
   ```jsx
   {nextKey ? (
     <button className="submit cp-next …" onClick={() => goTo(nextKey)} …>Next …</button>
   ) : (
     <button className="submit cp-generate …" onClick={handleGenerate} disabled={saving}>
       Generate cookie policy
     </button>
   )}
   ```
   `handleGenerate`: `const ok = await saveCurrent(); if (ok)
   navigate(\`/cookie-policy/${websiteId}/preview\`)`. (The `cp-next` "Next"
   arrow SVG is dropped for the Generate variant, matching screenshot 1.)

5. **`frontend/src/App.jsx`** (edit) — import `PolicyPreviewPage`; add
   `<Route path="/cookie-policy/:websiteId/preview" element={<PolicyPreviewPage />} />`
   **before** the existing `/cookie-policy/:websiteId` route (more specific
   path first, though react-router matches by specificity regardless).

6. **`frontend/src/signup.css`** (edit) — new `cp-`-prefixed classes, reusing
   tokens (`--accent`, `--border`, `--muted`, `--ok`, etc.):
   - `.cp-disclaimer` — amber/cream box (`background` soft amber, rounded, small
     type) + `.cp-disclaimer h3` and icon sizing.
   - `.cp-edit-btn` — light pill like `.cp-preview-btn` (icon + label), pinned
     above the progress block.
   - `.cp-main-head` — flex row (space-between) holding the "Policy preview"
     title and the right-side actions.
   - `.cp-add-policy` — green (`--ok`) filled button; `:disabled` greyed at
     reduced opacity, `cursor:not-allowed`.
   - `.cp-kebab` — square icon button (three dots), same disabled treatment.
   - `.cp-lang-row` / `.cp-lang-chip` (+ `.selected` with the blue check) /
     `.cp-lang-caret` — the static language chips.
   - Reuse existing `.cp-preview-body` / `.cp-preview-content` /
     `.cp-preview-date` / `.cp-preview-footer` (now driven by `PolicyDocument`),
     and `.cp-progress*` for the 100% bar. On the page (not a modal) the body
     needs no overlay; wrap it in a plain card matching screenshot 2's outlined
     panel (`.cp-preview-card` or reuse `.card`).

7. **Docs:** add `frontend/AI_DOCS/generate_cookie_policy.md`; run
   `sync-claude-md` after implementation (frontend Structure tree +
   `PolicyPreviewPage`/`PolicyDocument` lines; Routes table gets the new
   `/cookie-policy/:websiteId/preview` row). No backend endpoint doc changes.

## Design notes

- **New route vs. in-page view state.** Chose a **new route**
  (`/cookie-policy/:websiteId/preview`) over a `view` toggle inside
  `CookiePolicyPage`: it mirrors CookieYes's own URL, gives "Edit cookie policy"
  a clean `navigate` back to the wizard, and keeps the two very different
  layouts (form wizard vs. read-only preview) in separate components. Cost: the
  preview page re-fetches `content` — acceptable, and it guarantees the page
  shows the just-saved server state rather than trusting client memory.
- **Reached only after a save.** Generate routes through `saveCurrent()`, so the
  preview always reflects persisted content. The page still tolerates a direct
  URL visit (loads from the backend); if a section was never filled it simply
  renders fewer sections (the `hasText` empty-skip already handles this).
- **`PolicyDocument` extraction** avoids duplicating the render + `hasText`
  empty-skip + `dangerouslySetInnerHTML` logic across the modal and the page
  (a duplication `code-review` would flag). One source of truth for the rendered
  policy.
- **"Add policy to site" / kebab / language chip are intentionally inert.**
  Per the user, disable them now and wire them later. They are real UI anchors
  for future work (site embed, policy actions menu, i18n) — kept visible but
  non-functional so the screen matches the reference without over-promising.
- **100% is static on this page** — it is not derived from
  `completedSections` and does not persist a `generated` flag (see Requirement
  alignment gap). The wizard's own position-based bar (0/40/80) is untouched.
- **Toast on mount, every arrival** — matches CookieYes (the banner shows each
  time you land on the preview). No navigation `state` flag needed; simplest
  behaviour that matches the screenshot.
- **Last-updated = today** (`todayISO()`), consistent with the existing modal
  and `preview-cookie-policy.md` (the backend doesn't expose the row's
  `updated_at`).

## Prompts (instructions given to the AI)

> "now i want to remove next in cookiepreferences and should put a generate
> cookiepolicy button as shown in the image [screenshot 1: Previous | Save draft
> | Generate cookie policy] and on clicking it should show a page like this
> [screenshot 2: CookieYes 'Policy preview' page — sidebar with Cookie Policy
> title, 'Generating cookie policy for <url>', amber Disclaimer box, Edit cookie
> policy button, 100% complete; main with 'Policy preview' heading, green 'Add
> policy to site' button + 3-dots, English chip, and the rendered policy]. as
> shown in the image it just shows the policy preview in the main section, should
> have that add policy to site button currently disabled and put the 3 dots near
> it currently disabled (will do it later). update progress bar to 100 on
> reaching this page. the edit cookie policy button should go to the aboutcookies
> page that is the first page of the wizard. also you can see a green success
> toast should add that also. create a plan for this in planmode."

## Tasks

1. Extract `PolicyDocument.jsx` from the modal body; wire it into
   `PolicyPreview.jsx` — files: `frontend/src/PolicyDocument.jsx`,
   `frontend/src/PolicyPreview.jsx` — satisfies: 2.4
2. Add `PolicyPreviewPage.jsx` (load + sidebar disclaimer/edit/100% + main
   header disabled actions + language chips + `PolicyDocument` + success toast)
   — files: `frontend/src/PolicyPreviewPage.jsx` — satisfies: 2.4, 2.3
3. Route the new page — files: `frontend/src/App.jsx` — satisfies: 2.4
4. Replace Next with "Generate cookie policy" on the last step + `handleGenerate`
   navigation — files: `frontend/src/CookiePolicyPage.jsx` — satisfies: 2.4
5. Styles: `.cp-disclaimer`, `.cp-edit-btn`, `.cp-main-head`, `.cp-add-policy`,
   `.cp-kebab`, `.cp-lang-*`, preview-card — files: `frontend/src/signup.css`
   — satisfies: 2.4
6. Feature doc — files: `frontend/AI_DOCS/generate_cookie_policy.md`
7. Save this plan to
   `backend/cookiegenerator-plan/generate-cookie-policy.md` (ships with the
   feature commit)

## Acceptance criteria

- [ ] On **About cookies** and **Use of cookies** the primary button still reads
      **Next**; on **Cookie preferences** it reads **Generate cookie policy**
      (layout `Previous | Save draft | Generate cookie policy`).
- [ ] Clicking "Generate cookie policy" with valid fields saves the section +
      effective date, then lands on `/cookie-policy/:websiteId/preview`; with an
      empty heading/description it stays and shows the inline error (no navigation).
- [ ] The preview page sidebar shows: "Cookie Policy", "Generating cookie policy
      for `<url>`", the amber **Disclaimer** box, an **Edit cookie policy**
      button, and a **100% complete** full progress bar.
- [ ] **Edit cookie policy** navigates to `/cookie-policy/:websiteId`, opening
      the wizard on the **About cookies** step.
- [ ] Main section shows "Policy preview", a **disabled** green **Add policy to
      site** button, a **disabled** 3-dots menu beside it, the static **English**
      chip, and the rendered policy (title, effective/last-updated dates, each
      non-empty section heading + formatted rich-text, footer — not a form dump).
- [ ] A green success **toast** appears on arrival and auto-dismisses (~4s).
- [ ] The existing **Preview cookie policy modal** still renders identically
      (via the shared `PolicyDocument`) — no regression.
- [ ] Frontend **build + lint pass**; `git -C backend status` clean apart from
      the plan doc (no backend changes).

## Supporting documentation

- Reference screenshots (user, 2026-07-09): (1) wizard footer with "Generate
  cookie policy"; (2) CookieYes "Policy preview" page (sidebar disclaimer + edit
  + 100%, main "Add policy to site" + kebab + English chip + rendered policy);
  (3) the "English" language chip pair.
- Prior related plans: `preview-cookie-policy.md` (the modal + §2.4 preview
  gap this closes), `cookie-policy-progress-bar.md` (the 100% end state this
  reserves), `cookie-policy-wizard-nav-autosave.md` (the save-then-move nav the
  Generate button reuses).
- Assignment: `.claude/skills/plan-from-assignment/references/assignment.md`
  (§2.3, §2.4; R1–R8 core principle).
- Conventions: `frontend/CLAUDE.md`, `.claude/skills/plan-template/SKILL.md`.

## Notes / changelog

- 2026-07-09 — plan drafted (plan mode). Not committed; ships with the feature.
- 2026-07-09 — implemented. Deviations: (1) extracted the shared render into
  `PolicyDocument.jsx` (used by both the modal and the new page) as planned; the
  modal's local `hasText` helper moved into `PolicyDocument`. (2) Toast message is
  "Your edits to the cookie policy have been saved. Now, add it to your website."
  (dropped the inline `<url>` — the screenshot shows the URL but the toast reads
  cleaner without it and the sidebar already shows the URL). (3) Toast is seeded
  as the initial `useState` value (not set in an effect) to satisfy the
  `react-hooks/set-state-in-effect` lint rule. Verification: `npm run lint` PASS
  (clean), `npm run build` PASS (pre-existing chunk-size warning only). No
  backend/route changes → regression smoke not run (nothing in `smoke.js` scope
  changed), consistent with `preview-cookie-policy.md`.
- 2026-07-09 — follow-up fix (user-reported flex inconsistency between wizard
  steps): the cookie-policy layout was not capped to the viewport (`.page` uses
  `min-height`), so `.cp-main`'s `overflow-y:auto` never engaged — the whole page
  grew with content and the action row drifted (bottom on "Use of cookies",
  pushed off-screen on "Cookie preferences"). Fix: added a `cp-page` modifier
  (`height:100svh; overflow:hidden`) to both the wizard and preview page roots;
  `.cp-main` is now a flex column with an inner scrollable `.cp-main-scroll` and a
  pinned `.cp-actions` footer (top border, like CookieYes). Preview page: header
  (`.cp-main-head`) pinned at top, policy body scrolls in `.cp-main-scroll`.
  Result: footer/sidebar-bottom stay in a consistent position across all steps.
  Re-verified: `npm run lint` PASS, `npm run build` PASS.
- 2026-07-09 — follow-up polish (user): the pinned footer / preview-page header
  were capped at `.cp-main`'s `max-width:900px`, so the top border cut off early
  with a grey gap on the right. Removed the cap (`.cp-main` now fills the panel
  width, `min-width:0`) so the footer bar and the generate-page header span the
  full main width edge-to-edge like CookieYes; bumped `.cp-actions` vertical
  padding to 18px. Lint + build PASS.
- 2026-07-09 — user: removed the static **English** language chip from the
  preview page (not requested in the original prompt — that only called for the
  policy preview + disabled "Add policy to site" + disabled 3-dots). Dropped the
  `.cp-lang-row`/`.cp-lang-chip`/`.cp-lang-caret` markup + CSS. Lint + build PASS.
