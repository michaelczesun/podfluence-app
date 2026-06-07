import { sb } from '/lib/supabase.js'
import { toast, fmtNumber, fmtDateTime, htmlEscape, iconHtml } from '/lib/ui.js'
import { makeAreaChart, makeRadialBar } from '/lib/charts.js'
import { exportPanelAsPdf, exportCsv } from '/lib/export.js'
import { countUp, fadeIn, skeletonLoader } from '/lib/animations.js'
import { drawer } from '/lib/layout-extras.js'

const SENTRY_URL = 'https://sentry.io/organizations/podfluence/issues/'

function fmtRelative(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  const diffMs = Date.now() - d.getTime()
  const min = Math.floor(diffMs / 60000)
  if (min < 1) return 'gerade eben'
  if (min < 60) return `vor ${min} Min`
  const h = Math.floor(min / 60)
  if (h < 24) return `vor ${h} Std`
  const days = Math.floor(h / 24)
  if (days < 30) return `vor ${days} T`
  return fmtDateTime(iso)
}

async function fetchData() {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  // crash_events → crash_logs (renamed table)
  const { data: crashes, error: crashErr } = await sb
    .from('crash_logs')
    .select('*')
    .gte('created_at', since)
    .order('created_at', { ascending: false })

  if (crashErr) throw crashErr

  // app_sessions does not exist in DB — sessions count unavailable
  let sessions = 0
  let sessionsUnavailable = true

  const list = crashes || []
  const totalCrashes = list.length
  const crashSessions = new Set(list.map(c => c.session_id).filter(Boolean)).size
  const crashFreeRate = sessions > 0
    ? Math.max(0, Math.min(100, ((sessions - crashSessions) / sessions) * 100))
    : 100

  const buckets = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() - i)
    buckets.push({ ts: d.getTime(), label: d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit' }), count: 0 })
  }
  for (const c of list) {
    const d = new Date(c.created_at)
    d.setHours(0, 0, 0, 0)
    const ts = d.getTime()
    const b = buckets.find(b => b.ts === ts)
    if (b) b.count++
  }

  const compMap = new Map()
  for (const c of list) {
    const k = c.component || 'Unbekannt'
    const cur = compMap.get(k) || { component: k, count: 0, last: c.created_at }
    cur.count++
    if (new Date(c.created_at) > new Date(cur.last)) cur.last = c.created_at
    compMap.set(k, cur)
  }
  const topLocations = [...compMap.values()].sort((a, b) => b.count - a.count).slice(0, 5)

  return {
    crashFreeRate,
    totalCrashes,
    crashSessions,
    sessions,
    sessionsUnavailable,
    series: buckets,
    topLocations,
    raw: list,
  }
}

function renderError(body, err, retry) {
  body.innerHTML = `
    <div class="glass-card error-state" style="text-align:center;padding:40px 24px">
      <div style="font-size:42px;margin-bottom:12px;color:#ef4444">${iconHtml('alert-triangle')}</div>
      <h3 style="margin:0 0 8px 0">Daten konnten nicht geladen werden</h3>
      <p style="color:var(--text-muted);margin:0 0 16px 0">${htmlEscape(err?.message || 'Unbekannter Fehler')}</p>
      <button class="btn btn-primary" id="retry-btn">${iconHtml('refresh-cw')} Erneut versuchen</button>
    </div>
  `
  body.querySelector('#retry-btn')?.addEventListener('click', retry)
}

function renderEmpty(body) {
  body.innerHTML = `
    <div class="glass-card empty-state" style="text-align:center;padding:48px 24px">
      <div style="font-size:48px;margin-bottom:12px;color:#10b981">${iconHtml('shield-check')}</div>
      <h3 style="margin:0 0 8px 0">Keine Crashes in den letzten 7 Tagen</h3>
      <p style="color:var(--text-muted);margin-bottom:16px">Die App läuft stabil. Volle Details und historische Daten in Sentry.</p>
      <a class="btn btn-primary" href="${SENTRY_URL}" target="_blank" rel="noopener">
        ${iconHtml('external-link')} Sentry öffnen
      </a>
    </div>
  `
}

function renderContent(body, data) {
  const heroColor = data.crashFreeRate >= 99.5 ? '#10b981'
    : data.crashFreeRate >= 99 ? '#84cc16'
    : data.crashFreeRate >= 98 ? '#f59e0b'
    : '#ef4444'

  body.innerHTML = `
    <div class="panel-grid" style="display:grid;gap:20px">

      <section class="glass-card hero-section" style="padding:24px;display:grid;grid-template-columns:minmax(280px,1fr) 1fr;gap:24px;align-items:center">
        <div id="radial-hero" style="min-height:260px;display:flex;align-items:center;justify-content:center"></div>
        <div class="hero-stats" style="display:grid;gap:16px">
          <div>
            <div style="font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--text-muted)">Crash-free Sessions</div>
            <div style="font-size:44px;font-weight:700;line-height:1.1;color:${heroColor}" id="hero-rate">0,00%</div>
            <div style="font-size:13px;color:var(--text-muted)">über die letzten 7 Tage</div>
          </div>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">
            <div class="mini-stat" style="padding:10px 12px;border-radius:10px;background:rgba(255,255,255,.04)">
              <div class="mini-label" style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted)">Crashes ges.</div>
              <div class="mini-value" id="stat-total" style="font-size:20px;font-weight:600;margin-top:2px">0</div>
            </div>
            <div class="mini-stat" style="padding:10px 12px;border-radius:10px;background:rgba(255,255,255,.04)">
              <div class="mini-label" style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted)">Betr. Sessions</div>
              <div class="mini-value" id="stat-sessions" style="font-size:20px;font-weight:600;margin-top:2px">0</div>
            </div>
            <div class="mini-stat" style="padding:10px 12px;border-radius:10px;background:rgba(255,255,255,.04)">
              <div class="mini-label" style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted)">Sessions ges.</div>
              <div class="mini-value" id="stat-total-sessions" style="font-size:20px;font-weight:600;margin-top:2px">${data.sessionsUnavailable ? '—' : '0'}</div>
            </div>
          </div>
          ${data.sessionsUnavailable ? `
          <div class="glass-card" style="padding:10px 14px;display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text-muted)">
            ${iconHtml('alert')} Daten kommen sobald die Tabelle <code>app_sessions</code> angelegt ist
          </div>` : ''}
          <a href="${SENTRY_URL}" target="_blank" rel="noopener" class="btn btn-primary" style="justify-self:start">
            ${iconHtml('external-link')} Volle Details in Sentry
          </a>
        </div>
      </section>

      <section class="glass-card" style="padding:20px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
          <h3 style="margin:0;font-size:15px">Crashes pro Tag</h3>
          <span style="font-size:12px;color:var(--text-muted)">letzte 7 Tage</span>
        </div>
        <div id="area-chart" style="min-height:240px"></div>
      </section>

      <section class="glass-card" style="padding:20px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
          <h3 style="margin:0;font-size:15px">Top 5 Crash-Locations</h3>
          <button class="btn btn-ghost btn-sm" id="csv-locations-btn" title="Top-Locations als CSV">
            ${iconHtml('download')} CSV
          </button>
        </div>
        <div class="data-table-wrap">
          <table class="data-table sortable" id="locations-table">
            <thead>
              <tr>
                <th style="width:42px">#</th>
                <th>Komponente</th>
                <th style="text-align:right">Anzahl</th>
                <th>Zuletzt gesehen</th>
                <th style="width:80px"></th>
              </tr>
            </thead>
            <tbody>
              ${data.topLocations.length === 0 ? `
                <tr><td colspan="5" style="text-align:center;padding:32px;color:var(--text-muted)">Keine Crashes erfasst</td></tr>
              ` : data.topLocations.map((loc, i) => `
                <tr data-component="${htmlEscape(loc.component)}" class="row-clickable" style="cursor:pointer">
                  <td><span class="rank-badge rank-${i + 1}">${i + 1}</span></td>
                  <td><code style="font-size:13px">${htmlEscape(loc.component)}</code></td>
                  <td style="text-align:right;font-variant-numeric:tabular-nums;font-weight:600">${fmtNumber(loc.count)}</td>
                  <td style="color:var(--text-muted)">${htmlEscape(fmtRelative(loc.last))}</td>
                  <td><button class="btn btn-ghost btn-sm details-btn" data-component="${htmlEscape(loc.component)}">Details</button></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </section>

    </div>
  `

  try {
    makeRadialBar(body.querySelector('#radial-hero'), {
      value: data.crashFreeRate,
      max: 100,
      label: 'crash-free',
      color: heroColor,
      thickness: 14,
    })
  } catch (e) { console.warn('[crash-rate] radial chart failed', e) }

  try {
    makeAreaChart(body.querySelector('#area-chart'), {
      labels: data.series.map(b => b.label),
      data: data.series.map(b => b.count),
      color: '#ef4444',
      smooth: true,
      fill: true,
    })
  } catch (e) { console.warn('[crash-rate] area chart failed', e) }

  try {
    countUp(body.querySelector('#hero-rate'), data.crashFreeRate, { suffix: '%', decimals: 2, duration: 900 })
    countUp(body.querySelector('#stat-total'), data.totalCrashes, { duration: 700 })
    countUp(body.querySelector('#stat-sessions'), data.crashSessions, { duration: 700 })
    if (!data.sessionsUnavailable) {
      countUp(body.querySelector('#stat-total-sessions'), data.sessions, { duration: 700 })
    }
  } catch (e) { console.warn('[crash-rate] countUp failed', e) }

  body.querySelector('#csv-locations-btn')?.addEventListener('click', () => {
    try {
      exportCsv('crash-locations.csv', data.topLocations.map(l => ({
        component: l.component,
        count: l.count,
        last_seen: l.last,
      })))
      toast('CSV exportiert', 'success')
    } catch (e) {
      toast('CSV-Export fehlgeschlagen: ' + (e?.message || e), 'error')
    }
  })

  const openDrill = (component) => {
    const matches = data.raw.filter(c => (c.component || 'Unbekannt') === component)
    const last10 = matches.slice(0, 10)
    drawer({
      title: `Crash-Details: ${component}`,
      width: 480,
      content: `
        <div style="display:grid;gap:16px;padding:4px">
          <div class="glass-card" style="padding:16px">
            <div style="font-size:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em">Gesamt-Vorfälle (7T)</div>
            <div style="font-size:32px;font-weight:700;margin-top:4px">${fmtNumber(matches.length)}</div>
          </div>
          <div>
            <h4 style="margin:0 0 8px 0;font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted)">Letzte Vorkommen</h4>
            <div style="display:grid;gap:6px">
              ${last10.map(c => `
                <div class="glass-card" style="padding:10px 12px;display:flex;justify-content:space-between;align-items:center;font-size:13px">
                  <span>${htmlEscape(fmtDateTime(c.created_at))}</span>
                  <span style="font-family:monospace;font-size:11px;color:var(--text-muted)">${htmlEscape(String(c.id).slice(0, 8))}</span>
                </div>
              `).join('')}
            </div>
          </div>
          <a class="btn btn-primary" href="${SENTRY_URL}?query=${encodeURIComponent(component)}" target="_blank" rel="noopener" style="justify-self:start">
            ${iconHtml('external-link')} In Sentry untersuchen
          </a>
        </div>
      `
    })
  }

  body.querySelectorAll('.details-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      openDrill(btn.dataset.component)
    })
  })
  body.querySelectorAll('.row-clickable').forEach(row => {
    row.addEventListener('click', () => openDrill(row.dataset.component))
  })
}

function renderMountError(container, err) {
  container.innerHTML = `
    <div class="panel-shell">
      <div class="glass-card error-state" style="text-align:center;padding:48px 24px;margin:20px">
        <div style="font-size:48px;margin-bottom:12px;color:#ef4444">!</div>
        <h3 style="margin:0 0 8px 0">Panel konnte nicht initialisiert werden</h3>
        <p style="color:var(--text-muted);margin:0 0 16px 0;font-family:monospace;font-size:12px">${htmlEscape(err?.message || String(err))}</p>
        <button class="btn btn-primary" id="mount-retry">Erneut versuchen</button>
      </div>
    </div>
  `
  container.querySelector('#mount-retry')?.addEventListener('click', () => {
    exported.mount(container).catch(e => renderMountError(container, e))
  })
}

const exported = {
  id: 'crash-rate',
  title: 'Stabilität / Crash-Rate',
  category: 'overview',
  async mount(container) {
    try {
      container.innerHTML = `
        <div class="panel-shell">
          <div class="panel-head" style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:20px">
            <div>
              <h2 style="margin:0">Stabilität / Crash-Rate</h2>
              <div style="font-size:13px;color:var(--text-muted);margin-top:4px">App-Stabilität und Crash-Tracking der letzten 7 Tage</div>
            </div>
            <div class="toolbar" style="display:flex;gap:8px;flex-wrap:wrap">
              <button class="btn btn-ghost" id="refresh-btn" title="Aktualisieren">${iconHtml('refresh-cw')} Aktualisieren</button>
              <button class="btn btn-ghost" id="pdf-btn" title="Als PDF exportieren">${iconHtml('file-text')} PDF</button>
              <button class="btn btn-ghost" id="csv-btn" title="Rohdaten als CSV">${iconHtml('download')} CSV</button>
              <a class="btn btn-primary" href="${SENTRY_URL}" target="_blank" rel="noopener" title="In Sentry öffnen">
                ${iconHtml('external-link')} Sentry
              </a>
            </div>
          </div>
          <div class="panel-body" id="body"></div>
        </div>
      `

      const body = container.querySelector('#body')

      try { skeletonLoader(body, { rows: 4, layout: 'mixed' }) } catch (e) {
        body.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-muted)">Lade…</div>'
      }
      try { fadeIn(container) } catch (e) {}

      let currentData = null

      const load = async () => {
        try { skeletonLoader(body, { rows: 4, layout: 'mixed' }) } catch (e) {}
        try {
          const data = await fetchData()
          currentData = data
          if (data.totalCrashes === 0 && data.sessions === 0) {
            renderEmpty(body)
          } else {
            renderContent(body, data)
          }
        } catch (err) {
          console.error('[crash-rate] load failed', err)
          renderError(body, err, load)
          try { toast('Fehler beim Laden der Crash-Daten', 'error') } catch (e) {}
        }
      }

      container.querySelector('#refresh-btn')?.addEventListener('click', () => {
        load().then(() => { try { toast('Aktualisiert', 'info') } catch (e) {} })
      })
      container.querySelector('#pdf-btn')?.addEventListener('click', () => {
        try {
          exportPanelAsPdf(container, { title: 'Stabilität / Crash-Rate', filename: 'crash-rate.pdf' })
        } catch (e) {
          toast('PDF-Export fehlgeschlagen: ' + (e?.message || e), 'error')
        }
      })
      container.querySelector('#csv-btn')?.addEventListener('click', () => {
        if (!currentData) return toast('Noch keine Daten geladen', 'warning')
        try {
          exportCsv('crashes-7d.csv', currentData.raw.map(c => ({
            id: c.id,
            component: c.component,
            session_id: c.session_id,
            created_at: c.created_at,
          })))
          toast('Crash-Daten als CSV exportiert', 'success')
        } catch (e) {
          toast('CSV-Export fehlgeschlagen: ' + (e?.message || e), 'error')
        }
      })

      load()
    } catch (err) {
      console.error('[crash-rate] mount failed', err)
      renderMountError(container, err)
    }
  }
}

export default exported
