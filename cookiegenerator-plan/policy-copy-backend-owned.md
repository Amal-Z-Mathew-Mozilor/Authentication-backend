# Plan: Backend-owned policy copy & template (Disclaimer + rendered strings)

- **Slug:** policy-copy-backend-owned
- **Scope:** frontend + backend (single plan, stored in backend repo)
- **Status:** draft → approved → implemented

## Objective / feature request

The rendered cookie-policy copy is **hardcoded in the frontend** and **duplicated** against the
backend export:

- `PolicyDocument.jsx` hardcodes the document strings — `"Cookie Policy"`, `"Effective date:"`,
  `"Last updated:"`, and the footer `"Cookie Policy generated for …"` — which the backend's
  `renderPolicyHtml` **also** produces. Two renderers, same strings → they can drift (preview ≠
  export).
- `PolicyPreviewPage.jsx` hardcodes the **legal Disclaimer** paragraph in the client.

Make this **backend-owned**: the server owns the policy template/labels (one source) and the
Disclaimer text; the frontend renders what the server provides.

## Specifications

- **Template/labels:** the frontend preview stops hardcoding the document strings. Two options
  (pick one at approval):
  - **Option A (recommended): preview injects the backend-rendered HTML** from
    `GET …/cookie-policy/html` → preview == export **by construction** (one renderer, zero
    duplication).
  - **Option B: backend returns a `labels` object** (`{ title, effectiveLabel, updatedLabel,
footer }`) that `PolicyDocument` renders — keeps client rendering but removes the string
    duplication.
- **Disclaimer:** served by the backend (a `disclaimer` string in the policy response or a small
  config endpoint), not hardcoded in `PolicyPreviewPage`.
- No change to what the user sees; this is a **source-of-truth** move.

## Requirement alignment

- **R4 (preview) / R6 (Copy-HTML matches preview):** directly supported — Option A **guarantees**
  preview == export, which R6 wants. This is the strongest reason to do it.
- **Assignment mapping:** the Disclaimer/legal-copy centralization is **not** an R1–R8 feature;
  it's product/legal hygiene supporting R8.
- **Honest value verdict:**
  - **Template/labels consolidation (Option A): MEDIUM** — it removes a real, present duplication
    (preview vs export drift) and satisfies R6 more robustly. Worth doing.
  - **Disclaimer centralization: LOW** for an assignment app — matters when legal copy must be
    versioned/reused; otherwise a hardcoded paragraph is fine. Defer unless you want it.
- **Core principle:** no out-of-scope surface. N/A to consent.

## Design

Prefer **Option A** for the template (delete the frontend's parallel renderer; render the backend
HTML). Treat the Disclaimer as a separate, optional sub-task.

## Design notes

- **Why Option A over B:** B still leaves two renderers that must be kept in sync (just sharing
  strings, not logic). A collapses them to one — the backend's `renderPolicyHtml` — so preview and
  export can never diverge. B is only better if the preview needs interactivity the static HTML
  can't give (not the case here).
- **Trade-off of Option A:** the live preview (`PolicyPreview` modal, which shows _unsaved_ editor
  state) can't use a saved-HTML endpoint — it must still render from live state. So Option A fits
  the **read-only preview page** (saved content); the live modal keeps a light client renderer.
  This is a real nuance: full de-duplication only covers the saved-preview path.
- **Disclaimer** is static legal text; serving it from the backend is only worth it if it will be
  versioned or reused across pages/clients. Low urgency.

## Prompts (instructions given to the AI)

- "Legal / rendered copy → backend-owned template … give plans for this same as auth."

## Tasks (file-by-file, with before/after)

### Task 1 (Option A) — read-only preview injects backend HTML · file: `frontend/src/pages/PolicyPreviewPage.jsx` · satisfies: R4/R6

```diff
- // renders the composed policy via <PolicyDocument sections=… /> (a second renderer)
+ // fetch the server-rendered snippet and inject it — same bytes as Copy-HTML export
+ const { data } = await getJson(`/pulse/websites/${websiteId}/cookie-policy/html`)
+ setHtml(data.html)
  ...
- <PolicyDocument url={url} sections={sections} effectiveDate={…} lastUpdated={…} />
+ <div className="cp-preview-body" dangerouslySetInnerHTML={{ __html: html }} />
```

### Task 2 (Option A) — retire duplicated strings in `PolicyDocument` · file: `frontend/src/components/PolicyDocument.jsx` · satisfies: R6

`PolicyDocument` stays only for the **live** (unsaved) modal. If the modal is also switched to a
shared renderer later, it can be removed. For now, it's the one remaining client renderer; note
that its strings must match the backend (or drive it from a shared `labels` source — Option B).

_(Alternative — Option B, if you keep client rendering everywhere:)_

```diff
# backend: return labels alongside content
+ const labels = { title: 'Cookie Policy', effectiveLabel: 'Effective date:', updatedLabel: 'Last updated:', footer: 'Cookie Policy generated for' }
+ ... new ApiResponse(200, { content, updatedAt, labels }, '…')

# frontend PolicyDocument: use labels instead of hardcoded strings
- <h1>Cookie Policy</h1>
+ <h1>{labels.title}</h1>
- Effective date: {formatLong(...)}
+ {labels.effectiveLabel} {formatLong(...)}
```

### Task 3 (optional) — Disclaimer from the backend · files: `backend/src/controllers/cookiePolicy.controller.js`, `frontend/src/pages/PolicyPreviewPage.jsx` · satisfies: R8

```diff
# backend: include the disclaimer text (or a dedicated GET /policy-config)
+ const disclaimer = 'We do not take any responsibility, and we are not liable, …'
+ ... new ApiResponse(200, { content, updatedAt, disclaimer }, '…')

# frontend: render the served text instead of a hardcoded paragraph
- <p>We do not take any responsibility, and we are not liable, …</p>
+ <p>{disclaimer}</p>
```

### Task 4 — docs · files: `backend/openapi.yaml`, `backend/CLAUDE.md`, `frontend/CLAUDE.md`

Document whichever option is chosen (HTML-injection for preview, and/or `labels`/`disclaimer`
fields on the response).

## Acceptance criteria

- [ ] The read-only preview shows the **same** markup/strings as the Copy-HTML export (Option A:
      identical by construction; Option B: strings come from one server-owned source).
- [ ] No policy document string (`"Cookie Policy"`, `"Effective date:"`, footer) is defined in
      **both** the frontend and backend.
- [ ] (If Task 3) the Disclaimer text is served by the backend, not hardcoded in the client.
- [ ] User-visible output is unchanged.
- [ ] Docs updated.

## Rollout

1. **Option A:** switch the read-only preview page to inject `…/cookie-policy/html`.
2. Remove now-dead duplicated strings from the saved-preview path.
3. (Optional) serve the Disclaimer from the backend.
4. Live-preview modal keeps a light client renderer (documented nuance).

## Supporting documentation

- `rfc-backend-driven-architecture.md` (Move 2 — server-owned config/copy; §3 render duplication).
- `schema-driven-cookie-policy.md` (render-by-type; preview can inject backend HTML).
- Touch points: `frontend/src/pages/PolicyPreviewPage.jsx`, `frontend/src/components/PolicyDocument.jsx`,
  `backend/src/utils/cookiePolicy/policyHtml.js`, `backend/src/controllers/cookiePolicy.controller.js`.

## Notes / changelog

- <date TBD> — draft (PLAN mode). **Template/label consolidation (Option A) is the worthwhile
  part** (kills preview≠export drift, supports R6); **Disclaimer centralization is low-value** for
  this app — treat as optional. Awaiting review.
