import db from "../db/index.js"
import { emailVerify } from "../models/index.js"
import { hashToken } from "../utils/token.js"
import ApiError from "../utils/api-error.js"
import { eq } from 'drizzle-orm'
import { asyncHandler } from "../utils/async-handler.js"

// Resolves an email-verification token (from the URL) to its userId so the resend
// controller knows whom to email. Does not check expiry/isUsed — the row is only used
// to identify the user (the token is expired by the time resend is triggered).
export const emailTokenValidation=asyncHandler(async(req,res,next)=>{
    const {token}=req.params
    const hashedToken=hashToken(token)
    const [row]=await db.select({userId:emailVerify.userId}).from(emailVerify).where(eq(emailVerify.token,hashedToken))
    if(!row)
    {
        throw new ApiError(400,"invalid token")
    }
    req.user={id:row.userId}
    next()
})
