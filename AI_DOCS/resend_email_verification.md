# Resend Email Verification Feature Plan


## 1. Plan

### Objective

Let a user whose email-verification link has **expired** request a new verification email,
directly from the `/verification-expired` page. The expired token (carried in the URL)
identifies the user, so no email input is needed.

### Goals

- `verifyMail` includes the token in the **expired** redirect:
  `${FRONTEND_URL}/verification-expired/${token}`.
- A new backend endpoint `POST /pulse/users/resend/:token`.
- A middleware that resolves `:token` → `userId` and sets `req.user.id`
  (mirrors the existing password-reset `tokenValidation` pattern).
- A `resend` controller that, from `req.user.id`, generates a fresh token, inserts a new
  token row (existing rows are **kept, not deleted**), and sends a new verification email.
- The frontend expired page reads the token and wires the **Resend** button to the endpoint,
  then shows "A new verification email has been sent."

### Scope

In scope:
- Backend: expired-redirect change, new route + middleware + `resend` controller.
- Frontend: route becomes `/verification-expired/:token`; wire the Resend button.

Out of scope:
- Resend on any **other** page — resend is offered **only** for expired tokens. The
  `/already-verified` and `/verification-invalid` pages are unchanged (no resend).
- Rate limiting on resend (noted as an optional later hardening).

---

## 2. Specification

### 2.1 Backend

**`verifyMail` — expired branch (edit one line):**
```js
// before
return res.redirect(`${process.env.FRONTEND_URL}/verification-expired`)
// after
return res.redirect(`${process.env.FRONTEND_URL}/verification-expired/${token}`)
```
`token` here is the raw token already in `req.params`. Only the **expired** redirect changes;
`verification-invalid`, `already-verified`, and `home` redirects stay the same.

**New route:**
```js
user_route.post("/resend/:token", emailTokenValidation, resendVerification)
```
> **Why POST (not GET):** resend has side effects (creates a token row + sends an email).
> GET would technically work (token is in the URL, no body needed), but GET should stay
> side-effect-free — it can be prefetched/cached/crawled, which could trigger accidental
> resends. POST is the correct choice for a state-changing action.

**Middleware `emailTokenValidation`** (new; same shape as password-reset `tokenValidation`):
1. `const { token } = req.params`
2. `hashedToken = hashToken(token)`
3. Look up the row in `email_verification_tokens` by `token = hashedToken`, selecting `userId`.
4. If no row → `throw new ApiError(400, "invalid token")`.
5. `req.user = { id: row.userId }` → `next()`.

> The lookup does **not** check expiry/`isUsed` — its only job is to resolve the user from
> the (expired) token. The expired row still exists in the table, so it is findable.

**Controller `resendVerification`:**
1. `id = req.user.id`.
2. Fetch the user `{ email, isVerified }` by `id`.
3. If `isVerified` is already `true` → `throw new ApiError(400, "email already verified")`.
4. `tokenGeneration()` → `{ unhashedToken, hashedToken, tokenExpiry }`.
5. Insert the new token row. **Do not delete** the user's existing rows — keep them as-is.
6. `sendEmail` with `emailVerification("there", link)`, where
   `link = ${req.protocol}://${req.get("host")}${process.env.EMAIL_VERIFICATION}${unhashedToken}`.
7. Respond `200 ApiResponse(200, {}, "A new verification email has been sent.")`.

**Endpoint summary:**

| Method | Path | Middleware | Success | Errors |
|--------|------|-----------|---------|--------|
| POST | `/pulse/users/resend/:token` | `emailTokenValidation` | `200` "A new verification email has been sent." | `400` invalid token · `400` already verified |

### 2.2 Frontend

- **Route:** `/verification-expired/:token` (replaces `/verification-expired`).
- **`VerificationExpiredPage`:**
  - Read the token via `useParams()`.
  - **Resend** button → `POST /pulse/users/resend/${token}` (`credentials: 'include'`).
  - States: `idle → sending → sent`. On success show **"A new verification email has been sent."**
  - On error (`400`/network) → toast (consistent with other pages).

---

## 3. Design Notes

- **Resend only when expired:** the button lives solely on the expired page; the other two
  status pages remain link-free status messages.
- **Token as identifier:** reuses the proven password-reset `tokenValidation` approach — hash
  the URL token, look up the row, attach the id to `req.user`. No email prompt required.
- **No deletion of old tokens (per decision):** resend only **inserts** a new token row; it
  does not delete prior rows. Any non-expired token still matches in `verifyMail` (lookup is
  by token value). Trade-off: token rows accumulate for a user over time (acceptable here).
- **Consistency:** reuse `tokenGeneration`, `hashToken`, `sendEmail`, the `emailVerification`
  Mailgen template, and `ApiResponse`/`ApiError` — same conventions as `signup`/`verifyMail`.
- **Security:** an expired token acts as a bearer that can trigger one more email — but only
  ever to the **registered** address, so the risk is low. Optional later: rate-limit resend.

---

## 4. AI Prompts

### Prompt 1 — Design discussion (verbatim)

> about the resend button for email verify from the token of the url we can get the userid of
> the user with that token which can be done as a middleware and give id as req.user.id and
> based on the user id we can generate new token and send mail

### Prompt 2 — Decisions + request (verbatim)

> only give resend option when token is expired and provide token with url for expired
> redirect now give .md file

### Prompt 3 — Refinements (verbatim)

> Delete the user's existing `email_verification_tokens` rows, then insert the new one. dont
> do this dont delete and why user_route.post("/resend/:token", emailTokenValidation,
> resendVerification) post get is enough right

---

## 5. Supporting Documentation

### Files to be Created / Modified (planned)

| File | Change |
|------|--------|
| `backend/src/controllers/auth.controller.js` | Edit `verifyMail` expired redirect; add `resendVerification` |
| `backend/src/middlewares/emailVerify.middleware.js` *(new)* | `emailTokenValidation` (token → `req.user.id`) |
| `backend/src/routes/auth.routes.js` | Add `POST /resend/:token` with the middleware |
| `frontend/src/App.jsx` | Route `/verification-expired/:token` |
| `frontend/src/VerificationExpiredPage.jsx` | Read token, wire Resend button to the endpoint |

### Acceptance Criteria

- [ ] Expired verification link redirects to `/verification-expired/<token>` (token in URL).
- [ ] `POST /resend/:token` resolves the user via the middleware and emails a new link.
- [ ] A fresh token row is inserted; existing rows are **not** deleted.
- [ ] Resend on an already-verified account returns `400 "email already verified"`.
- [ ] Frontend Resend button calls the endpoint and shows "A new verification email has been sent."
- [ ] Resend appears **only** on the expired page (invalid / already-verified unchanged).

### Decisions / Open Items

1. **Already-verified handling:** plan refuses with `400 "email already verified"` — confirm
   this is the desired behavior (vs. silently resending).
2. **Route style:** path param `/verification-expired/:token` (chosen) vs. query
   `?token=`. Path param assumed.
3. **Rate limiting:** not included now; can be added later (e.g. Redis, like login).

### Backend changes require your approval

Per the project rule, the backend edits above (verifyMail redirect, new middleware, new
route, `resend` controller) will only be made after you approve this plan.
