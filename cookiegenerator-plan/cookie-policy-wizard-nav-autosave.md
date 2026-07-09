# Plan: Cookie Policy — Previous/Next wizard nav with auto-save + success toast

- **Slug:** cookie-policy-wizard-nav-autosave
- **Scope:** frontend only (backend unchanged; single plan stored in backend repo per convention)
- **Status:** implemented

## Objective / feature request

Add **Previous** and **Next** buttons to the cookie-policy editor's action row (alongside
the existing **Save draft** button). Clicking **Previous** or **Next** first **auto-saves
the current section**, then moves to the adjacent section. On a successful save, show a
green **"Draft saved successfully!"** toast (top-right) that auto-dismisses after a few
seconds — matching the provided screenshots.

## Specifications

**Action row layout** (screenshot 1): `Previous` on the far left (outlined, left chevron
`‹`); `Save draft` (outlined) + `Next` (primary/blue, right chevron `›`) grouped on the far
right.

**Section order** = the existing `SECTIONS` order: `about → use → preferences`.
- On the **first** section, `Previous` is **disabled**. On the **last** section, `Next` is
  **disabled**. (Disabled, not hidden — keeps the row layout stable.)

**Auto-save on navigation:**
- Clicking `Previous`/`Next` runs the **same save** as `Save draft` (validate → `PUT
  /cookie-policy/:section` with `{ heading, description, usedImageIds }`; on the preferences
  tab also `PUT /cookie-policy` with `{ effectiveDate, usedImageIds }`).
- If the save **succeeds** → show the success toast **and** switch to the target section.
- If validation **fails** (empty heading/description) or the request errors → **do not
  navigate**; show the field errors / banner exactly as `Save draft` does today (no toast).
- `Save draft` itself now also shows the success toast on success (replacing the inline
  "Saved ✓" text) so every successful save gives the same confirmation.

**Toast** (screenshot 2): green success toast, **top-right**, text **"Draft saved
successfully!"**, check-circle icon, auto-dismisses after **~4s** (matches the app's
existing toast convention) and is click-to-dismiss. Reuses the established toast pattern
(`toast` state + `useEffect`/`setTimeout` + `role="alert"`).

**Backend:** **no change.** Reuses the existing cookie-policy PUT endpoints and the
`usedImageIds` cleanup contract. `openapi.yaml` / `smoke.js` unaffected.

## Requirement alignment

Maps to **R7 (automatic config updates)** — the cookie-policy editor is the surface where
banner/category configuration is authored without touching developer code; a guided
Previous/Next flow with auto-save-on-navigation and clear save feedback makes that config
editing smoother and less error-prone. It is primarily a **UX enhancement** of the already-
shipped cookie-policy editor (see the section plans), not a new compliance capability.

Does **not** violate the core principle (frontend-only UX; sets no cookies). **Bonus:** the
auto-save-on-navigation is the mechanism anticipated in
`cookie-policy-orphan-image-cleanup.md` — persisting each section on navigation keeps the DB
copy of sibling sections current, hardening the image-cleanup sweep (the `usedImageIds`
union remains the primary guard, so no behaviour regresses).

**Gaps:** the terminal **"Generate cookie policy"** action (publishing the policy) is still
not built — on the last section `Next` is disabled rather than becoming a Generate button;
that publish step (closer to R8) is out of scope here and noted as future work. Auto-save
enforces the **same required-field validation** as Save draft, so navigation is blocked
when the current section is empty (a deliberate choice — the backend validator also requires
non-empty heading/description; allowing truly partial drafts is a larger, separate change).

## Design

Frontend only — all in `frontend/src/CookiePolicyPage.jsx` (+ toast styles in `signup.css`).

**`CookiePolicyPage.jsx`**
- Compute the current index: `const idx = SECTIONS.findIndex((s) => s.key === active)`.
  `prevKey = SECTIONS[idx - 1]?.key`, `nextKey = SECTIONS[idx + 1]?.key`.
- **Extract save into `saveCurrent()` → `Promise<boolean>`**: move the current `handleSave`
  body into it; return `false` on validation failure / non-OK response (after setting
  errors/banner as today), `true` on full success. On success set the toast instead of the
  `saved` flag.
- `handleSave()` (Save draft button) = `await saveCurrent()` (toast shown inside; no nav).
- `goTo(key)` = `if (!key) return; const ok = await saveCurrent(); if (ok) switchSection(key)`.
  Wire `Previous → goTo(prevKey)`, `Next → goTo(nextKey)`.
- **Toast state** (reuse the app pattern from `ForgotPasswordPage`/`SignupPage`):
  `const [toast, setToast] = useState(null)` + `useEffect(() => { if (!toast) return; const t
  = setTimeout(() => setToast(null), 4000); return () => clearTimeout(t) }, [toast])`. On
  successful save: `setToast({ message: 'Draft saved successfully!' })`.
- Render the toast at the page root: `<div className="toast toast-success" role="alert"
  onClick={() => setToast(null)}><span className="toast-icon">✓</span><span>{toast.message}
  </span></div>` (inline check SVG or a ✓ glyph, consistent with existing `toast-icon`).
- Rework `.cp-actions`: `Previous` button (disabled when `idx===0`), then a right-aligned
  group (`margin-left:auto`) with `Save draft` + `Next` (disabled when `idx===SECTIONS.length-1`).
  Buttons reuse `.submit` / a secondary button style; inline chevron SVGs (no icon package).
- Remove the inline `saved`/`cp-saved` "Saved ✓" affordance (superseded by the toast); drop
  the now-unused `saved` state.

**`signup.css`**
- Add a **success/right** toast variant without disturbing the existing (red, centered)
  error toast: `.toast.toast-success { left: auto; right: 22px; transform: none; border-left-
  color: var(--ok); animation: toast-in-right .25s ease }` and `.toast-success .toast-icon
  { background: var(--ok) }`, plus a `@keyframes toast-in-right` (fade + small slide-down, no
  `-50%` translate). Adjust `.cp-actions` to `justify-content` / use a spacer so Previous sits
  left and Save draft + Next sit right.

## Design notes
- **Reuse the existing toast**, don't invent a new one: the base `.toast` + `toast-icon` +
  auto-dismiss `useEffect` pattern already exists (ForgotPassword/Signup/Home). We only add a
  green, right-anchored *variant* so the current centered red error toast is untouched.
- **Disable rather than hide** Previous/Next at the ends — stable layout, and the affordance
  stays visible (greyed) so the wizard boundaries are obvious.
- **Validation parity with Save draft** (block nav on empty) is intentional; the backend
  validator enforces non-empty too, so a "move on with an empty section" flow would need
  backend changes and is deliberately out of scope.
- **Sidebar section clicks keep their current behaviour** (plain switch, no auto-save) to
  keep this change focused on the requested Prev/Next. Could be unified to auto-save later.
- **~4s auto-dismiss** matches the app's existing toasts (`setTimeout(…, 4000)`); toast is
  also click-to-dismiss. `role="alert"` for a11y.
- **No backend/API/doc/smoke changes** — reuses `PUT /cookie-policy/:section` and
  `PUT /cookie-policy` and the `usedImageIds` contract exactly as shipped.

## Prompts (instructions given to the AI)
> "now i want a previous and next button along with save draft button as in the image
> [screenshot: Previous | Save draft · Next] and when i click prev or next it should
> automatically save current page and show a toast notification like in the image
> [screenshot: green 'Draft saved successfully!' toast] … which will come and expire in n
> seconds create a plan for it"

Earlier related context: the user flagged auto-save-on-navigation as a planned follow-up
while designing `cookie-policy-orphan-image-cleanup.md`; this feature delivers it.

## Tasks
1. Extract `saveCurrent(): Promise<boolean>` from `handleSave` (validate → PUT section
   [+ effectiveDate on preferences] → return success); keep `handleSave` calling it. — files:
   `frontend/src/CookiePolicyPage.jsx` — satisfies: R7
2. Add toast state + auto-dismiss `useEffect`; on successful save `setToast({ message:
   'Draft saved successfully!' })`; remove the `saved`/`cp-saved` inline text. — files:
   `frontend/src/CookiePolicyPage.jsx` — satisfies: R7
3. Add `Previous`/`Next` buttons with index-based enable/disable + `goTo(key)` that
   auto-saves then switches; lay out Previous-left / Save draft + Next-right. — files:
   `frontend/src/CookiePolicyPage.jsx` — satisfies: R7
4. Add the green top-right `.toast.toast-success` variant (+ `toast-in-right` keyframe) and
   update `.cp-actions` layout. — files: `frontend/src/signup.css` — satisfies: R7

## Acceptance criteria
- [ ] Action row shows Previous (left) and Save draft + Next (right), matching screenshot 1.
- [ ] Previous is disabled on the first section; Next is disabled on the last section.
- [ ] Clicking Next on a valid section saves it, shows the green toast, and advances to the
      next section; Previous does the same in reverse.
- [ ] Clicking Next/Previous on an **invalid** (empty) section shows the field error and does
      **not** navigate or toast.
- [ ] Save draft shows the same green "Draft saved successfully!" toast on success.
- [ ] The toast appears top-right and auto-dismisses after ~4s (and on click), matching
      screenshot 2; it does not alter the existing red error toast elsewhere.
- [ ] Section content actually persists across Prev/Next (reload shows saved values) —
      confirms auto-save wrote to the backend.
- [ ] Verification: frontend `build` + `lint` clean; manual: edit About → Next → toast +
      lands on Use of cookies → reload → About persisted; empty section → Next blocked.

## Supporting documentation
- Screenshots: (1) action row `Previous | Save draft · Next`; (2) green "Draft saved
  successfully!" toast (top-right).
- Reuses: existing toast pattern (`ForgotPasswordPage.jsx`/`SignupPage.jsx`, `.toast`/
  `.toast-icon`/`toast-in` in `signup.css`), `CookiePolicyPage.jsx` `handleSave`/`switchSection`,
  `apiFetch`, `SECTIONS`.
- Related plans: `cookie-policy-orphan-image-cleanup.md` (auto-save hardens its sweep),
  `cookie-policy-preferences.md`, `cookie-policy-about-cookies.md`, `cookie-policy-use-of-cookies.md`.
- Skills: `plan-template`, `verify-and-ship`, `sync-claude-md`.

## Notes / changelog
- _draft_ — planned via PLAN mode; `plan-template` conformed. Frontend-only; reuses existing
  PUT endpoints and toast pattern; adds a green top-right toast variant. Open decisions
  recorded: disable (not hide) Prev/Next at ends; validation parity with Save draft blocks
  nav on empty; sidebar clicks unchanged; Next disabled (not "Generate") on the last step.
  Awaiting review → "implement the plan" → manual check → `verify-and-ship`.
- _implemented_ — frontend only, all in `CookiePolicyPage.jsx` + `signup.css`. Extracted
  `saveCurrent(): Promise<boolean>` (shared by Save draft and Prev/Next); added toast state +
  ~4s auto-dismiss `useEffect`; `Previous`/`Next` with index-based disable and `goTo(key)`
  (auto-save then switch only if it saved); green top-right `.toast.toast-success` variant +
  `toast-in-right` keyframe; removed the old `saved`/`cp-saved` "Saved ✓" affordance and its
  `setSaved` callers. Verified: frontend `build` + `lint` clean. No backend/API/smoke changes.
  Awaiting user's manual check → ship.
