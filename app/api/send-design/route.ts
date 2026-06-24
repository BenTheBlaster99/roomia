import { Resend } from 'resend'
import { NextRequest } from 'next/server'

const resend = new Resend(process.env.RESEND_API_KEY)

interface FurnitureRow {
  name: string
  category: string
  price: number
}

interface Body {
  email: string
  styleName: string
  room: string
  budget: string
  width: string
  length: string
  height: string
  furniture: FurnitureRow[]
  total: number
  resultUrl: string
}

export async function POST(req: NextRequest) {
  try {
    const body: Body = await req.json()
    const { email, styleName, room, budget, width, length, height, furniture, total, resultUrl } = body

    await resend.emails.send({
      from: 'Roomia <onboarding@resend.dev>',
      to: email,
      subject: `Your ${styleName} ${room} Design — Roomia`,
      html: buildEmail({ styleName, room, budget, width, length, height, furniture, total, resultUrl }),
    })

    return Response.json({ success: true })
  } catch (err) {
    console.error('Email error:', err)
    return Response.json({ success: false, error: 'Failed to send email' }, { status: 500 })
  }
}

function buildEmail({
  styleName, room, budget, width, length, height, furniture, total, resultUrl,
}: Omit<Body, 'email'>) {
  const area = (parseFloat(width) * parseFloat(length)).toFixed(1)
  const budgetLabel = { tight: 'Tight', comfortable: 'Comfortable', premium: 'Premium' }[budget] ?? budget

  const furnitureRows = furniture.map(item => `
    <tr>
      <td style="padding:10px 16px;border-bottom:1px solid #2a2a2a;color:#e0ddd8;font-size:14px;">
        ${item.name}
      </td>
      <td style="padding:10px 16px;border-bottom:1px solid #2a2a2a;color:#8a8480;font-size:13px;">
        ${item.category}
      </td>
      <td style="padding:10px 16px;border-bottom:1px solid #2a2a2a;color:#c9a84c;font-size:14px;
                 font-weight:600;text-align:right;">
        ${item.price.toLocaleString()} DZD
      </td>
    </tr>
  `).join('')

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f0f0f;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f0f;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0"
             style="max-width:600px;width:100%;background:#1a1a1a;border-radius:16px;
                    overflow:hidden;border:1px solid #2a2a2a;">

        <tr>
          <td style="background:#c9a84c;padding:4px 0;"></td>
        </tr>
        <tr>
          <td style="padding:32px 32px 24px;border-bottom:1px solid #2a2a2a;">
            <div style="font-size:22px;font-weight:700;color:#c9a84c;letter-spacing:-0.5px;">
              roomia
            </div>
            <div style="font-size:13px;color:#8a8480;margin-top:4px;">
              Your interior design is ready
            </div>
          </td>
        </tr>

        <tr>
          <td style="padding:28px 32px;border-bottom:1px solid #2a2a2a;">
            <div style="font-size:20px;font-weight:700;color:#f0ede8;margin-bottom:8px;">
              ${styleName} · ${room}
            </div>
            <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px;">
              ${[room, `${width}m × ${length}m × ${height}m · ${area}m²`, budgetLabel + ' budget'].map(tag => `
                <span style="background:#252525;color:#8a8480;padding:4px 12px;
                             border-radius:20px;font-size:12px;display:inline-block;
                             margin:2px 4px 2px 0;">
                  ${tag}
                </span>
              `).join('')}
            </div>
          </td>
        </tr>

        <tr>
          <td style="padding:0;">
            <div style="padding:20px 32px 12px;font-size:11px;font-weight:600;
                        color:#8a8480;text-transform:uppercase;letter-spacing:1px;">
              Your Furniture (${furniture.length} pieces)
            </div>
            <table width="100%" cellpadding="0" cellspacing="0">
              ${furnitureRows}
            </table>
          </td>
        </tr>

        <tr>
          <td style="padding:20px 32px;border-top:1px solid #2a2a2a;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="color:#f0ede8;font-size:15px;font-weight:600;">Estimated Total</td>
                <td style="text-align:right;font-size:22px;font-weight:700;color:#c9a84c;">
                  ${total.toLocaleString()} DZD
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <tr>
          <td style="padding:24px 32px 32px;border-top:1px solid #2a2a2a;">
            <a href="${resultUrl}"
               style="display:block;background:#c9a84c;color:#0f0f0f;text-align:center;
                      padding:14px;border-radius:10px;font-weight:700;font-size:14px;
                      text-decoration:none;margin-bottom:12px;">
              View My Full Design →
            </a>
            <a href="mailto:contact@roomia.dz"
               style="display:block;border:1px solid #2a2a2a;color:#8a8480;text-align:center;
                      padding:13px;border-radius:10px;font-size:13px;text-decoration:none;">
              Book a free consultation with our designer
            </a>
          </td>
        </tr>

        <tr>
          <td style="padding:20px 32px;border-top:1px solid #1e1e1e;
                     font-size:11px;color:#444;text-align:center;">
            © 2025 Roomia · Algeria · Prices are estimates and may vary
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`
}
