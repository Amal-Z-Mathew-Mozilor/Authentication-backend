import Mailgen from 'mailgen'
import nodemailer from 'nodemailer'
import 'dotenv/config'
import { escapeHtml } from './policyHtml.js'

// Environment configuration — all process.env reads live here at the top of the file.
const MAIL_HOST = process.env.MAIL_HOST
const MAIL_PORT = process.env.MAIL_PORT
const MAIL_USER = process.env.MAIL_USER
const MAIL_PASSWORD = process.env.MAIL_PASSWORD
/**
 * Build the Mailgen email body for the account email-verification message.
 * @param {string} username - Recipient name shown in the greeting.
 * @param {string} verificationurl - Link the verify button points to.
 * @returns {object} A Mailgen emailContent object ({ body: {…} }).
 */
const emailVerification = (username, verificationurl) => {
  return {
    body: {
      name: username,
      intro: "Welcome to Pulse! We're very excited to have you on board.",
      action: {
        instructions: 'To get started with Us, please verify your email:',
        button: {
          color: '#22BC66',
          text: 'Verify',
          link: verificationurl,
        },
      },
      outro:
        "Need help, or have questions? Just reply to this email, we'd love to help.",
    },
  }
}
/**
 * Build the Mailgen email body for the password-reset verification message.
 * @param {string} username - Recipient name shown in the greeting.
 * @param {string} verificationurl - Link the verify button points to.
 * @returns {object} A Mailgen emailContent object ({ body: {…} }).
 */
const passwordResetVerification = (username, verificationurl) => {
  return {
    body: {
      name: username,
      intro: 'To reset Your Password Verify your email first',
      action: {
        instructions: 'Click the button to verify your mail:',
        button: {
          color: '#22BC66',
          text: 'Verify',
          link: verificationurl,
        },
      },
      outro:
        "Need help, or have questions? Just reply to this email, we'd love to help.",
    },
  }
}
// "Send code to a teammate" email — a Pulse-branded, self-contained HTML layout that
// hosts the policy install snippet in a code box. Mailgen's themed action-button body
// can't express an embedded code block, so this is a hand-built template (sendEmail
// sends it via the raw-html path below). The snippet is HTML-escaped so it renders as
// visible text and never executes in the recipient's mail client.
/**
 * Build a self-contained "add the cookie policy" email that embeds the install snippet as escaped code.
 * @param {string} url - The teammate's website URL (shown in subject/body; falls back to "your website").
 * @param {string} snippetHtml - The policy HTML snippet, HTML-escaped so it renders as visible text.
 * @returns {{ subject: string, html: string, text: string }} Ready-to-send raw email payload.
 */
const policyInstallEmail = (url, snippetHtml) => {
  const safeUrl = escapeHtml(url || 'your website')
  const subject = `Add the cookie policy to ${url || 'your website'}`
  const html = `<div style="max-width:640px;margin:0 auto;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#1f2733;line-height:1.6">
  <div style="text-align:center;padding:24px 0"><span style="font-size:24px;font-weight:800;color:#3b6ef0">Pulse</span></div>
  <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:28px 30px">
    <h1 style="margin:0 0 20px;font-size:22px;line-height:1.35;color:#1f2733">Add a cookie policy on your website ${safeUrl}</h1>
    <p style="margin:0 0 14px">Hi there,</p>
    <p style="margin:0 0 22px">Your teammate has generated a cookie policy using Pulse and needs your help to add it to the site <a href="${safeUrl}" style="color:#3b6ef0">${safeUrl}</a>.</p>
    <h2 style="margin:0 0 8px;font-size:17px;color:#1f2733">Add as HTML</h2>
    <p style="margin:0 0 8px">You'll need to manually update this code on your site whenever the cookie policy is edited in Pulse.</p>
    <ol style="margin:0 0 18px;padding-left:20px">
      <li>Copy the HTML snippet provided below.</li>
      <li>Paste it into the relevant section of your website where you want the policy to appear.</li>
    </ol>
    <pre style="margin:0 0 22px;padding:14px 16px;max-height:320px;overflow:auto;background:#f4f6f8;border:1px solid #e5e7eb;border-radius:9px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px;line-height:1.5;color:#1f2733;white-space:pre-wrap;word-break:break-word">${escapeHtml(snippetHtml)}</pre>
    <h2 style="margin:0 0 8px;font-size:17px;color:#1f2733">Need help?</h2>
    <p style="margin:0">If you face any issues, feel free to <a href="http://localhost:5173/" style="color:#3b6ef0">contact us</a> and we'll help you.</p>
  </div>
</div>`
  const text = `Add a cookie policy on your website ${url || 'your website'}

Hi there,

Your teammate has generated a cookie policy using Pulse and needs your help to add it to the site ${url || 'your website'}.

Add as HTML
You'll need to manually update this code on your site whenever the cookie policy is edited in Pulse.
1. Copy the HTML snippet provided below.
2. Paste it into the relevant section of your website where you want the policy to appear.

${snippetHtml}

Need help? If you face any issues, feel free to contact us and we'll help you.`
  return { subject, html, text }
}

/**
 * Send an email via nodemailer, either as a raw html/text payload or a themed Mailgen body.
 * Transport errors are caught and logged, never thrown (a mail outage must not fail the request).
 * @param {object} options - Email options.
 * @param {string} options.email - Recipient address.
 * @param {string} options.subject - Email subject line.
 * @param {string} [options.html] - Raw HTML body; when present, text/html are sent as-is.
 * @param {string} [options.text] - Raw plaintext body (used with options.html).
 * @param {object} [options.emailContent] - Mailgen content, themed when no raw html is given.
 * @returns {Promise<void>}
 */
const sendEmail = async function (options) {
  // Two paths: a raw html/text payload (e.g. policyInstallEmail) is sent as-is; otherwise
  // a Mailgen `emailContent` body is themed (the verification/reset emails).
  let htmlEmail = options.html
  let textEmail = options.text
  if (!htmlEmail) {
    const mailGenerator = new Mailgen({
      theme: 'default',
      product: {
        name: 'Pulse',
        link: 'http://localhost:5173/',
      },
    })
    textEmail = mailGenerator.generatePlaintext(options.emailContent)
    htmlEmail = mailGenerator.generate(options.emailContent)
  }

  const transport = nodemailer.createTransport({
    host: MAIL_HOST,
    port: MAIL_PORT,
    auth: {
      user: MAIL_USER,
      pass: MAIL_PASSWORD,
    },
  })
  const mail = {
    from: 'mail.pulse@example.com',
    to: options.email,
    subject: options.subject,
    text: textEmail,
    html: htmlEmail,
  }
  try {
    await transport.sendMail(mail)
  } catch (err) {
    console.log(err)
  }
}
export {
  emailVerification,
  passwordResetVerification,
  policyInstallEmail,
  sendEmail,
}
