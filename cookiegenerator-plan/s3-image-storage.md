# Plan: Migrate cookie-policy images from Postgres bytea to Amazon S3

- **Slug:** `s3-image-storage`
- **Scope:** frontend + backend (single plan, stored in backend repo per plan-template) —
  **backend-only code change**; **no frontend change** and **no change to any output
  format or API response shape**.
- **Status:** implemented (awaiting user manual check → ship)

## Objective / feature request

Store editor-uploaded images in **Amazon S3** instead of Postgres `bytea`. On upload,
generate an S3 key (`policy-images/<uuid>.<ext>`), `PutObject` the bytes to a **private**
bucket, and store the **key** (not the bytes) in `policy_images`. Every image access mints
a **fresh presigned GET URL** from that key. **The app must behave exactly as it does now**
— same URLs, same editor/preview rendering, same base64 HTML export, same auth/ownership.

## Specifications

### Unchanged (must stay identical)
- The frontend keeps using `<img src="/pulse/images/:id">` — **stored content and every
  response shape are untouched** (upload still returns `{ data: { url: "/pulse/images/<id>" } }`).
- Auth + ownership on `GET /pulse/images/:id` (from `secure-image-route`): `jwtValidation`
  + join to `websites.userId`; not-owned/nonexistent → `404`.
- HTML export still emits **base64-inlined** images (byte-identical output).
- Orphan cleanup still scoped by `cookie_policy_id`; cascade on policy/website delete.

### Changed (storage layer only)
1. **DB (`policy_images`):** drop `data` (bytea); add `key` (`varchar`, `notNull`). Keep
   `id`, `cookie_policy_id`, `mime`, `byte_size`, `created_at`.
2. **Upload (`uploadImage`):** multer memory buffer → magic-byte `sniffMime` (as today) →
   `ext = png|jpg` from mime → `key = policy-images/<uuidv4>.<ext>` → `PutObject`(bucket,
   key, buffer, `ContentType: mime`) → insert row `{ cookiePolicyId, key, mime, byteSize }`
   → return `{ url: "/pulse/images/<row.id>" }` (**unchanged shape**).
3. **Serve (`getImage`):** owner-scoped lookup by `:id` → get `key` → **mint a presigned
   GET URL** (`presignGetUrl(key, ~300s)`) → **`res.redirect(302, url)`**. The browser
   follows the 302 to the private bucket via the presigned URL and renders the image. A
   presigned URL is thus created **per request, per image access**, everywhere. (No JSON
   return — that would break `<img>` and change the frontend. `Cache-Control: no-store` on
   the redirect so a fresh URL is minted each load.)
4. **Export (`buildPolicyHtml` in `cookiePolicy.controller.js`):** when inlining images,
   fetch the bytes **from S3** via `getObjectBuffer(key)` → base64 data URI (same output).
5. **Orphan cleanup (`sweepOrphanImages`):** select orphan rows' `{ id, key }` for the
   policy → `DeleteObject(key)` for each → delete the rows. Still scoped to
   `cookie_policy_id`.

### Config
- Env (STANDARD names so the AWS SDK v3 auto-loads them): `AWS_ACCESS_KEY_ID`,
  `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `S3_BUCKET`; optional `S3_PRESIGN_EXPIRY`
  (default `300`), `S3_ENDPOINT` (LocalStack/MinIO only — not for real AWS).
  - **User's `.env` fix required:** existing `AWS_ACCESS_KEY` → `AWS_ACCESS_KEY_ID`;
    `AWS_ACCES_SECRET_KEY` (typo) → `AWS_SECRET_ACCESS_KEY`; add `AWS_REGION` + `S3_BUCKET`.
  - **No `compose.yaml` change needed** — the backend service already uses
    `env_file: .env`, so these vars reach the container. Only document them in `.env.example`.
  - AWS side: a **private** bucket must exist; the IAM creds need
    `s3:PutObject`/`s3:GetObject`/`s3:DeleteObject` on `arn:aws:s3:::<bucket>/*`.
- Deps already installed (`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `uuid`) —
  commit `package.json`/`package-lock.json` **with this feature**; rebuild the Docker image
  (deps are baked, not volume-mounted).

## Requirement alignment

- **R2 (3-step wizard incl. rich Description with images)** and **R6 (Copy HTML)**: this
  keeps both working exactly as specified — it's an **infrastructure migration**, not a
  behaviour change. No deliverable or acceptance criterion changes.
- **Gap:** none — output/behaviour identical by design.
- **Scope / out-of-scope:** in scope (part of the generator's image handling). Touches no
  consent/banner/scanning surface → the `_ga`-release check **does not apply**.

## Design

**New — `backend/src/utils/s3.js`:** construct one `S3Client` from env (region, creds,
optional `endpoint` + `forcePathStyle` for LocalStack). Export:
- `uploadObject(key, body, contentType)` → `PutObjectCommand`.
- `getObjectBuffer(key)` → `GetObjectCommand`, stream → `Buffer` (for base64 export).
- `deleteObject(key)` → `DeleteObjectCommand`.
- `presignGetUrl(key, expiresIn)` → `getSignedUrl(client, new GetObjectCommand(...))`.
- `S3_BUCKET` and an `s3Enabled()` guard (true when bucket+creds present).

**`models/policy_images.js`:** `data` → removed; `key: varchar('key',{length:1024}).notNull()`.

**`controllers/image.controller.js`:**
- `uploadImage`: as spec §2; import `uploadObject`, `uuid`, `S3_BUCKET`.
- `getImage`: keep the owner-scoped join but select `key` (not `data`); mint presigned →
  `302`. Keep the `UUID_RE` pre-check and 404s.

**`controllers/cookiePolicy.controller.js` (`buildPolicyHtml`):** the image-inlining loop
now `await getObjectBuffer(row.key)` → `data:${mime};base64,${buf.toString('base64')}`.
(Load `{ id, key, mime }` for referenced images instead of `{ id, mime, data }`.)

**`utils/cookiePolicy.js` (`sweepOrphanImages`):** select `{ id, key }` of the policy's
images; for orphans, `await deleteObject(key)` then delete rows (batch as today). Best-effort
on S3 delete (log, don't fail the save) so a transient S3 error can't block editing.

**Existing images (bytea) — decision LOCKED (user):** remove existing images (not needed)
and **reset each policy's content to the default seed** so nothing references an old image.
Concretely, during the migration step: `deleteCookiePolicy`-style reset of every
`cookie_policy.content` to `defaultCookieContent(today)` (the defaults reference no images)
and **truncate `policy_images`**, then `drizzle-kit push` (drop `data`, add `key` notNull) —
no backfill, no dangling references, no broken `<img>`.

**Smoke (`scripts/smoke.js`):** guard the S3-dependent image checks behind `s3Enabled`
(skip with a logged note when `S3_BUCKET` unset, so smoke still runs without S3):
- upload → `201` + `/pulse/images/<id>` url (unchanged).
- serve (authed owner, `fetch(url,{redirect:'manual'})`) → **`302`** with `Location`
  containing the bucket/key (don't follow to S3).
- keep no-auth → `401`, cross-user → `404`.
- export still contains `data:image/…;base64,` (bytes now from S3).

## Design notes

- **302 redirect is what preserves "no output change."** The stored `/pulse/images/:id`
  URL, the upload response, and the frontend are all untouched; only what happens *inside*
  the GET changes (bytea read → presign + redirect). Returning the URL as JSON would force
  a frontend rewrite and change behaviour — explicitly rejected.
- **Private bucket + per-request presign** matches the earlier discussion: the raw S3 URL
  is never public or stored; each access gets a short-lived signed URL. The app endpoint
  stays the guarded, owner-scoped gate in front of it.
- **Export uses server-side `GetObject`, not presign** — the backend reads bytes directly
  (it has creds) to build base64; presigned URLs are only for handing the browser temporary
  access. Export output stays byte-identical.
- **`no-store` on the redirect** avoids a browser caching a soon-expired presigned URL and
  reusing it after expiry; each `<img>` load re-hits the endpoint and gets a fresh URL.
- **S3 delete is best-effort** in cleanup so image editing never fails on a transient S3
  hiccup; a rare orphaned S3 object is harmless (and a lifecycle rule could sweep it later).
- **`byte_size`/`mime` kept** — still useful for `ContentType` and diagnostics; no reason to
  drop them.
- **Smoke now needs S3** for the image path; the `s3Enabled` skip keeps the auth/website/
  policy regression suite runnable without AWS, while the image checks run wherever S3 is
  configured (real test bucket or LocalStack via `S3_ENDPOINT`).

## Prompts (instructions given to the AI)

> "create a plan for s3 migration — the app should work as it works now, no change in any
> output format. create a key like `policy-images/<uuid>.png` and send to s3 and store it in
> db; based on that key the presigned url is created for every img access in every place.
> create a get image method where we create a presigned url and give it back to the image
> element and the image is created."

## Tasks

1. `utils/s3.js`: S3 client + `uploadObject`/`getObjectBuffer`/`deleteObject`/`presignGetUrl`
   + `S3_BUCKET`/`s3Enabled` — files: `backend/src/utils/s3.js` — satisfies: R2/R6
2. `models/policy_images.js`: drop `data`, add `key` (notNull); apply via `drizzle-kit push`
   (after the migration decision) — files: `backend/src/models/policy_images.js` — satisfies: R2
3. `uploadImage`: key `policy-images/<uuid>.<ext>` → `PutObject` → store key (unchanged
   response) — files: `backend/src/controllers/image.controller.js` — satisfies: R2
4. `getImage`: lookup key (owner-scoped) → presign → `302` redirect (`no-store`) — files:
   `backend/src/controllers/image.controller.js` — satisfies: R2
5. `buildPolicyHtml`: inline base64 from S3 `getObjectBuffer(key)` — files:
   `backend/src/controllers/cookiePolicy.controller.js` — satisfies: R6
6. `sweepOrphanImages`: `deleteObject(key)` for orphans, then delete rows — files:
   `backend/src/utils/cookiePolicy.js` — satisfies: R2
7. Config: document AWS_*/S3_* in `.env.example`; commit installed deps. (No `compose.yaml`
   edit — backend already `env_file: .env`.) — files: `backend/.env.example`,
   `backend/package.json`
8. Smoke: S3-guarded image checks (upload 201, serve 302→bucket, no-auth 401, cross-user 404,
   export base64) — files: `backend/scripts/smoke.js`
9. Migration step (one-off, at implement): reset every `cookie_policy.content` to
   `defaultCookieContent(today)` + truncate `policy_images`, then `drizzle-kit push`
   (drop `data`, add `key` notNull) — satisfies: R2
10. Sync docs (`sync-claude-md`): backend Images section (bytea → S3 key + presigned 302) —
    at ship time.

## Acceptance criteria

- [ ] Uploading an image stores a row with an S3 **key** (`policy-images/<uuid>.<ext>`) and
      **no bytea**; the object exists in the bucket; response is the unchanged
      `{ data: { url: "/pulse/images/<id>" } }`.
- [ ] `GET /pulse/images/:id` (authed owner) returns **`302`** to a presigned S3 URL; the
      image renders in the **editor** and **preview** with no frontend change.
- [ ] No-auth → `401`; another user's image → `404` (auth/ownership preserved).
- [ ] "Copy HTML" export still produces **base64-inlined** images identical in shape to
      before (bytes now sourced from S3), matching the preview.
- [ ] Removing an image and saving deletes both the **DB row** and the **S3 object**;
      deleting/resetting the policy or website removes all its objects.
- [ ] Backend boots; `npm run smoke` passes (image checks run when S3 is configured, else
      skipped with a note).
- [ ] N/A — no consent/cookie surface touched, so the `_ga`-release check does not apply.

## Supporting documentation

- Backend: `controllers/image.controller.js` (`uploadImage`, `getImage`, `sniffMime`,
  `UUID_RE`), `models/policy_images.js`, `middlewares/upload.middleware.js` (multer memory),
  `utils/cookiePolicy.js` (`sweepOrphanImages`, `imageIdsFrom`),
  `controllers/cookiePolicy.controller.js` (`buildPolicyHtml`), `compose.yaml`, `.env.example`.
- Builds on: `secure-image-route.md` (auth/ownership on the serve route),
  `cookie-policy-image-upload.md`, `cookie-policy-orphan-image-cleanup.md`,
  `add-policy-to-site-html-format.md` (base64 export).
- AWS SDK v3: `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`.

## Notes / changelog

- Draft. Awaiting manual review/approval. Backend-only; no frontend change; no output/response
  change (302-redirect serving + base64 export preserved). Deps already installed — commit with
  this feature. Per plan-template, this doc ships **with** the feature at ship time.
- **Implemented (2026-07-10):** new `src/utils/s3.js` (S3Client + uploadObject/getObjectBuffer/
  deleteObject/presignGetUrl + S3_BUCKET/s3Enabled); `models/policy_images.js` `data`→`key`;
  `image.controller.js` upload→`PutObject`+store key, `getImage`→presign+`302` (`no-store`);
  `cookiePolicy.controller.js` `buildPolicyHtml` base64 from `getObjectBuffer(key)`;
  `utils/cookiePolicy.js` `sweepOrphanImages`→`deleteObject(key)`+row delete (best-effort);
  `.env.example` AWS/S3 vars; `smoke.js` serve checks now assert `302`→presigned. **Migration
  done:** reset all `cookie_policy.content` to default seed + cleared `policy_images`, then
  applied the schema change via raw SQL (`ALTER TABLE … DROP data / ADD key`) because
  `drizzle-kit push` needs a TTY for the drop-vs-rename prompt; container startup push then
  reports no diff. **Fixed user `.env`:** `S3_BUCKET` had a console URL → `amal-mathew-cookiepolicy`;
  `AWS_REGION` had a display label → `ap-south-1`. **Verification:** S3 put/get/presign/delete
  probe OK; container rebuilt (deps) + recreated (env); `npm run smoke` = **67 passed, 0 failed**
  (upload 201, serve 302→presigned, no-auth 401, cross-user 404, export base64 from S3, sweep
  deletes S3 objects). Deps `@aws-sdk/client-s3`/`@aws-sdk/s3-request-presigner`/`uuid` +
  package-lock ship with this feature. No frontend change.
