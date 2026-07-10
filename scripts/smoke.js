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

    // Duplicate prevention: name and url must each be unique per user.
    const dupName = await apiAt('POST', '/pulse/websites', {
      name: 'Smoke Site', // same name as wid
      url: 'https://unique-1.example.com',
    })
    check('website duplicate name → 422', dupName.status === 422, `got ${dupName.status}`)
    const dupUrl = await apiAt('POST', '/pulse/websites', {
      name: 'Totally Different Name',
      url: 'https://smoke.example.com/', // same url as wid (trailing slash ignored)
    })
    check('website duplicate url → 422', dupUrl.status === 422, `got ${dupUrl.status}`)

    // A genuinely unique name+url still creates.
    const created2 = await apiAt('POST', '/pulse/websites', {
      name: 'Smoke Site 2',
      url: 'https://smoke2.example.com',
    })
    check('website unique create → 201', created2.status === 201, `got ${created2.status}`)
    const wid2 = (await created2.json().catch(() => ({})))?.data?.id

    // Editing wid2 to collide with wid's name → 422.
    const editCollide = await apiAt('PUT', `/pulse/websites/${wid2}`, {
      name: 'Smoke Site',
      url: 'https://smoke2.example.com',
    })
    check('website edit collides with another name → 422', editCollide.status === 422, `got ${editCollide.status}`)
    // Editing wid2 to its OWN unchanged name+url → 200 (self excluded).
    const editSelf = await apiAt('PUT', `/pulse/websites/${wid2}`, {
      name: 'Smoke Site 2',
      url: 'https://smoke2.example.com',
    })
    check('website edit to own values (self-exclusion) → 200', editSelf.status === 200, `got ${editSelf.status}`)
    // Clean up wid2 so it can't collide with the later edit-of-wid test.
    await apiAt('DELETE', `/pulse/websites/${wid2}`)

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

    // Not "generated" until the explicit Generate action stamps it.
    check(
      'cookie policy not generated before Generate (no generatedAt)',
      !cpBody?.data?.content?.generatedAt,
      `got ${JSON.stringify(cpBody?.data?.content?.generatedAt)}`,
    )
    const cpGenerate = await apiAt('PUT', `/pulse/websites/${wid}/cookie-policy`, {
      effectiveDate: '2026-07-07',
      generated: true,
    })
    check('cookie policy PUT (generated) → 200', cpGenerate.status === 200, `got ${cpGenerate.status}`)
    const cpGetGen = await apiAt('GET', `/pulse/websites/${wid}/cookie-policy`)
    const cpGenBody = await cpGetGen.json().catch(() => ({}))
    check(
      'generate stamps content.generatedAt (ISO string)',
      typeof cpGenBody?.data?.content?.generatedAt === 'string' &&
        !Number.isNaN(Date.parse(cpGenBody.data.content.generatedAt)),
      `got ${JSON.stringify(cpGenBody?.data?.content?.generatedAt)}`,
    )

    // A saved edit after generating un-generates the policy (dashboard reopens the wizard).
    await apiAt('PUT', `/pulse/websites/${wid}/cookie-policy/aboutCookies`, {
      heading: 'What are cookies?',
      description: 'Edited after generate.',
    })
    const afterSectionEdit = await apiAt('GET', `/pulse/websites/${wid}/cookie-policy`)
    const aseBody = await afterSectionEdit.json().catch(() => ({}))
    check(
      'section save after generate clears generatedAt',
      !aseBody?.data?.content?.generatedAt,
      `got ${JSON.stringify(aseBody?.data?.content?.generatedAt)}`,
    )

    // Re-generate, then a non-generate meta save (effectiveDate only) also clears it.
    await apiAt('PUT', `/pulse/websites/${wid}/cookie-policy`, {
      effectiveDate: '2026-07-07',
      generated: true,
    })
    await apiAt('PUT', `/pulse/websites/${wid}/cookie-policy`, {
      effectiveDate: '2026-07-08',
    })
    const afterMetaEdit = await apiAt('GET', `/pulse/websites/${wid}/cookie-policy`)
    const ameBody = await afterMetaEdit.json().catch(() => ({}))
    check(
      'non-generate meta save clears generatedAt',
      !ameBody?.data?.content?.generatedAt,
      `got ${JSON.stringify(ameBody?.data?.content?.generatedAt)}`,
    )

    // HTML export ("HTML format" add-to-site option) — self-contained snippet.
    const htmlRes = await apiAt('GET', `/pulse/websites/${wid}/cookie-policy/html`)
    const htmlBody = await htmlRes.json().catch(() => ({}))
    const exportHtml = htmlBody?.data?.html
    check('cookie policy HTML export → 200', htmlRes.status === 200, `got ${htmlRes.status}`)
    check(
      'HTML export has policy h1 + a saved section heading + footer',
      typeof exportHtml === 'string' &&
        exportHtml.includes('<h1 class="cookie-policy-h1">Cookie Policy') &&
        exportHtml.includes('What are cookies?') &&
        exportHtml.includes('Cookie Policy generated for'),
    )
    const htmlNotOwned = await apiAt(
      'GET',
      '/pulse/websites/00000000-0000-0000-0000-000000000000/cookie-policy/html',
    )
    check('HTML export of non-owned website → 404', htmlNotOwned.status === 404, `got ${htmlNotOwned.status}`)

    // Send code to a teammate — validation + ownership only (NO live send, so no real
    // email is dispatched from the smoke run).
    const sendBadEmail = await apiAt('POST', `/pulse/websites/${wid}/cookie-policy/send-code`, {
      email: 'not-an-email',
    })
    check('send-code invalid email → 422', sendBadEmail.status === 422, `got ${sendBadEmail.status}`)
    // Valid email but non-owned website → passes validation, fails ownership before any send.
    const sendNotOwned = await apiAt(
      'POST',
      '/pulse/websites/00000000-0000-0000-0000-000000000000/cookie-policy/send-code',
      { email: 'teammate@example.com' },
    )
    check('send-code of non-owned website → 404', sendNotOwned.status === 404, `got ${sendNotOwned.status}`)

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
    // Image serve is now authenticated + owner-scoped — send the cookie jar.
    function getImg(url) {
      const headers = {}
      const ck = Object.entries(jar)
        .map(([k, v]) => `${k}=${v}`)
        .join('; ')
      if (ck) headers.Cookie = ck
      return fetch(BASE + url, { headers })
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

    const imgRes = await getImg(imgUrl)
    check(
      'image serve (authed owner) → 200 image/png',
      imgRes.status === 200 &&
        (imgRes.headers.get('content-type') || '').includes('image/png'),
      `got ${imgRes.status}`,
    )

    // No auth cookie → 401 (route is no longer public).
    const imgNoAuth = await fetch(BASE + imgUrl)
    check('image serve without auth → 401', imgNoAuth.status === 401, `got ${imgNoAuth.status}`)

    // Cross-user: a different logged-in user cannot read this user's image → 404.
    const otherEmail = `smoke_other_${Date.now()}@example.com`
    await db.insert(users).values({
      email: otherEmail,
      password: await hashPassword(password),
      isVerified: true,
    })
    try {
      const otherJar = {}
      const oLogin = await fetch(`${BASE}${PREFIX}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: otherEmail, password }),
      })
      for (const c of oLogin.headers.getSetCookie?.() ?? []) {
        const pair = c.split(';')[0]
        const i = pair.indexOf('=')
        const k = pair.slice(0, i).trim()
        const v = pair.slice(i + 1).trim()
        if (v) otherJar[k] = v
      }
      const ock = Object.entries(otherJar)
        .map(([k, v]) => `${k}=${v}`)
        .join('; ')
      const crossRes = await fetch(BASE + imgUrl, {
        headers: ock ? { Cookie: ock } : {},
      })
      check("another user's image → 404", crossRes.status === 404, `got ${crossRes.status}`)
    } finally {
      await db.delete(users).where(eq(users.email, otherEmail))
    }

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
    const servedKept = await getImg(imgUrl)
    check('image referenced in saved section is kept → 200', servedKept.status === 200, `got ${servedKept.status}`)

    // HTML export inlines the referenced image as a base64 data URI (portable snippet).
    const htmlWithImg = await apiAt('GET', `/pulse/websites/${wid}/cookie-policy/html`)
    const inlined = (await htmlWithImg.json().catch(() => ({})))?.data?.html || ''
    check(
      'HTML export inlines image as base64 (no /pulse/images url left)',
      inlined.includes('data:image/png;base64,') && !inlined.includes(imgUrl),
    )

    await apiAt('PUT', `/pulse/websites/${wid}/cookie-policy/aboutCookies`, {
      heading: 'What are cookies?',
      description: '<p>image removed now</p>',
      usedImageIds: [],
    })
    const servedGone = await getImg(imgUrl)
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
    const servedProtected = await getImg(imgBUrl)
    check('image kept via usedImageIds (unsaved sibling) → 200', servedProtected.status === 200, `got ${servedProtected.status}`)

    // "Delete" (reset) the policy → content restored to the default seed, all of
    // this policy's images swept, completedSections cleared.
    const cpDelete = await apiAt('DELETE', `/pulse/websites/${wid}/cookie-policy`)
    check('cookie policy delete (reset) → 200', cpDelete.status === 200, `got ${cpDelete.status}`)

    const cpGet2 = await apiAt('GET', `/pulse/websites/${wid}/cookie-policy`)
    const cpBody2 = await cpGet2.json().catch(() => ({}))
    const reset = cpBody2?.data?.content || {}
    check(
      'delete restores default aboutCookies heading',
      reset.aboutCookies?.heading === 'What are cookies?',
      `got ${JSON.stringify(reset.aboutCookies?.heading)}`,
    )
    check(
      'delete resets effectiveDate to today',
      reset.effectiveDate === seedToday,
      `got ${JSON.stringify(reset.effectiveDate)} want ${seedToday}`,
    )
    check(
      'delete clears generatedAt (policy reverts to not-generated)',
      !reset.generatedAt,
      `got ${JSON.stringify(reset.generatedAt)}`,
    )
    check(
      'delete clears completedSections',
      (reset.completedSections || []).length === 0,
      `got ${JSON.stringify(reset.completedSections)}`,
    )
    const servedAfterDelete = await getImg(imgBUrl)
    check('delete sweeps the policy images → 404', servedAfterDelete.status === 404, `got ${servedAfterDelete.status}`)

    const cpDelNotOwned = await apiAt(
      'DELETE',
      '/pulse/websites/00000000-0000-0000-0000-000000000000/cookie-policy',
    )
    check('cookie policy delete of non-owned website → 404', cpDelNotOwned.status === 404, `got ${cpDelNotOwned.status}`)

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
