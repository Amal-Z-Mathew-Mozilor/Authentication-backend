# Plan: Send policy code to teammate as an attachment (fix email clipping)

- **Slug:** send-code-email-attachment
- **Scope:** frontend + backend (single plan, stored in backend repo) — **backend-only change**
- **Status:** ~~draft~~ → ~~approved~~ → ~~implemented~~ → **SUPERSEDED** by
  `public-image-url-export.md` (never shipped)

> **Superseded (never shipped).** This plan attached the code as `cookie-policy.html` to dodge
> Gmail's ~102 KB body clip caused by the large **base64** image. `public-image-url-export.md`
> removed base64 (images are now public URLs), so the snippet is small and the send-code email
> reverted to showing the code **inline in a `<pre>` box** — no attachment. Kept for history per
> the never-delete rule; the attachment code described below is no longer in the tree.

## Objective / feature request

Fix the "send code to teammate" email so the **full** generated cookie-policy HTML —
including large inline base64 images — is delivered intact, instead of being cut off
in the recipient's inbox. Deliver the code as a `cookie-policy.html` **attachment**
rather than inlining it in the email body.

## Specifications

- **Bug:** `policyInstallEmail` (`utils/auth/mail.js`) embeds the entire policy snippet
  as escaped text inside a `<pre>` in the HTML body. Because `buildPolicyHtml` inlines
  every image as a base64 `data:` URI, one image alone can be several hundred KB, pushing
  the email body past **Gmail's ~102 KB message-clipping threshold**. Gmail then clips the
  body ("[Message clipped] — View entire message"), so the teammate sees truncated code.
- **Fix:** send the snippet as a **file attachment** (`cookie-policy.html`, `text/html`)
  and keep the email body small (short instructions + a note pointing at the attachment).
  Body size becomes independent of snippet/image size, so nothing is clipped.
- **API contract:** `POST /pulse/websites/:websiteId/cookie-policy/send-code` is
  **unchanged** — same route, same request body `{ email }`, same `200` success envelope,
  same swallow-mail-errors behavior. Only the composed email changes (body + attachment).
- **Behaviour:**
  - `policyInstallEmail(url, snippetHtml)` returns `{ subject, html, text, attachments }`
    where `attachments = [{ filename: 'cookie-policy.html', content: snippetHtml, contentType: 'text/html' }]`.
  - The body no longer contains the `<pre>` snippet; it instructs the teammate to open
    the attached `cookie-policy.html` and copy its contents.
  - `sendEmail` forwards `options.attachments` to nodemailer's `mail.attachments`.
  - `sendPolicyCode` passes `attachments` through from `policyInstallEmail` to `sendEmail`.
- **Validation:** none changed (recipient `email` validator unchanged).

## Requirement alignment

- **R6 (Export — "Copy HTML"):** the assignment requires a Copy-HTML export of valid,
  clean HTML. "Send code to a teammate" is an **existing extension** of R6 (emailing that
  same export). This plan keeps that extension **correct** — the teammate now receives the
  same valid HTML the Copy-HTML/preview produce, in full.
- **Gap:** none introduced. The Copy-HTML action (R6 proper) already works and is untouched.
- **Core principle (scope discipline):** no new out-of-scope surface — no scanning, no
  banner, no CMS publishing. Just a delivery-format fix on an existing action.
- Not a consent feature → the `_ga`-style release-on-accept check is **N/A**.

## Design

Three small edits, all in the backend mail path (mirrors the shared `buildPolicyHtml`
source of truth — the attachment is byte-identical to the Copy-HTML export):

1. **`utils/auth/mail.js` → `policyInstallEmail`**
   - Remove the `<pre>${escapeHtml(snippetHtml)}</pre>` block from the HTML body and the
     inlined `${snippetHtml}` from the text body.
   - Replace with instructions referencing the attached `cookie-policy.html` + a small
     note that the code is attached "so nothing gets cut off".
   - Return an added `attachments` array. Update JSDoc + return type.
   - `escapeHtml` import stays (still used for `safeUrl`).
2. **`utils/auth/mail.js` → `sendEmail`**
   - Add `attachments: options.attachments` to the nodemailer `mail` object (undefined is
     harmless — no attachment for verify/reset mails). Update JSDoc for `options.attachments`.
3. **`controllers/cookiePolicy.controller.js` → `sendPolicyCode`**
   - Destructure `attachments` from `policyInstallEmail(...)` and pass it into
     `sendEmail({ email, subject, html, text, attachments })`.

No new env vars, no DB change, no route/validator change, no frontend change.

## Design notes

- **Why attachment (not other options):** (a) hosting the images as URLs won't work — the
  `/pulse/images/:id` route is auth'd + owner-scoped, so a teammate's mail client can't load
  them; the export inlines base64 precisely so it renders anywhere. (b) Splitting/paginating
  the body is fragile and still balloons the body. An attachment decouples body size from
  snippet size entirely and gives the teammate a ready-to-open file — the natural "here's the
  code to install" UX.
- **Byte-identical output:** attachment content is the exact `html` from `buildPolicyHtml`,
  the same bytes the Copy-HTML export returns, so email and Copy-HTML stay consistent.
- **`escapeHtml` no longer wraps the snippet** — correct, because the code is now a file, not
  visible-escaped text in the body. `safeUrl` still uses `escapeHtml`.
- **`sendEmail` stays generic:** `attachments` is optional; the two Mailgen-themed mails
  (verify, reset) pass no attachments and are unaffected.
- **Error handling unchanged:** `sendEmail` still swallows transport errors, so a mail outage
  returns `200` per the existing contract.

## Prompts (instructions given to the AI)

- "there is a bug in the add policy to site generating html code is working but the code that
  send through send to teammate is cut … give what was the reason that happened" (diagnosis:
  Gmail ~102 KB body clipping from the large inline base64 image).
- "how to fix it whenever i click code it should get the code" → the teammate must receive the
  complete code.
- "now fix it with attachment approach."
- "use the skills make a plan do task based on skills that should be activated on conditions."

## Tasks

1. `policyInstallEmail`: drop inline `<pre>`/text snippet, add attachment-pointing copy, return
   `attachments` array; update JSDoc — files: `backend/src/utils/auth/mail.js` — satisfies: R6
2. `sendEmail`: forward `options.attachments` to nodemailer `mail`; update JSDoc — files:
   `backend/src/utils/auth/mail.js` — satisfies: R6
3. `sendPolicyCode`: pass `attachments` from `policyInstallEmail` into `sendEmail` — files:
   `backend/src/controllers/cookiePolicy.controller.js` — satisfies: R6
4. Run Prettier on the two changed backend files.
5. Verify: boot backend, send-code smoke (existing smoke covers the route); confirm `200` and
   that the composed mail carries an `attachments[0].filename === 'cookie-policy.html'`.

## Acceptance criteria

- [ ] `POST …/cookie-policy/send-code` still returns `200` with the same success envelope.
- [ ] The sent email carries a `cookie-policy.html` attachment whose content is byte-identical
      to the `GET …/cookie-policy/html` export (`buildPolicyHtml`).
- [ ] The email **body** no longer contains the full snippet (no `<pre>` code block) and is
      well under Gmail's ~102 KB clip threshold regardless of image size.
- [ ] A policy containing a large base64 image is delivered **in full** (via the attachment),
      not clipped.
- [ ] Verify/reset emails are unaffected (no attachment, still themed).
- [ ] Route/request/response contract unchanged (no OpenAPI request/response change needed).

## Supporting documentation

- Related plan: `backend/cookiegenerator-plan/send-code-to-teammate.md` (the feature this fixes).
- Related plan: `backend/cookiegenerator-plan/image-serve-bytes-drop-presigned.md` and
  `s3-image-storage.md` (why images are inlined as base64 in the export).
- Code: `backend/src/utils/auth/mail.js`, `backend/src/controllers/cookiePolicy.controller.js`,
  `backend/src/utils/cookiePolicy/policyHtml.js` (`renderPolicyHtml`/`buildPolicyHtml`).
- nodemailer `attachments` API: `{ filename, content, contentType }`.

## Notes / changelog

- <date TBD> — draft written (PLAN mode). Awaiting user approval before implementation.
- <date TBD> — implemented (IMPLEMENT mode). 3 edits: `policyInstallEmail` now returns
  `attachments` (cookie-policy.html) and a snippet-free body; `sendEmail` forwards
  `attachments` to nodemailer; `sendPolicyCode` passes them through. Prettier clean.
  **Verified** (functional check on the composed mail, 300 KB base64 image): body has no
  `<pre>` and is 1,776 bytes (< 102 KB Gmail clip limit); attachment is `cookie-policy.html`
  (`text/html`, 300,103 bytes) and byte-identical to the snippet. Full regression smoke
  (needs running server + DB) deferred to ship — route/request/response contract unchanged,
  so no smoke-affecting change.
