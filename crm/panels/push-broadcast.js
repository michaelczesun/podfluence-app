import { sb } from '/lib/supabase.js'
import { toast, modal, confirmDialog, fmtNumber, fmtDateTime, fmtRelativeTime, htmlEscape, iconHtml, debounce, spinnerHtml } from '/lib/ui.js'
import { makeAreaChart, makeBarChart, makeDonutChart } from '/lib/charts.js'
import { exportPanelAsPdf, exportCsv } from '/lib/export.js'
import { countUp, fadeIn, skeletonLoader, slideInRight } from '/lib/animations.js'
import { drawer, segmentedControl, statHero, glassCard } from '/lib/layout-extras.js'
import { sendBroadcastPush } from '/lib/panel-actions.js'

const AUDIENCES = [
  { value: 'all', label: 'Alle aktiven User' },
  { value: 'podcasters', label: 'Podcaster' },
  { value: 'listeners', label: 'Hörer' },
  { value: 'premium', label: 'Premium' },
  { value: 'inactive_7d', label: 'Inaktiv >7 Tage' },
  { value: 'new_7d', label: 'Neu (7 Tage)' }
]

async function fetchAudienceCounts() {
  const counts = {}
  for (const a of AUDIENCES) {
    try {
      let q = sb.from('users').select('id', { count: 'exact', head: true })
      if (a.value === 'podcasters') q = q.eq('is_podcaster', true)
      else if (a.value === 'premium') q = q.eq('is_premium', true)
      else if (a.value === 'new_7d') q = q.gte('created_at', new Date(Date.now()-7*864e5).toISOString())
      else if (a.value === 'inactive_7d') q = q.lt('last_seen_at', new Date(Date.now()-7*864e5).toISOString())
      else if (a.value === 'listeners') q = q.eq('is_podcaster', false)
      const { count } = await q
      counts[a.value] = count || 0
    } catch (_) { counts[a.value] = 0 }
  }
  return counts
}

async function fetchHistory() {
  try {
    const { data, error } = await sb
      .from('broadcast_push_log')
      .select('*')
      .order('sent_at', { ascending: false })
      .limit(10)
    if (error) throw error
    return data || []
  } catch (e) {
    return []
  }
}

function audienceLabel(v) {
  return AUDIENCES.find(a => a.value === v)?.label || v || '—'
}

function renderHero(history, totalUsers) {
  const last7 = history.filter(h => new Date(h.sent_at) > new Date(Date.now()-7*864e5))
  const totalDelivered = history.reduce((s,h)=>s+(h.delivered||0),0)
  const totalOpened = history.reduce((s,h)=>s+(h.opened||0),0)
  const openRate = totalDelivered ? (totalOpened/totalDelivered*100) : 0
  return `
    <div class="hero-row">
      ${statHero({ label: 'Erreichbare User', value: totalUsers, icon: 'users', accent: 'blue' })}
      ${statHero({ label: 'Broadcasts (7T)', value: last7.length, icon: 'send', accent: 'violet' })}
      ${statHero({ label: 'Zugestellt gesamt', value: totalDelivered, icon: 'check', accent: 'green' })}
      ${statHero({ label: 'Open-Rate', value: openRate.toFixed(1) + '%', icon: 'eye', accent: 'amber', raw: true })}
    </div>
  `
}

function historyRow(h) {
  const deliveryRate = h.recipients ? Math.round((h.delivered||0)/h.recipients*100) : 0
  const openRate = h.delivered ? Math.round((h.opened||0)/h.delivered*100) : 0
  return `
    <tr data-id="${h.id}" class="row-clickable">
      <td>
        <div class="cell-title">${htmlEscape(h.title || '(ohne Titel)')}</div>
        <div class="cell-sub">${htmlEscape((h.body||'').slice(0,80))}${(h.body||'').length>80?'…':''}</div>
      </td>
      <td><span class="chip chip-soft">${htmlEscape(audienceLabel(h.audience))}</span></td>
      <td class="num">${fmtNumber(h.recipients||0)}</td>
      <td class="num">
        <div class="bar-cell">
          <div class="bar-cell-fill" style="width:${deliveryRate}%; background:#34d399"></div>
          <span>${fmtNumber(h.delivered||0)} · ${deliveryRate}%</span>
        </div>
      </td>
      <td class="num">
        <div class="bar-cell">
          <div class="bar-cell-fill" style="width:${openRate}%; background:#fbbf24"></div>
          <span>${fmtNumber(h.opened||0)} · ${openRate}%</span>
        </div>
      </td>
      <td class="muted">${fmtRelativeTime(h.sent_at)}</td>
    </tr>
  `
}

function renderForm(counts) {
  return `
    <div class="glass-card broadcast-form">
      <div class="form-head">
        <h3>${iconHtml('send')} Neue Push-Nachricht</h3>
        <p class="muted">Wird sofort an die ausgewählte Audience zugestellt.</p>
      </div>

      <div class="form-grid">
        <div class="form-row">
          <label class="form-label">Audience</label>
          <div id="audience-seg"></div>
          <div class="audience-count">
            <span class="count-pill"><strong id="audience-count">—</strong> User werden erreicht</span>
          </div>
        </div>

        <div class="form-row">
          <label class="form-label" for="bc-title">Titel <span class="muted">(max. 60)</span></label>
          <input id="bc-title" class="input" type="text" maxlength="60" placeholder="z.B. Neue Folge entdeckt 🎙️" />
          <div class="char-counter"><span id="title-count">0</span>/60</div>
        </div>

        <div class="form-row">
          <label class="form-label" for="bc-body">Nachricht <span class="muted">(max. 180)</span></label>
          <textarea id="bc-body" class="input textarea" maxlength="180" rows="3" placeholder="Kurz, prägnant, mit einem Hook…"></textarea>
          <div class="char-counter"><span id="body-count">0</span>/180</div>
        </div>

        <div class="form-row">
          <label class="form-label" for="bc-link">Deep-Link <span class="muted">(optional)</span></label>
          <input id="bc-link" class="input" type="text" placeholder="podfluence://episode/123 oder https://…" />
        </div>

        <div class="preview-block">
          <div class="form-label">Vorschau</div>
          <div class="push-preview" id="push-preview">
            <div class="push-preview-icon">${iconHtml('bell')}</div>
            <div class="push-preview-body">
              <div class="pp-app">PODFLUENCE · jetzt</div>
              <div class="pp-title" id="pp-title">Titel deiner Push</div>
              <div class="pp-text" id="pp-text">Hier erscheint dein Nachrichtentext.</div>
            </div>
          </div>
        </div>

        <div class="form-actions">
          <button class="btn btn-ghost" id="btn-test">${iconHtml('user')} Test an mich</button>
          <button class="btn btn-primary btn-lg" id="btn-send" disabled>
            ${iconHtml('send')} An <span id="send-count">0</span> User senden
          </button>
        </div>
      </div>
    </div>
  `
}

function renderHistory(history) {
  if (!history.length) {
    return `
      <div class="glass-card">
        <h3>${iconHtml('clock')} Verlauf</h3>
        <div class="empty-state">
          <div class="empty-icon">${iconHtml('inbox')}</div>
          <div class="empty-title">Noch keine Broadcasts versendet</div>
          <div class="empty-sub">Sende deine erste Push-Nachricht über das Formular oben.</div>
        </div>
      </div>
    `
  }
  return `
    <div class="glass-card">
      <div class="card-head">
        <h3>${iconHtml('clock')} Verlauf — letzte 10 Broadcasts</h3>
      </div>
      <div class="table-wrap">
        <table class="data-table data-table-hover">
          <thead>
            <tr>
              <th>Nachricht</th>
              <th>Audience</th>
              <th class="num">Empfänger</th>
              <th class="num">Zugestellt</th>
              <th class="num">Geöffnet</th>
              <th>Versendet</th>
            </tr>
          </thead>
          <tbody>${history.map(historyRow).join('')}</tbody>
        </table>
      </div>
    </div>
  `
}

function renderCharts(history) {
  const byDay = {}
  for (let i=13;i>=0;i--) {
    const d = new Date(Date.now()-i*864e5)
    byDay[d.toISOString().slice(0,10)] = { delivered: 0, opened: 0 }
  }
  for (const h of history) {
    const k = (h.sent_at||'').slice(0,10)
    if (byDay[k]) {
      byDay[k].delivered += h.delivered||0
      byDay[k].opened += h.opened||0
    }
  }
  const labels = Object.keys(byDay)
  const delivered = labels.map(l => byDay[l].delivered)
  const opened = labels.map(l => byDay[l].opened)

  const audAgg = {}
  for (const h of history) audAgg[h.audience||'unknown'] = (audAgg[h.audience||'unknown']||0) + (h.recipients||0)
  const audLabels = Object.keys(audAgg).map(audienceLabel)
  const audValues = Object.values(audAgg)

  return `
    <div class="chart-row">
      <div class="glass-card chart-card">
        <div class="card-head"><h3>${iconHtml('activity')} Zustellung & Öffnungen (14T)</h3></div>
        <div id="chart-deliver" class="chart-box"></div>
      </div>
      <div class="glass-card chart-card chart-card-sm">
        <div class="card-head"><h3>${iconHtml('pie-chart')} Audience-Verteilung</h3></div>
        <div id="chart-audience" class="chart-box"></div>
      </div>
    </div>
    <script type="application/json" id="chart-data">${JSON.stringify({labels, delivered, opened, audLabels, audValues})}</script>
  `
}

function styles() {
  return `<style>
    .panel-shell { display:flex; flex-direction:column; gap:20px; padding:20px 24px 40px; }
    .panel-head { display:flex; justify-content:space-between; align-items:center; gap:16px; flex-wrap:wrap; }
    .panel-head h2 { margin:0; font-size:24px; font-weight:600; letter-spacing:-0.02em; display:flex; align-items:center; gap:10px; }
    .toolbar { display:flex; gap:8px; }
    .toolbar .btn { padding:8px 14px; }
    .hero-row { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:14px; }
    .broadcast-form .form-head h3 { margin:0 0 4px; font-size:18px; font-weight:600; display:flex; align-items:center; gap:8px; }
    .broadcast-form .form-head { margin-bottom:20px; }
    .broadcast-form .muted { color:var(--text-muted,#8a8a93); font-size:13px; }
    .form-grid { display:grid; gap:18px; }
    .form-row { display:flex; flex-direction:column; gap:8px; position:relative; }
    .form-label { font-size:13px; font-weight:500; color:var(--text-secondary,#c0c0c8); }
    .input { background:var(--input-bg,rgba(255,255,255,0.04)); border:1px solid var(--border,rgba(255,255,255,0.08)); color:var(--text,#fff); border-radius:10px; padding:11px 14px; font-size:14px; font-family:inherit; transition:border-color .15s, background .15s; }
    .input:focus { outline:none; border-color:var(--accent,#7c5cff); background:rgba(255,255,255,0.06); }
    .textarea { resize:vertical; min-height:80px; line-height:1.5; }
    .char-counter { position:absolute; right:4px; bottom:-18px; font-size:11px; color:var(--text-muted,#8a8a93); }
    .audience-count { margin-top:6px; }
    .count-pill { background:rgba(124,92,255,0.12); border:1px solid rgba(124,92,255,0.25); color:var(--accent,#a48dff); padding:6px 12px; border-radius:999px; font-size:13px; display:inline-flex; align-items:center; gap:4px; }
    .count-pill strong { font-weight:600; color:#fff; }
    .preview-block { margin-top:6px; }
    .push-preview { background:linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.03)); border:1px solid var(--border,rgba(255,255,255,0.08)); border-radius:14px; padding:14px 16px; display:flex; gap:12px; align-items:flex-start; backdrop-filter:blur(20px); max-width:420px; }
    .push-preview-icon { width:36px; height:36px; border-radius:9px; background:linear-gradient(135deg,#7c5cff,#ff5cc8); display:grid; place-items:center; flex-shrink:0; color:white; }
    .push-preview-body { flex:1; min-width:0; }
    .pp-app { font-size:10px; letter-spacing:0.06em; text-transform:uppercase; color:var(--text-muted,#8a8a93); margin-bottom:2px; }
    .pp-title { font-size:14px; font-weight:600; color:#fff; margin-bottom:2px; word-break:break-word; }
    .pp-text { font-size:13px; color:var(--text-secondary,#c0c0c8); line-height:1.35; word-break:break-word; }
    .form-actions { display:flex; gap:10px; justify-content:flex-end; padding-top:8px; border-top:1px solid var(--border,rgba(255,255,255,0.06)); }
    .btn { display:inline-flex; align-items:center; gap:6px; border-radius:10px; padding:9px 16px; font-size:14px; font-weight:500; cursor:pointer; border:1px solid transparent; transition:all .15s; font-family:inherit; }
    .btn-ghost { background:transparent; border-color:var(--border,rgba(255,255,255,0.1)); color:var(--text,#fff); }
    .btn-ghost:hover { background:rgba(255,255,255,0.05); }
    .btn-primary { background:linear-gradient(135deg,#7c5cff,#5b3eff); color:white; box-shadow:0 4px 14px rgba(124,92,255,0.35); }
    .btn-primary:hover:not(:disabled) { transform:translateY(-1px); box-shadow:0 6px 20px rgba(124,92,255,0.45); }
    .btn-primary:disabled { opacity:0.4; cursor:not-allowed; }
    .btn-lg { padding:11px 22px; font-size:15px; }
    .chart-row { display:grid; grid-template-columns:2fr 1fr; gap:16px; }
    @media (max-width:900px) { .chart-row { grid-template-columns:1fr; } }
    .chart-card .card-head h3, .glass-card .card-head h3 { margin:0 0 14px; font-size:15px; font-weight:600; display:flex; align-items:center; gap:8px; }
    .chart-box { height:220px; }
    .table-wrap { overflow-x:auto; }
    .data-table { width:100%; border-collapse:collapse; font-size:13px; }
    .data-table th { text-align:left; font-weight:500; color:var(--text-muted,#8a8a93); padding:10px 12px; border-bottom:1px solid var(--border,rgba(255,255,255,0.08)); font-size:12px; text-transform:uppercase; letter-spacing:0.04em; }
    .data-table td { padding:12px; border-bottom:1px solid rgba(255,255,255,0.04); vertical-align:middle; }
    .data-table .num { text-align:right; }
    .data-table-hover tbody tr { transition:background .12s; cursor:pointer; }
    .data-table-hover tbody tr:hover { background:rgba(255,255,255,0.03); }
    .cell-title { font-weight:500; color:#fff; margin-bottom:2px; }
    .cell-sub { font-size:12px; color:var(--text-muted,#8a8a93); }
    .chip { display:inline-block; padding:3px 10px; border-radius:999px; font-size:11px; font-weight:500; }
    .chip-soft { background:rgba(255,255,255,0.06); color:var(--text-secondary,#c0c0c8); }
    .bar-cell { position:relative; min-width:120px; padding:4px 0; }
    .bar-cell-fill { position:absolute; left:0; top:0; bottom:0; opacity:0.18; border-radius:4px; transition:width .4s; }
    .bar-cell span { position:relative; z-index:1; font-variant-numeric:tabular-nums; }
    .muted { color:var(--text-muted,#8a8a93); }
    .empty-state { text-align:center; padding:40px 20px; }
    .empty-icon { font-size:32px; opacity:0.4; margin-bottom:12px; }
    .empty-title { font-size:15px; font-weight:500; color:#fff; margin-bottom:4px; }
    .empty-sub { font-size:13px; color:var(--text-muted,#8a8a93); }
    .error-state { padding:24px; text-align:center; color:var(--text-muted,#8a8a93); }
    .seg-control { display:inline-flex; background:rgba(255,255,255,0.04); border:1px solid var(--border,rgba(255,255,255,0.08)); border-radius:10px; padding:3px; gap:2px; flex-wrap:wrap; }
    .seg-btn { background:transparent; border:none; color:var(--text-secondary,#c0c0c8); padding:7px 14px; border-radius:7px; font-size:13px; cursor:pointer; transition:all .15s; font-family:inherit; }
    .seg-btn:hover { color:#fff; }
    .seg-btn.active { background:var(--accent,#7c5cff); color:#fff; }
  </style>`
}

function buildSegmented(container, counts, onChange) {
  const el = container.querySelector('#audience-seg')
  let active = 'all'
  function render() {
    el.innerHTML = `<div class="seg-control">${AUDIENCES.map(a => `
      <button class="seg-btn ${active===a.value?'active':''}" data-v="${a.value}">${htmlEscape(a.label)} <span class="muted" style="font-size:11px">·${fmtNumber(counts[a.value]||0)}</span></button>
    `).join('')}</div>`
    el.querySelectorAll('.seg-btn').forEach(b => {
      b.onclick = () => { active = b.dataset.v; render(); onChange(active) }
    })
  }
  render()
  onChange(active)
  return () => active
}

export default {
  id: 'push-broadcast',
  title: 'Push-Broadcast senden',
  category: 'admin_actions',
  async mount(container) {
   try {
    container.innerHTML = `${styles()}
      <div class="panel-shell">
        <div class="panel-head">
          <h2>${iconHtml('send')} Push-Broadcast senden</h2>
          <div class="toolbar">
            <button class="btn btn-ghost" id="btn-refresh">${iconHtml('refresh-cw')} Aktualisieren</button>
            <button class="btn btn-ghost" id="btn-pdf">${iconHtml('file-text')} PDF</button>
            <button class="btn btn-ghost" id="btn-csv">${iconHtml('download')} CSV</button>
          </div>
        </div>
        <div id="body">${skeletonLoader({ rows: 4, height: 80 })}</div>
      </div>`

    try { fadeIn(container) } catch (_) {}

    const body = container.querySelector('#body')

    const renderAll = async () => {
      body.innerHTML = skeletonLoader({ rows: 4, height: 80 })
      let counts, history
      try {
        [counts, history] = await Promise.all([fetchAudienceCounts(), fetchHistory()])
      } catch (e) {
        body.innerHTML = `<div class="glass-card error-state">
          <div>${iconHtml('alert-triangle')} Daten konnten nicht geladen werden.</div>
          <button class="btn btn-ghost" id="retry" style="margin-top:12px">Erneut versuchen</button>
        </div>`
        body.querySelector('#retry').onclick = renderAll
        return
      }

      const totalUsers = counts.all || 0

      body.innerHTML = `
        ${renderHero(history, totalUsers)}
        ${renderForm(counts)}
        ${renderCharts(history)}
        ${renderHistory(history)}
      `

      body.querySelectorAll('.stat-hero-value, [data-countup]').forEach(el => {
        const raw = el.textContent.trim()
        const n = parseFloat(raw.replace(/[^0-9.]/g,''))
        if (!isNaN(n) && n > 0) countUp(el, n, { duration: 700, suffix: raw.includes('%') ? '%' : '' })
      })

      try {
        const chartData = JSON.parse(body.querySelector('#chart-data').textContent)
        makeAreaChart(body.querySelector('#chart-deliver'), {
          labels: chartData.labels,
          series: [
            { name: 'Zugestellt', data: chartData.delivered, color: '#34d399' },
            { name: 'Geöffnet', data: chartData.opened, color: '#fbbf24' }
          ]
        })
        if (chartData.audValues.length) {
          makeDonutChart(body.querySelector('#chart-audience'), {
            labels: chartData.audLabels,
            values: chartData.audValues
          })
        } else {
          body.querySelector('#chart-audience').innerHTML = `<div class="empty-state"><div class="empty-icon">${iconHtml('pie-chart')}</div><div class="empty-sub">Noch keine Daten</div></div>`
        }
      } catch (_) {}

      const state = { audience: 'all', title: '', body: '', deepLink: '' }
      const titleEl = body.querySelector('#bc-title')
      const bodyEl = body.querySelector('#bc-body')
      const linkEl = body.querySelector('#bc-link')
      const titleCount = body.querySelector('#title-count')
      const bodyCount = body.querySelector('#body-count')
      const ppTitle = body.querySelector('#pp-title')
      const ppText = body.querySelector('#pp-text')
      const audienceCountEl = body.querySelector('#audience-count')
      const sendCountEl = body.querySelector('#send-count')
      const btnSend = body.querySelector('#btn-send')
      const btnTest = body.querySelector('#btn-test')

      const updateSendButton = () => {
        const ok = state.title.trim().length > 0 && state.body.trim().length > 0
        btnSend.disabled = !ok
      }

      buildSegmented(body, counts, (v) => {
        state.audience = v
        const c = counts[v] || 0
        audienceCountEl.textContent = fmtNumber(c)
        sendCountEl.textContent = fmtNumber(c)
      })

      const refreshPreview = () => {
        ppTitle.textContent = state.title || 'Titel deiner Push'
        ppText.textContent = state.body || 'Hier erscheint dein Nachrichtentext.'
      }

      titleEl.oninput = () => {
        state.title = titleEl.value
        titleCount.textContent = state.title.length
        refreshPreview(); updateSendButton()
      }
      bodyEl.oninput = () => {
        state.body = bodyEl.value
        bodyCount.textContent = state.body.length
        refreshPreview(); updateSendButton()
      }
      linkEl.oninput = () => { state.deepLink = linkEl.value }

      btnTest.onclick = async () => {
        if (!state.title.trim() || !state.body.trim()) {
          toast('Titel und Nachricht ausfüllen', 'warn'); return
        }
        btnTest.disabled = true
        btnTest.innerHTML = spinnerHtml() + ' Sende…'
        try {
          await sendBroadcastPush({
            audience: 'self',
            title: state.title,
            body: state.body,
            deepLink: state.deepLink || null,
            test: true
          })
          toast('Test-Push an dich versendet', 'success')
        } catch (e) {
          toast('Fehler: ' + (e.message || 'unbekannt'), 'error')
        }
        btnTest.disabled = false
        btnTest.innerHTML = iconHtml('user') + ' Test an mich'
      }

      btnSend.onclick = async () => {
        const target = counts[state.audience] || 0
        if (!target) { toast('Diese Audience ist leer', 'warn'); return }
        const ok = await confirmDialog({
          title: 'Broadcast versenden?',
          message: `Push wird an <strong>${fmtNumber(target)}</strong> User in „${audienceLabel(state.audience)}" zugestellt. Diese Aktion lässt sich nicht rückgängig machen.`,
          confirmText: 'Jetzt senden',
          confirmStyle: 'primary'
        })
        if (!ok) return
        btnSend.disabled = true
        btnSend.innerHTML = spinnerHtml() + ' Wird versendet…'
        try {
          await sendBroadcastPush({
            audience: state.audience,
            title: state.title,
            body: state.body,
            deepLink: state.deepLink || null
          })
          toast(`Broadcast an ${fmtNumber(target)} User gestartet`, 'success')
          titleEl.value = ''; bodyEl.value = ''; linkEl.value = ''
          state.title = ''; state.body = ''; state.deepLink = ''
          setTimeout(renderAll, 800)
        } catch (e) {
          toast('Fehler: ' + (e.message || 'unbekannt'), 'error')
          btnSend.disabled = false
        }
      }

      body.querySelectorAll('tbody tr.row-clickable').forEach(tr => {
        tr.onclick = () => {
          const id = tr.dataset.id
          const h = history.find(x => String(x.id) === String(id))
          if (!h) return
          drawer({
            title: 'Broadcast-Details',
            width: 480,
            content: `
              <div style="display:flex; flex-direction:column; gap:18px;">
                <div>
                  <div class="form-label">Titel</div>
                  <div style="font-size:16px; font-weight:600; margin-top:4px;">${htmlEscape(h.title||'')}</div>
                </div>
                <div>
                  <div class="form-label">Nachricht</div>
                  <div style="margin-top:4px; line-height:1.5;">${htmlEscape(h.body||'')}</div>
                </div>
                ${h.deep_link ? `<div><div class="form-label">Deep-Link</div><code style="display:block; margin-top:4px; padding:8px; background:rgba(255,255,255,0.04); border-radius:6px; font-size:12px;">${htmlEscape(h.deep_link)}</code></div>` : ''}
                <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:10px;">
                  <div class="glass-card" style="padding:14px; text-align:center;">
                    <div style="font-size:11px; color:var(--text-muted,#8a8a93); text-transform:uppercase;">Empfänger</div>
                    <div style="font-size:22px; font-weight:600; margin-top:4px;">${fmtNumber(h.recipients||0)}</div>
                  </div>
                  <div class="glass-card" style="padding:14px; text-align:center;">
                    <div style="font-size:11px; color:var(--text-muted,#8a8a93); text-transform:uppercase;">Zugestellt</div>
                    <div style="font-size:22px; font-weight:600; color:#34d399; margin-top:4px;">${fmtNumber(h.delivered||0)}</div>
                  </div>
                  <div class="glass-card" style="padding:14px; text-align:center;">
                    <div style="font-size:11px; color:var(--text-muted,#8a8a93); text-transform:uppercase;">Geöffnet</div>
                    <div style="font-size:22px; font-weight:600; color:#fbbf24; margin-top:4px;">${fmtNumber(h.opened||0)}</div>
                  </div>
                </div>
                <div>
                  <div class="form-label">Audience</div>
                  <div style="margin-top:6px;"><span class="chip chip-soft">${htmlEscape(audienceLabel(h.audience))}</span></div>
                </div>
                <div>
                  <div class="form-label">Versendet</div>
                  <div style="margin-top:4px;">${fmtDateTime(h.sent_at)}</div>
                </div>
              </div>
            `
          })
        }
      })
    }

    container.querySelector('#btn-refresh').onclick = renderAll
    container.querySelector('#btn-pdf').onclick = () => exportPanelAsPdf(container, { title: 'Push-Broadcasts' })
    container.querySelector('#btn-csv').onclick = async () => {
      const history = await fetchHistory()
      exportCsv('push-broadcasts.csv', history.map(h => ({
        sent_at: h.sent_at,
        audience: audienceLabel(h.audience),
        title: h.title,
        body: h.body,
        deep_link: h.deep_link || '',
        recipients: h.recipients || 0,
        delivered: h.delivered || 0,
        opened: h.opened || 0,
        status: h.status || ''
      })))
    }

    await renderAll()
   } catch (e) {
    container.innerHTML = `<div style="padding:24px;">
      <div class="glass-card" style="padding:20px; border:1px solid rgba(255,107,107,0.3);">
        <h3 style="margin:0 0 8px; color:#ff6b6b;">Panel konnte nicht geladen werden</h3>
        <div style="color:#c0c0c8; font-size:13px; margin-bottom:12px;">Fehler: ${(e && e.message) ? String(e.message).replace(/</g,'&lt;') : 'Unbekannter Fehler'}</div>
        <button class="btn btn-ghost" id="mount-retry">Erneut versuchen</button>
      </div>
    </div>`
    const r = container.querySelector('#mount-retry')
    if (r) r.onclick = () => this.mount(container)
   }
  }
}
