import express from 'express'
import { forgotPasswordEmail, loginEmailValidator, registerValidator, resetPasswordValidator, changePasswordValidator} from '../validators/user.validator.js'
import { validation } from '../middlewares/auth.middleware.js'
import { changePassword, checkResetToken, forgotPassword, login, logout, me, resendVerification, resetPassword, resetResend, rotateToken, signup, verifyMail } from '../controllers/auth.controller.js'
import { jwtValidation } from '../middlewares/jwt.middleware.js'
import { loginMiddleware } from '../middlewares/login.middleware.js'
import { tokenValidation } from '../middlewares/passwordReset.middleware.js'
import { emailTokenValidation } from '../middlewares/emailVerify.middleware.js'
import { resetTokenResolve } from '../middlewares/passwordResend.middleware.js'
export  const user_route=express.Router()
user_route.post("/signup",registerValidator(),validation,signup)
user_route.post("/verifyEmail/:token",verifyMail)
user_route.post("/login",loginMiddleware,login)
user_route.get("/logout",jwtValidation,logout)
user_route.post("/forgotPassword",forgotPasswordEmail(),validation,forgotPassword)
user_route.get("/resetPassword/:token/check",tokenValidation,checkResetToken)
user_route.post("/resetPassword/:token",tokenValidation,resetPasswordValidator(),validation,resetPassword)
user_route.post("/rotateToken",rotateToken)
user_route.post("/changePassword",jwtValidation,changePasswordValidator(),validation,changePassword)
user_route.get("/me",jwtValidation,me)
user_route.post("/resend/:token",emailTokenValidation,resendVerification)
user_route.post("/resetResend/:token",resetTokenResolve,resetResend)