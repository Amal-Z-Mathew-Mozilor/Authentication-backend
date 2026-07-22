// Builders for the mail events emitted to the Go mailing service. Each returns a
// { type, to, data } payload; the Go service routes `type` → template and renders
// with `data` (all string values). Escaping happens in the Go html/template, so
// these builders carry raw values only.

/**
 * Build the account email-verification event.
 * @param {string} to - Recipient email address.
 * @param {string} verificationUrl - The verify link the email button points to.
 * @param {string} [name] - Greeting name (defaults to 'there').
 * @returns {{ type: string, to: string, data: { name: string, verificationUrl: string } }}
 */
export const buildVerificationEvent = (
  to,
  verificationUrl,
  name = 'there',
) => ({
  type: 'email_verification',
  to,
  data: { name, verificationUrl },
})

/**
 * Build the password-reset verification event.
 * @param {string} to - Recipient email address.
 * @param {string} verificationUrl - The reset-verify link the email button points to.
 * @param {string} [name] - Greeting name (defaults to 'there').
 * @returns {{ type: string, to: string, data: { name: string, verificationUrl: string } }}
 */
export const buildPasswordResetEvent = (
  to,
  verificationUrl,
  name = 'there',
) => ({
  type: 'password_reset',
  to,
  data: { name, verificationUrl },
})

/**
 * Build the "add the cookie policy as HTML" install event.
 * @param {string} to - Teammate's email address.
 * @param {string} url - The teammate's website URL.
 * @param {string} snippetHtml - The policy HTML snippet (rendered as escaped text by the Go template).
 * @returns {{ type: string, to: string, data: { url: string, snippetHtml: string } }}
 */
export const buildPolicyInstallEvent = (to, url, snippetHtml) => ({
  type: 'policy_install',
  to,
  data: { url: url || '', snippetHtml },
})

/**
 * Build the "add the cookie policy as a script" install event.
 * @param {string} to - Teammate's email address.
 * @param {string} url - The teammate's website URL.
 * @param {string} scriptTag - The <script> embed tag (rendered as escaped text by the Go template).
 * @returns {{ type: string, to: string, data: { url: string, scriptTag: string } }}
 */
export const buildPolicyScriptEvent = (to, url, scriptTag) => ({
  type: 'policy_script',
  to,
  data: { url: url || '', scriptTag },
})
