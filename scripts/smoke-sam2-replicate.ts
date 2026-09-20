import { readFileSync } from 'node:fs'

function loadLocalEnv() {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    if (!line || line.startsWith('#')) continue
    const i = line.indexOf('=')
    if (i < 0) continue
    const key = line.slice(0, i)
    let value = line.slice(i + 1)
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (!process.env[key]) process.env[key] = value
  }
}

loadLocalEnv()

async function main() {
  const imgRes = await fetch(
    'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?auto=format&fit=crop&w=768&q=80',
  )
  if (!imgRes.ok) throw new Error(`download failed ${imgRes.status}`)
  const imageBase64 = Buffer.from(await imgRes.arrayBuffer()).toString('base64')

  const { segmentClicksWithReplicate } = await import('../lib/sam2-replicate')
  const started = Date.now()
  const masks = await segmentClicksWithReplicate(imageBase64, [{ x: 0.5, y: 0.55 }])
  const png = Buffer.from(masks[0], 'base64')
  const isPng = png[0] === 0x89 && png[1] === 0x50
  console.log(
    'ROOMIA_SAM2_OK',
    'masks',
    masks.length,
    'png',
    isPng,
    'bytes',
    png.length,
    'sec',
    ((Date.now() - started) / 1000).toFixed(1),
  )
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
