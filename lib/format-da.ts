export function formatDA(price: number | null | undefined): string {
  const n = Number(price)
  if (!Number.isFinite(n) || n <= 0) return 'Prix sur demande'
  return `${Math.round(n).toLocaleString('fr-DZ')} DA`
}
