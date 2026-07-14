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
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

// Only ship a light img guard; the embed inherits the host site's typography (as
// CookieYes does) rather than carrying a foreign theme.
const POLICY_STYLES = '.cookie-policy-p img{max-width:100%;height:auto}'

/**
 * Format an ISO date string as "Month DD, YYYY" (timezone-safe, parsed from the string).
 * @param {string} iso - Date in ISO YYYY-MM-DD form.
 * @returns {string} e.g. "July 10, 2026", or "" when the input isn't a valid ISO date.
 */
export function formatLongDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '')
  if (!m) return ''
  return `${MONTHS[+m[2] - 1]} ${m[3]}, ${m[1]}`
}

/**
 * Today's UTC date as an ISO YYYY-MM-DD string.
 * @returns {string}
 */
export function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Report whether HTML has visible text once tags and &nbsp; are stripped (section-skip rule).
 * @param {string} html - HTML fragment to test.
 * @returns {boolean} True when any visible text remains.
 */
const hasText = (html) =>
  (html || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .trim().length > 0

/**
 * Escape &, < and > in a text value so it renders as visible, non-executing HTML.
 * @param {*} s - Value to escape (coerced to string).
 * @returns {string} The escaped string.
 */
export const escapeHtml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * Render a website's saved cookie-policy content as a self-contained HTML export snippet.
 * Skips empty sections and inlines known /pulse/images/<id> references from imagesById; unknown references are left unchanged.
 * @param {object} [options] - Render options.
 * @param {object} [options.content={}] - Saved policy content (sections + effectiveDate).
 * @param {string} [options.url=''] - Website URL shown in the footer.
 * @param {Object<string,string>} [options.imagesById={}] - Lowercased image id → data: URI.
 * @param {string} [options.lastUpdated=''] - ISO date the policy was last edited (for "Last updated"), not render time so re-sending never changes it; falls back to today when empty.
 * @returns {string} The composed HTML snippet with images inlined where known.
 */
export function renderPolicyHtml({
  content = {},
  url = '',
  imagesById = {},
  lastUpdated = '',
} = {}) {
  const effective = formatLongDate(content.effectiveDate || todayISO())
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
