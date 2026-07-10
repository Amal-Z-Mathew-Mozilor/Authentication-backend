# Plan: "Back to Dashboard" — leave without autosaving (no blocking)

- **Slug:** `back-to-dashboard-no-autosave`
- **Scope:** frontend only (single plan, stored in backend repo per plan-template)
- **Status:** implemented (awaiting user manual check → ship)

## Objective / feature request

The cookie-policy wizard's top **"Back to Dashboard"** button currently silently
auto-saves the current section and only navigates if it saved cleanly — so it **blocks**
leaving when a required field is empty/invalid. Change it to **just navigate to /home
immediately**, discarding unsaved edits. Returning re-loads the last-saved content from
the DB, so the pre-edit data is shown (acceptable/desired).

## Specifications

- Clicking **"Back to Dashboard"** navigates to `/home` **unconditionally** — no save, no
  validation, no error display, never blocked by an empty field.
- Unsaved edits to the current section are **discarded** (not persisted). On return to the
  wizard, `loadAll` fetches the DB's last-saved `content`, so the fields show whatever was
  previously saved (or the seed defaults).
- **Unchanged:** Previous/Next still auto-save the current section (`goTo` → `saveCurrent`);
  **Save draft** still saves; on-blur/erase required-field validation still fires while
  editing; the Generate gate is unaffected.

## Requirement alignment

- **R7 (in-product policy authoring UX):** a navigation/UX refinement to the editor — the
  dashboard is an escape hatch that shouldn't be gated by in-progress edits.
- **Gap:** none. Removes a client-side block; the backend already persists only explicit
  saves, so nothing about data integrity changes (the DB keeps its last saved state).
- **Core-principle check (does NOT apply):** navigation-only change; sets/blocks/releases
  no cookie, touches no consent/banner/gatekeeper surface. The `_ga`-release check **does
  not apply**.

## Design

Frontend-only, `frontend/src/CookiePolicyPage.jsx`:

1. **`handleBackToDashboard`** — replace the save-then-maybe-navigate body with a plain
   `navigate('/home')`. It no longer needs to be `async` and no longer calls `saveCurrent`.
   Update the comment to reflect "leave without saving; DB keeps the last-saved data".
2. **Remove the now-dead `silent` option from `saveCurrent`.** `silent` existed solely to
   suppress the success toast for the Back-to-Dashboard autosave; that was its only caller.
   Drop the `silent` param and the `if (!silent) setToast(...)` guard → `saveCurrent` always
   shows the "Draft saved successfully!" toast on a clean save (correct for its remaining
   callers, Save draft and Prev/Next, which already do). No other behaviour changes.
3. The button JSX (`onClick={handleBackToDashboard}`) is unchanged aside from the handler
   now being synchronous.

## Design notes

- **Discarding is intentional.** The user explicitly wants Back-to-Dashboard to be a
  no-save escape: the last-saved data lives in the DB, and returning should show that, not
  force a save of a half-edited/empty section. This also removes the confusing "can't leave
  because a field is empty" block.
- **No data loss beyond the current unsaved edits.** Only edits since the last save are
  dropped; everything previously saved (via Next/Save draft) is intact. Consistent with how
  sidebar navigation already discards unsaved edits.
- **`silent` cleanup** keeps `saveCurrent` honest — leaving a dead param invites future
  misuse. Its remaining callers already expect the toast.
- **`saving` state** isn't touched here — Back-to-Dashboard no longer sets it (it doesn't
  save), so there's no spinner/disabled flicker; navigation is instant.

## Prompts (instructions given to the AI)

> "the Back to Dashboard button: I want to remove autosave. If I go to dashboard and come
> back, the data before editing should be there. No need to block Go Back to Dashboard if a
> field is empty, because if I go back and come [back] the old data is already stored in the
> DB. create a plan for it."

## Tasks

1. Rewrite `handleBackToDashboard` to just `navigate('/home')` (sync; no save/validation)
   — files: `frontend/src/CookiePolicyPage.jsx` — satisfies: R7
2. Remove the dead `silent` param from `saveCurrent` (and the `if (!silent)` toast guard →
   always toast on clean save) — files: `frontend/src/CookiePolicyPage.jsx` — satisfies: R7
3. Sync docs (`sync-claude-md`) — the frontend `CookiePolicyPage` line (Back to Dashboard
   now leaves without saving) — at ship time.

## Acceptance criteria

- [ ] Clicking "Back to Dashboard" with an empty/invalid field navigates to /home
      immediately (no error, no block).
- [ ] Edits made since the last save are NOT persisted: returning to the wizard shows the
      last-saved DB content (or seed defaults), not the discarded edits.
- [ ] Previous/Next still auto-save; Save draft still saves and shows the toast; on-blur
      required-field validation and the Generate gate are unchanged.
- [ ] `npm run build` + `npm run lint` pass in `frontend/`.
- [ ] N/A — no consent/cookie surface touched, so the `_ga`-release check does not apply.

## Supporting documentation

- Files: `frontend/src/CookiePolicyPage.jsx` — `handleBackToDashboard` (currently
  `saveCurrent({silent:true})` + conditional navigate), `saveCurrent` (`silent` param + the
  `if (!silent) setToast` guard), the "Back to Dashboard" button in the top bar.
- Related: `cookiegenerator-plan/back-to-dashboard-button.md` (the button's original
  introduction), `cookie-policy-wizard-nav-autosave.md`.

## Notes / changelog

- Draft. Awaiting manual review/approval. Frontend-only; no backend/API/smoke change. Per
  plan-template, this doc ships **with** the feature at ship time.
- **Implemented (2026-07-10):** `CookiePolicyPage.jsx` — `handleBackToDashboard` now just
  `navigate('/home')` (synchronous, no save, no validation gate); removed the dead `silent`
  param from `saveCurrent` and its `if (!silent)` toast guard (Save draft / Prev-Next, the
  only remaining callers, always show the toast on a clean save). **Verification:** frontend
  `npm run build` + `npm run lint` pass (pre-existing chunk-size warning only). No backend
  change → no smoke run; reused prior backend smoke is **58/0**. Behavioural check
  (Back-to-Dashboard leaves instantly with an empty field; return shows last-saved DB data)
  left for the user's manual check.
