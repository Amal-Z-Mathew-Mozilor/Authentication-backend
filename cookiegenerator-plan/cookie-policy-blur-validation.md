# Plan: Cookie-policy wizard — validate required fields on blur

- **Slug:** `cookie-policy-blur-validation`
- **Scope:** frontend only (single plan, stored in backend repo per plan-template)
- **Status:** implemented (awaiting user manual check → ship)

## Objective / feature request

In the cookie-policy wizard (`CookiePolicyPage.jsx`), the required **Heading** and
**Description** fields currently only show "This field cannot be empty." when the user
tries to navigate (Next / Previous / Save draft / Back to Dashboard / Generate). Match
real CookieYes: show the error **immediately when a required field is left empty on
blur** (focus-out), not only on navigation.

## Specifications

- **Heading** (`<input>`): on blur, if `heading.trim()` is empty → set
  `errors.heading = ['This field cannot be empty.']`; otherwise leave errors as-is.
- **Description** (`RichTextDescription` / Tiptap): on blur (focus leaves the editor), if
  the stripped description text is empty → set
  `errors.description = ['This field cannot be empty.']`.
- **Empty test = the same rule `saveCurrent` uses** so on-blur and on-navigate agree:
  heading → `heading.trim()`; description → strip tags + `&nbsp;`, trim
  (`description.replace(/<[^>]*>/g,'').replace(/&nbsp;/gi,' ').trim()`).
- **Unchanged:** the existing `onChange` behaviour that **clears** a field's error as the
  user types stays; `saveCurrent` stays as the final navigation gate (blur is additive,
  not a replacement); switching sections still resets errors (`switchSection` → `EMPTY`).
- **Out of scope:** the effective-date picker (not a required field); backend/API (none).

Behavioural detail: blur only ever **sets** an error for the field just left (never
touches the sibling field), so tabbing Heading→Description won't prematurely flag
Description; and typing then clears it via the existing onChange.

## Requirement alignment

- Supports the **cookie-policy authoring UX** (the generator flow), closest to **R7**
  (configuration/policy editing surfaced in-product). This is a **UX correctness fix** to
  that editor, not a new capability.
- **Gap:** none introduced — it strengthens existing client-side validation; the server
  remains the real gate for section saves.
- **Core-principle check (does NOT apply):** pure form-validation UX; sets/blocks/releases
  no cookie, touches no consent/banner/gatekeeper surface. The `_ga`-release check **does
  not apply** — noted so a reviewer doesn't expect it.

## Design

Frontend-only; two files.

**`frontend/src/RichTextDescription.jsx`** — the editor doesn't expose blur today.
- Add an `onBlur` prop to the component signature.
- Wire it to Tiptap's `useEditor({ onBlur: () => onBlur?.() , … })` callback (v3 supports
  the top-level `onBlur` handler). No other editor behaviour changes.

**`frontend/src/CookiePolicyPage.jsx`**
- Add a small `validateField(field)` helper (or two inline handlers) that applies the
  same empty rule as `saveCurrent` and sets **only** that field's error:
  - `onBlurHeading()` → empty `heading.trim()` → `setErrors((p)=>({ ...p, heading:[…] }))`.
  - `onBlurDescription()` → empty stripped `description` → `setErrors((p)=>({ ...p, description:[…] }))`.
- Heading `<input>` (`:399`): add `onBlur={onBlurHeading}`.
- `RichTextDescription` (`:426`): pass `onBlur={onBlurDescription}`.
- Reuse the `'This field cannot be empty.'` string (extract a const so blur and
  `saveCurrent` share it and can't drift).

## Design notes

- **Empty-triggered, both on-change and on-blur.** The error is shown whenever the field
  is *empty* — set immediately on the keystroke that empties it (erase) and on blur of a
  never-typed field, and cleared the instant there's text. This is not "validate on every
  keystroke" (which would flash while typing a valid value): non-empty input never shows
  an error, so there's no flashing — it only ever appears when the field genuinely has no
  text, matching CookieYes (erasing shows the message right away, while the field is still
  focused).
- **Additive to `saveCurrent`.** Navigation still calls `saveCurrent`, which both
  validates and (on success) saves — blur only *shows* errors earlier, it never saves.
- **Shared empty rule.** Extracting the heading/description emptiness checks (and the
  message) avoids the two paths disagreeing about what "empty" means (e.g. `<p></p>` or
  `&nbsp;`-only description counts as empty in both).
- **Tiptap onBlur** fires on focus-out of the editor; clicking a toolbar button may blur
  the content area — acceptable (the value is already captured via `onChange`, so a blur
  that finds text sets no error; a blur on a genuinely empty editor correctly flags it).
- No new CSS — reuses the existing `.field.invalid` + `.errlist` styling already wired to
  `errors.heading` / `errors.description`.

## Prompts (instructions given to the AI)

> "i found a real bug — in real cookieyes whenever i leave a field empty it immediately
> shows 'this field is required'; in my app it only shows when i click Next or Go to
> Dashboard. is there a way to fix it." → chosen approach: validate required fields
> (Heading, Description) on **blur**, frontend-only, keeping `saveCurrent` as the final
> gate and the onChange clear-on-type behaviour.

## Tasks

1. `RichTextDescription.jsx`: add `onBlur` prop, wire to `useEditor({ onBlur })` — files:
   `frontend/src/RichTextDescription.jsx` — satisfies: R7 (editor UX)
2. `CookiePolicyPage.jsx`: extract the empty-message const + per-field empty checks; add
   `onBlur` to the Heading input and pass `onBlur` to `RichTextDescription` — files:
   `frontend/src/CookiePolicyPage.jsx` — satisfies: R7 (editor UX)
3. Sync docs (`sync-claude-md`) if any documented behaviour line needs a touch — at ship
   time (likely the `RichTextDescription` structure note gains an `onBlur` mention).

## Acceptance criteria

- [ ] Focusing the **Heading** field and leaving it empty shows "This field cannot be
      empty." immediately on blur (no navigation needed); typing text clears it.
- [ ] Leaving the **Description** editor empty shows the same error on blur; adding text
      clears it.
- [ ] A blur on one field does **not** flag the other field.
- [ ] Navigation (Next / Previous / Save draft / Back to Dashboard / Generate) still
      validates and behaves exactly as before (blur is additive).
- [ ] Switching sidebar sections still clears errors (no stale error carried across).
- [ ] `npm run build` + `npm run lint` pass in `frontend/`.
- [ ] N/A — no consent/cookie surface touched, so the `_ga`-release check does not apply.

## Supporting documentation

- Files: `frontend/src/CookiePolicyPage.jsx` (`saveCurrent` empty rule `:184-196`; Heading
  input `:399`; Description editor `:426`; `errors`/`EMPTY` state), and
  `frontend/src/RichTextDescription.jsx` (`useEditor` `:112`).
- Tiptap v3 `useEditor` `onBlur` callback.

## Notes / changelog

- Draft. Awaiting manual review/approval. Frontend-only; no backend/API/smoke change
  (no route touched). Per plan-template, this doc ships **with** the feature at ship time.
- **Implemented (2026-07-10):** `RichTextDescription.jsx` — added `onBlur` prop wired to
  Tiptap `useEditor({ onBlur })`. `CookiePolicyPage.jsx` — extracted `EMPTY_MSG` +
  `descIsEmpty()` (now shared by `saveCurrent` and the new blur handlers), added
  `onHeadingBlur`/`onDescriptionBlur` (each sets only its own field's error), wired
  `onBlur` to the Heading `<input>` and the `RichTextDescription`. `saveCurrent`
  refactored to reuse the shared helper/const (no behaviour change). **Verification:**
  frontend `npm run build` + `npm run lint` both pass (pre-existing chunk-size warning
  only). No backend change → no smoke run needed. Behavioural check (blur shows/clears the
  error) left for the user's manual check.
- **Post-implementation tweak (user request):** the error now also appears **on the
  keystroke that empties the field** (erasing while still focused), not only on blur — the
  Heading/Description `onChange` now sets the error when the new value is empty and clears
  it when there's text (blur handlers kept as the backup for a never-typed field). Matches
  CookieYes, where erasing shows the message immediately. Re-verified: `build` + `lint`
  pass.
