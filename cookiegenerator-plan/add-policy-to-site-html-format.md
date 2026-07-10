# Plan: "Add policy to site" → HTML format (self-contained embeddable HTML)

- **Slug:** `add-policy-to-site-html-format`
- **Scope:** frontend + backend (single plan, stored in backend repo per plan-template)
- **Status:** implemented (awaiting user manual check → ship)

## Objective / feature request

Turn the currently-**disabled** "HTML format" card in the "Add cookie policy to your
site" modal (`PolicyPreviewPage`) into a working option. Clicking it opens a code view:

- **Step 1: Copy this HTML code** → a read-only code box containing a **self-contained
  HTML snippet** of the generated cookie policy (styles + `<h1>Cookie Policy</h1>` +
  effective/last-updated dates + each non-empty section's `<h2>` heading and rich-text
  body, with **images inlined as base64 data URIs** so the snippet renders anywhere).
- A **"Copy code"** button (copies the whole snippet) and a **disabled** "Send code to
  a teammate" button.
- **Step 2: Paste the copied code into the required page on your website.**

Explicitly **out of scope / removed:** the "Select language to view code" / English
selector from the reference screenshot — not needed (single-language app).

## Specifications

### Backend — new endpoint

`GET /pulse/websites/:websiteId/cookie-policy/html` (behind `jwtValidation`, ownership
checked via the website's owner, same as the sibling cookie-policy routes).

- **Response (200):** shared envelope `{ data: { html }, message, ... }` where `html` is
  a single self-contained HTML string.
- **404:** website not owned / not found (via `assertOwnedWebsite`).
- **Auth:** `401`/`403` like the other nested routes (routed through `apiFetch` on the
  client so token rotation works).

**HTML contract** — matches the real CookieYes output shape (user-supplied full sample)
adapted to Pulse's data, and mirrors `frontend/src/PolicyDocument.jsx` so the exported
document equals the on-screen preview:

1. **Comment wrappers:** `<!-- Start Pulse cookie policy -->` … `<!-- End Pulse cookie
   policy -->` around the whole block (matches CookieYes's Start/End markers so the
   pasted region is easy to find/replace on the host page).
2. A **minimal `<style>`** block — deliberately light so the policy inherits the host
   site's typography (as CookieYes does). The only rule we ship is
   `.cookie-policy-p img{max-width:100%;height:auto}` to stop a large inlined base64
   image from overflowing. **No** wrapper `<div>`, **no** aggressive h1/h2/p theming.
3. `<h1 class="cookie-policy-h1">Cookie Policy</h1>`.
4. `<div class="cookie-policy-date-container"><p>Effective date: {…}</p><p>Last updated:
   {…}</p></div>`. Date format **"Month DD, YYYY"** (e.g. `July 10, 2026`) — identical
   to the frontend `formatLong` (month name, zero-padded day). Effective =
   `effectiveDate || today`; Last updated = `today`. Server-side and timezone-safe
   (parse `YYYY-MM-DD` as Y/M/D, not `new Date('…')`).
5. `&nbsp;` separator, then for each section in order (`aboutCookies`, `useOfCookies`,
   `cookiePreferences`): skip it when it has **no heading AND no text** (same `hasText`
   rule as `PolicyDocument`); otherwise emit `<h2>{heading}</h2>` (only if heading
   non-empty) + `<div class="cookie-policy-p">{description HTML}</div>`. (Descriptions
   are Tiptap HTML that already contains `<p>`/`<a>`/`<img>`; it's injected inside the
   `cookie-policy-p` div, exactly like the sample.)
6. Footer (kept, matching `PolicyDocument` and the sample's footer slot):
   `<p class="cookie-policy-p">Cookie Policy generated for <a … href="{url}">{url}</a></p>`.
   We do **not** reproduce CookieYes's branding/advertising footer link.
7. **Image inlining:** every `/pulse/images/<uuid>` reference in the composed HTML is
   replaced with `data:<mime>;base64,<bytes>`, looked up from `policy_images` (batch
   `inArray` load of `{ id, mime, data }`, scoped to this policy). A referenced id with
   no row (already swept) is left as its original URL (harmless broken `<img>`), not
   crashed on.

**Omitted CookieYes-only elements** (not part of Pulse's data model): the "Types of
cookies we use" **audit table** (`cky-audit-table-element`), the **"Consent Preferences"
banner button** (`a.cky-banner-element`) and its style rule, and the CookieYes-branded
footer link. Pulse has three editor-authored sections and no cookie-scan/banner engine,
so those placeholders have nothing to render.

### Frontend — enable the card + code view

In `PolicyPreviewPage.jsx`, the "Add policy to site" modal gains a two-step flow:

- Method step (existing): the "HTML format" card becomes **enabled** (clickable, remove
  `is-disabled`/`aria-disabled`, drop the "Coming soon" pill) and is now a real
  `<button>`.
- Clicking it → **HTML step**: fetch the snippet from the new endpoint (lazy, once),
  showing a "Generating…" state in the code box, then render:
  - `Step 1: Copy this HTML code.` label.
  - Read-only, scrollable `<textarea>`/`<pre>` code box with the HTML.
  - **Copy code** button → `navigator.clipboard.writeText(html)`, with a transient
    "Copied!" confirmation; and a **disabled** "Send code to a teammate" button.
  - `Step 2: Paste the copied code into the required page on your website.` label.
  - **No** language selector.
- ✕ / backdrop / Escape close the modal **and reset** it to the method step (and clear
  any fetched html/error) so reopening starts clean. Body-scroll lock unchanged.
- On fetch `401`/`403` → `navigate('/login')` (consistent with the page's other calls);
  other errors → an inline error line inside the code area with a retry.

Validation rules: none (no user input; read-only output).

## Requirement alignment

- **R7 (config/policy updates surfaced to the site without changing developer code):**
  this is the **delivery mechanism** for the generated policy — the owner copies a
  self-contained HTML block and pastes it onto their site. This is the feature that
  makes the "HTML format" placeholder real.
- **Gap (intended, flagged):** the HTML export is a **manual, static** delivery — the
  pasted snippet does **not** auto-update when the policy is later edited; the owner
  must re-copy and re-paste (the card's own copy says as much). So R7 is only
  *partially* satisfied (manual, not automatic propagation). A future "Code snippet"
  method (a live `<script>` embed) would close that gap; explicitly out of scope here.
- **Core-principle check (does NOT apply):** the generated artifact is a **static,
  informational cookie *policy* document** — it does not set, block, or release any
  cookie, is not the consent banner, and is not the script gatekeeper. Therefore the
  `_ga`-release-on-accept acceptance check **does not apply** to this change (no consent
  surface is touched) — noted so a reviewer doesn't expect it.

## Design

### Backend

- **Util — `frontend`-parity renderer** in `backend/src/utils/policyHtml.js` (new):
  - `formatLongDate(iso)` → "Month DD, YYYY", timezone-safe (mirror `dateUtils.formatLong`).
  - `hasText(html)` → strip tags + `&nbsp;`, trim, length > 0 (mirror `PolicyDocument`).
  - `renderPolicyHtml({ content, url, imagesById })` → composes the Start/End comment
    wrappers + minimal `<style>` + `cookie-policy-h1` + `cookie-policy-date-container` +
    `&nbsp;`-separated sections (`<h2>` + `cookie-policy-p` div) + footer, then inlines
    images from the provided `imagesById` map.
  - A small `POLICY_STYLES` string — a single rule
    `.cookie-policy-p img{max-width:100%;height:auto}`. No h1/h2/p theming (the embed
    inherits the host site's styles, as CookieYes does).
- **Controller — `getCookiePolicyHtml`** in `cookiePolicy.controller.js`:
  1. `assertOwnedWebsite(websiteId, req.user.id)`.
  2. Load the `cookiePolicy.content` row (default `{}`).
  3. Look up the website `url` (for the footer) and collect referenced image ids from
     `JSON.stringify(content)` via the existing `imageIdsFrom`; batch-load matching
     `policy_images` (`id, mime, data`) with `inArray`, scoped to this policy's id;
     build `imagesById` (`data:` URIs).
  4. `renderPolicyHtml({ content, url, imagesById })` →
     `ApiResponse(200, { html }, 'cookie policy html generated sucessfully')`.
- **Route** in `website.routes.js`:
  `website_route.get('/:websiteId/cookie-policy/html', jwtValidation, getCookiePolicyHtml)`
  — placed **before** the `/:websiteId/cookie-policy/:section` PUT is irrelevant (GET vs
  PUT; distinct method) but keep it grouped with the other cookie-policy routes. `html`
  can't collide with `:section` because that param is only on the PUT.
- **OpenAPI:** document the new GET under the cookie-policy paths via the `update-openapi`
  skill at implement time.

### Frontend

All in `frontend/src/PolicyPreviewPage.jsx` + `frontend/src/signup.css`:

1. **State:** add `addStep` (`'method' | 'html'`), `htmlCode` (string|null),
   `htmlLoad` (`'idle'|'loading'|'ready'|'error'`), `copied` (bool). Reset all when the
   modal closes (extend the existing `addOpen` close paths + Esc effect).
2. **Enable the card:** convert the `.cp-method-card.is-disabled` div into a
   `<button class="cp-method-card">` with `onClick={openHtmlStep}`; remove the
   "Coming soon" pill.
3. **`openHtmlStep`:** set `addStep='html'`; if `htmlCode` not yet loaded, `apiFetch`
   `GET /pulse/websites/:id/cookie-policy/html`, handle `401/403`→login, set
   `htmlCode`/`htmlLoad`.
4. **HTML-step markup** (inside the modal, when `addStep==='html'`): Step 1 label, the
   read-only code box (`.cp-code-box`), the button row (`Copy code` active +
   `Send code to a teammate` **disabled**), Step 2 label. A small "← Back" affordance
   to return to the method step is optional; ✕/Esc/backdrop already close+reset.
5. **Copy:** `navigator.clipboard.writeText(htmlCode)` → set `copied=true` for ~2s.
6. **CSS:** add `.cp-code-box` (monospace, `overflow:auto`, bordered, `--bg` fill),
   `.cp-code-actions` (button row), `.cp-step-label`, and a disabled style for the
   teammate button — reuse existing tokens/`.cp-btn`; light theme only.
7. **CLAUDE.md** (frontend + backend) refreshed at ship time via `sync-claude-md`.

## Design notes

- **Backend generation was chosen over frontend** (user decision): the server owns the
  image bytes, so it can inline base64 cleanly in one place and return a single portable
  artifact — no browser-side blob/CORS conversion, and one source of truth for the
  "published" HTML. The frontend just fetches/displays/copies.
- **Full parity with `PolicyDocument` (footer kept).** The section-skipping/heading
  rules AND the "Cookie Policy generated for <url>" footer are copied, so the exported
  HTML equals the on-screen preview with no divergence. (An earlier draft dropped the
  footer; the real CookieYes sample keeps a footer slot, and keeping ours removes drift
  — reversed deliberately.)
- **Structure matches the real CookieYes sample, adapted to Pulse.** Start/End comment
  markers, `cookie-policy-h1` / `cookie-policy-date-container` / `cookie-policy-p` class
  names, and `&nbsp;` separators are reproduced. We **omit** the CookieYes-only pieces
  Pulse has no data for: the audit table (`cky-audit-table-element`), the Consent
  Preferences banner button (`a.cky-banner-element`), and the CookieYes branding link.
- **Minimal styling — inherit the host theme.** Like CookieYes, we ship almost no CSS
  (only an `img{max-width:100%}` guard) and no wrapper `<div>`, so the pasted policy
  picks up the customer site's own typography instead of a foreign look. This is why a
  scoped wrapper is *not* used.
- **Trust boundary unchanged.** Descriptions are the owner's own Tiptap HTML, already
  injected via `dangerouslySetInnerHTML` in the app; returning it to the same owner to
  copy introduces no new XSS surface. No sanitization added (consistent with existing
  behaviour); noted rather than silently assumed.
- **Missing images** (id referenced but row swept) are left as the original
  `/pulse/images/<id>` URL rather than failing the whole export — a single broken image
  beats a 500.
- **"Send code to a teammate" stays disabled** per the request — no email/share backend
  exists; wiring it is a separate feature.
- **Two-step modal** (method → html) reuses the existing `.cp-add-modal` overlay/Esc/
  scroll-lock rather than introducing a new modal or route — consistent with the modal
  pattern already on the page.

## Prompts (instructions given to the AI)

> "now i want to enable my html format button in the real app [screenshot of CookieYes
> HTML code view: 'Select language to view code / English', 'Step 1: Copy this HTML
> code', code box, 'Copy code' + 'Send code to a teammate', 'Step 2: Paste the copied
> code into the required page on your website']. select language to view code is not
> needed. make send code to teammate also disabled."

> [second message] a partial paste of the real CookieYes generated output — a `<style>`
> block (`.cky-banner-element …`), `<h1 class="cookie-policy-h1">Cookie Policy</h1>`, a
> `cookie-policy-date-container` with Effective/Last-updated dates, an `<h2>` section
> heading, and a `cookie-policy-p` body containing an `<img src="data:image/png;base64,…">`
> — "eventhough it says html its not fully html … create a plan to implement this."

Clarification captured (via question): the self-contained HTML with base64-inlined
images is generated by a **new backend endpoint**, not the browser.

## Tasks

1. Add `backend/src/utils/policyHtml.js` — `formatLongDate`, `hasText`, `POLICY_STYLES`,
   `renderPolicyHtml({ content, imagesById })` (parity with `PolicyDocument`, no footer)
   — files: `backend/src/utils/policyHtml.js` — satisfies: R7
2. Add `getCookiePolicyHtml` controller (ownership → load content → batch-load & inline
   images → render) — files: `backend/src/controllers/cookiePolicy.controller.js` — satisfies: R7
3. Wire the route `GET /:websiteId/cookie-policy/html` (jwt) — files:
   `backend/src/routes/website.routes.js` — satisfies: R7
4. Document the endpoint in `backend/openapi.yaml` (via `update-openapi`) — files:
   `backend/openapi.yaml`
5. Extend `backend/scripts/smoke.js`: after generating a policy, `GET …/cookie-policy/html`
   and assert `200` + non-empty `data.html` containing `<h1 class="cookie-policy-h1">Cookie
   Policy` — files: `backend/scripts/smoke.js`
6. Frontend: add `addStep/htmlCode/htmlLoad/copied` state + reset-on-close; enable the
   HTML-format card (button + onClick, drop "Coming soon"); add the HTML-step view
   (Step 1, code box, Copy code, disabled "Send code to a teammate", Step 2); wire the
   `apiFetch` GET + clipboard copy — files: `frontend/src/PolicyPreviewPage.jsx` — satisfies: R7
7. Frontend CSS: `.cp-code-box`, `.cp-code-actions`, `.cp-step-label`, disabled teammate
   button — files: `frontend/src/signup.css`
8. Sync docs (`sync-claude-md`) — frontend `PolicyPreviewPage` line (HTML card now active
   + code view) and backend cookie-policy section (new GET) — at ship time.

## Acceptance criteria

- [ ] `GET /pulse/websites/:id/cookie-policy/html` returns `200` with
      `data.html` — a string wrapped in the `<!-- Start Pulse cookie policy -->` /
      `<!-- End … -->` markers and containing `<h1 class="cookie-policy-h1">Cookie
      Policy</h1>`, the `cookie-policy-date-container` with effective/last-updated dates,
      each non-empty section's `<h2>` + `cookie-policy-p` body, and the footer.
- [ ] Any `/pulse/images/<id>` in the policy is replaced by a `data:<mime>;base64,…`
      URI in the returned HTML (verified with a policy that has an uploaded image); a
      missing image id does not error the request.
- [ ] The endpoint is owner-scoped: another user's website id → `404`; unauthenticated
      → `401`.
- [ ] In the app, the "HTML format" card is now **enabled**; clicking it shows the code
      view with Step 1 label, a code box holding the snippet, a working **Copy code**
      button, a **disabled** "Send code to a teammate" button, and the Step 2 label.
      **No** language selector is present.
- [ ] "Copy code" places the exact snippet on the clipboard (shows a transient
      confirmation).
- [ ] Closing the modal (✕/backdrop/Esc) resets it to the method step; reopening
      re-shows the method picker. Kebab menu + delete dialogs still work (no regression).
- [ ] `npm run build` and `npm run lint` pass in `frontend/`; backend boots and
      `npm run smoke` passes with the new HTML assertion.
- [ ] N/A — no consent/cookie surface touched, so the `_ga`-release check does not apply.

## Supporting documentation

- Screenshot: CookieYes "HTML code" view (Step 1/Step 2, Copy code, Send to teammate) —
  provided by user.
- Sample of the real generated output — first a partial paste (with an inline base64
  `<img>`), then the **full sample without images** matching Pulse's 3 sections: Start/End
  comment markers, `<style>a.cky-banner-element{…}</style>`, `cookie-policy-h1`,
  `cookie-policy-date-container`, `<h2>` + `cookie-policy-p` per section, the CookieYes
  audit-table/Consent-Preferences placeholders (omitted for Pulse), and the footer link.
- Parity source: `frontend/src/PolicyDocument.jsx` (structure + `hasText` rule),
  `frontend/src/dateUtils.js` (`formatLong` = "Month DD, YYYY").
- Predecessor plan: `cookiegenerator-plan/add-policy-to-site-modal.md` (the disabled card
  this feature activates).
- Image storage/inlining: `backend/src/controllers/image.controller.js`,
  `backend/src/utils/cookiePolicy.js` (`imageIdsFrom`), `policy_images` model.

## Notes / changelog

- Draft. Awaiting manual review/approval. Design confirmed with user: HTML generated by
  a **new backend endpoint** with base64-inlined images; language selector omitted; "Send
  code to a teammate" disabled. Per plan-template, this doc is committed **with** the
  feature at ship time, not on its own.
- **Revised after the user supplied the full real-CookieYes sample:** HTML contract now
  matches that structure (Start/End comment markers, `cookie-policy-h1` /
  `cookie-policy-date-container` / `cookie-policy-p` classes, `&nbsp;` separators);
  **footer is kept** (reversing the earlier "drop footer" call) for full parity with
  `PolicyDocument`; **no scoped wrapper / minimal CSS** so the embed inherits the host
  theme; CookieYes-only pieces (audit table, Consent Preferences banner button, branding
  link) are omitted since Pulse has no data for them.
- **Implemented (2026-07-10):** Backend — new `backend/src/utils/policyHtml.js`
  (`formatLongDate`/`hasText`/`POLICY_STYLES`/`renderPolicyHtml`), `getCookiePolicyHtml`
  controller (owner-scoped; batch-loads referenced `policy_images` and inlines base64),
  route `GET /:websiteId/cookie-policy/html`, and `openapi.yaml` path block. Frontend —
  `PolicyPreviewPage.jsx` gains `addStep/htmlCode/htmlLoad/copied` state + a `closeAdd`
  reset callback (used by ✕/backdrop/Esc so reopening starts clean), the HTML-format card
  is now an enabled `<button>` (no "Coming soon"), and a code-view step (Step 1 label,
  read-only code box, Copy code, **disabled** "Send code to a teammate", Retry on error,
  Back, Step 2 label; no language selector); `signup.css` adds `.cp-code-box`,
  `.cp-code-actions`, `.cp-step-label`, `.cp-code-back`, and `button.cp-method-card`
  hover. Footer rendered as plain text (matches `PolicyDocument`'s `<span>`), not the
  `<a href>` the draft mentioned. **Verification:** `renderPolicyHtml` unit-checked
  (h1/dates/empty-section-skip/image-inline/footer/markers all correct); frontend
  `npm run lint` clean + `npm run build` OK (pre-existing chunk-size warning only);
  backend container rebuilt (source is baked, not volume-mounted) and
  `npm run smoke` = **56 passed, 0 failed** (incl. 4 new HTML-export assertions: 200,
  structure, non-owned→404, base64 inlining). This is the single feature smoke run —
  `verify-and-ship` should reuse it unless code changes after this. CLAUDE.md (frontend +
  backend) to be synced at ship time via `sync-claude-md`.
