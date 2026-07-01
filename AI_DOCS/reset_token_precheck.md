# Reset-Token Pre-Check (validate on page load) Feature Plan

> Full-stack feature. **Status: implemented.** Decisions taken: (1) endpoint
> `GET /resetPassword/:token/check`; (2) invalid `403` → inline "invalid link" state on the reset
> page; (3) a named `checkResetToken` controller (not an inline route arrow).

## 1. Plan

### Objective
Implement the intended flow from the flowchart: **check the reset token *before* rendering the
reset form.** If the token is expired/used/invalid, send the user to the right page immediately —
instead of the current behavior, where the token is only validated when the form is **submitted**
(so the user fills the whole form before finding out the link is dead).

### Flow (target)
```
open /resetPassword/:token  →  GET /resetPassword/:token/check
        ├─ valid    → render the reset form
        ├─ expired  → /reset-expired/:token  (reason: expired)   [resend]
        ├─ used     → /reset-expired/:token  (reason: used)      [resend]
        └─ invalid  → "invalid reset link" state (link to Forgot Password; resend can't help)
```

### Scope
In scope: a **read-only** backend token-check endpoint, and a **load-time check** in
`ResetPasswordPage` that gates the form. Out of scope: changing the actual reset submit (its
`tokenValidation` stays as defense-in-depth).

---

## 2. Specification

### 2.1 Backend — new read-only check endpoint
```js
user_route.get(
  "/resetPassword/:token/check",
  tokenValidation,                                             // existing middleware
  (req, res) => res.status(200).json(new ApiResponse(200, {}, "valid"))
)
```
- Reuses the existing `tokenValidation` (passwordReset middleware): it hashes the token, looks it
  up, and throws `403 "Invalid Token"` / `401 "Token expired"` / `401 "token already is used"`, or
  calls `next()` when valid → the handler returns `200 "valid"`.
- **Read-only / idempotent:** `tokenValidation` does **not** mark the token used (that only happens
  in the `resetPassword` controller), so pre-checking is safe and repeatable.
- Works without `asyncHandler` because **Express 5** auto-forwards rejected async middleware to the
  global error handler.

**Responses:**

| Status | Meaning |
|--------|---------|
| `200` "valid" | token is good → show the form |
| `401` "Token expired" | expired |
| `401` "token already is used" | used |
| `403` "Invalid Token" | not found / bad |

### 2.2 Frontend — `ResetPasswordPage` gates the form on load
On mount (`useEffect`, StrictMode-guarded with a ref so it runs once):
```
status = 'checking'                          // show a "Checking link…" spinner
GET /pulse/users/resetPassword/:token/check  (credentials: 'include')
  200        → status = 'ok'  → render the reset form
  401 expired→ navigate('/reset-expired/:token', { state:{ reason:'expired' }})
  401 used   → navigate('/reset-expired/:token', { state:{ reason:'used' }})
  403        → status = 'invalid' → show "This reset link is invalid" + link to /forgotPassword
  network    → status = 'error' → toast / retry message
```
- The form is only rendered when `status === 'ok'`.
- **Submit-time `tokenValidation` stays** (the token could expire between load and submit); the
  submit handler keeps its existing expired/used → `/reset-expired` routing.
- `403 invalid` → inline "invalid link" state (no resend button — an invalid token has no row, so
  resend would just `400`; instead point the user to Forgot Password to get a fresh link).

---

## 3. Design Notes
- **Frontend-agnostic preserved:** the check endpoint returns JSON; the frontend decides routing.
- **No token consumption on check** — GET + read-only middleware.
- Mirrors `VerifyEmailPage` (which already validates on mount and routes by result).
- Reuses the existing `/reset-expired/:token` page (with the `reason` wording from
  `reset_link_status_messaging.md`) for expired/used.

---

## 4. AI Prompts (verbatim)
> actually there is a problem look here we only go to reset password page after checking token
> expired or token used but look first go to reset page then we go to token checking how we can
> solve it?
> ... create the plan .md for it

---

## 5. Supporting Documentation

### Files to be Created / Modified (planned)
| File | Change |
|------|--------|
| `backend/src/routes/auth.routes.js` | Add `GET /resetPassword/:token/check` (uses `tokenValidation`) |
| `backend/src/controllers/auth.controller.js` *(or inline in route)* | tiny handler returning `200 "valid"` |
| `frontend/src/ResetPasswordPage.jsx` | On mount: call the check; gate the form; route on expired/used/invalid |

### Acceptance Criteria
- [ ] Opening `/resetPassword/:token` first calls the check endpoint (shows "Checking…").
- [ ] Valid token → the reset form renders.
- [ ] Expired/used token → immediately routed to `/reset-expired/:token` (correct wording) — form never shown.
- [ ] Invalid token → "invalid reset link" state with a Forgot-Password link.
- [ ] The submit still re-validates the token (defense-in-depth).
- [ ] Check endpoint is read-only (doesn't mark the token used).

### Decisions (resolved)
1. **Endpoint name:** `GET /resetPassword/:token/check`.
2. **Invalid (`403`) UX:** inline "invalid link" state on the reset page (with a link to
   `/forgotPassword`), plus a `checkError` state if the server can't be reached.
3. **Handler:** a named `checkResetToken` controller in `auth.controller.js` (matches the codebase
   style where routes only wire middleware + controllers).

### Files changed (implemented)
| File | Change |
|------|--------|
| `backend/src/controllers/auth.controller.js` | Added `checkResetToken` (returns `200 "valid"` after `tokenValidation`) |
| `backend/src/routes/auth.routes.js` | Added `GET /resetPassword/:token/check` (before the POST route) + import |
| `frontend/src/ResetPasswordPage.jsx` | On mount: `GET …/check`; states `checking`/`ok`/`invalid`/`checkError`; form gated behind `ok`; StrictMode-guarded with a ref |
