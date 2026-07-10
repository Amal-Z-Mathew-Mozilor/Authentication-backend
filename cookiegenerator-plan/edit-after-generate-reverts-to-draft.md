# Plan: Editing a generated policy (with save) reverts it to draft

- **Slug:** `edit-after-generate-reverts-to-draft`
- **Scope:** frontend + backend (single plan, stored in backend repo per plan-template) —
  **backend-only code change**; no frontend change needed.
- **Status:** implemented (awaiting user manual check → ship)

## Objective / feature request

After a cookie policy is **generated** (`content.generatedAt` set), clicking **"Cookie
policy"** on the dashboard opens the read-only **preview** page. But once the user edits
the policy **and saves** that edit, the policy should revert to **not generated**, so
clicking "Cookie policy" opens the **3-step wizard** again (it needs re-generation). If the
user edits but does **not** save (Back to Dashboard — which no longer autosaves), the
policy stays generated and the preview still shows.

## Specifications

- **Routing gate (already implemented, unchanged):** `WebManagerPage.openCookiePolicy`
  routes to `/cookie-policy/:id/preview` when `content.generatedAt` is set, else to the
  wizard `/cookie-policy/:id` (`WebManagerPage.jsx:56-59`).
- **New rule — a persisted edit un-generates the policy:**
  - **`PUT …/cookie-policy/:section`** (`putSection`) — saving any section removes
    `content.generatedAt`.
  - **`PUT …/cookie-policy`** (`putPolicyMeta`) — when `generated !== true` (a plain
    effective-date / meta autosave), remove `content.generatedAt`; when `generated ===
    true` (the explicit "Generate" action), stamp `content.generatedAt = now` (unchanged).
- **Compatibility with the Generate flow:** frontend `handleGenerate` first saves **all**
  sections (each `putSection` now clears `generatedAt`), then PUTs base meta with
  `generated: true` (which re-stamps it). Net final state: **generated**. So generating
  still lands on the preview.
- **Back to Dashboard:** does not save (per `back-to-dashboard-no-autosave`), so it never
  clears `generatedAt` → preview still shows after an unsaved edit. No change needed.
- **DELETE (reset):** already overwrites content with the default seed (no `generatedAt`) —
  unchanged.
- **Net effect:** the dashboard button shows the preview **only** when the currently-saved
  policy is exactly the generated one; any saved edit since generation sends the user back
  to the wizard to re-generate.

## Requirement alignment

- **R7 (in-product policy authoring/generation lifecycle):** keeps the "generated" state
  honest — it means "the saved content has been generated and not edited since", which is
  what the preview-vs-wizard routing depends on.
- **Gap:** none. Tightens the meaning of `generatedAt`; no requirement regressed.
- **Core-principle check (does NOT apply):** state-flag bookkeeping on the policy document;
  sets/blocks/releases no cookie, touches no consent/banner/gatekeeper surface. The
  `_ga`-release check **does not apply**.

## Design

**Backend only — `backend/src/controllers/cookiePolicy.controller.js`:**

1. **`putSection`** — after building the merged `content` (both the insert and update
   branches, or just before the write), `delete content.generatedAt`. A saved section edit
   means the policy no longer matches its generated snapshot. (The insert branch has no
   `generatedAt` anyway, but delete is harmless and keeps both branches uniform.)
2. **`putPolicyMeta`** — keep `genStamp = generated === true ? { generatedAt: now } : {}`;
   after building `content`, if `generated !== true` then `delete content.generatedAt`
   (a plain meta save un-generates). When `generated === true`, `genStamp` sets it.
3. No route, validator, model, or response-shape change; `content` remains the same jsonb
   with `generatedAt` simply absent after an edit-save.

**Frontend:** none — `WebManagerPage` already gates on `generatedAt`.

**Smoke (`backend/scripts/smoke.js`):** after the existing "generate stamps generatedAt"
assertion, add: PUT a section then GET → assert `content.generatedAt` is now **absent**;
and a non-generate base-meta PUT (effectiveDate only) then GET → assert still absent. This
locks in the new revert behaviour.

## Design notes

- **Why clear on `putSection` even during the Generate flow.** `handleGenerate` saves all
  sections *then* stamps generated, so an intermediate clear is immediately overwritten —
  the final GET shows generated. Verified against the `generate-requires-complete-sections`
  flow. This ordering is the reason the clear-on-save rule is safe.
- **Autosave = the trigger, matching the user's mental model.** The user said a saved
  Next / Save draft / autosave should revert to the wizard, while an unsaved
  Back-to-Dashboard should not. Since only saves hit `putSection`/`putPolicyMeta`, clearing
  there is exactly right; Back-to-Dashboard no longer saves, so it's untouched.
- **`generatedAt` now means "saved content == generated snapshot".** This is a stricter,
  more correct definition than "was ever generated". The preview page still renders saved
  content regardless; only the dashboard *routing* depends on the flag.
- **Server-derived, never client-set.** `generatedAt` continues to be set only by the
  server on `generated:true` and cleared only by the server on any other save — the client
  never sends it. Consistent with the existing convention.
- **No migration.** `generatedAt` is a jsonb key; removing it from `content` on save needs
  no schema change.

## Prompts (instructions given to the AI)

> "suppose I generated a policy then I go to edit policy; if I edited and go to home then
> clicked Cookie policy it renders the generated page — that's okay if no edit was done it
> should show the generated policy page. In the original app, if I clicked Edit policy and
> edited something and go back to home and then click Cookie policy it should go to the
> 3-step wizard. Actually if edited and directly go to dashboard, no problem; but if called
> Next and Save draft (autosave happens), that's when going home and going to Cookie policy
> should show the 3-step wizard. create a plan for it."

## Tasks

1. `putSection`: `delete content.generatedAt` on save — files:
   `backend/src/controllers/cookiePolicy.controller.js` — satisfies: R7
2. `putPolicyMeta`: when `generated !== true`, `delete content.generatedAt` — files:
   `backend/src/controllers/cookiePolicy.controller.js` — satisfies: R7
3. Extend `scripts/smoke.js`: after generate, a section PUT clears `generatedAt`; a
   non-generate meta PUT also clears it — files: `backend/scripts/smoke.js`
4. Sync docs (`sync-claude-md`) — backend Cookie Policy section: note that any save clears
   `generatedAt` (only the Generate action sets it) — at ship time.

## Acceptance criteria

- [ ] Generate a policy → dashboard "Cookie policy" opens the **preview** (unchanged).
- [ ] After generating, saving a section edit (Next / Save draft) → dashboard "Cookie
      policy" opens the **wizard** (generatedAt cleared).
- [ ] After generating, editing but leaving via **Back to Dashboard** (no save) → dashboard
      "Cookie policy" still opens the **preview** (generatedAt intact).
- [ ] Re-generating from the wizard sets `generatedAt` again → preview.
- [ ] Backend `npm run smoke` passes, including the new assertions (section PUT clears
      `generatedAt`; non-generate meta PUT clears it; generate re-sets it).
- [ ] N/A — no consent/cookie surface touched, so the `_ga`-release check does not apply.

## Supporting documentation

- Frontend gate: `frontend/src/WebManagerPage.jsx:46-65` (`openCookiePolicy`).
- Backend: `backend/src/controllers/cookiePolicy.controller.js` — `putSection`,
  `putPolicyMeta` (current `genStamp`), `deleteCookiePolicy` (already clears).
- Related plans: `generate-cookie-policy.md` (sets `generatedAt`),
  `view-or-generate-policy-gating.md` (the routing gate),
  `generate-requires-complete-sections.md` (Generate saves all sections),
  `back-to-dashboard-no-autosave.md` (Back to Dashboard no longer saves).

## Notes / changelog

- Draft. Awaiting manual review/approval. Backend-only code change (+ smoke); no frontend
  change. Per plan-template, this doc ships **with** the feature at ship time.
- **Implemented (2026-07-10):** `cookiePolicy.controller.js` — `putSection` now
  `delete content.generatedAt` on the merge branch (a saved section edit un-generates the
  policy); `putPolicyMeta` deletes `generatedAt` when `generated !== true` (plain meta save
  un-generates) while still stamping it on `generated === true`. `scripts/smoke.js` — added
  assertions: a post-generate section PUT clears `generatedAt`, and a non-generate meta PUT
  clears it (generate still re-stamps in between). **Verification:** backend syntax OK;
  container rebuilt; `npm run smoke` = **60 passed, 0 failed** (incl. the 2 new revert
  checks + the existing generate/delete generatedAt checks). No frontend change (the
  WebManager gate already routes on `generatedAt`). CLAUDE.md sync at ship time.
