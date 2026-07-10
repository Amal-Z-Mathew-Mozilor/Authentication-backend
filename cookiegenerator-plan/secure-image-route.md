# Plan: Secure the image-serve route (auth + ownership)

- **Slug:** `secure-image-route`
- **Scope:** frontend + backend (single plan, stored in backend repo per plan-template) —
  **backend-only code change**; the frontend needs no change (cookies auto-attach to `<img>`).
- **Status:** implemented (awaiting user manual check → ship)

## Objective / feature request

`GET /pulse/images/:id` is currently **public** (`image_route.get('/:id', getImage)` — no
`jwtValidation`; the only protection is an unguessable UUID). For a cookie-policy product,
anyone with an id can fetch anyone's uploaded image. Lock it down: require a valid session
**and** verify the image belongs to the requesting user, so a user can only fetch images
from their own policies.

## Specifications

- **Auth:** add `jwtValidation` to the route → unauthenticated request ⇒ `401`.
- **Ownership:** the image must belong to the caller. Chain:
  `policy_images.cookiePolicyId → cookie_policy.id → cookie_policy.websiteId →
  websites.id → websites.userId === req.user.id`. A logged-in user requesting another
  user's image (or a non-existent id) ⇒ `404` (return `404`, not `403`, so we don't leak
  which ids exist).
- **Serving unchanged otherwise:** still streams the bytes with the stored `Content-Type`.
  Change `Cache-Control` from `public` to **`private`** (the response is now
  user-scoped — shared/CDN caches must not serve it across users).
- **Frontend:** **no change.** In the editor and preview pages the browser sends the
  `accessToken` httpOnly cookie automatically on `<img src="/pulse/images/:id">` (same-site
  via the Vite proxy), so images keep rendering for the owner.
- **Exported policy page:** unaffected — the "Copy HTML" export **inlines base64**
  server-side, so the pasted page never calls this route.

## Requirement alignment

- **R1/R2 (website + policy authoring):** hardens the image-upload sub-feature of the
  policy editor — a user's uploaded assets are now private to them.
- **Gap:** none. Behaviour for the owner is unchanged; only cross-user/anonymous access is
  removed.
- **Core-principle / scope:** in scope (part of the generator). No consent/cookie runtime
  surface touched.

## Design

**Backend only.**

1. **`src/routes/image.routes.js`:** import `jwtValidation` and add it to the route:
   `image_route.get('/:id', jwtValidation, getImage)`.
2. **`src/controllers/image.controller.js` — `getImage`:** replace the id-only lookup with
   an ownership-scoped join (all imports — `and`, `eq`, `websites`, `cookiePolicy`,
   `policyImages` — are already present):
   ```js
   const [img] = await db
     .select({ mime: policyImages.mime, data: policyImages.data })
     .from(policyImages)
     .innerJoin(cookiePolicy, eq(policyImages.cookiePolicyId, cookiePolicy.id))
     .innerJoin(websites, eq(cookiePolicy.websiteId, websites.id))
     .where(and(eq(policyImages.id, req.params.id), eq(websites.userId, req.user.id)))
   if (!img) throw new ApiError(404, 'image not found')
   ```
   Keep the `UUID_RE` format pre-check (fast `404`). Set `Cache-Control: private, …`.
3. **`openapi.yaml`:** add `security: [accessTokenCookie]` + a `401` response to
   `GET /pulse/images/{id}`; adjust its description (was "public").

**Smoke (`scripts/smoke.js`):** the current image-serve checks use a bare
`fetch(BASE + imgUrl)` with **no cookies** — those must now send the auth jar or they'd
`401`. Changes:
- Add a small `getImg(url)` that GETs an image URL **with** the cookie jar; use it for the
  existing "served/kept/gone/protected/after-delete" checks.
- Add: **unauthenticated** image fetch (bare `fetch`, no cookies) → `401`.
- Add: **cross-user** access → `404` — seed a second verified user, log in as them (into a
  separate jar), fetch user-1's image → expect `404`; clean up user 2.

## Design notes

- **404 over 403** for the not-owned case avoids leaking which image ids exist.
- **`Cache-Control: private`** matters now that the bytes are auth-scoped — otherwise an
  intermediary cache could serve one user's image to another.
- **`<img>` + httpOnly cookie** works because browsers attach cookies to image requests
  same-site; no bearer header / `apiFetch` needed. (Token-rotation caveat: `<img>` loads
  bypass `apiFetch`, so an access token that expires mid-session could 401 an image until
  the next `apiFetch` rotates the cookie — a narrow, self-healing edge, not a blocker.)
- **Export stays base64** — do not switch the export to reference this route, or pasted
  pages would break (no session on the customer's site).
- This is deliberately **independent of** the future S3 migration; when S3 lands, this same
  guarded route becomes the place that mints the presigned redirect for the owner.

## Prompts (instructions given to the AI)

> "i dont want any route to be public because i am an app that makes cookie policy … if a
> hacker gets that it can take any user's image, so jwt validation is needed" → agreed:
> add `jwtValidation` **plus an ownership check** (jwt alone only proves *some* login).
> "implement the route plan first … then we will plan about s3 migration."

## Tasks

1. Add `jwtValidation` to `GET /pulse/images/:id` — files: `backend/src/routes/image.routes.js` — satisfies: R1/R2
2. Ownership-scoped `getImage` join + `Cache-Control: private` — files: `backend/src/controllers/image.controller.js` — satisfies: R1/R2
3. `openapi.yaml`: security + `401` on `GET /pulse/images/{id}` — files: `backend/openapi.yaml`
4. `smoke.js`: authenticate image fetches; add unauth→401 and cross-user→404 — files: `backend/scripts/smoke.js`
5. Sync docs (`sync-claude-md`) — backend Images section (now auth + owner-scoped) at ship time.

## Acceptance criteria

- [ ] Unauthenticated `GET /pulse/images/:id` → `401`.
- [ ] The owner (authenticated) still gets their image → `200` with the correct content-type.
- [ ] A different logged-in user requesting that image → `404`.
- [ ] Images still render in the editor and preview pages (cookie auto-attached).
- [ ] The exported/pasted policy still shows images (base64, unaffected).
- [ ] Backend `npm run smoke` passes with the updated image checks.
- [ ] N/A — no consent/cookie surface touched, so the `_ga`-release check does not apply.

## Supporting documentation

- Files: `backend/src/routes/image.routes.js`, `backend/src/controllers/image.controller.js`
  (`getImage`, `UUID_RE`), `backend/src/middlewares/jwt.middleware.js` (`jwtValidation`),
  `models/policy_images.js` → `cookie_policy` → `websites` FK chain.
- Related: `cookie-policy-image-upload.md`, `cookie-policy-orphan-image-cleanup.md`; the
  forthcoming S3-migration plan (this guarded route will host the presigned redirect).

## Notes / changelog

- Design agreed in conversation (auth + ownership; 404 for not-owned; export stays base64).
  Backend-only; no frontend change. Per plan-template, this doc ships **with** the feature.
- **Implemented (2026-07-10):** `image.routes.js` — added `jwtValidation` to
  `GET /:id`. `image.controller.js` — `getImage` now joins `policy_images → cookie_policy
  → websites` and filters `websites.userId === req.user.id` (non-existent OR not-owned →
  `404`); `Cache-Control` changed `public` → `private`. `openapi.yaml` — added
  `accessTokenCookie` security + `401` to `GET /pulse/images/{id}`. `smoke.js` — added a
  cookie-jar `getImg()` helper (existing image reads now authenticated), plus new checks:
  no-auth → 401, cross-user (second seeded user) → 404. **Verification:** syntax OK;
  container rebuilt; `npm run smoke` = **67 passed, 0 failed** (authed owner 200 / no-auth
  401 / other-user 404; base64 export still inlines the image). No frontend change — the
  editor/preview `<img>` requests carry the httpOnly cookie automatically (same-site).
