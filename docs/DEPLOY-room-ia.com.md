# Deploy Roomia to room-ia.com (Hostinger + Vercel)

## What gets deployed where

| Part | Where | Notes |
|------|-------|-------|
| Next.js app (roomia) | **Vercel** | room-ia.com points here |
| Supabase DB | Already hosted | No change |
| AI backend (Python :8000) | **Not on Vercel** | GPU/local for now; photo studio needs a public URL later |

---

## Step 1 — Push latest code to GitHub

Vercel deploys from GitHub repo: `BenTheBlaster99/roomia`

```bash
cd /media/jackhammer/DATA/Linux-Work/Projects/roomia
git add app/photo-studio app/page.tsx lib/mock-catalog.ts next.config.ts docs/
git commit -m "Add photo studio and prepare production deploy"
git push origin main
```

(Include only files you want live; skip `backend.txt` / `added ai.txt` if those are local notes.)

---

## Step 2 — Create Vercel project

1. Go to [vercel.com](https://vercel.com) → sign in with GitHub
2. **Add New Project** → import `BenTheBlaster99/roomia`
3. Framework: **Next.js** (auto-detected)
4. Root directory: `./`
5. Build command: `npm run build` (default)
6. Do **not** deploy yet — set env vars first

---

## Step 3 — Environment variables (Vercel → Settings → Environment Variables)

Copy from your local `.env.local`:

| Name | Production value |
|------|------------------|
| `NEXT_PUBLIC_SUPABASE_URL` | your Supabase URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | your anon key |
| `NEXT_PUBLIC_BASE_URL` | `https://room-ia.com` |
| `GEMINI_API_KEY` | your Gemini key (floor plan scan) |
| `RESEND_API_KEY` | your Resend key (email) |
| `OPENAI_API_KEY` | optional, if using OpenAI scan |
| `SCAN_PROVIDER` | `gemini` or `openai` |

**Photo studio (optional for launch):**

| Name | Value |
|------|-------|
| `NEXT_PUBLIC_AI_BACKEND_URL` | Leave empty or omit until AI backend has a public URL |

Without a public AI backend, `/photo-studio` will fail in production (works locally only).

Apply to: **Production**, **Preview**, **Development**.

---

## Step 4 — Deploy on Vercel

Click **Deploy**. Wait for build to finish.

You get a URL like `roomia-xxx.vercel.app`.

---

## Step 5 — Connect room-ia.com (Hostinger → Vercel)

### Option A — Recommended: Vercel nameservers

1. Vercel project → **Settings → Domains**
2. Add: `room-ia.com` and `www.room-ia.com`
3. Vercel shows **nameservers** (e.g. `ns1.vercel-dns.com`)
4. Hostinger → **Domains → room-ia.com → DNS / Nameservers**
5. Change to **Custom nameservers** → paste Vercel’s two nameservers
6. Save. Propagation: 15 min – 48 hours

### Option B — Keep Hostinger DNS

In Hostinger DNS zone:

| Type | Name | Value |
|------|------|-------|
| A | `@` | `76.76.21.21` (Vercel A record — confirm in Vercel domain settings) |
| CNAME | `www` | `cname.vercel-dns.com` |

Vercel domain page shows the exact records for your project.

---

## Step 6 — Verify

- `https://room-ia.com` loads
- `https://www.room-ia.com` redirects or loads (set redirect in Vercel if needed)
- `/studio`, `/marketplace`, `/rooms` work
- Supabase data loads (check browser console for RLS errors)

---

## Step 7 — After deploy (later)

1. **Sarah furniture images** → Supabase Storage → result page
2. **Real catalog** → replace MOCK_CATALOG with `furniture_items`
3. **AI backend** → Railway/Render/VPS with GPU, then set `NEXT_PUBLIC_AI_BACKEND_URL`
4. Update `roomia-ai-backend` CORS: add `https://room-ia.com` to `CORS_ORIGINS`

---

## Troubleshooting

**Build fails on Vercel** — run locally: `npm run build`

**Images broken** — add Supabase hostname to `next.config.ts` `images.remotePatterns`

**Slow local dev** — project on external drive; SSD helps

**Photo studio “failed to fetch”** — AI backend not public; expected until GPU server is deployed
