/** Name of the Studio sign-in cookie. Kept apart so the edge middleware can read it without the database. */
export const SESSION_COOKIE = 'roomia_session'

/** On the Studio PC (set in its .env.local): the website's own paid routes are switched off behind the tunnel. */
export const studioOnly = () => process.env.ROOMIA_STUDIO_ONLY === '1'

/**
 * Accounts and render credits (sign-in, credits per photo, admin page). Off by default: the Studio
 * is open, as before, for demos and the expo. ROOMIA_ACCOUNTS=1 (with a restart) turns them on.
 */
export const accountsEnabled = () => process.env.ROOMIA_ACCOUNTS === '1'

/**
 * The admin page (accounts, credits, forfaits): with accounts on, or on the Studio PC that serves Roomia Desktop
 * (ROOMIA_DESKTOP_CLOUD=1, never inside the desktop app itself). There the Studio stays open on this PC and only the admin
 * page asks for an admin sign-in; from outside (studio.room-ia.com) it doesn't exist (proxy.ts).
 */
export const adminAreaEnabled = () => accountsEnabled() || (process.env.ROOMIA_DESKTOP_CLOUD === '1' && !process.env.ROOMIA_CLOUD_URL)
