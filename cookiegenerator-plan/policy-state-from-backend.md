# Plan: Backend-driven routing state (stop inspecting `content.generatedAt`)

- **Slug:** policy-state-from-backend
- **Scope:** frontend + backend (single plan, stored in backend repo)
- **Status:** draft → approved → implemented

## Objective / feature request

`WebManagerPage` decides **preview vs wizard** by reaching into the raw policy data and reading
`content.generatedAt`. That means the **frontend re-derives the business meaning of "generated."**
Make it backend-driven: the API returns a semantic **`state.generated`** flag; the frontend
routes on that, not on an internal field.

## Specifications

- `GET …/cookie-policy` adds a `state` object to its `data`: `{ generated: boolean }`
  (extensible later with `canGenerate`, `completed`).
- `WebManagerPage.openCookiePolicy` reads `data.state.generated` instead of
  `data.content.generatedAt`.
- **The backend returns a semantic _flag_, not a frontend route** — the frontend keeps owning the
  navigation (backend must not know React URLs). Same separation as the error-code contract:
  backend owns _what is true_, frontend owns _where to go_.
- Backward compatible: `content.generatedAt` is still present; `state` is additive.

## Requirement alignment

- **Assignment mapping:** not an R1–R8 feature. It's a **decoupling cleanup** supporting R5
  (generate/edit flow) and R8 (maintainability).
- **Honest value verdict:** **LOW / marginal.** `generatedAt` is effectively already a boolean
  signal; exposing `state.generated` mainly stops the frontend from reaching into `content`
  internals. Do it only if you're also adding `state.canGenerate`/`completed` (i.e. alongside the
  schema-driven work) — on its own the payoff is small.
- **Core principle:** no out-of-scope surface. N/A to consent.

## Design

One additive field on the read response; one line changed in the frontend. Do **not** return a
route string (that couples backend to frontend URLs — rejected).

## Design notes

- **Flag, not route.** `state.generated` is semantic; `nextRoute: '/cookie-policy/:id/preview'`
  would make the backend depend on frontend routing → worse coupling. Rejected.
- **Extensible.** Ship `state` as an object so `canGenerate`/`completed` can join it later
  (ties into `schema-driven-cookie-policy.md`) without another shape change.
- **Low urgency.** Best bundled with the schema/completeness work, not done in isolation.

## Prompts (instructions given to the AI)

- "Routing decisions → backend returns state, not raw data to interpret … give plans for this
  same as auth."

## Tasks (file-by-file, with before/after)

### Task 1 — GET returns `state` · file: `backend/src/controllers/cookiePolicy.controller.js` · satisfies: R5/R8

```diff
  const content = row?.content || {}
  const updatedAt = row?.updatedAt || null
+ const state = { generated: Boolean(content.generatedAt) }
  return res
    .status(200)
    .json(
-     new ApiResponse(200, { content, updatedAt }, 'cookie policy fetched sucessfully'),
+     new ApiResponse(200, { content, updatedAt, state }, 'cookie policy fetched sucessfully'),
    )
```

### Task 2 — WebManager routes on `state` · file: `frontend/src/pages/WebManagerPage.jsx` · satisfies: R5/R8

```diff
  const data = await res.json().catch(() => ({}))
- const generated = res.ok && data?.data?.content?.generatedAt
+ const generated = res.ok && data?.data?.state?.generated
  navigate(generated ? `/cookie-policy/${id}/preview` : `/cookie-policy/${id}`)
```

### Task 3 — docs · files: `backend/openapi.yaml`, `backend/CLAUDE.md`, `frontend/CLAUDE.md`

Document the new `state` field on the GET `…/cookie-policy` response.

## Acceptance criteria

- [ ] `GET …/cookie-policy` returns `data.state.generated` (boolean).
- [ ] WebManager routes preview-vs-wizard using `state.generated`, not `content.generatedAt`.
- [ ] Behaviour is identical to today (generated → preview, else wizard).
- [ ] Backward compatible: `content.generatedAt` still present; old code paths unaffected.
- [ ] Docs updated.

## Rollout

1. Backend: add `state` (additive; old frontend ignores it).
2. Frontend: switch the one line to read `state.generated`.

## Supporting documentation

- `rfc-backend-driven-architecture.md` (Move 3 — server-computed status).
- `schema-driven-cookie-policy.md` (the `state` object also carries `canGenerate`/`completed`).
- Touch points: `controllers/cookiePolicy.controller.js`, `frontend/src/pages/WebManagerPage.jsx`.

## Notes / changelog

- <date TBD> — draft (PLAN mode). **Low-value / marginal** on its own; recommend bundling with
  the schema-driven `state` (canGenerate/completed) rather than shipping alone. Awaiting review.
