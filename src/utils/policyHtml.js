// Renders a website's saved cookie-policy content as a self-contained HTML snippet
// the owner pastes onto their own site (the "HTML format" export). Pure/string-only:
// the controller loads the content + inlines image bytes, this composes the markup.
//
// Structure matches the real CookieYes export (Start/End markers, cookie-policy-h1 /
// cookie-policy-date-container / cookie-policy-p classes, &nbsp; separators) adapted to
// Pulse's three editor-authored sections, and mirrors frontend/src/PolicyDocument.jsx
// (same section-skip rule + footer) so the export equals the on-screen preview.

// Section order — mirrors utils/cookiePolicy.js SECTIONS (kept local so this stays a
// dependency-free pure renderer, like PolicyDocument's own SECTION_KEYS).
const SECTION_KEYS = ['aboutCookies', 'useOfCookies', 'cookiePreferences']

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

// Only ship a light img guard; the embed inherits the host site's typography (as
// CookieYes does) rather than carrying a foreign theme.
const POLICY_STYLES = '.cookie-policy-p img{max-width:100%;height:auto}'

// "Month DD, YYYY" (e.g. July 10, 2026) — identical to frontend dateUtils.formatLong.
// Timezone-safe: parse Y/M/D from the ISO string, never new Date('YYYY-MM-DD').
export function formatLongDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '')
  if (!m) return ''
  return `${MONTHS[+m[2] - 1]} ${m[3]}, ${m[1]}`
}

// UTC "today" — consistent with the other controllers' new Date().toISOString().slice.
export function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

// A section is empty (skipped) when it has no heading AND no visible text — same rule
// as PolicyDocument's hasText.
const hasText = (html) =>
  (html || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .trim().length > 0

// Escape text-context values (headings, url). Descriptions are the owner's own Tiptap
// HTML and are intentionally left as-is (same trust boundary as the app's editor).
// Exported so the teammate email can render the snippet as visible (non-executing) code.
export const escapeHtml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Compose the snippet. `imagesById` maps a lowercased image uuid → its data: URI; any
// /pulse/images/<id> reference with a known id is inlined, unknown ones are left as-is
// (a single broken <img> beats failing the whole export).
export function renderPolicyHtml({
  content = {},
  url = '',
  imagesById = {},
  lastUpdated = '',
} = {}) {
  const effective = formatLongDate(content.effectiveDate || todayISO())
  // "Last updated" = when the policy was last edited/generated (cookie_policy.updatedAt),
  // NOT render time — so copying/sending the HTML doesn't change it. Fallback to today.
  const updated = formatLongDate(lastUpdated || todayISO())

  const parts = [
    '<!-- Start Pulse cookie policy -->',
    `<style>${POLICY_STYLES}</style>`,
    '<h1 class="cookie-policy-h1">Cookie Policy</h1>',
    `<div class="cookie-policy-date-container"><p>Effective date: ${effective}</p><p>Last updated: ${updated}</p></div>`,
  ]

  for (const key of SECTION_KEYS) {
    const sec = content[key] || {}
    const heading = (sec.heading || '').trim()
    const description = sec.description || ''
    if (!heading && !hasText(description)) continue
    parts.push('&nbsp;')
    if (heading) parts.push(`<h2>${escapeHtml(heading)}</h2>`)
    parts.push(`<div class="cookie-policy-p">${description}</div>`)
  }

  // Footer — parity with PolicyDocument ("Cookie Policy generated for <url>").
  parts.push('&nbsp;')
  parts.push(
    `<p class="cookie-policy-p">Cookie Policy generated for <span>${escapeHtml(url || 'this website')}</span></p>`,
  )
  parts.push('<!-- End Pulse cookie policy -->')

  const re = new RegExp(`/pulse/images/(${UUID_RE.source})`, 'gi')
  return parts
    .join('\n')
    .replace(re, (m, id) => imagesById[id.toLowerCase()] || m)
}
