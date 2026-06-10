import { sb } from '/lib/supabase.js?v=20260610q'
import { toast, modal, confirmDialog, fmtNumber, htmlEscape, debounce } from '/lib/ui.js?v=20260610q'
import { makeAreaChart, makeBarChart, makeDonutChart, makeSparkline } from '/lib/charts.js?v=20260610q'
import { exportPanelAsPdf, exportCsv } from '/lib/export.js?v=20260610q'
import { countUp, fadeIn, skeletonLoader } from '/lib/animations.js?v=20260610q'
import { drawer, segmentedControl } from '/lib/layout-extras.js?v=20260610q'
import { showUserDetailModal } from '/lib/panel-actions.js?v=20260610q'

const RANGES = [
  { id: '7d', label: '7 Tage', days: 7 },
  { id: '14d', label: '14 Tage', days: 14 },
  { id: '30d', label: '30 Tage', days: 30 },
]

const SORTS = [
  { id: 'velocity', label: 'Velocity' },
  { id: 'growth_abs', label: 'Absolutes Wachstum' },
  { id: 'followers', label: 'Follower' },
  { id: 'plays', label: 'Plays' },
]

const state = {
  range: '7d',
  sort: 'velocity',
  search: '',
  rows: [],
  loading: false,
  error: null,
}

// FIX #1: Echter Supabase-Aufruf via RPC crm_trending_podcasters
async function fetchTrending(days) {
  const { data, error } = await sb.rpc('crm_trending_podcasters', { p_days: days })
  if (error) throw new Error(error.message || String(error))
  return data || []
}

function sortRows(rows, sort) {
  const s = [...rows]
  switch (sort) {
    case 'velocity': s.sort((a, b) => (b.velocity || 0) - (a.velocity || 0)); break
    case 'growth_abs': s.sort((a, b) => (b.growth_abs || 0) - (a.growth_abs || 0)); break
    case 'followers': s.sort((a, b) => (b.followers || 0) - (a.followers || 0)); break
    case 'plays': s.sort((a, b) => (b.plays || 0) - (a.plays || 0)); break
  }
  return s
}

function filterRows(rows, q) {
  if (!q) return rows
  const needle = q.toLowerCase().trim()
  return rows.filter(r =>
    (r.display_name || '').toLowerCase().includes(needle) ||
    (r.podcast_title || '').toLowerCase().includes(needle)
  )
}

function velocityClass(v) {
  if (v >= 25) return 'velo-hot'
  if (v >= 10) return 'velo-up'
  if (v >= 0) return 'velo-flat'
  return 'velo-down'
}

function velocityBadge(v) {
  const cls = velocityClass(v)
  const sign = v >= 0 ? '+' : ''
  const icon = v >= 25 ? '🔥' : v >= 10 ? '↗' : v >= 0 ? '→' : '↘'
  return `<span class="velo-badge ${cls}">${icon} ${sign}${(v || 0).toFixed(1)}%</span>`
}

function podcasterCard(r) {
  const cover = r.podcast_cover || r.avatar_url || ''
  const initials = (r.display_name || '?').slice(0, 2).toUpperCase()
  const coverEl = cover
    ? `<img src="${htmlEscape(cover)}" alt="" class="tp-cover-img" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
       <div class="tp-cover-fallback" style="display:none">${htmlEscape(initials)}</div>`
    : `<div class="tp-cover-fallback">${htmlEscape(initials)}</div>`

  // FIX #8: Sparkline-Daten ohne htmlEscape schreiben (verhindert doppelt-escaped JSON)
  const sparkJson = JSON.stringify(r.spark || [])

  return `
    <article class="tp-card glass-card" data-id="${htmlEscape(r.id)}">
      <div class="tp-card-head">
        <div class="tp-cover">${coverEl}</div>
        <div class="tp-meta">
          <div class="tp-name" title="${htmlEscape(r.display_name || '')}">${htmlEscape(r.display_name || 'Unbekannt')}</div>
          <div class="tp-podcast" title="${htmlEscape(r.podcast_title || '')}">${htmlEscape(r.podcast_title || 'Kein Podcast')}</div>
        </div>
        ${r.is_featured ? '<span class="tp-feat-pill" title="Auf Discover gefeatured">⭐</span>' : ''}
      </div>

      <div class="tp-spark" data-spark='${sparkJson}'></div>

      <div class="tp-stats">
        <div class="tp-stat">
          <span class="tp-stat-val">${fmtNumber(r.followers || 0)}</span>
          <span class="tp-stat-lbl">Follower</span>
        </div>
        <div class="tp-stat">
          <span class="tp-stat-val">${fmtNumber(r.plays || 0)}</span>
          <span class="tp-stat-lbl">Plays</span>
        </div>
        <div class="tp-stat tp-stat-velo">
          ${velocityBadge(r.velocity || 0)}
        </div>
      </div>

      <div class="tp-actions">
        <button class="btn btn-ghost btn-sm tp-open" data-id="${htmlEscape(r.id)}">👤 Profil</button>
        <label class="tp-feature-toggle" title="Auf Discover featuren">
          <input type="checkbox" class="tp-feat-cb" data-id="${htmlEscape(r.id)}" ${r.is_featured ? 'checked' : ''}>
          <span class="tp-feat-track"></span>
          <span class="tp-feat-lbl">Discover</span>
        </label>
      </div>
    </article>
  `
}

function emptyState() {
  return `
    <div class="empty-state glass-card">
      <div class="empty-icon">📈</div>
      <h3>Keine trending Podcaster im Zeitraum</h3>
      <p>Sobald Wachstum oder Velocity messbar sind, erscheinen hier die heißesten Podcaster.</p>
      <button class="btn btn-primary" data-act="refresh">Neu laden</button>
    </div>
  `
}

function rpcMissingState(name) {
  return `
    <div class="empty-state glass-card" style="padding:40px 24px;text-align:center;border-radius:16px;margin:20px">
      <div style="font-size:36px;margin-bottom:12px">⚠️</div>
      <h3 style="margin:0 0 6px">Daten kommen sobald das RPC <code>${htmlEscape(name)}</code> angelegt ist</h3>
      <p style="margin:0 0 16px;opacity:.65;font-size:13px">Das Backend-RPC fehlt noch im Schema. Bitte Migrationen prüfen.</p>
    </div>
  `
}

function errorState(msg) {
  return `
    <div class="error-state glass-card">
      <div class="empty-icon">⚠️</div>
      <h3>Konnte Daten nicht laden</h3>
      <p>${htmlEscape(msg || 'Unbekannter Fehler')}</p>
      <button class="btn btn-primary" data-act="retry">Erneut versuchen</button>
    </div>
  `
}

function mountErrorState(container, msg) {
  container.innerHTML = `
    <div class="error-state glass-card" style="padding:40px 24px;text-align:center;border-radius:16px;margin:20px">
      <div style="font-size:42px;margin-bottom:12px">💥</div>
      <h3 style="margin:0 0 6px">Panel konnte nicht geladen werden</h3>
      <p style="margin:0 0 16px;opacity:.65;font-size:13px">${htmlEscape(msg || 'Unbekannter Fehler')}</p>
      <button class="btn btn-primary" data-act="reload-panel">Erneut versuchen</button>
    </div>
  `
}

function injectStyles() {
  if (document.getElementById('tp-panel-styles')) return
  const s = document.createElement('style')
  s.id = 'tp-panel-styles'
  s.textContent = `
    .tp-toolbar{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:16px}
    .tp-toolbar .spacer{flex:1}
    .tp-search{position:relative;min-width:240px}
    .tp-search input{width:100%;padding:8px 12px 8px 32px;border-radius:10px;border:1px solid var(--border,#2a2a2a);background:var(--bg-soft,#141414);color:inherit;font-size:13px}
    .tp-search::before{content:'🔍';position:absolute;left:10px;top:50%;transform:translateY(-50%);opacity:.6;font-size:12px}
    .tp-hero-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:18px}
    .tp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px}
    .tp-card{padding:14px;border-radius:14px;display:flex;flex-direction:column;gap:12px;transition:transform .18s ease, box-shadow .18s ease;cursor:default}
    .tp-card:hover{transform:translateY(-2px);box-shadow:0 8px 32px rgba(0,0,0,.28)}
    .tp-card-head{display:flex;gap:12px;align-items:center;position:relative}
    .tp-cover{width:52px;height:52px;border-radius:12px;overflow:hidden;flex-shrink:0;background:linear-gradient(135deg,#2a2a35,#1a1a22);display:flex;align-items:center;justify-content:center}
    .tp-cover-img{width:100%;height:100%;object-fit:cover;display:block}
    .tp-cover-fallback{width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-weight:600;color:#cfcfd8;font-size:16px;letter-spacing:.5px}
    .tp-meta{min-width:0;flex:1}
    .tp-name{font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .tp-podcast{font-size:12px;opacity:.65;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}
    .tp-feat-pill{position:absolute;top:-4px;right:-4px;font-size:14px;filter:drop-shadow(0 0 6px rgba(255,200,80,.6))}
    .tp-spark{height:46px;width:100%}
    .tp-stats{display:grid;grid-template-columns:1fr 1fr auto;gap:8px;align-items:center}
    .tp-stat{display:flex;flex-direction:column;gap:2px}
    .tp-stat-val{font-weight:600;font-size:14px}
    .tp-stat-lbl{font-size:10px;opacity:.55;text-transform:uppercase;letter-spacing:.5px}
    .tp-stat-velo{justify-self:end}
    .velo-badge{display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:999px;font-size:12px;font-weight:600}
    .velo-hot{background:rgba(255,90,40,.15);color:#ff8a55}
    .velo-up{background:rgba(60,200,120,.13);color:#4ad08a}
    .velo-flat{background:rgba(150,150,160,.12);color:#a8a8b2}
    .velo-down{background:rgba(230,80,90,.13);color:#ff7a85}
    .tp-actions{display:flex;justify-content:space-between;align-items:center;gap:8px;border-top:1px solid var(--border,rgba(255,255,255,.06));padding-top:10px}
    .tp-feature-toggle{display:inline-flex;align-items:center;gap:8px;cursor:pointer;user-select:none;font-size:12px;opacity:.85;position:relative}
    .tp-feature-toggle input{position:absolute;opacity:0;pointer-events:none}
    .tp-feat-track{width:32px;height:18px;border-radius:999px;background:#3a3a44;position:relative;transition:background .18s ease;display:inline-block}
    .tp-feat-track::after{content:'';position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#fff;transition:transform .18s ease}
    .tp-feature-toggle input:checked + .tp-feat-track{background:linear-gradient(135deg,#ffb04a,#ff7a55)}
    .tp-feature-toggle input:checked + .tp-feat-track::after{transform:translateX(14px)}
    .empty-state,.error-state{padding:40px 24px;text-align:center;border-radius:16px}
    .empty-icon{font-size:42px;margin-bottom:12px;opacity:.8}
    .empty-state h3,.error-state h3{margin:0 0 6px;font-size:16px}
    .empty-state p,.error-state p{margin:0 0 16px;opacity:.65;font-size:13px}
    .tp-drawer-body{padding:18px 20px;display:flex;flex-direction:column;gap:16px}
    .tp-drawer-head{display:flex;gap:14px;align-items:center}
    .tp-drawer-head .tp-cover{width:64px;height:64px;border-radius:14px}
    .tp-drawer-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
    .tp-drawer-stat{padding:12px;border-radius:10px;background:var(--bg-soft,rgba(255,255,255,.04))}
    .tp-drawer-stat .v{font-size:18px;font-weight:600}
    .tp-drawer-stat .l{font-size:11px;opacity:.6;text-transform:uppercase;letter-spacing:.5px;margin-top:2px}
    .tp-drawer-chart{height:200px}
    .tp-drawer-actions{display:flex;gap:8px;flex-wrap:wrap}
    @media(max-width:640px){#tp-charts{grid-template-columns:1fr}}
  `
  document.head.appendChild(s)
}

function buildToolbar() {
  return `
    <div class="tp-toolbar">
      <div id="tp-range"></div>
      <div id="tp-sort"></div>
      <div class="tp-search">
        <input id="tp-search" type="text" placeholder="Podcaster oder Show suchen…" />
      </div>
      <div class="spacer"></div>
      <button class="btn btn-ghost" data-act="refresh" title="Aktualisieren">🔄 Aktualisieren</button>
      <button class="btn btn-ghost" data-act="pdf" title="Als PDF exportieren">📄 PDF</button>
      <button class="btn btn-ghost" data-act="csv" title="Als CSV exportieren">💾 CSV</button>
    </div>
  `
}

function computeHero(rows) {
  const total = rows.length
  const featured = rows.filter(r => r.is_featured).length
  const hot = rows.filter(r => (r.velocity || 0) >= 25).length
  const avgVelo = total ? rows.reduce((s, r) => s + (r.velocity || 0), 0) / total : 0
  const totalGrowth = rows.reduce((s, r) => s + (r.growth_abs || 0), 0)
  return { total, featured, hot, avgVelo, totalGrowth }
}

function renderHero(container, h) {
  container.innerHTML = ''
  const items = [
    { label: 'Trending Podcaster', value: h.total, fmt: 'int' },
    { label: '🔥 Velocity > 25%', value: h.hot, fmt: 'int' },
    { label: 'Ø Wachstum', value: h.avgVelo, fmt: 'pct' },
    { label: 'Neue Follower (Σ)', value: h.totalGrowth, fmt: 'int' },
    { label: '⭐ Gefeatured', value: h.featured, fmt: 'int' },
  ]
  items.forEach(it => {
    const card = document.createElement('div')
    card.className = 'glass-card'
    card.style.cssText = 'padding:14px 16px;border-radius:14px;display:flex;flex-direction:column;gap:4px'
    card.innerHTML = `
      <div class="hero-lbl" style="font-size:11px;opacity:.6;text-transform:uppercase;letter-spacing:.5px">${it.label}</div>
      <div class="hero-val" style="font-size:24px;font-weight:700">0</div>
    `
    container.appendChild(card)
    const valEl = card.querySelector('.hero-val')
    try {
      if (it.fmt === 'pct') {
        countUp(valEl, { from: 0, to: it.value, duration: 700, format: v => `${v.toFixed(1)}%` })
      } else {
        countUp(valEl, { from: 0, to: it.value, duration: 700, format: v => fmtNumber(Math.round(v)) })
      }
    } catch {
      valEl.textContent = it.fmt === 'pct' ? `${it.value.toFixed(1)}%` : fmtNumber(Math.round(it.value))
    }
  })
}

function renderVelocityChart(el, rows) {
  el.innerHTML = ''
  const buckets = { '🔥 ≥25%': 0, '↗ 10–25%': 0, '→ 0–10%': 0, '↘ <0%': 0 }
  rows.forEach(r => {
    const v = r.velocity || 0
    if (v >= 25) buckets['🔥 ≥25%']++
    else if (v >= 10) buckets['↗ 10–25%']++
    else if (v >= 0) buckets['→ 0–10%']++
    else buckets['↘ <0%']++
  })
  try {
    makeDonutChart(el, {
      labels: Object.keys(buckets),
      values: Object.values(buckets),
      colors: ['#ff8a55', '#4ad08a', '#a8a8b2', '#ff7a85'],
      height: 220,
      centerLabel: 'Podcaster',
    })
  } catch {
    el.innerHTML = '<div style="opacity:.5;padding:12px">Chart nicht verfügbar</div>'
  }
}

function renderTopChart(el, rows) {
  el.innerHTML = ''
  const top = sortRows(rows, 'velocity').slice(0, 10)
  try {
    makeBarChart(el, {
      categories: top.map(r => r.display_name || '–'),
      series: [{ name: 'Velocity (%)', data: top.map(r => Number((r.velocity || 0).toFixed(1))) }],
      colors: ['#ff8a55'],
      horizontal: true,
      height: 220,
    })
  } catch {
    el.innerHTML = '<div style="opacity:.5;padding:12px">Chart nicht verfügbar</div>'
  }
}

function paintSparklines(root) {
  root.querySelectorAll('.tp-spark').forEach(el => {
    if (el.dataset.painted) return
    let pts = []
    try { pts = JSON.parse(el.dataset.spark || '[]') } catch {}
    if (!pts.length) {
      el.innerHTML = '<div style="height:100%;display:flex;align-items:center;justify-content:center;font-size:10px;opacity:.4">keine Verlaufsdaten</div>'
      el.dataset.painted = '1'
      return
    }
    try {
      makeSparkline(el, { values: pts, color: pts[pts.length - 1] >= pts[0] ? '#4ad08a' : '#ff7a85', fill: true })
    } catch {
      el.innerHTML = ''
    }
    el.dataset.painted = '1'
  })
}

// FIX #2: Echter Schreibpfad via podcasts-Tabelle (kein RPC notwendig)
async function toggleFeature(id, on, rowRef) {
  try {
    const ok = await confirmDialog(
      on ? 'Auf Discover featuren?' : 'Feature entfernen?',
      on
        ? `${rowRef?.display_name || 'Podcaster'} wird sofort auf dem Discover-Tab prominent angezeigt.`
        : `${rowRef?.display_name || 'Podcaster'} wird vom Discover-Feature entfernt.`,
      on ? 'Featuren' : 'Entfernen',
      !on,
    )
    if (!ok) return false
    // Über RPC mit Audit-Log (id ist hier der podcast_id aus crm_trending_podcasters)
    const podcastId = rowRef?.podcast_id || id
    const { error } = await sb.rpc('admin_set_podcast_featured', { p_podcast_id: podcastId, p_featured: on })
    if (error) throw new Error(error.message || String(error))
    toast(on ? 'Podcaster wird jetzt gefeatured' : 'Feature entfernt', 'success')
    return true
  } catch (e) {
    toast('Konnte Feature-Status nicht setzen: ' + (e.message || e), 'error')
    return false
  }
}

function openProfileDrawer(row, onChange) {
  const cover = row.podcast_cover || row.avatar_url || ''
  const initials = (row.display_name || '?').slice(0, 2).toUpperCase()
  const coverHtml = cover
    ? `<img src="${htmlEscape(cover)}" class="tp-cover-img" onerror="this.style.display='none'">`
    : `<div class="tp-cover-fallback">${htmlEscape(initials)}</div>`

  const body = document.createElement('div')
  body.className = 'tp-drawer-body'
  body.innerHTML = `
    <div class="tp-drawer-head">
      <div class="tp-cover">${coverHtml}</div>
      <div style="min-width:0;flex:1">
        <div style="font-size:18px;font-weight:700">${htmlEscape(row.display_name || 'Unbekannt')}</div>
        <div style="font-size:13px;opacity:.65;margin-top:2px">${htmlEscape(row.podcast_title || 'Kein Podcast')}</div>
        <div style="margin-top:8px">${velocityBadge(row.velocity || 0)}</div>
      </div>
    </div>

    <div class="tp-drawer-stats">
      <div class="tp-drawer-stat"><div class="v">${fmtNumber(row.followers || 0)}</div><div class="l">Follower</div></div>
      <div class="tp-drawer-stat"><div class="v">${(row.growth_abs >= 0 ? '+' : '') + fmtNumber(row.growth_abs || 0)}</div><div class="l">Wachstum</div></div>
      <div class="tp-drawer-stat"><div class="v">${fmtNumber(row.plays || 0)}</div><div class="l">Plays</div></div>
    </div>

    <div>
      <div style="font-size:12px;opacity:.6;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Follower-Verlauf</div>
      <div class="tp-drawer-chart" id="tp-drawer-chart"></div>
    </div>

    <div>
      <label class="tp-feature-toggle" style="font-size:14px">
        <input type="checkbox" class="tp-feat-cb-drawer" ${row.is_featured ? 'checked' : ''}>
        <span class="tp-feat-track"></span>
        <span class="tp-feat-lbl">Auf Discover featuren</span>
      </label>
    </div>

    <div class="tp-drawer-actions">
      <button class="btn btn-primary" data-act="profile">👤 Volles Profil</button>
      <button class="btn btn-ghost" data-act="copy-id">🔗 ID kopieren</button>
    </div>
  `

  // FIX #11: Drawer-Fallback mit sichtbarer Fehlermeldung
  try {
    drawer({ title: 'Podcaster-Profil', content: body, width: 460 })
  } catch {
    try {
      modal({ title: 'Podcaster-Profil', content: body })
    } catch {
      toast('Profil konnte nicht geöffnet werden', 'error')
      return
    }
  }

  const chartEl = body.querySelector('#tp-drawer-chart')
  if (chartEl && (row.spark || []).length) {
    try {
      makeAreaChart(chartEl, {
        categories: row.spark.map((_, i) => `T-${row.spark.length - i}`),
        series: [{ name: 'Follower', data: row.spark }],
        colors: ['#7aa7ff'],
        height: 200,
      })
    } catch {}
  } else if (chartEl) {
    chartEl.innerHTML = '<div style="height:100%;display:flex;align-items:center;justify-content:center;opacity:.5;font-size:12px">Keine Verlaufsdaten</div>'
  }

  const cb = body.querySelector('.tp-feat-cb-drawer')
  cb?.addEventListener('change', async () => {
    const desired = cb.checked
    cb.disabled = true
    const ok = await toggleFeature(row.id, desired, row)
    cb.disabled = false
    if (ok) {
      row.is_featured = desired
      onChange?.()
    } else {
      cb.checked = !desired
    }
  })

  body.querySelector('[data-act="profile"]')?.addEventListener('click', () => {
    try { showUserDetailModal(row.id) } catch (e) { toast('Profil nicht verfügbar', 'error') }
  })
  body.querySelector('[data-act="copy-id"]')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(row.id); toast('ID kopiert', 'success') }
    catch { toast('Konnte ID nicht kopieren', 'error') }
  })
}

function renderSkeletonGrid(el) {
  el.innerHTML = ''
  const grid = document.createElement('div')
  grid.className = 'tp-grid'
  el.appendChild(grid)
  for (let i = 0; i < 8; i++) {
    const c = document.createElement('div')
    c.className = 'tp-card glass-card'
    c.style.minHeight = '210px'
    grid.appendChild(c)
    try { const sk = skeletonLoader('100%', 210); c.appendChild(sk) } catch { c.innerHTML = '<div style="opacity:.4;padding:12px">Lade…</div>' }
  }
}

export default {
  id: 'trending-podcasters',
  title: 'Trending Podcaster',
  category: 'engagement',

  async mount(container) {
    // FIX #4: self-Referenz für retry-Handler, damit `this` nicht verloren geht
    const self = this
    try {
      injectStyles()

      container.innerHTML = `
        <div class="panel-shell" id="tp-shell">
          <div class="panel-head">
            <div>
              <h2 style="margin:0">Trending Podcaster</h2>
              <div style="font-size:12px;opacity:.6;margin-top:2px">Wachstum, Velocity & Discover-Featuring</div>
            </div>
          </div>
          <div class="panel-body">
            ${buildToolbar()}
            <div class="tp-hero-row" id="tp-hero"></div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:18px" id="tp-charts">
              <div class="glass-card" style="padding:14px;border-radius:14px;height:240px" id="tp-chart-velo"></div>
              <div class="glass-card" style="padding:14px;border-radius:14px;height:240px" id="tp-chart-top"></div>
            </div>
            <div id="tp-body"></div>
          </div>
        </div>
      `

      try { fadeIn(container.querySelector('#tp-shell')) } catch {}

      const body = container.querySelector('#tp-body')
      const heroEl = container.querySelector('#tp-hero')
      const veloChartEl = container.querySelector('#tp-chart-velo')
      const topChartEl = container.querySelector('#tp-chart-top')
      const rangeMount = container.querySelector('#tp-range')
      const sortMount = container.querySelector('#tp-sort')
      const searchEl = container.querySelector('#tp-search')

      // Sofortiges Skeleton -> kein weißer Screen
      renderSkeletonGrid(body)
      veloChartEl.innerHTML = '<div style="opacity:.4;font-size:12px;padding:12px">Lade…</div>'
      topChartEl.innerHTML = '<div style="opacity:.4;font-size:12px;padding:12px">Lade…</div>'

      // FIX: segmentedControl ist positional: (container, options, activeKey, onChange)
      // und options nutzt {key, label} — vorher: Options-Object → "Range-Picker fehlgeschlagen"
      try {
        segmentedControl(
          rangeMount,
          RANGES.map(r => ({ key: r.id, label: r.label })),
          state.range,
          v => { state.range = v; load() },
        )
      } catch {
        rangeMount.innerHTML = RANGES.map(r => `<button class="btn btn-ghost btn-sm" data-range="${r.id}">${r.label}</button>`).join('')
        rangeMount.addEventListener('click', e => {
          const b = e.target.closest('[data-range]'); if (!b) return
          state.range = b.dataset.range; load()
        })
      }
      try {
        segmentedControl(
          sortMount,
          SORTS.map(s => ({ key: s.id, label: s.label })),
          state.sort,
          v => { state.sort = v; renderGrid() },
        )
      } catch {
        sortMount.innerHTML = SORTS.map(s => `<button class="btn btn-ghost btn-sm" data-sort="${s.id}">${s.label}</button>`).join('')
        sortMount.addEventListener('click', e => {
          const b = e.target.closest('[data-sort]'); if (!b) return
          state.sort = b.dataset.sort; renderGrid()
        })
      }

      searchEl.addEventListener('input', debounce(() => {
        state.search = searchEl.value
        renderGrid()
      }, 180))

      container.querySelector('.tp-toolbar').addEventListener('click', async e => {
        const btn = e.target.closest('[data-act]'); if (!btn) return
        const act = btn.dataset.act
        if (act === 'refresh') return load()
        if (act === 'pdf') {
          try { await exportPanelAsPdf(container, 'trending-podcasters.pdf'); toast('PDF erstellt', 'success') }
          catch (err) { toast('PDF-Export fehlgeschlagen: ' + (err.message || err), 'error') }
          return
        }
        if (act === 'csv') {
          const cols = ['display_name', 'podcast_title', 'followers', 'followers_prev', 'growth_abs', 'velocity', 'plays', 'is_featured']
          const data = sortRows(filterRows(state.rows, state.search), state.sort).map(r => ({
            display_name: r.display_name || '',
            podcast_title: r.podcast_title || '',
            followers: r.followers || 0,
            followers_prev: r.followers_prev || 0,
            growth_abs: r.growth_abs || 0,
            velocity: Number((r.velocity || 0).toFixed(2)),
            plays: r.plays || 0,
            is_featured: !!r.is_featured,
          }))
          try { exportCsv(data, cols, `trending-podcasters-${state.range}.csv`); toast('CSV exportiert', 'success') }
          catch (err) { toast('CSV-Export fehlgeschlagen: ' + (err.message || err), 'error') }
        }
      })

      // FIX #5: Click-Guard auf .tp-feature-toggle entfernt — change-Handler reicht
      body.addEventListener('click', async e => {
        const retryBtn = e.target.closest('[data-act="retry"], [data-act="refresh"]')
        if (retryBtn) return load()

        if (e.target.closest('.tp-feat-cb')) {
          e.stopPropagation()
          return
        }
        const card = e.target.closest('.tp-card')
        if (card) {
          const id = card.dataset.id
          const row = state.rows.find(r => String(r.id) === String(id))
          if (row) openProfileDrawer(row, () => { renderGrid(); renderHero(heroEl, computeHero(state.rows)) })
        }
      })

      body.addEventListener('change', async e => {
        const cb = e.target.closest('.tp-feat-cb'); if (!cb) return
        e.stopPropagation()
        const id = cb.dataset.id
        const row = state.rows.find(r => String(r.id) === String(id))
        const desired = cb.checked
        cb.disabled = true
        const ok = await toggleFeature(id, desired, row)
        cb.disabled = false
        if (ok && row) {
          row.is_featured = desired
          renderHero(heroEl, computeHero(state.rows))
        } else {
          cb.checked = !desired
        }
      })

      function renderGrid() {
        const filtered = filterRows(state.rows, state.search)
        const sorted = sortRows(filtered, state.sort)

        if (!sorted.length) {
          // FIX #3: Korrekte Bedingung — error zuerst prüfen, dann rpcMissingState
          body.innerHTML = state.error
            ? errorState(state.error)
            : state.rows.length === 0
              ? rpcMissingState('crm_trending_podcasters')
              : emptyState()
          return
        }
        const grid = document.createElement('div')
        grid.className = 'tp-grid'
        grid.innerHTML = sorted.map(podcasterCard).join('')
        body.innerHTML = ''
        body.appendChild(grid)
        paintSparklines(grid)
        try { fadeIn(grid, 220) } catch {}
      }

      async function load() {
        state.loading = true
        state.error = null
        renderSkeletonGrid(body)
        heroEl.innerHTML = ''
        veloChartEl.innerHTML = '<div style="opacity:.4;font-size:12px;padding:12px">Lade…</div>'
        topChartEl.innerHTML = '<div style="opacity:.4;font-size:12px;padding:12px">Lade…</div>'
        try {
          const days = (RANGES.find(r => r.id === state.range) || RANGES[0]).days
          const rows = await fetchTrending(days)
          state.rows = rows
          state.loading = false
          renderHero(heroEl, computeHero(rows))
          renderVelocityChart(veloChartEl, rows)
          renderTopChart(topChartEl, rows)
          renderGrid()
        } catch (err) {
          state.loading = false
          state.error = err.message || String(err)
          body.innerHTML = errorState(state.error)
          heroEl.innerHTML = ''
          veloChartEl.innerHTML = '<div style="opacity:.4;font-size:12px;padding:12px">—</div>'
          topChartEl.innerHTML = '<div style="opacity:.4;font-size:12px;padding:12px">—</div>'
        }
      }

      await load()
    } catch (mountErr) {
      console.error('[trending-podcasters] mount failed:', mountErr)
      mountErrorState(container, mountErr?.message || String(mountErr))
      const retry = container.querySelector('[data-act="reload-panel"]')
      // FIX #4: Arrow-Function + self-Referenz statt `this` im normalen function-Scope
      retry?.addEventListener('click', () => {
        self.mount(container).catch(e => console.error('[trending-podcasters] remount failed:', e))
      })
    }
  }
}
