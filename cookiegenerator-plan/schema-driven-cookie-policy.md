# Plan: Schema-driven (backend-driven) cookie-policy sections

- **Slug:** schema-driven-cookie-policy
- **Scope:** frontend + backend (single plan, stored in backend repo)
- **Status:** draft → approved → implemented

## Objective / feature request

Right now the frontend **hardcodes** what a cookie-policy section is (heading + description) and
the backend **hardcodes** how to render it. Adding a field means editing both repos.

Make it **backend-driven**: the backend sends a **schema** (a list describing each field), and
both the editor and the export **loop that list and render by the field's `type`**. Then
**adding a field is a backend-only change** — the frontend needs no edit.

We prove it by adding one new field, **`subheading`**, end-to-end.

## The idea in one picture

```
            ┌─────────── backend owns the SCHEMA (one list) ───────────┐
            │  aboutCookies.fields = [                                  │
            │    { key:'heading',     type:'text' },                    │
            │    { key:'subheading',  type:'text' },      ← new field   │
            │    { key:'description', type:'richtext' },                │
            │    { key:'showInPdf',   type:'checkbox' } ]               │
            └───────────────────────────┬──────────────────────────────┘
                                        │  (same list drives both)
                 ┌──────────────────────┴───────────────────────┐
                 ▼                                               ▼
      FRONTEND editor loops fields                    BACKEND export loops fields
      → picks input by type                           → picks HTML by type
      (text→<input>, richtext→Tiptap,                 (text→<h2>, richtext→div,
       checkbox→checkbox)                              checkbox→include/skip)
```

Neither side has code that says "heading" or "description". They say _"for each field, render
its type."_

## Specifications

- The backend defines **one** schema (`SECTION_SCHEMA`): for each section, an ordered list of
  fields; each field has `{ key, type, label, required?, default? }`.
- Field **types** (v1): `text`, `richtext`, `checkbox`, `date`.
- `GET …/cookie-policy` returns `{ sections, content }` where `sections` is the schema and
  `content` is the saved values (the existing jsonb).
- **Frontend editor** renders a section by mapping `section.fields → <Component[field.type]>`.
- **Frontend preview** and **backend export** render each field by its `type`.
- **Validation/completeness** are derived from the schema's `required` flags (backend authoritative).
- Saving is unchanged in shape — `PUT …/:section` stores whatever field keys the schema defines
  (the `content` jsonb already accepts any keys).

## Requirement alignment

- **R2 (cookie policy: 3 sections, heading + description, defaults):** unchanged in behaviour —
  the same 3 sections and default headings, just **described by data instead of hardcoded**.
- **R4/R6 (preview / Copy-HTML match):** preview and export render from the same schema, so they
  stay in sync (removes today's duplicated render rule).
- **Gap:** none in behaviour. This is a **refactor to backend-driven**, not a new user feature —
  the visible app is the same until we add `subheading`.
- **Core principle (scope discipline):** no new out-of-scope surface (no scanning/banner/CMS).
- Not a consent feature → `_ga` check **N/A**.

## Design — the concrete before/after

### A) Backend: define the schema (NEW single source of truth)

`utils/cookiePolicy/sectionSchema.js` (new):

```js
export const SECTION_SCHEMA = [
  {
    key: 'aboutCookies',
    title: 'About cookies',
    fields: [
      { key: 'heading', type: 'text', label: 'Heading', required: true },
      {
        key: 'description',
        type: 'richtext',
        label: 'Description',
        required: true,
      },
    ],
  },
  {
    key: 'useOfCookies',
    title: 'Use of cookies',
    fields: [/* heading, description */],
  },
  {
    key: 'cookiePreferences',
    title: 'Manage cookie preferences',
    fields: [/* heading, description */],
  },
]
```

### B) Backend: render the export BY TYPE (replaces hardcoded heading/description)

`utils/cookiePolicy/policyHtml.js`:

```js
const RENDER_BY_TYPE = {
  text: (v) => `<h2>${escapeHtml(v)}</h2>`,
  richtext: (v) => `<div class="cookie-policy-p">${v}</div>`,
  checkbox: () => '', // controls inclusion, not printed
  date: (v) => `<p>Effective date: ${formatLongDate(v)}</p>`,
}

function renderSection(section, values) {
  return section.fields
    .filter((f) => f.type !== 'checkbox')
    .map((f) => (values[f.key] ? RENDER_BY_TYPE[f.type](values[f.key], f) : ''))
    .join('\n')
}
// renderPolicyHtml loops SECTION_SCHEMA sections → renderSection
```

**Before:** the function literally wrote `heading` then `description`.
**After:** it loops fields; it never names a field.

### C) Backend: GET returns schema + content

`controllers/cookiePolicy.controller.js` → `getCookiePolicy`:

```js
return res.json(
  new ApiResponse(
    200,
    {
      sections: SECTION_SCHEMA, // ← the schema
      content: migrateContent(row?.content || {}),
      updatedAt,
    },
    '…',
  ),
)
```

### D) Frontend: generic editor (replaces the hardcoded heading/description inputs)

`components/fields/` (new) + `SectionEditor.jsx` (new):

```jsx
const FIELD_COMPONENTS = {
  text: TextInput,
  richtext: RichTextDescription,
  checkbox: CheckboxInput,
  date: DatePicker,
}
function SectionEditor({ section, values, onChange }) {
  return section.fields.map((f) => {
    const Field = FIELD_COMPONENTS[f.type]
    return (
      <Field
        key={f.key}
        label={f.label}
        required={f.required}
        value={values[f.key] ?? f.default ?? ''}
        onChange={(v) => onChange(f.key, v)}
      />
    )
  })
}
```

`CookiePolicyPage.jsx`: **delete** the hardcoded `SECTIONS` array and the heading/description
JSX; get `sections` from the API and render `<SectionEditor>`. Completeness =
`section.fields.filter(f=>f.required).every(f => notEmpty(values[f.key]))`.

### E) Frontend: preview by type (or inject backend HTML)

`PolicyDocument.jsx`: loop `section.fields` and render by type (mirror of `RENDER_BY_TYPE`), OR
simply inject the backend's `…/cookie-policy/html` output so preview == export for free.

## Design notes

- **Content stays jsonb** — no DB migration to add a field; `migrateContent` (see
  `backend-driven-flowcharts.md` / the migration demo) fills the new field's default for old rows.
- **One place per concern:** field list = schema; "how a type looks" = `RENDER_BY_TYPE` +
  `FIELD_COMPONENTS`; nothing hardcodes field names.
- **Unknown type fails safe** — editor skips it, export renders nothing, rather than crashing.
- **Trade-off:** more upfront structure than the current hardcoded 3 fields; it pays off the
  moment you add/change fields or want them configurable. For a truly frozen 3-field policy it's
  optional — but the request is explicitly to go backend-driven.

## THE PAYOFF — adding `subheading` end-to-end (what you actually touch)

**Backend only:**

1. Add one line to the schema:
   `{ key: 'subheading', type: 'text', label: 'Subheading' }` in `aboutCookies.fields`.
2. Add it to the default seed + bump `migrateContent` version (fills old rows).

**Frontend:** **nothing.** The editor sees a new `text` field → renders a `<TextInput>`
automatically. The export/preview see a new `text` field → render an `<h2>`/heading automatically.

That's the whole point: **backend-only change → the field appears in the editor, preview, and
export.**

(Contrast today: you'd edit `SECTIONS` in CookiePolicyPage, the heading/description JSX, the
save calls, `renderPolicyHtml`, and `PolicyDocument` — 5+ spots across 2 repos.)

## Tasks

1. **Backend:** add `sectionSchema.js` (`SECTION_SCHEMA` + type list) — satisfies: R2
2. **Backend:** `renderPolicyHtml` renders by type (`RENDER_BY_TYPE`), looping the schema — R6
3. **Backend:** `getCookiePolicy` returns `{ sections, content }`; `putSection` validates against
   the schema; `migrateContent` + defaults derive from the schema — R2/R3
4. **Frontend:** `components/fields/*` + `SectionEditor.jsx`; `CookiePolicyPage` deletes hardcoded
   `SECTIONS`, renders from `sections`; completeness/progress from schema — R2/R3/R4
5. **Frontend:** `PolicyDocument` renders by type (or injects backend HTML) — R4/R6
6. **Prove it:** add `subheading` (backend-only) and confirm it appears in editor + preview +
   export with no frontend edit — R2
7. Docs: `openapi.yaml`, `CLAUDE.md` (both repos).

## Acceptance criteria

- [ ] `GET …/cookie-policy` returns a `sections` schema (fields with `type`) + `content`.
- [ ] The editor renders inputs purely from `sections` (no hardcoded field names in the page).
- [ ] Preview and export render by field type and match each other.
- [ ] Completeness/generate gate derives from the schema's `required` flags.
- [ ] **Adding `subheading` is a backend-only change** — it shows up in editor, preview, and export
      with zero frontend edits (the acceptance test of "backend-driven").
- [ ] Existing policies (old rows) still load — `migrateContent` fills the new field's default.
- [ ] Same 3 sections + default headings as before (R2 unchanged in behaviour).

## Supporting documentation

- `rfc-backend-driven-architecture.md` (whole-app RFC — this is the cookie-policy slice of it).
- `backend-driven-architecture.md` (module deep-dive), `backend-driven-flowcharts.md` (flow #1/#2).
- Migration technique: `migrateContent` + `schemaVersion` (the lazy-migration demo).
- Touch points: `utils/cookiePolicy/policyHtml.js`, `defaultCookiePolicy.js`,
  `controllers/cookiePolicy.controller.js`, `frontend/src/pages/CookiePolicyPage.jsx`,
  `frontend/src/components/PolicyDocument.jsx`.

## Notes / changelog

- <date TBD> — draft written (PLAN mode). Awaiting review/approval before implementation. This is
  a refactor-to-backend-driven; visible behaviour is unchanged until `subheading` is added (Task 6).
