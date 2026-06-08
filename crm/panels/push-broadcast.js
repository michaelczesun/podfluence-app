import { sb } from '/lib/supabase.js?v=20260608h'
import { toast, confirmDialog, fmtNumber, fmtDateTime, htmlEscape, iconHtml } from '/lib/ui.js?v=20260608h'
import { makeAreaChart, makeDonutChart } from '/lib/charts.js?v=20260608h'
import { exportPanelAsPdf, exportCsv } from '/lib/export.js?v=20260608h'
import { drawer, statHero, glassCard } from '/lib/layout-extras.js?v=20260608h'

// Audiences supported by send_broadcast_push RPC
const AUDIENCES = [
  { value: 'all',       label: 'Alle User' },
  { value: 'podcaster', label: 'Podcaster' },
  { value: 'listener',  label: 'Hörer' },
  { value: 'beta',      label: 'Beta-User' }
]

function audienceLabel(v) {
  return AUDIENCES.find(a => a.value === v)?.label || v || '—'
}

// Map audience value → count from admin_user_type_split result.
// admin_user_type_split may return keys: podcaster, listener, both, beta_user, premium, unknown.
// We use all plausible key names defensively.
function countForAudience(audience, splitData, statsData) {
  const sp = splitData || {}
  const st = statsData || {}
  if (audience === 'all')       return st.total_users || 0
  if (audience === 'podcaster') return (sp.podcaster || 0) + (sp.both || 0)
  if (audience === 'listener')  return (sp.listener  || 0) + (sp.both || 0)
  // accept 'beta_user', 'beta', or 'premium' — whatever key the RPC returns
  // Only accept real beta keys — premium != beta
  if (audience === 'beta')      return sp.beta_user || sp.beta || 0
  return 0
}

async function fetchAudienceCounts() {
  const [statsRes, splitRes] = await Promise.all([
    sb.rpc('admin_db_live_stats'),
    sb.rpc('admin_user_type_split')
  ])
  const statsData = (statsRes.data && !Array.isArray(statsRes.data))
    ? statsRes.data
    : (Array.isArray(statsRes.data) ? (statsRes.data[0] || {}) : {})
  const splitData = (splitRes.data && !Array.isArray(splitRes.data))
    ? splitRes.data
    : (Array.isArray(splitRes.data) ? (splitRes.data[0] || {}) : {})
  const counts = {}
  for (const a of AUDIENCES) {
    counts[a.value] = countForAudience(a.value, splitData, statsData)
  }
  return { counts, statsData, splitData }
}

// History is read from email_broadcasts (broadcast_push_log does not exist).
// email_broadcasts columns expected: id, subject (title), body, audience, sent_at,
// recipient_count (= recipients), delivered_count (= delivered), opened_count (= opened),
// deep_link. We normalise to a consistent shape so the rest of the UI can use
// h.title / h.body / h.recipients / h.delivered / h.opened / h.deep_link / h.audience.
function normaliseBroadcast(row) {
  return {
    id:         row.id,
    title:      row.subject       || row.title            || '',
    body:       row.body          || row.message          || '',
    audience:   row.audience      || row.segment          || 'all',
    deep_link:  row.deep_link     || row.deeplink         || '',
    sent_at:    row.sent_at       || row.created_at       || null,
    recipients: row.recipient_count ?? row.recipients     ?? 0,
    delivered:  row.delivered_count ?? row.delivered      ?? 0,
    opened:     row.opened_count    ?? row.opened         ?? 0
  }
}

async function fetchHistory() {
  try {
    const { data, error } = await sb
      .from('email_broadcasts')
      .select('*')
      .order('sent_at', { ascending: false })
      .limit(10)
    if (error) {
      console.warn('[push-broadcast] fetchHistory error:', error.message)
      return []
    }
    return (data || []).map(normaliseBroadcast)
  } catch (err) {
    console.warn('[push-broadcast] fetchHistory exception:', err)
    return []
  }
}

// Call send_broadcast_push RPC.
// Bare param names (no p_ prefix) as per RPC signature: send_broadcast_push(title,body,audience,deep_link?)
async function doSendBroadcast({ title, body, audience, deepLink }) {
  const params = { title, body, audience }
  if (deepLink && deepLink.trim()) params.deep_link = deepLink.trim()
  const { data, error } = await sb.rpc('send_broadcast_push', params)
  if (error) throw new Error(error.message || JSON.stringify(error))
  return data
}

// ─── Render helpers ───────────────────────────────────────────────────────────

function renderHero(history, totalUsers) {
  const cutoff = Date.now() - 7 * 864e5
  const last7  = history.filter(h => new Date(h.sent_at) > cutoff)
  const totalDelivered = history.reduce((s, h) => s + (h.delivered || 0), 0)
  const totalOpened    = history.reduce((s, h) => s + (h.opened    || 0), 0)
  const openRate = totalDelivered ? (totalOpened / totalDelivered * 100) : 0

  return `<div class="hero-row">
    ${statHero({ label: 'Erreichbare User',   value: fmtNumber(totalUsers),              icon: iconHtml('users') })}
    ${statHero({ label: 'Broadcasts (7T)',     value: fmtNumber(last7.length),            icon: iconHtml('send') })}
    ${statHero({ label: 'Zugestellt gesamt',  value: fmtNumber(totalDelivered),          icon: iconHtml('check') })}
    ${statHero({ label: 'Open-Rate',          value: openRate.toFixed(1) + '%',          icon: iconHtml('eye') })}
  </div>`
}

function renderForm(counts) {
  return `<div class="glass-card broadcast-form">
    <div class="form-head">
      <h3>${iconHtml('send')} Neue Push-Nachricht</h3>
      <p class="form-sub">Wird sofort an die ausgewählte Audience zugestellt.</p>
    </div>
    <div class="form-grid">
      <div class="form-row">
        <label class="form-label">Audience</label>
        <div class="seg-control" id="audience-seg">
          ${AUDIENCES.map((a, i) => `
            <button class="seg-btn${i === 0 ? ' active' : ''}" data-v="${a.value}">
              ${htmlEscape(a.label)}
              <span class="seg-count">${fmtNumber(counts[a.value] || 0)}</span>
            </button>`).join('')}
        </div>
        <div class="audience-count">
          <span class="count-pill">
            <strong id="audience-count">${fmtNumber(counts['all'] || 0)}</strong>
            User werden erreicht
          </span>
        </div>
      </div>

      <div class="form-row">
        <label class="form-label" for="bc-title">Titel <span class="label-hint">(max. 60)</span></label>
        <input id="bc-title" class="input" type="text" maxlength="60"
               placeholder="z.B. Neue Episode ist live 🎙️" />
        <div class="char-counter"><span id="title-count">0</span>/60</div>
      </div>

      <div class="form-row">
        <label class="form-label" for="bc-body">Nachricht <span class="label-hint">(max. 180)</span></label>
        <textarea id="bc-body" class="input textarea" maxlength="180" rows="3"
                  placeholder="Kurz, prägnant, mit einem Hook…"></textarea>
        <div class="char-counter"><span id="body-count">0</span>/180</div>
      </div>

      <div class="form-row">
        <label class="form-label" for="bc-link">Deep-Link <span class="label-hint">(optional)</span></label>
        <input id="bc-link" class="input" type="text"
               placeholder="podfluence://episode/123 oder https://…" />
      </div>

      <div class="preview-block">
        <div class="form-label">Vorschau</div>
        <div class="push-preview">
          <div class="push-preview-icon">${iconHtml('bell')}</div>
          <div class="push-preview-body">
            <div class="pp-app">PODFLUENCE · jetzt</div>
            <div class="pp-title" id="pp-title">Titel deiner Push</div>
            <div class="pp-text"  id="pp-text">Hier erscheint dein Nachrichtentext.</div>
          </div>
        </div>
      </div>

      <div class="form-actions">
        <button class="btn btn-ghost" id="btn-test">
          ${iconHtml('users')} Test an Beta-User
        </button>
        <button class="btn btn-primary btn-lg" id="btn-send" disabled>
          ${iconHtml('send')} An <span id="send-count">${fmtNumber(counts['all'] || 0)}</span> User senden
        </button>
      </div>
    </div>
  </div>`
}

function historyRow(h) {
  const deliveryRate = h.recipients ? Math.round((h.delivered || 0) / h.recipients * 100) : 0
  const openRate     = h.delivered  ? Math.round((h.opened    || 0) / h.delivered  * 100) : 0
  return `<tr data-id="${htmlEscape(String(h.id))}" class="row-clickable">
    <td>
      <div class="cell-title">${htmlEscape(h.title || '(ohne Titel)')}</div>
      <div class="cell-sub">${htmlEscape((h.body || '').slice(0, 80))}${(h.body || '').length > 80 ? '…' : ''}</div>
    </td>
    <td><span class="chip chip-soft">${htmlEscape(audienceLabel(h.audience))}</span></td>
    <td class="num">${fmtNumber(h.recipients || 0)}</td>
    <td class="num">
      <div class="bar-cell">
        <div class="bar-cell-fill" style="width:${deliveryRate}%;background:#34d399"></div>
        <span>${fmtNumber(h.delivered || 0)} · ${deliveryRate}%</span>
      </div>
    </td>
    <td class="num">
      <div class="bar-cell">
        <div class="bar-cell-fill" style="width:${openRate}%;background:#fbbf24"></div>
        <span>${fmtNumber(h.opened || 0)} · ${openRate}%</span>
      </div>
    </td>
    <td class="muted">${fmtDateTime(h.sent_at)}</td>
  </tr>`
}

function renderHistory(history) {
  if (!history.length) {
    return `<div class="glass-card">
      <h3 class="card-head-h3">${iconHtml('clock')} Verlauf</h3>
      <div class="history-empty">
        ${iconHtml('info')} Push-Verlauf nicht verfügbar — es existiert noch kein dediziertes <code>broadcast_push_log</code>.
        Versendete Pushes erscheinen erst, sobald ein RPC dafür angelegt wurde.
      </div>
    </div>`
  }
  return `<div class="glass-card">
    <div class="card-head">
      <h3>${iconHtml('clock')} Verlauf — letzte 10 Broadcasts <span class="muted" style="font-size:11px;font-weight:400;">(Quelle: email_broadcasts — Fallback bis push_log existiert)</span></h3>
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
            <th>Gesendet</th>
          </tr>
        </thead>
        <tbody>${history.map(historyRow).join('')}</tbody>
      </table>
    </div>
  </div>`
}

function renderCharts(history) {
  const byDay = {}
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 864e5)
    byDay[d.toISOString().slice(0, 10)] = { delivered: 0, opened: 0 }
  }
  for (const h of history) {
    const k = (h.sent_at || '').slice(0, 10)
    if (byDay[k]) {
      byDay[k].delivered += h.delivered || 0
      byDay[k].opened    += h.opened    || 0
    }
  }
  const labels    = Object.keys(byDay)
  const delivered = labels.map(l => byDay[l].delivered)
  const opened    = labels.map(l => byDay[l].opened)

  const audAgg = {}
  for (const h of history) {
    const key = h.audience || 'unknown'
    audAgg[key] = (audAgg[key] || 0) + (h.recipients || 0)
  }
  const audLabels = Object.keys(audAgg).map(audienceLabel)
  const audValues = Object.values(audAgg)

  return `<div class="chart-row">
    <div class="glass-card chart-card">
      <div class="card-head"><h3>${iconHtml('activity')} Zustellung & Öffnungen (14T)</h3></div>
      <div id="chart-deliver" class="chart-box"></div>
    </div>
    <div class="glass-card chart-card chart-card-sm">
      <div class="card-head"><h3>${iconHtml('pie-chart')} Audience-Verteilung</h3></div>
      <div id="chart-audience" class="chart-box"></div>
    </div>
  </div>
  <script type="application/json" id="chart-data">${JSON.stringify({ labels, delivered, opened, audLabels, audValues })}<\/script>`
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function styles() {
  return `<style>
    .panel-shell { display:flex; flex-direction:column; gap:20px; padding:20px 24px 40px; }
    .panel-head  { display:flex; justify-content:space-between; align-items:center; gap:16px; flex-wrap:wrap; }
    .panel-head h2 { margin:0; font-size:24px; font-weight:600; letter-spacing:-0.02em; display:flex; align-items:center; gap:10px; }
    .toolbar { display:flex; gap:8px; }
    .toolbar .btn { padding:8px 14px; }

    .hero-row { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:14px; }

    /* broadcast form */
    .broadcast-form .form-head h3 { margin:0 0 4px; font-size:18px; font-weight:600; display:flex; align-items:center; gap:8px; }
    .broadcast-form { padding:24px; }
    .form-sub  { margin:4px 0 0; color:var(--text-muted,#8a8a93); font-size:13px; }
    .form-grid { display:grid; gap:22px; margin-top:20px; }
    .form-row  { display:flex; flex-direction:column; gap:8px; position:relative; }
    .form-label { font-size:13px; font-weight:500; color:var(--text-secondary,#c0c0c8); }
    .label-hint { color:var(--text-muted,#8a8a93); font-weight:400; }

    .input { background:var(--input-bg,rgba(255,255,255,0.04)); border:1px solid var(--border,rgba(255,255,255,0.08)); color:var(--text,#fff); border-radius:10px; padding:11px 14px; font-size:14px; font-family:inherit; transition:border-color .15s,background .15s; width:100%; box-sizing:border-box; }
    .input:focus { outline:none; border-color:var(--accent,#7c5cff); background:rgba(255,255,255,0.06); }
    .textarea { resize:vertical; min-height:80px; line-height:1.5; }
    .char-counter { position:absolute; right:4px; bottom:-18px; font-size:11px; color:var(--text-muted,#8a8a93); }

    /* segmented audience picker */
    .seg-control { display:inline-flex; flex-wrap:wrap; background:rgba(255,255,255,0.04); border:1px solid var(--border,rgba(255,255,255,0.08)); border-radius:10px; padding:3px; gap:2px; }
    .seg-btn { background:transparent; border:none; color:var(--text-secondary,#c0c0c8); padding:7px 13px; border-radius:7px; font-size:13px; cursor:pointer; transition:all .15s; font-family:inherit; display:inline-flex; align-items:center; gap:5px; }
    .seg-btn:hover { color:#fff; background:rgba(255,255,255,0.04); }
    .seg-btn.active { background:var(--accent,#7c5cff); color:#fff; }
    .seg-count { font-size:11px; opacity:0.75; }

    .audience-count { margin-top:8px; }
    .count-pill { background:rgba(124,92,255,0.12); border:1px solid rgba(124,92,255,0.25); color:var(--accent,#a48dff); padding:6px 14px; border-radius:999px; font-size:13px; display:inline-flex; align-items:center; gap:4px; }
    .count-pill strong { font-weight:600; color:#fff; }

    /* live preview */
    .preview-block { margin-top:4px; }
    .push-preview { background:linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.03)); border:1px solid var(--border,rgba(255,255,255,0.08)); border-radius:14px; padding:14px 16px; display:flex; gap:12px; align-items:flex-start; max-width:440px; }
    .push-preview-icon { width:36px; height:36px; border-radius:9px; background:linear-gradient(135deg,#7c5cff,#ff5cc8); display:grid; place-items:center; flex-shrink:0; color:white; }
    .push-preview-body { flex:1; min-width:0; }
    .pp-app   { font-size:10px; letter-spacing:0.06em; text-transform:uppercase; color:var(--text-muted,#8a8a93); margin-bottom:2px; }
    .pp-title { font-size:14px; font-weight:600; color:#fff; margin-bottom:2px; word-break:break-word; }
    .pp-text  { font-size:13px; color:var(--text-secondary,#c0c0c8); line-height:1.35; word-break:break-word; }

    /* action row */
    .form-actions { display:flex; gap:10px; justify-content:flex-end; padding-top:12px; border-top:1px solid var(--border,rgba(255,255,255,0.06)); }

    /* buttons */
    .btn { display:inline-flex; align-items:center; gap:6px; border-radius:10px; padding:9px 16px; font-size:14px; font-weight:500; cursor:pointer; border:1px solid transparent; transition:all .15s; font-family:inherit; }
    .btn:disabled { opacity:0.45; cursor:not-allowed; pointer-events:none; }
    .btn-ghost   { background:transparent; border-color:var(--border,rgba(255,255,255,0.1)); color:var(--text,#fff); }
    .btn-ghost:hover { background:rgba(255,255,255,0.05); }
    .btn-primary { background:linear-gradient(135deg,#7c5cff,#5b3eff); color:white; box-shadow:0 4px 14px rgba(124,92,255,0.35); }
    .btn-primary:hover:not([disabled]) { transform:translateY(-1px); box-shadow:0 6px 20px rgba(124,92,255,0.45); }
    .btn-lg { padding:11px 22px; font-size:15px; }

    /* charts */
    .chart-row { display:grid; grid-template-columns:2fr 1fr; gap:16px; }
    @media (max-width:900px) { .chart-row { grid-template-columns:1fr; } }
    .chart-card { padding:20px; }
    .chart-box  { height:220px; }
    .card-head h3, .card-head-h3 { margin:0 0 14px; font-size:15px; font-weight:600; display:flex; align-items:center; gap:8px; }

    /* table */
    .table-wrap   { overflow-x:auto; }
    .data-table   { width:100%; border-collapse:collapse; font-size:13px; }
    .data-table th { text-align:left; font-weight:500; color:var(--text-muted,#8a8a93); padding:10px 12px; border-bottom:1px solid var(--border,rgba(255,255,255,0.08)); font-size:12px; text-transform:uppercase; letter-spacing:0.04em; }
    .data-table td { padding:12px; border-bottom:1px solid rgba(255,255,255,0.04); vertical-align:middle; }
    .data-table .num { text-align:right; }
    .data-table-hover tbody tr { transition:background .12s; cursor:pointer; }
    .data-table-hover tbody tr:hover { background:rgba(255,255,255,0.03); }
    .cell-title { font-weight:500; color:#fff; margin-bottom:2px; }
    .cell-sub   { font-size:12px; color:var(--text-muted,#8a8a93); }
    .chip       { display:inline-block; padding:3px 10px; border-radius:999px; font-size:11px; font-weight:500; }
    .chip-soft  { background:rgba(255,255,255,0.06); color:var(--text-secondary,#c0c0c8); }
    .bar-cell   { position:relative; min-width:110px; padding:4px 0; }
    .bar-cell-fill { position:absolute; left:0; top:0; bottom:0; opacity:0.18; border-radius:4px; transition:width .4s; }
    .bar-cell span { position:relative; z-index:1; font-variant-numeric:tabular-nums; }
    .muted { color:var(--text-muted,#8a8a93); }
    .history-empty { padding:28px 0; text-align:center; color:var(--text-muted,#8a8a93); font-size:13px; }
    .loading-wrap { padding:40px; text-align:center; color:var(--text-muted,#8a8a93); }
    .error-state { padding:24px; text-align:center; color:var(--text-muted,#8a8a93); }
  </style>`
}

// ─── Main export ──────────────────────────────────────────────────────────────

export default {
  id:       'push-broadcast',
  title:    'Push-Broadcast senden',
  category: 'admin_actions',

  async mount(container) {
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
        <div id="body"><div class="loading-wrap">${iconHtml('loader')} Lädt…</div></div>
      </div>`

    const bodyEl = container.querySelector('#body')

    const renderAll = async () => {
      bodyEl.innerHTML = `<div class="loading-wrap">${iconHtml('loader')} Lädt…</div>`

      let counts, history
      try {
        const [audienceResult, hist] = await Promise.all([
          fetchAudienceCounts(),
          fetchHistory()
        ])
        counts  = audienceResult.counts
        history = hist
      } catch (e) {
        bodyEl.innerHTML = `<div class="glass-card error-state">
          ${iconHtml('alert-triangle')} Daten konnten nicht geladen werden: ${htmlEscape(e?.message || 'Unbekannter Fehler')}
          <br><button class="btn btn-ghost" id="retry" style="margin-top:12px">Erneut versuchen</button>
        </div>`
        bodyEl.querySelector('#retry').onclick = renderAll
        return
      }

      bodyEl.innerHTML = `
        ${renderHero(history, counts['all'] || 0)}
        ${renderForm(counts)}
        ${renderCharts(history)}
        ${renderHistory(history)}
      `

      // ── charts ──
      try {
        const chartDataEl = bodyEl.querySelector('#chart-data')
        if (chartDataEl) {
          const cd = JSON.parse(chartDataEl.textContent)
          makeAreaChart(bodyEl.querySelector('#chart-deliver'), {
            categories: cd.labels,
            series: [
              { name: 'Zugestellt', data: cd.delivered },
              { name: 'Geöffnet',   data: cd.opened }
            ],
            colors: ['#34d399', '#fbbf24'],
            height: 220
          })
          if (cd.audValues.length) {
            makeDonutChart(bodyEl.querySelector('#chart-audience'), {
              labels: cd.audLabels,
              values: cd.audValues
            })
          } else {
            bodyEl.querySelector('#chart-audience').innerHTML =
              `<div class="history-empty" style="text-align:center;padding:24px 16px;color:var(--text-muted)">
                <div style="font-size:24px;opacity:.45;margin-bottom:6px">${iconHtml('pie-chart')}</div>
                <div style="font-weight:600;color:var(--text);margin-bottom:2px">Noch keine Audience-Verteilung</div>
                <div style="font-size:12px;line-height:1.4">Sobald Broadcasts mit Audience-Filter versendet wurden, erscheint hier die Aufteilung.</div>
              </div>`
          }
        }
      } catch (chartErr) {
        console.warn('[push-broadcast] chart init error:', chartErr)
        const deliverBox  = bodyEl.querySelector('#chart-deliver')
        const audienceBox = bodyEl.querySelector('#chart-audience')
        if (deliverBox)  deliverBox.innerHTML  = `<div class="history-empty">${iconHtml('alert-triangle')} Chart konnte nicht geladen werden.</div>`
        if (audienceBox) audienceBox.innerHTML = `<div class="history-empty">${iconHtml('alert-triangle')} Chart konnte nicht geladen werden.</div>`
      }

      // ── form state ──
      const state = { audience: 'all', title: '', body: '', deepLink: '' }

      const titleInput    = bodyEl.querySelector('#bc-title')
      const bodyInput     = bodyEl.querySelector('#bc-body')
      const linkInput     = bodyEl.querySelector('#bc-link')
      const titleCountEl  = bodyEl.querySelector('#title-count')
      const bodyCountEl   = bodyEl.querySelector('#body-count')
      const ppTitleEl     = bodyEl.querySelector('#pp-title')
      const ppTextEl      = bodyEl.querySelector('#pp-text')
      const audienceCount = bodyEl.querySelector('#audience-count')
      const sendCountEl   = bodyEl.querySelector('#send-count')
      const btnSend       = bodyEl.querySelector('#btn-send')
      const btnTest       = bodyEl.querySelector('#btn-test')

      const updateUI = () => {
        const ok = state.title.trim().length > 0 && state.body.trim().length > 0
        btnSend.disabled = !ok
        ppTitleEl.textContent = state.title || 'Titel deiner Push'
        ppTextEl.textContent  = state.body  || 'Hier erscheint dein Nachrichtentext.'
      }

      const refreshAudienceCount = () => {
        const c = counts[state.audience] || 0
        audienceCount.textContent = fmtNumber(c)
        sendCountEl.textContent   = fmtNumber(c)
      }

      // Audience segmented control
      bodyEl.querySelectorAll('.seg-btn').forEach(btn => {
        btn.onclick = () => {
          bodyEl.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'))
          btn.classList.add('active')
          state.audience = btn.dataset.v
          refreshAudienceCount()
        }
      })
      refreshAudienceCount()

      titleInput.oninput = () => {
        state.title = titleInput.value
        titleCountEl.textContent = state.title.length
        updateUI()
      }
      bodyInput.oninput = () => {
        state.body = bodyInput.value
        bodyCountEl.textContent = state.body.length
        updateUI()
      }
      linkInput.oninput = () => { state.deepLink = linkInput.value }

      // ── Test an Beta-User ──
      // The RPC has no single-user mode; beta is the smallest real audience segment.
      btnTest.onclick = async () => {
        if (!state.title.trim() || !state.body.trim()) {
          toast('Titel und Nachricht ausfüllen', 'warn')
          return
        }
        btnTest.disabled = true
        const origLabel = btnTest.innerHTML
        btnTest.innerHTML = `${iconHtml('loader')} Sende…`
        try {
          await doSendBroadcast({
            title:    '[TEST] ' + state.title,
            body:     state.body,
            audience: 'beta',
            deepLink: state.deepLink
          })
          toast('Test-Push an Beta-Audience versendet', 'success')
        } catch (e) {
          toast('Fehler: ' + (e.message || 'unbekannt'), 'error')
        }
        btnTest.disabled = false
        btnTest.innerHTML = origLabel
      }

      // ── An N User senden ──
      btnSend.onclick = async () => {
        const target = counts[state.audience] || 0
        if (!state.title.trim() || !state.body.trim()) {
          toast('Titel und Nachricht sind Pflichtfelder', 'warn')
          return
        }
        const ok = await confirmDialog({
          title: 'Broadcast versenden?',
          body: `Push wird an ${fmtNumber(target)} User (Audience: „${audienceLabel(state.audience)}") zugestellt. Diese Aktion lässt sich nicht rückgängig machen.`,
          confirmLabel: 'Jetzt senden',
          danger: false
        })
        if (!ok) return

        const origLabel = btnSend.innerHTML
        btnSend.disabled = true
        btnSend.innerHTML = `${iconHtml('loader')} Wird versendet…`

        try {
          await doSendBroadcast({
            title:    state.title,
            body:     state.body,
            audience: state.audience,
            deepLink: state.deepLink
          })
          toast(`Broadcast an ${fmtNumber(target)} User gestartet`, 'success')
          // Reset form
          titleInput.value = ''
          bodyInput.value  = ''
          linkInput.value  = ''
          state.title = ''; state.body = ''; state.deepLink = ''
          // Reload panel after short delay so history can update
          setTimeout(renderAll, 1200)
        } catch (e) {
          toast('Fehler beim Versenden: ' + (e.message || 'unbekannt'), 'error')
          btnSend.disabled = false
          btnSend.innerHTML = origLabel
        }
      }

      // ── History row click → drawer ──
      bodyEl.querySelectorAll('tbody tr.row-clickable').forEach(tr => {
        tr.onclick = () => {
          const id = tr.dataset.id
          const h  = history.find(x => String(x.id) === String(id))
          if (!h) return
          const deliveryRate = h.recipients ? Math.round((h.delivered || 0) / h.recipients * 100) : 0
          const openRate     = h.delivered  ? Math.round((h.opened    || 0) / h.delivered  * 100) : 0
          drawer({
            title:  'Broadcast-Details',
            width:  480,
            content: `
              <div style="display:flex;flex-direction:column;gap:18px;">
                <div>
                  <div class="form-label">Titel</div>
                  <div style="font-size:16px;font-weight:600;margin-top:4px;">${htmlEscape(h.title || '')}</div>
                </div>
                <div>
                  <div class="form-label">Nachricht</div>
                  <div style="margin-top:4px;line-height:1.5;">${htmlEscape(h.body || '')}</div>
                </div>
                ${h.deep_link ? `<div>
                  <div class="form-label">Deep-Link</div>
                  <code style="display:block;margin-top:4px;padding:8px;background:rgba(255,255,255,0.04);border-radius:6px;font-size:12px;word-break:break-all;">${htmlEscape(h.deep_link)}</code>
                </div>` : ''}
                <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;">
                  <div class="glass-card" style="padding:14px;text-align:center;">
                    <div style="font-size:11px;color:var(--text-muted,#8a8a93);text-transform:uppercase;margin-bottom:4px;">Empfänger</div>
                    <div style="font-size:22px;font-weight:600;">${fmtNumber(h.recipients || 0)}</div>
                  </div>
                  <div class="glass-card" style="padding:14px;text-align:center;">
                    <div style="font-size:11px;color:var(--text-muted,#8a8a93);text-transform:uppercase;margin-bottom:4px;">Zugestellt</div>
                    <div style="font-size:22px;font-weight:600;color:#34d399;">${fmtNumber(h.delivered || 0)}</div>
                    <div style="font-size:11px;color:var(--text-muted,#8a8a93);">${deliveryRate}%</div>
                  </div>
                  <div class="glass-card" style="padding:14px;text-align:center;">
                    <div style="font-size:11px;color:var(--text-muted,#8a8a93);text-transform:uppercase;margin-bottom:4px;">Geöffnet</div>
                    <div style="font-size:22px;font-weight:600;color:#fbbf24;">${fmtNumber(h.opened || 0)}</div>
                    <div style="font-size:11px;color:var(--text-muted,#8a8a93);">${openRate}%</div>
                  </div>
                </div>
                <div>
                  <div class="form-label">Audience</div>
                  <div style="margin-top:6px;"><span class="chip chip-soft">${htmlEscape(audienceLabel(h.audience))}</span></div>
                </div>
                <div>
                  <div class="form-label">Gesendet</div>
                  <div style="margin-top:4px;">${fmtDateTime(h.sent_at)}</div>
                </div>
              </div>
            `
          })
        }
      })
    }

    // toolbar
    container.querySelector('#btn-refresh').onclick = renderAll
    container.querySelector('#btn-pdf').onclick = () =>
      exportPanelAsPdf(container, { title: 'Push-Broadcasts' })
    container.querySelector('#btn-csv').onclick = async () => {
      const hist = await fetchHistory()
      exportCsv('push-broadcasts.csv', hist.map(h => ({
        sent_at:    h.sent_at,
        audience:   audienceLabel(h.audience),
        title:      h.title,
        body:       h.body,
        deep_link:  h.deep_link || '',
        recipients: h.recipients || 0,
        delivered:  h.delivered  || 0,
        opened:     h.opened     || 0
      })))
    }

    await renderAll()
  }
}
