import { sb } from '/lib/supabase.js?v=20260608e'
import { toast, fmtNumber, fmtDateTime, fmtRelativeTime, htmlEscape, confirmDialog } from '/lib/ui.js?v=20260608e'
import { makeAreaChart, makeDonutChart } from '/lib/charts.js?v=20260608e'
import { exportPanelAsPdf, exportCsv } from '/lib/export.js?v=20260608e'
import { countUp, fadeIn } from '/lib/animations.js?v=20260608e'
import { drawer } from '/lib/layout-extras.js?v=20260608e'

// ─── helpers ────────────────────────────────────────────────────────────────

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = url
  })
}

function wrapText(ctx, text, maxWidth) {
  const words = String(text || '').split(/\s+/)
  const lines = []
  let current = ''
  for (const w of words) {
    const test = current ? current + ' ' + w : w
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current)
      current = w
    } else {
      current = test
    }
  }
  if (current) lines.push(current)
  return lines
}

function roundRectClip(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

function roundRect(ctx, x, y, w, h, r) {
  roundRectClip(ctx, x, y, w, h, r)
  ctx.fill()
}

// ─── brand drawing primitives ────────────────────────────────────────────────

const BRAND = {
  bg: '#0B0B0F',
  bgAlt: '#07070A',
  purple: '#8B5CF6',
  pink: '#EC4899',
  white: '#FFFFFF',
  whiteDim: 'rgba(255,255,255,0.75)',
  whiteSubtle: 'rgba(255,255,255,0.45)',
  font: '-apple-system, "SF Pro Display", "Inter", system-ui, sans-serif',
}

function fillBg(ctx, W, H) {
  const g = ctx.createLinearGradient(0, 0, W, H)
  g.addColorStop(0, '#0E0B1A')
  g.addColorStop(0.5, '#0B0B0F')
  g.addColorStop(1, '#08060E')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
}

function drawBubbles(ctx, W, H) {
  const bubbles = [
    { cx: W * 0.15, cy: H * 0.25, r: 220, opacity: 0.18 },
    { cx: W * 0.82, cy: H * 0.15, r: 180, opacity: 0.13 },
    { cx: W * 0.65, cy: H * 0.72, r: 260, opacity: 0.20 },
    { cx: W * 0.08, cy: H * 0.78, r: 140, opacity: 0.15 },
    { cx: W * 0.92, cy: H * 0.55, r: 160, opacity: 0.12 },
  ]
  for (const b of bubbles) {
    const grad = ctx.createRadialGradient(b.cx, b.cy, 0, b.cx, b.cy, b.r)
    grad.addColorStop(0, `rgba(139,92,246,${b.opacity})`)
    grad.addColorStop(0.5, `rgba(139,92,246,${b.opacity * 0.5})`)
    grad.addColorStop(1, 'rgba(139,92,246,0)')
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.arc(b.cx, b.cy, b.r, 0, Math.PI * 2)
    ctx.fill()
  }
}

function drawLogo(ctx, W) {
  ctx.save()
  ctx.font = `800 46px ${BRAND.font}`
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'
  const gL = ctx.createLinearGradient(60, 56, 200, 56)
  gL.addColorStop(0, BRAND.purple)
  gL.addColorStop(1, BRAND.pink)
  ctx.fillStyle = gL
  ctx.fillText('hozd', 60, 56)
  ctx.restore()
}

function drawFooter(ctx, W, H) {
  ctx.save()
  ctx.font = `500 22px ${BRAND.font}`
  ctx.textBaseline = 'bottom'
  ctx.textAlign = 'right'
  ctx.fillStyle = BRAND.whiteSubtle
  ctx.fillText('hozd.app', W - 60, H - 40)
  ctx.restore()
}

function pillCTA(ctx, text, cx, cy, W) {
  const pillW = Math.min(W - 120, 520)
  const pillH = 72
  const px = cx - pillW / 2
  const py = cy - pillH / 2
  const g = ctx.createLinearGradient(px, py, px + pillW, py)
  g.addColorStop(0, BRAND.purple)
  g.addColorStop(1, BRAND.pink)
  ctx.fillStyle = g
  roundRect(ctx, px, py, pillW, pillH, 36)
  ctx.font = `700 26px ${BRAND.font}`
  ctx.fillStyle = BRAND.white
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'center'
  ctx.fillText(text, cx, cy)
}

// ─── template: hero ──────────────────────────────────────────────────────────

async function renderHero(brief, W, H) {
  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')

  fillBg(ctx, W, H)
  drawBubbles(ctx, W, H)
  drawLogo(ctx, W)
  drawFooter(ctx, W, H)

  const headline = brief.headline || ''
  const subtext = brief.subtext || ''
  const cta = brief.cta || 'Jetzt entdecken → hozd.app'

  ctx.save()
  ctx.font = `800 80px ${BRAND.font}`
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'center'
  ctx.fillStyle = BRAND.white
  const headLines = wrapText(ctx, headline, W - 160)
  const lh = 96
  const blockH = headLines.length * lh
  const startY = H * 0.44 - blockH / 2
  headLines.forEach((line, i) => {
    ctx.fillText(line, W / 2, startY + i * lh + lh / 2)
  })
  ctx.restore()

  if (subtext) {
    ctx.save()
    ctx.font = `400 28px ${BRAND.font}`
    ctx.textBaseline = 'top'
    ctx.textAlign = 'center'
    ctx.fillStyle = BRAND.whiteDim
    const subLines = wrapText(ctx, subtext, W - 200)
    const subY = startY + blockH + 28
    subLines.forEach((line, i) => {
      ctx.fillText(line, W / 2, subY + i * 40)
    })
    ctx.restore()
  }

  if (brief.cover_image_url) {
    try {
      const img = await loadImage(brief.cover_image_url)
      ctx.save()
      const iW = 200, iH = 200
      const ix = W / 2 - iW / 2
      const iy = H * 0.13
      roundRectClip(ctx, ix, iy, iW, iH, 24)
      ctx.clip()
      ctx.drawImage(img, ix, iy, iW, iH)
      ctx.restore()
    } catch {}
  }

  pillCTA(ctx, cta, W / 2, H - 110, W)

  return [canvas]
}

// ─── template: comparison ────────────────────────────────────────────────────

async function renderComparison(brief, W, H) {
  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')

  fillBg(ctx, W, H)
  drawBubbles(ctx, W, H)
  drawLogo(ctx, W)
  drawFooter(ctx, W, H)

  const leftLabel = brief.left_label || brief.before_label || 'Frühere'
  const rightLabel = brief.right_label || brief.after_label || 'Heute'
  const leftItems = Array.isArray(brief.left_items) ? brief.left_items : (brief.left_text ? [brief.left_text] : ['Alt'])
  const rightItems = Array.isArray(brief.right_items) ? brief.right_items : (brief.right_text ? [brief.right_text] : ['Neu'])

  const colW = (W - 160) / 2
  const colH = H - 280
  const leftX = 60
  const rightX = W / 2 + 20
  const topY = 160

  ctx.save()
  ctx.fillStyle = 'rgba(255,255,255,0.04)'
  roundRect(ctx, leftX, topY, colW, colH, 24)
  ctx.restore()

  ctx.save()
  const rg = ctx.createLinearGradient(rightX, topY, rightX + colW, topY + colH)
  rg.addColorStop(0, 'rgba(139,92,246,0.16)')
  rg.addColorStop(1, 'rgba(236,72,153,0.10)')
  ctx.fillStyle = rg
  roundRect(ctx, rightX, topY, colW, colH, 24)
  ctx.restore()

  ctx.save()
  const dg = ctx.createLinearGradient(W / 2 - 2, topY, W / 2 - 2, topY + colH)
  dg.addColorStop(0, 'rgba(139,92,246,0)')
  dg.addColorStop(0.4, BRAND.purple)
  dg.addColorStop(0.6, BRAND.pink)
  dg.addColorStop(1, 'rgba(236,72,153,0)')
  ctx.strokeStyle = dg
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(W / 2, topY + 20)
  ctx.lineTo(W / 2, topY + colH - 20)
  ctx.stroke()
  ctx.restore()

  ctx.save()
  ctx.font = `700 26px ${BRAND.font}`
  ctx.textBaseline = 'top'
  ctx.textAlign = 'center'
  ctx.fillStyle = 'rgba(255,255,255,0.4)'
  ctx.fillText(leftLabel.toUpperCase(), leftX + colW / 2, topY + 26)
  const rg2 = ctx.createLinearGradient(rightX, 0, rightX + colW, 0)
  rg2.addColorStop(0, BRAND.purple)
  rg2.addColorStop(1, BRAND.pink)
  ctx.fillStyle = rg2
  ctx.fillText(rightLabel.toUpperCase(), rightX + colW / 2, topY + 26)
  ctx.restore()

  ctx.save()
  ctx.font = `500 30px ${BRAND.font}`
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'center'
  ctx.fillStyle = 'rgba(255,255,255,0.35)'
  leftItems.slice(0, 5).forEach((item, i) => {
    const ty = topY + 90 + i * 72
    const lines = wrapText(ctx, String(item), colW - 40)
    lines.slice(0, 2).forEach((line, li) => {
      const lineY = ty + li * 38
      ctx.fillText(line, leftX + colW / 2, lineY)
      const tw = ctx.measureText(line).width
      ctx.save()
      ctx.strokeStyle = 'rgba(239,68,68,0.6)'
      ctx.lineWidth = 2.5
      ctx.beginPath()
      ctx.moveTo(leftX + colW / 2 - tw / 2 - 4, lineY)
      ctx.lineTo(leftX + colW / 2 + tw / 2 + 4, lineY)
      ctx.stroke()
      ctx.restore()
    })
  })
  ctx.restore()

  ctx.save()
  ctx.font = `700 30px ${BRAND.font}`
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'center'
  rightItems.slice(0, 5).forEach((item, i) => {
    const ty = topY + 90 + i * 72
    const lines = wrapText(ctx, String(item), colW - 40)
    lines.slice(0, 2).forEach((line, li) => {
      const lineY = ty + li * 38
      const tw = ctx.measureText(line).width
      const g = ctx.createLinearGradient(rightX + colW / 2 - tw / 2, lineY, rightX + colW / 2 + tw / 2, lineY)
      g.addColorStop(0, BRAND.purple)
      g.addColorStop(1, BRAND.pink)
      ctx.fillStyle = g
      ctx.fillText(line, rightX + colW / 2, lineY)
    })
  })
  ctx.restore()

  const hl = brief.headline || ''
  if (hl) {
    ctx.save()
    ctx.font = `800 48px ${BRAND.font}`
    ctx.textBaseline = 'top'
    ctx.textAlign = 'center'
    ctx.fillStyle = BRAND.white
    const hlLines = wrapText(ctx, hl, W - 120)
    hlLines.slice(0, 2).forEach((line, i) => {
      ctx.fillText(line, W / 2, topY + colH + 30 + i * 58)
    })
    ctx.restore()
  }

  return [canvas]
}

// ─── template: step_grid ─────────────────────────────────────────────────────

async function renderStepGrid(brief, W, H) {
  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')

  fillBg(ctx, W, H)
  drawBubbles(ctx, W, H)
  drawLogo(ctx, W)
  drawFooter(ctx, W, H)

  const steps = Array.isArray(brief.steps) ? brief.steps : []
  const headline = brief.headline || ''
  const count = Math.min(steps.length, 4) || 3

  if (headline) {
    ctx.save()
    ctx.font = `800 64px ${BRAND.font}`
    ctx.textBaseline = 'top'
    ctx.textAlign = 'center'
    ctx.fillStyle = BRAND.white
    const hLines = wrapText(ctx, headline, W - 120)
    hLines.slice(0, 2).forEach((line, i) => {
      ctx.fillText(line, W / 2, 160 + i * 76)
    })
    ctx.restore()
  }

  const headH = headline ? (Math.min(wrapText(ctx, headline, W - 120).length, 2) * 76 + 160 + 40) : 180
  const gridTop = headH
  const gridH = H - gridTop - 120
  const cols = count <= 2 ? count : 2
  const rows = Math.ceil(count / cols)
  const cellW = (W - 120 - (cols - 1) * 24) / cols
  const cellH = (gridH - (rows - 1) * 24) / rows

  for (let i = 0; i < count; i++) {
    const step = steps[i] || {}
    const col = i % cols
    const row = Math.floor(i / cols)
    const cx = 60 + col * (cellW + 24)
    const cy = gridTop + row * (cellH + 24)

    ctx.save()
    const cg = ctx.createLinearGradient(cx, cy, cx + cellW, cy + cellH)
    cg.addColorStop(0, 'rgba(139,92,246,0.14)')
    cg.addColorStop(1, 'rgba(236,72,153,0.06)')
    ctx.fillStyle = cg
    roundRect(ctx, cx, cy, cellW, cellH, 28)
    ctx.strokeStyle = 'rgba(139,92,246,0.28)'
    ctx.lineWidth = 1.5
    roundRectClip(ctx, cx, cy, cellW, cellH, 28)
    ctx.stroke()
    ctx.restore()

    ctx.save()
    const nb = 52
    const nx = cx + 28
    const ny = cy + 28
    const ng = ctx.createLinearGradient(nx, ny, nx + nb, ny + nb)
    ng.addColorStop(0, BRAND.purple)
    ng.addColorStop(1, BRAND.pink)
    ctx.fillStyle = ng
    ctx.beginPath()
    ctx.arc(nx + nb / 2, ny + nb / 2, nb / 2, 0, Math.PI * 2)
    ctx.fill()
    ctx.font = `800 26px ${BRAND.font}`
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'center'
    ctx.fillStyle = BRAND.white
    ctx.fillText(String(i + 1), nx + nb / 2, ny + nb / 2)
    ctx.restore()

    const icon = step.icon || ''
    if (icon) {
      ctx.save()
      ctx.font = `42px serif`
      ctx.textBaseline = 'top'
      ctx.textAlign = 'left'
      ctx.fillText(icon, cx + cellW - 68, cy + 20)
      ctx.restore()
    }

    const title = step.title || step.text || step.label || `Schritt ${i + 1}`
    ctx.save()
    ctx.font = `700 30px ${BRAND.font}`
    ctx.textBaseline = 'top'
    ctx.textAlign = 'left'
    ctx.fillStyle = BRAND.white
    const titleLines = wrapText(ctx, title, cellW - 56)
    titleLines.slice(0, 2).forEach((line, li) => {
      ctx.fillText(line, cx + 28, cy + 96 + li * 38)
    })
    ctx.restore()

    const desc = step.desc || step.description || ''
    if (desc) {
      ctx.save()
      ctx.font = `400 22px ${BRAND.font}`
      ctx.textBaseline = 'top'
      ctx.textAlign = 'left'
      ctx.fillStyle = BRAND.whiteDim
      const dLines = wrapText(ctx, desc, cellW - 56)
      dLines.slice(0, 3).forEach((line, li) => {
        ctx.fillText(line, cx + 28, cy + 96 + Math.min(titleLines.length, 2) * 38 + 14 + li * 30)
      })
      ctx.restore()
    }
  }

  return [canvas]
}

// ─── template: quote ─────────────────────────────────────────────────────────

async function renderQuote(brief, W, H) {
  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')

  fillBg(ctx, W, H)
  drawBubbles(ctx, W, H)
  drawLogo(ctx, W)
  drawFooter(ctx, W, H)

  const quote = brief.quote || brief.headline || ''
  const author = brief.author || brief.name || ''
  const role = brief.role || brief.subtitle || ''
  const avatarUrl = brief.avatar_url || brief.cover_image_url || null

  ctx.save()
  ctx.font = `800 260px ${BRAND.font}`
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'
  const qg = ctx.createLinearGradient(60, 100, 260, 260)
  qg.addColorStop(0, 'rgba(139,92,246,0.25)')
  qg.addColorStop(1, 'rgba(236,72,153,0.08)')
  ctx.fillStyle = qg
  ctx.fillText('“', 48, 60)
  ctx.restore()

  ctx.save()
  ctx.font = `600 52px ${BRAND.font}`
  ctx.textBaseline = 'top'
  ctx.textAlign = 'center'
  ctx.fillStyle = BRAND.white
  const qLines = wrapText(ctx, quote, W - 160)
  const qStartY = H * 0.32
  qLines.slice(0, 5).forEach((line, i) => {
    ctx.fillText(line, W / 2, qStartY + i * 66)
  })
  ctx.restore()

  const qBlockH = Math.min(qLines.length, 5) * 66
  ctx.save()
  ctx.font = `800 180px ${BRAND.font}`
  ctx.textBaseline = 'top'
  ctx.textAlign = 'right'
  const qg2 = ctx.createLinearGradient(W - 200, qStartY + qBlockH, W - 60, qStartY + qBlockH + 160)
  qg2.addColorStop(0, 'rgba(236,72,153,0.22)')
  qg2.addColorStop(1, 'rgba(139,92,246,0.08)')
  ctx.fillStyle = qg2
  ctx.fillText('”', W - 48, qStartY + qBlockH - 20)
  ctx.restore()

  const authorY = H - 220
  if (avatarUrl) {
    try {
      const img = await loadImage(avatarUrl)
      ctx.save()
      const aR = 52
      const ax = W / 2 - (author ? 180 : aR)
      const ay = authorY
      ctx.beginPath()
      ctx.arc(ax + aR, ay + aR, aR, 0, Math.PI * 2)
      ctx.clip()
      ctx.drawImage(img, ax, ay, aR * 2, aR * 2)
      ctx.restore()
      if (author) {
        ctx.save()
        ctx.font = `700 28px ${BRAND.font}`
        ctx.textBaseline = 'top'
        ctx.textAlign = 'left'
        ctx.fillStyle = BRAND.white
        ctx.fillText(author, ax + aR * 2 + 18, authorY + 10)
        if (role) {
          ctx.font = `400 22px ${BRAND.font}`
          ctx.fillStyle = BRAND.whiteSubtle
          ctx.fillText(role, ax + aR * 2 + 18, authorY + 46)
        }
        ctx.restore()
      }
    } catch {}
  } else if (author) {
    ctx.save()
    const dg = ctx.createLinearGradient(W / 2 - 120, authorY - 20, W / 2 + 120, authorY - 20)
    dg.addColorStop(0, 'rgba(139,92,246,0)')
    dg.addColorStop(0.3, BRAND.purple)
    dg.addColorStop(0.7, BRAND.pink)
    dg.addColorStop(1, 'rgba(236,72,153,0)')
    ctx.strokeStyle = dg
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(W / 2 - 120, authorY - 20)
    ctx.lineTo(W / 2 + 120, authorY - 20)
    ctx.stroke()
    ctx.restore()
    ctx.save()
    ctx.font = `700 30px ${BRAND.font}`
    ctx.textBaseline = 'top'
    ctx.textAlign = 'center'
    ctx.fillStyle = BRAND.white
    ctx.fillText(author, W / 2, authorY)
    if (role) {
      ctx.font = `400 22px ${BRAND.font}`
      ctx.fillStyle = BRAND.whiteSubtle
      ctx.fillText(role, W / 2, authorY + 40)
    }
    ctx.restore()
  }

  return [canvas]
}

// ─── template: avatar_grid ───────────────────────────────────────────────────

async function renderAvatarGrid(brief, W, H) {
  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')

  fillBg(ctx, W, H)
  drawBubbles(ctx, W, H)
  drawLogo(ctx, W)
  drawFooter(ctx, W, H)

  const headline = brief.headline || ''
  const avatars = Array.isArray(brief.avatars) ? brief.avatars.slice(0, 6) : []
  const count = avatars.length || 4

  if (headline) {
    ctx.save()
    ctx.font = `800 66px ${BRAND.font}`
    ctx.textBaseline = 'top'
    ctx.textAlign = 'center'
    ctx.fillStyle = BRAND.white
    const hLines = wrapText(ctx, headline, W - 120)
    hLines.slice(0, 2).forEach((line, i) => ctx.fillText(line, W / 2, 140 + i * 78))
    ctx.restore()
  }

  const gridTop = headline ? 360 : 200
  const cols = count <= 3 ? count : 3
  const rows = Math.ceil(count / cols)
  const cardW = Math.floor((W - 120 - (cols - 1) * 20) / cols)
  const cardH = Math.floor((H - gridTop - 120 - (rows - 1) * 20) / rows)
  const avatarR = Math.min(cardW * 0.35, 90)

  for (let i = 0; i < count; i++) {
    const av = avatars[i] || {}
    const col = i % cols
    const row = Math.floor(i / cols)
    const cx = 60 + col * (cardW + 20)
    const cy = gridTop + row * (cardH + 20)

    ctx.save()
    ctx.fillStyle = 'rgba(139,92,246,0.10)'
    roundRect(ctx, cx, cy, cardW, cardH, 22)
    ctx.strokeStyle = 'rgba(139,92,246,0.22)'
    ctx.lineWidth = 1.5
    roundRectClip(ctx, cx, cy, cardW, cardH, 22)
    ctx.stroke()
    ctx.restore()

    const acx = cx + cardW / 2
    const acy = cy + avatarR + 24
    ctx.save()
    const ag = ctx.createLinearGradient(acx - avatarR, acy - avatarR, acx + avatarR, acy + avatarR)
    ag.addColorStop(0, BRAND.purple)
    ag.addColorStop(1, BRAND.pink)
    ctx.fillStyle = ag
    ctx.beginPath()
    ctx.arc(acx, acy, avatarR + 4, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()

    if (av.image_url) {
      try {
        const img = await loadImage(av.image_url)
        ctx.save()
        ctx.beginPath()
        ctx.arc(acx, acy, avatarR, 0, Math.PI * 2)
        ctx.clip()
        ctx.drawImage(img, acx - avatarR, acy - avatarR, avatarR * 2, avatarR * 2)
        ctx.restore()
      } catch {
        ctx.save()
        ctx.fillStyle = BRAND.bgAlt
        ctx.beginPath()
        ctx.arc(acx, acy, avatarR, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      }
    } else {
      ctx.save()
      ctx.fillStyle = BRAND.bgAlt
      ctx.beginPath()
      ctx.arc(acx, acy, avatarR, 0, Math.PI * 2)
      ctx.fill()
      ctx.font = `${avatarR * 0.8}px serif`
      ctx.textBaseline = 'middle'
      ctx.textAlign = 'center'
      ctx.fillText(av.emoji || '🎙', acx, acy)
      ctx.restore()
    }

    const name = av.name || ''
    if (name) {
      ctx.save()
      ctx.font = `700 ${Math.min(26, cardW / 6)}px ${BRAND.font}`
      ctx.textBaseline = 'top'
      ctx.textAlign = 'center'
      ctx.fillStyle = BRAND.white
      ctx.fillText(name.slice(0, 18), acx, acy + avatarR + 16)
      ctx.restore()
    }

    const badge = av.badge || ''
    if (badge) {
      ctx.save()
      const bFont = `600 ${Math.min(19, cardW / 7)}px ${BRAND.font}`
      ctx.font = bFont
      const bw = ctx.measureText(badge).width + 24
      const bh = 30
      const bx = acx - bw / 2
      const by = cy + cardH - bh - 16
      const bg2 = ctx.createLinearGradient(bx, by, bx + bw, by)
      bg2.addColorStop(0, 'rgba(139,92,246,0.35)')
      bg2.addColorStop(1, 'rgba(236,72,153,0.25)')
      ctx.fillStyle = bg2
      roundRect(ctx, bx, by, bw, bh, 15)
      ctx.strokeStyle = 'rgba(139,92,246,0.5)'
      ctx.lineWidth = 1
      roundRectClip(ctx, bx, by, bw, bh, 15)
      ctx.stroke()
      ctx.font = bFont
      ctx.fillStyle = '#C4B5FD'
      ctx.textBaseline = 'middle'
      ctx.textAlign = 'center'
      ctx.fillText(badge, acx, by + bh / 2)
      ctx.restore()
    }
  }

  return [canvas]
}

// ─── template: podium ────────────────────────────────────────────────────────

async function renderPodium(brief, W, H) {
  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')

  fillBg(ctx, W, H)
  drawBubbles(ctx, W, H)
  drawLogo(ctx, W)
  drawFooter(ctx, W, H)

  const headline = brief.headline || ''
  const entries = Array.isArray(brief.entries) ? brief.entries.slice(0, 3) : []

  if (headline) {
    ctx.save()
    ctx.font = `800 66px ${BRAND.font}`
    ctx.textBaseline = 'top'
    ctx.textAlign = 'center'
    ctx.fillStyle = BRAND.white
    const hLines = wrapText(ctx, headline, W - 120)
    hLines.slice(0, 2).forEach((line, i) => ctx.fillText(line, W / 2, 140 + i * 78))
    ctx.restore()
  }

  const baseTop = headline ? 370 : 240
  // order: 2nd left, 1st center, 3rd right
  const cardDefs = [
    { x: 60, w: 280, h: 380, rank: 2, rankColor: '#A0A0B0', entryIdx: 1 },
    { x: 60 + 280 + 20, w: 380, h: 480, rank: 1, rankColor: '#F59E0B', entryIdx: 0 },
    { x: 60 + 280 + 20 + 380 + 20, w: 280, h: 330, rank: 3, rankColor: '#CD7F32', entryIdx: 2 },
  ]

  for (const def of cardDefs) {
    const entry = entries[def.entryIdx] || {}
    const cy = baseTop + (480 - def.h)
    const cx = def.x

    ctx.save()
    const cg = ctx.createLinearGradient(cx, cy, cx + def.w, cy + def.h)
    if (def.rank === 1) {
      cg.addColorStop(0, 'rgba(139,92,246,0.22)')
      cg.addColorStop(1, 'rgba(236,72,153,0.14)')
    } else {
      cg.addColorStop(0, 'rgba(255,255,255,0.07)')
      cg.addColorStop(1, 'rgba(255,255,255,0.03)')
    }
    ctx.fillStyle = cg
    roundRect(ctx, cx, cy, def.w, def.h, 24)
    ctx.strokeStyle = def.rank === 1 ? 'rgba(139,92,246,0.5)' : 'rgba(255,255,255,0.08)'
    ctx.lineWidth = def.rank === 1 ? 2 : 1
    roundRectClip(ctx, cx, cy, def.w, def.h, 24)
    ctx.stroke()
    ctx.restore()

    ctx.save()
    const rnb = def.rank === 1 ? 56 : 44
    const rnbx = cx + def.w / 2 - rnb / 2
    const rnby = cy + 20
    ctx.fillStyle = def.rankColor
    ctx.beginPath()
    ctx.arc(rnbx + rnb / 2, rnby + rnb / 2, rnb / 2, 0, Math.PI * 2)
    ctx.fill()
    ctx.font = `800 ${def.rank === 1 ? 28 : 22}px ${BRAND.font}`
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'center'
    ctx.fillStyle = def.rank === 1 ? '#0B0B0F' : '#fff'
    ctx.fillText(def.rank === 1 ? '🏆' : `#${def.rank}`, rnbx + rnb / 2, rnby + rnb / 2)
    ctx.restore()

    const avR = def.rank === 1 ? 66 : 50
    const avCx = cx + def.w / 2
    const avCy = cy + rnb + 20 + avR + 14

    if (entry.image_url) {
      try {
        const img = await loadImage(entry.image_url)
        ctx.save()
        const gr = ctx.createRadialGradient(avCx, avCy, avR - 4, avCx, avCy, avR + 12)
        gr.addColorStop(0, BRAND.purple)
        gr.addColorStop(1, 'rgba(139,92,246,0)')
        ctx.fillStyle = gr
        ctx.beginPath()
        ctx.arc(avCx, avCy, avR + 12, 0, Math.PI * 2)
        ctx.fill()
        ctx.beginPath()
        ctx.arc(avCx, avCy, avR, 0, Math.PI * 2)
        ctx.clip()
        ctx.drawImage(img, avCx - avR, avCy - avR, avR * 2, avR * 2)
        ctx.restore()
      } catch {}
    } else {
      ctx.save()
      ctx.fillStyle = 'rgba(139,92,246,0.3)'
      ctx.beginPath()
      ctx.arc(avCx, avCy, avR, 0, Math.PI * 2)
      ctx.fill()
      ctx.font = `${avR * 0.8}px serif`
      ctx.textBaseline = 'middle'
      ctx.textAlign = 'center'
      ctx.fillText(entry.emoji || '🎙', avCx, avCy)
      ctx.restore()
    }

    const name = entry.name || `Platz ${def.rank}`
    ctx.save()
    ctx.font = `700 ${def.rank === 1 ? 28 : 22}px ${BRAND.font}`
    ctx.textBaseline = 'top'
    ctx.textAlign = 'center'
    ctx.fillStyle = BRAND.white
    const nameLines = wrapText(ctx, name, def.w - 32)
    nameLines.slice(0, 2).forEach((line, li) => {
      ctx.fillText(line, avCx, avCy + avR + 14 + li * 34)
    })
    ctx.restore()

    const value = entry.value || entry.score || entry.count || ''
    if (value) {
      ctx.save()
      const valY = avCy + avR + 14 + Math.min(nameLines.length, 2) * 34 + 10
      ctx.font = `600 ${def.rank === 1 ? 24 : 19}px ${BRAND.font}`
      ctx.textBaseline = 'top'
      ctx.textAlign = 'center'
      const vg = ctx.createLinearGradient(cx, valY, cx + def.w, valY)
      vg.addColorStop(0, BRAND.purple)
      vg.addColorStop(1, BRAND.pink)
      ctx.fillStyle = vg
      ctx.fillText(String(value), avCx, valY)
      ctx.restore()
    }
  }

  return [canvas]
}

// ─── carousel render: each slide portrait 1080x1350 ─────────────────────────

async function renderCarouselSlides(brief, W, H) {
  const slides = Array.isArray(brief.slides) ? brief.slides : []
  if (!slides.length) {
    return renderHero(brief, W, H)
  }

  const canvases = []
  for (let si = 0; si < slides.length; si++) {
    const slide = slides[si]
    const c = document.createElement('canvas')
    c.width = W; c.height = H
    const ctx = c.getContext('2d')

    fillBg(ctx, W, H)
    drawBubbles(ctx, W, H)
    drawLogo(ctx, W)
    drawFooter(ctx, W, H)

    // slide counter pill top-right
    const pillTxt = `${si + 1} / ${slides.length}`
    ctx.save()
    ctx.font = `600 22px ${BRAND.font}`
    const ptw = ctx.measureText(pillTxt).width + 28
    const pth = 36
    const ptx = W - 60 - ptw
    const pty = 52
    ctx.fillStyle = 'rgba(139,92,246,0.22)'
    roundRect(ctx, ptx, pty, ptw, pth, 18)
    ctx.strokeStyle = 'rgba(139,92,246,0.4)'
    ctx.lineWidth = 1
    roundRectClip(ctx, ptx, pty, ptw, pth, 18)
    ctx.stroke()
    ctx.fillStyle = '#C4B5FD'
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'center'
    ctx.fillText(pillTxt, ptx + ptw / 2, pty + pth / 2)
    ctx.restore()

    const headline = slide.headline || ''
    const subtext = slide.subtext || slide.text || ''
    const cta = slide.cta || ''

    if (slide.image_url) {
      try {
        const img = await loadImage(slide.image_url)
        ctx.save()
        const iH = Math.min(H * 0.36, 480)
        const iW = Math.min(W - 120, iH)
        const ix = W / 2 - iW / 2
        const iy = H * 0.10
        roundRectClip(ctx, ix, iy, iW, iH, 24)
        ctx.clip()
        ctx.drawImage(img, ix, iy, iW, iH)
        ctx.restore()
      } catch {}
    }

    if (headline) {
      ctx.save()
      ctx.font = `800 76px ${BRAND.font}`
      ctx.textBaseline = 'middle'
      ctx.textAlign = 'center'
      ctx.fillStyle = BRAND.white
      const hLines = wrapText(ctx, headline, W - 140)
      const lh = 90
      const blkH = hLines.length * lh
      const startY = H * 0.48 - blkH / 2
      hLines.slice(0, 4).forEach((line, i) => {
        ctx.fillText(line, W / 2, startY + i * lh + lh / 2)
      })
      ctx.restore()

      if (subtext) {
        ctx.save()
        ctx.font = `400 28px ${BRAND.font}`
        ctx.textBaseline = 'top'
        ctx.textAlign = 'center'
        ctx.fillStyle = BRAND.whiteDim
        const sLines = wrapText(ctx, subtext, W - 200)
        const subTop = H * 0.48 + blkH / 2 + 24
        sLines.slice(0, 3).forEach((line, i) => ctx.fillText(line, W / 2, subTop + i * 38))
        ctx.restore()
      }
    }

    if (si === slides.length - 1 && cta) {
      pillCTA(ctx, cta, W / 2, H - 120, W)
    } else if (cta) {
      ctx.save()
      ctx.font = `500 24px ${BRAND.font}`
      ctx.textBaseline = 'bottom'
      ctx.textAlign = 'center'
      const ctag = ctx.createLinearGradient(W / 2 - 200, H - 60, W / 2 + 200, H - 60)
      ctag.addColorStop(0, BRAND.purple)
      ctag.addColorStop(1, BRAND.pink)
      ctx.fillStyle = ctag
      ctx.fillText(cta, W / 2, H - 60)
      ctx.restore()
    }

    canvases.push(c)
  }
  return canvases
}

// ─── main renderBrandedCanvas dispatcher ────────────────────────────────────

const LAYOUT_LABELS = {
  hero: 'Hero',
  comparison: 'Vorher|Nachher',
  step_grid: 'Step-Grid',
  quote: 'Quote',
  avatar_grid: 'Avatar-Grid',
  podium: 'Podium',
  carousel: 'Carousel',
}

async function renderBrandedCanvas(item) {
  const brief = item.image_brief || {}
  const layout = brief.layout || 'hero'
  const isCarousel = layout === 'carousel'
  const W = 1080
  const H = isCarousel ? 1350 : 1080

  switch (layout) {
    case 'comparison':  return renderComparison(brief, W, H)
    case 'step_grid':   return renderStepGrid(brief, W, H)
    case 'quote':       return renderQuote(brief, W, H)
    case 'avatar_grid': return renderAvatarGrid(brief, W, H)
    case 'podium':      return renderPodium(brief, W, H)
    case 'carousel':    return renderCarouselSlides(brief, W, H)
    case 'hero':
    default:            return renderHero(brief, W, H)
  }
}

// ─── upload helpers ──────────────────────────────────────────────────────────

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/png')
  })
}

async function uploadCanvas(canvas, filename) {
  const blob = await canvasToBlob(canvas)
  const { error } = await sb.storage.from('insta-marketing').upload(filename, blob, { upsert: true, contentType: 'image/png' })
  if (error) throw new Error('Upload fehlgeschlagen: ' + error.message)
  const { data: pub } = sb.storage.from('insta-marketing').getPublicUrl(filename)
  return pub.publicUrl
}

async function handleRenderImage(item, layout, refresh) {
  const augmentedItem = layout
    ? { ...item, image_brief: { ...(item.image_brief || {}), layout } }
    : item

  toast('Bild wird gerendert…')
  try {
    const canvases = await renderBrandedCanvas(augmentedItem)

    let imageUrl
    if (canvases.length === 1) {
      imageUrl = await uploadCanvas(canvases[0], item.id + '.png')
    } else {
      const urls = []
      for (let i = 0; i < canvases.length; i++) {
        urls.push(await uploadCanvas(canvases[i], `${item.id}_slide${i + 1}.png`))
      }
      imageUrl = JSON.stringify(urls)
    }

    const { error: updErr } = await sb.from('insta_posts_queue').update({ image_url: imageUrl }).eq('id', item.id)
    if (updErr) { toast('DB-Update fehlgeschlagen: ' + updErr.message, 'error'); return }
    toast('Bild gespeichert ✓', 'success')
    refresh()
  } catch (e) {
    toast('Render-Fehler: ' + (e?.message || 'unbekannt'), 'error')
  }
}

// ─── styles ──────────────────────────────────────────────────────────────────

function styles() {
  if (document.getElementById('insta-approval-styles')) return
  const s = document.createElement('style')
  s.id = 'insta-approval-styles'
  s.textContent = `
    .insta-hero-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:20px;}
    .insta-hero-card{position:relative;overflow:hidden;padding:18px 20px;border-radius:18px;background:linear-gradient(135deg,rgba(139,92,246,.12),rgba(236,72,153,.05));border:1px solid rgba(255,255,255,.08);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);}
    .insta-hero-card::before{content:"";position:absolute;inset:0;background:radial-gradient(circle at top right,rgba(139,92,246,.18),transparent 60%);pointer-events:none;}
    .insta-hero-card .hero-label{color:#a8a8b3;font-size:12px;font-weight:500;letter-spacing:.04em;text-transform:uppercase;margin-bottom:8px;display:flex;align-items:center;gap:6px;}
    .insta-hero-card .hero-value{color:#fff;font-size:32px;font-weight:700;letter-spacing:-.02em;line-height:1;}
    .insta-hero-card .hero-delta{margin-top:6px;font-size:12px;color:#10B981;font-weight:500;}
    .insta-section-title{display:flex;align-items:center;gap:10px;color:#fff;font-size:15px;font-weight:600;margin:0 0 14px 0;letter-spacing:-.01em;}
    .insta-section-title .count-badge{background:rgba(139,92,246,.18);color:#C4B5FD;font-size:12px;padding:3px 10px;border-radius:999px;font-weight:600;}
    .insta-grid-2{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px;}
    @media (max-width:900px){.insta-grid-2{grid-template-columns:1fr;}}
    .glass-card{background:linear-gradient(180deg,rgba(28,28,36,.7),rgba(20,20,26,.5));border:1px solid rgba(255,255,255,.06);border-radius:18px;padding:18px;backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);}
    .insta-queue-card{position:relative;background:linear-gradient(180deg,rgba(28,28,36,.85),rgba(18,18,24,.7));border:1px solid rgba(255,255,255,.07);border-radius:20px;padding:20px;margin-bottom:16px;backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);transition:transform .25s cubic-bezier(.2,.8,.2,1),border-color .25s;}
    .insta-queue-card:hover{transform:translateY(-2px);border-color:rgba(139,92,246,.35);}
    .insta-queue-card .chip{background:rgba(255,255,255,.06);color:#e0e0e8;padding:5px 11px;border-radius:999px;font-size:12px;font-weight:500;border:1px solid rgba(255,255,255,.05);}
    .insta-queue-card .chip.audience{background:rgba(139,92,246,.16);color:#C4B5FD;border-color:rgba(139,92,246,.25);}
    .insta-queue-card .chip.type{background:rgba(236,72,153,.14);color:#F9A8D4;border-color:rgba(236,72,153,.22);}
    .insta-queue-card textarea, .insta-queue-card input[type=text]{width:100%;background:rgba(11,11,15,.6);color:#fff;border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:11px 13px;font-family:inherit;font-size:14px;resize:vertical;transition:border-color .2s,background .2s;box-sizing:border-box;}
    .insta-queue-card textarea:focus, .insta-queue-card input[type=text]:focus{outline:none;border-color:rgba(139,92,246,.5);background:rgba(11,11,15,.85);}
    .insta-queue-card label{display:block;color:#9090a0;font-size:11px;font-weight:500;letter-spacing:.05em;text-transform:uppercase;margin-bottom:6px;margin-top:14px;}
    .insta-queue-card .image-slot img{max-width:280px;border-radius:14px;display:block;box-shadow:0 8px 24px rgba(0,0,0,.4);}
    .btn-approve{flex:1;min-width:200px;background:linear-gradient(135deg,#10B981,#059669);color:#fff;border:none;border-radius:14px;padding:14px 18px;font-size:14px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:8px;transition:transform .15s,box-shadow .2s,filter .2s;box-shadow:0 4px 14px rgba(16,185,129,.25);}
    .btn-approve:hover{transform:translateY(-1px);box-shadow:0 8px 22px rgba(16,185,129,.4);filter:brightness(1.08);}
    .btn-approve:active{transform:translateY(0) scale(.98);}
    .btn-reject{flex:1;min-width:160px;background:rgba(239,68,68,.12);color:#FCA5A5;border:1px solid rgba(239,68,68,.25);border-radius:14px;padding:14px 18px;font-size:14px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:8px;transition:all .2s;}
    .btn-reject:hover{background:rgba(239,68,68,.2);border-color:rgba(239,68,68,.4);color:#fff;}
    .btn-reject:active{transform:scale(.98);}
    .btn-secondary{background:rgba(255,255,255,.06);color:#e0e0e8;border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:9px 14px;font-size:13px;cursor:pointer;transition:all .2s;display:inline-flex;align-items:center;gap:6px;}
    .btn-secondary:hover{background:rgba(255,255,255,.1);border-color:rgba(255,255,255,.15);}
    .btn-primary{background:linear-gradient(135deg,#8B5CF6,#7C3AED);color:#fff;border:none;border-radius:10px;padding:9px 14px;font-size:13px;font-weight:600;cursor:pointer;transition:all .2s;display:inline-flex;align-items:center;gap:6px;box-shadow:0 4px 12px rgba(139,92,246,.3);}
    .btn-primary:hover{filter:brightness(1.1);transform:translateY(-1px);box-shadow:0 6px 18px rgba(139,92,246,.45);}
    .toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;}
    .empty-state{padding:40px 20px;text-align:center;border:1px dashed rgba(255,255,255,.1);border-radius:18px;background:rgba(255,255,255,.02);}
    .empty-state .empty-icon{font-size:48px;margin-bottom:12px;opacity:.6;}
    .empty-state .empty-title{color:#fff;font-size:15px;font-weight:600;margin-bottom:6px;}
    .empty-state .empty-sub{color:#888;font-size:13px;}
    .history-row{display:flex;align-items:center;gap:14px;padding:14px;border-radius:14px;background:rgba(255,255,255,.025);border:1px solid rgba(255,255,255,.05);margin-bottom:10px;transition:background .2s,border-color .2s;cursor:pointer;}
    .history-row:hover{background:rgba(255,255,255,.05);border-color:rgba(139,92,246,.25);}
    .history-row .h-thumb{width:48px;height:48px;border-radius:12px;background:linear-gradient(135deg,#8B5CF6,#EC4899);flex-shrink:0;display:flex;align-items:center;justify-content:center;color:#fff;font-size:18px;overflow:hidden;}
    .history-row .h-thumb img{width:100%;height:100%;object-fit:cover;}
    .history-row .h-main{flex:1;min-width:0;}
    .history-row .h-caption{color:#fff;font-size:13.5px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:3px;}
    .history-row .h-meta{color:#888;font-size:12px;display:flex;gap:10px;flex-wrap:wrap;}
    .history-row .h-insights{color:#C4B5FD;font-size:12px;font-weight:500;white-space:nowrap;}
    .panel-head h2{font-size:22px;font-weight:700;letter-spacing:-.02em;color:#fff;margin:0;}
    .chart-wrap{height:180px;margin-top:8px;}
    .insta-error{padding:24px;border-radius:16px;background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.2);color:#FCA5A5;text-align:center;}
    .skel{display:inline-block;background:linear-gradient(90deg,rgba(255,255,255,.04),rgba(255,255,255,.1),rgba(255,255,255,.04));background-size:200% 100%;animation:skelmove 1.4s ease infinite;border-radius:12px;}
    @keyframes skelmove{0%{background-position:200% 0;}100%{background-position:-200% 0;}}
    .btn-pulse{animation:btnPulse .6s ease;}
    @keyframes btnPulse{0%{transform:scale(1);}50%{transform:scale(.94);}100%{transform:scale(1);}}
    .tab-bar{display:flex;gap:4px;background:rgba(255,255,255,.04);border-radius:14px;padding:4px;margin-bottom:20px;}
    .tab-btn{flex:1;padding:9px 16px;border:none;background:transparent;color:#888;font-size:13.5px;font-weight:500;border-radius:10px;cursor:pointer;transition:all .2s;white-space:nowrap;}
    .tab-btn.active{background:rgba(139,92,246,.22);color:#C4B5FD;font-weight:600;}
    .tab-btn:hover:not(.active){background:rgba(255,255,255,.06);color:#e0e0e8;}
    .tab-pane{display:none;}
    .tab-pane.active{display:block;}
    .insights-modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:9000;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(6px);}
    .insights-modal{background:linear-gradient(180deg,rgba(28,28,36,.98),rgba(18,18,24,.98));border:1px solid rgba(139,92,246,.25);border-radius:22px;padding:26px;width:min(440px,90vw);box-shadow:0 24px 64px rgba(0,0,0,.6);}
    .insights-modal h3{color:#fff;font-size:17px;font-weight:700;margin:0 0 18px 0;}
    .insights-modal label{display:block;color:#9090a0;font-size:11px;font-weight:500;letter-spacing:.05em;text-transform:uppercase;margin-bottom:6px;margin-top:14px;}
    .insights-modal input[type=number]{width:100%;background:rgba(11,11,15,.7);color:#fff;border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:10px 13px;font-family:inherit;font-size:15px;box-sizing:border-box;transition:border-color .2s;}
    .insights-modal input[type=number]:focus{outline:none;border-color:rgba(139,92,246,.5);}
    .insights-modal .modal-actions{display:flex;gap:10px;margin-top:22px;}
    .insights-row{display:flex;align-items:center;gap:14px;padding:14px;border-radius:14px;background:rgba(255,255,255,.025);border:1px solid rgba(255,255,255,.05);margin-bottom:10px;transition:background .2s,border-color .2s;}
    .insights-row:hover{background:rgba(255,255,255,.04);border-color:rgba(139,92,246,.2);}
    .insights-row .h-thumb{width:52px;height:52px;border-radius:12px;background:linear-gradient(135deg,#8B5CF6,#EC4899);flex-shrink:0;display:flex;align-items:center;justify-content:center;color:#fff;font-size:18px;overflow:hidden;}
    .insights-row .h-thumb img{width:100%;height:100%;object-fit:cover;}
    .insights-row .h-main{flex:1;min-width:0;}
    .insights-row .h-caption{color:#fff;font-size:13.5px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:4px;}
    .insights-row .h-meta{color:#888;font-size:12px;display:flex;gap:10px;flex-wrap:wrap;}
    .insights-row .h-stats{display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;}
    .insights-row .stat-chip{background:rgba(139,92,246,.1);color:#C4B5FD;border:1px solid rgba(139,92,246,.2);border-radius:999px;padding:3px 9px;font-size:12px;font-weight:500;}
    .insights-row .stat-chip.empty{background:rgba(255,255,255,.04);color:#666;border-color:rgba(255,255,255,.06);}
    .btn-insights-edit{background:rgba(139,92,246,.14);color:#C4B5FD;border:1px solid rgba(139,92,246,.25);border-radius:8px;padding:7px 12px;font-size:12px;font-weight:600;cursor:pointer;transition:all .2s;white-space:nowrap;flex-shrink:0;}
    .btn-insights-edit:hover{background:rgba(139,92,246,.25);border-color:rgba(139,92,246,.45);}
    .layout-switcher{display:flex;gap:6px;flex-wrap:wrap;margin-top:12px;padding:12px;background:rgba(255,255,255,.03);border-radius:12px;border:1px solid rgba(255,255,255,.06);}
    .layout-switcher-label{color:#9090a0;font-size:11px;font-weight:500;letter-spacing:.05em;text-transform:uppercase;width:100%;margin-bottom:4px;}
    .layout-btn{background:rgba(255,255,255,.05);color:#b0b0c0;border:1px solid rgba(255,255,255,.07);border-radius:8px;padding:6px 12px;font-size:12px;font-weight:500;cursor:pointer;transition:all .2s;white-space:nowrap;}
    .layout-btn:hover{background:rgba(139,92,246,.15);color:#C4B5FD;border-color:rgba(139,92,246,.3);}
    .layout-btn.active{background:rgba(139,92,246,.22);color:#C4B5FD;border-color:rgba(139,92,246,.45);font-weight:700;}
    .carousel-thumbs{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;}
    .carousel-thumbs img{width:72px;height:90px;object-fit:cover;border-radius:10px;border:1px solid rgba(139,92,246,.3);}
  `
  document.head.appendChild(s)
}

// ─── stats helpers ────────────────────────────────────────────────────────────

function buildHero(stats) {
  const items = [
    { label: 'Heute gepostet', value: stats.todayCount, icon: '📤', delta: stats.todayCount > 0 ? '+' + stats.todayCount : null },
    { label: 'Diese Woche', value: stats.weekCount, icon: '📅', delta: null },
    { label: 'In Warteschlange', value: stats.queueCount, icon: '⏳', delta: null },
    { label: 'Gesamt-Reichweite', value: stats.totalReach, icon: '👁', delta: null },
    { label: 'Likes gesamt', value: stats.totalLikes, icon: '❤', delta: null },
  ]
  const grid = document.createElement('div')
  grid.className = 'insta-hero-grid'
  items.forEach((it, i) => {
    const card = document.createElement('div')
    card.className = 'insta-hero-card'
    card.innerHTML = `
      <div class="hero-label"><span>${it.icon}</span>${htmlEscape(it.label)}</div>
      <div class="hero-value" data-val="${it.value}">0</div>
      ${it.delta ? `<div class="hero-delta">▲ ${htmlEscape(it.delta)} neu</div>` : ''}
    `
    grid.appendChild(card)
    setTimeout(() => {
      const el = card.querySelector('.hero-value')
      try { countUp(el, it.value, { duration: 900 + i * 80 }) }
      catch { el.textContent = fmtNumber(it.value) }
    }, 60)
  })
  return grid
}

function computeStats(queue, posted) {
  const now = Date.now()
  const dayMs = 24 * 60 * 60 * 1000
  let todayCount = 0, weekCount = 0, totalReach = 0, totalLikes = 0
  const byDay = {}
  const byAudience = {}
  for (const p of posted) {
    const t = p.posted_at ? new Date(p.posted_at).getTime() : 0
    if (now - t < dayMs) todayCount++
    if (now - t < 7 * dayMs) weekCount++
    const key = new Date(t).toISOString().slice(0, 10)
    byDay[key] = (byDay[key] || 0) + 1
    const aud = p.audience || 'unbekannt'
    byAudience[aud] = (byAudience[aud] || 0) + 1
    let ins = p.insights
    if (typeof ins === 'string') { try { ins = JSON.parse(ins) } catch { ins = null } }
    if (ins) {
      totalReach += Number(ins.reach || 0)
      totalLikes += Number(ins.likes || 0)
    }
  }
  return { todayCount, weekCount, queueCount: queue.length, totalReach, totalLikes, byDay, byAudience }
}

function buildTimeChart(byDay) {
  const wrap = document.createElement('div')
  wrap.className = 'chart-wrap'
  const days = []
  const now = new Date()
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000)
    days.push(d.toISOString().slice(0, 10))
  }
  const data = days.map(d => ({ label: d.slice(5), value: byDay[d] || 0 }))
  try { makeAreaChart(wrap, data, { color: '#8B5CF6', height: 180 }) }
  catch { wrap.innerHTML = '<div style="color:#666;padding:20px;text-align:center;font-size:13px;">Chart nicht verfügbar</div>' }
  return wrap
}

function buildAudienceChart(byAudience) {
  const wrap = document.createElement('div')
  wrap.className = 'chart-wrap'
  const data = Object.entries(byAudience).map(([k, v]) => ({ label: k, value: v }))
  if (!data.length) data.push({ label: 'noch keine', value: 1 })
  try { makeDonutChart(wrap, data, { height: 180, colors: ['#8B5CF6', '#EC4899', '#10B981', '#F59E0B', '#3B82F6'] }) }
  catch { wrap.innerHTML = '<div style="color:#666;padding:20px;text-align:center;font-size:13px;">Chart nicht verfügbar</div>' }
  return wrap
}

// ─── image slot with layout-switcher ────────────────────────────────────────

function buildImageSlot(item, refresh) {
  const container = document.createElement('div')
  const brief = item.image_brief || {}
  const currentLayout = brief.layout || 'hero'

  let imageUrls = []
  if (item.image_url) {
    try {
      const parsed = JSON.parse(item.image_url)
      imageUrls = Array.isArray(parsed) ? parsed : [item.image_url]
    } catch {
      imageUrls = [item.image_url]
    }
  }

  const previewWrap = document.createElement('div')
  previewWrap.style.cssText = 'margin-bottom:10px;'

  if (imageUrls.length === 1) {
    const img = document.createElement('img')
    img.src = imageUrls[0]
    img.className = 'image-slot'
    previewWrap.appendChild(img)
  } else if (imageUrls.length > 1) {
    const thumbRow = document.createElement('div')
    thumbRow.className = 'carousel-thumbs'
    imageUrls.forEach(url => {
      const img = document.createElement('img')
      img.src = url
      thumbRow.appendChild(img)
    })
    previewWrap.appendChild(thumbRow)
    const note = document.createElement('div')
    note.style.cssText = 'color:#8B5CF6;font-size:12px;margin-top:6px;'
    note.textContent = `Carousel: ${imageUrls.length} Slides`
    previewWrap.appendChild(note)
  }
  container.appendChild(previewWrap)

  const switcher = document.createElement('div')
  switcher.className = 'layout-switcher'
  const swLabel = document.createElement('div')
  swLabel.className = 'layout-switcher-label'
  swLabel.textContent = 'Layout wählen'
  switcher.appendChild(swLabel)

  let selectedLayout = currentLayout

  Object.keys(LAYOUT_LABELS).forEach(key => {
    const btn = document.createElement('button')
    btn.className = 'layout-btn' + (key === selectedLayout ? ' active' : '')
    btn.textContent = LAYOUT_LABELS[key]
    btn.dataset.layout = key
    btn.addEventListener('click', () => {
      selectedLayout = key
      switcher.querySelectorAll('.layout-btn').forEach(b => b.classList.toggle('active', b.dataset.layout === selectedLayout))
    })
    switcher.appendChild(btn)
  })
  container.appendChild(switcher)

  const actRow = document.createElement('div')
  actRow.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;'

  const renderBtn = document.createElement('button')
  renderBtn.className = 'btn-secondary'
  renderBtn.innerHTML = imageUrls.length > 0 ? '🔁 Neu rendern' : '🎨 Bild rendern'
  renderBtn.addEventListener('click', () => handleRenderImage(item, selectedLayout, refresh))
  actRow.appendChild(renderBtn)
  container.appendChild(actRow)

  return container
}

// ─── queue card ──────────────────────────────────────────────────────────────

function renderQueueCard(item, refresh) {
  const card = document.createElement('div')
  card.className = 'insta-queue-card'

  const audience = htmlEscape(item.audience || '—')
  const postType = htmlEscape(item.post_type || '—')
  const slot = item.slot_time ? fmtDateTime(item.slot_time) : '—'
  const caption = item.caption || ''
  const hashtags = Array.isArray(item.hashtags) ? item.hashtags.join(', ') : (item.hashtags || '')

  card.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
      <span class="chip audience">👥 ${audience}</span>
      <span class="chip type">✨ ${postType}</span>
      <span style="color:#888;font-size:12.5px;margin-left:auto;display:inline-flex;align-items:center;gap:5px;">🕐 ${htmlEscape(slot)}</span>
    </div>
    <label>Caption</label>
    <textarea class="cap-input" rows="4">${htmlEscape(caption)}</textarea>
    <label>Hashtags (kommagetrennt)</label>
    <input class="hash-input" type="text" value="${htmlEscape(hashtags)}" />
    <div class="image-slot-wrap" style="margin-top:14px;"></div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:16px;">
      <button class="btn-approve">✓ Approven &amp; jetzt posten</button>
      <button class="btn-reject">✕ Verwerfen</button>
    </div>
  `

  card.querySelector('.image-slot-wrap').appendChild(buildImageSlot(item, refresh))

  const capInput = card.querySelector('.cap-input')
  capInput.addEventListener('blur', async () => {
    if (capInput.value === caption) return
    const { error } = await sb.from('insta_posts_queue').update({ caption: capInput.value }).eq('id', item.id)
    if (error) toast('Speichern fehlgeschlagen: ' + error.message, 'error')
    else toast('Caption gespeichert ✓', 'success')
  })

  const hashInput = card.querySelector('.hash-input')
  hashInput.addEventListener('blur', async () => {
    const arr = hashInput.value.split(',').map(s => s.trim()).filter(Boolean)
    const { error } = await sb.from('insta_posts_queue').update({ hashtags: arr }).eq('id', item.id)
    if (error) toast('Hashtags-Fehler: ' + error.message, 'error')
    else toast('Hashtags gespeichert ✓', 'success')
  })

  const approveBtn = card.querySelector('.btn-approve')
  approveBtn.addEventListener('click', async () => {
    approveBtn.classList.add('btn-pulse')
    setTimeout(() => approveBtn.classList.remove('btn-pulse'), 600)
    let ok = false
    try {
      ok = await confirmDialog({
        title: 'Live posten?',
        message: 'Diesen Post jetzt LIVE auf Instagram veröffentlichen?',
        confirmText: 'Jetzt posten',
        cancelText: 'Abbrechen',
        variant: 'primary',
      })
    } catch {
      ok = confirm('Diesen Post jetzt LIVE auf Insta veröffentlichen?')
    }
    if (!ok) return
    approveBtn.disabled = true
    approveBtn.innerHTML = '⏳ Wird gepostet…'
    try {
      const { error: updErr } = await sb.from('insta_posts_queue').update({ status: 'approved' }).eq('id', item.id)
      if (updErr) throw updErr
      const { error } = await sb.functions.invoke('insta-publish', { body: { queue_id: item.id } })
      if (error) {
        // Rollback: Publish fehlgeschlagen → Status zurück auf 'ready' damit der Post nicht verschwindet
        await sb.from('insta_posts_queue').update({ status: 'ready' }).eq('id', item.id)
        toast('Publish-Fehler: ' + error.message + ' — Status zurückgesetzt', 'error')
        approveBtn.disabled = false
        approveBtn.innerHTML = '✓ Approven & jetzt posten'
        return
      }
      toast('Erfolgreich gepostet ✓', 'success')
    } catch (e) {
      // Rollback: Exception während Publish → Status zurück auf 'ready'
      try { await sb.from('insta_posts_queue').update({ status: 'ready' }).eq('id', item.id) } catch {}
      toast('Fehler: ' + (e?.message || 'unbekannt'), 'error')
      approveBtn.disabled = false
      approveBtn.innerHTML = '✓ Approven & jetzt posten'
      return
    }
    card.style.transition = 'opacity .35s, transform .35s'
    card.style.opacity = '0'
    card.style.transform = 'translateX(40px)'
    setTimeout(refresh, 350)
  })

  const rejectBtn = card.querySelector('.btn-reject')
  rejectBtn.addEventListener('click', async () => {
    rejectBtn.classList.add('btn-pulse')
    setTimeout(() => rejectBtn.classList.remove('btn-pulse'), 600)
    let ok = false
    try {
      ok = await confirmDialog({
        title: 'Verwerfen?',
        message: 'Diesen Post-Entwurf endgültig verwerfen?',
        confirmText: 'Verwerfen',
        cancelText: 'Behalten',
        variant: 'danger',
      })
    } catch {
      ok = confirm('Verwerfen?')
    }
    if (!ok) return
    const { error } = await sb.from('insta_posts_queue').update({ status: 'rejected' }).eq('id', item.id)
    if (error) { toast('Fehler: ' + error.message, 'error'); return }
    toast('Verworfen', 'info')
    card.style.transition = 'opacity .3s, transform .3s'
    card.style.opacity = '0'
    card.style.transform = 'translateX(-40px)'
    setTimeout(refresh, 320)
  })

  return card
}

// ─── history + insights rows ─────────────────────────────────────────────────

function getFirstThumb(image_url) {
  if (!image_url) return null
  try {
    const parsed = JSON.parse(image_url)
    return Array.isArray(parsed) ? parsed[0] : image_url
  } catch {
    return image_url
  }
}

function renderHistoryRow(item) {
  const row = document.createElement('div')
  row.className = 'history-row'
  const caption = (item.caption || '').slice(0, 110) + ((item.caption || '').length > 110 ? '…' : '')
  let insightsText = ''
  if (item.insights) {
    try {
      const ins = typeof item.insights === 'string' ? JSON.parse(item.insights) : item.insights
      const parts = []
      if (ins.likes != null) parts.push('❤ ' + fmtNumber(ins.likes))
      if (ins.comments != null) parts.push('💬 ' + fmtNumber(ins.comments))
      if (ins.reach != null) parts.push('👁 ' + fmtNumber(ins.reach))
      insightsText = parts.join(' · ')
    } catch {}
  }
  const thumbSrc = getFirstThumb(item.image_url)
  const thumbHtml = thumbSrc ? `<img src="${htmlEscape(thumbSrc)}" alt="">` : '📷'
  row.innerHTML = `
    <div class="h-thumb">${thumbHtml}</div>
    <div class="h-main">
      <div class="h-caption">${htmlEscape(caption || 'Ohne Caption')}</div>
      <div class="h-meta">
        <span>${htmlEscape(item.posted_at ? fmtRelativeTime(item.posted_at) : '—')}</span>
        ${item.audience ? `<span>· ${htmlEscape(item.audience)}</span>` : ''}
      </div>
    </div>
    <div class="h-insights">${htmlEscape(insightsText)}</div>
  `
  row.addEventListener('click', () => {
    try {
      drawer({
        title: 'Post-Details',
        content: `
          <div style="padding:6px 4px;">
            ${thumbSrc ? `<img src="${htmlEscape(thumbSrc)}" style="width:100%;border-radius:14px;margin-bottom:14px;">` : ''}
            <div style="color:#fff;font-size:14px;line-height:1.55;white-space:pre-wrap;margin-bottom:14px;">${htmlEscape(item.caption || '')}</div>
            <div style="color:#888;font-size:12.5px;">${htmlEscape(item.posted_at ? fmtDateTime(item.posted_at) : '—')}</div>
            ${insightsText ? `<div style="margin-top:14px;padding:14px;background:rgba(139,92,246,.08);border-radius:12px;color:#C4B5FD;font-size:14px;">${htmlEscape(insightsText)}</div>` : ''}
          </div>
        `,
      })
    } catch (e) {
      toast('Detail-Ansicht nicht verfügbar', 'error')
    }
  })
  return row
}

function openInsightsModal(item, onSaved) {
  const existing = (() => {
    if (!item.insights) return {}
    try { return typeof item.insights === 'string' ? JSON.parse(item.insights) : item.insights } catch { return {} }
  })()

  const overlay = document.createElement('div')
  overlay.className = 'insights-modal-overlay'
  overlay.innerHTML = `
    <div class="insights-modal">
      <h3>📊 Insights bearbeiten</h3>
      <div style="color:#888;font-size:13px;margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${htmlEscape((item.caption || '').slice(0, 80))}</div>
      <label>Reichweite (Reach)</label>
      <input type="number" id="ins-reach" min="0" value="${Number(existing.reach || 0)}" placeholder="0" />
      <label>Likes</label>
      <input type="number" id="ins-likes" min="0" value="${Number(existing.likes || 0)}" placeholder="0" />
      <label>Saves</label>
      <input type="number" id="ins-saves" min="0" value="${Number(existing.saves || 0)}" placeholder="0" />
      <label>Kommentare</label>
      <input type="number" id="ins-comments" min="0" value="${Number(existing.comments || 0)}" placeholder="0" />
      <div class="modal-actions">
        <button class="btn-primary ins-save-btn" style="flex:1;">💾 Speichern</button>
        <button class="btn-secondary ins-cancel-btn">Abbrechen</button>
      </div>
    </div>
  `

  const close = () => overlay.remove()
  overlay.querySelector('.ins-cancel-btn').addEventListener('click', close)
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close() })

  overlay.querySelector('.ins-save-btn').addEventListener('click', async () => {
    const saveBtn = overlay.querySelector('.ins-save-btn')
    saveBtn.disabled = true
    saveBtn.innerHTML = '⏳ Speichert…'
    const insightsObj = {
      reach: Number(overlay.querySelector('#ins-reach').value) || 0,
      likes: Number(overlay.querySelector('#ins-likes').value) || 0,
      saves: Number(overlay.querySelector('#ins-saves').value) || 0,
      comments: Number(overlay.querySelector('#ins-comments').value) || 0,
    }
    // Speichere als JSON-String (kompatibel mit text- und jsonb-Spalte)
    const { error } = await sb.from('insta_posts_queue').update({ insights: JSON.stringify(insightsObj) }).eq('id', item.id)
    if (error) {
      toast('Fehler: ' + error.message, 'error')
      saveBtn.disabled = false
      saveBtn.innerHTML = '💾 Speichern'
      return
    }
    toast('Insights gespeichert ✓', 'success')
    close()
    if (onSaved) onSaved()
  })

  document.body.appendChild(overlay)
  setTimeout(() => overlay.querySelector('#ins-reach').focus(), 80)
}

function renderInsightsRow(item, onEdit) {
  const row = document.createElement('div')
  row.className = 'insights-row'

  let ins = null
  if (item.insights) {
    try { ins = typeof item.insights === 'string' ? JSON.parse(item.insights) : item.insights } catch {}
  }

  const thumbSrc = getFirstThumb(item.image_url)
  const thumbHtml = thumbSrc ? `<img src="${htmlEscape(thumbSrc)}" alt="">` : '📷'

  const statsHtml = ins
    ? [
        ins.reach != null ? `<span class="stat-chip">👁 ${fmtNumber(ins.reach)}</span>` : '',
        ins.likes != null ? `<span class="stat-chip">❤ ${fmtNumber(ins.likes)}</span>` : '',
        ins.saves != null ? `<span class="stat-chip">🔖 ${fmtNumber(ins.saves)}</span>` : '',
        ins.comments != null ? `<span class="stat-chip">💬 ${fmtNumber(ins.comments)}</span>` : '',
      ].filter(Boolean).join('')
    : '<span class="stat-chip empty">Keine Insights</span>'

  row.innerHTML = `
    <div class="h-thumb">${thumbHtml}</div>
    <div class="h-main">
      <div class="h-caption">${htmlEscape((item.caption || 'Ohne Caption').slice(0, 100))}</div>
      <div class="h-meta">
        <span>${htmlEscape(item.posted_at ? fmtDateTime(item.posted_at) : '—')}</span>
        ${item.audience ? `<span>· ${htmlEscape(item.audience)}</span>` : ''}
      </div>
      <div class="h-stats">${statsHtml}</div>
    </div>
    <button class="btn-insights-edit">✏️ Insights bearbeiten</button>
  `

  row.querySelector('.btn-insights-edit').addEventListener('click', (e) => {
    e.stopPropagation()
    openInsightsModal(item, onEdit)
  })

  return row
}

// ─── panel mount ─────────────────────────────────────────────────────────────

export default {
  id: 'insta-approval-queue',
  title: 'Instagram-Posts Freigabe',
  category: 'marketing',
  summary: 'Generierte IG-Marketing-Posts zur Freigabe oder Ablehnung.',
  async mount(container) {
    try {
      styles()
      container.innerHTML = `
        <div class="panel-shell">
          <div class="panel-head" style="display:flex;align-items:center;gap:12px;margin-bottom:18px;flex-wrap:wrap;">
            <h2>Instagram-Posts Freigabe</h2>
            <div class="toolbar" style="margin-left:auto;">
              <button class="btn-secondary refresh-btn">🔄 Aktualisieren</button>
              <button class="btn-secondary pdf-btn">📄 PDF</button>
              <button class="btn-secondary csv-btn">💾 CSV</button>
              <button class="btn-primary generate-btn">✨ Generator starten</button>
            </div>
          </div>
          <div class="panel-body" id="ia-body"></div>
        </div>
      `
      const body = container.querySelector('#ia-body')

      const renderSkeleton = () => {
        body.innerHTML = `
          <div class="insta-hero-grid">
            ${Array.from({ length: 5 }).map(() => '<div class="skel" style="height:96px;"></div>').join('')}
          </div>
          <div class="insta-grid-2">
            <div class="skel" style="height:220px;"></div>
            <div class="skel" style="height:220px;"></div>
          </div>
          <div class="skel" style="height:180px;margin-bottom:14px;"></div>
          <div class="skel" style="height:180px;"></div>
        `
      }

      renderSkeleton()

      let posted = []
      let activeTab = 'queue'

      const switchTab = (tab) => {
        activeTab = tab
        body.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab))
        body.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.dataset.pane === tab))
      }

      const refresh = async () => {
        renderSkeleton()
        try {
          const [{ data: queueItems, error: qErr }, { data: postedItems, error: pErr }] = await Promise.all([
            sb.from('insta_posts_queue').select('*').in('status', ['ready', 'draft']).order('slot_time', { ascending: true }),
            sb.from('insta_posts_queue').select('*').eq('status', 'posted').order('posted_at', { ascending: false }).limit(50),
          ])
          if (qErr) throw qErr
          if (pErr) throw pErr

          const queue = queueItems || []
          posted = postedItems || []
          const stats = computeStats(queue, posted)

          body.innerHTML = ''
          body.appendChild(buildHero(stats))

          const chartsGrid = document.createElement('div')
          chartsGrid.className = 'insta-grid-2'

          const timeCard = document.createElement('div')
          timeCard.className = 'glass-card'
          timeCard.innerHTML = `<h3 class="insta-section-title">📈 Posts der letzten 14 Tage</h3>`
          timeCard.appendChild(buildTimeChart(stats.byDay))
          chartsGrid.appendChild(timeCard)

          const audCard = document.createElement('div')
          audCard.className = 'glass-card'
          audCard.innerHTML = `<h3 class="insta-section-title">🎯 Zielgruppen-Verteilung</h3>`
          audCard.appendChild(buildAudienceChart(stats.byAudience))
          chartsGrid.appendChild(audCard)

          body.appendChild(chartsGrid)

          const tabBar = document.createElement('div')
          tabBar.className = 'tab-bar'
          tabBar.innerHTML = `
            <button class="tab-btn${activeTab === 'queue' ? ' active' : ''}" data-tab="queue">📥 Warteschlange <span style="opacity:.7">(${queue.length})</span></button>
            <button class="tab-btn${activeTab === 'insights' ? ' active' : ''}" data-tab="insights">📊 Insights <span style="opacity:.7">(${posted.length})</span></button>
            <button class="tab-btn${activeTab === 'verlauf' ? ' active' : ''}" data-tab="verlauf">📋 Verlauf <span style="opacity:.7">(${posted.length})</span></button>
          `
          tabBar.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => switchTab(btn.dataset.tab))
          })
          body.appendChild(tabBar)

          const queuePane = document.createElement('div')
          queuePane.className = `tab-pane${activeTab === 'queue' ? ' active' : ''}`
          queuePane.dataset.pane = 'queue'
          const queueSection = document.createElement('div')
          queueSection.className = 'glass-card'
          queueSection.style.marginBottom = '20px'
          const queueHead = document.createElement('h3')
          queueHead.className = 'insta-section-title'
          queueHead.innerHTML = `📥 Warteschlange <span class="count-badge">${queue.length}</span>`
          queueSection.appendChild(queueHead)

          if (queue.length === 0) {
            const empty = document.createElement('div')
            empty.className = 'empty-state'
            empty.innerHTML = `
              <div class="empty-icon">🎉</div>
              <div class="empty-title">Alles abgearbeitet!</div>
              <div class="empty-sub">Keine Posts warten auf Freigabe. Starte den Generator für neue Vorschläge.</div>
              <button class="btn-primary" style="margin-top:16px;" id="empty-gen">✨ Generator starten</button>
            `
            empty.querySelector('#empty-gen').addEventListener('click', () => container.querySelector('.generate-btn').click())
            queueSection.appendChild(empty)
          } else {
            for (const item of queue) {
              queueSection.appendChild(renderQueueCard(item, refresh))
            }
          }
          queuePane.appendChild(queueSection)
          body.appendChild(queuePane)

          const insightsPane = document.createElement('div')
          insightsPane.className = `tab-pane${activeTab === 'insights' ? ' active' : ''}`
          insightsPane.dataset.pane = 'insights'
          const insSection = document.createElement('div')
          insSection.className = 'glass-card'
          const insHead = document.createElement('h3')
          insHead.className = 'insta-section-title'
          insHead.innerHTML = `📊 Performance der veröffentlichten Posts <span class="count-badge">${posted.length}</span>`
          insSection.appendChild(insHead)

          if (posted.length === 0) {
            const empty = document.createElement('div')
            empty.className = 'empty-state'
            empty.innerHTML = `
              <div class="empty-icon">📭</div>
              <div class="empty-title">Noch keine Veröffentlichungen</div>
              <div class="empty-sub">Sobald Posts live gehen, erscheinen sie hier. Insights können nachgetragen werden.</div>
            `
            insSection.appendChild(empty)
          } else {
            const list = document.createElement('div')
            const renderInsightsList = () => {
              list.innerHTML = ''
              posted.forEach(it => {
                list.appendChild(renderInsightsRow(it, async () => {
                  const { data: fresh } = await sb.from('insta_posts_queue')
                    .select('*').eq('status', 'posted').order('posted_at', { ascending: false }).limit(50)
                  if (fresh) {
                    posted = fresh
                    renderInsightsList()
                  }
                }))
              })
            }
            renderInsightsList()
            insSection.appendChild(list)
          }
          insightsPane.appendChild(insSection)
          body.appendChild(insightsPane)

          // ─── Verlauf-Tab (renderHistoryRow) ──────────────────────────────
          const verlaufPane = document.createElement('div')
          verlaufPane.className = `tab-pane${activeTab === 'verlauf' ? ' active' : ''}`
          verlaufPane.dataset.pane = 'verlauf'
          const verlaufSection = document.createElement('div')
          verlaufSection.className = 'glass-card'
          const verlaufHead = document.createElement('h3')
          verlaufHead.className = 'insta-section-title'
          verlaufHead.innerHTML = `📋 Verlauf — veröffentlichte Posts <span class="count-badge">${posted.length}</span>`
          verlaufSection.appendChild(verlaufHead)
          if (posted.length === 0) {
            const emptyV = document.createElement('div')
            emptyV.className = 'empty-state'
            emptyV.innerHTML = `
              <div class="empty-icon">📭</div>
              <div class="empty-title">Noch keine Veröffentlichungen</div>
              <div class="empty-sub">Alle genehmigten Posts erscheinen hier im Verlauf.</div>
            `
            verlaufSection.appendChild(emptyV)
          } else {
            posted.forEach(it => verlaufSection.appendChild(renderHistoryRow(it)))
          }
          verlaufPane.appendChild(verlaufSection)
          body.appendChild(verlaufPane)

          try { fadeIn(body) } catch {}
        } catch (e) {
          body.innerHTML = `
            <div class="insta-error">
              <div style="font-size:32px;margin-bottom:8px;">⚠️</div>
              <div style="font-weight:600;color:#fff;margin-bottom:6px;">Fehler beim Laden</div>
              <div style="font-size:13px;margin-bottom:14px;">${htmlEscape(e?.message || 'unbekannt')}</div>
              <button class="btn-secondary retry-btn">🔄 Erneut versuchen</button>
            </div>
          `
          body.querySelector('.retry-btn').addEventListener('click', refresh)
        }
      }

      container.querySelector('.refresh-btn').addEventListener('click', refresh)
      container.querySelector('.pdf-btn').addEventListener('click', () => {
        try { exportPanelAsPdf(container, 'instagram-freigabe') } catch { toast('PDF-Export nicht verfügbar', 'error') }
      })
      container.querySelector('.csv-btn').addEventListener('click', () => {
        try {
          const rows = posted.map(p => ({
            posted_at: p.posted_at || '',
            audience: p.audience || '',
            post_type: p.post_type || '',
            caption: p.caption || '',
            image_url: p.image_url || '',
          }))
          exportCsv(rows, 'instagram-verlauf.csv')
        } catch { toast('CSV-Export nicht verfügbar', 'error') }
      })
      container.querySelector('.generate-btn').addEventListener('click', async () => {
        toast('Generator startet…', 'info')
        try {
          const { error } = await sb.functions.invoke('insta-marketing-generator', { body: {} })
          if (error) toast('Generator-Fehler: ' + error.message, 'error')
          else toast('Generator fertig ✓', 'success')
        } catch (e) {
          toast('Generator-Fehler: ' + (e?.message || 'unbekannt'), 'error')
        }
        refresh()
      })

      refresh()
    } catch (mountErr) {
      container.innerHTML = `
        <div style="padding:24px;border-radius:16px;background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.2);color:#FCA5A5;text-align:center;">
          <div style="font-size:32px;margin-bottom:8px;">⚠️</div>
          <div style="font-weight:600;color:#fff;margin-bottom:6px;">Panel konnte nicht geladen werden</div>
          <div style="font-size:13px;">${(mountErr && mountErr.message) ? String(mountErr.message).replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c])) : 'unbekannter Fehler'}</div>
        </div>
      `
    }
  }
}
