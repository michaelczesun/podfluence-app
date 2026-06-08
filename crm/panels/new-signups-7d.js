import { sb } from '/lib/supabase.js?v=20260608h'
import { toast, fmtNumber, fmtDateTime, fmtRelativeTime, htmlEscape, iconHtml } from '/lib/ui.js?v=20260608h'
import { makeBarChart } from '/lib/charts.js?v=20260608h'
import { exportPanelAsPdf, exportCsv } from '/lib/export.js?v=20260608h'
import { countUp, fadeIn, skeletonLoader } from '/lib/animations.js?v=20260608h'
import { segmentedControl } from '/lib/layout-extras.js?v=20260608h'
import { showUserDetailModal } from '/lib/panel-actions.js?v=20260608h'

const PANEL_ID = 'new-signups-7d'

function startOfDay(d) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

function dayKey(d) {
  return startOfDay(d).toISOString().slice(0, 10)
}

function dayLabel(d) {
  return new Date(d).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })
}

function buildDayBuckets(rangeDays) {
  const buckets = []
  const today = startOfDay(new Date())
  for (let i = rangeDays - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    buckets.push({ date: d, key: dayKey(d), label: dayLabel(d), count: 0 })
  }
  return buckets
}

// FIX (high): use parameter names matching DB signature admin_daily_series(metric, days) — no p_ prefix
// FIX (med): return { buckets, total } directly from admin_daily_series data — no dummy-row synthesis
async function fetchSignupsInRange(rangeDays) {
  const { data, error } = await sb.rpc('admin_daily_series', { p_metric: 'signups', p_days: rangeDays })
  if (error) throw error
  const buckets = buildDayBuckets(rangeDays)
  const idx = new Map(buckets.map((b, i) => [b.key, i]))
  let total = 0
  for (const d of (data || [])) {
    const k = dayKey(d.date)
    const count = Number(d.value) || 0
    if (idx.has(k)) buckets[idx.get(k)].count = count
    total += count
  }
  return { buckets, total }
}

// FIX (med): fetch 200 rows so clientside sort reliably captures the newest 20
async function fetchLatestSignups(limit = 20) {
  const { data, error } = await sb.rpc('admin_users_list_full', { p_limit: 200, p_offset: 0, p_search: '' })
  if (error) throw error
  const rows = (data || []).slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  return rows.slice(0, limit)
}

function avatarHtml(row) {
  const name = row.display_name || row.username || 'Unbekannt'
  const initial = (name[0] || '?').toUpperCase()
  if (row.avatar_url) {
    return `<img class="avatar" src="${htmlEscape(row.avatar_url)}" alt="${htmlEscape(name)}" />`
  }
  return `<div class="avatar avatar-fallback">${htmlEscape(initial)}</div>`
}

function renderSignupRow(row) {
  const name = row.display_name || row.username || 'Unbekannt'
  const handle = row.username ? `@${row.username}` : ''
  const verified = row.is_verified
    ? `<span class="badge badge-success" title="Verifiziert">✓</span>`
    : ''
  return `
    <tr class="signup-row" data-user-id="${htmlEscape(row.id)}">
      <td class="cell-avatar">${avatarHtml(row)}</td>
      <td class="cell-name">
        <div class="name-primary">${htmlEscape(name)} ${verified}</div>
        <div class="name-secondary">${htmlEscape(handle)}</div>
      </td>
      <td class="cell-time">
        <div class="time-primary">${htmlEscape(fmtRelativeTime(row.created_at))}</div>
        <div class="time-secondary">${htmlEscape(fmtDateTime(row.created_at))}</div>
      </td>
      <td class="cell-action">
        <button class="btn btn-ghost btn-sm" data-action="open-user" data-user-id="${htmlEscape(row.id)}">Öffnen</button>
      </td>
    </tr>
  `
}

function emptyState(msg, cta) {
  return `
    <div class="empty-state glass-card">
      <div class="empty-icon" style="font-size:42px;">👥</div>
      <div class="empty-title">Noch keine Anmeldungen</div>
      <div class="empty-text">${htmlEscape(msg)}</div>
      ${cta ? `<button class="btn btn-primary" data-action="refresh">${htmlEscape(cta)}</button>` : ''}
    </div>
  `
}

function errorState(err) {
  return `
    <div class="error-state glass-card">
      <div class="error-icon" style="font-size:42px;">⚠️</div>
      <div class="error-title">Daten konnten nicht geladen werden</div>
      <div class="error-text">${htmlEscape(err?.message || String(err))}</div>
      <button class="btn btn-primary" data-action="retry">Erneut versuchen</button>
    </div>
  `
}

function mountErrorBox(container, err) {
  container.innerHTML = `
    <div class="panel-shell" data-panel="${PANEL_ID}">
      <div class="error-state glass-card" style="padding:24px;">
        <div class="error-icon" style="font-size:42px;">⚠️</div>
        <div class="error-title">Panel konnte nicht initialisiert werden</div>
        <div class="error-text">${htmlEscape(err?.message || String(err))}</div>
        <button class="btn btn-primary" data-action="reload">Seite neu laden</button>
      </div>
    </div>
  `
  container.querySelector('[data-action="reload"]')?.addEventListener('click', () => location.reload())
}

export default {
  id: PANEL_ID,
  title: 'Neue Anmeldungen',
  category: 'overview',

  async mount(container) {
    try {
      let range = 7
      const state = { latest: [], buckets: [], total: 0, loading: true, error: null }

      container.innerHTML = `
        <div class="panel-shell" data-panel="${PANEL_ID}">
          <div class="panel-head glass-card">
            <div class="panel-head-left">
              <h2 class="panel-title">Neue Anmeldungen</h2>
              <p class="panel-sub">Wer ist neu auf Podfluence dazugekommen?</p>
            </div>
            <div class="toolbar" id="toolbar">
              <div id="range-switch" class="toolbar-segment"></div>
              <button class="btn btn-ghost" data-action="refresh" title="Aktualisieren">🔄 <span>Aktualisieren</span></button>
              <button class="btn btn-ghost" data-action="export-pdf" title="Als PDF exportieren">📄 <span>PDF</span></button>
              <button class="btn btn-ghost" data-action="export-csv" title="Als CSV exportieren">💾 <span>CSV</span></button>
            </div>
          </div>

          <div class="panel-body" id="body">
            ${skeletonLoader ? skeletonLoader({ rows: 6 }) : '<div class="skeleton skeleton-block"></div>'}
          </div>
        </div>
      `

      const rangeMount = container.querySelector('#range-switch')
      if (rangeMount && segmentedControl) {
        try {
          segmentedControl(rangeMount, {
            options: [
              { value: 7, label: '7 Tage' },
              { value: 30, label: '30 Tage' },
            ],
            value: range,
            onChange: (v) => {
              range = Number(v)
              load()
            },
          })
        } catch (e) {
          rangeMount.innerHTML = `
            <button class="btn btn-sm" data-action="range" data-range="7">7T</button>
            <button class="btn btn-sm" data-action="range" data-range="30">30T</button>
          `
        }
      }

      const body = container.querySelector('#body')

      async function load() {
        state.loading = true
        state.error = null
        body.innerHTML = skeletonLoader ? skeletonLoader({ rows: 6 }) : '<div class="skeleton skeleton-block"></div>'
        try {
          const [rangeResult, latest] = await Promise.all([
            fetchSignupsInRange(range),
            fetchLatestSignups(20),
          ])
          state.buckets = rangeResult.buckets
          state.total = rangeResult.total
          state.latest = latest
          state.loading = false
          render()
        } catch (e) {
          console.error('[new-signups-7d] load failed', e)
          state.loading = false
          state.error = e
          body.innerHTML = errorState(e)
        }
      }

      function render() {
        const totalRange = state.total
        const avgPerDay = range > 0 ? totalRange / range : 0
        const peak = state.buckets.reduce((m, b) => (b.count > m.count ? b : m), { count: 0, label: '—' })
        const todayCount = state.buckets[state.buckets.length - 1]?.count || 0

        const heroHtml = `
          <div class="hero-row" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;margin-bottom:18px;">
            <div class="hero-stat glass-card">
              <div class="hero-label">Gesamt (${range}T)</div>
              <div class="hero-value" data-countup="${totalRange}">0</div>
              <div class="hero-sub">${avgPerDay.toFixed(1)} pro Tag im Schnitt</div>
            </div>
            <div class="hero-stat glass-card">
              <div class="hero-label">Heute</div>
              <div class="hero-value" data-countup="${todayCount}">0</div>
              <div class="hero-sub">Neue Profile in 24h</div>
            </div>
            <div class="hero-stat glass-card">
              <div class="hero-label">Spitzentag</div>
              <div class="hero-value" data-countup="${peak.count}">0</div>
              <div class="hero-sub">${htmlEscape(peak.label || '—')}</div>
            </div>
          </div>
        `

        const chartHtml = `
          <div class="chart-card glass-card" style="margin-bottom:18px;">
            <div class="chart-head" style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px;">
              <h3 style="margin:0;">Anmeldungen pro Tag</h3>
              <div class="chart-sub" style="opacity:.7;font-size:13px;">${range}-Tage-Verlauf</div>
            </div>
            <div id="signup-chart" class="chart-area" style="min-height:320px;"></div>
          </div>
        `

        const listHtml = state.latest.length === 0
          ? emptyState('Sobald sich neue Nutzer registrieren, erscheinen sie hier.', 'Aktualisieren')
          : `
            <div class="list-card glass-card">
              <div class="list-head" style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:12px;">
                <h3 style="margin:0;">Letzte 20 Signups</h3>
                <div class="list-sub" style="opacity:.7;font-size:13px;">Klick auf eine Zeile öffnet das Profil</div>
              </div>
              <table class="data-table data-table-hover">
                <thead>
                  <tr>
                    <th style="width:64px;"></th>
                    <th>Name</th>
                    <th>Registriert</th>
                    <th style="width:96px;"></th>
                  </tr>
                </thead>
                <tbody id="signup-tbody">
                  ${state.latest.map(renderSignupRow).join('')}
                </tbody>
              </table>
            </div>
          `

        body.innerHTML = `${heroHtml}${chartHtml}${listHtml}`

        const chartMount = body.querySelector('#signup-chart')
        if (chartMount) {
          try {
            makeBarChart(chartMount, {
              labels: state.buckets.map((b) => b.label),
              series: [{ name: 'Anmeldungen', data: state.buckets.map((b) => b.count) }],
              color: '#8B5CF6',
              height: 320,
              animate: true,
              valueFormatter: (v) => (fmtNumber ? fmtNumber(v) : String(v)),
            })
          } catch (e) {
            console.warn('[new-signups-7d] chart failed', e)
            chartMount.innerHTML = '<div class="chart-fallback" style="padding:24px;opacity:.6;">Chart konnte nicht geladen werden</div>'
          }
        }

        if (countUp) {
          body.querySelectorAll('[data-countup]').forEach((el) => {
            const target = Number(el.getAttribute('data-countup')) || 0
            try { countUp(el, { from: 0, to: target, duration: 900 }) } catch { el.textContent = String(target) }
          })
        }

        body.querySelectorAll('.signup-row').forEach((tr) => {
          tr.addEventListener('click', () => {
            const userId = tr.getAttribute('data-user-id')
            if (userId) openUserDrawer(userId)
          })
        })

        if (fadeIn) {
          try { fadeIn(body, { duration: 280 }) } catch {}
        }
      }

      function openUserDrawer(userId) {
        try {
          showUserDetailModal(userId)
        } catch (e) {
          console.error('[new-signups-7d] open user failed', e)
          toast?.('Profil konnte nicht geöffnet werden', 'error')
        }
      }

      function doExportCsv() {
        if (!state.latest.length) {
          toast?.('Keine Daten zum Exportieren', 'warn')
          return
        }
        const rows = state.latest.map((r) => ({
          id: r.id,
          username: r.username || '',
          name: r.display_name || '',
          verified: r.is_verified ? 'ja' : 'nein',
          created_at: r.created_at,
        }))
        try {
          exportCsv(rows, `signups-${new Date().toISOString().slice(0, 10)}.csv`)
          toast?.('CSV exportiert', 'success')
        } catch (e) {
          console.error(e)
          toast?.('CSV-Export fehlgeschlagen', 'error')
        }
      }

      async function doExportPdf() {
        try {
          await exportPanelAsPdf(container.querySelector('.panel-shell'), {
            title: `Neue Anmeldungen – ${range} Tage`,
            filename: `signups-${range}d-${new Date().toISOString().slice(0, 10)}.pdf`,
          })
          toast?.('PDF erstellt', 'success')
        } catch (e) {
          console.error(e)
          toast?.('PDF-Export fehlgeschlagen', 'error')
        }
      }

      container.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]')
        if (!btn) return
        const action = btn.getAttribute('data-action')
        if (action === 'refresh' || action === 'retry') load()
        else if (action === 'export-csv') doExportCsv()
        else if (action === 'export-pdf') doExportPdf()
        else if (action === 'open-user') {
          e.stopPropagation()
          const uid = btn.getAttribute('data-user-id')
          if (uid) openUserDrawer(uid)
        } else if (action === 'range') {
          const r = Number(btn.getAttribute('data-range'))
          if (r) {
            range = r
            // update active class on fallback buttons
            rangeMount?.querySelectorAll('[data-action="range"]').forEach((b) => {
              b.classList.toggle('active', Number(b.getAttribute('data-range')) === r)
            })
            load()
          }
        }
      })

      load()
    } catch (err) {
      console.error('[new-signups-7d] mount failed', err)
      mountErrorBox(container, err)
    }
  },
}
