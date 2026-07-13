# Plan: "Last updated" reflects the policy's real edit time, not render time

- **Slug:** `last-updated-from-policy-timestamp`
- **Scope:** frontend + backend (single plan, stored in backend repo per plan-template)
- **Status:** implemented (awaiting user manual check → ship)

## Objective / feature request

The rendered policy's **"Last updated"** date currently uses **render-time**
(`todayISO()`) in both the backend export (`renderPolicyHtml`) and the frontend preview
(`PolicyDocument.jsx`). So it wrongly changes every time you Copy HTML / Send to a
teammate, even when the policy hasn't changed. It should show **when the policy content
was last edited or generated**.

## Specifications

- **Source of truth:** `cookie_policy.updatedAt` — a drizzle column with
  `.$onUpdate(() => new Date())`, so Postgres/Drizzle bumps it to *now* on **every**
  `UPDATE` of the row: `putSection` (section edit), `putPolicyMeta` (effective-date save /
  Generate), and the delete/reset. That is exactly "last edited or generated." **No schema
  change.** The export endpoints only SELECT (never UPDATE), so copying/sending the HTML
  does **not** bump it.
- **"Last updated"** everywhere the policy is rendered =
  `formatLongDate(updatedAt-as-YYYY-MM-DD)` (fallback to today only if somehow absent).
- **Effective date** is unchanged (user-chosen `content.effectiveDate`).
- **Parity:** the backend export and the frontend preview must show the **same** value, so
  both renderers change and both read the same `updatedAt`.
- **Response shape:** `GET …/cookie-policy` gains an **additive** `data.updatedAt` (ISO
  string) alongside `data.content` — backward compatible (existing readers use
  `data.content.*`).

## Requirement alignment

- **R4 (Preview — rendered as a real page)** and **R6 (Copy HTML matching the preview):**
  a correct policy page shows an accurate "Last updated" date; this makes the preview and
  the exported HTML truthful and consistent with each other.
- **Gap:** none — refinement of existing rendering; no behaviour removed.
- **Scope / out-of-scope:** in scope (generator polish). No consent/cookie surface → the
  `_ga`-release check **does not apply**.

## Design

### Backend
- **`getCookiePolicy`** (`controllers/cookiePolicy.controller.js`): select
  `updatedAt` too and return it — `ApiResponse(200, { content, updatedAt }, …)`. (ISO
  string in JSON.)
- **`buildPolicyHtml`**: add `updatedAt: cookiePolicy.updatedAt` to the policy-row select;
  compute `lastUpdated = row?.updatedAt ? new Date(row.updatedAt).toISOString().slice(0,10)
  : todayISO()` and pass it to `renderPolicyHtml`.
- **`renderPolicyHtml`** (`utils/policyHtml.js`): accept `lastUpdated` in the options
  object; the "Last updated" line becomes `formatLongDate(lastUpdated || todayISO())`.
  Effective line stays `formatLongDate(content.effectiveDate || todayISO())`.

### Frontend
- **`PolicyDocument.jsx`**: add a `lastUpdated` prop; render
  `Last updated: {formatLong((lastUpdated || '').slice(0,10) || todayISO())}`. The
  `.slice(0,10)` is required — `formatLong`'s regex matches only a bare `YYYY-MM-DD`, not a
  full ISO timestamp, so a raw `updatedAt` must be trimmed to its date first.
- **Consumers pass it** from the loaded policy:
  - `PolicyPreviewPage.jsx` — capture `data.updatedAt` from its load GET → pass to
    `PolicyDocument`.
  - `CookiePolicyPage.jsx` — capture `updatedAt` from `loadAll`'s GET into state → pass to
    `PolicyPreview` → `PolicyDocument`.
- **Wizard live preview (unsaved edits):** show the **last-saved** `updatedAt` (it only
  advances after an actual save). Showing "now" for unsaved edits would be misleading; the
  saved timestamp is the honest value. **Confirmed by the user:** the preview shows the
  last-updated date (never "now"), and after each save it shows that save's date.

### Smoke (`scripts/smoke.js`)
- Assert `GET …/cookie-policy` returns a `data.updatedAt` that parses as a date.
- Assert it **advances** after a `putSection` (capture before/after; `after > before` or
  at least present + valid) — proves `$onUpdate` fires on edits.
- The HTML export already asserts a "Last updated" line is present; no exact-date assertion
  (date depends on wall clock).

## Design notes

- **`$onUpdate` is the whole trick** — no new column, no manual timestamping, no client
  input. Every existing save path already updates the row, so `updatedAt` is correct for
  free; the only bug was that the renderers ignored it and used `todayISO()`.
- **Export never bumps it:** `getCookiePolicyHtml` / `sendPolicyCode` only read, so "Last
  updated" is stable across copies/sends — exactly the reported fix.
- **Date, not timestamp:** we render a date ("July 13, 2026"), matching the existing UI, by
  slicing `updatedAt` to `YYYY-MM-DD` (UTC slice, consistent with `todayISO()`).
- **Parity preserved:** both renderers read the same `updatedAt` and format identically, so
  the preview and the exported/emailed HTML always agree.
- **Additive response field:** `data.updatedAt` is new but optional for consumers; nothing
  that reads `data.content` breaks.

## Prompts (instructions given to the AI)

> "`const updated = formatLongDate(todayISO())` — updated should be consistent with when
> was the last time I edited/generated the policy, not whenever I click to send html or
> send to a teammate. create a plan for it."

## Tasks

1. `renderPolicyHtml`: accept `lastUpdated`, use it for the "Last updated" line — files:
   `backend/src/utils/policyHtml.js` — satisfies: R4/R6
2. `buildPolicyHtml`: select `updatedAt`, compute + pass `lastUpdated` — files:
   `backend/src/controllers/cookiePolicy.controller.js` — satisfies: R6
3. `getCookiePolicy`: return `data.updatedAt` (additive) — files:
   `backend/src/controllers/cookiePolicy.controller.js` — satisfies: R4
4. `PolicyDocument.jsx`: `lastUpdated` prop (slice→formatLong) — files:
   `frontend/src/PolicyDocument.jsx` — satisfies: R4/R6
5. Pass `lastUpdated` from `PolicyPreviewPage.jsx` and from `CookiePolicyPage.jsx` →
   `PolicyPreview` — files: `frontend/src/PolicyPreviewPage.jsx`,
   `frontend/src/CookiePolicyPage.jsx`, `frontend/src/PolicyPreview.jsx` — satisfies: R4
6. Smoke: `data.updatedAt` present + advances after a section save — files:
   `backend/scripts/smoke.js`
7. Sync docs (`sync-claude-md`): note GET returns `updatedAt` and "Last updated" derives
   from it — at ship time.

## Acceptance criteria

- [ ] "Last updated" in the preview (modal + preview page) and in the exported/emailed HTML
      shows the policy's **last edit/generate date**, not today's date.
- [ ] Copying the HTML or sending it to a teammate multiple times does **not** change "Last
      updated" (no row UPDATE on those paths).
- [ ] Editing a section (Next / Save draft) or Generating advances "Last updated" to that
      day; a later export reflects it.
- [ ] Preview and exported HTML show the **same** "Last updated" value (parity).
- [ ] `GET …/cookie-policy` returns `data.updatedAt`; `data.content` is unchanged.
- [ ] `npm run build` + `npm run lint` pass (frontend); backend boots; `npm run smoke`
      passes incl. the `updatedAt` checks.
- [ ] N/A — no consent/cookie surface touched, so the `_ga`-release check does not apply.

## Supporting documentation

- Backend: `models/cookie_policy.js` (`updatedAt` `$onUpdate`), `utils/policyHtml.js`
  (`renderPolicyHtml`, `todayISO`, `formatLongDate`), `controllers/cookiePolicy.controller.js`
  (`getCookiePolicy`, `buildPolicyHtml`).
- Frontend: `PolicyDocument.jsx` (the "Last updated" line), `PolicyPreview.jsx`,
  `PolicyPreviewPage.jsx`, `CookiePolicyPage.jsx` (load GET), `dateUtils.js` (`formatLong`).
- Related plans: `add-policy-to-site-html-format.md`, `preview-cookie-policy.md`,
  `generate-cookie-policy.md`.

## Notes / changelog

- Draft. Awaiting manual review/approval. Backend + frontend; no schema change; additive
  response field. Per plan-template, this doc ships **with** the feature at ship time.
- **Implemented (2026-07-13):** Backend — `renderPolicyHtml` takes `lastUpdated` (Last-updated
  line uses it, fallback today); `buildPolicyHtml` selects `cookiePolicy.updatedAt`, passes
  `lastUpdated = updatedAt.slice(0,10)`; `getCookiePolicy` returns additive `data.updatedAt`;
  imported `todayISO`. Frontend — `PolicyDocument` gains `lastUpdated` prop (sliced →
  `formatLong`, fallback today); `PolicyPreviewPage`, `PolicyPreview`, and `CookiePolicyPage`
  (loadAll) capture/pass `data.updatedAt`. `smoke.js` — +2 checks (GET returns updatedAt ISO;
  advances after a section save). **Verification:** frontend `build` + `lint` pass; backend
  syntax OK; container rebuilt; `npm run smoke` = **69 passed, 0 failed** (updatedAt present +
  advances). No schema change; `data.updatedAt` additive so `data.content` readers unaffected.
