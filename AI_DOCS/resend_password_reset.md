# Resend Password Reset — Backend

> Backend side of the password-reset resend feature. **Status: implemented.**
> Frontend side is documented in `frontend/AI_DOCS/resend_password_reset.md`.

## 1. Plan

### Objective

Let a user whose **password-reset link has expired** request a new one. The expired reset token
identifies the user. The backend stays **frontend-agnostic** — it returns **JSON only**, never
redirects to or hardcodes a frontend route. The reset link base is **supplied by the frontend**
and validated against an allowlist.

### Design choices

- **JSON only** — no redirects, no frontend route names in code.
- **Reset link from frontend + allowlist** — the frontend sends `resetBase`; the backend
  validates it (exact match) against `ALLOWED_RESET_BASES`.
- **Insert, don't delete** — resend inserts a new token row; existing rows are kept.

---

## 2. Specification

### Route

```js
user_route.post("/resetResend/:token", resetTokenResolve, resetResend)   // POST: side effects (token + email)
```

### Middleware `resetTokenResolve` (`middlewares/passwordResend.middleware.js`)
1. `const { token } = req.params`; `hashedToken = hashToken(token)`.
2. Look up `password_reset_tokens` by `token = hashedToken`, select `userId`.
3. No row → `throw new ApiError(400, "invalid token")`.
4. `req.user = { id: row.userId }` → `next()`.
- No expiry/`isUsed` check — only resolves the user from the (expired) token. Separate from the
  existing `tokenValidation` (which enforces expiry/used for the actual reset).

### Controller `resetResend` (`controllers/auth.controller.js`)
1. `id = req.user.id`; `base = resolveResetBase(req.body?.resetBase)`.
2. Fetch user `{ email }` by `id`; if missing → `400 "user doesn't exist"`.
3. `tokenGeneration()` → `{ unhashedToken, hashedToken, tokenExpiry }`.
4. **Insert** the new row into `password_reset_tokens` (no delete).
5. `sendEmail` with `passwordResetVerification("there", \`${base}/${unhashedToken}\`)`.
6. `200 ApiResponse(200, {}, "A new password reset email has been sent.")`.

### Reset-base allowlist (`utils/resetBase.js`)
```js
export function resolveResetBase(resetBase){
  const allowed = (process.env.ALLOWED_RESET_BASES||"").split(",").map(s=>s.trim()).filter(Boolean)
  if(!resetBase || !allowed.includes(resetBase)) throw new ApiError(400,"invalid reset url")  // exact match
  return resetBase
}
```
- Env: `ALLOWED_RESET_BASES` (comma-separated), e.g. `http://localhost:5173/resetPassword`.
- Used by both `forgotPassword` and `resetResend` (both build the link from the validated `resetBase`).
- Exact match only (prefix match would be exploitable, e.g. `…/resetPassword.evil.com`).

### How "expired" is surfaced (no resend-specific change)

The reset submit route now runs `tokenValidation` **first**:
```js
user_route.post("/resetPassword/:token", tokenValidation, resetPasswordValidator(), validation, resetPassword)
```
So an expired/used/invalid token returns its error **before** field validation:
- `401 "Token expired"`, `401 "token already is used"`, `403 "Invalid Token"`.
The frontend reacts to those (see the frontend doc).

### Endpoint summary

| Method | Path | Middleware | Success | Errors |
|--------|------|-----------|---------|--------|
| POST | `/pulse/users/resetResend/:token` | `resetTokenResolve` | `200` "A new password reset email has been sent." | `400` invalid token · `400` invalid reset url · `400` user doesn't exist |

---

## 3. Design Notes

- **Frontend-agnostic:** JSON responses only; the only frontend reference is the reset link,
  supplied by the frontend and validated against the allowlist (config-level).
- **Mirrors the email-verification resend** (middleware + controller pattern); differs in table
  (`password_reset_tokens`), template (`passwordResetVerification`), and link base.
- **Security:** `resolveResetBase` exact-match allowlist prevents open-redirect/phishing from a
  client-supplied URL. An expired reset token is a one-time bearer that only emails the
  registered address.
- Reuses `tokenGeneration`, `hashToken`, `sendEmail`, `passwordResetVerification`, `ApiResponse`/`ApiError`.

---

## 4. AI Prompts (verbatim)

### Prompt 1 — Feature request
> ok now i want to implement password resend like email resend for that i want a middleware and
> controller just like emailverification of sign up and it should function similar to it except
> the content send as a mail first create a . md file for it

### Prompt 2 — Approach
> ok for now do the reset password thing we will change verify email part after that create .md file for it

### Prompt 3 — Reset link from frontend
> ok do as option2 get the url from the frontend  *(Option 2 with allowlist — `ALLOWED_RESET_BASES`.)*

### Prompt 4 — Split docs
> ok i have a problem the frontend change and backend change was implemented in same .md ... can you
> split and generate one for backed and one for front end

---

## 5. Supporting Documentation

### Backend files Created / Modified

| File | Change |
|------|--------|
| `backend/src/middlewares/passwordResend.middleware.js` *(new)* | `resetTokenResolve` (reset token → `req.user.id`) |
| `backend/src/utils/resetBase.js` *(new)* | `resolveResetBase` (allowlist validation) |
| `backend/src/controllers/auth.controller.js` | `resetResend`; `forgotPassword` + `resetResend` use `resolveResetBase`/`resetBase` |
| `backend/src/routes/auth.routes.js` | `POST /resetResend/:token`; `tokenValidation` moved first on `/resetPassword/:token` |
| `backend/.env` | `ALLOWED_RESET_BASES` (replaces `FORGOT_PASSWORD_REDIRECT_URL`, now removed) |

### Acceptance Criteria (backend)

- [x] `POST /resetResend/:token` resolves the user and emails a new reset link; returns JSON.
- [x] A fresh reset token row is inserted; existing rows are not deleted.
- [x] Unknown token → `400 "invalid token"`; bad `resetBase` → `400 "invalid reset url"`.
- [x] Email uses the password-reset template and the frontend-supplied (allow-listed) base.
- [x] Backend returns JSON only — no redirects, no frontend route names in code.
