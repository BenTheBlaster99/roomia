/**
 * Shared access code for testers. When ACCESS_CODE is set, Studio and the upload and render APIs
 * require a cookie that proves the code was entered; when it is unset (local dev) nothing is gated.
 */
export const ACCESS_COOKIE = 'roomia_access'

/** Value stored in the cookie: a hash of the code, so the code itself never sits in the browser. */
export async function accessToken(code: string): Promise<string> {
  const data = new TextEncoder().encode(`roomia-access:${code}`)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}
