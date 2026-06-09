import { sb } from '/lib/supabase.js?v=20260608p'
import { toast, modal, confirmDialog, fmtNumber, fmtDateTime, fmtRelativeTime, htmlEscape, iconHtml, spinnerHtml } from '/lib/ui.js?v=20260608p'
import { exportPanelAsPdf, exportCsv } from '/lib/export.js?v=20260608p'
import { countUp, fadeIn, skeletonLoader } from '/lib/animations.js?v=20260608p'
import { drawer } from '/lib/layout-extras.js?v=20260608p'

// ---------------------------------------------------------------------------
// Data fetchers
// ---------------------------------------------------------------------------

async function fetchAudienceCount() {
  try {
    // users.accepts_marketing may not exist — fall back to total verified users if column missing
    const { count, error } = await sb
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('is_verified', true)
    if (error) throw error
    return count ?? 0
  } catch (e) {
    console.error('[newsletter] fetchAudienceCount error:', e)
    return 0
  }
}

async function fetchLastBroadcast() {
  try {
    const { data, error } = await sb
      .from('email_broadcasts')
      .select('id, subject, sent_at, delivered_count, opened_count, clicked_count')
      .order('sent_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw error
    return data || null
  } catch (e) {
    console.error('[newsletter] fetchLastBroadcast error:', e)
    return null
  }
}

async function fetchBroadcastHistory(limit = 10) {
  try {
    const { data, error } = await sb
      .from('email_broadcasts')
      .select('id, subject, sent_at, delivered_count, opened_count, clicked_count, audience')
      .order('sent_at', { ascending: false })
      .limit(limit)
    if (error) throw error
    return data || []
  } catch (e) {
    console.error('[newsletter] fetchBroadcastHistory error:', e)
    return []
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function openRate(delivered, opened) {
  if (!delivered || delivered === 0) return 0
  return Math.round((opened / delivered) * 100)
}

function clickRate(delivered, clicked) {
  if (!delivered || delivered === 0) return 0
  return Math.round((clicked / delivered) * 100)
}

function rateBar(value, color) {
  const pct = Math.min(100, value)
  return `<div class="rate-track"><div class="rate-fill" style="width:${pct}%;background:${color}"></div></div>`
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

function styles() {
  return `<style>
    .nl-panel { display:flex; flex-direction:column; gap:20px; padding:20px 24px 40px; }
    .panel-head { display:flex; justify-content:space-between; align-items:center; gap:16px; flex-wrap:wrap; }
    .panel-head h2 { margin:0; font-size:22px; font-weight:700; letter-spacing:-0.02em; display:flex; align-items:center; gap:10px; }
    .panel-head .sub { margin:4px 0 0; font-size:13px; color:var(--text-muted,#8a8a93); }
    .toolbar { display:flex; gap:8px; flex-wrap:wrap; }

    .hero-row { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:14px; }

    /* hero cards */
    .hero-card { background:linear-gradient(140deg,rgba(255,255,255,0.04),rgba(255,255,255,0.01)); border:1px solid rgba(255,255,255,0.07); border-radius:18px; padding:20px; position:relative; overflow:hidden; }
    .hero-card::before { content:''; position:absolute; top:0; left:0; right:0; height:3px; background:var(--hc-accent,#7c5cff); }
    .hero-card .hc-label { font-size:12px; text-transform:uppercase; letter-spacing:0.05em; color:var(--text-muted,#8a8a93); margin-bottom:10px; }
    .hero-card .hc-value { font-size:36px; font-weight:700; letter-spacing:-0.03em; line-height:1.1; margin-bottom:8px; font-variant-numeric:tabular-nums; }
    .hero-card .hc-sub { font-size:12px; color:var(--text-muted,#8a8a93); line-height:1.4; }
    .hero-card .hc-sub strong { color:var(--text,#fff); }

    /* compose modal form */
    .nl-form { display:flex; flex-direction:column; gap:18px; padding:4px 0; }
    .nl-form .form-row { display:flex; flex-direction:column; gap:6px; }
    .nl-form .form-label { font-size:13px; font-weight:500; color:var(--text-secondary,#c0c0c8); }
    .nl-form .input { background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.1); color:var(--text,#fff); border-radius:10px; padding:11px 14px; font-size:14px; font-family:inherit; transition:border-color .15s; width:100%; box-sizing:border-box; }
    .nl-form .input:focus { outline:none; border-color:#7c5cff; }
    .nl-form textarea.input { resize:vertical; min-height:160px; line-height:1.5; }
    .nl-form .input-hint { font-size:12px; color:var(--text-muted,#8a8a93); margin-top:2px; }
    .nl-form .test-row { display:flex; gap:8px; align-items:flex-start; }
    .nl-form .test-row .input { flex:1; }
    .nl-form .form-actions { display:flex; gap:10px; justify-content:flex-end; padding-top:8px; border-top:1px solid rgba(255,255,255,0.06); margin-top:4px; }

    /* buttons */
    .btn { display:inline-flex; align-items:center; gap:6px; border-radius:10px; padding:9px 16px; font-size:14px; font-weight:500; cursor:pointer; border:1px solid transparent; transition:all .15s; font-family:inherit; }
    .btn:disabled { opacity:0.45; cursor:not-allowed; }
    .btn-ghost { background:transparent; border-color:rgba(255,255,255,0.1); color:var(--text,#fff); }
    .btn-ghost:hover:not(:disabled) { background:rgba(255,255,255,0.05); }
    .btn-primary { background:linear-gradient(135deg,#7c5cff,#5b3eff); color:#fff; box-shadow:0 4px 14px rgba(124,92,255,.3); }
    .btn-primary:hover:not(:disabled) { transform:translateY(-1px); box-shadow:0 6px 20px rgba(124,92,255,.45); }
    .btn-danger { background:linear-gradient(135deg,#ef4444,#c0392b); color:#fff; }
    .btn-danger:hover:not(:disabled) { transform:translateY(-1px); }

    /* history table */
    .glass-card { background:linear-gradient(140deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01)); border:1px solid rgba(255,255,255,0.07); border-radius:16px; padding:20px; }
    .glass-card .card-head { display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; }
    .glass-card .card-head h3 { margin:0; font-size:15px; font-weight:600; display:flex; align-items:center; gap:8px; }
    .table-wrap { overflow-x:auto; }
    .data-table { width:100%; border-collapse:collapse; font-size:13px; }
    .data-table th { text-align:left; font-weight:500; color:var(--text-muted,#8a8a93); padding:10px 12px; border-bottom:1px solid rgba(255,255,255,0.07); font-size:12px; text-transform:uppercase; letter-spacing:0.04em; }
    .data-table td { padding:12px; border-bottom:1px solid rgba(255,255,255,0.04); vertical-align:middle; }
    .data-table .num { text-align:right; font-variant-numeric:tabular-nums; }
    .data-table tbody tr { transition:background .12s; cursor:pointer; }
    .data-table tbody tr:hover { background:rgba(255,255,255,0.03); }
    .cell-title { font-weight:500; color:#fff; margin-bottom:2px; max-width:320px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .cell-sub { font-size:12px; color:var(--text-muted,#8a8a93); }

    .rate-track { height:4px; background:rgba(255,255,255,0.07); border-radius:4px; overflow:hidden; margin-bottom:3px; }
    .rate-fill { height:100%; border-radius:4px; transition:width .4s; }

    .chip { display:inline-block; padding:3px 10px; border-radius:999px; font-size:11px; font-weight:500; background:rgba(255,255,255,0.06); color:var(--text-secondary,#c0c0c8); }

    .empty-state { text-align:center; padding:48px 20px; }
    .empty-icon { font-size:36px; opacity:0.35; margin-bottom:12px; }
    .empty-title { font-size:15px; font-weight:500; color:#fff; margin-bottom:4px; }
    .empty-sub { font-size:13px; color:var(--text-muted,#8a8a93); }

    .muted { color:var(--text-muted,#8a8a93); }
  </style>`
}

// ---------------------------------------------------------------------------
// Hero cards
// ---------------------------------------------------------------------------

function renderHero(audienceCount, lastBroadcast) {
  const deliveredCount = lastBroadcast?.delivered_count ?? 0
  const openedCount = lastBroadcast?.opened_count ?? 0
  const rate = openRate(deliveredCount, openedCount)

  const lastBroadcastHtml = lastBroadcast
    ? `<strong>${htmlEscape(lastBroadcast.subject || '(kein Betreff)')}</strong><br>${fmtDateTime(lastBroadcast.sent_at)}`
    : 'Noch kein Broadcast versendet'

  const openRateHtml = lastBroadcast
    ? `<strong>${rate}%</strong> · ${fmtNumber(openedCount)} von ${fmtNumber(deliveredCount)} geöffnet`
    : '—'

  // Use the real rate value as initial text so no misleading "0%" if countUp fails
  const openRateInitial = lastBroadcast ? `${rate}%` : '—'

  return `
    <div class="hero-row">
      <div class="hero-card" style="--hc-accent:#7c5cff">
        <div class="hc-label">${iconHtml('users')} Aktive Audience</div>
        <div class="hc-value" id="hero-audience">0</div>
        <div class="hc-sub">Verifizierte Nutzer · <em>accepts_marketing</em> wird aktuell nicht gefiltert</div>
      </div>
      <div class="hero-card" style="--hc-accent:#0a84ff">
        <div class="hc-label">${iconHtml('mail')} Letzter Broadcast</div>
        <div class="hc-value" style="font-size:14px;line-height:1.4;padding-top:4px">${lastBroadcastHtml}</div>
      </div>
      <div class="hero-card" style="--hc-accent:#fbbf24">
        <div class="hc-label">${iconHtml('eye')} Open-Rate (letzter)</div>
        <div class="hc-value" id="hero-open-rate" style="font-size:28px">${openRateInitial}</div>
        <div class="hc-sub">${openRateHtml}</div>
      </div>
    </div>
  `
}

// ---------------------------------------------------------------------------
// History table
// ---------------------------------------------------------------------------

function historyRow(b) {
  const delivered = b.delivered_count || 0
  const opened = b.opened_count || 0
  const clicked = b.clicked_count || 0
  const or = openRate(delivered, opened)
  const cr = clickRate(delivered, clicked)

  return `
    <tr data-id="${b.id}">
      <td>
        <div class="cell-title">${htmlEscape(b.subject || '(kein Betreff)')}</div>
        <div class="cell-sub">${b.audience ? htmlEscape(b.audience) : ''}</div>
      </td>
      <td class="muted">${b.sent_at ? fmtRelativeTime(b.sent_at) : '—'}</td>
      <td class="num">${fmtNumber(delivered)}</td>
      <td class="num">
        ${rateBar(or, '#0a84ff')}
        <span>${fmtNumber(opened)} · ${or}%</span>
      </td>
      <td class="num">
        ${rateBar(cr, '#bf5af2')}
        <span>${fmtNumber(clicked)} · ${cr}%</span>
      </td>
    </tr>
  `
}

function renderHistory(history) {
  if (!history.length) {
    return `
      <div class="glass-card">
        <div class="card-head"><h3>${iconHtml('inbox')} Broadcast-Verlauf</h3></div>
        <div class="empty-state">
          <div class="empty-icon">${iconHtml('mail')}</div>
          <div class="empty-title">Noch keine Broadcasts versendet</div>
          <div class="empty-sub">Sende deinen ersten Newsletter über den Button oben rechts.</div>
        </div>
      </div>
    `
  }

  return `
    <div class="glass-card">
      <div class="card-head">
        <h3>${iconHtml('inbox')} Broadcast-Verlauf — letzte ${history.length}</h3>
        <span class="muted" style="font-size:12px">${history.length} Einträge</span>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Betreff</th>
              <th>Versendet</th>
              <th class="num">Zugestellt</th>
              <th class="num">Öffnungen</th>
              <th class="num">Klicks</th>
            </tr>
          </thead>
          <tbody>${history.map(historyRow).join('')}</tbody>
        </table>
      </div>
    </div>
  `
}

// ---------------------------------------------------------------------------
// Test-Newsletter Modal
// ---------------------------------------------------------------------------

function openTestModal(audienceCount, onAfterSend) {
  const html = `
    <form id="nlTestForm" class="nl-form">
      <div class="form-row">
        <label class="form-label">Betreff *</label>
        <input type="text" name="subject" class="input" required placeholder="z. B. Wochenrückblick KW 23" autocomplete="off"/>
      </div>
      <div class="form-row">
        <label class="form-label">HTML-Inhalt *</label>
        <textarea name="html_content" class="input" required placeholder="&lt;h1&gt;Hallo {{name}}&lt;/h1&gt;&lt;p&gt;Dein Newsletter-Text…&lt;/p&gt;"></textarea>
        <div class="input-hint">Variablen: <code>{{name}}</code>, <code>{{email}}</code></div>
      </div>
      <div class="form-row">
        <label class="form-label">Test-E-Mail-Adresse *</label>
        <div class="test-row">
          <input type="email" name="test_to" class="input" required placeholder="test@diepodfluencer.com"/>
          <button type="submit" class="btn btn-primary" id="btnSendTest">
            ${iconHtml('send')} Test senden
          </button>
        </div>
      </div>
    </form>
  `

  const m = modal({ title: 'Test-Newsletter senden', content: html, width: 640 })
  const root = m?.root || document

  root.querySelector('#nlTestForm')?.addEventListener('submit', async (ev) => {
    ev.preventDefault()
    const fd = new FormData(ev.target)
    const subject = fd.get('subject')?.trim()
    const html_content = fd.get('html_content')?.trim()
    const test_to = fd.get('test_to')?.trim()

    if (!subject || !html_content || !test_to) {
      toast('Alle Felder ausfüllen', 'warn'); return
    }

    const btn = root.querySelector('#btnSendTest')
    btn.disabled = true
    btn.innerHTML = spinnerHtml() + ' Sende…'

    try {
      const { error } = await sb.functions.invoke('newsletter-broadcast', {
        body: { subject, html_content, test_to, audience: 'test' }
      })
      if (error) throw error
      toast(`Test-Newsletter an ${test_to} versendet`, 'success')
      m?.close?.()
      onAfterSend?.()
    } catch (e) {
      console.error('[newsletter] openTestModal send error:', e)
      toast('Fehler: ' + (e.message || String(e)), 'error')
      btn.disabled = false
      btn.innerHTML = iconHtml('send') + ' Test senden'
    }
  })
}

// ---------------------------------------------------------------------------
// Live-Newsletter Modal
// ---------------------------------------------------------------------------

function openLiveModal(audienceCount, onAfterSend) {
  const html = `
    <form id="nlLiveForm" class="nl-form">
      <div class="form-row">
        <label class="form-label">Betreff *</label>
        <input type="text" name="subject" class="input" required placeholder="z. B. Wochenrückblick KW 23" autocomplete="off"/>
      </div>
      <div class="form-row">
        <label class="form-label">HTML-Inhalt *</label>
        <textarea name="html_content" class="input" required placeholder="&lt;h1&gt;Hallo {{name}}&lt;/h1&gt;&lt;p&gt;Dein Newsletter-Text…&lt;/p&gt;"></textarea>
        <div class="input-hint">Variablen: <code>{{name}}</code>, <code>{{email}}</code></div>
      </div>
      <div class="audience-notice" style="background:rgba(124,92,255,0.08);border:1px solid rgba(124,92,255,0.2);border-radius:12px;padding:14px 16px;display:flex;gap:12px;align-items:center">
        ${iconHtml('users')}
        <div>
          <div style="font-weight:600;font-size:14px">${fmtNumber(audienceCount)} Empfänger</div>
          <div style="font-size:12px;color:var(--text-muted,#8a8a93)">Alle verifizierten Nutzer (Newsletter-Audience)</div>
        </div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" data-modal-close>Abbrechen</button>
        <button type="submit" class="btn btn-primary" id="btnSendLive">
          ${iconHtml('send')} An ${fmtNumber(audienceCount)} senden
        </button>
      </div>
    </form>
  `

  const m = modal({ title: 'Live-Newsletter senden', content: html, width: 640 })
  const root = m?.root || document

  root.querySelector('#nlLiveForm')?.addEventListener('submit', async (ev) => {
    ev.preventDefault()
    const fd = new FormData(ev.target)
    const subject = fd.get('subject')?.trim()
    const html_content = fd.get('html_content')?.trim()

    if (!subject || !html_content) {
      toast('Betreff und HTML-Inhalt ausfüllen', 'warn'); return
    }

    const confirmed = await confirmDialog(
      'Newsletter wirklich senden?',
      `Wird an ${fmtNumber(audienceCount)} Empfänger zugestellt. Diese Aktion lässt sich nicht rückgängig machen.`,
      'Jetzt senden',
      false
    )
    if (!confirmed) return

    const btn = root.querySelector('#btnSendLive')
    btn.disabled = true
    btn.innerHTML = spinnerHtml() + ' Wird versendet…'

    try {
      const { error } = await sb.functions.invoke('newsletter-broadcast', {
        body: { subject, html_content, audience: 'all' }
      })
      if (error) throw error
      toast(`Newsletter an ${fmtNumber(audienceCount)} Empfänger gestartet`, 'success')
      m?.close?.()
      onAfterSend?.()
    } catch (e) {
      console.error('[newsletter] openLiveModal send error:', e)
      toast('Fehler: ' + (e.message || String(e)), 'error')
      btn.disabled = false
      btn.innerHTML = iconHtml('send') + ` An ${fmtNumber(audienceCount)} senden`
    }
  })
}

// ---------------------------------------------------------------------------
// Detail drawer (click on history row)
// ---------------------------------------------------------------------------

function openBroadcastDetail(b) {
  const delivered = b.delivered_count || 0
  const opened = b.opened_count || 0
  const clicked = b.clicked_count || 0
  const or = openRate(delivered, opened)
  const cr = clickRate(delivered, clicked)

  drawer({
    title: htmlEscape(b.subject || 'Broadcast-Details'),
    width: 480,
    content: `
      <div style="display:flex;flex-direction:column;gap:18px;">
        <div>
          <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-muted,#8a8a93);margin-bottom:4px">Betreff</div>
          <div style="font-size:16px;font-weight:600;">${htmlEscape(b.subject || '(kein Betreff)')}</div>
        </div>
        ${b.audience ? `<div>
          <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-muted,#8a8a93);margin-bottom:4px">Zielgruppe</div>
          <span class="chip">${htmlEscape(b.audience)}</span>
        </div>` : ''}
        <div>
          <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-muted,#8a8a93);margin-bottom:4px">Versendet am</div>
          <div>${b.sent_at ? fmtDateTime(b.sent_at) : '—'}</div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;">
          <div style="background:rgba(255,255,255,0.04);border-radius:12px;padding:14px;text-align:center;">
            <div style="font-size:11px;color:var(--text-muted,#8a8a93);text-transform:uppercase;letter-spacing:0.05em;">Zugestellt</div>
            <div style="font-size:22px;font-weight:600;margin-top:4px;">${fmtNumber(delivered)}</div>
          </div>
          <div style="background:rgba(255,255,255,0.04);border-radius:12px;padding:14px;text-align:center;">
            <div style="font-size:11px;color:var(--text-muted,#8a8a93);text-transform:uppercase;letter-spacing:0.05em;">Geöffnet</div>
            <div style="font-size:22px;font-weight:600;color:#0a84ff;margin-top:4px;">${fmtNumber(opened)}</div>
          </div>
          <div style="background:rgba(255,255,255,0.04);border-radius:12px;padding:14px;text-align:center;">
            <div style="font-size:11px;color:var(--text-muted,#8a8a93);text-transform:uppercase;letter-spacing:0.05em;">Geklickt</div>
            <div style="font-size:22px;font-weight:600;color:#bf5af2;margin-top:4px;">${fmtNumber(clicked)}</div>
          </div>
        </div>
        <div>
          <div style="font-size:13px;font-weight:500;margin-bottom:8px;">Open-Rate: <strong style="color:#0a84ff">${or}%</strong></div>
          ${rateBar(or, '#0a84ff')}
        </div>
        <div>
          <div style="font-size:13px;font-weight:500;margin-bottom:8px;">Click-Rate: <strong style="color:#bf5af2">${cr}%</strong></div>
          ${rateBar(cr, '#bf5af2')}
        </div>
      </div>
    `
  })
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export default {
  id: 'newsletter-audience-sync',
  title: 'Newsletter-Audience',
  category: 'marketing',

  async mount(container) {
    try {
      container.innerHTML = `${styles()}
        <div class="nl-panel">
          <div class="panel-head">
            <div>
              <h2>${iconHtml('mail')} Newsletter-Audience</h2>
              <p class="sub">Audience-Übersicht, Broadcast-Versand und Performance</p>
            </div>
            <div class="toolbar">
              <button class="btn btn-ghost" id="btnRefresh">${iconHtml('refresh-cw')} Aktualisieren</button>
              <button class="btn btn-ghost" id="btnPdf">${iconHtml('file-text')} PDF</button>
              <button class="btn btn-ghost" id="btnCsv">${iconHtml('download')} CSV</button>
              <button class="btn btn-ghost" id="btnTest">${iconHtml('send')} Test-Newsletter</button>
              <button class="btn btn-primary" id="btnLive">${iconHtml('zap')} Live-Newsletter</button>
            </div>
          </div>
          <div id="body"></div>
        </div>
      `

      try { fadeIn(container) } catch {}

      const body = container.querySelector('#body')

      const renderLoading = () => {
        try {
          body.innerHTML = ''
          // skeletonLoader(width, height) returns a DOM element — must appendChild
          const sk = skeletonLoader('100%', 360)
          body.appendChild(sk)
        } catch {
          body.innerHTML = `<div class="muted" style="padding:40px;text-align:center">Lade Daten…</div>`
        }
      }

      let currentAudienceCount = 0
      let currentHistory = []

      const load = async () => {
        renderLoading()
        try {
          const [audienceCount, lastBroadcast, history] = await Promise.all([
            fetchAudienceCount(),
            fetchLastBroadcast(),
            fetchBroadcastHistory(10)
          ])

          currentAudienceCount = audienceCount
          currentHistory = history

          body.innerHTML = `
            ${renderHero(audienceCount, lastBroadcast)}
            ${renderHistory(history)}
          `

          // Animate hero values
          const heroAudience = body.querySelector('#hero-audience')
          if (heroAudience) {
            try { countUp(heroAudience, 0, audienceCount, 700) }
            catch { heroAudience.textContent = fmtNumber(audienceCount) }
          }

          // Only animate open-rate if lastBroadcast exists (initial value already set to real rate)
          const heroOpenRate = body.querySelector('#hero-open-rate')
          if (heroOpenRate && lastBroadcast) {
            const rate = openRate(lastBroadcast.delivered_count || 0, lastBroadcast.opened_count || 0)
            try {
              countUp(heroOpenRate, 0, rate, 700, (n) => Math.round(n) + '%')
            } catch {
              heroOpenRate.textContent = rate + '%'
            }
          }

          // Wire history row clicks
          body.querySelectorAll('.data-table tbody tr[data-id]').forEach(tr => {
            tr.onclick = () => {
              const id = tr.dataset.id
              const b = currentHistory.find(x => String(x.id) === String(id))
              if (b) openBroadcastDetail(b)
            }
          })

        } catch (e) {
          console.error('[newsletter] load error:', e)
          body.innerHTML = `
            <div class="glass-card" style="text-align:center;padding:48px 24px;border-color:rgba(255,107,107,0.2)">
              <div style="font-size:32px;opacity:0.5;margin-bottom:12px">${iconHtml('alert-triangle')}</div>
              <div style="font-size:15px;font-weight:500;margin-bottom:6px">Daten konnten nicht geladen werden</div>
              <div class="muted" style="margin-bottom:16px">${htmlEscape(e?.message || 'Unbekannter Fehler')}</div>
              <button class="btn btn-primary" id="btnRetry">Erneut versuchen</button>
            </div>
          `
          body.querySelector('#btnRetry')?.addEventListener('click', load)
        }
      }

      // Toolbar buttons
      container.querySelector('#btnRefresh').addEventListener('click', () => {
        load()
        toast('Daten werden aktualisiert…', 'info')
      })

      container.querySelector('#btnTest').addEventListener('click', () => {
        openTestModal(currentAudienceCount, load)
      })

      container.querySelector('#btnLive').addEventListener('click', () => {
        openLiveModal(currentAudienceCount, load)
      })

      container.querySelector('#btnPdf').addEventListener('click', () => {
        try { exportPanelAsPdf(container, { filename: 'newsletter-audience.pdf', title: 'Newsletter-Audience' }) }
        catch (e) { toast('PDF-Export fehlgeschlagen: ' + (e.message || e), 'error') }
      })

      container.querySelector('#btnCsv').addEventListener('click', async () => {
        const rows = await fetchBroadcastHistory(200)
        if (!rows.length) { toast('Keine Daten zum Exportieren', 'warn'); return }
        try {
          exportCsv('newsletter-broadcasts.csv', rows.map(b => ({
            id: b.id,
            subject: b.subject || '',
            sent_at: b.sent_at || '',
            audience: b.audience || '',
            delivered_count: b.delivered_count || 0,
            opened_count: b.opened_count || 0,
            clicked_count: b.clicked_count || 0,
            open_rate_pct: openRate(b.delivered_count || 0, b.opened_count || 0),
            click_rate_pct: clickRate(b.delivered_count || 0, b.clicked_count || 0)
          })))
        } catch (e) { toast('CSV-Export fehlgeschlagen: ' + (e.message || e), 'error') }
      })

      await load()

    } catch (e) {
      try {
        container.innerHTML = `
          <div style="padding:24px;">
            <div class="glass-card" style="padding:20px;border:1px solid rgba(255,107,107,0.3)">
              <h3 style="margin:0 0 8px;color:#ff6b6b">Panel konnte nicht geladen werden</h3>
              <div style="color:#c0c0c8;font-size:13px;margin-bottom:12px">${htmlEscape(e?.message || 'Unbekannter Fehler')}</div>
              <button class="btn btn-ghost" id="mountRetry">Erneut versuchen</button>
            </div>
          </div>
        `
        container.querySelector('#mountRetry')?.addEventListener('click', () => this.mount(container))
      } catch {}
    }
  }
}
