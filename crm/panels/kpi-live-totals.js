import { sb } from '/lib/supabase.js'
import { toast, fmtNumber, fmtDateTime, htmlEscape, iconHtml } from '/lib/ui.js'
import { makeAreaChart, makeLineChart } from '/lib/charts.js'
import { exportPanelAsPdf, exportCsv } from '/lib/export.js'
import { countUp, fadeIn, pulse } from '/lib/animations.js'
import { drawer } from '/lib/layout-extras.js'

const REFRESH_MS = 60_000

const KPI_DEFS = [
  { key: 'total_users',      label: 'Total Users',      icon: 'users',     color: '#7C5CFF', fmt: 'int' },
  { key: 'active_24h',       label: 'Aktiv (24h)',      icon: 'activity',  color: '#22D3EE', fmt: 'int' },
  { key: 'total_posts',      label: 'Total Posts',      icon: 'message',   color: '#F59E0B', fmt: 'int' },
  { key: 'listening_hours',  label: 'Listening-Hours',  icon: 'headphones',color: '#10B981', fmt: 'hours' }
]

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
  const yesterday = new Date(today.getTime() - 86_400_000)
  const dayBefore = new Date(today.getTime() - 2 * 86_400_000)
  const since24h = new Date(today.getTime() - 86_400_000).toISOString()
  const since48h = dayBefore.toISOString()

  const safe = (p) => p.then(r => r).catch(() => ({ count: 0, data: null }))

  // app_opens as proxy for active users; daily_activity for total user-days
  // episode_listening_pulses for listen duration
  const [active24, active48, listenRows, listenRowsYday] = await Promise.all([
    safe(sb.from('app_opens').select('id', { count: 'exact', head: true }).gte('created_at', since24h)),
    safe(sb.from('app_opens').select('id', { count: 'exact', head: true }).gte('created_at', since48h).lt('created_at', since24h)),
    safe(sb.from('episode_listening_pulses').select('duration_sec,pulse_seconds,created_at').gte('created_at', since24h).limit(5000)),
    safe(sb.from('episode_listening_pulses').select('duration_sec,pulse_seconds,created_at').gte('created_at', since48h).lt('created_at', since24h).limit(5000))
  ])

  const sumSec = (rows) => (rows || []).reduce((a, r) => a + Number(r.duration_sec || r.pulse_seconds || 0), 0)
  const totalListenSec = sumSec(listenRows?.data)
  const ydayListenSec  = sumSec(listenRowsYday?.data)

  return {
    total_users:      { value: 0, prev: 0 },
    active_24h:       { value: active24.count ?? 0, prev: active48.count ?? 0 },
    total_posts:      { value: 0, prev: 0 },
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
  let rows = []
  try {
    if (kpiKey === 'active_24h') {
      const { data } = await sb.from('app_opens').select('created_at').gte('created_at', since)
      rows = bucketByDay(data || [], 'created_at', days, false)
    } else if (kpiKey === 'listening_hours') {
      const { data } = await sb.from('episode_listening_pulses').select('created_at,duration_sec,pulse_seconds').gte('created_at', since)
      rows = bucketByDay(data || [], 'created_at', days, false, r => Number(r.duration_sec || r.pulse_seconds || 0) / 3600)
    } else if (kpiKey === 'total_users' || kpiKey === 'total_posts') {
      // 7.6.: nutze admin_daily_series RPC die RLS via SECURITY DEFINER bypasst
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

function renderHeroGrid(totals) {
  return `<div class="hero-grid" id="hero-grid">
    ${KPI_DEFS.map(def => {
      const t = totals[def.key] || { value: 0, prev: 0 }
      const change = pctChange(t.value, t.prev)
      const up = change >= 0
      return `
      <div class="stat-hero glass-card kpi-card" data-kpi="${def.key}" role="button" tabindex="0"
           style="--accent:${def.color}">
        <div class="kpi-card-head">
          <span class="kpi-icon" style="background:${def.color}22;color:${def.color}">${iconHtml(def.icon)}</span>
          <span class="kpi-label">${htmlEscape(def.label)}</span>
        </div>
        <div class="kpi-value" id="kpi-val-${def.key}" data-fmt="${def.fmt}">${formatValue(t.value, def.fmt)}</div>
        <div class="kpi-change ${up ? 'up' : 'down'}">
          ${iconHtml(up ? 'trending-up' : 'trending-down')}
          <span>${up ? '+' : ''}${change.toFixed(1)}%</span>
          <span class="kpi-change-sub">vs gestern</span>
        </div>
        <div class="kpi-card-foot">
          <span class="kpi-hint">${iconHtml('bar-chart')} 30-Tage-Verlauf öffnen</span>
        </div>
      </div>`
    }).join('')}
  </div>`
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
    .toolbar .live-dot { display:inline-flex; align-items:center; gap:6px; padding:6px 10px;
      border-radius:999px; background:rgba(34,197,94,0.1); color:#22c55e; font-size:12px; font-weight:600; }
    .toolbar .live-dot::before { content:''; width:7px; height:7px; border-radius:50%;
      background:#22c55e; box-shadow:0 0 8px #22c55e; animation:livepulse 1.4s ease-in-out infinite; }
    @keyframes livepulse { 0%,100%{opacity:1} 50%{opacity:0.3} }

    .hero-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(250px, 1fr)); gap:18px; }
    .kpi-card { padding:22px; border-radius:18px; cursor:pointer; position:relative;
      overflow:hidden; transition:transform .2s ease, box-shadow .2s ease;
      background:linear-gradient(140deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01));
      border:1px solid rgba(255,255,255,0.06); }
    .kpi-card::before { content:''; position:absolute; top:0; left:0; right:0; height:3px; background:var(--accent); opacity:0.85; }
    .kpi-card:hover { transform:translateY(-3px); box-shadow:0 12px 40px rgba(0,0,0,0.35), 0 0 0 1px var(--accent); }
    .kpi-card.pulsing { animation:kpipulse 1.2s ease-out; }
    @keyframes kpipulse { 0%{box-shadow:0 0 0 0 var(--accent)} 50%{box-shadow:0 0 0 14px transparent} 100%{box-shadow:0 0 0 0 transparent} }
    .kpi-card-head { display:flex; align-items:center; gap:10px; margin-bottom:14px; }
    .kpi-icon { display:inline-flex; width:36px; height:36px; border-radius:10px; align-items:center; justify-content:center; }
    .kpi-label { font-size:13px; font-weight:500; color:var(--text-muted,#9ca3af); letter-spacing:0.01em; }
    .kpi-value { font-size:38px; font-weight:700; letter-spacing:-0.03em; line-height:1.1; font-variant-numeric:tabular-nums; margin-bottom:10px; }
    .kpi-change { display:inline-flex; align-items:center; gap:6px; font-size:13px; font-weight:600; }
    .kpi-change.up { color:#22c55e; }
    .kpi-change.down { color:#ef4444; }
    .kpi-change-sub { color:var(--text-muted,#9ca3af); font-weight:400; margin-left:4px; }
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

async function renderDrilldown(def, totals) {
  const body = document.createElement('div')
  body.className = 'drawer-content'
  body.innerHTML = `
    <h3>${htmlEscape(def.label)} — 30 Tage</h3>
    <div class="sub">Lade historische Daten …</div>
    <div class="chart-wrap" id="drill-chart"><div class="skel-card" style="height:280px"></div></div>`

  try { drawer({ title: def.label, content: body, width: 720 }) }
  catch (e) { toast({ type: 'error', message: 'Drawer konnte nicht geöffnet werden' }); return }

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
    el.innerHTML = `<div class="empty-state"><div class="icon">${iconHtml('alert')}</div><h3>Daten kommen sobald die Tabelle profiles oder das RPC crm_kpi_timeseries angelegt ist</h3><p>Für diesen Zeitraum liegen noch keine Werte vor.</p></div>`
  } else {
    try {
      makeLineChart(el, {
        labels: series.map(s => s.date.slice(5)),
        series: [{ name: def.label, data: series.map(s => s.value), color: def.color }],
        height: 320, smooth: true, area: true
      })
    } catch (_) {
      try {
        makeAreaChart(el, {
          labels: series.map(s => s.date.slice(5)),
          values: series.map(s => s.value),
          color: def.color, height: 320
        })
      } catch (e) {
        el.innerHTML = `<div class="empty-state"><div class="icon">${iconHtml('alert-triangle')}</div><h3>Chart nicht verfügbar</h3><p>${htmlEscape(e?.message||'')}</p></div>`
      }
    }
  }
  body.querySelector('#drill-csv')?.addEventListener('click', () => {
    try { exportCsv(`${def.key}_30d.csv`, series.map(s => ({ date: s.date, value: s.value }))) }
    catch (_) { toast({ type: 'error', message: 'CSV-Export fehlgeschlagen' }) }
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
            if (def && currentTotals) renderDrilldown(def, currentTotals)
          }
          card.addEventListener('click', handler)
          card.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler() }
          })
        })
      }

      const load = async (isInitial = false) => {
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
          } else {
            for (const def of KPI_DEFS) {
              const t = totals[def.key]
              const p = prev[def.key] || { value: 0, prev: 0 }
              animateCard(def.key, p.value, t.value, def.fmt)
              const card = container.querySelector(`.kpi-card[data-kpi="${def.key}"]`)
              if (card) {
                const change = pctChange(t.value, t.prev)
                const up = change >= 0
                const chEl = card.querySelector('.kpi-change')
                if (chEl) {
                  chEl.className = `kpi-change ${up ? 'up' : 'down'}`
                  chEl.innerHTML = `${iconHtml(up ? 'trending-up' : 'trending-down')}
                    <span>${up?'+':''}${change.toFixed(1)}%</span>
                    <span class="kpi-change-sub">vs gestern</span>`
                }
              }
            }
          }

          if (lastUpd) lastUpd.textContent = `Zuletzt aktualisiert: ${fmtDateTime(new Date())} · Auto-Refresh 60s`
        } catch (err) {
          console.error('[kpi-live-totals]', err)
          if (isInitial) renderError(err)
          else {
            try { toast({ type: 'error', message: 'Aktualisierung fehlgeschlagen' }) } catch (_) {}
          }
        }
      }

      container.querySelector('#btn-refresh')?.addEventListener('click', async () => {
        await load(false)
        try { toast({ type: 'success', message: 'Kennzahlen aktualisiert' }) } catch (_) {}
      })
      container.querySelector('#btn-pdf')?.addEventListener('click', () => {
        try { exportPanelAsPdf(container, 'Live-Kennzahlen.pdf') }
        catch (_) { toast({ type: 'error', message: 'PDF-Export nicht verfügbar' }) }
      })
      container.querySelector('#btn-csv')?.addEventListener('click', () => {
        if (!currentTotals) { toast({ type: 'info', message: 'Keine Daten zum Exportieren' }); return }
        const rows = KPI_DEFS.map(d => ({
          kpi: d.label,
          value: currentTotals[d.key].value,
          previous: currentTotals[d.key].prev,
          change_pct: pctChange(currentTotals[d.key].value, currentTotals[d.key].prev).toFixed(2)
        }))
        try { exportCsv('live-kennzahlen.csv', rows) }
        catch (_) { toast({ type: 'error', message: 'CSV-Export fehlgeschlagen' }) }
      })

      await load(true)

      refreshTimer = setInterval(() => load(false), REFRESH_MS)

      return () => { if (refreshTimer) clearInterval(refreshTimer) }
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
