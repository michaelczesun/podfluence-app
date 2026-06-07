import { sb } from '/lib/supabase.js'
import { toast, fmtNumber, fmtDateTime, fmtRelativeTime, htmlEscape, confirmDialog } from '/lib/ui.js'
import { makeAreaChart, makeDonutChart } from '/lib/charts.js'
import { exportPanelAsPdf, exportCsv } from '/lib/export.js'
import { countUp, fadeIn } from '/lib/animations.js'
import { drawer } from '/lib/layout-extras.js'

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

async function renderImage(item) {
  const brief = item.image_brief || {}
  const accent = brief.accent_color || '#8B5CF6'
  const canvas = document.createElement('canvas')
  canvas.width = 1080
  canvas.height = 1080
  const ctx = canvas.getContext('2d')

  const grad = ctx.createLinearGradient(0, 0, 1080, 1080)
  grad.addColorStop(0, accent)
  grad.addColorStop(1, '#0B0B0F')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, 1080, 1080)

  ctx.fillStyle = '#FFFFFF'
  ctx.font = 'bold 64px -apple-system, system-ui, sans-serif'
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'
  ctx.fillText('hozd', 60, 60)

  ctx.font = 'bold 84px -apple-system, system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const headline = brief.headline || ''
  const headlineLines = wrapText(ctx, headline, 800)
  const lineHeight = 96
  const headlineBlockHeight = headlineLines.length * lineHeight
  const headlineStartY = 540 - headlineBlockHeight / 2 + lineHeight / 2
  headlineLines.forEach((line, i) => {
    ctx.fillText(line, 540, headlineStartY + i * lineHeight)
  })

  ctx.font = '36px -apple-system, system-ui, sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.8)'
  const subtext = brief.subtext || ''
  const subLines = wrapText(ctx, subtext, 820)
  const subLineHeight = 46
  const subStartY = headlineStartY + headlineBlockHeight + 30
  subLines.forEach((line, i) => {
    ctx.fillText(line, 540, subStartY + i * subLineHeight)
  })

  if (brief.cover_image_url) {
    try {
      const img = await loadImage(brief.cover_image_url)
      ctx.save()
      roundRectClip(ctx, 60, 820, 200, 200, 20)
      ctx.clip()
      ctx.drawImage(img, 60, 820, 200, 200)
      ctx.restore()
    } catch (e) {}
  }

  ctx.font = '32px -apple-system, system-ui, sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.9)'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  ctx.fillText('Lade hozd 🎧 — hozd.app', 540, 1020)

  return canvas
}

async function handleRenderImage(item, refresh) {
  toast('Bild wird gerendert…')
  try {
    const canvas = await renderImage(item)
    canvas.toBlob(async (blob) => {
      if (!blob) { toast('Bild konnte nicht erzeugt werden', 'error'); return }
      const filename = item.id + '.png'
      const { error } = await sb.storage.from('insta-marketing').upload(filename, blob, { upsert: true, contentType: 'image/png' })
      if (error) { toast('Upload fehlgeschlagen: ' + error.message, 'error'); return }
      const { data: pub } = sb.storage.from('insta-marketing').getPublicUrl(filename)
      const { error: updErr } = await sb.from('insta_posts_queue').update({ image_url: pub.publicUrl }).eq('id', item.id)
      if (updErr) { toast('DB-Update fehlgeschlagen: ' + updErr.message, 'error'); return }
      toast('Bild gespeichert ✓', 'success')
      refresh()
    }, 'image/png')
  } catch (e) {
    toast('Render-Fehler: ' + (e?.message || 'unbekannt'), 'error')
  }
}

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
  `
  document.head.appendChild(s)
}

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
    <div class="image-slot" style="margin-top:14px;"></div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:16px;">
      <button class="btn-approve">✓ Approven & jetzt posten</button>
      <button class="btn-reject">✕ Verwerfen</button>
    </div>
  `

  const imgSlot = card.querySelector('.image-slot')
  if (item.image_url) {
    const wrap = document.createElement('div')
    wrap.style.cssText = 'display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap;'
    const img = document.createElement('img')
    img.src = item.image_url
    wrap.appendChild(img)
    const reRender = document.createElement('button')
    reRender.className = 'btn-secondary'
    reRender.innerHTML = '🔁 Bild neu rendern'
    reRender.addEventListener('click', () => handleRenderImage(item, refresh))
    wrap.appendChild(reRender)
    imgSlot.appendChild(wrap)
  } else {
    const renderBtn = document.createElement('button')
    renderBtn.className = 'btn-secondary'
    renderBtn.innerHTML = '🎨 Bild rendern'
    renderBtn.addEventListener('click', () => handleRenderImage(item, refresh))
    imgSlot.appendChild(renderBtn)
  }

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
      if (error) toast('Publish-Fehler: ' + error.message, 'error')
      else toast('Erfolgreich gepostet ✓', 'success')
    } catch (e) {
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
  const thumbHtml = item.image_url
    ? `<img src="${htmlEscape(item.image_url)}" alt="">`
    : '📷'
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
            ${item.image_url ? `<img src="${htmlEscape(item.image_url)}" style="width:100%;border-radius:14px;margin-bottom:14px;">` : ''}
            <div style="color:#fff;font-size:14px;line-height:1.55;white-space:pre-wrap;margin-bottom:14px;">${htmlEscape(item.caption || '')}</div>
            <div style="color:#888;font-size:12.5px;">${htmlEscape(item.posted_at ? fmtDateTime(item.posted_at) : '—')}</div>
            ${insightsText ? `<div style="margin-top:14px;padding:14px;background:rgba(139,92,246,.08);border-radius:12px;color:#C4B5FD;font-size:14px;">${htmlEscape(insightsText)}</div>` : ''}
          </div>
        `,
      })
    } catch {}
  })
  return row
}

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

      // Sofort Skeleton zeigen, damit kein weißer Screen entsteht
      renderSkeleton()

      let posted = []

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

          // Hero
          body.appendChild(buildHero(stats))

          // Charts grid (2 cols)
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

          // Queue section
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
          body.appendChild(queueSection)

          // History section
          const histSection = document.createElement('div')
          histSection.className = 'glass-card'
          const histHead = document.createElement('h3')
          histHead.className = 'insta-section-title'
          histHead.innerHTML = `📚 Verlauf <span class="count-badge">${posted.length}</span>`
          histSection.appendChild(histHead)

          if (posted.length === 0) {
            const empty = document.createElement('div')
            empty.className = 'empty-state'
            empty.innerHTML = `
              <div class="empty-icon">📭</div>
              <div class="empty-title">Noch keine Veröffentlichungen</div>
              <div class="empty-sub">Sobald Posts live gehen, erscheinen sie hier mit Insights.</div>
            `
            histSection.appendChild(empty)
          } else {
            const list = document.createElement('div')
            posted.slice(0, 20).forEach(it => list.appendChild(renderHistoryRow(it)))
            histSection.appendChild(list)
          }
          body.appendChild(histSection)

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

      // Daten im Hintergrund laden (Skeleton ist schon sichtbar)
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
