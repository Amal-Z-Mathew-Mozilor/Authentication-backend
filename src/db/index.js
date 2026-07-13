import 'dotenv/config'
import { drizzle } from 'drizzle-orm/node-postgres'

// Environment configuration — all process.env reads live here at the top of the file.
const DATABASE_URL = process.env.DATABASE_URL

const db = drizzle(DATABASE_URL)
export default db
