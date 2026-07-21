// Barrel + client for the Go script-generator microservice.
// import { … } from '../utils/scriptGenerator/index.js'.
import 'dotenv/config'

// Environment configuration — all process.env reads live here at the top of the file.
// SCRIPT_SERVICE_URL   — internal origin the backend POSTs the policy config to.
// SCRIPT_SERVICE_PUBLIC_URL — public origin baked into the <script src> a user embeds
//                            (falls back to the internal URL for local/dev).
const SCRIPT_SERVICE_URL =
  process.env.SCRIPT_SERVICE_URL || 'http://localhost:8080'
const SCRIPT_SERVICE_PUBLIC_URL =
  process.env.SCRIPT_SERVICE_PUBLIC_URL || SCRIPT_SERVICE_URL

/**
 * POST the policy config to the script-generator service, which renders the markup,
 * wraps it into an embeddable .js and stores/replaces it in S3 (keyed by config.id).
 * @param {object} config - The policy config.
 * @param {string} config.id - Site id (= websiteId); the S3 key + embed-url id.
 * @param {string} config.url - Website URL shown in the policy footer.
 * @param {string} config.lastUpdated - ISO YYYY-MM-DD "Last updated" date.
 * @param {object} config.content - Saved policy content (sections + effectiveDate).
 * @returns {Promise<void>}
 * @throws {Error} When the service responds with a non-2xx status.
 */
export async function postScript(config) {
  const res = await fetch(`${SCRIPT_SERVICE_URL}/scripts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  })
  if (!res.ok) {
    throw new Error(`script-generator responded ${res.status}`)
  }
}

/**
 * Build the <script> embed tag the user pastes into their site <head>. The websiteId
 * is baked into the src, so at runtime the browser requests it back as GET /scripts/:id.js.
 * @param {string} id - Site id (= websiteId).
 * @returns {string} The full embed snippet with Start/End markers.
 */
export function buildEmbedTag(id) {
  const src = `${SCRIPT_SERVICE_PUBLIC_URL}/scripts/${id}.js`
  return `<!-- Start Pulse cookie policy -->
<script id="pulse-cookie-policy" type="text/javascript" src="${src}"></script>
<!-- End Pulse cookie policy -->`
}
