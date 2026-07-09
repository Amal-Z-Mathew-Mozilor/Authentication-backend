# Plan: Back to Dashboard button (cookie-policy wizard)

- **Slug:** back-to-dashboard-button
- **Scope:** frontend + backend (single plan, stored in backend repo) — **backend: N/A** (no server changes)
- **Status:** implemented

## Objective / feature request
Add a "← Back to Dashboard" button at the top-left of the cookie-policy 3-step wizard
(`CookiePolicyPage`). Clicking it saves the current wizard section (reusing the existing
"Save draft" logic, which persists to the cookie-policy DB) and then navigates to `/home`.
Because the section content is persisted, returning to the wizard shows the saved edits.

## Specifications
Functional requirements:
- A bordered, pill-shaped button labelled **"Back to Dashboard"** with a left-arrow icon,
  placed between the `<Header>` and the `.cp-shell` (matches the provided screenshot).
- On click:
  1. Save the **current** section using the existing `saveCurrent()` logic (same PUT to
     `/pulse/websites/:id/cookie-policy/:section`, and the effective-date PUT on the
     preferences tab).
  2. **Suppress the success toast** for this save — unlike Save draft / Prev / Next, no
     "Draft saved successfully!" toast should appear when leaving.
  3. **Only navigate to `/home` on a clean save.** If the current section fails validation
     (empty/invalid Heading or Description), `saveCurrent()` shows the inline field errors
     and the user stays on the page (identical to Previous/Next behaviour today).
  4. Disable the button while a save is in flight (`saving`), like the other action buttons.
- **Return behaviour:** the wizard continues to open on step 1 (About cookies) as it does
  today. No step-index tracking. Edits are preserved because content is already loaded from
  the DB per section in `loadAll()` on mount. ("Just preserve my edits", per the user.)

API contract / data model / backend: **unchanged.** No new endpoint, validator, schema, or
migration. This is a frontend-only feature that reuses the existing cookie-policy PUT routes.

## Requirement alignment
- No direct mapping to the assignment requirements (R1–R8) — this is a **UX/navigation
  affordance** for the cookie-policy generator wizard, not consent behaviour.
- **Core principle:** does **not** violate it — the CMP still creates no cookies; this only
  adds navigation + reuses existing draft-save. (N/A for R-mapping is intentional and noted.)

## Design
Frontend only, in `frontend/src/CookiePolicyPage.jsx` + `frontend/src/signup.css`.

1. **Make the toast optional in `saveCurrent()`.**
   Change the signature to `saveCurrent({ silent = false } = {})` and guard the toast:
   `if (!silent) setToast({ message: 'Draft saved successfully!' })`.
   Existing callers keep the toast:
   - `handleSave()` → `await saveCurrent()` (unchanged; toast shows).
   - `goTo(key)` → `await saveCurrent()` (unchanged; toast shows).

2. **Add the exit handler.**
   ```js
   async function handleBackToDashboard() {
     const ok = await saveCurrent({ silent: true })
     if (ok) navigate('/home')
   }
   ```
   `navigate` and `saveCurrent` already exist; `/home` is the dashboard route (`App.jsx`).

3. **Render the button** between `<Header account />` and `<div className="cp-shell">`:
   ```jsx
   <div className="cp-topbar">
     <button
       type="button"
       className="cp-btn cp-back"
       onClick={handleBackToDashboard}
       disabled={saving}
     >
       <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
         <line x1="19" y1="12" x2="5" y2="12" />
         <polyline points="12 19 5 12 12 5" />
       </svg>
       Back to Dashboard
     </button>
   </div>
   ```
   Reuses the existing `.cp-btn` outlined-pill style (same as Previous/Save draft).

4. **CSS** — add a light top-bar strip in `signup.css` (near the `.cp-*` block):
   ```css
   .cp-topbar {
     background: var(--card);
     border-bottom: 1px solid var(--border);
     padding: 14px 24px;
   }
   ```
   `.cp-back` needs no extra rules (inherits `.cp-btn`); add one only if spacing tweaks are needed.

## Design notes
- **Why reuse `saveCurrent()` rather than a new save path:** the user explicitly said to use
  the existing Save-draft logic that writes to the cookie-policy DB. Reusing it keeps one
  validation + persistence code path (incl. the preferences-tab effective-date PUT and the
  `usedImageIds` orphan-cleanup contract) — no divergence to maintain.
- **Why suppress the toast:** the user asked for the save to be silent on exit — the user is
  navigating away, so a transient success toast on `/home` (or racing the unmount) is noise.
- **Why block on invalid:** consistent with Prev/Next, and "it should be saved before going"
  implies a successful save gates the navigation. In practice sections are seeded with default
  content on website creation, so a hard block is rare.
- **Why no step-index persistence:** user chose "just preserve my edits". Content already
  round-trips through the DB via `loadAll()`, so no `currentStep` field / backend change is
  needed. If cross-visit step restoration is wanted later, it would be a follow-up storing
  `currentStep` in the `cookie_policy.content` jsonb (alongside `effectiveDate`) via
  `putPolicyMeta` — explicitly out of scope here.
- **Rejected alternative:** localStorage for step position — unnecessary given the chosen
  "preserve edits only" behaviour.

## Prompts (instructions given to the AI)
- "create a back to dashboard page button as shown in the image … so when going to dashboard
  if i am on page of 3 step wizard it should be saved before going to /home (frontend url) and
  when i get back i must see the change create a plan for it in planmode"
- Clarification: "to remember there is already an existing logic of save draft which save to
  the cookie policy db use it but no toast notification is needed in this case i mean autosave
  that you mentioned"
- Clarifying answers: Return step → "Just preserve my edits"; Invalid on exit → "Block & show
  errors".

## Tasks
1. Make the toast optional: change `saveCurrent()` → `saveCurrent({ silent = false } = {})`
   and gate `setToast(...)` on `!silent` — files: `frontend/src/CookiePolicyPage.jsx` — satisfies: N/A (UX)
2. Add `handleBackToDashboard()` (silent save, navigate to `/home` only on clean save) —
   files: `frontend/src/CookiePolicyPage.jsx` — satisfies: N/A (UX)
3. Render the `.cp-topbar` + `.cp-back` button between `<Header>` and `.cp-shell` —
   files: `frontend/src/CookiePolicyPage.jsx` — satisfies: N/A (UX)
4. Add `.cp-topbar` styling — files: `frontend/src/signup.css` — satisfies: N/A (UX)

## Acceptance criteria
- [ ] A "← Back to Dashboard" button appears top-left, above the sidebar/main split, styled
      like the other outlined buttons (matches the screenshot).
- [ ] Clicking it on any of the 3 steps saves the current section to the DB (verified: reload
      the wizard and the edit is present) and navigates to `/home`.
- [ ] **No** success toast appears when leaving via this button (toast still appears for Save
      draft / Next / Previous).
- [ ] If the current section's Heading or Description is empty/invalid, clicking the button
      shows the inline errors and does **not** navigate.
- [ ] The button is disabled while a save is in progress.
- [ ] Consent/`_ga`-style behaviour is unaffected (this feature touches no consent path).
- [ ] `npm run build` and `npm run lint` pass in `frontend/`.

## Supporting documentation
- Screenshot: `Screenshot 2026-07-09 at 12.44.31 PM.png` (Back to Dashboard button above the
  Cookie Policy editor).
- Related plans: `cookie-policy-wizard-nav-autosave.md` (the Prev/Next autosave this reuses),
  `cookie-policy-preferences.md` (the effective-date save on the preferences tab).
- Code: `frontend/src/CookiePolicyPage.jsx` (`saveCurrent`, `goTo`, action buttons),
  `frontend/src/signup.css` (`.cp-btn`, `.cp-actions`).

## Notes / changelog
- 2026-07-09 — Plan drafted. Decisions: reuse `saveCurrent()` with a silent flag; preserve
  edits only (no step-index tracking → no backend change); block navigation on invalid section.
- 2026-07-09 — Implemented (frontend-only). `saveCurrent({ silent })` added; toast gated on
  `!silent`; `handleBackToDashboard()` navigates to `/home` only on clean save; `.cp-topbar`
  button rendered between `<Header>` and `.cp-shell`; `.cp-topbar` CSS added. Verified:
  `npm run lint` PASS, `npm run build` PASS. Smoke: N/A — no backend route changed. Synced
  `frontend/CLAUDE.md` (CookiePolicyPage line). Shipped to `main`.
