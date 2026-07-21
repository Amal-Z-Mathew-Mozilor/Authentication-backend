# Plan: Public image URLs in the exported/emailed policy (replace inline base64)

- **Slug:** public-image-url-export
- **Scope:** frontend + backend (single plan, stored in backend repo) — **backend-only change**
- **Status:** ~~draft~~ → ~~approved~~ → **implemented** (awaiting manual check + ship)

## Objective / feature request

Stop inlining cookie-policy images as base64 `data:` URIs in the generated/exported/emailed
HTML. Instead reference each image by an **absolute public URL** served by a new
**unauthenticated** backend route that streams the bytes from the **still-private** S3 bucket.
Result: a small snippet that renders on any host and inside email, while S3 stays private.

## Specifications

- **New public route:** `GET /pulse/public/images/:id`
  - **No `jwtValidation`, no ownership check.**
  - Validates the `:id` is a UUID (else `404`).
  - Looks up the image by id **only** (no user join), reads its S3 object bytes
    (`getObjectBuffer`), streams them with `Content-Type: image/png|jpeg` and a **public**
    cache header: `Cache-Control: public, max-age=31536000, immutable`.
  - Non-existent id / unreadable S3 object → `404`.
- **Export/email rendering** (`renderPolicyHtml` / `buildPolicyHtml`):
  - No longer fetches bytes or builds `imagesById`.
  - Rewrites each `/pulse/images/<id>` reference in the saved content to the **absolute**
    public URL `${PUBLIC_BASE_URL}/pulse/public/images/<id>`.
  - `PUBLIC_BASE_URL` is the backend's public origin (e.g. `https://api.example.com`),
    no trailing slash.
- **Config:** new env var `PUBLIC_BASE_URL` (top-of-file const, per project convention).
- **Unchanged:** the authenticated `GET /pulse/images/:id` route stays exactly as-is for the
  in-app editor/preview (owner-scoped, `private` cache). The send-code email keeps delivering
  the snippet as the `cookie-policy.html` attachment (now tiny; images resolve via public URL).
- **API contract:** `send-code` and `cookie-policy/html` request/response envelopes unchanged;
  one **new** public GET route is added (→ OpenAPI update).

## Requirement alignment

- **R6 (Export — "Copy HTML"):** still produces valid, clean, semantic HTML matching the
  preview, now lighter (no base64 bloat).
- **Gap (important — R6 portability regression):** with base64, the export was **self-contained**
  and rendered on any host with **no dependency** on Pulse being reachable. With public URLs the
  images only render when `PUBLIC_BASE_URL` is a **publicly deployed, reachable** backend over
  HTTPS. So the pasted policy's images now **depend on the backend being up and public** — a
  weaker guarantee than base64. On `localhost` (current state) images will **not** render for a
  teammate or on their public site. This is the explicit trade-off the user accepted.
- **Core principle (scope discipline):** no out-of-scope surface (no scanning/banner/CMS). Just
  changing image delivery of an existing export.
- Not a consent feature → `_ga` release-on-accept check **N/A**.

## Design

Backend only. Files:

1. **`.env` / `.env.example`** — add `PUBLIC_BASE_URL` (e.g. `http://localhost:8000` for dev,
   the deployed origin in prod).
2. **`src/repositories/policyImage.repository.js`** — add `findKeyById(id)` returning
   `{ key, mime }` for an image by id **without** the owner join (the public route has no user).
3. **`src/controllers/image.controller.js`** — add `getPublicImage` (UUID guard → `findKeyById`
   → `getObjectBuffer` → stream bytes with `Content-Type` + `public` immutable cache). Mirrors
   `getImage` but no owner lookup and a `public` (not `private`) cache header.
4. **`src/routes/image.routes.js`** (or a new `public` router) — export a
   `public_image_route` with `GET /:id → getPublicImage` and **no** `jwtValidation`.
5. **`src/app.js`** — mount `public_image_route` at `/pulse/public/images` (a sibling of the
   auth'd `/pulse/images` mount).
6. **`src/utils/cookiePolicy/policyHtml.js`** — `renderPolicyHtml` gains a `publicBase` option;
   the final replace rewrites `/pulse/images/<id>` → `${publicBase}/pulse/public/images/<id>`
   (instead of substituting a base64 data URI). Update JSDoc.
7. **`src/controllers/cookiePolicy.controller.js`** — `buildPolicyHtml` drops the byte-fetch /
   `imagesById` loop and passes `publicBase = PUBLIC_BASE_URL`; remove the now-unused
   `getObjectBuffer` import. `PUBLIC_BASE_URL` read as a top-of-file const.
8. **Docs:** `backend/CLAUDE.md` (Images section + new mount) and `backend/openapi.yaml`
   (document `GET /pulse/public/images/:id`).

No DB schema change, no frontend change.

## Design notes

- **S3 stays private.** The public route reads the private bucket **server-side** with the
  app's IAM creds (same `getObjectBuffer` as `getImage`) and streams bytes — there is **no**
  presigned URL and the bucket is never made public. Only the _app endpoint_ is unauthenticated.
- **Security trade-off (reverses `secure-image-route.md`).** That plan deliberately made image
  serving auth'd + owner-scoped. This adds a parallel **public** endpoint: anyone with the
  `/pulse/public/images/<uuid>` link can fetch the bytes — no auth, no ownership. Mitigations:
  (a) ids are **UUIDv4** (unguessable, not enumerable); (b) these are cookie-policy images that
  are **published on a public policy page anyway**, so they are effectively public by intent.
  Risk: never let private/sensitive images into cookie-policy uploads — they'd be link-reachable.
  The authenticated route is kept for in-app use, so this does not weaken the editor/preview.
- **Deploy dependency.** Public URLs only render for others once `PUBLIC_BASE_URL` points at a
  publicly reachable HTTPS backend. Until the backend is deployed, exported/emailed images break
  off-machine — documented, and the reason base64 was the safer default while local-only.
- **Rejected: public S3 / CloudFront URL.** Would require making S3 objects public — conflicts
  with the private-bucket requirement. The public _app route_ keeps the bucket private.
- **Rejected: keep base64 for Copy-HTML, public URL only for email.** Simpler portability story
  but splits the two outputs (they're intentionally byte-identical today) and still needs the
  public route for email. Chose one consistent delivery per the user's ask; can revisit.
- **Email body.** Because images are now public URLs, the snippet is small, so the send-code
  email shows the code **inline in a `<pre>` code box** (no clipping) — the `cookie-policy.html`
  attachment from `send-code-email-attachment.md` was reverted (that plan is superseded).

## Prompts (instructions given to the AI)

- "if i return as bytes will i be able to render or is it not possible" / "if we put bytes in
  image element is it possible instead of base64" / "so i can put my uri as direct?" / "ooh so
  if i put a public url instead of it is it possible" / "so is it possible in my site" / "but my
  s3 is private?" — established: `<img>` can't carry raw bytes (only URL or base64 data URI); a
  direct auth'd URL only works in-app; a **public app route** works and keeps S3 private; it only
  renders off-machine once the backend is publicly deployed.
- "ok make a plan and implement it? first make plan."

## Tasks

1. Add `PUBLIC_BASE_URL` to `.env` and `.env.example` — files: `backend/.env`,
   `backend/.env.example` — satisfies: R6
2. `policyImageRepository.findKeyById(id)` → `{ key, mime }` (no owner join) — files:
   `backend/src/repositories/policyImage.repository.js` — satisfies: R6
3. `getPublicImage` controller (UUID guard, stream bytes, `public` cache) — files:
   `backend/src/controllers/image.controller.js` — satisfies: R6
4. `public_image_route` (`GET /:id`, no jwt) + mount at `/pulse/public/images` — files:
   `backend/src/routes/image.routes.js`, `backend/src/app.js` — satisfies: R6
5. `renderPolicyHtml`: rewrite `/pulse/images/<id>` → `${publicBase}/pulse/public/images/<id>`
   (drop base64 substitution); add `publicBase` option + JSDoc — files:
   `backend/src/utils/cookiePolicy/policyHtml.js` — satisfies: R6
6. `buildPolicyHtml`: pass `publicBase = PUBLIC_BASE_URL` (top-of-file const), drop the
   byte-fetch/`imagesById` loop, remove unused `getObjectBuffer` import — files:
   `backend/src/controllers/cookiePolicy.controller.js` — satisfies: R6
7. Update `backend/CLAUDE.md` (Images + mount) and `backend/openapi.yaml` (new public route) —
   files: `backend/CLAUDE.md`, `backend/openapi.yaml` — satisfies: R6
8. Prettier on all changed backend files.
9. Verify (below); extend `backend/scripts/smoke.js` with a public-image fetch if it exercises
   the export, then run smoke once.

## Acceptance criteria

- [ ] `GET /pulse/public/images/:id` returns the image bytes with `200`, correct `Content-Type`,
      and `Cache-Control: public, …` — **without** any auth cookie.
- [ ] Bad/unknown id or unreadable S3 object → `404`.
- [ ] `GET …/cookie-policy/html` output contains `${PUBLIC_BASE_URL}/pulse/public/images/<id>`
      absolute URLs and **no** `data:image` base64.
- [ ] The exported snippet is small (no base64), regardless of image count/size.
- [ ] The authenticated `GET /pulse/images/:id` (editor/preview) is unchanged and still
      owner-scoped with `private` cache.
- [ ] S3 bucket remains private (no public-object change, no presigned URL).
- [ ] `openapi.yaml` documents the new public route; `CLAUDE.md` reflects it.
- [ ] Documented: images only render off-machine when `PUBLIC_BASE_URL` is a publicly reachable
      HTTPS backend (localhost caveat noted).

## Supporting documentation

- Reverses/《extends》: `backend/cookiegenerator-plan/secure-image-route.md` (the auth'd route).
- Related: `backend/cookiegenerator-plan/image-serve-bytes-drop-presigned.md`,
  `s3-image-storage.md`, `send-code-email-attachment.md`.
- Code touch points: `image.controller.js`, `image.routes.js`, `app.js`,
  `policyImage.repository.js`, `utils/cookiePolicy/policyHtml.js`,
  `controllers/cookiePolicy.controller.js`, `utils/aws/s3.js` (`getObjectBuffer`).

## Notes / changelog

- <date TBD> — draft written (PLAN mode). Awaiting user approval before implementation.
  **Open decision for reviewer:** accept the R6 portability regression (images now depend on a
  publicly reachable backend) and the public-endpoint security trade-off? If not, the safer
  alternative is to keep base64 for the pasteable Copy-HTML export and use public URLs only
  where size matters.
- <date TBD> — implemented + approved (IMPLEMENT mode). Backend edits per Tasks 1–7:
  `PUBLIC_BASE_URL` env (+ `.env`/`.env.example`), `policyImage.repository.findKeyById`,
  `getPublicImage` controller, `public_image_route` mounted at `/pulse/public/images`,
  `renderPolicyHtml` public-URL rewrite (base64 substitution removed), `buildPolicyHtml`
  simplified (dropped byte-fetch + `getObjectBuffer`/`policyImageRepository` imports),
  OpenAPI + CLAUDE.md updated. Prettier clean; `node --check` clean on all changed files.
  **Verified:** (a) `renderPolicyHtml` rewrites `/pulse/images/<id>` → absolute
  `${PUBLIC_BASE_URL}/pulse/public/images/<id>`, no base64, 555-byte snippet; (b) live boot on
  :8010 — `GET /pulse/public/images/<bad>` and `<unknown-uuid>` return **404 with no auth**
  (JSON `image not found`), while the authed `/pulse/images/:id` returns **401** without a
  cookie. OpenAPI lint: only pre-existing house-style warnings/errors (public routes omit
  `security` by design); no new error introduced. Full route smoke (needs seeded image + S3)
  deferred to ship — public route mirrors the proven `getImage` path minus auth.
- <date TBD> — follow-up (user request): since public URLs make the snippet small, **dropped the
  `cookie-policy.html` attachment and inlined the code in a `<pre>` box** in the send-code email
  (`policyInstallEmail` reverted to inline; `attachments` plumbing removed from `sendEmail` and
  `sendPolicyCode`). Supersedes `send-code-email-attachment.md`. Verified: `policyInstallEmail`
  returns `{ subject, html, text }` (no attachments), body has the escaped snippet in `<pre>`,
  1.9 KB. OpenAPI + CLAUDE.md send-code descriptions updated to inline.
