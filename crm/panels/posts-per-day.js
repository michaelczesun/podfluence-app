import { sb } from '/lib/supabase.js?v=20260608c'
import { toast, fmtNumber, fmtDateTime, htmlEscape, iconHtml } from '/lib/ui.js?v=20260608c'
import { makeAreaChart, makeDonutChart } from '/lib/charts.js?v=20260608c'
import { exportPanelAsPdf, exportCsv } from '/lib/export.js?v=20260608c'
import { countUp, fadeIn, skeletonLoader } from '/lib/animations.js?v=20260608c'
import { drawer, tabs, segmentedControl, statHero, glassCard } from '/lib/layout-extras.js?v=20260608c'
import { showUserDetailModal } from '/lib/panel-actions.js?v=20260608c'

const TYPES = [
  { key: 'announcement', label: 'Ankündigung', color: '#6366f1' },
  { key: 'episode',      label: 'Episode',     color: '#10b981' },
  { key: 'poll',         label: 'Umfrage',     color: '#f59e0b' },
  { key: 'longform',     label: 'Longform',    color: '#ec4899' },
]

const RANGE_LABELS = { '7':  'Letzte 7 Tage', '30': 'Letzte 30 Tage', '90': 'Letzte 90 Tage' }

let state = {
  range: '30',
  raw: [],
  days: [],
  perType: {},
  totalsPerDay: [],
  totals: { total: 0, perType: {}, avg: 0, peakDay: null, peakCount: 0 },
}

function toISO(d) { return d.toISOString().slice(0, 10) }

function buildDayAxis(rangeDays) {
  const days = []
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  for (let i = rangeDays - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(today.getDate() - i)
    days.push(toISO(d))
  }
  return days
}

// FIX (high): Query updates directly to get real type data per row.
// The old admin_daily_series RPC only returns {date, value} — no type info —
// so synthetic rows all got type='announcement', breaking the stacked chart.
async function fetchData(rangeDays) {
  const today = new Date()
  today.setHours(23, 59, 59, 999)
  const start = new Date(today)
  start.setDate(today.getDate() - (rangeDays - 1))
  start.setHours(0, 0, 0, 0)

  const { data, error } = await sb
    .from('updates')
    .select('created_at, type')
    .gte('created_at', start.toISOString())
    .lte('created_at', today.toISOString())
    .order('created_at', { ascending: true })
  if (error) throw error
  return data || []
}

function aggregate(rows, rangeDays) {
  const days = buildDayAxis(rangeDays)
  const dayIndex = Object.fromEntries(days.map((d, i) => [d, i]))
  const perType = {}
  TYPES.forEach(t => { perType[t.key] = new Array(days.length).fill(0) })

  const totalsPerType = {}
  TYPES.forEach(t => { totalsPerType[t.key] = 0 })
  let total = 0
  const totalsPerDay = new Array(days.length).fill(0)

  for (const row of rows) {
    const day = (row.created_at || '').slice(0, 10)
    if (!(day in dayIndex)) continue
    const idx = dayIndex[day]
    const type = TYPES.some(t => t.key === row.type) ? row.type : 'announcement'
    perType[type][idx] += 1
    totalsPerType[type] += 1
    totalsPerDay[idx] += 1
    total += 1
  }

  let peakCount = 0, peakIdx = -1
  totalsPerDay.forEach((c, i) => { if (c > peakCount) { peakCount = c; peakIdx = i } })
  const avg = days.length ? +(total / days.length).toFixed(1) : 0

  return {
    days,
    perType,
    totalsPerDay,
    totals: {
      total,
      perType: totalsPerType,
      avg,
      peakDay: peakIdx >= 0 ? days[peakIdx] : null,
      peakCount,
    }
  }
}

async function fetchPostsForDay(day) {
  const start = day + 'T00:00:00.000Z'
  const end   = day + 'T23:59:59.999Z'
  // FK join: updates.user_id → users.id must exist in DB schema
  const { data, error } = await sb
    .from('updates')
    .select('id, user_id, content, type, created_at, users:user_id(id, username, full_name, avatar_url)')
    .gte('created_at', start)
    .lte('created_at', end)
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) throw error
  // Remap joined user into profiles key expected by drawer
  return (data || []).map(p => ({
    ...p,
    profiles: p.users || {},
  }))
}

function typeBadge(type) {
  const t = TYPES.find(x => x.key === type) || { label: type, color: '#64748b' }
  return `<span class="type-pill" style="background:${t.color}1a;color:${t.color};border:1px solid ${t.color}55">${htmlEscape(t.label)}</span>`
}

async function openDayDrawer(day) {
  const dr = drawer({
    title: `Posts am ${day}`,
    width: 560,
    content: `<div id="day-drawer-body">${skeletonLoader({ rows: 6, height: 56 })}</div>`,
  })
  try {
    const posts = await fetchPostsForDay(day)
    const body = document.getElementById('day-drawer-body')
    if (!body) return
    if (!posts.length) {
      body.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">${iconHtml('inbox')}</div>
          <h3>Keine Posts an diesem Tag</h3>
          <p>An ${htmlEscape(day)} wurde nichts veröffentlicht.</p>
        </div>`
      return
    }
    const byType = {}
    posts.forEach(p => { byType[p.type] = (byType[p.type] || 0) + 1 })
    const summary = TYPES.filter(t => byType[t.key])
      .map(t => `<span class="day-sum-pill" style="--c:${t.color}">${t.label} · <b>${byType[t.key]}</b></span>`)
      .join('')

    body.innerHTML = `
      <div class="day-summary glass-card">
        <div class="day-summary-total"><span class="big">${fmtNumber(posts.length)}</span> Posts insgesamt</div>
        <div class="day-summary-pills">${summary}</div>
      </div>
      <ul class="day-post-list">
        ${posts.map(p => {
          const prof = p.profiles || {}
          // FIX (low): display_name doesn't exist on users table — use full_name || username directly
          const name = htmlEscape(prof.full_name || prof.username || 'Unbekannt')
          const avatar = prof.avatar_url
            ? `<img src="${htmlEscape(prof.avatar_url)}" alt="" class="dp-avatar" />`
            : `<div class="dp-avatar dp-avatar-fallback">${name.slice(0, 1).toUpperCase()}</div>`
          // FIX (low): updates has no title field — use content directly
          const title = htmlEscape((p.content || '').slice(0, 90) || '(ohne Titel)')
          return `
            <li class="day-post-item" data-user="${htmlEscape(p.user_id || '')}">
              ${avatar}
              <div class="dp-main">
                <div class="dp-row1">
                  ${typeBadge(p.type)}
                  <span class="dp-time">${fmtDateTime(p.created_at)}</span>
                </div>
                <div class="dp-title">${title}</div>
                <div class="dp-meta">von <button class="dp-user" data-user="${htmlEscape(p.user_id || '')}">${name}</button></div>
              </div>
            </li>`
        }).join('')}
      </ul>
    `
    body.querySelectorAll('.dp-user').forEach(b => {
      b.addEventListener('click', e => {
        const uid = e.currentTarget.getAttribute('data-user')
        if (uid) showUserDetailModal(uid)
      })
    })
  } catch (err) {
    const body = document.getElementById('day-drawer-body')
    if (body) {
      body.innerHTML = `<div class="error-state"><p>${htmlEscape(err.message || 'Fehler beim Laden')}</p></div>`
    }
  }
  return dr
}

function renderHero(container) {
  const el = container.querySelector('#hero')
  if (!el) return
  el.innerHTML = `
    ${statHero({
      label: 'Posts im Zeitraum',
      value: '<span id="hero-total">0</span>',
      hint: `${RANGE_LABELS[state.range]} · Ø <span id="hero-avg">0</span>/Tag`,
      trend: state.totals.peakDay
        ? `Spitze: <b>${fmtNumber(state.totals.peakCount)}</b> am ${state.totals.peakDay}`
        : '—'
    })}
  `
  countUp(el.querySelector('#hero-total'), state.totals.total, { duration: 900 })
  countUp(el.querySelector('#hero-avg'),   state.totals.avg,   { duration: 900, decimals: 1 })
}

function renderChart(container) {
  const el = container.querySelector('#chart')
  if (!el) return
  el.innerHTML = ''
  const series = TYPES.map(t => ({
    name: t.label,
    color: t.color,
    data: state.perType[t.key],
  }))
  makeAreaChart(el, {
    categories: state.days,
    series,
    stacked: true,
    height: 320,
    formatX: v => v.slice(5),
    onPointClick: (idx) => {
      const day = state.days[idx]
      if (day) openDayDrawer(day)
    }
  })
}

function renderBreakdown(container) {
  const el = container.querySelector('#breakdown')
  if (!el) return
  const donutData = TYPES.map(t => ({
    label: t.label,
    value: state.totals.perType[t.key] || 0,
    color: t.color,
  }))
  const total = state.totals.total || 1
  el.innerHTML = `
    <div class="break-grid">
      <div class="break-donut" id="break-donut"></div>
      <ul class="break-list">
        ${TYPES.map(t => {
          const v = state.totals.perType[t.key] || 0
          const pct = ((v / total) * 100).toFixed(1)
          return `
            <li class="break-item">
              <span class="break-dot" style="background:${t.color}"></span>
              <span class="break-label">${t.label}</span>
              <span class="break-bar"><span class="break-bar-fill" style="width:${pct}%;background:${t.color}"></span></span>
              <span class="break-val"><b>${fmtNumber(v)}</b> <em>${pct}%</em></span>
            </li>`
        }).join('')}
      </ul>
    </div>
  `
  makeDonutChart(el.querySelector('#break-donut'), { data: donutData, size: 180, thickness: 22 })
}

function renderTopDays(container) {
  const el = container.querySelector('#topdays')
  if (!el) return
  const rows = state.days
    .map((d, i) => ({ day: d, count: state.totalsPerDay[i] }))
    .filter(r => r.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)

  if (!rows.length) {
    el.innerHTML = `
      <div class="empty-state subtle">
        <div class="empty-icon">${iconHtml('calendar')}</div>
        <h3>Keine aktiven Tage</h3>
        <p>Im gewählten Zeitraum gibt es keine Posts.</p>
      </div>`
    return
  }
  el.innerHTML = `
    <table class="data-table sortable hover">
      <thead><tr><th>Tag</th><th>Posts</th><th class="ta-right">Anteil</th><th></th></tr></thead>
      <tbody>
        ${rows.map(r => {
          const pct = ((r.count / (state.totals.total || 1)) * 100).toFixed(1)
          return `
            <tr class="td-row" data-day="${r.day}">
              <td><b>${r.day}</b></td>
              <td>${fmtNumber(r.count)}</td>
              <td class="ta-right">${pct}%</td>
              <td class="ta-right"><button class="btn-mini" data-day="${r.day}">Öffnen ›</button></td>
            </tr>`
        }).join('')}
      </tbody>
    </table>
  `
  el.querySelectorAll('.td-row, .btn-mini').forEach(node => {
    node.addEventListener('click', e => {
      const day = e.currentTarget.getAttribute('data-day')
      if (day) openDayDrawer(day)
    })
  })
}

function renderBody(container) {
  renderHero(container)
  renderChart(container)
  renderBreakdown(container)
  renderTopDays(container)
}

async function loadAndRender(container) {
  const body = container.querySelector('#body')
  if (!body) return
  body.innerHTML = `
    <div class="grid-skeleton">
      ${skeletonLoader({ rows: 1, height: 92 })}
      ${skeletonLoader({ rows: 1, height: 320 })}
      <div class="row2">
        ${skeletonLoader({ rows: 1, height: 240 })}
        ${skeletonLoader({ rows: 1, height: 240 })}
      </div>
    </div>`
  try {
    const rawResult = await fetchData(parseInt(state.range, 10))
    const agg = aggregate(rawResult, parseInt(state.range, 10))
    Object.assign(state, agg)
    body.innerHTML = `
      <div class="ppd-layout">
        <section class="glass-card" id="hero"></section>
        <section class="glass-card chart-card">
          <header class="card-head">
            <h3>Posts pro Tag · gestapelt nach Typ</h3>
            <div class="card-hint">Klick auf einen Tag öffnet die Post-Liste</div>
          </header>
          <div id="chart"></div>
          <div class="legend-row">
            ${TYPES.map(t => `<span class="lg-item"><span class="lg-dot" style="background:${t.color}"></span>${t.label}</span>`).join('')}
          </div>
        </section>
        <div class="row2">
          <section class="glass-card">
            <header class="card-head"><h3>Typ-Verteilung</h3></header>
            <div id="breakdown"></div>
          </section>
          <section class="glass-card">
            <header class="card-head"><h3>Top Tage</h3></header>
            <div id="topdays"></div>
          </section>
        </div>
      </div>`
    renderBody(container)
    fadeIn(body, { duration: 300 })
  } catch (err) {
    body.innerHTML = `
      <div class="error-state glass-card">
        <div class="empty-icon">${iconHtml('alert-triangle')}</div>
        <h3>Daten konnten nicht geladen werden</h3>
        <p>${htmlEscape(err.message || 'Unbekannter Fehler')}</p>
        <button class="btn-primary" id="retry">Erneut versuchen</button>
      </div>`
    body.querySelector('#retry')?.addEventListener('click', () => loadAndRender(container))
  }
}

function buildToolbar(container) {
  const tb = container.querySelector('#toolbar')
  if (!tb) return
  tb.innerHTML = `
    <div class="tb-left" id="range-seg"></div>
    <div class="tb-right">
      <button class="btn-ghost" id="btn-refresh" title="Aktualisieren">${iconHtml('refresh-cw')}<span>Aktualisieren</span></button>
      <button class="btn-ghost" id="btn-pdf"     title="Als PDF exportieren">${iconHtml('file-text')}<span>PDF</span></button>
      <button class="btn-ghost" id="btn-csv"     title="Als CSV exportieren">${iconHtml('download')}<span>CSV</span></button>
    </div>
  `
  segmentedControl(tb.querySelector('#range-seg'), {
    value: state.range,
    options: [
      { value: '7',  label: '7 Tage' },
      { value: '30', label: '30 Tage' },
      { value: '90', label: '90 Tage' },
    ],
    onChange: (v) => {
      state.range = v
      loadAndRender(container)
    },
  })
  tb.querySelector('#btn-refresh').addEventListener('click', () => {
    loadAndRender(container)
    toast('Daten werden aktualisiert', { type: 'info' })
  })
  tb.querySelector('#btn-pdf').addEventListener('click', async () => {
    try {
      await exportPanelAsPdf(container, { filename: `posts-pro-tag-${state.range}d.pdf`, title: 'Posts pro Tag' })
      toast('PDF erstellt', { type: 'success' })
    } catch (e) { toast('PDF-Export fehlgeschlagen', { type: 'error' }) }
  })
  tb.querySelector('#btn-csv').addEventListener('click', () => {
    const rows = state.days.map((d, i) => {
      const o = { tag: d, total: state.totalsPerDay[i] }
      TYPES.forEach(t => { o[t.key] = state.perType[t.key][i] })
      return o
    })
    exportCsv(rows, { filename: `posts-pro-tag-${state.range}d.csv` })
    toast('CSV heruntergeladen', { type: 'success' })
  })
}

// FIX (high): Named const export so retry callback can reference `panel` instead of `this`
// (which would be `window` in an event listener context on a plain-object export).
const panel = {
  id: 'posts-per-day',
  title: 'Posts pro Tag',
  category: 'content',
  async mount(container) {
    try {
    container.innerHTML = `
      <div class="panel-shell ppd-panel">
        <div class="panel-head">
          <div class="head-titles">
            <h2>Posts pro Tag</h2>
            <p class="subtle">Veröffentlichungen gestapelt nach Typ</p>
          </div>
          <div class="toolbar" id="toolbar"></div>
        </div>
        <div class="panel-body" id="body"></div>
      </div>
      <style>
        .ppd-panel .panel-head{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;flex-wrap:wrap;margin-bottom:18px}
        .ppd-panel .head-titles h2{margin:0;font-size:24px;font-weight:600;letter-spacing:-0.02em}
        .ppd-panel .head-titles .subtle{margin:4px 0 0;color:var(--muted,#94a3b8);font-size:13px}
        .ppd-panel .toolbar{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
        .ppd-panel .tb-right{display:flex;gap:6px}
        .ppd-panel .btn-ghost{display:inline-flex;align-items:center;gap:6px;padding:8px 12px;border-radius:10px;border:1px solid var(--border,#1f2937);background:transparent;color:var(--fg,#e2e8f0);cursor:pointer;font-size:13px;transition:.15s}
        .ppd-panel .btn-ghost:hover{background:var(--hover,#1e293b);border-color:var(--border-strong,#334155)}
        .ppd-layout{display:flex;flex-direction:column;gap:16px}
        .ppd-layout .row2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
        @media(max-width:900px){.ppd-layout .row2{grid-template-columns:1fr}}
        .glass-card{padding:18px;border-radius:16px}
        .chart-card .card-head{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px}
        .chart-card .card-hint{font-size:12px;color:var(--muted,#94a3b8)}
        .card-head h3{margin:0 0 12px;font-size:15px;font-weight:600}
        .legend-row{display:flex;gap:14px;flex-wrap:wrap;margin-top:10px;padding-top:10px;border-top:1px solid var(--border,#1f2937)}
        .lg-item{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--muted,#94a3b8)}
        .lg-dot{width:10px;height:10px;border-radius:3px}
        .break-grid{display:grid;grid-template-columns:200px 1fr;gap:18px;align-items:center}
        @media(max-width:700px){.break-grid{grid-template-columns:1fr}}
        .break-list{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:10px}
        .break-item{display:grid;grid-template-columns:10px 90px 1fr 110px;align-items:center;gap:10px;font-size:13px}
        .break-dot{width:10px;height:10px;border-radius:3px}
        .break-bar{height:6px;background:var(--bar-bg,#1e293b);border-radius:99px;overflow:hidden}
        .break-bar-fill{display:block;height:100%;border-radius:99px;transition:width .6s ease}
        .break-val{text-align:right;color:var(--muted,#94a3b8)}
        .break-val b{color:var(--fg,#e2e8f0);margin-right:4px}
        .break-val em{font-style:normal;opacity:.7}
        .data-table.hover tbody tr{cursor:pointer;transition:.12s}
        .data-table.hover tbody tr:hover{background:var(--hover,#1e293b)}
        .ta-right{text-align:right}
        .btn-mini{padding:4px 10px;border-radius:8px;border:1px solid var(--border,#1f2937);background:transparent;color:var(--fg,#e2e8f0);font-size:12px;cursor:pointer}
        .btn-mini:hover{background:var(--hover,#1e293b)}
        .empty-state{text-align:center;padding:40px 20px;color:var(--muted,#94a3b8)}
        .empty-state h3{margin:8px 0 4px;color:var(--fg,#e2e8f0);font-size:15px}
        .empty-state.subtle{padding:24px}
        .empty-icon{font-size:28px;opacity:.5}
        .error-state{text-align:center;padding:40px 20px}
        .error-state h3{margin:10px 0 4px}
        .btn-primary{margin-top:10px;padding:8px 16px;border-radius:10px;border:0;background:var(--accent,#6366f1);color:#fff;cursor:pointer;font-size:13px}
        .day-summary{display:flex;justify-content:space-between;align-items:center;padding:14px 16px;margin-bottom:14px}
        .day-summary-total .big{font-size:22px;font-weight:600;margin-right:6px}
        .day-summary-pills{display:flex;gap:6px;flex-wrap:wrap}
        .day-sum-pill{font-size:11px;padding:3px 8px;border-radius:99px;background:color-mix(in srgb,var(--c) 12%,transparent);color:var(--c);border:1px solid color-mix(in srgb,var(--c) 40%,transparent)}
        .day-post-list{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:8px}
        .day-post-item{display:grid;grid-template-columns:40px 1fr;gap:12px;padding:12px;border-radius:12px;border:1px solid var(--border,#1f2937);background:var(--card,#0f172a)}
        .dp-avatar{width:40px;height:40px;border-radius:50%;object-fit:cover}
        .dp-avatar-fallback{display:flex;align-items:center;justify-content:center;background:var(--accent,#6366f1);color:#fff;font-weight:600;font-size:14px}
        .dp-row1{display:flex;align-items:center;gap:8px;font-size:11px;color:var(--muted,#94a3b8)}
        .dp-time{margin-left:auto}
        .dp-title{margin-top:4px;font-size:13px;font-weight:500;line-height:1.4}
        .dp-meta{margin-top:4px;font-size:11px;color:var(--muted,#94a3b8)}
        .dp-user{background:none;border:0;padding:0;color:var(--accent,#818cf8);cursor:pointer;font-size:11px}
        .dp-user:hover{text-decoration:underline}
        .type-pill{font-size:10px;padding:2px 7px;border-radius:99px;font-weight:600;letter-spacing:.02em;text-transform:uppercase}
        .grid-skeleton{display:flex;flex-direction:column;gap:14px}
        .grid-skeleton .row2{display:grid;grid-template-columns:1fr 1fr;gap:14px}
        @media(max-width:900px){.grid-skeleton .row2{grid-template-columns:1fr}}
      </style>
    `
    buildToolbar(container)
    await loadAndRender(container)
    fadeIn(container.querySelector('.ppd-panel'), { duration: 250 })
    } catch (err) {
      container.innerHTML = `
        <div class="error-state glass-card" style="text-align:center;padding:40px 20px;border-radius:16px;border:1px solid #1f2937">
          <h3 style="margin:10px 0 4px">Panel konnte nicht initialisiert werden</h3>
          <p style="color:#94a3b8">${(err && err.message) ? String(err.message).replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c])) : 'Unbekannter Fehler beim Mount'}</p>
          <button class="btn-primary" id="mount-retry" style="margin-top:10px;padding:8px 16px;border-radius:10px;border:0;background:#6366f1;color:#fff;cursor:pointer">Erneut versuchen</button>
        </div>`
      const retry = container.querySelector('#mount-retry')
      // FIX (high): use panel.mount() instead of this.mount() — `this` in event listener is window
      if (retry) retry.addEventListener('click', () => {
        try { panel.mount(container) } catch (_) {}
      })
    }
  }
}

export default panel
