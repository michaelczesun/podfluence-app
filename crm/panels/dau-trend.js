import { sb } from '/lib/supabase.js'
import { toast, fmtNumber, htmlEscape, iconHtml } from '/lib/ui.js'
import { makeAreaChart, makeBarChart } from '/lib/charts.js'
import { exportPanelAsPdf, exportCsv } from '/lib/export.js'
import { countUp, fadeIn, skeletonLoader } from '/lib/animations.js'
import { drawer, segmentedControl } from '/lib/layout-extras.js'
import { showUserDetailModal } from '/lib/panel-actions.js'

const RANGE_OPTIONS = [
  { value: '7', label: '7T' },
  { value: '30', label: '30T' },
  { value: '90', label: '90T' }
]

const state = {
  range: '30',
  series: [],
  loading: false,
  error: null
}

function formatDateKey(d) {
  const date = new Date(d)
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function formatDateShort(key) {
  if (!key) return ''
  const d = new Date(key)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: 'short' })
}

async function fetchDau(days) {
  // Try admin_daily_series RPC first (SECURITY DEFINER, bypasses RLS)
  try {
    const { data, error } = await sb.rpc('admin_daily_series', { p_metric: 'dau', p_days: Number(days) })
    if (!error && data && data.length > 0) {
      return data.map(d => ({ date: d.date, users: Number(d.value) || 0 }))
    }
  } catch (_) {}

  // Fallback: direct app_opens query (RLS-friendly)
  const since = new Date()
  since.setDate(since.getDate() - (Number(days) - 1))
  since.setHours(0, 0, 0, 0)

  const { data, error } = await sb
    .from('app_opens')
    .select('user_id, created_at')
    .gte('created_at', since.toISOString())
  if (error) throw error
  const buckets = new Map()
  for (let i = 0; i < Number(days); i++) {
    const d = new Date(since)
    d.setDate(d.getDate() + i)
    buckets.set(formatDateKey(d), new Set())
  }
  ;(data || []).forEach(row => {
    const key = formatDateKey(row.created_at)
    if (buckets.has(key)) buckets.get(key).add(row.user_id)
  })
  return Array.from(buckets.entries()).map(([date, set]) => ({
    date,
    users: set.size
  }))
}

async function fetchUsersForDay(dateKey) {
  const start = new Date(dateKey)
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)

  const { data: opens } = await sb
    .from('app_opens')
    .select('user_id, created_at')
    .gte('created_at', start.toISOString())
    .lt('created_at', end.toISOString())

  const ids = Array.from(new Set((opens || []).map(p => p.user_id))).filter(Boolean)
  if (!ids.length) return []

  // Use admin RPC (SECURITY DEFINER) to bypass RLS on user table
  const { data: users } = await sb.rpc('admin_users_list_full', { p_limit: 500, p_offset: 0, p_search: '' })
  if (!users) return []
  return users.filter(u => ids.includes(u.id)).map(u => ({
    id: u.id,
    username: u.username,
    display_name: u.full_name || u.username,
    avatar_url: u.avatar_url || null,
    is_verified: u.is_verified,
    last_seen_at: u.last_seen_at
  }))
}

function computeKpis(series) {
  if (!series.length) return { avg: 0, peak: 0, min: 0, peakDay: '', trend: 0 }
  const vals = series.map(p => p.users)
  const avg = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)
  const peak = Math.max(...vals)
  const min = Math.min(...vals)
  const peakIdx = vals.indexOf(peak)
  const peakDay = series[peakIdx]?.date
  const half = Math.floor(series.length / 2)
  const firstHalf = vals.slice(0, half).reduce((a, b) => a + b, 0) / Math.max(half, 1)
  const secondHalf = vals.slice(half).reduce((a, b) => a + b, 0) / Math.max(vals.length - half, 1)
  const trend = firstHalf ? Math.round(((secondHalf - firstHalf) / firstHalf) * 100) : 0
  return { avg, peak, min, peakDay, trend }
}

function renderSkeleton(host) {
  host.innerHTML = `
    <div class="dau-skeleton">
      ${skeletonLoader({ height: '320px', width: '100%', radius: '20px' })}
      <div class="dau-skeleton-grid">
        ${skeletonLoader({ height: '110px', radius: '16px' })}
        ${skeletonLoader({ height: '110px', radius: '16px' })}
        ${skeletonLoader({ height: '110px', radius: '16px' })}
        ${skeletonLoader({ height: '110px', radius: '16px' })}
      </div>
    </div>
  `
}

function renderError(host, message, onRetry) {
  host.innerHTML = `
    <div class="empty-state error-state glass-card">
      <div class="empty-icon">${iconHtml('alert-triangle')}</div>
      <h3>Daten konnten nicht geladen werden</h3>
      <p>Fehler: ${htmlEscape(message || 'Unbekannter Fehler')}</p>
      <button class="btn btn-primary" id="dau-retry">${iconHtml('refresh-cw')} Erneut versuchen</button>
    </div>
  `
  host.querySelector('#dau-retry')?.addEventListener('click', onRetry)
}

function renderEmpty(host) {
  host.innerHTML = `
    <div class="empty-state glass-card">
      <div class="empty-icon">${iconHtml('activity')}</div>
      <h3>Noch keine Aktivität</h3>
      <p>Im gewählten Zeitraum wurden keine aktiven Nutzer erfasst.</p>
    </div>
  `
}

async function renderBody(host, onPointClick) {
  if (state.loading) return renderSkeleton(host)
  if (state.error) return renderError(host, state.error, () => loadAndRender(host, onPointClick))
  if (!state.series.length) return renderEmpty(host)

  const kpis = computeKpis(state.series)
  const today = state.series[state.series.length - 1]?.users || 0
  const yesterday = state.series[state.series.length - 2]?.users || 0
  const delta = yesterday ? Math.round(((today - yesterday) / yesterday) * 100) : 0
  const trendArrow = kpis.trend > 0 ? '↑' : kpis.trend < 0 ? '↓' : '→'
  const trendClass = kpis.trend > 0 ? 'up' : kpis.trend < 0 ? 'down' : 'flat'

  host.innerHTML = `
    <div class="dau-hero glass-card">
      <div class="dau-hero-meta">
        <div class="dau-hero-label">Aktive Nutzer heute</div>
        <div class="dau-hero-value" id="dau-hero-value">0</div>
        <div class="dau-hero-sub">
          <span class="dau-trend ${trendClass}">${trendArrow} ${Math.abs(kpis.trend)}% Trend</span>
          <span class="dau-delta ${delta >= 0 ? 'up' : 'down'}">${delta >= 0 ? '+' : ''}${delta}% vs. Vortag</span>
        </div>
      </div>
      <div class="dau-hero-chart" id="dau-chart"></div>
    </div>

    <div class="dau-kpi-grid">
      <div class="kpi-card glass-card">
        <div class="kpi-icon">${iconHtml('bar-chart-2')}</div>
        <div class="kpi-label">Ø Tagesdurchschnitt</div>
        <div class="kpi-value" data-count="${kpis.avg}">0</div>
      </div>
      <div class="kpi-card glass-card">
        <div class="kpi-icon">${iconHtml('trending-up')}</div>
        <div class="kpi-label">Peak</div>
        <div class="kpi-value" data-count="${kpis.peak}">0</div>
        <div class="kpi-sub">${kpis.peakDay ? formatDateShort(kpis.peakDay) : ''}</div>
      </div>
      <div class="kpi-card glass-card">
        <div class="kpi-icon">${iconHtml('trending-down')}</div>
        <div class="kpi-label">Minimum</div>
        <div class="kpi-value" data-count="${kpis.min}">0</div>
      </div>
      <div class="kpi-card glass-card">
        <div class="kpi-icon">${iconHtml('calendar')}</div>
        <div class="kpi-label">Zeitraum</div>
        <div class="kpi-value">${state.range}T</div>
        <div class="kpi-sub">${state.series.length} Datenpunkte</div>
      </div>
    </div>

    <div class="dau-secondary glass-card">
      <div class="section-head">
        <h3>${iconHtml('bar-chart')} Tagesverteilung</h3>
        <span class="muted">Klick auf einen Tag öffnet die Nutzerliste</span>
      </div>
      <div id="dau-bars"></div>
    </div>
  `

  const heroEl = host.querySelector('#dau-hero-value')
  if (heroEl) countUp(heroEl, today, { duration: 900, format: fmtNumber })

  host.querySelectorAll('.kpi-value[data-count]').forEach(el => {
    const target = Number(el.dataset.count)
    countUp(el, target, { duration: 800, format: fmtNumber })
  })

  const chartHost = host.querySelector('#dau-chart')
  if (chartHost) {
    try {
      makeAreaChart(chartHost, {
        data: state.series.map(p => ({ x: p.date, y: p.users })),
        xLabel: d => formatDateShort(d),
        yLabel: v => fmtNumber(v),
        color: '#7c5cff',
        fade: true,
        height: 280,
        onPointClick: (point) => onPointClick(point.x)
      })
    } catch (e) {
      chartHost.innerHTML = `<div class="muted">Chart konnte nicht gezeichnet werden: ${htmlEscape(e.message || '')}</div>`
    }
  }

  const barsHost = host.querySelector('#dau-bars')
  if (barsHost) {
    try {
      makeBarChart(barsHost, {
        data: state.series.map(p => ({ label: formatDateShort(p.date), value: p.users, key: p.date })),
        color: '#7c5cff',
        height: 200,
        onBarClick: (bar) => onPointClick(bar.key)
      })
    } catch (e) {
      barsHost.innerHTML = `<div class="muted">Balken konnten nicht gezeichnet werden: ${htmlEscape(e.message || '')}</div>`
    }
  }

  const hero = host.querySelector('.dau-hero')
  if (hero) fadeIn(hero)
}

async function openDayDrawer(dateKey) {
  const dlg = drawer({
    title: `Aktive Nutzer · ${formatDateShort(dateKey)}`,
    width: '480px',
    content: `<div class="drawer-loading">${skeletonLoader({ height: '64px', radius: '12px' })}${skeletonLoader({ height: '64px', radius: '12px' })}${skeletonLoader({ height: '64px', radius: '12px' })}</div>`
  })

  try {
    const users = await fetchUsersForDay(dateKey)
    if (!users.length) {
      dlg.setContent(`
        <div class="empty-state">
          <div class="empty-icon">${iconHtml('users')}</div>
          <h4>Keine aktiven Nutzer</h4>
          <p>An diesem Tag wurde keine Aktivität erfasst.</p>
        </div>
      `)
      return
    }

    const rows = users.map(u => `
      <div class="user-row" data-uid="${htmlEscape(u.id)}">
        <div class="avatar">
          ${u.avatar_url
            ? `<img src="${htmlEscape(u.avatar_url)}" alt="">`
            : `<div class="avatar-fallback">${htmlEscape((u.display_name || u.username || '?').slice(0, 1).toUpperCase())}</div>`}
        </div>
        <div class="user-meta">
          <div class="user-name">
            ${htmlEscape(u.display_name || u.username || 'Unbekannt')}
            ${u.is_verified ? `<span class="badge verified">${iconHtml('check')}</span>` : ''}
          </div>
          <div class="user-sub">@${htmlEscape(u.username || '—')}</div>
        </div>
        <button class="btn-icon" data-action="open" title="Details">${iconHtml('arrow-right')}</button>
      </div>
    `).join('')

    dlg.setContent(`
      <div class="drawer-stat-row">
        <div><strong>${fmtNumber(users.length)}</strong> aktive Nutzer</div>
        <button class="btn btn-ghost" id="day-export">${iconHtml('download')} CSV</button>
      </div>
      <div class="user-list">${rows}</div>
    `)

    dlg.root.querySelectorAll('.user-row').forEach(row => {
      row.addEventListener('click', () => {
        const uid = row.dataset.uid
        if (uid) showUserDetailModal(uid)
      })
    })

    dlg.root.querySelector('#day-export')?.addEventListener('click', () => {
      try {
        exportCsv(`dau-${dateKey}.csv`, users.map(u => ({
          id: u.id,
          username: u.username,
          display_name: u.display_name,
          verified: u.is_verified ? 'ja' : 'nein',
          last_seen: u.last_seen_at || ''
        })))
        toast('CSV exportiert', 'success')
      } catch (e) {
        toast('CSV-Export fehlgeschlagen: ' + (e.message || ''), 'error')
      }
    })
  } catch (e) {
    dlg.setContent(`
      <div class="empty-state error-state">
        <div class="empty-icon">${iconHtml('alert-triangle')}</div>
        <h4>Fehler beim Laden</h4>
        <p>Fehler: ${htmlEscape(e.message || 'Unbekannter Fehler')}</p>
      </div>
    `)
  }
}

async function loadAndRender(host, onPointClick) {
  state.loading = true
  state.error = null
  renderSkeleton(host)
  try {
    state.series = await fetchDau(state.range)
  } catch (e) {
    state.error = e.message || 'Ladevorgang fehlgeschlagen'
    state.series = []
  } finally {
    state.loading = false
    try {
      await renderBody(host, onPointClick)
    } catch (e) {
      renderError(host, e.message || 'Render-Fehler', () => loadAndRender(host, onPointClick))
    }
  }
}

export default {
  id: 'dau-trend',
  title: 'Tägliche aktive Nutzer',
  category: 'overview',

  async mount(container) {
    try {
      container.innerHTML = `
        <div class="panel-shell dau-panel">
          <div class="panel-head">
            <div class="panel-head-left">
              <h2>${iconHtml('activity')} Tägliche aktive Nutzer</h2>
              <p class="panel-sub">DAU-Entwicklung im gewählten Zeitraum</p>
            </div>
            <div class="toolbar">
              <div id="dau-range"></div>
              <button class="btn btn-ghost" id="dau-refresh" title="Aktualisieren">${iconHtml('refresh-cw')} Aktualisieren</button>
              <button class="btn btn-ghost" id="dau-pdf" title="PDF-Export">${iconHtml('file-text')} PDF</button>
              <button class="btn btn-ghost" id="dau-csv" title="CSV-Export">${iconHtml('download')} CSV</button>
            </div>
          </div>
          <div class="panel-body" id="dau-body"></div>
        </div>
      `

      const body = container.querySelector('#dau-body')
      const rangeHost = container.querySelector('#dau-range')

      if (body) renderSkeleton(body)

      if (rangeHost) {
        try {
          segmentedControl(rangeHost, {
            options: RANGE_OPTIONS,
            value: state.range,
            onChange: async (val) => {
              state.range = val
              if (body) await loadAndRender(body, openDayDrawer)
            }
          })
        } catch (e) {
          rangeHost.innerHTML = `<span class="muted">Range-Picker fehlgeschlagen</span>`
        }
      }

      container.querySelector('#dau-refresh')?.addEventListener('click', async () => {
        if (!body) return
        await loadAndRender(body, openDayDrawer)
        toast('Aktualisiert', 'success')
      })

      container.querySelector('#dau-pdf')?.addEventListener('click', async () => {
        try {
          await exportPanelAsPdf(container, {
            filename: `dau-trend-${state.range}t.pdf`,
            title: `DAU · ${state.range} Tage`
          })
          toast('PDF erstellt', 'success')
        } catch (e) {
          toast('PDF-Export fehlgeschlagen: ' + (e.message || ''), 'error')
        }
      })

      container.querySelector('#dau-csv')?.addEventListener('click', () => {
        if (!state.series.length) {
          toast('Keine Daten zum Exportieren', 'warning')
          return
        }
        try {
          exportCsv(`dau-trend-${state.range}t.csv`, state.series.map(p => ({
            datum: p.date,
            aktive_nutzer: p.users
          })))
          toast('CSV exportiert', 'success')
        } catch (e) {
          toast('CSV-Export fehlgeschlagen: ' + (e.message || ''), 'error')
        }
      })

      const shell = container.querySelector('.panel-shell')
      if (shell) fadeIn(shell)

      if (body) {
        loadAndRender(body, openDayDrawer).catch(e => {
          renderError(body, e.message || 'Initialer Ladefehler', () => loadAndRender(body, openDayDrawer))
        })
      }
    } catch (e) {
      container.innerHTML = `
        <div class="empty-state error-state glass-card" style="padding:32px;text-align:center">
          <div class="empty-icon">${iconHtml ? iconHtml('alert-triangle') : '⚠️'}</div>
          <h3>Panel konnte nicht initialisiert werden</h3>
          <p>Fehler: ${htmlEscape ? htmlEscape(e.message || String(e)) : (e.message || String(e))}</p>
          <button class="btn btn-primary" onclick="location.reload()">Neu laden</button>
        </div>
      `
    }
  }
}
