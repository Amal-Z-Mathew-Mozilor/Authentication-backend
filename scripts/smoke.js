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

    // Website creation seeds a default cookie_policy (heading/description + today's date).
    const seedBody = await cpGet0.json().catch(() => ({}))
    const seed = seedBody?.data?.content || {}
    const seedToday = new Date().toISOString().slice(0, 10)
    check(
      'website create seeds default aboutCookies heading',
      seed.aboutCookies?.heading === 'What are cookies?',
      `got ${JSON.stringify(seed.aboutCookies?.heading)}`,
    )
    check(
      'website create seeds default useOfCookies + cookiePreferences headings',
      seed.useOfCookies?.heading === 'How do we use cookies?' &&
        seed.cookiePreferences?.heading === 'Manage cookie preferences',
    )
    check(
      'website create seeds effectiveDate = today',
      seed.effectiveDate === seedToday,
      `got ${JSON.stringify(seed.effectiveDate)} want ${seedToday}`,
    )
    // Progress tracking: defaults are seeded but nothing is user-saved yet.
    check(
      'fresh policy has no completedSections',
      (seed.completedSections || []).length === 0,
      `got ${JSON.stringify(seed.completedSections)}`,
    )

    const cpPut = await apiAt(
      'PUT',
      `/pulse/websites/${wid}/cookie-policy/aboutCookies`,
      { heading: 'What are cookies?', description: 'Smoke test description.' },
    )
    check('cookie policy PUT (aboutCookies) → 200', cpPut.status === 200, `got ${cpPut.status}`)

    // Second section — must persist alongside the first (sibling-key merge)
    const cpPutUse = await apiAt(
      'PUT',
      `/pulse/websites/${wid}/cookie-policy/useOfCookies`,
      { heading: 'How do we use cookies?', description: 'Use section description.' },
    )
    check('cookie policy PUT (useOfCookies) → 200', cpPutUse.status === 200, `got ${cpPutUse.status}`)

    // Third section + policy-level effective date (base-path PUT)
    const cpPutPref = await apiAt(
      'PUT',
      `/pulse/websites/${wid}/cookie-policy/cookiePreferences`,
      { heading: 'Manage cookie preferences', description: 'Preferences description.' },
    )
    check('cookie policy PUT (cookiePreferences) → 200', cpPutPref.status === 200, `got ${cpPutPref.status}`)

    const cpPutDate = await apiAt('PUT', `/pulse/websites/${wid}/cookie-policy`, {
      effectiveDate: '2026-07-07',
    })
    check('cookie policy PUT (effectiveDate) → 200', cpPutDate.status === 200, `got ${cpPutDate.status}`)

    const cpGet1 = await apiAt('GET', `/pulse/websites/${wid}/cookie-policy`)
    const cpBody = await cpGet1.json().catch(() => ({}))
    check(
      'cookie policy persisted aboutCookies.heading',
      cpBody?.data?.content?.aboutCookies?.heading === 'What are cookies?',
    )
    check(
      'cookie policy persisted useOfCookies.heading (both sections coexist)',
      cpBody?.data?.content?.useOfCookies?.heading === 'How do we use cookies?',
    )
    check(
      'cookie policy persisted cookiePreferences.heading (3 sections coexist)',
      cpBody?.data?.content?.cookiePreferences?.heading === 'Manage cookie preferences',
    )
    check(
      'cookie policy persisted effectiveDate (meta coexists with sections)',
      cpBody?.data?.content?.effectiveDate === '2026-07-07',
    )
    // Each section PUT auto-marks completion (deduped, survives the meta PUT + re-GET).
    const smokeCompleted = cpBody?.data?.content?.completedSections || []
    check(
      'completedSections contains all 3 saved sections',
      ['aboutCookies', 'useOfCookies', 'cookiePreferences'].every((k) =>
        smokeCompleted.includes(k),
      ) && smokeCompleted.length === 3,
      `got ${JSON.stringify(smokeCompleted)}`,
    )

    const cpBad = await apiAt(
      'PUT',
      `/pulse/websites/${wid}/cookie-policy/nonsense`,
      { heading: 'x', description: 'y' },
    )
    check('cookie policy unknown section → 404', cpBad.status === 404, `got ${cpBad.status}`)

    const cpBadDate = await apiAt('PUT', `/pulse/websites/${wid}/cookie-policy`, {
      effectiveDate: 'not-a-date',
    })
    check('cookie policy invalid effectiveDate → 422', cpBadDate.status === 422, `got ${cpBadDate.status}`)

    const cpNotOwned = await apiAt(
      'GET',
      '/pulse/websites/00000000-0000-0000-0000-000000000000/cookie-policy',
    )
    check('cookie policy of non-owned website → 404', cpNotOwned.status === 404, `got ${cpNotOwned.status}`)

    // Image upload (multipart) → serve → reject non-image
    async function uploadFile(blob, filename) {
      const fd = new FormData()
      fd.append('file', blob, filename)
      const headers = {}
      const ck = Object.entries(jar)
        .map(([k, v]) => `${k}=${v}`)
        .join('; ')
      if (ck) headers.Cookie = ck
      return fetch(`${BASE}/pulse/websites/${wid}/images`, {
        method: 'POST',
        headers,
        body: fd,
      })
    }
    const PNG_1x1 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    const up = await uploadFile(
      new Blob([Buffer.from(PNG_1x1, 'base64')], { type: 'image/png' }),
      'x.png',
    )
    check('image upload → 201', up.status === 201, `got ${up.status}`)
    const upBody = await up.json().catch(() => ({}))
    const imgUrl = upBody?.data?.url
    check(
      'image upload returns /pulse/images url',
      !!imgUrl && imgUrl.startsWith('/pulse/images/'),
    )

    const imgRes = await fetch(BASE + imgUrl)
    check(
      'image serve → 200 image/png',
      imgRes.status === 200 &&
        (imgRes.headers.get('content-type') || '').includes('image/png'),
      `got ${imgRes.status}`,
    )

    const badUp = await uploadFile(
      new Blob(['not an image'], { type: 'text/plain' }),
      'x.txt',
    )
    check('non-image upload rejected → 415', badUp.status === 415, `got ${badUp.status}`)

    // Orphan-image cleanup (reconcile on save). Save a section referencing image A →
    // A is kept; then save without it (and no usedImageIds) → A is swept.
    await apiAt('PUT', `/pulse/websites/${wid}/cookie-policy/aboutCookies`, {
      heading: 'What are cookies?',
      description: `<p>see <img src="${imgUrl}"></p>`,
    })
    const servedKept = await fetch(BASE + imgUrl)
    check('image referenced in saved section is kept → 200', servedKept.status === 200, `got ${servedKept.status}`)

    await apiAt('PUT', `/pulse/websites/${wid}/cookie-policy/aboutCookies`, {
      heading: 'What are cookies?',
      description: '<p>image removed now</p>',
      usedImageIds: [],
    })
    const servedGone = await fetch(BASE + imgUrl)
    check('image removed from content is swept → 404', servedGone.status === 404, `got ${servedGone.status}`)

    // Protection: an image not yet in saved content but reported live via usedImageIds
    // (e.g. dropped into an unsaved sibling section) must NOT be deleted.
    const upB = await uploadFile(
      new Blob([Buffer.from(PNG_1x1, 'base64')], { type: 'image/png' }),
      'b.png',
    )
    const imgBUrl = (await upB.json().catch(() => ({})))?.data?.url
    const imgBId = imgBUrl.split('/').pop()
    await apiAt('PUT', `/pulse/websites/${wid}/cookie-policy/useOfCookies`, {
      heading: 'How do we use cookies?',
      description: '<p>this section has no image</p>',
      usedImageIds: [imgBId],
    })
    const servedProtected = await fetch(BASE + imgBUrl)
    check('image kept via usedImageIds (unsaved sibling) → 200', servedProtected.status === 200, `got ${servedProtected.status}`)

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
