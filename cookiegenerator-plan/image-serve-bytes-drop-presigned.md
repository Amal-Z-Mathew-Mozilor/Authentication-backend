# Plan: Serve image bytes directly (drop presigned URLs)

- **Slug:** image-serve-bytes-drop-presigned
- **Scope:** frontend + backend (single plan, stored in backend repo)
- **Status:** draft → approved → **implemented** (shipped)

## Objective / feature request

Remove the presigned-S3-URL step from image serving **without** inlining base64 into the
saved content. Images stay referenced in the content as the small, stable
`/pulse/images/:id` URL (no bloat); the authenticated, owner-scoped `GET /pulse/images/:id`
endpoint **reads the bytes from S3 and streams them back directly** (`Content-Type:
image/png`) instead of `302`-redirecting to a short-lived presigned URL. The browser's
`<img>` renders those bytes exactly as before. The "Copy HTML" export keeps inlining base64
at export time so the exported snippet stays self-contained.

## Specifications

**What stays the same (from the current/original code):**

- Upload `POST /pulse/websites/:websiteId/images` still `PutObject`s the bytes to S3,
  inserts a `policy_images` row, and returns `{ data: { url: "/pulse/images/<id>" } }`.
- Content stores `<img src="/pulse/images/:id">` — a short reference, never the bytes.
- Orphan cleanup (`imageIdsFrom` scanning `/pulse/images/<uuid>`, `sweepOrphanImages`,
  `usedImageIds`) is unchanged.
- Copy-HTML export (`buildPolicyHtml` → `getObjectBuffer` → base64 `data:` URI) is
  unchanged — base64 is inlined only in the export.
- Frontend is unchanged: it already uses `/pulse/images/:id` and sends the auth cookie.

**What changes:**

- `GET /pulse/images/:id` (`getImage`): still auth'd (`jwtValidation`) and owner-scoped
  (join `policy_images → cookie_policy → websites → userId`; missing/malformed/not-owned →
  `404`). On success it **reads the object bytes from S3 and sends them** with
  `Content-Type: <row mime>` and a cache header — **no presigned URL, no `302`**.
- The image lookup must return the row's `mime` (currently only `key`) so the response
  `Content-Type` is correct.
- All presigned code is removed (`presignGetUrl`, the presigner import, `S3_PRESIGN_EXPIRY`).
  `getObjectBuffer` (already used by the export) is **kept** and now also feeds `getImage`.

**Response contract for `GET /pulse/images/:id`:**

- `200` — body = raw image bytes; `Content-Type: image/png` or `image/jpeg`;
  `Cache-Control: private, max-age=31536000, immutable` (a given id maps to a fixed,
  never-changing object; `private` because it's owner-scoped).
- `401` — no/invalid auth cookie. `404` — malformed id, or not found / not owned.

## Requirement alignment

- **R4 (Preview renders as a real page):** unchanged behaviour — images render; the
  transport is a direct byte response instead of a presigned redirect.
- **R6 (Export — "Copy HTML", self-contained, matches preview):** unchanged — the export
  still inlines base64 so the pasted snippet needs no server. Preview and export stay in
  parity.
- **Core principle (scope discipline):** internal refactor of an existing enhancement; no
  new product surface. Consent/`_ga` release-on-accept check is **N/A**.
- **Gaps:** none. This does not regress any acceptance criterion; it removes an external
  dependency (time-limited presigned URLs) while keeping the private bucket private.

## Design

**Backend (the whole change is ~3 files):**

1. `src/controllers/image.controller.js` — rewrite `getImage`:
   - Keep the `UUID_RE` guard and the owner-scoped lookup, but select `{ key, mime }`.
   - Replace `presignGetUrl(...)` + `res.redirect(302, url)` with:
     `const buf = await getObjectBuffer(img.key)` →
     `res.set('Content-Type', img.mime)` →
     `res.set('Cache-Control', 'private, max-age=31536000, immutable')` →
     `res.send(buf)`.
   - If the S3 object can't be read, respond `404` (treat as missing).
   - Swap the import `presignGetUrl` → `getObjectBuffer`.
2. `src/repositories/policyImage.repository.js` — `findKeyByIdForUser`: add `mime` to the
   selected projection (`{ key, mime }`); update its JSDoc `@returns`.
3. `src/utils/aws/s3.js` — remove `presignGetUrl`, the
   `@aws-sdk/s3-request-presigner` import, and `S3_PRESIGN_EXPIRY`. **Keep**
   `getObjectBuffer`, `uploadObject`, `deleteObject`, and the `GetObjectCommand` import
   (still used by `getObjectBuffer`). Update the file header comment (private bucket, bytes
   proxied by the app; no presigned URLs).

**Smoke test:** `scripts/smoke.js` — the image-serve assertions change from presigned to
direct bytes:

- `image serve (authed owner)` → expect `200` **and** `Content-Type` starts with `image/`
  (was: `302` with an `X-Amz-` location).
- Orphan "kept" checks → expect `200` (was `302`); "swept" checks stay `404`.
- The `redirect: 'manual'` in the `getImg` helper can stay (harmless) or be dropped.

**Frontend:** no changes.

**Docs (ship time):** `backend/CLAUDE.md` + `frontend/CLAUDE.md` Images notes (presigned →
direct byte serve) and `openapi.yaml` (`GET /pulse/images/:id` now `200 image/*`, not a
`302`).

## Design notes

- **Why the GET returns bytes, not a base64 string:** an `<img src="/pulse/images/:id">`
  fetches the URL and renders the **response body as raw image bytes**. It does **not**
  decode a base64 string sitting in the body — that yields a broken image. So the endpoint
  must send bytes with an image `Content-Type`. Base64 only renders when it is _in the
  `src`_ as a `data:` URI, which is the export's job — not the editor transport's.
- **Why not inline base64 into the content (the rejected approach):** it bloats three
  layers — the request body (Express's 100kb `express.json` default → `413 request entity
too large`), the section validator (`description` length cap → `422`), and every
  `cookie_policy` row + policy GET response (~33% larger than the raw image, shipped on
  every load). Keeping a short `/pulse/images/:id` reference avoids all three. (This is the
  bug that surfaced in testing and prompted this design.)
- **Trade-off vs presigned:** serving bytes proxies them **through the backend** (app
  bandwidth/CPU) instead of offloading the transfer to S3 via a redirect. For this app's
  small policy logos and low traffic that's fine, and it's simpler: the bucket stays fully
  private with **no** time-limited URLs to mint or expire. The `immutable` cache header
  means the browser fetches each image once (better than the old presigned path, which used
  `no-store` because the URL expired).
- **`getObjectBuffer` is now shared** by the export and the serve endpoint — one code path
  for "read an image's bytes from S3".

## Prompts (instructions given to the AI)

> "i want to remove presigned url … whenever there is a img element it uses a get method"
> — then, after hitting `413`/`422` from an earlier base64-in-content attempt:
> "ok this is where s3 is needed and get image method is needed whenever image element
> calls this function then only it should return [the image] so that it can be rendered".
> Correction folded into this plan: the GET returns image **bytes**, not a base64 string.
> Then: "go back to version when this feature was not done then modify the plan and let me
> look through it."

## Tasks

1. `getImage`: serve bytes from S3 (`getObjectBuffer` + `Content-Type` from mime + immutable
   cache header), drop the presigned `302`; swap the import — files:
   `backend/src/controllers/image.controller.js` — satisfies: R4
2. `findKeyByIdForUser`: add `mime` to the projection — files:
   `backend/src/repositories/policyImage.repository.js` — satisfies: R4
3. Remove presigned code/env from the S3 util (`presignGetUrl`, presigner import,
   `S3_PRESIGN_EXPIRY`); keep `getObjectBuffer`/`GetObjectCommand` — files:
   `backend/src/utils/aws/s3.js` — satisfies: R4
4. Update smoke image-serve assertions (presigned `302` → `200` + `image/*`; kept `302` →
   `200`) — files: `backend/scripts/smoke.js` — satisfies: R8
5. Sync `backend/CLAUDE.md` + `frontend/CLAUDE.md` + `openapi.yaml` (ship time) — files:
   `backend/CLAUDE.md`, `frontend/CLAUDE.md`, `backend/openapi.yaml` — satisfies: R7/R8

## Acceptance criteria

- [ ] Editor/preview `<img src="/pulse/images/:id">` renders; `GET /pulse/images/:id`
      returns `200` with `Content-Type: image/png|jpeg` and the raw bytes.
- [ ] No presigned URL is minted anywhere; no `X-Amz-*` appears in any response.
- [ ] Saved content stores only the `/pulse/images/:id` reference (no base64), so saving a
      section that contains an image does **not** return `413` or `422` (the bug is gone).
- [ ] Copy-HTML export is still self-contained (base64 inlined at export; no `/pulse/images`
      URL left in the exported snippet) and matches the preview (R6).
- [ ] Orphan cleanup unchanged: removing an image + save sweeps the S3 object + row; an
      on-screen image is kept (smoke "kept"/"swept" checks pass).
- [ ] `GET /pulse/images/:id` without auth → `401`; another user's image → `404`. App boots;
      `npm run smoke` passes.
- [ ] `_ga`/release-on-accept check: **N/A** (no consent surface touched).

## Supporting documentation

- Related plan docs: `backend/cookiegenerator-plan/s3-image-storage.md`,
  `backend/cookiegenerator-plan/cookie-policy-orphan-image-cleanup.md`.
- Code touchpoints: `image.controller.js` (`getImage`), `policyImage.repository.js`
  (`findKeyByIdForUser`), `utils/aws/s3.js` (drop `presignGetUrl`, keep `getObjectBuffer`),
  `cookiePolicy.controller.js` (`buildPolicyHtml` — unchanged), `scripts/smoke.js`.
- Superseded approach: the earlier base64-in-content plan (`image-base64-data-uri.md`,
  removed) — abandoned because inline base64 caused `413`/`422` and DB bloat.

## Notes / changelog

- <draft> Plan written for review. Replaces the abandoned base64-in-content approach after
  it hit `413 request entity too large` (body limit) and `422` (description length cap) in
  testing. All base64-in-content code was reverted; the running backend was rebuilt back to
  the original presigned version. Awaiting manual review/approval before implementation.
- <approved> User approved ("implement the plan").
- <implemented> Backend only (no frontend changes). `getImage` now reads bytes via
  `getObjectBuffer` and `res.send`s them with `Content-Type` + `Cache-Control: private,
max-age=31536000, immutable`; the presigned `302` is gone. `findKeyByIdForUser` projection
  gains `mime`. `s3.js` drops `presignGetUrl` + the presigner import + `S3_PRESIGN_EXPIRY`
  (keeps `getObjectBuffer`/`GetObjectCommand`). smoke image-serve assertions updated (presigned
  `302` → `200` + `image/*`; kept `302` → `200`). Upload, content refs, export base64-inlining,
  orphan cleanup, validators, and body limit all unchanged.
- <verified> Backend rebuilt in Docker; **`npm run smoke` → 69 passed, 0 failed** (all 9 image
  checks pass; authed serve returns `200 image/png` bytes, no redirect). This is the single
  pre-ship smoke run — verify-and-ship should reuse it (no code changed since).
- <shipped> verify-and-ship: SYNTAX pass, BOOT pass, SMOKE 69/69 (reused — backend unchanged
  since the run). Docs synced: `backend/CLAUDE.md` (Stack, Structure, Images, Environment),
  `frontend/CLAUDE.md` (images endpoint row corrected: authenticated + owner-scoped byte serve,
  was mislabelled "public"), and `openapi.yaml` (cache/no-presigned detail refined; it already
  documented byte-serving). Committed backend (code + plan + docs) and frontend (CLAUDE.md) to
  `main`. No frontend code changes (local-preview reverted; its plan was never committed).
