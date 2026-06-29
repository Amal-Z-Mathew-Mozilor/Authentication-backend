# Verify Email — Frontend-Agnostic Refactor (Backend)

> Backend side of the verify-email agnostic refactor. Frontend side is documented in
> `frontend/AI_DOCS/verify_email_agnostic.md`.

## 1. Plan

### Objective

Remove the last code-level frontend coupling: `verifyMail` no longer redirects to hardcoded
frontend routes. The backend returns **JSON only** and names **no** frontend route. The verify
email link points at the **frontend** `/verify/:token` page (base supplied by the frontend and
allow-listed, like `resetBase`).

### Flow (backend's part)
```
frontend /verify page → POST /pulse/users/verifyEmail/:token  (fetch, credentials: include)
   → verifyMail validates the token → JSON { message }   (sets cookies on success)
```

---

## 2. Specification

### Route
```js
// before:  user_route.get("/verifyEmail/:token", verifyMail)
user_route.post("/verifyEmail/:token", verifyMail)
```

### `verifyMail` → JSON (no redirects)
```js
const hashedToken = hashToken(req.params.token)
const [row] = await db.select({id, expiry, isUsed}).from(emailVerify).where(eq(emailVerify.token, hashedToken))
if (!row)                    throw new ApiError(403, "Invalid Token")
if (row.expiry < new Date()) throw new ApiError(401, "Token expired")
if (row.isUsed)              throw new ApiError(401, "token already used")
await db.update(emailVerify).set({ isUsed: true }).where(...)
await db.update(users).set({ isVerified: true }).where(...)
// set accessToken + refreshToken cookies, then:
return res.status(200).cookie(...).cookie(...).json(new ApiResponse(200, {}, "verified"))   // JSON, not redirect
```

### Email link → frontend base (allow-listed) in `signup` and `resendVerification`
```js
const base = resolveVerifyBase(req.body?.verifyBase)            // exact-match allowlist
... emailVerification("there", `${base}/${unhashedToken}`)      // → http://localhost:5173/verify/<token>
```
- `signup` reads `{ email, password, verifyBase }`; validates `verifyBase` first.
- `resendVerification` reads `verifyBase` from the body (the email-verification resend — uses the
  **verify** base, not the reset base).

### Allowlist util (`utils/verifyBase.js`)
```js
export function resolveVerifyBase(verifyBase){
  const allowed = (process.env.ALLOWED_VERIFY_BASES||"").split(",").map(s=>s.trim()).filter(Boolean)
  if(!verifyBase || !allowed.includes(verifyBase)) throw new ApiError(400,"invalid verify url")  // exact match
  return verifyBase
}
```

### Env
- Add `ALLOWED_VERIFY_BASES` (comma-separated), e.g. `http://localhost:5173/verify`.
- Remove `EMAIL_VERIFICATION` (link no longer points at the backend).

### Endpoint summary

| Method | Path | Success | Errors |
|--------|------|---------|--------|
| POST | `/pulse/users/verifyEmail/:token` | `200` "verified" (+ auth cookies) | `403` Invalid Token · `401` Token expired · `401` token already used |

---

## 3. Design Notes

- **Fully agnostic now:** `verifyMail` returns JSON and names no frontend route — removes the 4
  hardcoded redirect targets (`/verification-*`, `/home`).
- **Email link** is the only frontend reference, supplied by the frontend (`verifyBase`) and
  validated against the allowlist (config-level, like `resetBase`).
- **Cookies on success** flow through the `POST fetch` (`credentials: 'include'`), same as login.
- **Security:** `resolveVerifyBase` exact-match allowlist prevents open-redirect/phishing.

---

## 4. AI Prompts (verbatim)

> can we put the verify mail as a post and pass the url through body
> ... but when i click verify email button it goes to backend right we cannot just give post body init right?
> ... but pointing to frontend from backend breaks frontend agnostic right?
> ... so i just add verify email(front end ) in the send email?
> ... create the .md file for verify email agnostic refactor
> ... now split the .md file for backend and frontend folder and implement

---

## 5. Supporting Documentation

### Backend files Created / Modified

| File | Change |
|------|--------|
| `backend/src/controllers/auth.controller.js` | `verifyMail` → POST/JSON; `signup` + `resendVerification` build link from `verifyBase` |
| `backend/src/utils/verifyBase.js` *(new)* | `resolveVerifyBase` (allowlist) |
| `backend/src/routes/auth.routes.js` | `verifyEmail` route `GET` → `POST` |
| `backend/.env` | Add `ALLOWED_VERIFY_BASES`; remove `EMAIL_VERIFICATION` |

### Acceptance Criteria (backend)

- [ ] `POST /verifyEmail/:token` returns JSON for all cases (no redirect, no frontend route names).
- [ ] Verify email link built from the allow-listed `verifyBase` → points at the frontend.
- [ ] Successful verify sets auth cookies and returns `200 "verified"`.
- [ ] `signup`/`resendVerification` reject a `verifyBase` not in `ALLOWED_VERIFY_BASES` (`400`).
