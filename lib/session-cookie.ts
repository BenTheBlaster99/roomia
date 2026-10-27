/** Name of the Studio sign-in cookie. Kept apart so the edge middleware can read it without the database. */
export const SESSION_COOKIE = 'roomia_session'

/** On the Studio PC (set in its .env.local): the website's own paid routes are switched off behind the tunnel. */
export const studioOnly = () => process.env.ROOMIA_STUDIO_ONLY === '1'

/**
 * Accounts and render credits (sign-in, credits per photo, admin page). Off by default: the Studio
 * is open, as before, for demos and the expo. ROOMIA_ACCOUNTS=1 (with a restart) turns them on.
 */
export const accountsEnabled = () => process.env.ROOMIA_ACCOUNTS === '1'
