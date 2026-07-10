# Plan: "Send code to a teammate" — email the policy install code

- **Slug:** `send-code-to-teammate`
- **Scope:** frontend + backend (single plan, stored in backend repo per plan-template)
- **Status:** implemented (awaiting user manual check → ship)

## Objective / feature request

Enable the currently-**disabled** "Send code to a teammate" button in the HTML-format
code view (the `PolicyPreviewPage` "Add policy to site" modal). Clicking it opens a
"Send installation code to your teammate" step with a required email field; submitting
emails the teammate the **same self-contained HTML snippet** (via the existing
nodemailer setup) inside a **Pulse-branded** template, then shows a success step.

## Specifications

### Frontend — two new modal steps

Extend the existing `addStep` state machine in `PolicyPreviewPage.jsx`
(`'method' | 'html'`) with `'send'` and `'sent'`:

- **`html` step:** the "Send code to a teammate" button becomes **enabled**; onClick →
  `setAddStep('send')`. (Only reachable once the snippet has loaded — it already lives in
  the code view.)
- **`send` step** (matches screenshot 1):
  - Title: **"Send installation code to your teammate"**.
  - Subtitle: "Your teammate will receive an email with the policy installation code and
    instructions to set it up."
  - Required field labelled **"Email address"** with a red `*`, placeholder
    `email@domain.com`.
  - Primary **"Send email"** button (spinner/disabled while sending).
  - A **Back** affordance → `setAddStep('html')`; ✕/backdrop/Esc still close+reset.
  - Client guard: empty/blank email shows an inline "Email address is required" and does
    not submit (mirrors the login password guard convention). Server is the source of
    truth for format (`422` rendered inline).
- **`sent` step** (matches screenshot 2):
  - Green check icon, heading **"Installation code sent successfully!"**.
  - Body: "Your teammate (`<email>`) will receive the installation code and instructions
    shortly to complete the installation process."
  - Single **"Okay"** button → `closeAdd()` (full close + reset).

State additions: `teamEmail` (string), `sendState` (`'idle'|'sending'|'error'`),
`sendError` (string|null, banner) + field error. `closeAdd()` resets all of these too.

### Backend — new endpoint

`POST /pulse/websites/:websiteId/cookie-policy/send-code` (behind `jwtValidation`,
ownership via the website's owner).

- **Body:** `{ email }` — required, valid email (express-validator, mirrors
  `registerValidator`'s email chain: `.notEmpty().bail().isEmail().normalizeEmail()`).
- **Behaviour:** load the saved policy `content` + website `url`, inline referenced
  images as base64, render the snippet (the **same** pipeline as `getCookiePolicyHtml`,
  extracted into a shared helper), build the Pulse email, `sendEmail(...)`.
- **Responses:** `200 { }` "installation code sent sucessfully"; `422` (invalid/missing
  email); `401/403` (auth); `404` (website not owned/found). Shared envelope.
- **Mail failure:** `sendEmail` already swallows transport errors (logs, doesn't throw),
  so a mail outage does not 500 the request — the endpoint returns `200` once dispatch is
  attempted (documented limitation; matches the existing auth email flows).

### Email template (Pulse-branded, custom HTML)

The existing `utils/mail.js` uses **Mailgen** (intro/action-button/outro). That layout
can't cleanly host an embedded, escaped code box, so this email is a **custom HTML
string** (a new builder), and `sendEmail` is extended to send raw html/text when
provided (falling back to Mailgen when `emailContent` is passed — existing calls
unchanged). Content (matches screenshots 3–4, CookieYes → **Pulse**):

- Header wordmark: **Pulse**.
- Title: **"Add a cookie policy on your website `<url>`"**.
- "Hi there," + "Your teammate has generated a cookie policy using **Pulse** and needs
  your help to add it to the site `<url>`." (`<url>` linked).
- **"Add as HTML"** section: "You'll need to manually update this code on your site
  whenever the cookie policy is edited in **Pulse**. 1. Copy the HTML snippet provided
  below. 2. Paste it into the relevant section of your website where you want the policy
  to appear."
- The HTML snippet in a monospace, light-bg code box — **HTML-escaped** so it renders as
  visible text (never executes in the email client). (No "English (EN)" language label —
  single-language app, matching the code view's omission of the language selector.)
- **"Need help?"** "If you face any issues, feel free to contact us and we'll help you."
  ("contact us" → the Pulse product link / a mailto).
- Subject: `Add the cookie policy to <url>` (or similar).

## Requirement alignment

- **R7 (surface the policy to the site without changing developer code):** this is the
  *collaboration* path of the same delivery mechanism as the HTML-format export — a
  non-technical owner hands the install code to a teammate who pastes it. Same family as
  `add-policy-to-site-html-format`.
- **Gap (intended, flagged):** still a **manual, static** paste (the email says as much);
  no auto-propagation when the policy later changes. Same R7 gap as the HTML export.
- **Core-principle check (does NOT apply):** emails a static policy *document*; sets,
  blocks, releases **no** cookie, touches neither the banner nor the gatekeeper nor
  consent recording. The `_ga`-release-on-accept check **does not apply** — noted so a
  reviewer doesn't expect it.

## Design

### Backend

- **Refactor (shared helper):** extract the "load content + url, collect referenced image
  ids, batch-load `policy_images`, build `imagesById`, `renderPolicyHtml(...)`" block
  (currently inline in `getCookiePolicyHtml`) into a helper, e.g.
  `buildPolicyHtml(websiteId)` → `{ html, url }`. Place it in
  `src/utils/policyHtml.js` (DB-touching variant) **or** a small
  `services/`-style function in the controller module. Given `policyHtml.js` is currently
  pure/string-only, keep it pure and put the DB helper in the **controller module**
  (exported) or a new `src/utils/cookiePolicyHtml.service.js`. Chosen:
  a module-level `async function buildPolicyHtml(websiteId)` in
  `cookiePolicy.controller.js`, used by both `getCookiePolicyHtml` and the new controller
  — no behaviour change to the existing endpoint.
- **Controller `sendPolicyCode`** (`cookiePolicy.controller.js`):
  1. `assertOwnedWebsite(websiteId, req.user.id)`.
  2. `{ html, url } = await buildPolicyHtml(websiteId)`.
  3. `await sendEmail({ email: req.body.email, subject, html, text })` where
     `html`/`text` come from the new `policyInstallEmail(url, html)` builder.
  4. `ApiResponse(200, {}, 'installation code sent sucessfully')`.
- **Mail builder** (`utils/mail.js`): add `policyInstallEmail(url, snippetHtml)` →
  `{ subject, html, text }`. `html` is the custom template above with
  `escapeHtml(snippetHtml)` inside a `<pre>`; `text` is a plaintext fallback (title +
  instructions + snippet). Extend `sendEmail` so that when `options.html` is provided it
  is sent directly (with `options.text`), otherwise the current Mailgen path runs. A tiny
  `escapeHtml` helper (or reuse the one in `policyHtml.js` by exporting it).
- **Validator** (`cookiePolicy.validator.js`): `sendCodeValidator()` — the email chain
  from `registerValidator` (`.trim().notEmpty().bail().isEmail().withMessage('Invalid
  email address').normalizeEmail()`).
- **Route** (`website.routes.js`): `POST /:websiteId/cookie-policy/send-code`, chain
  `jwtValidation, sendCodeValidator(), validation, sendPolicyCode`.
- **OpenAPI:** document the new POST via `update-openapi` at implement time.

### Frontend

All in `PolicyPreviewPage.jsx` + `signup.css`:

1. State: `teamEmail`, `sendState`, `sendError` (+ field error); reset in `closeAdd`.
2. Enable the "Send code to a teammate" button (drop `disabled`/`title`; add
   `onClick={() => setAddStep('send')}`).
3. `send` step markup: title, subtitle, labelled email input (reuse `.field`/`.input-row`
   or the cp modal styles), inline error, "Send email" primary button, Back button.
4. `handleSendCode`: client guard (non-empty) → `apiFetch` POST
   `/pulse/websites/:id/cookie-policy/send-code` with `{ email: teamEmail }`;
   `401/403`→login, `422`→inline field error, other→banner, `200`→`setAddStep('sent')`.
5. `sent` step markup: green check SVG (reuse the toast check), heading, body with the
   email, "Okay" → `closeAdd`.
6. CSS: a `.cp-send-*` / reuse `.field`, `.submit`, and a centered success block
   (`.cp-sent-*`) — existing tokens, light theme; reuse the modal shell `.cp-add-modal`.
7. Docs synced via `sync-claude-md` at ship time.

## Design notes

- **Custom HTML email over Mailgen:** the required layout embeds a code box; Mailgen's
  themed action-button body can't express that. Extending `sendEmail` to accept raw
  `html`/`text` keeps one send path and leaves the verification/reset emails untouched.
- **Snippet is escaped** in the email — it must display as code, and un-escaped `<style>`/
  `<script>`-ish content could be mangled or (in permissive clients) interpreted. Escape
  → `<pre>`.
- **Base64 images inflate email size.** The snippet reuses the export pipeline (images
  inlined), so a policy with large images yields a large email that some providers may
  clip. Acceptable for now (parity with the "Copy code" output); flagged. A future option:
  leave `/pulse/images/:id` URLs in the *emailed* variant (they're public) to shrink it —
  out of scope.
- **Shared `buildPolicyHtml` helper** avoids drift between the exported and emailed
  snippet — both are byte-identical.
- **No new consent surface** — purely a delivery/notification path.
- **Reuses the existing modal** (`addStep` machine) rather than a new modal/route, so
  ✕/backdrop/Esc/scroll-lock/reset all work unchanged.
- **Sender identity:** `sendEmail` already sets `from: 'mail.pulse@example.com'`; the
  teammate address is the recipient. No auth/token surface touched.

## Prompts (instructions given to the AI)

> "now let us enable send code to a teammate on clicking [screenshot: 'Send installation
> code to your teammate' modal with Email address field + Send email]. here for send mail
> you can use my nodemailer to send mail. after sending mail this should be the content
> [success modal: 'Installation code sent successfully!'] and in the mailbox [email
> template screenshots] this is the template required — instead of cookieyes use pulse.
> create a plan for it in planmode."

## Tasks

1. Backend: extract `buildPolicyHtml(websiteId)` helper from `getCookiePolicyHtml`
   (no behaviour change) — files: `backend/src/controllers/cookiePolicy.controller.js` — satisfies: R7
2. Backend: add `policyInstallEmail(url, snippetHtml)` builder + extend `sendEmail` to
   send raw `html`/`text` when provided — files: `backend/src/utils/mail.js` — satisfies: R7
3. Backend: `sendCodeValidator()` (email chain) — files: `backend/src/validators/cookiePolicy.validator.js`
4. Backend: `sendPolicyCode` controller + route `POST …/cookie-policy/send-code`
   (jwt + validator + validation) — files: `backend/src/controllers/cookiePolicy.controller.js`,
   `backend/src/routes/website.routes.js` — satisfies: R7
5. Backend: document the endpoint in `openapi.yaml` (via `update-openapi`)
6. Backend: extend `scripts/smoke.js` — assert `send-code` returns `422` on invalid email
   and `404` on a non-owned website. (Do **not** assert a real send — avoid dispatching
   live mail from smoke; the happy-path send is verified manually.) — files: `backend/scripts/smoke.js`
7. Frontend: add `send`/`sent` steps + state, enable the teammate button, `handleSendCode`,
   client guard, reset-on-close — files: `frontend/src/PolicyPreviewPage.jsx` — satisfies: R7
8. Frontend CSS for the send/sent steps — files: `frontend/src/signup.css`
9. Sync docs (`sync-claude-md`) — frontend `PolicyPreviewPage` line + Endpoints table;
   backend Cookie Policy resource section — at ship time.

## Acceptance criteria

- [ ] In the code view, "Send code to a teammate" is **enabled**; clicking it shows the
      "Send installation code to your teammate" step with the subtitle, a required email
      field, and a "Send email" button.
- [ ] Submitting a valid email calls `POST …/cookie-policy/send-code` and, on `200`, shows
      the success step ("Installation code sent successfully!" + the teammate's email +
      "Okay").
- [ ] A blank email is blocked client-side; an invalid email returns `422` and is shown
      inline.
- [ ] The endpoint is owner-scoped (`404` for a non-owned website) and requires auth
      (`401`).
- [ ] The teammate receives a **Pulse-branded** email (no "CookieYes") with the title
      "Add a cookie policy on your website `<url>`", the "Add as HTML" instructions, and
      the **escaped** HTML snippet in a code box. (Verified manually by sending to a real
      inbox.)
- [ ] The emailed snippet is byte-identical to the "Copy code" export (shared
      `buildPolicyHtml`).
- [ ] ✕/backdrop/Esc/Okay all close and reset the modal to the method step; the html/copy
      flow and kebab/delete dialogs still work (no regression).
- [ ] `npm run build` + `npm run lint` pass (frontend); backend boots and `npm run smoke`
      passes with the new `send-code` validation/ownership assertions.
- [ ] N/A — no consent/cookie surface touched, so the `_ga`-release check does not apply.

## Supporting documentation

- Screenshots (user-provided): send modal, success modal, and the two email-template
  captures.
- Reuses: `backend/src/utils/policyHtml.js` (`renderPolicyHtml`), `getCookiePolicyHtml`
  image-inline logic (to be shared via `buildPolicyHtml`), `backend/src/utils/mail.js`
  (`sendEmail` + nodemailer), `registerValidator` email chain.
- Predecessor: `cookiegenerator-plan/add-policy-to-site-html-format.md` (the code view this
  button lives in).

## Notes / changelog

- Draft. Awaiting manual review/approval. Confirmed: Pulse-branded custom HTML email
  (not Mailgen), reuse existing nodemailer `sendEmail`, snippet identical to the export,
  smoke covers validation/ownership only (no live send). Per plan-template, this doc ships
  **with** the feature at ship time, not on its own.
- **User revision (pre-implementation):** dropped the "English (EN)" language label from
  the email template (single-language app).
- **Implemented (2026-07-10):** Backend — extracted shared `buildPolicyHtml(websiteId)` in
  `cookiePolicy.controller.js` (used by both `getCookiePolicyHtml` and the new
  `sendPolicyCode`); `policyInstallEmail(url, snippetHtml)` builder + raw-html path in
  `sendEmail` (`utils/mail.js`); `escapeHtml` exported from `policyHtml.js`;
  `sendCodeValidator()` (email chain); route `POST …/cookie-policy/send-code`;
  `openapi.yaml` path; `smoke.js` +2 assertions (invalid-email 422, non-owned 404 — no
  live send). Frontend — `PolicyPreviewPage.jsx`: `addStep` extended to
  `method|html|send|sent`, teammate button enabled, `send` step (Back + title/subtitle +
  required email field + "Send email"), `sent` success step (green check + email + Okay),
  `handleSendCode` (client guard, 422 inline, 401/403→login), `closeAdd` resets the new
  state; `signup.css` `.cp-send-*`/`.cp-sent*`/`.cp-req` styles. **Verification:** email
  builder unit-checked (Pulse-branded, no "CookieYes", snippet HTML-escaped in the code
  box, title/instructions/Need-help present); frontend `lint` clean + `build` OK
  (pre-existing chunk-size warning only); backend container rebuilt; `npm run smoke` =
  **58 passed, 0 failed**. The actual email delivery (happy path) is left for the user's
  manual check (smoke intentionally does not dispatch live mail). CLAUDE.md sync at ship
  time via `sync-claude-md`.
- **Post-implementation tweak (user request):** the email code box is now a **fixed-height
  (320px) scrollable box** (`max-height:320px;overflow:auto` on the `<pre>`), matching real
  CookieYes, so a long snippet scrolls instead of expanding the whole email. Caveat: email
  clients vary — **Gmail web** (the user's client) honours it; some clients (Outlook, parts
  of Apple Mail) may ignore `overflow`/`max-height` and show the full snippet. No code-path
  change; snippet content unchanged.
