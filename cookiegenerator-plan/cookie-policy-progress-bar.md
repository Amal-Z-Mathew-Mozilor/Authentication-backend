# Plan: Cookie policy progress bar (sidebar "% complete")

> On approval, this plan is saved verbatim to
> `backend/cookiegenerator-plan/cookie-policy-progress-bar.md` (per
> `plan-template`) and committed together with the feature at ship time.

- **Slug:** cookie-policy-progress-bar
- **Scope:** frontend + backend (single plan, stored in backend repo)
- **Status:** implemented (awaiting user manual check → ship)

## Context

Assignment **§2.3 Progress tracking** requires showing the user which step
they're on and which steps are complete (3-step: About cookies → Use of cookies
→ Cookie preferences), moving back/forth without losing data, and saving a
draft to resume later. The editor already satisfies the last two (Previous/Next
auto-save + section state; drafts persist server-side), and the sidebar
highlights the current step — what's missing is the *completion* indicator.
CookieYes shows it as a block at the bottom of the sidebar: "N% complete"
text and a progress bar. (The round cookie badge in the screenshot is a
separate plugin/widget — explicitly out of scope.) Per the reference screenshot,
this block sits **below** the "Preview cookie policy" button (which shifts up
to make room).

## Objective / feature request

Add a progress block under the Preview button in the Cookie Policy sidebar:
"N% complete" label and a filled progress bar reflecting
how many of the 3 sections the user has completed. Progress must persist across
reload/resume.

## Specifications

- **Completion definition:** a section is complete once it has been
  successfully saved via `PUT /pulse/websites/:id/cookie-policy/:section`
  (Save draft / Previous / Next / Back-to-Dashboard all route through the same
  save). The frontend already blocks empty heading/description before saving,
  so a saved section is a genuinely filled one.
- **Persistence:** the backend marks completion automatically on section save —
  `content.completedSections` (array of section keys, deduped) stored inside
  the existing `content` jsonb (sibling keys are explicitly supported; no
  migration). `GET …/cookie-policy` therefore returns it with no API-shape
  change. Clients cannot set it directly; it is server-derived.
- **Percent (position-based):** the bar follows the CURRENT wizard step, so it
  moves back on Previous and forward on Next: About cookies → 0%, Use of
  cookies → 40%, Cookie preferences → 80%. **100% is reserved for the future
  "Generate cookie policy" step** (it will add a `generated` flag to `content`).
  The backend still persists `content.completedSections` on every section save
  (server-derived save record — smoke-tested, and the future Generate step will
  gate on it), but the displayed % is driven by position, per user review.
- **Sidebar UI (bottom of `<aside>`, in order):** Preview cookie policy button
  (moves up — no longer the last element), then the progress block:
  `N% complete` text and a rounded progress bar (grey track, `--accent` fill, width = percent, subtle width
  transition). Live-updates the moment a save succeeds.
- No new endpoints; no request-body changes.

## Requirement alignment

- **§2.3 Progress tracking:**
  - "show which step they're on / which are complete" → current-step highlight
    already exists (`.cp-side-item.active`); the % bar adds the completion
    signal. **Satisfied.**
  - "move back and forth without losing data" → already satisfied
    (Previous/Next auto-save; per-section state kept in `data`). Unchanged.
  - "save as draft and resume later" → already satisfied (server-side drafts);
    `completedSections` now also survives resume. **Strengthened.**
- Core principle (CMP creates no cookies): untouched — pure UI + a derived
  jsonb field.
- R1–R8: not touched.

## Design

### Backend (2 small changes + docs)

1. **`backend/src/controllers/cookiePolicy.controller.js` — `putSection`:**
   when merging, also set
   `completedSections: [...new Set([...(existing?.content?.completedSections || []), section])]`
   in the new `content` (both the insert-new-row and update branches).
   `putPolicyMeta` needs no change (its merge spreads existing content, so the
   array is preserved).
2. **`backend/scripts/smoke.js`:** extend the existing cookie-policy block —
   after the 3 section PUTs + re-GET (persist pattern at lines ~197–213),
   assert `content.completedSections` contains all 3 keys; also assert it is
   absent/empty on a freshly created website.
3. **`backend/openapi.yaml`:** example-level updates only (no schema
   components involved): add `completedSections` to the GET `data.content`
   example (~line 689) and the PUT-section 200 response example (~line 814).
   Follow the `update-openapi` skill conventions.

### Frontend

4. **`frontend/src/CookiePolicyPage.jsx`:**
   - `const [completed, setCompleted] = useState([])`; hydrate in `loadAll`
     from `content.completedSections || []`.
   - In `saveCurrent`, on a successful section PUT, sync from the response
     (`resData.data.content.completedSections`) — the PUT already returns the
     merged content, so no extra request and no client-side guessing.
   - Sidebar: keep the Preview button (drop its `margin-top: auto` role), add
     below it a progress block:
     ```jsx
     <div className="cp-progress">
       <p className="cp-progress-label">{pct}% complete</p>
       <div className="cp-progress-track"><div className="cp-progress-fill" style={{ width: `${pct}%` }} /></div>
     </div>
     ```
     where `pct = Math.round(completed.filter(k => SECTIONS.some(s => s.sectionKey === k)).length / SECTIONS.length * 100)`.
5. **`frontend/src/signup.css`:** move the bottom-pinning: `.cp-progress { margin-top: auto; }`
   and change `.cp-preview-btn` to `margin-top: 18px` → button sits just above
   the progress block at the sidebar bottom (matches screenshot stacking).
   New classes: `.cp-progress-label` (16px, 600), `.cp-progress-track` (8px tall,
   full-width, `--border`-grey rounded) + `.cp-progress-fill` (`--accent`,
   `transition: width .25s`). Reuse existing tokens; `cp-` prefix convention.
6. **Docs:** `frontend/AI_DOCS/policy_progress.md`; `sync-claude-md` after
   implementation (frontend Structure/CookiePolicyPage line; backend endpoint
   note about `completedSections` in the GET content).

### Rejected alternatives (Design notes)

- **Infer completion from non-empty content** — impossible: all 3 sections are
  seeded with defaults at website creation
  (`website.controller.js` → `defaultCookieContent`), would always show 100%.
- **Client-sent `completedSections` in PUT body** — more API surface +
  validator work, and trusts the client; server-side auto-mark is 1 line.
- **Per-section `completed` flag inside each section object** — `putSection`
  rebuilds `sectionData = { heading, description }`, so flags there get
  dropped on rewrite; a top-level array avoids touching that merge.
- **New DB column** — unnecessary; `content` jsonb explicitly supports sibling
  keys (model comment, `cookie_policy.js:13-14`).
- Local-only (localStorage/state) progress — fails "resume later" (§2.3).

## Prompts (instructions given to the AI)

> "now i want to create a progress bar like in this image [sidebar: cookie
> badge, '40% complete', progress bar] which should come under preview cookie
> policy so preview cookie policy should be shifted to upwards and the
> condition for progress bar should be like in this image [assignment §2.3
> Progress tracking: show which step they're on and which steps are complete
> (3-step stepper); allow moving back and forth without losing entered data;
> allow saving an in-progress policy as a draft and resuming later]. create a
> plan for this in planmode"

## Tasks

1. Auto-mark saved sections in `putSection` — files:
   `backend/src/controllers/cookiePolicy.controller.js` — satisfies: 2.3
2. Extend smoke test for `completedSections` persistence — files:
   `backend/scripts/smoke.js` — satisfies: 2.3
3. Update OpenAPI examples — files: `backend/openapi.yaml`
4. Hydrate + sync `completed` state; add progress block to sidebar — files:
   `frontend/src/CookiePolicyPage.jsx` — satisfies: 2.3
5. Progress styles (+ re-pin bottom stack) — files: `frontend/src/signup.css`
   — satisfies: 2.3
6. Feature doc — files: `frontend/AI_DOCS/policy_progress.md`
7. Save this plan to
   `backend/cookiegenerator-plan/cookie-policy-progress-bar.md` (ships with
   the feature)

## Acceptance criteria

- [ ] Fresh website → sidebar shows "0% complete", empty bar; Preview button
      sits above the progress block at the sidebar bottom.
- [ ] Progress follows the current step: About → 0%, Use → 40%, Preferences
      → 80% (never 100% — reserved for the future Generate step). Next raises
      it, Previous lowers it back.
- [ ] Reload lands on About cookies → 0% (position-based); the saved-section
      record (`completedSections`) still persists server-side for the future
      Generate gate.
- [ ] Moving Previous/Next still preserves entered data (regression, §2.3).
- [ ] `GET …/cookie-policy` returns `content.completedSections`; smoke test
      green including the new assertions.
- [ ] Frontend build + lint pass; backend `node --check` on changed files.

## Supporting documentation

- Reference screenshots (user, 2026-07-09): sidebar progress block ("40%
  complete"); assignment §2.3 text.
- Prior related plan: `backend/cookiegenerator-plan/preview-cookie-policy.md`
  (Preview button this block slots under).
- Conventions: `frontend/CLAUDE.md`, `backend/CLAUDE.md`,
  `.claude/skills/plan-template/SKILL.md`, `update-openapi` skill.

## Notes / changelog

- 2026-07-09 — plan drafted (plan mode).
- 2026-07-09 — user review: removed the round cookie badge (it is a separate
  plugin/widget, not part of this feature) — progress block is text + bar only.
- 2026-07-09 — user review: percent scale changed to 0/33/67/80 — all-sections-
  saved shows 80%, and 100% is reserved for the future "Generate cookie policy"
  feature.
- 2026-07-09 — user review (final): scale is 0 / 40 / 80 by saved count
  (0 saved → 0%, 1 → 40%, 2+ → 80%); confirmed via Q&A.
- 2026-07-09 — user bug report during implementation: Previous must move the
  bar back → switched the displayed % to position-based (current step 0/40/80).
  Backend `completedSections` persistence retained (future Generate gate).
- 2026-07-09 — implemented + verified: frontend build PASS, lint PASS, backend
  `node --check` PASS, container rebuilt, regression smoke **42/42 PASS**
  (includes the 2 new completedSections assertions; this is the feature's
  single pre-manual-check smoke run — verify-and-ship should reuse it).

## Verification (how to test end-to-end)

1. `npm --prefix frontend run build && npm --prefix frontend run lint`;
   `node --check` changed backend files.
2. Boot backend (Postgres+Redis via `backend/compose.yaml`) and run
   `npm --prefix backend run smoke` in a subagent — must stay green including
   new `completedSections` assertions (this is the feature's single smoke run,
   done before the user's manual check; verify-and-ship reuses it).
3. Manual: create a website → open its cookie policy → 0%; save each section
   and watch the bar follow the steps (0/40/80), including going back on Previous.
