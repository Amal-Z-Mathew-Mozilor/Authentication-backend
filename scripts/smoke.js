// Auth-flow smoke test — regression gate for verify-and-ship.
//
// Seeds a verified user directly in the DB (email verification can't be completed
// over HTTP since the token is only emailed), exercises the real auth flow against
// a RUNNING backend, checks negative cases, then deletes the test user.
//
// Usage:  node scripts/smoke.js        (server must already be listening)
//         SMOKE_BASE=http://host:port node scripts/smoke.js
// Exit:   0 = all passed, 1 = a check failed / crashed, 2 = backend unreachable.

import 'dotenv/config'
import { eq } from 'drizzle-orm'
import db from '../src/db/index.js'
import { users } from '../src/models/index.js'
import { hashPassword } from '../src/utils/password.js'

const BASE = process.env.SMOKE_BASE || 'http://localhost:8000'
const PREFIX = '/pulse/users'
const email = `smoke_${Date.now()}@example.com`
const password = 'Abcdefgh1!xx' // 12+ chars, upper/lower/number/special — policy-safe

let passed = 0
let failed = 0
const lines = []
function check(name, ok, detail = '') {
  lines.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
  ok ? passed++ : failed++
}

// Minimal cookie jar over fetch (fetch has no automatic cookie handling).
let jar = {}
function absorb(res) {
  const raw = res.headers.getSetCookie?.() ?? []
  for (const c of raw) {
    const pair = c.split(';')[0]
    const i = pair.indexOf('=')
    const k = pair.slice(0, i).trim()
    const v = pair.slice(i + 1).trim()
    if (!v) delete jar[k] // server cleared this cookie
    else jar[k] = v
  }
}
async function req(method, path, body) {
  const headers = {}
  const ck = Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')
  if (ck) headers.Cookie = ck
  if (body) headers['Content-Type'] = 'application/json'
  const res = await fetch(BASE + PREFIX + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  absorb(res)
  return res
}

// Same, but for an arbitrary path under BASE (e.g. /pulse/websites).
async function apiAt(method, path, body) {
  const headers = {}
  const ck = Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')
  if (ck) headers.Cookie = ck
  if (body) headers['Content-Type'] = 'application/json'
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  absorb(res)
  return res
}

async function cleanup() {
  try {
    await db.delete(users).where(eq(users.email, email))
  } catch {
    /* best effort */
  }
}

async function main() {
  // Preflight: is the backend reachable at all?
  try {
    await fetch(`${BASE}/`, { method: 'GET' })
  } catch {
    console.error(`Smoke: backend not reachable at ${BASE} — start it first.`)
    process.exit(2)
  }

  // Seed a verified user (bypasses the emailed-token step).
  await db.insert(users).values({
    email,
    password: await hashPassword(password),
    isVerified: true,
  })

  try {
    // Negative cases first
    const meNoAuth = await req('POST', '/me')
    check('me without auth → 401', meNoAuth.status === 401, `got ${meNoAuth.status}`)

    const badLogin = await req('POST', '/login', { email, password: 'Wrongpass1!xx' })
    check('login wrong password → 401', badLogin.status === 401, `got ${badLogin.status}`)
    jar = {}

    // Happy path: login → me → rotate → me → logout → me(dead)
    const login = await req('POST', '/login', { email, password })
    check('login → 200', login.status === 200, `got ${login.status}`)
    check('login sets accessToken cookie', !!jar.accessToken)
    check('login sets refreshToken cookie', !!jar.refreshToken)

    const me = await req('POST', '/me')
    check('me (authed) → 200', me.status === 200, `got ${me.status}`)

    const rotate = await req('POST', '/rotateToken')
    check('rotateToken → 200', rotate.status === 200, `got ${rotate.status}`)
    check('rotate issues new accessToken', !!jar.accessToken)

    const meAfterRotate = await req('POST', '/me')
    check('me after rotate → 200', meAfterRotate.status === 200, `got ${meAfterRotate.status}`)

    // Website CRUD (authenticated) — regression for the /pulse/websites resource
    const created = await apiAt('POST', '/pulse/websites', {
      name: 'Smoke Site',
      url: 'https://smoke.example.com',
    })
    check('website create → 201', created.status === 201, `got ${created.status}`)
    const createdBody = await created.json().catch(() => ({}))
    const wid = createdBody?.data?.id
    check('website create returns id', !!wid)

    const wList = await apiAt('GET', '/pulse/websites')
    const listBody = await wList.json().catch(() => ({}))
    check(
      'website list → 200 includes created',
      wList.status === 200 &&
        Array.isArray(listBody.data) &&
        listBody.data.some((x) => x.id === wid),
      `got ${wList.status}`,
    )

    // Cookie policy (About cookies) for the created website
    const cpGet0 = await apiAt('GET', `/pulse/websites/${wid}/cookie-policy`)
    check('cookie policy GET → 200 (empty ok)', cpGet0.status === 200, `got ${cpGet0.status}`)

    const cpPut = await apiAt('PUT', `/pulse/websites/${wid}/cookie-policy`, {
      heading: 'What are cookies?',
      description: 'Smoke test description.',
    })
    check('cookie policy PUT → 200', cpPut.status === 200, `got ${cpPut.status}`)

    const cpGet1 = await apiAt('GET', `/pulse/websites/${wid}/cookie-policy`)
    const cpBody = await cpGet1.json().catch(() => ({}))
    check(
      'cookie policy persisted aboutCookies.heading',
      cpBody?.data?.content?.aboutCookies?.heading === 'What are cookies?',
    )

    const cpNotOwned = await apiAt(
      'GET',
      '/pulse/websites/00000000-0000-0000-0000-000000000000/cookie-policy',
    )
    check('cookie policy of non-owned website → 404', cpNotOwned.status === 404, `got ${cpNotOwned.status}`)

    const wEdit = await apiAt('PUT', `/pulse/websites/${wid}`, {
      name: 'Smoke Site v2',
      url: 'https://smoke2.example.com',
    })
    check('website edit → 200', wEdit.status === 200, `got ${wEdit.status}`)

    const wBad = await apiAt('POST', '/pulse/websites', { name: '', url: 'nope' })
    check('website invalid input → 422', wBad.status === 422, `got ${wBad.status}`)

    const wDel = await apiAt('DELETE', `/pulse/websites/${wid}`)
    check('website delete → 200', wDel.status === 200, `got ${wDel.status}`)

    const wList2 = await apiAt('GET', '/pulse/websites')
    const listBody2 = await wList2.json().catch(() => ({}))
    check(
      'website gone after delete',
      !(listBody2.data || []).some((x) => x.id === wid),
    )

    const logout = await req('POST', '/logout')
    check('logout → 200', logout.status === 200, `got ${logout.status}`)

    const meDead = await req('POST', '/me')
    check(
      'me after logout → 401/403',
      meDead.status === 401 || meDead.status === 403,
      `got ${meDead.status}`,
    )
  } finally {
    await cleanup()
  }

  console.log(lines.join('\n'))
  console.log(`\nSmoke: ${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}

main().catch(async (e) => {
  console.error('Smoke crashed:', e?.message || e)
  await cleanup()
  process.exit(1)
})
