import { sb } from '/lib/supabase.js'
import { toast, modal, confirmDialog, fmtNumber, fmtDateTime, fmtRelativeTime, htmlEscape, iconHtml } from '/lib/ui.js'
import { makeAreaChart, makeDonutChart } from '/lib/charts.js'
import { exportPanelAsPdf, exportCsv } from '/lib/export.js'
import { countUp, fadeIn, skeletonLoader } from '/lib/animations.js'
import { drawer, glassCard } from '/lib/layout-extras.js'

const AUDIENCES = [
  { id: 'all', label: 'Alle Abonnenten', desc: 'Komplette aktive Liste' },
  { id: 'verified', label: 'Verifizierte Podfluencer', desc: 'Nur mit blauem Haken' },
  { id: 'premium', label: 'Premium-Mitglieder', desc: 'Aktive Premium-Subs' },
  { id: 'inactive', label: 'Re-Engagement', desc: '30+ Tage inaktiv' },
  { id: 'test', label: 'Test-Liste', desc: 'Nur interne Test-Adressen' }
]

async function fetchSyncStatus() {
  try {
    const { data, error } = await sb.rpc('newsletter_sync_status')
    if (error) throw error
    return data || null
  } catch { return null }
}

async function fetchAudienceCounts() {
  try {
    const { data } = await sb.rpc('newsletter_audience_counts')
    return data || null
  } catch { return null }
}

async function fetchBroadcasts(limit = 20) {
  try {
    const { data, error } = await sb
      .from('newsletter_broadcasts')
      .select('id, subject, sent_at, audience, recipients, opens, clicks, status')
      .order('sent_at', { ascending: false })
      .limit(limit)
    if (error) throw error
    return data || []
  } catch { return [] }
}

async function fetchSendTimeline() {
  try {
    const { data } = await sb.rpc('newsletter_send_timeline', { days: 30 })
    return data || []
  } catch { return [] }
}

async function triggerSync() {
  try {
    const { error } = await sb.rpc('newsletter_trigger_sync')
    if (error) throw error
    return true
  } catch (e) {
    toast(`Sync fehlgeschlagen: ${e.message || e}`, 'error')
    return false
  }
}

async function sendBroadcast(payload) {
  const { error } = await sb.rpc('newsletter_send_broadcast', payload)
  if (error) throw error
  return true
}

async function sendTestEmail(payload) {
  const { error } = await sb.rpc('newsletter_send_test', payload)
  if (error) throw error
  return true
}

function rateBar(label, value, total, color) {
  const pct = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0
  return `
    <div class="rate-row">
      <div class="rate-label"><span>${label}</span><span class="rate-val">${pct}% · ${fmtNumber(value)}</span></div>
      <div class="rate-track"><div class="rate-fill" style="width:${pct}%;background:${color}"></div></div>
    </div>
  `
}

function statusPill(status) {
  const map = {
    healthy: { c: '#34c759', t: 'Synchron' },
    syncing: { c: '#0a84ff', t: 'Sync läuft' },
    stale: { c: '#ff9f0a', t: 'Veraltet' },
    error: { c: '#ff453a', t: 'Fehler' },
    sent: { c: '#34c759', t: 'Versendet' },
    queued: { c: '#0a84ff', t: 'In Queue' },
    failed: { c: '#ff453a', t: 'Fehlgeschlagen' }
  }
  const m = map[status] || { c: '#8e8e93', t: status || 'Unbekannt' }
  return `<span class="status-pill" style="background:${m.c}20;color:${m.c};padding:2px 8px;border-radius:8px;font-size:12px;font-weight:600;display:inline-flex;gap:6px;align-items:center"><span style="width:6px;height:6px;border-radius:50%;background:${m.c}"></span>${m.t}</span>`
}

function openSendModal(onSent) {
  const html = `
    <form id="nlSendForm" class="nl-send-form">
      <div class="form-row">
        <label>Betreff</label>
        <input type="text" name="subject" required placeholder="z. B. Wochenrückblick · Podfluence" autocomplete="off"/>
      </div>
      <div class="form-row">
        <label>Zielgruppe</label>
        <div class="audience-grid">
          ${AUDIENCES.map((a, i) => `
            <label class="audience-tile">
              <input type="radio" name="audience" value="${a.id}" ${i === 0 ? 'checked' : ''}/>
              <div class="tile-inner">
                <div class="tile-title">${htmlEscape(a.label)}</div>
                <div class="tile-desc">${htmlEscape(a.desc)}</div>
              </div>
            </label>
          `).join('')}
        </div>
      </div>
      <div class="form-row">
        <label>HTML-Inhalt</label>
        <textarea name="html" rows="10" required placeholder="<h1>Hallo {{name}}</h1>..."></textarea>
        <div class="form-hint">Variablen: <code>{{name}}</code>, <code>{{email}}</code>, <code>{{unsubscribe_url}}</code></div>
      </div>
      <div class="form-row test-send">
        <label>Test-Versand</label>
        <div class="test-row">
          <input type="email" name="test_email" placeholder="test@diepodfluencer.com"/>
          <button type="button" class="btn btn-secondary" id="btnTestSend">Test senden</button>
        </div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" data-modal-close>Abbrechen</button>
        <button type="submit" class="btn btn-primary">Newsletter senden</button>
      </div>
    </form>
  `

  const m = modal({ title: 'Newsletter versenden', html, size: 'lg' })
  const root = m?.el || document
  const form = root.querySelector('#nlSendForm')
  const btnTest = root.querySelector('#btnTestSend')
  if (!form) return

  btnTest?.addEventListener('click', async () => {
    const fd = new FormData(form)
    const subject = fd.get('subject')
    const htmlVal = fd.get('html')
    const test_email = fd.get('test_email')
    if (!subject || !htmlVal || !test_email) {
      toast('Betreff, HTML und Test-E-Mail nötig', 'warn')
      return
    }
    btnTest.disabled = true
    btnTest.textContent = 'Sende…'
    try {
      await sendTestEmail({ subject, html: htmlVal, test_email })
      toast(`Test gesendet an ${test_email}`, 'success')
    } catch (e) {
      toast(`Test fehlgeschlagen: ${e.message || e}`, 'error')
    } finally {
      btnTest.disabled = false
      btnTest.textContent = 'Test senden'
    }
  })

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault()
    const fd = new FormData(form)
    const payload = {
      subject: fd.get('subject'),
      html: fd.get('html'),
      audience: fd.get('audience')
    }
    const aud = AUDIENCES.find(a => a.id === payload.audience)
    const ok = await confirmDialog({
      title: 'Newsletter wirklich senden?',
      message: `Empfänger: ${aud?.label}. Diese Aktion lässt sich nicht widerrufen.`,
      confirmText: 'Jetzt senden',
      tone: 'danger'
    })
    if (!ok) return
    const submitBtn = form.querySelector('button[type=submit]')
    submitBtn.disabled = true
    submitBtn.textContent = 'Wird gesendet…'
    try {
      await sendBroadcast(payload)
      toast('Newsletter wurde in die Queue gelegt', 'success')
      m?.close?.()
      onSent?.()
    } catch (e) {
      toast(`Fehler: ${e.message || e}`, 'error')
      submitBtn.disabled = false
      submitBtn.textContent = 'Newsletter senden'
    }
  })
}

function openBroadcastDrawer(b) {
  const recipients = b.recipients || 0
  const opens = b.opens || 0
  const clicks = b.clicks || 0
  const ctr = opens > 0 ? Math.round((clicks / opens) * 100) : 0
  drawer({
    title: htmlEscape(b.subject || 'Broadcast'),
    width: 540,
    html: `
      <div class="drawer-broadcast">
        <div class="drawer-meta">
          <div><span class="meta-k">Versendet</span><span class="meta-v">${b.sent_at ? fmtDateTime(b.sent_at) : '—'}</span></div>
          <div><span class="meta-k">Zielgruppe</span><span class="meta-v">${htmlEscape(b.audience || '—')}</span></div>
          <div><span class="meta-k">Status</span><span class="meta-v">${statusPill(b.status)}</span></div>
        </div>
        <div class="drawer-stats">
          <div class="ds-card"><div class="ds-num">${fmtNumber(recipients)}</div><div class="ds-lbl">Empfänger</div></div>
          <div class="ds-card"><div class="ds-num">${fmtNumber(opens)}</div><div class="ds-lbl">Öffnungen</div></div>
          <div class="ds-card"><div class="ds-num">${fmtNumber(clicks)}</div><div class="ds-lbl">Klicks</div></div>
          <div class="ds-card"><div class="ds-num">${ctr}%</div><div class="ds-lbl">CTR</div></div>
        </div>
        <div class="drawer-rates">
          ${rateBar('Open-Rate', opens, recipients, '#0a84ff')}
          ${rateBar('Click-Rate', clicks, recipients, '#bf5af2')}
          ${rateBar('Click-Through-Rate', clicks, opens, '#34c759')}
        </div>
      </div>
    `
  })
}

function renderEmpty(container, onCompose) {
  container.innerHTML = `
    <div class="empty-state" style="text-align:center;padding:48px 24px">
      <div style="font-size:48px;margin-bottom:12px">${iconHtml ? (iconHtml('mail') || '✉️') : '✉️'}</div>
      <h3>Noch keine Newsletter versendet</h3>
      <p class="muted">Erstelle deinen ersten Broadcast und erreiche deine Audience.</p>
      <button class="btn btn-primary" id="emptyCompose" style="margin-top:12px">Newsletter erstellen</button>
    </div>
  `
  container.querySelector('#emptyCompose').addEventListener('click', onCompose)
}

function renderError(container, msg, onRetry) {
  container.innerHTML = `
    <div class="error-state glass-card" style="text-align:center;padding:48px 24px">
      <div style="font-size:48px;margin-bottom:12px">${iconHtml ? (iconHtml('alert-triangle') || '⚠️') : '⚠️'}</div>
      <h3>Daten konnten nicht geladen werden</h3>
      <p class="muted">${htmlEscape(msg || 'Unbekannter Fehler')}</p>
      <button class="btn btn-primary" id="errRetry" style="margin-top:12px">Erneut versuchen</button>
    </div>
  `
  container.querySelector('#errRetry').addEventListener('click', onRetry)
}

export default {
  id: 'newsletter-audience-sync',
  title: 'Newsletter-Audience',
  category: 'marketing',

  async mount(container) {
    container.innerHTML = `
      <div class="panel-shell newsletter-audience-panel">
        <div class="panel-head">
          <div class="head-left">
            <h2>Newsletter-Audience</h2>
            <p class="sub muted">Sync, Versand und Performance deiner Broadcasts</p>
          </div>
          <div class="toolbar">
            <button class="btn btn-ghost" id="btnRefresh" title="Aktualisieren">🔄 Aktualisieren</button>
            <button class="btn btn-ghost" id="btnPdf" title="PDF Export">📄 PDF</button>
            <button class="btn btn-ghost" id="btnCsv" title="CSV Export">💾 CSV</button>
            <button class="btn btn-ghost" id="btnSync" title="Audience-Sync auslösen">⚡ Sync</button>
            <button class="btn btn-primary" id="btnCompose">✉️ Newsletter senden</button>
          </div>
        </div>
        <div class="panel-body" id="body"></div>
      </div>
    `

    const body = container.querySelector('#body')
    try { fadeIn(container) } catch {}

    const renderLoading = () => {
      body.innerHTML = `
        <div id="skHero" style="margin-bottom:16px"></div>
        <div id="skGrid" style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px"></div>
        <div id="skList"></div>
      `
      try {
        skeletonLoader(body.querySelector('#skHero'), { height: 140, count: 1 })
        skeletonLoader(body.querySelector('#skGrid'), { height: 240, count: 2 })
        skeletonLoader(body.querySelector('#skList'), { height: 48, count: 6 })
      } catch {}
    }

    const render = ({ status, counts, broadcasts, timeline }) => {
      const syncStatus = status?.status || 'healthy'
      const lastSync = status?.last_sync_at || null
      const activeCount = status?.active_count ?? counts?.all ?? 0
      const totalBroadcasts = broadcasts.length
      const totalOpens = broadcasts.reduce((s, b) => s + (b.opens || 0), 0)
      const totalRecipients = broadcasts.reduce((s, b) => s + (b.recipients || 0), 0)
      const avgOpenRate = totalRecipients > 0 ? Math.round((totalOpens / totalRecipients) * 100) : 0

      body.innerHTML = `
        <section class="glass-card hero-row" style="padding:24px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;gap:24px;flex-wrap:wrap">
          <div class="hero-main">
            <div class="hero-label muted" style="font-size:13px;text-transform:uppercase;letter-spacing:0.5px">Aktive Abonnenten</div>
            <div class="hero-value" id="heroActive" style="font-size:48px;font-weight:700;line-height:1.1;margin:6px 0">0</div>
            <div class="hero-sub">${statusPill(syncStatus)} <span class="muted" style="margin-left:8px">Letzter Sync: ${lastSync ? fmtRelativeTime(lastSync) : '—'}</span></div>
          </div>
          <div class="hero-stats" style="display:flex;gap:24px">
            <div class="hs-item" style="text-align:center"><div class="hs-val" id="hsBroadcasts" style="font-size:24px;font-weight:600">0</div><div class="hs-lbl muted" style="font-size:12px">Broadcasts</div></div>
            <div class="hs-item" style="text-align:center"><div class="hs-val" id="hsOpen" style="font-size:24px;font-weight:600">0%</div><div class="hs-lbl muted" style="font-size:12px">Ø Open-Rate</div></div>
            <div class="hs-item" style="text-align:center"><div class="hs-val" id="hsLast" style="font-size:14px;font-weight:600">${lastSync ? fmtRelativeTime(lastSync) : '—'}</div><div class="hs-lbl muted" style="font-size:12px">Last-Sync</div></div>
          </div>
        </section>

        <section class="grid-2" style="display:grid;grid-template-columns:1.4fr 1fr;gap:16px;margin-bottom:16px">
          <div class="glass-card chart-card" style="padding:20px">
            <div class="card-head" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><h3 style="margin:0">Versand-Volumen · 30 Tage</h3></div>
            <div id="chartTimeline" class="chart-host" style="min-height:220px"></div>
          </div>
          <div class="glass-card chart-card" style="padding:20px">
            <div class="card-head" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><h3 style="margin:0">Audience-Verteilung</h3></div>
            <div id="chartDonut" class="chart-host" style="min-height:220px"></div>
          </div>
        </section>

        <section class="glass-card list-card" style="padding:20px">
          <div class="card-head" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
            <h3 style="margin:0">Letzte Broadcasts</h3>
            <span class="muted">${totalBroadcasts} Einträge</span>
          </div>
          <div id="broadcastList"></div>
        </section>
      `

      try { countUp(body.querySelector('#heroActive'), activeCount) } catch { body.querySelector('#heroActive').textContent = fmtNumber(activeCount) }
      try { countUp(body.querySelector('#hsBroadcasts'), totalBroadcasts) } catch { body.querySelector('#hsBroadcasts').textContent = fmtNumber(totalBroadcasts) }
      body.querySelector('#hsOpen').textContent = `${avgOpenRate}%`

      const timelineHost = body.querySelector('#chartTimeline')
      if (timeline && timeline.length > 0) {
        try {
          makeAreaChart(timelineHost, {
            data: timeline.map(t => ({ x: t.day || t.date, y: t.sent || t.count || 0 })),
            color: '#0a84ff',
            height: 220
          })
        } catch (e) {
          timelineHost.innerHTML = `<div class="chart-empty muted" style="padding:40px;text-align:center">Chart nicht verfügbar</div>`
        }
      } else {
        timelineHost.innerHTML = `<div class="chart-empty muted" style="padding:40px;text-align:center">Keine Versand-Daten in den letzten 30 Tagen</div>`
      }

      const donutHost = body.querySelector('#chartDonut')
      const donutData = AUDIENCES.filter(a => a.id !== 'test').map(a => ({
        label: a.label,
        value: counts?.[a.id] || 0
      })).filter(d => d.value > 0)
      if (donutData.length > 0) {
        try { makeDonutChart(donutHost, { data: donutData, height: 220 }) }
        catch { donutHost.innerHTML = `<div class="chart-empty muted" style="padding:40px;text-align:center">Chart nicht verfügbar</div>` }
      } else {
        donutHost.innerHTML = `<div class="chart-empty muted" style="padding:40px;text-align:center">Noch keine Audience-Segmente</div>`
      }

      const listHost = body.querySelector('#broadcastList')
      if (!broadcasts || broadcasts.length === 0) {
        renderEmpty(listHost, openCompose)
      } else {
        listHost.innerHTML = `
          <div class="data-table broadcast-table">
            <div class="dt-head" style="display:grid;grid-template-columns:2fr 1fr 1fr 1.3fr 1.3fr 1fr;gap:12px;padding:10px 12px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;color:var(--text-muted,#8e8e93);border-bottom:1px solid var(--border,#2a2a2e)">
              <div>Betreff</div><div>Versendet</div><div>Empfänger</div><div>Open-Rate</div><div>Click-Rate</div><div>Status</div>
            </div>
            ${broadcasts.map(b => {
              const r = b.recipients || 0
              const o = b.opens || 0
              const c = b.clicks || 0
              const op = r > 0 ? Math.round((o / r) * 100) : 0
              const cp = r > 0 ? Math.round((c / r) * 100) : 0
              return `
                <div class="dt-row" data-id="${b.id}" role="button" tabindex="0" style="display:grid;grid-template-columns:2fr 1fr 1fr 1.3fr 1.3fr 1fr;gap:12px;padding:14px 12px;align-items:center;border-bottom:1px solid var(--border,#2a2a2e);cursor:pointer;transition:background 0.15s" onmouseover="this.style.background='rgba(255,255,255,0.04)'" onmouseout="this.style.background=''">
                  <div>
                    <div style="font-weight:600">${htmlEscape(b.subject || '(ohne Betreff)')}</div>
                    <div class="muted" style="font-size:12px">${htmlEscape(b.audience || '—')}</div>
                  </div>
                  <div class="muted" style="font-size:13px">${b.sent_at ? fmtRelativeTime(b.sent_at) : '—'}</div>
                  <div style="font-weight:600">${fmtNumber(r)}</div>
                  <div>
                    <div style="height:6px;background:rgba(255,255,255,0.06);border-radius:4px;overflow:hidden;margin-bottom:4px"><div style="height:100%;width:${op}%;background:#0a84ff;border-radius:4px"></div></div>
                    <div class="muted" style="font-size:12px">${op}%</div>
                  </div>
                  <div>
                    <div style="height:6px;background:rgba(255,255,255,0.06);border-radius:4px;overflow:hidden;margin-bottom:4px"><div style="height:100%;width:${cp}%;background:#bf5af2;border-radius:4px"></div></div>
                    <div class="muted" style="font-size:12px">${cp}%</div>
                  </div>
                  <div>${statusPill(b.status)}</div>
                </div>
              `
            }).join('')}
          </div>
        `
        listHost.querySelectorAll('.dt-row').forEach(row => {
          const id = row.getAttribute('data-id')
          const b = broadcasts.find(x => String(x.id) === String(id))
          const open = () => openBroadcastDrawer(b)
          row.addEventListener('click', open)
          row.addEventListener('keydown', e => { if (e.key === 'Enter') open() })
        })
      }
    }

    const load = async () => {
      renderLoading()
      try {
        const [status, counts, broadcasts, timeline] = await Promise.all([
          fetchSyncStatus(),
          fetchAudienceCounts(),
          fetchBroadcasts(20),
          fetchSendTimeline()
        ])
        render({ status, counts, broadcasts, timeline })
      } catch (e) {
        renderError(body, e.message || String(e), load)
      }
    }

    const openCompose = () => openSendModal(load)

    container.querySelector('#btnRefresh').addEventListener('click', load)
    container.querySelector('#btnCompose').addEventListener('click', openCompose)
    container.querySelector('#btnSync').addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'Audience-Sync starten?',
        message: 'Synchronisiert die aktuelle Liste mit dem E-Mail-Provider.',
        confirmText: 'Sync starten'
      })
      if (!ok) return
      toast('Sync läuft…', 'info')
      const done = await triggerSync()
      if (done) {
        toast('Sync abgeschlossen', 'success')
        load()
      }
    })
    container.querySelector('#btnPdf').addEventListener('click', () => {
      try { exportPanelAsPdf(container, { filename: 'newsletter-audience.pdf', title: 'Newsletter-Audience' }) }
      catch (e) { toast(`PDF-Export fehlgeschlagen: ${e.message || e}`, 'error') }
    })
    container.querySelector('#btnCsv').addEventListener('click', async () => {
      const rows = await fetchBroadcasts(200)
      if (!rows || rows.length === 0) { toast('Keine Daten zum Export', 'warn'); return }
      try {
        exportCsv(rows.map(b => ({
          id: b.id, subject: b.subject, sent_at: b.sent_at,
          audience: b.audience, recipients: b.recipients,
          opens: b.opens, clicks: b.clicks, status: b.status
        })), { filename: 'newsletter-broadcasts.csv' })
      } catch (e) { toast(`CSV-Export fehlgeschlagen: ${e.message || e}`, 'error') }
    })

    await load()
  }
}
