# Plan: Policy actions menu (3-dots → Edit / Delete policy) on the preview page

> On approval, this plan is saved verbatim to
> `backend/cookiegenerator-plan/policy-actions-menu.md` (per `plan-template`) and
> committed together with the feature at ship time — never separately.

- **Slug:** policy-actions-menu
- **Scope:** frontend + backend (single plan, stored in backend repo)
- **Status:** implemented

## Context

The Policy Preview page (`/cookie-policy/:websiteId/preview`, from
`generate-cookie-policy.md`) ends the wizard with a "Policy preview" header
carrying a green **Add policy to site** button and a **3-dots (kebab)** button —
both currently **disabled** placeholders. This feature wires up the kebab: it
opens a small menu with **Edit policy** and **Delete policy**, and implements the
delete flow (confirm dialog → success dialog with restart options). CookieYes
shows exactly this: kebab → Edit / Delete, a red "Are you sure…" confirmation,
then a "Your cookie policy is deleted" screen offering **Back to Dashboard** and
**Create new cookie policy**. ("Add policy to site" stays disabled — it is the
future site-embed step, out of scope here.)

## Objective / feature request

Enable the kebab menu on the preview page with two actions:

- **Edit policy** → same as the existing "Edit cookie policy" button: navigate to
  `/cookie-policy/:websiteId` (the 3-step wizard, opens on About cookies).
- **Delete policy** → confirmation modal → on confirm, delete the policy via a new
  backend endpoint → success modal with **Back to Dashboard** (`/home`) and
  **Create new cookie policy** (`/cookie-policy/:websiteId`, the wizard, like the
  initial entry).

## Specifications

### Backend — `DELETE /pulse/websites/:websiteId/cookie-policy`

- Auth: `jwtValidation`; ownership via `assertOwnedWebsite(websiteId, userId)`
  (same guard as the other cookie-policy routes) → `404 "website not found"` if
  not owned.
- Behaviour: **reset the policy to the default seed.** Load the policy row for
  the website; set `content = defaultCookieContent(today)` (server "today",
  `YYYY-MM-DD`) — the exact state a brand-new website's policy has
  (3 default sections + `effectiveDate`, no `completedSections`). Then
  `sweepOrphanImages(policyId, new Set())` to delete **all** images owned by this
  policy (the default content references none). If the row is somehow missing
  (invariant says it won't be — seeded at website create), insert a fresh default
  row so the invariant holds.
- Response: `200` `ApiResponse(200, { content }, 'cookie policy deleted sucessfully')`
  (returns the reset content, mirroring the PUT handlers' shape).
- **Why reset, not row-removal:** `cookie_policy` is **1:1 with a website**
  (`website_id` unique FK, `onDelete: cascade`) and is **seeded at website
  creation** inside the create transaction (`website.controller.js`
  `createWebsite` → `defaultCookieContent`). There is **no independent
  create-policy path** — the only way a policy row appears is website creation.
  Truly removing the row would leave a website with no policy and no way to get
  one back short of adding a second "create policy" endpoint; and "Create new
  cookie policy" is expected to show the **default template** (as on first entry),
  not a blank editor. Resetting to the default seed gives precisely that with one
  endpoint and zero changes to the wizard/GET. Website deletion still hard-removes
  the row via the existing FK cascade (`deleteWebsite`), so no data is orphaned.

### Frontend — kebab menu + dialogs on `PolicyPreviewPage.jsx`

- **Kebab button** (`.cp-kebab`): remove `disabled`; toggles a dropdown
  `.cp-menu` anchored under it. Menu items:
  - **Edit policy** — `onClick` → `navigate(\`/cookie-policy/${websiteId}\`)`.
  - **Delete policy** (`.cp-menu-item.danger`, red) — opens the confirm dialog.
  - Closes on item click, outside click, and Esc.
- **Confirm dialog** (modal, reuses `.cp-modal-overlay`): title **"Are you sure
  you want to delete this policy?"**; body: "This will permanently remove your
  cookie policy from **`<url>`**. This action cannot be undone. If you're planning
  to create a new policy later, make sure to replace the embed code on your site.";
  buttons **Cancel** (outlined, closes) and **Delete cookie policy** (red filled).
- **Delete request:** on confirm, `apiFetch(\`/pulse/websites/${websiteId}/cookie-policy\`,
  { method: 'DELETE' })`. `401/403` → `/login`; non-ok → error banner/toast in the
  dialog; ok → advance to the success dialog. A `deleting` flag disables the
  buttons + shows the button spinner (`.loading`) during the request.
- **Success dialog** (modal): title **"Your cookie policy is deleted"**; body:
  "The cookie policy for **`<url>`** has been deleted. You can start over and
  create a new policy at any time."; buttons **Back to Dashboard** (outlined, ←
  icon → `navigate('/home')`) and **Create new cookie policy** (blue filled →
  `navigate(\`/cookie-policy/${websiteId}\`)`). Not dismissible by backdrop/Esc
  (it is a terminal state — force a choice), matching the reference.
- **Add policy to site** stays disabled (unchanged).

## Requirement alignment

- Assignment `references/assignment.md` is about the CMP consent engine
  (**R1–R8**): scanning, script gatekeeper, banner, geo, consent recording,
  release-on-accept. This feature is **policy-generator management UX** (edit /
  delete / restart), part of the CookieYes policy-generator surface the earlier
  cookie-policy plans build (`generate-cookie-policy.md`, §2.x). It **does not
  touch R1–R8** and creates/blocks **no cookies** — the **core principle is
  intact** (a CMP does not create cookies; this only manages stored policy
  *content*).
- **Gaps / deferred (unchanged from `generate-cookie-policy.md`):**
  - **"Add policy to site"** stays disabled — the real site-embed/script-gatekeeper
    step (toward **R2**/**R7**) is still future work.
  - **"Replace the embed code on your site"** in the confirm copy is aspirational
    (there is no embed/public-serving yet) — kept verbatim to match CookieYes; it
    documents intended behaviour for the future embed feature.
  - No `_ga`/release-on-accept check applies — this feature has no consent surface.

## Design

### Backend (3 changes + docs)

1. **`src/controllers/cookiePolicy.controller.js`** — new `deleteCookiePolicy`
   handler (mirrors `putPolicyMeta` structure): `assertOwnedWebsite`; select the
   row `{ id, }` by `websiteId`; compute `today` (`new Date().toISOString().slice(0,10)`,
   as `createWebsite` does); if row exists → `update ... set content =
   defaultCookieContent(today)`; else → `insert` a default row; then
   `sweepOrphanImages(policyId, new Set())`; return `200` with `{ content }`.
   Import `defaultCookieContent`.
2. **`src/routes/website.routes.js`** — mount
   `website_route.delete('/:websiteId/cookie-policy', jwtValidation, deleteCookiePolicy)`
   (no validator; nothing in the body). Place beside the existing
   `GET/PUT /:websiteId/cookie-policy` routes.
3. **`scripts/smoke.js`** — extend the cookie-policy block: after the section
   PUTs + completedSections asserts (~line 224), call `DELETE
   /pulse/websites/:wid/cookie-policy` → assert `200`; re-GET → assert
   `content.aboutCookies.heading === 'What are cookies?'` (default restored),
   `content.effectiveDate === todayISO`, and `(content.completedSections||[]).length === 0`.
   (The later orphan-image block runs after this — the reset clears images, so
   re-seed a section there if needed; verify order during implementation.)
4. **`openapi.yaml`** — document `DELETE /websites/{websiteId}/cookie-policy`
   (200 reset-content response + 404), following `update-openapi` conventions and
   the existing cookie-policy path style.

### Frontend (2 changes + docs)

5. **`src/PolicyPreviewPage.jsx`** — state: `menuOpen`, `dialog`
   (`null | 'confirm' | 'deleted'`), `deleting`, plus a menu-close effect
   (outside-click + Esc, like `PolicyPreview`'s Esc effect). Enable `.cp-kebab`
   (drop `disabled`), wrap it + the dropdown in a relatively-positioned
   `.cp-kebab-wrap`. Add `handleDelete()` = the DELETE `apiFetch` above → set
   `dialog='deleted'` on success. Render the confirm + success modals inline at
   the page root (same place as the existing toast). Reuse the load-time `url`.
6. **`src/signup.css`** — new `cp-` classes: `.cp-kebab-wrap` (relative),
   `.cp-menu` (absolute dropdown card, shadow, right-aligned under the kebab),
   `.cp-menu-item` (+ `.danger` red), `.cp-dialog` (centered modal card, reusing
   `.cp-modal-overlay`), `.cp-dialog h2/p`, `.cp-dialog-actions` (right-aligned
   button row), `.cp-btn-danger` (red filled, for "Delete cookie policy"),
   reuse `.submit` (blue) for "Create new cookie policy" and `.cp-btn` for
   Cancel / Back to Dashboard. Reuse existing tokens (`--error`, `--accent`,
   `--border`, `--muted`).
7. **Docs:** update `frontend/AI_DOCS/generate_cookie_policy.md` (kebab now
   active; delete flow) or add `frontend/AI_DOCS/policy_actions_menu.md`; run
   `sync-claude-md` after implementation (frontend `PolicyPreviewPage` line;
   backend Cookie Policy resource + endpoint table gets the DELETE route).

## Design notes

- **Reset-on-delete** is the crux — see the backend "Why reset" note. It keeps the
  1:1 invariant, needs one endpoint, and makes both "Edit policy" and "Create new
  cookie policy" plain `navigate` calls to the same wizard route (the wizard/GET
  are unchanged and show the default template after a reset). Honest framing: the
  row is not physically removed; the user-facing effect ("policy deleted, start
  fresh") is faithful, and true row-removal happens on website deletion.
- **`today` duplication:** `createWebsite` inlines `new Date().toISOString().slice(0,10)`.
  Reuse the same inline expression in `deleteCookiePolicy` for consistency (no new
  util; matches existing code).
- **Menu is a plain dropdown, not a modal** (matches the reference); the two
  dialogs ARE modals (overlay). Success dialog intentionally has no
  backdrop/Esc dismiss — it is terminal (the policy is gone; force Back or Create).
- **Reuses the modal overlay** from `preview-cookie-policy` (`.cp-modal-overlay`)
  rather than a new portal system — consistent with the codebase (no portals).
- **Edit policy == the sidebar "Edit cookie policy" button** — same target route;
  duplicated as a menu item for the CookieYes layout. Both lead to About step.

## Prompts (instructions given to the AI)

> "now i want to implement 3 dot buttons in generate policy [kebab screenshot] on
> clicking this is the two options edit policy and delete policy — edit policy
> same as edit cookie policy. on clicking delete policy first it shows this page
> [confirm modal: 'Are you sure you want to delete this policy?' … Cancel /
> Delete cookie policy] then on deleting it shows this [success modal: 'Your
> cookie policy is deleted' … Back to Dashboard / Create new cookie policy]. go to
> dashboard same as go to /home similar to the Back to Dashboard button. create
> new policy like when initially we come to generate cookie policy — it should
> point to the 3 wizards. create a plan for it in planmode."

## Tasks

1. `deleteCookiePolicy` handler (reset to default seed + sweep images) — files:
   `backend/src/controllers/cookiePolicy.controller.js`
2. Mount `DELETE /:websiteId/cookie-policy` — files:
   `backend/src/routes/website.routes.js`
3. Extend smoke: DELETE → 200, re-GET shows defaults restored + no
   completedSections — files: `backend/scripts/smoke.js`
4. Document the DELETE endpoint — files: `backend/openapi.yaml`
5. Kebab menu (Edit/Delete) + confirm & success dialogs + delete request — files:
   `frontend/src/PolicyPreviewPage.jsx`
6. Menu + dialog styles — files: `frontend/src/signup.css`
7. Feature doc — files: `frontend/AI_DOCS/policy_actions_menu.md`
8. Save this plan to `backend/cookiegenerator-plan/policy-actions-menu.md`
   (ships with the feature)

## Acceptance criteria

- [ ] On the preview page, the 3-dots button is **enabled**; clicking it opens a
      menu with **Edit policy** and (red) **Delete policy**; it closes on outside
      click / Esc / item select.
- [ ] **Edit policy** navigates to `/cookie-policy/:websiteId` (wizard, About step)
      — same as the sidebar "Edit cookie policy".
- [ ] **Delete policy** opens the confirm modal with the exact copy (permanent /
      cannot be undone / replace embed code) and the site URL; **Cancel** closes it.
- [ ] Confirming **Delete cookie policy** calls `DELETE
      /pulse/websites/:websiteId/cookie-policy` → `200`, then shows the **"Your
      cookie policy is deleted"** success modal.
- [ ] **Back to Dashboard** → `/home`; **Create new cookie policy** →
      `/cookie-policy/:websiteId`, and the wizard opens on **About cookies** with
      the **default template content restored** (headings/descriptions = defaults,
      progress 0%, effective date = today).
- [ ] Backend: after DELETE, `GET …/cookie-policy` returns the default seed
      (`aboutCookies.heading === 'What are cookies?'`, `effectiveDate === today`,
      no `completedSections`); this policy's uploaded images are gone. Ownership
      enforced (`404` for a non-owned/again unknown website).
- [ ] Smoke test green including the new DELETE assertions; frontend build + lint
      pass; backend `node --check` on changed files.

## Supporting documentation

- Reference screenshots (user, 2026-07-09): kebab menu (Edit / Delete policy);
  delete confirm modal; "Your cookie policy is deleted" success modal.
- Prior related plan: `generate-cookie-policy.md` (the preview page + disabled
  kebab this activates), `website-management.md` (delete-confirm UX precedent),
  `cookie-policy-default-content-on-website-create.md` (the seed this reuses).
- Code grounded: `cookiePolicy.controller.js`, `website.controller.js`
  (`createWebsite` seed / `deleteWebsite` cascade), `utils/cookiePolicy.js`
  (`assertOwnedWebsite`, `sweepOrphanImages`), `utils/defaultCookiePolicy.js`,
  `models/cookie_policy.js`, `scripts/smoke.js`.
- Assignment: `.claude/skills/plan-from-assignment/references/assignment.md`.
- Conventions: `frontend/CLAUDE.md`, `backend/CLAUDE.md`, `update-openapi` skill.

## Notes / changelog

- 2026-07-09 — plan drafted (plan mode). Not committed; ships with the feature.
- 2026-07-09 — user reviewed the delete semantics and **confirmed "reset to
  default template"** over true row-removal (Q&A). "Delete policy" therefore
  overwrites `content` with `defaultCookieContent(today)` and sweeps this policy's
  images; the row is never physically removed (only website deletion drops it, via
  FK cascade). This is a **reset, not a data delete** — chosen for the 1-endpoint,
  zero-wizard-change simplicity, accepting that the policy row persists as
  defaults. Plan approach unchanged by this confirmation.
- 2026-07-09 — implemented. Backend: `deleteCookiePolicy` (reset to default seed +
  sweep all policy images) at `DELETE /pulse/websites/:websiteId/cookie-policy`;
  route mounted; OpenAPI documented. Frontend: kebab menu (Edit/Delete) + confirm
  & success dialogs on `PolicyPreviewPage.jsx` + styles. No deviations from the
  plan. Verified (feature's single pre-manual-check run): backend `node --check`
  PASS on all 3 changed files, frontend `npm run lint` + `npm run build` PASS,
  regression smoke **48/48 PASS** (includes the 6 new DELETE-reset assertions:
  delete→200, defaults restored, effectiveDate=today, completedSections cleared,
  images swept, non-owned→404). verify-and-ship should reuse this smoke result.
