/**
 * Daily cap on paid image generations, so a shared link can't run up the bill.
 * RENDER_DAILY_LIMIT (default 40). Counted in memory: it resets when the server restarts.
 */
const LIMIT = Number(process.env.RENDER_DAILY_LIMIT ?? 40)
let day = ''
let count = 0

export function takeRenderSlot(): boolean {
  const today = new Date().toISOString().slice(0, 10)
  if (today !== day) {
    day = today
    count = 0
  }
  if (count >= LIMIT) return false
  count += 1
  return true
}

export const RENDER_LIMIT_MESSAGE = 'Limite de rendus atteinte pour aujourd’hui. Réessayez demain.'
