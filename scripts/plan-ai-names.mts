// The architect's plan, AI step (11 Nov): Gemini looks at the furnished top view with a number on each room and names the
// rooms (Chambre, Salle de bain, Cuisine, Séjour, WC, Dressing, Entrée, Dégagement…). The geometry and the areas stay
// the plan's own; only the names come from the AI. Gemini's own key (GEMINI_API_KEY), not the image gateway.
// npx tsx --env-file=.env.local scripts/plan-ai-names.mts <out prefix>   (reads <out>-ids.jpg and <out>-rooms.json, writes <out>-names.json)
import { readFile, writeFile } from 'node:fs/promises'
import { GoogleGenerativeAI } from '@google/generative-ai'

const out = process.argv[2]
const rooms = JSON.parse(await readFile(`${out}-rooms.json`, 'utf8')).rooms as { id: number; name: string; area: number; dims: number[] }[]
const image = await readFile(`${out}-ids.jpg`)
const key = process.env.GEMINI_API_KEY?.trim()
if (!key) throw new Error('GEMINI_API_KEY missing')
const list = [...rooms].sort((a, b) => b.area - a.area).map(r => `${r.id}: ${r.area} m², ${r.dims[0]} x ${r.dims[1]} m, first guess "${r.name}"`).join('\n')
const prompt = `This is the top view of a furnished apartment (an architect's plan, seen from above, walls in dark grey). Each room has a red circle with a number.
Name every numbered room in French, the way an architect labels a plan: Séjour, Salle à manger, Cuisine, Chambre, Chambre parentale, Salle de bain, Salle d'eau, WC, Dressing, Entrée, Dégagement, Buanderie, Bureau, Rangement, Balcon, Terrasse, Loggia.
The largest room is almost always the living room: "Séjour", or "Séjour / Cuisine" when the kitchen units (worktop, hob, sink run, island) stand in it. A room under 5 m² is never the Cuisine or the Séjour.
One open space holding a sofa area, a dining table and kitchen units is "Séjour / Cuisine"; with a sofa and a dining table but no kitchen it is "Séjour". A small room with only a toilet is a WC; with a shower and no bathtub, a Salle d'eau. A small bare nook outside the walls, by a window, is a Balcon or a Loggia.
Judge from the furniture you see (beds, sofas, dining table, kitchen units, bathtub, shower, toilet, wardrobes) and from the size. A narrow space with no furniture that joins rooms is a Dégagement; the one by the front door is the Entrée.
Rooms (id: area, size, first guess from object names):
${list}
Answer with JSON only: {"<id>": "<name>", ...} for every id.`
const genAI = new GoogleGenerativeAI(key)
let names: Record<string, string> | null = null
// 11 Nov: 2.5-flash answers 503 when busy and 2.0-flash is retired: a few tries, then the current model
for (const model of ['gemini-2.5-flash', 'gemini-2.5-flash', 'gemini-3.8-flash', 'gemini-2.5-flash', 'gemini-3.8-flash']) {
  try {
    const res = await genAI.getGenerativeModel({ model, generationConfig: { responseMimeType: 'application/json', temperature: 0 } }).generateContent([
      { inlineData: { data: image.toString('base64'), mimeType: 'image/jpeg' } },
      prompt,
    ])
    names = JSON.parse(res.response.text())
    console.log('PLAN_AI_NAMES', model, JSON.stringify(names))
    break
  } catch (err) {
    console.error('plan ai names', model, (err as Error).message.slice(0, 160))
    await new Promise(r => setTimeout(r, 4000))
  }
}
if (!names) process.exit(1)
await writeFile(`${out}-names.json`, JSON.stringify(names, null, 1))
