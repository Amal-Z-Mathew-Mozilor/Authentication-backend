# Plan: Cookie Policy — real image upload (Description editor)

- **Slug:** cookie-policy-image-upload
- **Scope:** frontend + backend (single plan, stored in backend repo)
- **Status:** implemented

## Objective / feature request

Make the Description editor's image button a real uploader: clicking it opens the
OS file picker (Finder) limited to **.png / .jpg**, uploads the file, and shows it
**inline** in the editor. Store the image **in Postgres** and map it to the owning
cookie policy so it cascades on delete.

## Specifications

**New table `policy_images`:**
| column | type | notes |
|--------|------|-------|
| id | uuid PK | `defaultRandom()` |
| cookie_policy_id | uuid | not null, FK → `cookie_policy.id`, `onDelete: cascade` |
| mime | varchar(32) | `image/png` or `image/jpeg` |
| data | **bytea** | raw file bytes (Drizzle `customType`) |
| byte_size | integer | informational |
| created_at | timestamptz | `defaultNow()` |

**API:**
| Method | Path | Body | Success |
|--------|------|------|---------|
| POST | `/pulse/websites/:websiteId/images` | multipart `file` | `201` `{ data: { url: "/pulse/images/<id>" } }` |
| GET | `/pulse/images/:id` | — | `200` streams the bytes with `Content-Type: <mime>` (public read by UUID) |

- **Upload** (`jwtValidation`): verify the website is owned by `req.user.id`;
  **find-or-create** the `cookie_policy` row for that website (so the FK target
  exists even before the first Save); validate mime ∈ {png,jpeg} AND magic-bytes;
  insert the row; return the serve URL. Reject non-images → `415`/`422`.
- **Serve**: public GET by UUID so the `<img>` renders in the editor now and on a
  public policy page later.

**Validation:** multer memory storage, **no `fileSize` limit** (per user);
`fileFilter` allows only `image/png`/`image/jpeg`; also sniff magic bytes
(`\x89PNG`, `\xFF\xD8\xFF`) so a renamed file can't slip through.

**Behaviours:** picking a valid image uploads + inserts it inline; it persists
(served from `/pulse/images/:id`); a non-image is rejected with a clear error;
deleting the website → cookie policy → its images all cascade.

## Requirement alignment

Implements the **Image insertion/upload** capability from the `rich-text-description`
skill spec (`.claude/skills/rich-text-description/references/requirements.md`):
"upload images using the existing upload mechanism; insert the returned image URL;
display uploaded images inline." Today only the URL-insertion fallback exists — this
builds the real upload mechanism it referenced. It extends the shipped cookie-policy
**About cookies** editor; no other 2.x cookie-policy requirement is affected. Gap:
no public policy-render page yet (the public serve endpoint is forward-looking).

## Design

### Backend
- **`src/models/policy_images.js`** — table above. Add a `bytea` Drizzle type via
  `customType({ dataType: () => 'bytea' })` (small helper in the model file or
  `src/db/types.js`). Export from `src/models/index.js`.
- **`package.json`** — add **`multer`**.
- **`src/middlewares/upload.middleware.js`** — multer instance (memory storage,
  png/jpeg fileFilter, no size limit) exposing `.single('file')`.
- **`src/controllers/image.controller.js`**
  - `uploadImage` — `asyncHandler`; assert website owned (reuse the ownership check
    from `cookiePolicy.controller.js`); find-or-create `cookie_policy`; magic-byte
    check `req.file.buffer`; insert `{ cookiePolicyId, mime, data, byteSize }`;
    return `{ url: \`/pulse/images/${id}\` }`.
  - `getImage` — fetch row; `res.set('Content-Type', mime).send(row.data)`; `404` if missing.
- **Routes** — add `POST /:websiteId/images` (jwt + multer) to
  `src/routes/website.routes.js`; new `src/routes/image.routes.js` with `GET /:id`,
  mounted `app.use('/pulse/images', image_route)` in `src/app.js` (public, no jwt).
- `express.json()` is global but multer handles multipart on the upload route — no conflict.

### Frontend
- **`src/CookiePolicyPage.jsx`** — pass `onImageUpload` to `<RichTextDescription>`:
  build `FormData`, `apiFetch('/pulse/websites/'+websiteId+'/images', { method:'POST',
  body: formData })` (do NOT set Content-Type — browser sets the multipart boundary),
  read `{ data: { url } }`, return the URL; surface errors.
- **`src/RichTextDescription.jsx`** — already supports `onImageUpload(file) => url`.
  Change the picker `accept` from `image/*` to **`image/png,image/jpeg`**.
- Update skill reference `references/RichTextDescription.jsx` + the skill's Image
  section to reflect png/jpg accept + upload-via-prop.

### API docs
Add both endpoints to `backend/openapi.yaml` (multipart upload; binary serve; new
`Images` tag; reuse envelopes for the JSON upload response).

## Design notes
- **Store in Postgres `bytea`** (confirmed with user) over disk/cloud: durable via
  the existing DB volume, no extra infra, cascades with the policy. Fine at this
  scale; object storage is the move if it grows — noted as future work.
- **FK → `cookie_policy.id`** (confirmed with user; not `user_id`): images belong to
  a policy and cascade-clean with it (website → policy → images). Find-or-create the
  policy on upload so uploading before the first Save works.
- **No file-size limit** (confirmed with user). Trade-off: with `bytea`, a very large
  file grows the DB and loads fully into memory on upload/serve. Adding a cap later
  is a one-line `multer` change.
- **Public serve endpoint** (by unguessable UUID): needed so images render in the
  editor and on public pages later. Could be gated to owner if public render isn't wanted.
- **Magic-byte sniffing** beyond mime/extension so a renamed non-image can't be stored.
- Inserted HTML is `<img src="/pulse/images/:id">`; Vite proxies `/pulse` → backend in dev.

## Prompts (instructions given to the AI)
> "now upgrade the image section i am trying to build a real product so in real app
> when i click the image in description it goes to finder in my mac like in this image
> and only allow .png and .jpg to be selected and then selected element will be shown
> like this create a plan to implement this feature before planning push the repos and
> make plan in plan.md file"

Follow-ups that shaped the design:
- "is it possible in postgres?" → store bytes in Postgres (`bytea`).
- "i would say it reference id of cookie policy table on cascade delete so it is easy
  to map" → FK to `cookie_policy.id`, not `user_id`.
- "dont put limt like that" → no file-size limit.

Plus three screenshots: the image button, the macOS Finder picker (png/jpg), and a
certificate image shown inline in the editor after selection.

## Tasks
1. Backend `bytea` custom type + `policy_images` model (+ index export). — schema
2. Add `multer`; `upload.middleware.js`. — upload plumbing
3. `image.controller.js` (uploadImage find-or-create + validate; getImage stream). — API
4. Routes: `POST /:websiteId/images` in website routes; `image.routes.js` + mount `/pulse/images`. — API
5. `drizzle-kit push` (rebuild backend container). — schema apply
6. Frontend: `onImageUpload` in CookiePolicyPage (FormData via apiFetch). — wire upload
7. Frontend: `RichTextDescription` accept → png/jpeg; update skill reference. — picker + skill
8. openapi.yaml both endpoints. — docs
9. Extend `backend/scripts/smoke.js`: upload a tiny PNG → 201 + url; GET url → 200 image/png; reject a non-image → 4xx. — regression

## Acceptance criteria
- [ ] Clicking the image button opens the OS file picker limited to .png/.jpg.
- [ ] Selecting a valid image uploads it and shows it inline in the Description.
- [ ] The image persists: reload → still renders (served from `/pulse/images/:id`).
- [ ] A non-png/jpg file is rejected with a clear error, not stored.
- [ ] `policy_images` rows FK to `cookie_policy` and cascade-delete with the website/policy.
- [ ] Upload requires auth + website ownership; serve works by URL.
- [ ] openapi documents both endpoints; smoke covers upload + serve + reject.
- [ ] Verification: `node --check`; `drizzle-kit push` creates `policy_images`; boot clean;
      frontend `build` + `lint`; smoke (subagent) — existing 22 green + new image checks;
      manual: pick a PNG → inline → Save → reload → still there → delete website → image gone.

## Supporting documentation
- Screenshots: image button in the toolbar; macOS Finder picker (png/jpg filter);
  inserted certificate image shown inline.
- Reuses: `backend/src/controllers/cookiePolicy.controller.js` (ownership + find-or-create
  pattern), `frontend/src/RichTextDescription.jsx` (`onImageUpload` prop), `apiFetch.js`.
- Related: `backend/cookiegenerator-plan/cookie-policy-about-cookies.md`, `openapi.yaml`,
  skills `rich-text-description` / `plan-template` / `update-openapi` / `verify-and-ship`.

## Notes / changelog
- _draft_ — planned via plan mode; `plan-template` skill invoked to conform to the
  mandatory section set. Confirmed with user: store in Postgres `bytea`, FK to
  `cookie_policy`, no size limit. Awaiting review → implement → manual check →
  `verify-and-ship` (commits plan + feature together).
- _implemented_ — `policy_images` (bytea) + upload/serve endpoints, multer, png/jpg +
  magic-byte, openapi + smoke (26/26). Editor polish shipped alongside: block image
  selectable (blue box) + Backspace/Delete, `ResizableImage` width attr (resize not
  built), non-inclusive links, pending-mark formatting, required Heading/Description.
  Undo/Redo toolbar buttons intentionally omitted. Verified + user manually checked.
