import { sb } from '/lib/supabase.js?v=20260608k'
import { toast, fmtNumber, fmtDateTime, htmlEscape, iconHtml, debounce } from '/lib/ui.js?v=20260608k'
import { makeAreaChart, makeLineChart, makeSparkline } from '/lib/charts.js?v=20260608k'
import { exportPanelAsPdf, exportCsv } from '/lib/export.js?v=20260608k'
import { countUp, fadeIn, pulse } from '/lib/animations.js?v=20260608k'
import { drawer } from '/lib/layout-extras.js?v=20260608k'

const REFRESH_MS = 60_000

const KPI_DEFS = [
  { key: 'total_users',      label: 'User gesamt',        icon: 'users',     color: '#7C5CFF', fmt: 'int',   sparkMetric: 'signups',          warnBelow: null, alertChangePct: 50, alertMinPrev: 5 },
  { key: 'active_24h',       label: 'Aktiv (24h)',        icon: 'activity',  color: '#22D3EE', fmt: 'int',   sparkMetric: 'app_opens',        warnBelow: 3,    alertChangePct: 50, alertMinPrev: 5 },
  { key: 'posts_24h',        label: 'Beiträge (24h)',     icon: 'message',   color: '#F59E0B', fmt: 'int',   sparkMetric: 'posts',            warnBelow: null, alertChangePct: 50, alertMinPrev: 5 },
  { key: 'listening_hours',  label: 'Hörstunden (24h)',   icon: 'headphones',color: '#10B981', fmt: 'hours', sparkMetric: 'listening_hours',  warnBelow: null, alertChangePct: 50, alertMinPrev: 5 }
]

const SPARK_DAYS = 7

async function fetchSparkData(def) {
  const since = new Date(Date.now() - SPARK_DAYS * 86_400_000).toISOString()
  try {
    if (def.sparkMetric === 'app_opens') {
      const { data } = await sb.from('app_opens').select('created_at').gte('created_at', since).limit(5000)
      const rows = bucketByDay(data || [], 'created_at', SPARK_DAYS, false)
      return rows.map(r => r.value)
    }
    if (def.sparkMetric === 'listening_hours') {
      const { data } = await sb.from('listening_activity').select('created_at,listened_ms').gte('created_at', since).limit(5000)
      const rows = bucketByDay(data || [], 'created_at', SPARK_DAYS, false, r => Number(r.listened_ms || 0) / 3600000)
      return rows.map(r => r.value)
    }
    if (def.sparkMetric === 'signups' || def.sparkMetric === 'posts') {
      const { data } = await sb.rpc('admin_daily_series', { p_metric: def.sparkMetric, p_days: SPARK_DAYS })
      return (data || []).map(d => Number(d.value) || 0)
    }
  } catch (_) {}
  return []
}

async function fetchTotals() {
  // Try dedicated RPC first
  try {
    const { data, error } = await sb.rpc('admin_db_live_stats')
    if (!error && data) {
      const r = Array.isArray(data) ? data[0] : data
      if (r && (r.total_users != null || r.active_24h != null)) return normalize(r)
    }
  } catch (_) {}

  const today = new Date()
  const dayBefore = new Date(today.getTime() - 2 * 86_400_000)
  const since24h = new Date(today.getTime() - 86_400_000).toISOString()
  const since48h = dayBefore.toISOString()

  const safe = (p) => p.then(r => r).catch(() => ({ count: 0, data: null }))

  // Schema-Truth: app_opens hat KEIN user_id (nur device_fp) → reine event-counts.
  // listening_activity.listened_ms ist die echte Hör-Quelle.
  const [active24, activeYday, listenRows, listenRowsYday] = await Promise.all([
    safe(sb.from('app_opens').select('id', { count: 'exact', head: true }).gte('created_at', since24h)),
    safe(sb.from('app_opens').select('id', { count: 'exact', head: true }).gte('created_at', since48h).lt('created_at', since24h)),
    safe(sb.from('listening_activity').select('listened_ms,created_at').gte('created_at', since24h).limit(5000)),
    safe(sb.from('listening_activity').select('listened_ms,created_at').gte('created_at', since48h).lt('created_at', since24h).limit(5000))
  ])

  const sumMs = (rows) => (rows || []).reduce((a, r) => a + Number(r.listened_ms || 0), 0)
  const totalListenSec = sumMs(listenRows?.data) / 1000
  const ydayListenSec  = sumMs(listenRowsYday?.data) / 1000

  // FIX(high): total_users — direct COUNT on users table, not sum of 60-day signups
  // FIX(high): total_posts — direct COUNT on updates table, not last daily_series value
  let totalUsers = 0, ydayUsers = 0, totalPosts = 0, ydayPosts = 0
  try {
    const [usersCountRes, postsCountRes, usersSeriesRes, postsSeriesRes] = await Promise.all([
      sb.from('users').select('id', { count: 'exact', head: true }),
      sb.from('updates').select('id', { count: 'exact', head: true }),
      sb.rpc('admin_daily_series', { p_metric: 'signups', p_days: 2 }),
      sb.rpc('admin_daily_series', { p_metric: 'posts', p_days: 2 })
    ])

    if (!usersCountRes.error) {
      totalUsers = usersCountRes.count ?? 0
      // FIX(med): ydayUsers = totalUsers minus today's signups (not totalUsers - lastDay)
      if (!usersSeriesRes.error && usersSeriesRes.data) {
        const vals = usersSeriesRes.data.map(d => Number(d.value) || 0)
        // vals[-1] = heute, vals[-2] = gestern → ydayUsers = total minus heutige Signups
        ydayUsers = totalUsers - (vals[vals.length - 1] || 0)
      } else {
        ydayUsers = totalUsers
      }
    }

    if (!postsCountRes.error) {
      totalPosts = postsCountRes.count ?? 0
      // ydayPosts = totalPosts minus heutige Posts
      if (!postsSeriesRes.error && postsSeriesRes.data) {
        const vals = postsSeriesRes.data.map(d => Number(d.value) || 0)
        ydayPosts = totalPosts - (vals[vals.length - 1] || 0)
      } else {
        ydayPosts = totalPosts
      }
    }
  } catch (_) {}

  return {
    total_users:      { value: totalUsers, prev: ydayUsers },
    active_24h:       { value: active24.count ?? 0, prev: activeYday.count ?? 0 },
    posts_24h:        { value: totalPosts, prev: ydayPosts },
    listening_hours:  { value: Math.round(totalListenSec / 3600), prev: Math.round(ydayListenSec / 3600) }
  }
}

function normalize(raw) {
  const out = {}
  for (const def of KPI_DEFS) {
    const v = raw[def.key]
    if (v && typeof v === 'object' && 'value' in v) {
      out[def.key] = { value: Number(v.value) || 0, prev: Number(v.prev) || 0 }
    } else {
      out[def.key] = {
        value: Number(raw[def.key]) || 0,
        prev: Number(raw[`${def.key}_prev`] ?? raw[`${def.key}_yday`]) || 0
      }
    }
  }
  return out
}

async function fetchTimeSeries(kpiKey, days = 30) {
  // No crm_kpi_timeseries RPC in schema — skip RPC, go direct
  const since = new Date(Date.now() - days * 86_400_000).toISOString()
  // FIX(high): .limit() on all direct-table queries to prevent massive data transfer
  const SERIES_LIMIT = 5000
  let rows = []
  try {
    if (kpiKey === 'active_24h') {
      const { data } = await sb.from('app_opens').select('created_at').gte('created_at', since).limit(SERIES_LIMIT)
      rows = bucketByDay(data || [], 'created_at', days, false)
    } else if (kpiKey === 'listening_hours') {
      const { data } = await sb.from('listening_activity').select('created_at,listened_ms').gte('created_at', since).limit(SERIES_LIMIT)
      rows = bucketByDay(data || [], 'created_at', days, false, r => Number(r.listened_ms || 0) / 3600000)
    } else if (kpiKey === 'total_users' || kpiKey === 'posts_24h') {
      // nutze admin_daily_series RPC die RLS via SECURITY DEFINER bypasst
      const metric = kpiKey === 'total_users' ? 'signups' : 'posts'
      const { data } = await sb.rpc('admin_daily_series', { p_metric: metric, p_days: days })
      // cumulative = true für total_users (jeder neue User = +1 zum Total)
      const isCum = kpiKey === 'total_users'
      let acc = 0
      rows = (data || []).map(d => {
        const v = Number(d.value) || 0
        if (isCum) { acc += v; return { date: d.date, value: acc } }
        return { date: d.date, value: v }
      })
    } else {
      rows = []
    }
  } catch (_) {}
  return rows
}

function bucketByDay(rows, dateField, days, cumulative, valueFn) {
  const buckets = new Map()
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86_400_000)
    buckets.set(d.toISOString().slice(0, 10), 0)
  }
  for (const r of rows) {
    const k = (r[dateField] || '').slice(0, 10)
    if (!buckets.has(k)) continue
    buckets.set(k, buckets.get(k) + (valueFn ? valueFn(r) : 1))
  }
  let acc = 0
  return [...buckets.entries()].map(([date, value]) => {
    if (cumulative) { acc += value; return { date, value: acc } }
    return { date, value: Math.round(value) }
  })
}

function pctChange(curr, prev) {
  if (!prev || prev === 0) return curr > 0 ? 100 : 0
  return ((curr - prev) / prev) * 100
}

function formatValue(val, fmt) {
  if (fmt === 'hours') return fmtNumber(val) + ' h'
  return fmtNumber(val)
}

function isAlertChange(def, change, prev) {
  return Math.abs(change) > (def.alertChangePct ?? 50) && prev > (def.alertMinPrev ?? 5)
}

function isLowActivityWarn(def, value) {
  return def.warnBelow != null && value < def.warnBelow
}

function renderHeroGrid(totals) {
  return `<div class="hero-grid" id="hero-grid">
    ${KPI_DEFS.map(def => {
      const t = totals[def.key] || { value: 0, prev: 0 }
      const change = pctChange(t.value, t.prev)
      const dir = change > 0 ? 'up' : change < 0 ? 'down' : 'flat'
      const arrowIcon = dir === 'up' ? 'trending-up' : dir === 'down' ? 'trending-down' : 'minus'
      const sign = change > 0 ? '+' : ''
      const alert = isAlertChange(def, change, t.prev)
      const warn = isLowActivityWarn(def, t.value)
      return `
      <div class="stat-hero glass-card kpi-card${alert ? ' kpi-alert' : ''}${warn ? ' kpi-warn' : ''}" data-kpi="${def.key}" role="button" tabindex="0"
           style="--accent:${def.color}">
        ${warn ? `<span class="kpi-warn-badge" title="Wenig Aktivität heute">${iconHtml('alert-triangle')} Wenig Aktivität</span>` : ''}
        <div class="kpi-card-head">
          <span class="kpi-icon" style="background:${def.color}22;color:${def.color}">${iconHtml(def.icon)}</span>
          <span class="kpi-label">${htmlEscape(def.label)}</span>
        </div>
        <div class="kpi-value" id="kpi-val-${def.key}" data-fmt="${def.fmt}">${formatValue(t.value, def.fmt)}</div>
        <div class="kpi-spark" data-kpi="${def.key}" id="kpi-spark-${def.key}"></div>
        <div class="kpi-change ${dir}">
          ${iconHtml(arrowIcon)}
          <span>${sign}${change.toFixed(1)}%</span>
          <span class="kpi-change-sub">vs gestern</span>
        </div>
        <div class="kpi-card-foot">
          <span class="kpi-hint">${iconHtml('bar-chart')} 30-Tage-Verlauf öffnen</span>
        </div>
      </div>`
    }).join('')}
  </div>`
}

async function renderSparklines(container) {
  await Promise.all(KPI_DEFS.map(async def => {
    const el = container.querySelector(`#kpi-spark-${def.key}`)
    if (!el) return
    try {
      const vals = await fetchSparkData(def)
      if (!vals || vals.length === 0) { el.innerHTML = ''; return }
      el.innerHTML = ''
      try { makeSparkline(el, { values: vals, color: def.color, height: 28 }) }
      catch (_) { el.innerHTML = '' }
    } catch (_) {}
  }))
}

function styles() {
  return `<style>
    .panel-shell { display:flex; flex-direction:column; gap:20px; padding:20px; }
    .panel-head { display:flex; justify-content:space-between; align-items:center; gap:16px; flex-wrap:wrap; }
    .panel-head h2 { font-size:22px; font-weight:700; margin:0; letter-spacing:-0.02em; }
    .panel-head .sub { font-size:13px; color:var(--text-muted,#8b8b9a); margin-top:4px; }
    .toolbar { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
    .toolbar button { display:inline-flex; align-items:center; gap:6px; padding:8px 14px;
      border-radius:10px; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08);
      color:inherit; font-size:13px; font-weight:500; cursor:pointer; transition:all .15s; }
    .toolbar button:hover { background:rgba(255,255,255,0.08); transform:translateY(-1px); }
    .toolbar button:disabled { opacity:0.5; cursor:not-allowed; pointer-events:none; }
    .toolbar .live-dot { display:inline-flex; align-items:center; gap:6px; padding:6px 10px;
      border-radius:999px; background:rgba(34,197,94,0.1); color:#22c55e; font-size:12px; font-weight:600; }
    .toolbar .live-dot::before { content:''; width:7px; height:7px; border-radius:50%;
      background:#22c55e; box-shadow:0 0 8px #22c55e; animation:livepulse 1.4s ease-in-out infinite; }
    @keyframes livepulse { 0%,100%{opacity:1} 50%{opacity:0.3} }

    .hero-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(250px, 1fr)); gap:18px; }
    .kpi-card { padding:24px 22px 18px; border-radius:18px; cursor:pointer; position:relative;
      overflow:hidden; transition:transform .2s ease, box-shadow .2s ease;
      background:
        radial-gradient(130% 90% at 0% 0%, color-mix(in srgb, var(--accent) 12%, transparent), transparent 55%),
        linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.012)),
        rgba(22,22,29,0.62);
      backdrop-filter: blur(22px) saturate(180%);
      -webkit-backdrop-filter: blur(22px) saturate(180%);
      border:1px solid color-mix(in srgb, var(--accent) 22%, rgba(255,255,255,0.06));
      box-shadow:
        inset 0 1px 0 rgba(255,255,255,0.06),
        inset 0 0 24px color-mix(in srgb, var(--accent) 10%, transparent),
        0 10px 30px rgba(0,0,0,0.32); }
    .kpi-card::before { content:''; position:absolute; top:0; left:0; right:0; height:1px;
      background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--accent) 75%, transparent), transparent); }
    .kpi-card:hover { transform:translateY(-3px);
      box-shadow:
        inset 0 1px 0 rgba(255,255,255,0.08),
        inset 0 0 28px color-mix(in srgb, var(--accent) 14%, transparent),
        0 14px 40px rgba(0,0,0,0.4),
        0 0 0 1px color-mix(in srgb, var(--accent) 60%, transparent); }
    .kpi-card.pulsing { animation:kpipulse 1.2s ease-out; }
    .kpi-card.kpi-alert {
      box-shadow:
        inset 0 0 0 1px var(--accent),
        inset 0 0 28px color-mix(in srgb, var(--accent) 22%, transparent),
        0 0 22px -4px var(--accent),
        0 8px 28px rgba(0,0,0,0.35); }
    .kpi-card.kpi-alert::before { height:2px; opacity:1; box-shadow:0 0 14px var(--accent); }
    .kpi-warn-badge { position:absolute; top:12px; right:12px; display:inline-flex; align-items:center; gap:4px;
      padding:4px 8px; border-radius:999px; font-size:11px; font-weight:600;
      background:rgba(249,115,22,0.15); color:#fb923c; border:1px solid rgba(249,115,22,0.3); cursor:help; z-index:2; }
    .kpi-spark { margin:-4px 0 10px; height:28px; min-height:28px; opacity:0.55; position:relative; z-index:0; }
    .kpi-spark:empty { display:none; }
    @keyframes kpipulse { 0%{box-shadow:0 0 0 0 var(--accent)} 50%{box-shadow:0 0 0 14px transparent} 100%{box-shadow:0 0 0 0 transparent} }
    .kpi-card-head { display:flex; align-items:center; gap:10px; margin-bottom:14px; position:relative; z-index:1; }
    .kpi-icon { display:inline-flex; width:36px; height:36px; border-radius:10px; align-items:center; justify-content:center;
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 30%, transparent); }
    .kpi-label { font-size:11px; font-weight:600; color:var(--text-muted,#9ca3af);
      text-transform:uppercase; letter-spacing:0.14em; }
    .kpi-value { font-size:48px; font-weight:700; letter-spacing:-2px; line-height:1.05;
      font-variant-numeric:tabular-nums; font-feature-settings:"tnum" 1,"lnum" 1;
      margin-bottom:10px; position:relative; z-index:1;
      text-shadow: 0 1px 0 rgba(0,0,0,0.25); }
    .kpi-change { display:inline-flex; align-items:center; gap:6px; font-size:12px; font-weight:700;
      font-variant-numeric:tabular-nums; letter-spacing:0.02em; position:relative; z-index:1;
      padding:4px 10px; border-radius:999px; }
    .kpi-change.up { color:#4ADE80; background:rgba(34,197,94,0.14); box-shadow: inset 0 0 0 1px rgba(34,197,94,0.28); }
    .kpi-change.down { color:#F87171; background:rgba(239,68,68,0.14); box-shadow: inset 0 0 0 1px rgba(239,68,68,0.28); }
    .kpi-change.flat { color:#94A3B8; background:rgba(148,163,184,0.14); box-shadow: inset 0 0 0 1px rgba(148,163,184,0.24); }
    .kpi-change-sub { color:var(--text-muted,#9ca3af); font-weight:500; margin-left:4px; letter-spacing:0; }
    .kpi-card-foot { margin-top:16px; padding-top:14px; border-top:1px solid rgba(255,255,255,0.05); font-size:12px; color:var(--text-muted,#9ca3af); }
    .kpi-hint { display:inline-flex; align-items:center; gap:6px; }

    .skeleton-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(250px, 1fr)); gap:18px; }
    .skel-card { height:180px; border-radius:18px;
      background:linear-gradient(90deg, rgba(255,255,255,0.04), rgba(255,255,255,0.08), rgba(255,255,255,0.04));
      background-size:200% 100%; animation:shimmer 1.6s linear infinite; }
    @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }

    .error-state, .empty-state { text-align:center; padding:60px 20px;
      background:rgba(255,255,255,0.02); border-radius:18px; border:1px dashed rgba(255,255,255,0.08); }
    .error-state .icon, .empty-state .icon { font-size:42px; opacity:0.5; margin-bottom:12px; }
    .error-state h3, .empty-state h3 { font-size:18px; margin:0 0 6px; }
    .error-state p, .empty-state p { color:var(--text-muted,#9ca3af); margin:0 0 16px; }
    .retry-btn { padding:10px 20px; border-radius:10px; background:#7C5CFF; color:#fff; border:none; font-weight:600; cursor:pointer; }

    .drawer-content { padding:24px; }
    .drawer-content h3 { font-size:20px; margin:0 0 4px; }
    .drawer-content .sub { color:var(--text-muted,#9ca3af); font-size:13px; margin-bottom:20px; }
    .drawer-summary { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; margin-bottom:20px; }
    .drawer-summary .cell { padding:14px; border-radius:12px; background:rgba(255,255,255,0.04); }
    .drawer-summary .cell .lbl { font-size:11px; color:var(--text-muted,#9ca3af); text-transform:uppercase; letter-spacing:0.06em; }
    .drawer-summary .cell .val { font-size:20px; font-weight:700; margin-top:4px; font-variant-numeric:tabular-nums; }
    .chart-wrap { background:rgba(255,255,255,0.02); border-radius:14px; padding:16px; border:1px solid rgba(255,255,255,0.05); min-height:320px; }
  </style>`
}

function toolbarHtml() {
  return `
    <div class="toolbar">
      <span class="live-dot" id="live-dot">Live</span>
      <button id="btn-refresh" title="Aktualisieren">${iconHtml('refresh')} Aktualisieren</button>
      <button id="btn-pdf" title="Als PDF exportieren">${iconHtml('file-text')} PDF</button>
      <button id="btn-csv" title="Als CSV exportieren">${iconHtml('download')} CSV</button>
    </div>`
}

async function renderDrilldown(def, totals, onClose) {
  const body = document.createElement('div')
  body.className = 'drawer-content'
  body.innerHTML = `
    <h3>${htmlEscape(def.label)} — 30 Tage</h3>
    <div class="sub">Lade historische Daten …</div>
    <div class="chart-wrap" id="drill-chart"><div class="skel-card" style="height:280px"></div></div>`

  // FIX(med): store drawer close function for cleanup
  let closeDrawer = null
  try {
    const drawerResult = drawer({ title: def.label, content: body, width: 720 })
    // drawer() may return a close function or an object with close()
    if (typeof drawerResult === 'function') closeDrawer = drawerResult
    else if (drawerResult && typeof drawerResult.close === 'function') closeDrawer = drawerResult.close.bind(drawerResult)
    if (onClose) onClose(closeDrawer)
  }
  catch (e) { toast('Drawer konnte nicht geöffnet werden', 'error'); return }

  let series = []
  try { series = await fetchTimeSeries(def.key, 30) }
  catch (_) { series = [] }

  const valuesOnly = series.map(s => s.value)
  const avg = valuesOnly.length ? Math.round(valuesOnly.reduce((a,b)=>a+b,0) / valuesOnly.length) : 0
  const t = totals[def.key] || { value: 0, prev: 0 }
  const change = pctChange(t.value, t.prev)

  body.innerHTML = `
    <h3>${htmlEscape(def.label)} — 30 Tage</h3>
    <div class="sub">Historischer Verlauf · Stand ${fmtDateTime(new Date())}</div>
    <div class="drawer-summary">
      <div class="cell"><div class="lbl">Aktuell</div><div class="val">${formatValue(t.value, def.fmt)}</div></div>
      <div class="cell"><div class="lbl">Schnitt 30T</div><div class="val">${formatValue(avg, def.fmt)}</div></div>
      <div class="cell"><div class="lbl">vs gestern</div><div class="val" style="color:${change>=0?'#22c55e':'#ef4444'}">${change>=0?'+':''}${change.toFixed(1)}%</div></div>
    </div>
    <div class="chart-wrap" id="drill-chart"></div>
    <div style="margin-top:20px; display:flex; gap:8px; justify-content:flex-end;">
      <button class="retry-btn" style="background:rgba(255,255,255,0.06);" id="drill-csv">${iconHtml('download')} CSV exportieren</button>
    </div>`

  const el = body.querySelector('#drill-chart')
  if (!series.length) {
    // FIX(low): user-friendly empty state text, no internal implementation hints
    el.innerHTML = `<div class="empty-state"><div class="icon">${iconHtml('alert')}</div><h3>Keine historischen Daten verfügbar</h3><p>Für diesen Zeitraum liegen noch keine Werte vor.</p></div>`
  } else {
    try {
      makeLineChart(el, {
        categories: series.map(s => s.date.slice(5)),
        series: [{ name: def.label, data: series.map(s => s.value) }],
        colors: [def.color],
        height: 320, smooth: true, area: true
      })
    } catch (_) {
      try {
        makeAreaChart(el, {
          categories: series.map(s => s.date.slice(5)),
          series: [{ name: def.label, data: series.map(s => s.value) }],
          colors: [def.color], height: 320
        })
      } catch (e) {
        el.innerHTML = `<div class="empty-state"><div class="icon">${iconHtml('alert-triangle')}</div><h3>Chart nicht verfügbar</h3><p>${htmlEscape(e?.message||'')}</p></div>`
      }
    }
  }
  body.querySelector('#drill-csv')?.addEventListener('click', () => {
    try { exportCsv(series.map(s => ({ date: s.date, value: s.value })), ['date','value'], `${def.key}_30d.csv`) }
    catch (_) { toast('CSV-Export fehlgeschlagen', 'error') }
  })
}

export default {
  id: 'kpi-live-totals',
  title: 'Live-Kennzahlen',
  category: 'overview',

  async mount(container) {
    try {
      container.innerHTML = `${styles()}
        <div class="panel-shell">
          <div class="panel-head">
            <div>
              <h2>Live-Kennzahlen</h2>
              <div class="sub" id="last-updated">Lädt aktuelle Werte …</div>
            </div>
            ${toolbarHtml()}
          </div>
          <div class="panel-body" id="body">
            <div class="skeleton-grid">
              ${[1,2,3,4].map(()=>`<div class="skel-card"></div>`).join('')}
            </div>
          </div>
        </div>`

      try { fadeIn(container) } catch (_) {}

      let currentTotals = null
      let refreshTimer = null
      // FIX(med): track open drawer close function for cleanup
      let activeDrawerClose = null

      const body = container.querySelector('#body')
      const lastUpd = container.querySelector('#last-updated')

      const renderError = (err) => {
        body.innerHTML = `
          <div class="error-state">
            <div class="icon">${iconHtml('alert-triangle')}</div>
            <h3>Daten konnten nicht geladen werden</h3>
            <p>${htmlEscape(err?.message || 'Unbekannter Fehler')}</p>
            <button class="retry-btn" id="retry">${iconHtml('refresh')} Erneut versuchen</button>
          </div>`
        body.querySelector('#retry')?.addEventListener('click', () => load(true))
      }

      const animateCard = (key, oldVal, newVal, fmt) => {
        const el = container.querySelector(`#kpi-val-${key}`)
        if (!el) return
        try {
          countUp(el, { from: oldVal, to: newVal, duration: 1200,
            format: (n) => formatValue(Math.round(n), fmt) })
        } catch (_) {
          el.textContent = formatValue(newVal, fmt)
        }
        if (oldVal !== newVal) {
          const card = container.querySelector(`.kpi-card[data-kpi="${key}"]`)
          if (card) {
            card.classList.add('pulsing')
            setTimeout(() => card.classList.remove('pulsing'), 1300)
            try { pulse(card) } catch (_) {}
          }
        }
      }

      const wireCards = () => {
        container.querySelectorAll('.kpi-card').forEach(card => {
          const handler = () => {
            const key = card.dataset.kpi
            const def = KPI_DEFS.find(d => d.key === key)
            if (def && currentTotals) {
              renderDrilldown(def, currentTotals, (closeFn) => { activeDrawerClose = closeFn })
            }
          }
          card.addEventListener('click', handler)
          card.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler() }
          })
        })
      }

      const load = async (isInitial = false) => {
        // FIX(low): disable refresh button during load to prevent parallel calls
        const btnRefresh = container.querySelector('#btn-refresh')
        if (btnRefresh) btnRefresh.disabled = true
        try {
          const totals = await fetchTotals()
          const prev = currentTotals
          currentTotals = totals

          if (isInitial || !prev || !container.querySelector('#hero-grid')) {
            body.innerHTML = renderHeroGrid(totals)
            wireCards()
            for (const def of KPI_DEFS) {
              animateCard(def.key, 0, totals[def.key].value, def.fmt)
            }
            renderSparklines(container).catch(() => {})
          } else {
            for (const def of KPI_DEFS) {
              const t = totals[def.key]
              const p = prev[def.key] || { value: 0, prev: 0 }
              animateCard(def.key, p.value, t.value, def.fmt)
              const card = container.querySelector(`.kpi-card[data-kpi="${def.key}"]`)
              if (card) {
                const change = pctChange(t.value, t.prev)
                const dir = change > 0 ? 'up' : change < 0 ? 'down' : 'flat'
                const arrowIcon = dir === 'up' ? 'trending-up' : dir === 'down' ? 'trending-down' : 'minus'
                const sign = change > 0 ? '+' : ''
                const alert = isAlertChange(def, change, t.prev)
                const warn = isLowActivityWarn(def, t.value)
                card.classList.toggle('kpi-alert', alert)
                card.classList.toggle('kpi-warn', warn)
                let warnEl = card.querySelector('.kpi-warn-badge')
                if (warn && !warnEl) {
                  warnEl = document.createElement('span')
                  warnEl.className = 'kpi-warn-badge'
                  warnEl.title = 'Wenig Aktivität heute'
                  warnEl.innerHTML = `${iconHtml('alert-triangle')} Wenig Aktivität`
                  card.prepend(warnEl)
                } else if (!warn && warnEl) {
                  warnEl.remove()
                }
                const chEl = card.querySelector('.kpi-change')
                if (chEl) {
                  chEl.className = `kpi-change ${dir}`
                  chEl.innerHTML = `${iconHtml(arrowIcon)}
                    <span>${sign}${change.toFixed(1)}%</span>
                    <span class="kpi-change-sub">vs gestern</span>`
                }
              }
            }
            renderSparklines(container).catch(() => {})
          }

          if (lastUpd) lastUpd.textContent = `Zuletzt aktualisiert: ${fmtDateTime(new Date())} · Auto-Refresh 60s`
        } catch (err) {
          console.error('[kpi-live-totals]', err)
          if (isInitial) renderError(err)
          else {
            try { toast('Aktualisierung fehlgeschlagen', 'error') } catch (_) {}
          }
        } finally {
          if (btnRefresh) btnRefresh.disabled = false
        }
      }

      // FIX(low): debounce refresh button to prevent parallel fetches on rapid clicks
      const debouncedRefresh = debounce(async () => {
        await load(false)
        try { toast('Kennzahlen aktualisiert', 'success') } catch (_) {}
      }, 300)

      container.querySelector('#btn-refresh')?.addEventListener('click', debouncedRefresh)
      container.querySelector('#btn-pdf')?.addEventListener('click', () => {
        try { exportPanelAsPdf(container, 'Live-Kennzahlen.pdf') }
        catch (_) { toast('PDF-Export nicht verfügbar', 'error') }
      })
      container.querySelector('#btn-csv')?.addEventListener('click', () => {
        if (!currentTotals) { toast('Keine Daten zum Exportieren', 'info'); return }
        const rows = KPI_DEFS.map(d => ({
          kpi: d.label,
          value: currentTotals[d.key].value,
          previous: currentTotals[d.key].prev,
          change_pct: pctChange(currentTotals[d.key].value, currentTotals[d.key].prev).toFixed(2)
        }))
        try { exportCsv(rows, ['kpi','value','previous','change_pct'], 'live-kennzahlen.csv') }
        catch (_) { toast('CSV-Export fehlgeschlagen', 'error') }
      })

      await load(true)

      refreshTimer = setInterval(() => load(false), REFRESH_MS)

      // FIX(med): cleanup also closes any open drawer to prevent DOM leaks
      return () => {
        if (refreshTimer) clearInterval(refreshTimer)
        if (activeDrawerClose) { try { activeDrawerClose() } catch (_) {} }
      }
    } catch (mountErr) {
      console.error('[kpi-live-totals] mount error', mountErr)
      try {
        container.innerHTML = `
          <div style="padding:40px; text-align:center;">
            <div style="font-size:42px; opacity:0.5; margin-bottom:12px;">${iconHtml('alert-triangle')}</div>
            <h3 style="font-size:18px; margin:0 0 6px;">Panel konnte nicht initialisiert werden</h3>
            <p style="color:#9ca3af; margin:0 0 16px;">${htmlEscape(mountErr?.message || 'Unbekannter Fehler')}</p>
          </div>`
      } catch (_) {
        container.textContent = 'Panel-Fehler: ' + (mountErr?.message || 'unbekannt')
      }
      return () => {}
    }
  }
}
