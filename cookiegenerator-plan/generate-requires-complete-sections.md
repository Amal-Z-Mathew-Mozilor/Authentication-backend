# Plan: Gate "Generate cookie policy" on all sections being complete

- **Slug:** `generate-requires-complete-sections`
- **Scope:** frontend only (single plan, stored in backend repo per plan-template)
- **Status:** implemented (awaiting user manual check → ship)

## Objective / feature request

In the cookie-policy wizard you can click sidebar sections to jump straight to the last
step and press **Generate cookie policy** even when another section (e.g. About cookies)
has an empty Heading or Description. Match real CookieYes: **disable the "Generate cookie
policy" button whenever any section has an empty required field.** Free navigation between
sections stays allowed — only the Generate action is gated.

## Specifications

- **Completeness rule:** a section (`aboutCookies`, `useOfCookies`, `cookiePreferences`) is
  **complete** when its Heading is non-empty (`heading.trim()`) **and** its Description has
  visible text (`!descIsEmpty(description)`) — the same emptiness rule `saveCurrent` and the
  on-blur validation already use. Computed from the **live `data` state** (all three
  sections), so it reflects unsaved edits regardless of which tab you're on.
- **Gate:** the **Generate cookie policy** button is `disabled` when **any** section is
  incomplete (in addition to the existing `saving` disable). A short **hint/tooltip**
  explains why and names the incomplete section(s) (e.g. "Complete all sections to
  generate: About cookies, Use of cookies").
- **Navigation unchanged:** sidebar switching (`switchSection`) still lets you move freely
  between sections without saving/blocking — we do **not** block jumping away from an empty
  section (CookieYes allows this; it only disables Generate).
- **Persist-all on Generate (correctness companion):** because `switchSection` does not
  persist edits and `handleGenerate` currently saves only the **current** section,
  generating can produce a policy that omits unsaved edits made to other sections via
  sidebar jumps. So on Generate, **save every section** (PUT each via the existing
  `/cookie-policy/:section` endpoint) before stamping `generated: true` and navigating to
  the preview. The button is enabled only when all sections are complete, so each save
  passes the backend validator.
- **Out of scope:** the effective-date picker (not a required section field); backend/API
  (uses existing endpoints only).

## Requirement alignment

- **R7 (in-product policy configuration/generation):** ensures the *generated* artifact is
  actually complete before it can be produced — a correctness gate on the generator UX.
- **Gap:** none introduced. This tightens an existing flow; the backend still validates each
  section save (max-length) and still permits empty sections for *partial drafts* (the gate
  is a wizard-flow UX rule for the final Generate action, not a new server constraint).
- **Core-principle check (does NOT apply):** button-enablement + save orchestration only;
  sets/blocks/releases no cookie, touches no consent/banner/gatekeeper surface. The
  `_ga`-release check **does not apply** — noted so a reviewer doesn't expect it.

## Design

Frontend-only, all in `frontend/src/CookiePolicyPage.jsx` (reuses existing endpoints,
state, and the `descIsEmpty`/`EMPTY_MSG` helpers already added).

1. **Completeness derivation** (component body, from `data` + `SECTIONS`):
   ```js
   const isSectionComplete = (s) =>
     data[s.sectionKey].heading.trim() && !descIsEmpty(data[s.sectionKey].description)
   const incompleteSections = SECTIONS.filter((s) => s.active && !isSectionComplete(s))
   const canGenerate = incompleteSections.length === 0
   ```
2. **Gate the button** (`:567`): `disabled={saving || !canGenerate}`, plus a `title`
   (tooltip) when disabled naming the incomplete section labels. Add a small muted hint line
   near the button (only when `!canGenerate`) listing the incomplete section label(s), so
   the reason is visible, not just a greyed-out button.
3. **Persist all sections on Generate** — replace `handleGenerate`'s single-section save
   with a save-all:
   - Add `saveAllSections()` that PUTs each `SECTIONS[i]` with its `data[sectionKey]`
     `{ heading, description, usedImageIds: collectUsedImageIds() }`; on any `401/403`
     redirect to `/login`; on any non-OK, set the banner and return false. On success,
     the current section's completion is already implied.
   - `handleGenerate`: guard `if (!canGenerate) return`; `await saveAllSections()`; if ok,
     PUT the base meta `{ effectiveDate: effectiveDate || todayISO(), usedImageIds,
     generated: true }` (as today) → navigate to the preview with `justGenerated`.
   - Keep `saving` true across the whole sequence so the button shows progress and can't be
     double-clicked.
4. **No CSS beyond a muted hint** — reuse existing text styles (e.g. a `.cp-hint`/muted
   span; add a tiny rule only if none fits).

## Design notes

- **Gate on live `data`, not saved state.** Completeness is judged from what's in the
  editor across all sections, so emptying About on its tab immediately disables Generate on
  the preferences tab — even though About was never saved. This is exactly the reported
  scenario.
- **Why also save-all on Generate.** The disable-gate alone would still let a *complete*
  (in `data`) but *unsaved* section (edited then sidebar-jumped) generate a policy missing
  that edit, because `handleGenerate` saved only the current section and the preview reads
  the DB. Saving every section on Generate makes the generated/preview policy match the
  editor. Safe because the gate guarantees all sections are non-empty (validator passes).
- **Navigation stays free.** We deliberately do not make `switchSection` save or block —
  CookieYes lets you roam incomplete sections; only Generate is gated. This also avoids
  interfering with the existing on-blur/erase validation and the Prev/Next `goTo` (which
  still saves the current section).
- **Hint over silent disable.** A greyed button with no explanation is confusing; naming the
  incomplete section(s) tells the user what to fix. Matches CookieYes' intent.
- **Partial-save risk on Generate.** Save-all is a sequence of PUTs; if one fails mid-way the
  earlier ones persisted. Acceptable — same risk profile as any multi-step save; on failure
  we surface the banner and do NOT mark generated or navigate, so the user can retry.

## Prompts (instructions given to the AI)

> "another bug: suppose i edit About cookies and now it is empty and go directly to Cookie
> preferences by clicking sections, i can generate policy even though my above field is
> empty. in CookieYes it's handled by disabling the Generate policy button if any section
> field is empty. You can edit and go directly to Generate — that's ok; the problem is when
> one field is empty. create a plan for it in plan mode."

## Tasks

1. Derive `isSectionComplete`/`incompleteSections`/`canGenerate` from `data` + `SECTIONS`
   — files: `frontend/src/CookiePolicyPage.jsx` — satisfies: R7
2. Gate the Generate button (`disabled={saving || !canGenerate}` + tooltip) and add a muted
   hint naming incomplete section(s) when disabled — files: `frontend/src/CookiePolicyPage.jsx` — satisfies: R7
3. Add `saveAllSections()` and rewire `handleGenerate` to save all sections → meta
   `generated:true` → navigate; guard on `canGenerate` — files: `frontend/src/CookiePolicyPage.jsx` — satisfies: R7
4. Minimal CSS for the hint if no existing muted-text class fits — files: `frontend/src/signup.css`
5. Sync docs (`sync-claude-md`) — the `CookiePolicyPage` line (Generate gated on all
   sections complete; saves all sections on generate) — at ship time.

## Acceptance criteria

- [ ] With any section's Heading or Description empty (in the editor), the **Generate cookie
      policy** button is **disabled**, with a hint/tooltip naming the incomplete section(s).
- [ ] Filling every section's Heading + Description enables the button; emptying any one
      disables it again immediately (reacts to live edits, any tab).
- [ ] Sidebar section switching is still free (not blocked, not forced to save) — you can
      jump to the last step with an incomplete section; only Generate is gated.
- [ ] Clicking Generate (when enabled) persists **all** sections, then marks the policy
      generated and navigates to the preview; the preview reflects edits made to sections
      that were only visited via sidebar jumps (no lost edits).
- [ ] Prev/Next/Save draft/Back-to-Dashboard behave as before.
- [ ] `npm run build` + `npm run lint` pass in `frontend/`.
- [ ] N/A — no consent/cookie surface touched, so the `_ga`-release check does not apply.

## Supporting documentation

- Files: `frontend/src/CookiePolicyPage.jsx` — `switchSection` (`:180`, no-save jump),
  `saveCurrent` empty rule (`:201`), `handleGenerate` (`:296`, saves current only), sidebar
  map (`:342`), Generate button (`:567`); `descIsEmpty`/`EMPTY_MSG` (top of file).
- Endpoints reused: `PUT /pulse/websites/:id/cookie-policy/:section` and
  `PUT /pulse/websites/:id/cookie-policy` (base, `generated:true`) — see `backend/openapi.yaml`.
- Predecessor: `cookiegenerator-plan/cookie-policy-blur-validation.md` (the required-field
  validation this builds on) and `generate-cookie-policy.md`.

## Notes / changelog

- Draft. Awaiting manual review/approval. Frontend-only; existing endpoints; no backend/API
  or smoke change. Per plan-template, this doc ships **with** the feature at ship time.
- **Implemented (2026-07-10):** `CookiePolicyPage.jsx` — added `isSectionComplete` /
  `incompleteSections` / `canGenerate` (live `data`), gated the Generate button
  (`disabled={saving || !canGenerate}` + tooltip naming incomplete sections) with a
  right-aligned `.cp-generate-hint` above the footer; added `saveAllSections()` and rewrote
  `handleGenerate` to persist every section → base-meta `generated:true` → navigate (guards
  on `canGenerate`, `setSaving` across the sequence, banner on failure). Removed the now-dead
  `generate` param from `saveCurrent` (its `generated:true` responsibility moved into
  `handleGenerate`); ordinary preferences-tab autosaves still persist the effective date.
  `signup.css` — added `.cp-generate-hint`. **Verification:** frontend `npm run build` +
  `npm run lint` pass (pre-existing chunk-size warning only). No backend change → no smoke
  run; the reused prior backend smoke is **58/0**. Behavioural check (button disables when a
  section is empty; generate persists all sections) left for the user's manual check.
