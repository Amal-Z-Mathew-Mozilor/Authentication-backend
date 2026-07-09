# Plan: Cookie Policy — orphan image cleanup (reconcile-on-save)

- **Slug:** cookie-policy-orphan-image-cleanup
- **Scope:** frontend + backend (single plan, stored in backend repo)
- **Status:** implemented

## Objective / feature request

When a user removes an image from a Description editor and saves, the image's bytes
must be **deleted from Postgres** too. Today upload is eager (a `policy_images` row is
inserted the moment a file is picked) but removal only strips the `<img>` from the
HTML — the row is never deleted, so the DB accumulates orphaned images. Fix it so
removed images are cleaned up **immediately and safely**.

## Specifications

**No schema change.** Reuse `policy_images` (FK → `cookie_policy.id`, `onDelete: cascade`).

**Approach — reconcile ("mark-and-sweep") on save (Option B):** on every cookie-policy
save, the backend keeps only the images still referenced and deletes the rest for that
policy. The "keep set" is the **union** of:

1. every `/pulse/images/<uuid>` id referenced in the **merged DB `content`** (all saved
   sections), and
2. an **`usedImageIds` array the frontend sends** with the save — the ids currently
   present across **all** section editors (About + Use of cookies + Cookie preferences),
   derived from the live React `data` state.

Part 2 is what makes it safe: sections save individually, so a just-uploaded image in a
section the user hasn't saved yet isn't in the DB — but it *is* on screen, so the client
reports it and the backend spares it.

**API contract change (additive, backward-compatible):**

| Method | Path | Body (added field) |
|--------|------|--------------------|
| PUT | `/pulse/websites/:websiteId/cookie-policy/:section` | `{ heading, description, usedImageIds? }` |
| PUT | `/pulse/websites/:websiteId/cookie-policy` | `{ effectiveDate, usedImageIds? }` |

- `usedImageIds` — optional `string[]` of image UUIDs. Missing/empty is tolerated (the
  DB-referenced union still protects saved content). Ignored beyond the keep-set union.

**Sweep behaviour (both PUT handlers, after the merged `content` is written):**
- Collect `dbIds` = all `/pulse/images/<uuid>` ids found in `JSON.stringify(content)`.
- `keep = new Set([...dbIds, ...usedImageIds])`.
- Select this policy's `policy_images` ids; `orphans = ids not in keep`.
- If any, `DELETE ... WHERE cookie_policy_id = <id> AND id IN (orphans)`.
- Always scoped to **this policy's** `cookie_policy_id`; never touches other policies/users.

**Trust boundary:** `usedImageIds` can only *keep* rows alive (worst case: an orphan
lingers — harmless). It can never cause deletion of, or reach, another policy's images,
because the sweep is hard-scoped to the owned policy's `cookie_policy_id`.

## Requirement alignment

Supports **R7 (automatic config updates)** and the cookie-policy editor feature set
(About cookies / Use of cookies / Cookie preferences — see the sibling plan docs): it
keeps the policy's stored content and its image assets consistent as the config is edited,
preventing unbounded DB growth from orphaned uploads. Extends the shipped
`cookie-policy-image-upload` feature (that plan noted images "cascade with the policy" —
this closes the *within-a-policy* removal case it didn't cover). Core CMP principle is not
touched (no cookies are created; this is asset lifecycle management). No R1–R6/R8 behaviour
changes. **Gap:** does not garbage-collect images orphaned by *older* saves made before
this ships (pre-existing orphans) — those clear on the next save of the policy they belong
to, since the sweep runs over the whole policy each save.

## Design

### Backend — `src/controllers/cookiePolicy.controller.js`
- Add a small helper `imageIdsFrom(str)` — regex `/\/pulse\/images\/([0-9a-f-]{36})/gi`
  over a string, returns a `Set` of ids. (Same UUID shape already validated in
  `image.controller.js`.)
- Add `sweepOrphanImages(cookiePolicyId, keepIds)`:
  - `select { id } from policyImages where cookiePolicyId = …`
  - `orphans = rows.map(r => r.id).filter(id => !keepIds.has(id))`
  - if `orphans.length`, `db.delete(policyImages).where(and(eq(cookiePolicyId…), inArray(policyImages.id, orphans)))`.
- In **`putSection`**: after the insert/update of `content`, resolve the
  `cookie_policy.id` for the website, build `keep = imageIdsFrom(JSON.stringify(content))`
  ∪ `req.body.usedImageIds`, call `sweepOrphanImages`.
- In **`putPolicyMeta`**: same sweep (effectiveDate saves carry no description, but the
  frontend still sends `usedImageIds`, so this path also reconciles — keeps the two save
  routes symmetric).
- Import `inArray` (add to the existing `drizzle-orm` import) and `policyImages` (add to
  the existing `../models/index.js` import). Read the policy id via the existing
  `cookiePolicy` query already used in these handlers (it's selected/created there).
- Validate `usedImageIds` defensively: coerce to array, keep only strings matching the
  UUID shape, before unioning (don't trust client shape).

### Frontend — `src/CookiePolicyPage.jsx`
- Add a helper that scans **all** sections' current HTML for image ids:
  ```js
  const collectUsedImageIds = () =>
    [...new Set(
      Object.values(data)
        .map((s) => s.description || '')
        .join(' ')
        .match(/\/pulse\/images\/[0-9a-f-]{36}/gi) || [],
    )].map((u) => u.split('/').pop())
  ```
- In `handleSave`, include `usedImageIds: collectUsedImageIds()` in **both** PUT bodies
  (the section save and the preferences effective-date save).

### API docs — `backend/openapi.yaml`
- Document the optional `usedImageIds` field on both cookie-policy PUT request bodies
  (per the `update-openapi` skill conventions). No new paths/schemas.

### Docs — `frontend/CLAUDE.md` / `backend/CLAUDE.md`
- Note `usedImageIds` in the cookie-policy PUT rows and the reconcile-on-save cleanup in
  the Images section (via the `sync-claude-md` skill at ship time).

## Design notes
- **Eager-upload timing (why "unsaved" images are still safe).** Upload is eager: picking
  a file inserts the `policy_images` row *and* puts the `<img>` in the editor immediately —
  it just isn't in the *saved* content yet. State of a just-picked image before Save:

  | Location | State |
  |---|---|
  | `policy_images` table (bytes) | present (inserted eagerly) |
  | Live editor HTML (React `data`) | present (`<img>` in it) |
  | Saved `cookie_policy.content` | absent (only Save writes it) |

  The sweep runs **only on Save** and deletes a row only if — at that moment — it's in
  **neither** the saved content **nor** any live editor (`usedImageIds`). So a picked-but-
  unsaved image survives because either no save ran, or a save ran but the image is in
  `usedImageIds`. It's deleted only when removed from the editor *and* saved. A picked-then-
  abandoned image (tab closed) is swept on the policy's next save — self-healing.
- **Why reconcile-on-save, not a delete-endpoint on removal:** a DELETE-on-remove call
  misses reloads, undo, replacing one image with another, and closing the tab. Treating
  the saved content as the source of truth catches every removal path in one place.
- **Why the client sends `usedImageIds` (Option B) vs a DB-only sweep or a grace window:**
  sections save individually, so the DB can hold a *stale* sibling section during a save;
  a DB-only sweep would delete an image freshly dropped into an unsaved section. A
  time-based grace window would either delay cleanup or still race. The client already
  holds every section's live HTML in `data`, so it can report exactly what's on screen —
  immediate **and** safe. Confirmed with user (they also plan an auto-save-on-navigation
  later; this fix does not depend on it and the union stays harmless once it lands).
- **Belt-and-suspenders union:** even if a client sends nothing, the DB-referenced ids
  keep saved content's images alive — a missing/old client can't nuke in-use images.
- **Scope safety:** sweep is always `WHERE cookie_policy_id = <owned policy>`; ownership
  is already asserted by `assertOwnedWebsite`. `usedImageIds` can only add to the keep set.
- **Edge — same image in two sections:** union/`Set` dedupes; removing it from one section
  but keeping it in another leaves the id in the keep set → not deleted. Correct.
- **Pre-existing orphans** (uploaded-then-removed before this ships) are cleared the next
  time that policy is saved — no separate migration/backfill needed.

## Prompts (instructions given to the AI)
> "in this code there is a problem in my description i can upload the image and store
> it in db but if i remove it it will not be deleted from db how we can resolve it"

Follow-ups that shaped the design:
- Chose **Option B** ("Frontend sends the in-use URLs — on save, include the image URLs
  currently used across all section editors … Immediate and safe").
- "i am planning to do a automatic save draft option as a later implementation … when we
  click next … it saves that page" → noted; Option B does not depend on auto-save and its
  union remains a harmless safety net once auto-save exists.
- "go with option B first make a plan".

## Tasks
1. Backend: `imageIdsFrom` + `sweepOrphanImages` helpers in `cookiePolicy.controller.js`;
   import `inArray` + `policyImages`. — files: `backend/src/controllers/cookiePolicy.controller.js` — satisfies: R7
2. Backend: call the sweep at the end of `putSection` (keep = DB ids ∪ validated
   `usedImageIds`). — files: `backend/src/controllers/cookiePolicy.controller.js` — satisfies: R7
3. Backend: call the sweep at the end of `putPolicyMeta` (same keep logic). — files: `backend/src/controllers/cookiePolicy.controller.js` — satisfies: R7
4. Frontend: `collectUsedImageIds()` + send `usedImageIds` in both PUT bodies in
   `handleSave`. — files: `frontend/src/CookiePolicyPage.jsx` — satisfies: R7
5. Docs: `usedImageIds` on both cookie-policy PUTs in `openapi.yaml`. — files: `backend/openapi.yaml` — satisfies: R7
6. Regression: extend `backend/scripts/smoke.js` — upload image → save section without it
   → GET the image URL now 404; save section WITH it → still 200. — files: `backend/scripts/smoke.js` — satisfies: R7

## Acceptance criteria
- [ ] Insert an image in a section, Save → image referenced → row kept (URL still serves 200).
- [ ] Remove that image from the section, Save → its `policy_images` row is deleted (URL now 404), immediately.
- [ ] Insert an image in About (do **not** save), switch to Use of cookies and Save it →
      the About image is **not** deleted (protected via `usedImageIds`).
- [ ] Replace image A with image B and Save → A deleted, B kept.
- [ ] Same image used in two sections; remove from one, Save → kept (still in the other).
- [ ] Missing/empty `usedImageIds` never deletes an image that the saved DB content references.
- [ ] Sweep only ever affects the owned policy's rows; no cross-policy/user deletion.
- [ ] Verification: `node --check` on changed files; boot clean; frontend `build` + `lint`;
      smoke (subagent) — existing green + new cleanup checks; manual: upload → remove → Save
      → confirm gone from DB.

## Supporting documentation
- Reuses: `backend/src/controllers/cookiePolicy.controller.js` (`assertOwnedWebsite`,
  content-merge upsert), `backend/src/controllers/image.controller.js` (UUID shape,
  `policyImages`), `frontend/src/CookiePolicyPage.jsx` (`data` holds all sections),
  `apiFetch.js`.
- Related plans: `cookie-policy-image-upload.md` (the upload feature this completes),
  `cookie-policy-about-cookies.md`, `cookie-policy-use-of-cookies.md`,
  `cookie-policy-preferences.md`.
- Skills: `plan-template`, `update-openapi`, `sync-claude-md`, `verify-and-ship`.

## Notes / changelog
- _draft_ — planned via PLAN mode; `plan-template` conformed. Option B chosen with user
  (client sends `usedImageIds`; reconcile-on-save; immediate + safe; independent of the
  later auto-save feature).
- _implemented_ — backend `imageIdsFrom` / `sanitizeIds` / `sweepOrphanImages` helpers +
  sweep in both `putSection` and `putPolicyMeta` (keep = DB-referenced ids ∪ sanitized
  `usedImageIds`, hard-scoped to the owned policy). Frontend `collectUsedImageIds()` sends
  `usedImageIds` in both cookie-policy PUT bodies. openapi documents the optional field on
  both PUTs. Smoke extended: referenced image kept (200), removed image swept (404),
  unsaved-sibling image protected via `usedImageIds` (200). Verified: `node --check`
  (controller + smoke) OK; frontend lint clean + `build` OK; openapi YAML valid. Runtime
  smoke (needs running server + DB) deferred to `verify-and-ship`. Awaiting user's manual
  check → ship.
