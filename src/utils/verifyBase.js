import ApiError from "./api-error.js"

// The verify link base is supplied by the frontend and MUST be validated against an allowlist
// (exact match) — an unchecked client URL would be an open-redirect / phishing vector.
export function resolveVerifyBase(verifyBase){
    const allowed=(process.env.ALLOWED_VERIFY_BASES||"").split(",").map(s=>s.trim()).filter(Boolean)
    if(!verifyBase || !allowed.includes(verifyBase)){
        throw new ApiError(400,"invalid verify url")
    }
    return verifyBase
}
