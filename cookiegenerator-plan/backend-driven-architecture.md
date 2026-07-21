# Technical Design: Backend-Driven Cookie Policy Editor (Server-Driven UI)

- **Type:** Architecture / technical design doc (not a single feature)
- **Status:** draft (for review)
- **Author:** (you)
- **Scope:** frontend + backend — the cookie-policy editor/preview/export flow

## 1. Goal

Move the cookie-policy module from a **frontend-owned** model (the React app hardcodes
sections, fields, validation, completeness, ordering, and render rules) to a
**backend-driven** model (the server is the single source of truth; the frontend is a
generic renderer that draws whatever the backend describes).

**Definition of "backend-driven" here:** the backend sends **data + a schema of what to
render and how to validate it**; the frontend contains **no domain knowledge** of "heading"
or "description" — it loops a schema and renders components by field `type`. Adding or
changing a field becomes a **backend-only** change.

**Why:** today the same domain rules are duplicated across both repos and can silently
drift (see §3). A single source of truth removes the drift and makes the editor extensible.

## 2. Principle / target model

Server-Driven UI (a.k.a. schema-driven forms):

```
Backend  ──▶  { schema (field defs + rules) , content (saved values) }
Frontend ──▶  generic renderer:  for each field → <Component[field.type]>
```

The frontend keeps **presentation** (layout, motion, modals, routing mechanics); the backend
owns **everything that is "the truth"**: which sections/fields exist, their order, labels,
defaults, validation/required rules, completeness, and the rendered output.

## 3. Current state — where domain logic lives in the frontend (inventory)

All references are `frontend/src/pages/CookiePolicyPage.jsx` unless noted. This is the
"which parts to change" evidence.

| #   | Logic (currently frontend)                                                       | Location                                                                                      | Problem                                                                               |
| --- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 1   | **Section definitions** — keys, order, labels, titles, placeholders, `active`    | `SECTIONS` array, L29–59                                                                      | duplicates backend `SECTIONS`/`SECTION_KEYS`; add/reorder a section = edit both repos |
| 2   | **Content shape** — which sections exist, blank template                         | `blankData()`, L78–82                                                                         | shape hardcoded twice                                                                 |
| 3   | **Field structure** — editor knows "heading" + "description" explicitly          | L123–132, L568+                                                                               | new field type = new bespoke UI code                                                  |
| 4   | **Empty-text rule** — strip tags/`&nbsp;` → visible text?                        | `descIsEmpty` L21–25; also `PolicyDocument.jsx:13` `hasText`; also backend `policyHtml.js:59` | **3 copies** of one rule                                                              |
| 5   | **Completeness + generate gate**                                                 | `isSectionComplete` L154, `incompleteSections`/`canGenerate` L157–160                         | client re-derives the integrity rule the backend enforces                             |
| 6   | **Required-field validation messages**                                           | `onHeadingBlur`/`onDescriptionBlur` L138–144, `saveCurrent` L253–260                          | "required" hardcoded per field, not declared by schema                                |
| 7   | **Progress model** — % per step                                                  | `pct` L119 (`0/40/80`)                                                                        | hardcoded to exactly 3 steps                                                          |
| 8   | **Wizard order / navigation**                                                    | `prevKey`/`nextKey` L120–121, `goTo`/`switchSection`                                          | order derived from the hardcoded `SECTIONS`                                           |
| 9   | **Effective-date placement** — "on the preferences tab, also save effectiveDate" | `saveCurrent` L290–311                                                                        | frontend hardcodes that a `date` field belongs to one specific section                |
| 10  | **Which fields to persist**                                                      | `saveCurrent` L271–275, `saveAllSections` L358–362                                            | sends `{heading, description}` literally                                              |
| 11  | **Route decision preview vs wizard** — reads `content.generatedAt`               | `WebManagerPage.jsx:66–68`                                                                    | business meaning of "generated" decided client-side                                   |
| 12  | **Render rules** — section-skip + markup                                         | `PolicyDocument.jsx:49` (mirrors backend `renderPolicyHtml` `policyHtml.js:103`)              | preview re-derives the export's rendering                                             |
| 13  | Image-id harvest regex                                                           | `collectUsedImageIds` L236–243                                                                | minor; parses HTML client-side                                                        |

**Already backend-driven (leave as-is):** `422` validation errors, ownership/auth,
server-derived `generatedAt`/`completedSections`/`updatedAt`, effective-date default, the
export HTML (`renderPolicyHtml`), and the default seed (`defaultCookieContent`).

## 4. Classification — what changes vs what stays

**A. Move to the backend (becomes data/schema):**

- Section list, order, labels, titles, placeholders (#1, #2, #8)
- Field definitions + types + which fields exist per section (#3, #10)
- Required/validation rules and completeness (#4, #5, #6)
- Progress model (step count/order) (#7)
- Policy-level vs section-level field placement, e.g. effective date (#9)
- The route/state decision ("is this policy generated → where to go") (#11)
- The render spec (or serve rendered HTML) (#12)

**B. Stays in the frontend (pure presentation):**

- Layout, CSS, motion, spinners, toasts, modal open/close, scroll-lock
- The **field-type → component** registry (generic; changes only when a _new type_ is introduced, not a new field)
- Routing mechanics (calling `navigate`) — but driven by backend-provided state, not by inspecting `generatedAt`
- Clipboard copy, focus management

**C. Already backend-driven — no change** (see §3 last row).

## 5. The schema contract (proposed)

The backend returns, per section, a list of typed field definitions. Content stays the
existing `cookie_policy.content` jsonb (schemaless — fits perfectly).

```jsonc
// GET /pulse/websites/:id/cookie-policy  → data
{
  "schemaVersion": 3,
  "sections": [
    // order is authoritative
    {
      "key": "aboutCookies",
      "title": "About cookies",
      "fields": [
        {
          "key": "heading",
          "type": "text",
          "label": "Heading",
          "required": true,
          "placeholder": "What are cookies?",
        },
        {
          "key": "subheading",
          "type": "text",
          "label": "Subheading",
          "required": false,
        },
        {
          "key": "description",
          "type": "richtext",
          "label": "Description",
          "required": true,
        },
        {
          "key": "showInPdf",
          "type": "checkbox",
          "label": "Show in PDF",
          "default": true,
        },
      ],
    },
    // useOfCookies, cookiePreferences …
  ],
  "policyFields": [
    // policy-level (not per-section)
    {
      "key": "effectiveDate",
      "type": "date",
      "label": "Effective date",
      "required": true,
    },
  ],
  "content": {/* saved values, keyed as today */},
  "state": {
    "generated": true,
    "completed": ["aboutCookies"],
    "updatedAt": "…",
  },
}
```

Field-type vocabulary (v1): `text`, `richtext`, `checkbox`, `date`. Each maps to one
frontend component. Adding a **field** = backend schema edit. Adding a **type** = one new
frontend component + registry entry (rare).

## 6. Backend responsibilities (target)

1. **Serve the schema** — from a `SECTION_SCHEMA` definition in `utils/cookiePolicy/`
   (single source of truth), embedded in the existing `GET …/cookie-policy` response (or a
   dedicated `…/cookie-policy/schema`).
2. **Validate against the schema** — `PUT :section` checks the body's fields against the
   section's field defs (required, type) instead of the current fixed heading/description
   validators. Unknown fields rejected; missing required → `422`.
3. **Compute completeness/state server-side** — return `state.completed` + a `canGenerate`
   flag derived from required fields, so the client renders the gate instead of computing it.
4. **Own defaults + migration** — `defaultCookieContent` seeds from the schema;
   `migrateContent` (see `public-image-url-export.md`-style approach and the migration demo)
   fills new fields for existing rows using the schema's `default`. Bump `schemaVersion`.
5. **Render the policy from the schema** — `renderPolicyHtml` loops fields by type (text →
   `<p>`/heading, richtext → inject HTML, checkbox → drives inclusion) rather than hardcoding
   heading/description. This keeps export authoritative.
6. **Expose navigation state** — return whether the policy is generated so the client routes
   on backend state, not by reading `generatedAt` itself.

## 7. Frontend responsibilities (target)

1. **Field registry** — `FIELD_COMPONENTS = { text, richtext, checkbox, date }` mapping type
   → component (`RichTextDescription` already exists for `richtext`).
2. **Generic `SectionEditor`** — `section.fields.map(f => <FIELD_COMPONENTS[f.type] def={f}
value={values[f.key]} onChange={…} />)`. No knowledge of "heading"/"description".
3. **Schema-driven validation/completeness** — read `required` from the schema; render the
   backend's `state`/`canGenerate` for the gate (client check is a mirror only).
4. **Schema-driven wizard** — steps, order, and progress come from `sections` length/order.
5. **Render** — either inject the backend-rendered HTML in the preview, or render generically
   by field type (one renderer shared in spirit with the export).
6. **Route on backend state** — use `state.generated`, not `content.generatedAt`.

## 8. Change list (concrete, file by file)

**Backend**

- `utils/cookiePolicy/` — **new** `sectionSchema.js` (the `SECTION_SCHEMA` + type vocab);
  `defaultCookiePolicy.js` derives defaults from it; add `migrateContent` + `schemaVersion`.
- `controllers/cookiePolicy.controller.js` — `getCookiePolicy` returns `sections`/`policyFields`/
  `state`; `putSection` validates against the schema + computes `completed`.
- `validators/cookiePolicy.validator.js` — replace fixed heading/description rules with
  schema-driven validation.
- `utils/cookiePolicy/policyHtml.js` — `renderPolicyHtml` loops fields by type.
- `openapi.yaml`, `CLAUDE.md` — document the schema contract.

**Frontend**

- `pages/CookiePolicyPage.jsx` — delete `SECTIONS`/`blankData` (come from API); replace the
  hardcoded heading/description inputs with the generic `SectionEditor`; drive validation,
  completeness, progress, and step order from the schema; remove `descIsEmpty` (use a schema
  `notEmpty(value,type)` helper).
- **new** `components/fields/` — `TextField`, `CheckboxField`, `DateField` (+ reuse
  `RichTextDescription`) and the `FIELD_COMPONENTS` registry; **new** `SectionEditor.jsx`.
- `components/PolicyDocument.jsx` — render from field defs (or from backend HTML), dropping the
  hardcoded skip/heading logic (removes the `hasText` copy).
- `pages/WebManagerPage.jsx` — route on `state.generated` from the API.

## 9. Rollout strategy (incremental, low-risk)

Do **not** big-bang this. Suggested order, each step shippable:

1. **Backend: add the schema** to the GET response (additive; frontend ignores it at first).
2. **Backend: schema-driven validation + `migrateContent`** behind the same endpoints.
3. **Frontend: consume section list/order/labels** from the schema (delete `SECTIONS`), keep
   heading/description components for now.
4. **Frontend: generic `SectionEditor`** + field registry (introduces `subheading` etc.).
5. **Render**: make export + preview schema-driven.
6. **Route on backend state**; retire `generatedAt` inspection.

Each step keeps the app working (assignment R8: incremental commits). A plan doc per step in
`backend/cookiegenerator-plan/`.

## 10. Risks & trade-offs

- **Over-engineering risk:** for a _fixed_ 3-section policy this is more infrastructure than
  needed. It pays off only if fields grow or become configurable (multi-tenant/admin-editable).
  Recommend the pragmatic subset (schema as source of truth + generic editor) rather than a
  full form-builder.
- **Bespoke UI is harder** with generic components (per-field custom layout costs more).
- **Type vocabulary must be governed** — every `type` needs a component both for editing and
  for rendering/export; an unknown type must fail safe.
- **Migration is still required** — schema-driven does not remove the need to backfill/normalize
  existing rows for newly added fields (it feeds it).
- **Validation must stay authoritative on the backend** — the schema the client renders is a
  convenience; the server must re-validate every write.

## 11. Out of scope

Cookie scanning, multi-language, consent banner, CMS publishing (assignment core-principle
exclusions). A fully user-**configurable** form builder is out of scope for v1 — the schema is
developer-defined, served to the client.

## 12. Open questions (decide before building)

- Serve schema **embedded** in `GET …/cookie-policy` or a **separate** `…/schema` endpoint?
- Preview: **inject backend-rendered HTML** vs **client render by field type**? (backend HTML =
  guaranteed match with the export; client render = more interactive.)
- Type vocabulary for v1 — is `text/richtext/checkbox/date` enough?
- Does any new field change the **legal meaning** of already-generated policies (→ "review &
  regenerate" nudge via `schemaVersion`)?
