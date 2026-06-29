import { passwordReset } from "../models";
import ApiError from "../utils/api-error";
import { asyncHandler } from "../utils/async-handler";

export const tokenValidation=asyncHandler(async(req,res,next)=>{
    const {token}=req.params
    const hashedToken=hashToken(token)
    const [user]=await db.select({id:passwordReset.userId,expiry:passwordReset.tokenExpiry,isUsed:passwordReset.isUsed}).from(passwordReset).where(eq(passwordReset.token,hashedToken))
    if(!user)
    {
       throw new ApiError("400","invalid token")
    }
    if(user.expiry < new Date())
    {
       throw new ApiError("400","expired token")
    }
    if (user.isUsed){
        throw new ApiError("400","already used token")
    }
    req.user={id:user.id}
    next()      
})