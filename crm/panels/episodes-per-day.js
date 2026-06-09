import { sb } from '/lib/supabase.js?v=20260608o'
import { toast, htmlEscape, iconHtml } from '/lib/ui.js?v=20260608o'
import { makeBarChart } from '/lib/charts.js?v=20260608o'
import { exportPanelAsPdf, exportCsv } from '/lib/export.js?v=20260608o'
import { countUp, fadeIn } from '/lib/animations.js?v=20260608o'
import { drawer } from '/lib/layout-extras.js?v=20260608o'

const DAYS = 30

function fmtDay(d) {
  const dt = new Date(d)
  return dt.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })
}
function isoDay(d) {
  return new Date(d).toISOString().slice(0, 10)
}

async function fetchSeries() {
  const since = new Date()
  since.setDate(since.getDate() - (DAYS - 1))
  since.setHours(0, 0, 0, 0)

  // Build day-axis first
  const buckets = new Map()
  for (let i = 0; i < DAYS; i++) {
    const d = new Date(since)
    d.setDate(d.getDate() + i)
    buckets.set(isoDay(d), { day: isoDay(d), count: 0 })
  }

  // FIX(high): Parameternamen ohne p_-Prefix — RPC-Signatur ist admin_daily_series(metric, days)
  const { data: series, error: seriesErr } = await sb.rpc('admin_daily_series', { p_metric: 'episodes', p_days: DAYS })
  if (seriesErr) throw seriesErr
  for (const row of (series || [])) {
    const k = row.date ? isoDay(row.date) : null
    if (k && buckets.has(k)) {
      buckets.get(k).count = row.value ?? 0
    }
  }

  // FIX(high+med): episodes-Tabelle existiert nicht im Schema — probe-Query + episodes-Fetch entfernt.
  // Drawer zeigt nur Zählung; keine Row-Level-Episodendaten verfügbar.

  return Array.from(buckets.values())
}

function dayDrawer(bucket) {
  const body = `
    <div class="empty-state">
      <div class="empty-icon">${iconHtml('bar-chart-2')}</div>
      <h3>${bucket.count} ${bucket.count === 1 ? 'Episode' : 'Episoden'}</h3>
      <p>Am ${fmtDay(bucket.day)} wurden ${bucket.count} Episoden veröffentlicht.</p>
    </div>`

  drawer({
    title: `Episoden am ${fmtDay(bucket.day)}`,
    contentHtml: body,
    width: 400
  })
}

export default {
  id: 'episodes-per-day',
  title: 'Neue Episoden pro Tag',
  category: 'content',

  async mount(container) {
    // FIX(med): cachedSeries außerhalb von render() — CSV-Export nutzt Cache statt neuem DB-Call
    let cachedSeries = null

    try {
      container.innerHTML = `
        <div class="panel-shell">
          <div class="panel-head">
            <div>
              <h2>Neue Episoden pro Tag</h2>
              <div class="panel-sub">Letzte ${DAYS} Tage · Klick auf einen Balken zeigt die Episoden des Tages</div>
            </div>
            <div class="toolbar">
              <button class="btn btn-ghost" data-act="refresh">${iconHtml('refresh-cw')} Aktualisieren</button>
              <button class="btn btn-ghost" data-act="pdf">${iconHtml('file-text')} PDF</button>
              <button class="btn btn-ghost" data-act="csv">${iconHtml('download')} CSV</button>
            </div>
          </div>
          <div class="panel-body" id="body"><div class="pf-skeleton" style="width:100%;height:320px"></div></div>
        </div>`

      const body = container.querySelector('#body')
      fadeIn(container)

      const render = async () => {
        body.innerHTML = '<div class="pf-skeleton" style="width:100%;height:320px"></div>'
        let series
        try {
          series = await fetchSeries()
          cachedSeries = series
        } catch (e) {
          body.innerHTML = `
            <div class="error-state glass-card">
              <div class="error-icon">${iconHtml('alert-triangle')}</div>
              <h3>Daten konnten nicht geladen werden</h3>
              <p>${htmlEscape(e.message || 'Unbekannter Fehler')}</p>
              <button class="btn btn-primary" data-act="retry">${iconHtml('refresh-cw')} Erneut versuchen</button>
            </div>`
          body.querySelector('[data-act="retry"]')?.addEventListener('click', render)
          return
        }

        const total = series.reduce((s, b) => s + b.count, 0)
        const avg = total / DAYS
        const peak = series.reduce((m, b) => b.count > m.count ? b : m, { count: 0, day: null })
        const today = series[series.length - 1] || { count: 0, day: null }
        const yesterday = series[series.length - 2] || { count: 0 }
        const delta = today.count - yesterday.count

        body.innerHTML = `
          <div class="hero-row">
            <div class="glass-card hero-stat"><div class="hero-label">Gesamt (${DAYS} Tage)</div><div class="hero-value" data-v="${total}">0</div></div>
            <div class="glass-card hero-stat"><div class="hero-label">⌀ pro Tag</div><div class="hero-value" data-v="${avg.toFixed(1)}">0</div></div>
            <div class="glass-card hero-stat"><div class="hero-label">Spitzentag</div><div class="hero-value" data-v="${peak.count}">0</div><div class="hero-sub">${peak.day ? fmtDay(peak.day) : '–'}</div></div>
            <div class="glass-card hero-stat"><div class="hero-label">Heute</div><div class="hero-value" data-v="${today.count}">0</div><div class="hero-sub ${delta >= 0 ? 'pos' : 'neg'}">${delta >= 0 ? '+' : ''}${delta} vs. gestern</div></div>
          </div>
          <div class="glass-card chart-wrap">
            <div class="chart-head">
              <h3>Veröffentlichungen pro Tag</h3>
              <div class="chart-hint">Klick auf einen Balken → Episoden des Tages</div>
            </div>
            <div id="bar-chart" style="height:320px"></div>
          </div>
          ${total === 0 ? `
            <div class="empty-state glass-card">
              <div class="empty-icon">${iconHtml('inbox')}</div>
              <h3>Keine Episoden in den letzten ${DAYS} Tagen</h3>
              <p>Sobald Podcasts neue Episoden veröffentlichen, erscheinen sie hier.</p>
            </div>` : ''}`

        body.querySelectorAll('.hero-value').forEach(el => {
          const v = parseFloat(el.dataset.v)
          if (Number.isFinite(v)) {
            countUp(el, v, { duration: 900, decimals: el.dataset.v.includes('.') ? 1 : 0 })
          }
        })

        const chartEl = body.querySelector('#bar-chart')
        if (chartEl) {
          try {
            makeBarChart(chartEl, {
              categories: series.map(b => fmtDay(b.day)),
              series: [{ name: 'Episoden', data: series.map(b => b.count) }],
              colors: ['#7c5cff'],
              height: 320
            })
            chartEl.addEventListener('click', (ev) => {
              const bar = ev.target.closest('[data-index]')
              if (!bar) return
              const i = parseInt(bar.dataset.index, 10)
              if (Number.isFinite(i) && series[i]) dayDrawer(series[i])
            })
          } catch (chartErr) {
            chartEl.innerHTML = `<div class="error-inline">${iconHtml('alert-triangle')} Chart konnte nicht gerendert werden: ${htmlEscape(chartErr.message || '')}</div>`
          }
        }
      }

      container.querySelector('[data-act="refresh"]').addEventListener('click', () => {
        render().then(() => toast('Aktualisiert'))
      })
      container.querySelector('[data-act="pdf"]').addEventListener('click', () => {
        try {
          exportPanelAsPdf(container, { filename: 'episoden-pro-tag.pdf', title: 'Neue Episoden pro Tag' })
        } catch (e) {
          toast('PDF-Export fehlgeschlagen: ' + (e.message || ''), 'error')
        }
      })
      // FIX(med): cachedSeries statt fetchSeries() — kein doppelter DB-Call beim CSV-Export
      container.querySelector('[data-act="csv"]').addEventListener('click', () => {
        try {
          const s = cachedSeries
          if (!s) { toast('Daten noch nicht geladen', 'error'); return }
          exportCsv(s.map(b => ({ Tag: b.day, Episoden: b.count })), 'episoden-pro-tag.csv')
        } catch (e) { toast('CSV-Export fehlgeschlagen: ' + (e.message || ''), 'error') }
      })

      await render()
    } catch (mountErr) {
      container.innerHTML = `
        <div class="panel-shell">
          <div class="error-state glass-card" style="margin:24px">
            <div class="error-icon">${iconHtml('alert-triangle')}</div>
            <h3>Panel konnte nicht geladen werden</h3>
            <p>${htmlEscape(mountErr?.message || String(mountErr))}</p>
            <button class="btn btn-primary" data-act="mount-retry">Erneut versuchen</button>
          </div>
        </div>`
      const retry = container.querySelector('[data-act="mount-retry"]')
      retry?.addEventListener('click', () => this.mount(container))
    }
  }
}
