import db from "../db/index.js"
import ApiError from "../utils/api-error.js"
import ApiResponse from "../utils/api-response.js"
import{emailVerification,passwordResetVerification,sendEmail} from "../utils/mail.js"
import { hashPassword,verifyPassword } from "../utils/password.js"
import { hashToken, tokenGeneration } from "../utils/token.js"
import{users,emailVerify,passwordReset} from '../models/index.js'
import { asyncHandler } from "../utils/async-handler.js"
import{eq} from 'drizzle-orm'
import { acessSign, refreshSign, verifyRefresh } from "../utils/jwt.js"
import {redisClient} from "../db/redis.js"
import { resolveResetBase } from "../utils/resetBase.js"
import { resolveVerifyBase } from "../utils/verifyBase.js"
export const signup=asyncHandler(async(req,res)=>{
    const {email,password,verifyBase}=req.body
    const base=resolveVerifyBase(verifyBase)
    const [existing]= await db.select({email:users.email}).from(users).where(eq(users.email,email))
    if(existing)
    {
        throw new ApiError(400,"email already exist")
    }
    const hash=await hashPassword(password)
    const [user]=await db.insert(users).values({password:hash,email:email}).returning({id:users.userId})
    const{unhashedToken,hashedToken,tokenExpiry}=tokenGeneration()
    await db.insert(emailVerify).values({token:hashedToken,tokenExpiry:tokenExpiry,userId:user.id})
    await sendEmail({email:email,subject:"please verify your email",emailContent:emailVerification("there",`${base}/${unhashedToken}`)})
    return res.status(201).json(new ApiResponse(201,{},"Account created successfully. Please verify your email."))
})
export const verifyMail=asyncHandler(async(req,res)=>{
    const {token}=req.params
    const hashedToken=hashToken(token)
    const [user]=await db.select({id:emailVerify.userId,expiry:emailVerify.tokenExpiry,isUsed:emailVerify.isUsed}).from(emailVerify).where(eq(emailVerify.token,hashedToken))
    if(!user)
    {
        throw new ApiError(403,"Invalid Token")
    }
    if(user.expiry < new Date())
    {
        throw new ApiError(401,"Token expired")
    }
    if (user.isUsed){
        throw new ApiError(401,"token already used")
    }
    await db.update(emailVerify).set({isUsed:true}).where(eq(emailVerify.token,hashedToken))
    await db.update(users).set({isVerified:true}).where(eq(users.userId,user.id))
    const accessToken=await acessSign(user.id)
    const refreshToken=await refreshSign(user.id)
    const options={httpOnly:true,secure:process.env.NODE_ENV === "production"}
    return res.status(200).cookie("accessToken",accessToken,options).cookie("refreshToken",refreshToken,options).json(new ApiResponse(200,{},"verified"));
})
export const forgotPassword=asyncHandler(async(req,res)=>{
    const {email,resetBase}=req.body
    const base=resolveResetBase(resetBase)
    const [user]=await db.select({id:users.userId,email:users.email}).from(users).where(eq(users.email,email))
    if(!user)
    {
         return res.status(200).json(new ApiResponse(200,{},"If the email exists, a reset link has been sent"))
    }
    const{unhashedToken,hashedToken,tokenExpiry}=tokenGeneration()
    await db.insert(passwordReset).values({userId:user.id,token:hashedToken,tokenExpiry:tokenExpiry})
    await sendEmail({email:user.email,subject:"To reset your password please verify your email",emailContent:passwordResetVerification("there",`${base}/${unhashedToken}`)})
    return res.status(200).json(new ApiResponse(200,{},"If the email exists, a reset link has been sent"))
})
export const checkResetToken=asyncHandler(async(req,res)=>{
    // tokenValidation already ran: it throws 401/403 for expired/used/invalid tokens.
    // Reaching here means the token is valid. Read-only check — token is NOT consumed.
    return res.status(200).json(new ApiResponse(200,{},"valid"))
})
export const resetPassword=asyncHandler(async(req,res)=>{
  
   const{newPassword,confirmPassword,email}=req.body
   if(newPassword!=confirmPassword)
   {  
      throw new ApiError(400,"Passwords doesn't match")
   }
    
    const id=req.user.id
    const [user]=await db.select({password:users.password,email:users.email}).from(users).where(eq(users.userId,id))
    if(!user)
    {
        throw new ApiError(400,"user doesn't exist")
    }
    const result=await verifyPassword(newPassword,user.password)
    if(result)
    {
        throw new ApiError(400,"password cannot be same as old password")
    }
    if(email!=user.email)
    {
        throw new ApiError(400,"invalid credential")
    }
    const hash=await hashPassword(newPassword)
    await db.update(users).set({password:hash}).where(eq(users.userId,id))
    await db.update(passwordReset).set({isUsed:true}).where(eq(passwordReset.token,req.user.token))
    return res.status(200).json(new ApiResponse(200,{},"password updated sucessfully"))
})
export const login=asyncHandler(async(req,res)=>{
     const MAX_ATTEMPTS = 5;
     const MAX_IP_ATTEMPTS=10;
     const key = `login:ip:${req.ip}`;
     const {email,password}=req.body
     const[user]=await db.select({id:users.userId,locked:users.isLocked,lockedUntil:users.lockedUntil,limit:users.failedLoginAttempts,verified:users.isVerified,password:users.password}).from(users).where(eq(users.email,email))
     if(!user)
     {
       const attempts= await redisClient.incr(key);

       if (attempts >= MAX_IP_ATTEMPTS) {
        const ttl = await redisClient.ttl(key);

         throw new ApiError(
          429,
           "Too many login attempts.",
          {
              retryAfter: ttl
           }
           );
         }
        throw new ApiError(401,"invalid credential")
    }
    if(user.locked)
    {
        if(user.lockedUntil>new Date())
        {
            const remainingTime = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 1000);
            throw new ApiError(401,`Account is locked pls try again after${remainingTime}`)
        }
        await db.update(users).set({isLocked:false,lockedUntil:null,failedLoginAttempts:0}).where(eq(users.userId,user.id))
        user.limit=0
    }
    const result=await verifyPassword(password,user.password)
    if (!result) {
    const limit = user.limit + 1;

    const attempt=await redisClient.incr(key);
    if(limit >= MAX_ATTEMPTS ||attempt >= MAX_IP_ATTEMPTS){
      let remainingTime=0
    if (limit >= MAX_ATTEMPTS) {
        const lockedUntil = new Date(Date.now() + 2 * 60 * 1000);
      
        await db.update(users)
            .set({
                failedLoginAttempts: limit,
                isLocked: true,
                lockedUntil
            })
            .where(eq(users.userId, user.id));

         remainingTime = Math.ceil(
            (lockedUntil.getTime() - Date.now()) / 1000
        );
      }

       if (attempt >= MAX_IP_ATTEMPTS) {
        const ttl = await redisClient.ttl(key);

         throw new ApiError(
          429,
           "Too many login attempts.",
          {
              retryAfter: ttl
           }
           );
        }
        throw new ApiError(
            401,
            `Account is locked. Try again after ${remainingTime} seconds.`
        );
    }

    await db.update(users)
        .set({ failedLoginAttempts: limit })
        .where(eq(users.userId, user.id));

    throw new ApiError(401, "Invalid credentials");}
    if(!user.verified)
    {
        throw new ApiError(401,"pls verify email")
    }
     await redisClient.del(key);
     await db.update(users).set({failedLoginAttempts:0}).where(eq(users.userId,user.id))
    const accessToken=await acessSign(user.id)
    const refreshToken=await refreshSign(user.id)
    const options={httpOnly:true,secure:process.env.NODE_ENV === "production"}
    return res.status(200).cookie("accessToken",accessToken,options).cookie("refreshToken",refreshToken,options).json(new ApiResponse(200,{},"login sucessfull")); 
})
export const logout=asyncHandler(async(req,res)=>{
  const { refreshToken }=req.cookies
  const token=await redisClient.get(`refresh:${refreshToken}`)
  if(!token)
    {
        throw new ApiError(401,"invalid token")
    }
    await redisClient.del(`refresh:${refreshToken}`)
    const ttl = req.user.exp - Math.floor(Date.now() / 1000);
    await redisClient.set(`blacklist:${req.user.jti}`,"true", {EX: ttl,});
    return res.status(200).clearCookie("accessToken").clearCookie("refreshToken").json(new ApiResponse(200,{},"logout sucessful"))
})
export const rotateToken=asyncHandler(async(req,res)=>{
   const{ refreshToken }=req.cookies
   if(!refreshToken)
   {
      throw new ApiError(401, "Refresh token missing");
   }
   let decoded;
   try{

         decoded=await verifyRefresh(refreshToken)
   }catch(err)
   {
       throw new ApiError(400,"invalid token")
   }
    await redisClient.del(`refresh:${refreshToken}`)
    const accessToken=await acessSign(decoded.id)
    const refresh=await refreshSign(decoded.id)
    const options={httpOnly:true,secure:process.env.NODE_ENV === "production"}
    return res.status(200).cookie("accessToken",accessToken,options).cookie("refreshToken",refresh,options).json(new ApiResponse(200,{},"token rotated sucessfully"));
})
export const changePassword=asyncHandler(async(req,res)=>{
 const {oldPassword,newPassword,confirmPassword}=req.body
 const [user]=await db.select({password:users.password}).from(users).where(eq(users.userId,req.user.id))
 const result=await verifyPassword(oldPassword,user.password)
  if(!result)
  {
       throw new ApiError(400,"old password doesnt match")
  } 
  
  if(confirmPassword!=newPassword)
  {
      throw new ApiError(400,"new and confirm password are wrong")
  }
  const same=await verifyPassword(newPassword,user.password)
   if(same)
   {
     throw new ApiError(400,"new password must not be same as old one")
   }
  const hash=await hashPassword(newPassword)
  await db.update(users).set({password:hash}).where(eq(users.userId,req.user.id))
  return res.status(200).json(new ApiResponse(200,{},"password reseted sucessfully"))
})
export const me=asyncHandler(async(req,res)=>{
 const {email}=req.user
 return res.status(200).json(new ApiResponse(200,email,"user authenticated sucessfully"))
})
export const resendVerification=asyncHandler(async(req,res)=>{
    const id=req.user.id
    const base=resolveVerifyBase(req.body?.verifyBase)
    const [user]=await db.select({email:users.email,verified:users.isVerified}).from(users).where(eq(users.userId,id))
    if(!user)
    {
        throw new ApiError(400,"user doesn't exist")
    }
    if(user.verified)
    {
        throw new ApiError(400,"email already verified")
    }
    const{unhashedToken,hashedToken,tokenExpiry}=tokenGeneration()
    await db.insert(emailVerify).values({token:hashedToken,tokenExpiry:tokenExpiry,userId:id})
    await sendEmail({email:user.email,subject:"please verify your email",emailContent:emailVerification("there",`${base}/${unhashedToken}`)})
    return res.status(200).json(new ApiResponse(200,{},"A new verification email has been sent."))
})
export const resetResend=asyncHandler(async(req,res)=>{
    const id=req.user.id
    const base=resolveResetBase(req.body?.resetBase)
    const [user]=await db.select({email:users.email}).from(users).where(eq(users.userId,id))
    if(!user)
    {
        throw new ApiError(400,"user doesn't exist")
    }
    const{unhashedToken,hashedToken,tokenExpiry}=tokenGeneration()
    await db.insert(passwordReset).values({token:hashedToken,tokenExpiry:tokenExpiry,userId:id})
    await sendEmail({email:user.email,subject:"To reset your password please verify your email",emailContent:passwordResetVerification("there",`${base}/${unhashedToken}`)})
    return res.status(200).json(new ApiResponse(200,{},"A new password reset email has been sent."))
})