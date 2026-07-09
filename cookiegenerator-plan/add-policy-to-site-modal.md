# Plan: Enable "Add policy to site" button → method-picker modal (HTML format only)

- **Slug:** `add-policy-to-site-modal`
- **Scope:** frontend only (single plan, stored in backend repo per plan-template)
- **Status:** implemented (awaiting user manual check → ship)

## Objective / feature request

Make the currently-disabled **"Add policy to site"** button on the Policy Preview
page clickable. On click it opens a modal (matching the CookieYes "Add cookie policy
to your site" screenshot) for choosing how to add the generated policy to the site.
For now the modal shows **only the "HTML format" option, rendered disabled** ("coming
soon"); its actual logic is a later feature.

## Context

On the read-only Policy Preview page (`/cookie-policy/:websiteId/preview`), the
**"Add policy to site"** button is currently a dead placeholder — hard-`disabled`
with `title="Coming soon"` (`PolicyPreviewPage.jsx:242-250`). The reference screenshot
shows three methods — **One-click install**, **Code snippet**, **HTML format**. Per
the user's decision, we ship **only the "HTML format" card** now, rendered **disabled**
(a "coming soon" placeholder); its actual logic (rendering/downloading the policy HTML
embed) is a later feature. Outcome: clicking the button opens a titled modal with the
site URL and a single, styled but non-interactive "HTML format" option — no backend
change, no behavior change to consent/cookies.

## Specifications

Functional:
- The "Add policy to site" button on the preview page is **enabled** and clickable
  (remove `disabled` / `aria-disabled` / "Coming soon").
- Clicking it opens a modal dialog with:
  - **Title:** "Add cookie policy to your site" (centered).
  - **Subtitle:** the website URL (`url` state already loaded on the page).
  - A section label: **"Select your preferred method to add the policy"**.
  - Exactly **one method card — "HTML format"** with sub-text
    "Manually update the code on your site each time you modify the generated
    policy." The card is **disabled** (dimmed, `cursor:not-allowed`,
    `aria-disabled`, not selectable) with a small "Coming soon" affordance.
  - A close (✕) control; closes on ✕ click, backdrop click, and `Escape`; locks
    body scroll while open (match the existing modal pattern).
- No selection/confirm action wired yet (HTML logic is future work).

Data model / API: **none.** Frontend-only; no new endpoint, no schema change, no
request. Reuses `url` already fetched via `GET /pulse/websites/:id/cookie-policy`.

Validation rules: none (no input).

## Requirement alignment

- This is **UI scaffolding** for delivering the *already-generated* policy to the
  site. It most closely relates to **R7 (config/policy updates surfaced to the site
  without changing developer code)** — the eventual "HTML format" path is the manual
  delivery mechanism.
- **Gap (intended):** No requirement is *completed* here — the card is a disabled
  placeholder; the HTML embed generation/output that would satisfy the delivery is a
  follow-up. Flagged explicitly.
- **Core-principle check:** This feature does **not** create, set, block, or release
  any cookie, and does not touch consent recording or the script gatekeeper. It is
  purely presentational. Therefore the `_ga`-release-on-accept acceptance check
  **does not apply** to this change (no consent surface is touched) — noted so a
  reviewer doesn't expect it.

## Design

All changes are in **`frontend/src/PolicyPreviewPage.jsx`** + **`frontend/src/signup.css`**,
reusing the existing hand-rolled modal pattern (no UI library, per frontend conventions).

1. **State:** add one boolean, `const [addOpen, setAddOpen] = useState(false)`
   alongside the existing `dialog`/`menuOpen` state (`PolicyPreviewPage.jsx:24-26`).

2. **Enable the button** (`PolicyPreviewPage.jsx:242-250`): drop `disabled`,
   `title="Coming soon"`, `aria-disabled`; add `onClick={() => setAddOpen(true)}`
   and `aria-haspopup="dialog"`. Keep the existing `.cp-add-policy` class/styling.

3. **Modal markup:** add an `{addOpen && ( … )}` block near the other overlays
   (after the `dialog === 'deleted'` block, ~`PolicyPreviewPage.jsx:436`). Follow the
   canonical modal in `PolicyPreview.jsx`:
   - `<div className="cp-modal-overlay" onClick={() => setAddOpen(false)}>` (backdrop
     closes) wrapping `<div className="cp-add-modal" role="dialog" aria-modal="true"
     aria-label="Add cookie policy to your site" onClick={(e)=>e.stopPropagation()}>`.
   - Header: centered `<h2>Add cookie policy to your site</h2>`, a muted `url` line,
     and a `.cp-modal-close` ✕ button (reuse the existing close-button SVG markup
     from `PolicyPreview.jsx`).
   - Body: the "Select your preferred method to add the policy" label, then a single
     disabled method card:
     `<div className="cp-method-card is-disabled" aria-disabled="true">` containing
     `<h3>HTML format</h3>` + `<span class="cp-method-soon">Coming soon</span>` +
     `<p>Manually update the code on your site each time you modify the generated
     policy.</p>`. Not a `<button>` (nothing to activate yet), so keyboard focus
     isn't trapped on a dead control.

4. **Esc + body-scroll lock:** add a `useEffect` keyed on `addOpen` mirroring the
   `PolicyPreview.jsx` effect (Escape → `setAddOpen(false)`; set
   `document.body.style.overflow = 'hidden'` while open, restore on cleanup). The
   existing `menuOpen` Esc handler is separate and unaffected.

5. **CSS (`signup.css`):** reuse `.cp-modal-overlay` and `.cp-modal-close`. Add:
   - `.cp-add-modal` — like `.cp-modal` but a smaller max-width; centered header text.
   - `.cp-method-card` — bordered, rounded card matching the screenshot
     (radius/border/soft shadow from existing tokens); `.cp-method-card.is-disabled`
     → `opacity:.6; cursor:not-allowed`.
   - `.cp-method-soon` — a small muted "Coming soon" pill next to the card heading.
   Keep everything on existing design tokens (`--card`, `--border`, `--muted`, etc.);
   no new color system, light theme only.

## Design notes

- **Only one card** per the user's explicit choice (not all three). Building it as a
  non-`<button>` card keeps a11y honest — there's no interactive element promising an
  action that does nothing.
- Reusing `.cp-modal-overlay` + the `PolicyPreview.jsx` Esc/scroll-lock pattern keeps
  this consistent with the two modals already on the page (`dialog` confirm/deleted)
  and the preview modal — no new modal abstraction introduced.
- The `url` subtitle uses the `url` already in state; if empty it falls back to a
  neutral phrase (as the delete dialog does with `{url || 'this website'}`).
- No backend/openapi/CLAUDE.md route changes → `update-openapi` not needed; only the
  frontend `PolicyPreviewPage` CLAUDE.md line (DISABLED → enabled + modal) needs a
  touch via `sync-claude-md` at ship time.

## Prompts (instructions given to the AI)

> "now i want to enable the add policy to site button — when i click that button it
> should have the html button in the page [screenshot: 'Add cookie policy to your
> site' with One-click install / Code snippet / HTML format]. here there are three
> options; for now only put html format option, disable it for now, will later
> implement its logic. first create a plan for it in planmode."

Clarification captured: modal shows **only the HTML format card**, disabled.

## Tasks

1. Add `addOpen` state + an Escape/body-scroll-lock `useEffect` mirroring
   `PolicyPreview.jsx` — files: `frontend/src/PolicyPreviewPage.jsx` — satisfies: R7 (scaffold)
2. Enable the "Add policy to site" button (remove `disabled`/`aria-disabled`/`title`;
   add `onClick`) — files: `frontend/src/PolicyPreviewPage.jsx` — satisfies: R7 (scaffold)
3. Add the `{addOpen && …}` modal: title, URL subtitle, method label, single disabled
   "HTML format" card, ✕/backdrop/Esc close — files: `frontend/src/PolicyPreviewPage.jsx`
4. Add `.cp-add-modal`, `.cp-method-card(.is-disabled)`, `.cp-method-soon` styles
   (reuse `.cp-modal-overlay`/`.cp-modal-close`, existing tokens) — files: `frontend/src/signup.css`
5. Update the frontend CLAUDE.md `PolicyPreviewPage` line (DISABLED → enabled + modal)
   — done at ship time via `sync-claude-md`.

## Acceptance criteria

- [ ] The "Add policy to site" button on the preview page is clickable (no longer
      `disabled`) and shows a pointer cursor.
- [ ] Clicking it opens a modal titled "Add cookie policy to your site" with the site
      URL as subtitle and the "Select your preferred method to add the policy" label.
- [ ] The modal shows exactly one card, "HTML format", with the manual-update
      description, visibly disabled (dimmed, `not-allowed` cursor) and not clickable.
- [ ] The modal closes on ✕, backdrop click, and Escape; body scroll is locked while
      open and restored on close.
- [ ] The kebab menu (Edit/Delete) and the delete confirm/deleted dialogs still work
      unchanged (no regression from the new state/effect).
- [ ] `npm run build` and `npm run lint` pass in `frontend/`.
- [ ] N/A — no consent/cookie surface touched, so the `_ga`-release check does not apply.

## Supporting documentation

- Screenshot: CookieYes "Add cookie policy to your site" method-picker (provided by user).
- Existing modal pattern: `frontend/src/PolicyPreview.jsx` (Esc + backdrop + scroll lock).
- Button/preview page: `frontend/src/PolicyPreviewPage.jsx:238-300` and `.cp-add-policy`
  in `frontend/src/signup.css:951-964`.
- Frontend conventions: `frontend/CLAUDE.md` (design tokens, no UI library, light theme).

## Notes / changelog

- Draft. Awaiting manual review. Modal scope confirmed with user: single disabled
  "HTML format" card (not all three). Frontend-only; no backend change. Per
  plan-template, this doc is committed **with** the feature at ship time, not on its own.
- **Implemented (2026-07-09):** All 4 tasks done in `frontend/src/PolicyPreviewPage.jsx`
  (addOpen state, Esc + scroll-lock effect, button enabled, `{addOpen && …}` modal) and
  `frontend/src/signup.css` (`.cp-add-modal`, `.cp-add-close`, `.cp-add-head/-url/-label`,
  `.cp-method-card(.is-disabled)`, `.cp-method-title`, `.cp-method-soon`, hover on
  `.cp-add-policy`). **No backend route touched → smoke test not extended/needed** (this
  is the frontend-only feature; verify-and-ship has no backend change to smoke).
  Verification: `npm run lint` clean, `npm run build` succeeded (pre-existing chunk-size
  warning only). CLAUDE.md `PolicyPreviewPage` line to be refreshed at ship time via
  `sync-claude-md`.
