import { sb } from '/lib/supabase.js'

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatDate(d) {
  if (!d) return '—'
  try {
    const dt = new Date(d)
    return dt.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch {
    return String(d)
  }
}

function showToast(msg) {
  let t = document.querySelector('.toast')
  if (!t) {
    t = document.createElement('div')
    t.className = 'toast'
    t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#16161D;color:#fff;border:1px solid #2A2A33;padding:12px 18px;border-radius:12px;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,.4);'
    document.body.appendChild(t)
  }
  t.textContent = msg
  t.style.opacity = '1'
  clearTimeout(t._timer)
  t._timer = setTimeout(() => { t.style.transition = 'opacity .4s'; t.style.opacity = '0' }, 2600)
}

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

  // Gradient background
  const grad = ctx.createLinearGradient(0, 0, 1080, 1080)
  grad.addColorStop(0, accent)
  grad.addColorStop(1, '#0B0B0F')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, 1080, 1080)

  // Logo top-left "hozd"
  ctx.fillStyle = '#FFFFFF'
  ctx.font = 'bold 64px -apple-system, system-ui, sans-serif'
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'
  ctx.fillText('hozd', 60, 60)

  // Headline centered
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

  // Subtext
  ctx.font = '36px -apple-system, system-ui, sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.8)'
  const subtext = brief.subtext || ''
  const subLines = wrapText(ctx, subtext, 820)
  const subLineHeight = 46
  const subStartY = headlineStartY + headlineBlockHeight + 30
  subLines.forEach((line, i) => {
    ctx.fillText(line, 540, subStartY + i * subLineHeight)
  })

  // Cover image bottom-left
  if (brief.cover_image_url) {
    try {
      const img = await loadImage(brief.cover_image_url)
      ctx.save()
      roundRectClip(ctx, 60, 820, 200, 200, 20)
      ctx.clip()
      ctx.drawImage(img, 60, 820, 200, 200)
      ctx.restore()
    } catch (e) {
      // ignore cover load errors
    }
  }

  // CTA bottom centered
  ctx.font = '32px -apple-system, system-ui, sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.9)'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  ctx.fillText('Lade hozd 🎧 — hozd.app', 540, 1020)

  return canvas
}

async function handleRenderImage(item, refresh) {
  showToast('Bild wird gerendert…')
  try {
    const canvas = await renderImage(item)
    canvas.toBlob(async (blob) => {
      if (!blob) { showToast('Bild konnte nicht erzeugt werden'); return }
      const filename = item.id + '.png'
      const { error } = await sb.storage.from('insta-marketing').upload(filename, blob, { upsert: true, contentType: 'image/png' })
      if (error) { showToast('Upload failed: ' + error.message); return }
      const { data: pub } = sb.storage.from('insta-marketing').getPublicUrl(filename)
      await sb.from('insta_posts_queue').update({ image_url: pub.publicUrl }).eq('id', item.id)
      showToast('Bild gespeichert ✓')
      refresh()
    }, 'image/png')
  } catch (e) {
    showToast('Render-Fehler: ' + (e?.message || 'unbekannt'))
  }
}

function renderQueueCard(item, refresh) {
  const card = document.createElement('div')
  card.style.cssText = 'background:#16161D;border:1px solid #2A2A33;border-radius:12px;padding:16px;margin-bottom:16px;'

  const audience = escapeHtml(item.audience || '—')
  const postType = escapeHtml(item.post_type || '—')
  const slot = formatDate(item.slot_time)
  const caption = item.caption || ''
  const hashtags = Array.isArray(item.hashtags) ? item.hashtags.join(', ') : (item.hashtags || '')

  card.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap;">
      <span class="chip" style="background:#2A2A33;color:#fff;padding:4px 10px;border-radius:999px;font-size:12px;">${audience}</span>
      <span class="chip" style="background:#2A2A33;color:#fff;padding:4px 10px;border-radius:999px;font-size:12px;">${postType}</span>
      <span style="color:#aaa;font-size:13px;margin-left:auto;">Slot: ${escapeHtml(slot)}</span>
    </div>
    <label style="display:block;color:#ccc;font-size:12px;margin-bottom:4px;">Caption</label>
    <textarea class="cap-input" rows="4" style="width:100%;background:#0B0B0F;color:#fff;border:1px solid #2A2A33;border-radius:8px;padding:10px;font-family:inherit;font-size:14px;resize:vertical;margin-bottom:12px;">${escapeHtml(caption)}</textarea>
    <label style="display:block;color:#ccc;font-size:12px;margin-bottom:4px;">Hashtags (kommagetrennt)</label>
    <input class="hash-input" type="text" value="${escapeHtml(hashtags)}" style="width:100%;background:#0B0B0F;color:#fff;border:1px solid #2A2A33;border-radius:8px;padding:10px;font-family:inherit;font-size:14px;margin-bottom:12px;" />
    <div class="image-slot" style="margin-bottom:12px;"></div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;">
      <button class="approve-btn" style="flex:1;min-width:200px;background:#8B5CF6;color:#fff;border:none;border-radius:8px;padding:14px;font-size:15px;font-weight:600;cursor:pointer;">Approven & jetzt posten</button>
      <button class="reject-btn" style="flex:1;min-width:160px;background:#2A2A33;color:#fff;border:none;border-radius:8px;padding:14px;font-size:15px;font-weight:600;cursor:pointer;">Verwerfen</button>
    </div>
  `

  // Image slot
  const imgSlot = card.querySelector('.image-slot')
  if (item.image_url) {
    const img = document.createElement('img')
    img.src = item.image_url
    img.style.cssText = 'max-width:300px;border-radius:8px;display:block;'
    imgSlot.appendChild(img)
    const reRender = document.createElement('button')
    reRender.textContent = 'Bild neu rendern'
    reRender.style.cssText = 'margin-top:8px;background:#2A2A33;color:#fff;border:none;border-radius:8px;padding:8px 14px;font-size:13px;cursor:pointer;display:block;'
    reRender.addEventListener('click', () => handleRenderImage(item, refresh))
    imgSlot.appendChild(reRender)
  } else {
    const renderBtn = document.createElement('button')
    renderBtn.textContent = 'Bild rendern'
    renderBtn.style.cssText = 'background:#2A2A33;color:#fff;border:1px solid #2A2A33;border-radius:8px;padding:10px 16px;font-size:14px;cursor:pointer;'
    renderBtn.addEventListener('click', () => handleRenderImage(item, refresh))
    imgSlot.appendChild(renderBtn)
  }

  // Caption auto-save
  const capInput = card.querySelector('.cap-input')
  capInput.addEventListener('blur', async () => {
    if (capInput.value === caption) return
    const { error } = await sb.from('insta_posts_queue').update({ caption: capInput.value }).eq('id', item.id)
    if (error) showToast('Speichern fehlgeschlagen: ' + error.message)
    else showToast('Caption gespeichert')
  })

  // Hashtags auto-save
  const hashInput = card.querySelector('.hash-input')
  hashInput.addEventListener('blur', async () => {
    const arr = hashInput.value.split(',').map(s => s.trim()).filter(Boolean)
    const { error } = await sb.from('insta_posts_queue').update({ hashtags: arr }).eq('id', item.id)
    if (error) showToast('Hashtags-Fehler: ' + error.message)
    else showToast('Hashtags gespeichert')
  })

  // Approve & publish
  card.querySelector('.approve-btn').addEventListener('click', async () => {
    if (!confirm('Diesen Post jetzt LIVE auf Insta veröffentlichen?')) return
    await sb.from('insta_posts_queue').update({ status: 'approved' }).eq('id', item.id)
    const { error } = await sb.functions.invoke('insta-publish', { body: { queue_id: item.id } })
    if (error) showToast('Publish-Fehler: ' + error.message)
    else showToast('Erfolgreich gepostet ✓')
    refresh()
  })

  // Reject
  card.querySelector('.reject-btn').addEventListener('click', async () => {
    const { error } = await sb.from('insta_posts_queue').update({ status: 'rejected' }).eq('id', item.id)
    if (error) showToast('Fehler: ' + error.message)
    else showToast('Verworfen')
    refresh()
  })

  return card
}

function renderHistoryItem(item) {
  const wrap = document.createElement('div')
  wrap.style.cssText = 'background:#16161D;border:1px solid #2A2A33;border-radius:12px;padding:12px;margin-bottom:10px;'
  const caption = (item.caption || '').slice(0, 100) + ((item.caption || '').length > 100 ? '…' : '')
  let insightsText = ''
  if (item.insights) {
    try {
      const ins = typeof item.insights === 'string' ? JSON.parse(item.insights) : item.insights
      const parts = []
      if (ins.likes != null) parts.push('❤ ' + ins.likes)
      if (ins.comments != null) parts.push('💬 ' + ins.comments)
      if (ins.reach != null) parts.push('👁 ' + ins.reach)
      insightsText = parts.join(' · ')
    } catch {}
  }
  wrap.innerHTML = `
    <div style="color:#fff;font-size:14px;margin-bottom:6px;">${escapeHtml(caption)}</div>
    <div style="color:#888;font-size:12px;display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;">
      <span>${escapeHtml(formatDate(item.posted_at))}</span>
      <span style="color:#8B5CF6;">${escapeHtml(insightsText)}</span>
    </div>
  `
  return wrap
}

export default {
  id: 'insta-approval-queue',
  title: 'Instagram-Posts Freigabe',
  category: 'marketing',
  summary: 'Generierte IG-Marketing-Posts zur Freigabe oder Ablehnung.',
  async mount(container) {
    container.innerHTML = `<div class="panel-shell">
      <div class="panel-head" style="display:flex;align-items:center;gap:10px;">
        <h2 style="flex:1;margin:0;">Instagram-Posts Freigabe</h2>
        <button class="generate-btn" style="background:#8B5CF6;color:#fff;border:none;border-radius:8px;padding:8px 14px;font-size:13px;cursor:pointer;">Generator starten</button>
        <button class="refresh-btn" style="background:#2A2A33;color:#fff;border:1px solid #2A2A33;border-radius:8px;padding:8px 14px;font-size:13px;cursor:pointer;">Aktualisieren</button>
      </div>
      <div class="panel-body"><div class="loading">Lädt…</div></div>
    </div>`
    const body = container.querySelector('.panel-body')

    const refresh = async () => {
      body.innerHTML = '<div class="loading">Lädt…</div>'
      try {
        const { data: queueItems, error: qErr } = await sb
          .from('insta_posts_queue')
          .select('*')
          .in('status', ['ready', 'draft'])
          .order('slot_time', { ascending: true })
        if (qErr) throw qErr

        const { data: postedItems, error: pErr } = await sb
          .from('insta_posts_queue')
          .select('*')
          .eq('status', 'posted')
          .order('posted_at', { ascending: false })
          .limit(5)
        if (pErr) throw pErr

        body.innerHTML = ''

        // Queue section
        const queueSection = document.createElement('div')
        queueSection.style.marginBottom = '24px'
        const queueTitle = document.createElement('h3')
        queueTitle.textContent = 'Warteschlange (' + (queueItems?.length || 0) + ')'
        queueTitle.style.cssText = 'color:#fff;font-size:16px;margin:0 0 12px 0;'
        queueSection.appendChild(queueTitle)

        if (!queueItems || queueItems.length === 0) {
          const empty = document.createElement('div')
          empty.className = 'empty'
          empty.textContent = 'Keine Posts in der Warteschlange.'
          empty.style.cssText = 'color:#888;padding:20px;text-align:center;background:#16161D;border:1px dashed #2A2A33;border-radius:12px;'
          queueSection.appendChild(empty)
        } else {
          for (const item of queueItems) {
            queueSection.appendChild(renderQueueCard(item, refresh))
          }
        }
        body.appendChild(queueSection)

        // History section
        const histSection = document.createElement('div')
        const histTitle = document.createElement('h3')
        histTitle.textContent = 'Letzte gepostet'
        histTitle.style.cssText = 'color:#fff;font-size:16px;margin:0 0 12px 0;'
        histSection.appendChild(histTitle)

        if (!postedItems || postedItems.length === 0) {
          const empty = document.createElement('div')
          empty.className = 'empty'
          empty.textContent = 'Noch keine veröffentlichten Posts.'
          empty.style.cssText = 'color:#888;padding:16px;text-align:center;background:#16161D;border:1px dashed #2A2A33;border-radius:12px;'
          histSection.appendChild(empty)
        } else {
          for (const item of postedItems) {
            histSection.appendChild(renderHistoryItem(item))
          }
        }
        body.appendChild(histSection)
      } catch (e) {
        body.innerHTML = '<div class="empty">Daten kommen bald: ' + escapeHtml(e?.message || 'unbekannt') + '</div>'
      }
    }

    container.querySelector('.refresh-btn').addEventListener('click', refresh)
    container.querySelector('.generate-btn').addEventListener('click', async () => {
      showToast('Generator startet…')
      try {
        const { error } = await sb.functions.invoke('insta-marketing-generator', { body: {} })
        if (error) showToast('Generator-Fehler: ' + error.message)
        else showToast('Generator fertig ✓')
      } catch (e) {
        showToast('Generator-Fehler: ' + (e?.message || 'unbekannt'))
      }
      refresh()
    })

    await refresh()
  }
}
