import jwt from "jsonwebtoken"
import {redisClient} from "../db/redis.js"
import{users}from"../models/index.js"
import db from"../db/index.js"
import{eq} from 'drizzle-orm'
import ApiError from "./api-error.js"
import 'dotenv/config'
import crypto from 'crypto'
export const acessSign=async function(userId)
{
    const [payload]=await db.select({id:users.userId,email:users.email}).from(users).where(eq(users.userId,userId))
    if (!payload) {
    throw new ApiError(404, "User not found");
    }
    const unhashedToken=crypto.randomBytes(20).toString("hex")
    payload.jti=unhashedToken
    const acessToken=jwt.sign(payload,process.env.ACCESS_SECRETKEY,{expiresIn:process.env.ACCESS_EXPIRY})
    return acessToken
}
export const refreshSign=async function(userId)
{
    const refreshToken=jwt.sign({id:userId},process.env.REFRESH_SECRETKEY,{expiresIn:process.env.REFRESH_EXPIRY})
    const { exp }=jwt.decode(refreshToken)
    const ttlSeconds=exp - Math.floor(Date.now()/1000)
     await redisClient.set(
        `refresh:${refreshToken}`,
        userId,
        {
            EX: ttlSeconds
        }
    );

    return refreshToken

}
export const verifyAccess= function(token)
{ 
    const decoded=jwt.verify(token,process.env.ACCESS_SECRETKEY)
    return decoded
}
export const verifyRefresh=async function(token)
{
    const decoded=jwt.verify(token,process.env.REFRESH_SECRETKEY)
    const storedToken = await redisClient.get(
        `refresh:${token}`
    );

    if (!storedToken) {
        throw new ApiError(403,"Invalid refresh token");
    }
    if(storedToken!=decoded.id)
    {
         throw new ApiError(403,"Invalid refresh token");
    }
    return decoded
}
