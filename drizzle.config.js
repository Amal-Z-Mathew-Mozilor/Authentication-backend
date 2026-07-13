import 'dotenv/config'
import { defineConfig } from 'drizzle-kit'

// Environment configuration — all process.env reads live here at the top of the file.
const DATABASE_URL = process.env.DATABASE_URL

export default defineConfig({
  out: './drizzle',
  schema: './src/models/index.js',
  dialect: 'postgresql',
  dbCredentials: {
    url: DATABASE_URL,
  },
})
