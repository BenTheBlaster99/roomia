import path from 'node:path'
import type { NextRequest } from 'next/server'
import { userFromToken, type User } from './auth'
import { DB_PATH } from './db'

/**
 * Roomia's server for Roomia Desktop: the Studio PC (studio.room-ia.com) answers the desktop apps' sign-ins and paid
 * photos, with the accounts and the credit ledger it already keeps (lib/credits.ts). On with ROOMIA_DESKTOP_CLOUD=1,
 * independent of ROOMIA_ACCOUNTS, so the web Studio keeps working as it is. The AI key never leaves this PC: a desktop
 * app sends its Blender capture here and gets the photo back.
 */
export const desktopCloudEnabled = () => process.env.ROOMIA_DESKTOP_CLOUD === '1' && !process.env.ROOMIA_CLOUD_URL

/** A desktop device stays signed in for 180 days (a web session: 30). */
export const DEVICE_SESSION_DAYS = 180

/** The account behind a desktop app's "Authorization: Bearer <token>", or null. */
export function bearerUser(req: NextRequest): User | null {
  if (!desktopCloudEnabled()) return null
  const header = req.headers.get('authorization') ?? ''
  const token = /^Bearer ([0-9a-f]{64})$/.exec(header)?.[1]
  try {
    return token ? userFromToken(token) : null
  } catch (err) {
    console.error('desktop session check failed:', err instanceof Error ? err.message : err)
    return null
  }
}

export const bearerToken = (req: NextRequest) => /^Bearer ([0-9a-f]{64})$/.exec(req.headers.get('authorization') ?? '')?.[1] ?? null

/**
 * Every photo a desktop account paid for, kept on Roomia's server by account (the start of the account's space:
 * what was delivered stays reachable whatever happens to the architect's PC).
 */
export const DESKTOP_PHOTOS_DIR = path.join(path.dirname(DB_PATH), 'desktop-photos')
export const desktopPhotoPath = (userId: number, jobId: string) => path.join(DESKTOP_PHOTOS_DIR, String(userId), `${jobId}.jpg`)

export const notSignedIn = () => Response.json({ detail: 'Connectez-vous à votre compte Roomia.' }, { status: 401 })
export const cloudOff = () => Response.json({ detail: 'Service Roomia Desktop indisponible.' }, { status: 404 })
