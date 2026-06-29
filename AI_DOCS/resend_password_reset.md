# Resend Password Reset Feature

> Full-stack feature (backend + frontend). **Status: implemented.**
> Single source of doc for the password-reset resend flow, including the frontend-supplied
> reset link + allowlist validation.

## 1. Plan

### Objective

Let a user whose **password-reset link has expired** request a new one — mirroring the
email-verification resend, but sending the **password-reset** email. The expired reset token
(already in the `/resetPassword/:token` URL) identifies the user.

### Design choices

- **Frontend-agnostic:** the backend returns **JSON only** and never redirects to or hardcodes
  a frontend route. The frontend reacts to the JSON and does its own client-side navigation.
- **Reset link supplied by the frontend (Option 2 + allowlist):** the frontend sends the reset
  base URL (`resetBase`); the backend validates it against an **allowlist** before using it.
  (Acknowledged: the allowlist is mandatory for security and keeps the same config-level
  coupling — chosen deliberately.)
- **Insert, don't delete:** resend only inserts a new token row; existing rows are kept.

---

## 2. Specification

### 2.1 Backend (JSON only — no redirects, no frontend route names in code)

**Route:**
```js
user_route.post("/resetResend/:token", resetTokenResolve, resetResend)   // POST: side effects (token + email)
```

**Middleware `resetTokenResolve`** (`middlewares/passwordResend.middleware.js`):
1. `const { token } = req.params`; `hashedToken = hashToken(token)`.
2. Look up `password_reset_tokens` by `token = hashedToken`, select `userId`.
3. If no row → `throw new ApiError(400, "invalid token")`.
4. `req.user = { id: row.userId }` → `next()`.
- No expiry/`isUsed` check — only resolves the user from the (expired) token. Separate from the
  existing `tokenValidation` (which enforces expiry/used for the actual reset).

**Controller `resetResend`** (`controllers/auth.controller.js`):
1. `id = req.user.id`; `base = resolveResetBase(req.body?.resetBase)`.
2. Fetch user `{ email }` by `id`; if missing → `400 "user doesn't exist"`.
3. `tokenGeneration()` → `{ unhashedToken, hashedToken, tokenExpiry }`.
4. **Insert** the new row into `password_reset_tokens` (no delete).
5. `sendEmail` with `passwordResetVerification("there", \`${base}/${unhashedToken}\`)`.
6. `200 ApiResponse(200, {}, "A new password reset email has been sent.")`.

**Reset-base allowlist** (`utils/resetBase.js`):
```js
export function resolveResetBase(resetBase){
  const allowed = (process.env.ALLOWED_RESET_BASES||"").split(",").map(s=>s.trim()).filter(Boolean)
  if(!resetBase || !allowed.includes(resetBase)) throw new ApiError(400,"invalid reset url")  // exact match
  return resetBase
}
```
- Env: `ALLOWED_RESET_BASES` = comma-separated allowed bases, e.g. `http://localhost:5173/resetPassword`.
- Used by both **`forgotPassword`** and **`resetResend`** (both now build the link from the
  validated `resetBase` instead of `FORGOT_PASSWORD_REDIRECT_URL`).
- Exact match only (prefix match would be exploitable, e.g. `…/resetPassword.evil.com`).

**Detecting "expired" needs no backend change:** the existing `tokenValidation` already returns
`401 "Token expired"` / `401 "token already is used"` / `403 "Invalid Token"` on the reset submit.

**Endpoint summary:**

| Method | Path | Middleware | Success | Errors |
|--------|------|-----------|---------|--------|
| POST | `/pulse/users/resetResend/:token` | `resetTokenResolve` | `200` "A new password reset email has been sent." | `400` invalid token · `400` invalid reset url · `400` user doesn't exist |

### 2.2 Frontend (owns all routing; supplies the reset base)

- **`ForgotPasswordPage`** — sends `{ email, resetBase: \`${window.location.origin}/resetPassword\` }`.
- **`ResetPasswordPage`** — after the reset `POST`:
  - `401 "Token expired"` / `"token already is used"` → `navigate('/reset-expired/' + token)`.
  - `403 "Invalid Token"` and other errors → banner (resend can't resolve an invalid token).
- **`ResetExpiredPage`** (`/reset-expired/:token`) — "Reset link expired" + **Resend reset link**
  button → `POST /resetResend/:token` with `{ resetBase: \`${window.location.origin}/resetPassword\` }`
  → on `200` show "A new password reset email has been sent."; errors → toast.

### Flow
```
reset email link → /resetPassword/:token  (frontend form)
   submit → POST /resetPassword/:token
      ├─ valid    → 200 → "Password updated"
      ├─ expired/used (401) → frontend navigate → /reset-expired/:token
      │      └─ Resend → POST /resetResend/:token (+ resetBase) → new email
      └─ invalid (403) / 400s → banner
```

---

## 3. Design Notes

- **Frontend-agnostic backend:** JSON responses only; the frontend decides every route. The only
  frontend reference is the reset link, which is now **supplied by the frontend** and validated
  against the allowlist (config-level).
- **Mirrors the email-verification resend** (middleware + controller pattern); differs in table
  (`password_reset_tokens`), template (`passwordResetVerification`), and link base.
- **Security:** `resolveResetBase` exact-match allowlist prevents open-redirect/phishing via a
  client-supplied URL. An expired reset token is a one-time bearer that only ever emails the
  registered address.
- **Consistency:** reuses `tokenGeneration`, `hashToken`, `sendEmail`, `passwordResetVerification`,
  `ApiResponse`/`ApiError`.

---

## 4. AI Prompts (verbatim)

### Prompt 1 — Feature request
> ok now i want to implement password resend like email resend for that i want a middleware and
> controller just like emailverification of sign up and it should function similar to it except
> the content send as a mail first create a . md file for it

### Prompt 2 — Approach
> ok for now do the reset password thing we will change verify email part after that create .md
> file for it
> *(Chosen: frontend-agnostic — backend returns JSON, frontend navigates to `/reset-expired/:token`.)*

### Prompt 3 — Reset link from frontend
> ok do as option2 get the url from the frontend
> *(Confirmed: Option 2 **with allowlist** — frontend sends `resetBase`, backend validates against
> `ALLOWED_RESET_BASES`.)*

### Prompt 4 — Docs
> ok now update the ai docs we dont need two .md files for this just one .md file for resend of
> password update the new chaages and create a new single .md file

---

## 5. Supporting Documentation

### Files Created / Modified

| File | Change |
|------|--------|
| `backend/src/middlewares/passwordResend.middleware.js` *(new)* | `resetTokenResolve` (reset token → `req.user.id`) |
| `backend/src/utils/resetBase.js` *(new)* | `resolveResetBase` (allowlist validation) |
| `backend/src/controllers/auth.controller.js` | `resetResend` controller; `forgotPassword` + `resetResend` use `resolveResetBase`/`resetBase` |
| `backend/src/routes/auth.routes.js` | `POST /resetResend/:token` with `resetTokenResolve` |
| `backend/.env` | `ALLOWED_RESET_BASES` |
| `frontend/src/ResetExpiredPage.jsx` *(new)* | Expired page + Resend button (sends `resetBase`) |
| `frontend/src/App.jsx` | `/reset-expired/:token` route |
| `frontend/src/ResetPasswordPage.jsx` | Navigate to `/reset-expired/:token` on expired/used token |
| `frontend/src/ForgotPasswordPage.jsx` | Send `resetBase` in the request body |

### Acceptance Criteria

- [x] `POST /resetResend/:token` resolves the user and emails a new reset link; returns JSON.
- [x] A fresh reset token row is inserted; existing rows are not deleted.
- [x] Unknown token → `400 "invalid token"`; bad `resetBase` → `400 "invalid reset url"`.
- [x] Email uses the password-reset template and the frontend-supplied (allow-listed) base.
- [x] Expired/used token on submit → frontend navigates to `/reset-expired/:token`.
- [x] `/reset-expired/:token` Resend calls the endpoint and shows the success message.
- [x] Backend returns JSON only — no redirects, no frontend route names in code.

### Notes

- `FORGOT_PASSWORD_REDIRECT_URL` is no longer used by `forgotPassword`/`resetResend` (replaced by
  the frontend-supplied `resetBase`); it can be removed from `.env`.
- For production, add the prod origin to `ALLOWED_RESET_BASES` (comma-separated).
