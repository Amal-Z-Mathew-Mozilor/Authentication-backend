# Plan: View-or-generate cookie-policy gating

- **Slug:** `view-or-generate-policy-gating`
- **Scope:** frontend + backend (single plan, stored in backend repo)
- **Status:** implemented (pending user manual check + ship)

## Objective / feature request

From the per-website **"Cookie policy"** button in the Web Manager list, route the
user smartly:

- If they have **already generated** the policy for that website → open the
  **generated policy page** (`/cookie-policy/:websiteId/preview`) — the same page
  reached by clicking "Generate cookie policy".
- If it's the **first time**, or the policy is **only partially done** (they left
  mid-wizard) → open the **wizard at the first step** (About cookies).

## Context

Today the "Cookie policy" button always navigates to the wizard
(`/cookie-policy/:websiteId`) regardless of prior progress. The blocker: there is
**no persisted "generated" marker** anywhere. A `cookie_policy` row always exists
(seeded at website creation; "delete" = reset to seed), and "Generate" today is
purely client-side navigation with no backend write. So we must persist the
generated signal and branch on it.

**Decision (confirmed with user):** "generated" = the user clicked the final
**Generate cookie policy** button. We store a server-set `generatedAt` timestamp
inside the policy `content` jsonb. Editing sections keeps it generated; deleting/
resetting the policy clears it (returns to wizard). This is unambiguous and matches
"if I already generated" — it does **not** conflate with merely saving all sections.

## Specifications

- **State marker:** new policy-level key `generatedAt` (ISO timestamp string) inside
  the existing `cookie_policy.content` jsonb. No schema migration (sibling key, same
  pattern as `effectiveDate` / `completedSections`).
- **Setting it:** the base-path `PUT /pulse/websites/:websiteId/cookie-policy`
  (`putPolicyMeta`) accepts an optional `generated: true` in the body. When truthy,
  the server sets `content.generatedAt = new Date().toISOString()` (server-derived
  time — never trust a client timestamp). When absent/false, `generatedAt` is left
  untouched (so the wizard's ordinary meta auto-saves don't mark it).
- **Reading it:** `GET /pulse/websites/:websiteId/cookie-policy` already returns the
  whole `content`, so `content.generatedAt` flows through with no GET change.
- **Reset clears it:** `DELETE` (reset) already overwrites `content` with
  `defaultCookieContent(today)`, which has no `generatedAt` → policy reverts to
  "not generated". No change needed; verify only.
- **Frontend gate:** the Web Manager "Cookie policy" button becomes async: fetch the
  policy, then navigate to `…/preview` if `content.generatedAt` is truthy, else to
  the wizard (`/cookie-policy/:websiteId`, which already mounts at the first step).

## Requirement alignment

This is **product UX for the existing cookie-policy generator**, not a direct
consent-mechanics requirement. Mapping to the assignment's R1–R8: **no direct R#**
— the R# checklist covers scanning/gatekeeper/banner/geo/recording (R1–R8), whereas
this feature is navigation state for the policy-document generator the project
already ships. **Core principle is not violated:** nothing here creates cookies;
`generatedAt` is a document-workflow flag only. Flagging this honestly as an
out-of-R# UX improvement rather than claiming false coverage.

## Design

### Backend (`backend/`)

1. **`src/controllers/cookiePolicy.controller.js` → `putPolicyMeta`** (lines
   125–161). Read `generated` from the body alongside `effectiveDate`. Build the
   merged `content` as today, and when `generated === true` add
   `generatedAt: new Date().toISOString()` to it (in both the insert and update
   branches). Everything else (image sweep, response envelope) stays identical.
   - The existing `effectiveDateValidator()` on the route only validates
     `effectiveDate`; the extra `generated` field passes through untouched, so no
     validator change is required.
2. **No new route, no schema change, no `deleteCookiePolicy` change** — reset already
   drops `content` (and thus `generatedAt`).

### Frontend (`frontend/`)

3. **`src/CookiePolicyPage.jsx` → mark generated on Generate.**
   - Give `saveCurrent` an option to flag generation, e.g. `saveCurrent({ generate })`.
     On the `preferences` tab, when `generate` is true, include `generated: true` in
     the existing base-path meta `PUT` body (the block at lines 226–247 that already
     sends `{ effectiveDate, usedImageIds }`).
   - `handleGenerate` (lines 279–282) calls `saveCurrent({ generate: true })`, then
     navigates to `…/preview` on success. `goTo`, `handleSave`, and
     `handleBackToDashboard` call `saveCurrent()` **without** the flag, so ordinary
     auto-saves never mark the policy generated.
   - The wizard already opens at the first step (`active` initial state `'about'`,
     line 67) — no change needed for the "partial → first step" requirement.

4. **`src/WebManagerPage.jsx` → gate the "Cookie policy" button** (lines 341–347).
   Replace the unconditional `onClick={() => navigate(`/cookie-policy/${w.id}`)}`
   with an async handler:
   - `GET /pulse/websites/${w.id}/cookie-policy` via the existing fetch pattern.
   - On `401`/`403` → `navigate('/login')` (match the file's existing auth handling).
   - If `data.content?.generatedAt` is truthy → `navigate(`/cookie-policy/${w.id}/preview`)`;
     otherwise → `navigate(`/cookie-policy/${w.id}`)`.
   - Add a lightweight per-row "opening…" guard (e.g. an `openingId` state) to disable
     the button during the fetch and prevent double navigation. On network error,
     fall back to the wizard so the button is never dead.

## Design notes

- **Why a `generatedAt` timestamp, not a boolean:** same cost, but a timestamp is
  also useful later (e.g. "last generated on …") and reads naturally in the jsonb
  next to `effectiveDate`. Truthiness is the gate; the exact value isn't parsed yet.
- **Why gate via an on-click fetch, not by enriching the websites list:** the list
  endpoint (`GET /pulse/websites`) returns only `{ id, name, url, createdAt }`.
  Enriching it with policy state would mean a join + response-shape change touching
  more code and the smoke test's list assertions. A single on-click `GET
  cookie-policy` (already an existing, owned, cheap endpoint) is the smaller,
  lower-risk change and the latency is a single request behind a button press.
- **Why not gate on `completedSections`:** it can't distinguish "saved all three
  sections" from "clicked Generate", and a freshly-seeded policy has full default
  text but no `completedSections`. `generatedAt` is the explicit user action.
- **Edit-after-generate stays generated:** editing sections calls `putSection`,
  which never touches `generatedAt`; the preview page's "Edit" → wizard → save flow
  therefore keeps the policy in the "generated" state, so returning to Web Manager
  still routes to the preview page. Correct.
- **Delete/reset → wizard:** matches the preview page's existing "Your cookie policy
  is deleted → Create new cookie policy" flow, which expects a fresh wizard.

## Prompts (instructions given to the AI)

> "now i want to do next task … if i add a website and done generate cookie policy
> (last button in the cookie preference) if i already generated when i again login
> and click policy it should go to the page that comes when we click generate policy
> button. if clicking for first time or i haven't generated policy (left after doing
> some steps) then go to the wizard steps (go to the first step). create a plan for
> it in plan mode."

Follow-up decision: gate on **clicked-Generate** (server-set `generatedAt`), not on
"all sections saved".

## Tasks

1. Backend: extend `putPolicyMeta` to accept `generated: true` and set
   server-derived `content.generatedAt` — files: `backend/src/controllers/cookiePolicy.controller.js` — satisfies: policy-generation UX (no direct R#).
2. Frontend: on the preferences tab, have `handleGenerate`/`saveCurrent` send
   `generated: true` in the meta PUT — files: `frontend/src/CookiePolicyPage.jsx`.
3. Frontend: make the Web Manager "Cookie policy" button fetch the policy and route
   to `…/preview` when `generatedAt` is set, else the wizard (with an opening guard +
   auth/error fallback) — files: `frontend/src/WebManagerPage.jsx`.
4. Docs: update `backend/openapi.yaml` (add optional `generated` to the meta PUT
   body; note `generatedAt` in the policy content) via the `update-openapi` skill;
   update `backend/CLAUDE.md` + `frontend/CLAUDE.md` via `sync-claude-md`.
5. Smoke: extend `backend/scripts/smoke.js` to assert that a meta PUT with
   `generated:true` causes GET cookie-policy to return `content.generatedAt`, and
   that DELETE (reset) clears it. Run the single smoke pass here.

## Acceptance criteria

- [ ] New website → click "Cookie policy" → opens the **wizard at the About step**
      (never the preview) — verified for a brand-new, never-touched website.
- [ ] Partially edit (save one/two sections, no Generate) → leave → click "Cookie
      policy" again → opens the **wizard at the About step** (not the preview).
- [ ] Complete the wizard and click **Generate cookie policy** → lands on the preview
      page, and `GET …/cookie-policy` now returns `content.generatedAt`.
- [ ] Log out / log back in (or just return to Web Manager) → click "Cookie policy"
      for that website → opens the **preview page** directly.
- [ ] Edit an already-generated policy (Edit → save a section) → return to Web
      Manager → click "Cookie policy" → still opens the **preview page**.
- [ ] Delete/reset the policy from the preview page → click "Cookie policy" → opens
      the **wizard at the About step** again.
- [ ] Backend smoke test passes (with the new `generatedAt` assertions).
- [ ] `npm run build` + `npm run lint` clean in `frontend/`; backend boots.
- [ ] No cookies are created by any of this (core-principle check: N/A — document
      workflow only).

## Supporting documentation

- Backend: `backend/CLAUDE.md` (Cookie Policy resource), `backend/openapi.yaml`.
- Frontend: `frontend/CLAUDE.md` (routes + endpoints tables).
- Related code: `PolicyPreviewPage.jsx` (the generated page), `CookiePolicyPage.jsx`
  (the wizard), `defaultCookiePolicy.js` (seed with no `generatedAt`).

## Notes / changelog

- draft — plan created; gating decision = clicked-Generate (`generatedAt`),
  confirmed with user. Not committed yet — ships with the feature per plan-template.
- implemented — all 5 tasks done:
  - Backend `putPolicyMeta` accepts `generated: true` → stamps server-derived
    `content.generatedAt`.
  - Frontend `CookiePolicyPage.handleGenerate` sends `generated: true`; ordinary
    auto-saves (Prev/Save/Back) do not.
  - Frontend `WebManagerPage` "Cookie policy" button fetches the policy and routes
    to preview when `generatedAt` is set, else the wizard (with opening guard +
    wizard fallback on error).
  - Docs: `openapi.yaml` (meta PUT `generated` body + `generatedAt` in content),
    `backend/CLAUDE.md`, `frontend/CLAUDE.md`.
  - Smoke: extended `scripts/smoke.js` with generatedAt set/clear assertions.
- Verification (single pass, done pre-manual-check): backend rebuilt in Docker;
  **smoke = 52 passed, 0 failed** (incl. "not generated before Generate",
  "generate stamps content.generatedAt", "delete clears generatedAt"). Frontend
  `npm run lint` clean + `npm run build` succeeds. OpenAPI parses (only pre-existing
  redocly style errors remain). `verify-and-ship` may reuse this smoke result.
