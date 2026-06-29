import express from "express"
import { user_route } from "./routes/auth.routes.js";
import cookieParser from 'cookie-parser'
import "dotenv/config"
export const app=express();
const port=process.env.PORT
app.use(express.json())
app.use(cookieParser())
app.use('/pulse/users',user_route)
app.use((err, req, res, next) => {
    const status = err.statuscode || 500;
    res.status(status).json({
        success: false,
        message: err.message || "Internal Server Error",
        errors: err.error || []
    });
})
app.listen(port,()=>{
    console.log(`listenng to ${port}`)
})
