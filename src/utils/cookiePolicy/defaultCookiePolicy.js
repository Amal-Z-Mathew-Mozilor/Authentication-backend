// Default cookie-policy content seeded into a new website's cookie_policy row at creation
// (see createWebsite). Section keys match utils/cookiePolicy.js SECTIONS. Descriptions are
// Tiptap HTML; the effective date is supplied by the caller (server "today").

export const DEFAULT_COOKIE_SECTIONS = {
  aboutCookies: {
    heading: 'What are cookies?',
    description:
      '<p>This Cookie Policy explains what cookies are, how we use them, the types of cookies we use (i.e., the information we collect using cookies and how that information is used), and how to manage your cookie settings.</p>' +
      '<p>Cookies are small text files used to store small pieces of information. They are stored on your device when a website loads in your browser. These cookies help ensure that the website functions properly, enhance security, provide a better user experience, and analyse performance to identify what works and where improvements are needed.</p>',
  },
  useOfCookies: {
    heading: 'How do we use cookies?',
    description:
      '<p>Like most online services, our website uses both first-party and third-party cookies for various purposes. First-party cookies are primarily necessary for the website to function properly and do not collect any personally identifiable data.</p>' +
      '<p>The third-party cookies used on our website primarily help us understand how the website performs, track how you interact with it, keep our services secure, deliver relevant advertisements, and enhance your overall user experience while improving the speed of your future interactions with our website.</p>',
  },
  cookiePreferences: {
    heading: 'Manage cookie preferences',
    description:
      "<p>You can modify your cookie settings anytime by clicking the 'Consent Preferences' button above. This will allow you to revisit the cookie consent banner and update your preferences or withdraw your consent immediately.</p>" +
      '<p>Additionally, different browsers offer various methods to block and delete cookies used by websites. You can adjust your browser settings to block or delete cookies. Below are links to support documents on how to manage and delete cookies in major web browsers.</p>' +
      '<p>Chrome: <a href="https://support.google.com/accounts/answer/32050">https://support.google.com/accounts/answer/32050</a></p>' +
      '<p>Safari: <a href="https://support.apple.com/en-in/guide/safari/sfri11471/mac">https://support.apple.com/en-in/guide/safari/sfri11471/mac</a></p>' +
      '<p>Firefox: <a href="https://support.mozilla.org/en-US/kb/clear-cookies-and-site-data-firefox?redirectslug=delete-cookies-remove-info-websites-stored&amp;redirectlocale=en-US">https://support.mozilla.org/en-US/kb/clear-cookies-and-site-data-firefox?redirectslug=delete-cookies-remove-info-websites-stored&amp;redirectlocale=en-US</a></p>' +
      '<p>Internet Explorer: <a href="https://support.microsoft.com/en-us/topic/how-to-delete-cookie-files-in-internet-explorer-bca9446f-d873-78de-77ba-d42645fa52fc">https://support.microsoft.com/en-us/topic/how-to-delete-cookie-files-in-internet-explorer-bca9446f-d873-78de-77ba-d42645fa52fc</a></p>' +
      '<p>If you are using a different web browser, please refer to its official support documentation.</p>',
  },
}

/**
 * Build the full default policy seed: the three default sections plus the effective date.
 * @param {string} effectiveDate - Policy effective date (ISO YYYY-MM-DD, server "today").
 * @returns {object} Seed content { ...DEFAULT_COOKIE_SECTIONS, effectiveDate }.
 */
export function defaultCookieContent(effectiveDate) {
  return { ...DEFAULT_COOKIE_SECTIONS, effectiveDate }
}
