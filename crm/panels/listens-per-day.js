import { sb } from '/lib/supabase.js?v=20260608n'
import { toast, fmtNumber, htmlEscape, iconHtml, spinnerHtml } from '/lib/ui.js?v=20260608n'
import { makeLineChart, makeHeatmap } from '/lib/charts.js?v=20260608n'
import { exportPanelAsPdf, exportCsv } from '/lib/export.js?v=20260608n'
import { countUp, fadeIn, skeletonLoader } from '/lib/animations.js?v=20260608n'
import { drawer, segmentedControl, statHero } from '/lib/layout-extras.js?v=20260608n'

const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']

// Daily aggregated series via admin RPC (SECURITY DEFINER).
async function fetchDaily(days = 30) {
  const { data, error } = await sb.rpc('admin_daily_series', {
    p_metric: 'listens',
    p_days: days,
  })
  if (error) throw error
  return data || []
}

function normaliseDaily(rows) {
  return rows
    .map(r => ({
      date: (r.date || r.day || '').slice(0, 10),
      plays: Number(r.plays ?? r.count ?? 0),
      seconds: (Number(r.total_minutes ?? r.minutes ?? 0)) * 60,
    }))
    .filter(r => r.date)
    .sort((a, b) => a.date.localeCompare(b.date))
}

// FIX high: heatmap needs raw timestamps. admin_daily_series gives only daily
// aggregates → grid stayed 0. Fetch listening_activity directly (created_at,
// podcast_title, episode_title — all confirmed columns).
async function fetchRawActivity(days) {
  const since = new Date(Date.now() - days * 86400_000).toISOString()
  const { data, error } = await sb
    .from('listening_activity')
    .select('created_at, podcast_title, episode_title')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(20000)
  if (error) throw error
  return data || []
}

function aggregateHeatmapGrid(rows) {
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0))
  for (const r of rows) {
    if (!r.created_at) continue
    const d = new Date(r.created_at)
    const wd = (d.getDay() + 6) % 7 // Mon=0..Sun=6
    const h = d.getHours()
    grid[wd][h] += 1
  }
  return grid
}

// FIX low: filter raw rows that DO have created_at + titles (confirmed schema).
function topInWindow(rawRows, weekday, hour) {
  const counts = new Map()
  for (const r of rawRows) {
    if (!r.created_at) continue
    const d = new Date(r.created_at)
    const wd = (d.getDay() + 6) % 7
    if (wd !== weekday || d.getHours() !== hour) continue
    const key = `${r.podcast_title || '—'}${r.episode_title || '—'}`
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  return Array.from(counts.entries())
    .map(([key, plays]) => {
      const [podcast, title] = key.split('')
      return { podcast, title, plays }
    })
    .sort((a, b) => b.plays - a.plays)
    .slice(0, 10)
}

export default {
  id: 'listens-per-day',
  title: 'Listens pro Tag',
  category: 'listening',

  async mount(container) {
    try {
      let mode = 'plays'
      let days = 30
      let dailyRows = []
      let rawRows = []

      container.innerHTML = `
        <div class="panel-shell">
          <div class="panel-head">
            <div>
              <h2>Listens pro Tag</h2>
              <p class="panel-sub">Tägliche Hörsessions, Stunden und Tageszeit-Muster.</p>
            </div>
            <div class="toolbar" id="toolbar"></div>
          </div>
          <div class="panel-body" id="body"></div>
        </div>
      `

      const toolbar = container.querySelector('#toolbar')
      toolbar.innerHTML = `
        <button class="btn btn-ghost" data-act="refresh">${iconHtml('refresh')} Aktualisieren</button>
        <button class="btn btn-ghost" data-act="pdf">${iconHtml('file')} PDF</button>
        <button class="btn btn-ghost" data-act="csv">${iconHtml('download')} CSV</button>
        <select class="select-mini" id="rangeSel">
          <option value="7">7 Tage</option>
          <option value="30" selected>30 Tage</option>
          <option value="90">90 Tage</option>
        </select>
      `

      const body = container.querySelector('#body')
      body.innerHTML = skeletonLoader({ rows: 6 })

      async function load() {
        body.innerHTML = skeletonLoader({ rows: 6 })
        try {
          // Daily series is required; raw activity is best-effort (heatmap-only).
          const [daily, raw] = await Promise.allSettled([
            fetchDaily(days),
            fetchRawActivity(days),
          ])
          if (daily.status !== 'fulfilled') throw daily.reason
          dailyRows = daily.value
          rawRows = raw.status === 'fulfilled' ? raw.value : []
          try {
            render()
          } catch (renderErr) {
            body.innerHTML = `
              <div class="error-state glass-card">
                <div class="error-icon">${iconHtml('alert')}</div>
                <h3>Darstellung fehlgeschlagen</h3>
                <p>${htmlEscape(renderErr.message || String(renderErr))}</p>
                <button class="btn btn-primary" data-act="retry">Erneut versuchen</button>
              </div>`
            body.querySelector('[data-act="retry"]')?.addEventListener('click', load)
          }
        } catch (err) {
          body.innerHTML = `
            <div class="error-state glass-card">
              <div class="error-icon">${iconHtml('alert')}</div>
              <h3>Daten konnten nicht geladen werden</h3>
              <p>${htmlEscape(err.message || String(err))}</p>
              <button class="btn btn-primary" data-act="retry">Erneut versuchen</button>
            </div>`
          body.querySelector('[data-act="retry"]')?.addEventListener('click', load)
        }
      }

      function render() {
        const daily = normaliseDaily(dailyRows)

        if (daily.length === 0) {
          body.innerHTML = `
            <div class="empty-state glass-card">
              <div class="empty-icon">${iconHtml('headphones')}</div>
              <h3>Noch keine Hörsessions</h3>
              <p>Sobald Nutzer Episoden anhören, erscheinen die Tageskurven hier.</p>
            </div>`
          fadeIn(body)
          return
        }

        const totalPlays = daily.reduce((s, d) => s + d.plays, 0)
        const totalHours = daily.reduce((s, d) => s + d.seconds, 0) / 3600
        const avgPerDay = totalPlays / daily.length
        const peakDay = daily.reduce((a, b) => (b.plays > a.plays ? b : a), daily[0])

        body.innerHTML = `
          <div class="hero-row" id="heroRow"></div>

          <section class="glass-card panel-section">
            <div class="section-head">
              <div>
                <h3>Verlauf</h3>
                <p class="muted">Tägliche Entwicklung über ${days} Tage</p>
              </div>
              <div id="modeToggle"></div>
            </div>
            <div id="lineChart" class="chart-host" style="height:300px"></div>
          </section>

          <section class="glass-card panel-section">
            <div class="section-head">
              <div>
                <h3>Tageszeit-Heatmap</h3>
                <p class="muted">Plays nach Wochentag × Stunde — klick eine Zelle für Top-Podcasts</p>
              </div>
            </div>
            <div id="heatmapWrap" style="min-height:320px"></div>
          </section>
        `

        const heroRow = body.querySelector('#heroRow')
        heroRow.appendChild(statHero({
          label: 'Plays gesamt',
          value: totalPlays,
          accent: 'violet',
          icon: 'play'
        }))
        heroRow.appendChild(statHero({
          label: 'Stunden gesamt',
          value: Math.round(totalHours),
          accent: 'cyan',
          icon: 'clock'
        }))
        heroRow.appendChild(statHero({
          label: 'Ø pro Tag',
          value: Math.round(avgPerDay),
          accent: 'amber',
          icon: 'trending-up'
        }))
        heroRow.appendChild(statHero({
          label: 'Spitzentag',
          value: peakDay.date.slice(5),
          sub: `${fmtNumber(peakDay.plays)} Plays`,
          accent: 'rose',
          icon: 'star'
        }))

        const toggleHost = body.querySelector('#modeToggle')
        segmentedControl(toggleHost, [
          { key: 'plays', label: 'Plays' },
          { key: 'hours', label: 'Stunden' }
        ], mode, v => { mode = v; drawLine() })

        function drawLine() {
          const chartHost = body.querySelector('#lineChart')
          if (!chartHost) return
          chartHost.innerHTML = ''
          // FIX high: use canonical {categories, series:[{name,data}], colors, height}
          // shape per /lib/charts.js?v=20260608n signature.
          const categories = daily.map(d => d.date)
          const data = daily.map(d => mode === 'plays'
            ? d.plays
            : Math.round((d.seconds / 3600) * 10) / 10)
          const seriesName = mode === 'plays' ? 'Plays' : 'Stunden'
          const color = mode === 'plays' ? '#8b5cf6' : '#06b6d4'
          makeLineChart(chartHost, {
            categories,
            series: [{ name: seriesName, data }],
            colors: [color],
            height: 300
          })
        }
        drawLine()

        // FIX high: heatmap now uses raw listening_activity rows (with created_at)
        // and the ApexCharts series shape that /lib/charts.js?v=20260608n expects:
        //   series: [{ name: 'Mo', data: [{x: '00h', y: 12}, ...] }, ...]
        const heatHost = body.querySelector('#heatmapWrap')
        const grid = aggregateHeatmapGrid(rawRows)
        const totalHeat = grid.flat().reduce((s, n) => s + n, 0)

        if (totalHeat === 0) {
          heatHost.innerHTML = `
            <div class="empty-state" style="padding:24px;text-align:center;color:var(--text)">
              <div class="empty-icon">${iconHtml('clock')}</div>
              <h4 style="color:var(--text)">Keine Tageszeit-Daten</h4>
              <p class="muted">Im gewählten Zeitraum (${days} Tage) liegen noch keine zeitgestempelten Hörsessions vor.</p>
            </div>`
        } else {
          const xLabels = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}h`)
          // Reverse so Mo is at top in ApexCharts (rendered bottom-up).
          const series = WEEKDAYS.map((wdLabel, wdIdx) => ({
            name: wdLabel,
            data: xLabels.map((xl, h) => ({ x: xl, y: grid[wdIdx][h] }))
          })).reverse()

          makeHeatmap(heatHost, {
            series,
            height: 320,
            colors: ['#8B5CF6']
          })

          // Delegate click on heatmap cells to open drill-down drawer.
          heatHost.addEventListener('click', ev => {
            const rectEl = ev.target.closest('[seriesname], rect')
            if (!rectEl) return
            // Heuristic: read aria-label / data attrs Apex sets, else use bounding box.
            // Simpler reliable path: use the cell's parent <g> series-index + x-index
            // via Apex's data-* attributes. Fallback: nothing — drawer not opened.
            const g = rectEl.closest('g.apexcharts-series')
            if (!g) return
            const allSeries = heatHost.querySelectorAll('g.apexcharts-series')
            // series order matches the reversed array → recover real weekday idx
            let displayIdx = -1
            allSeries.forEach((el, i) => { if (el === g) displayIdx = i })
            if (displayIdx < 0) return
            const weekday = (WEEKDAYS.length - 1) - displayIdx // un-reverse
            // hour: find rect index inside the series group
            const rects = g.querySelectorAll('rect')
            let hour = -1
            rects.forEach((r, i) => { if (r === rectEl) hour = i })
            if (hour < 0 || hour > 23) return
            const value = grid[weekday]?.[hour] || 0
            openHourDrawer(weekday, hour, value)
          })
        }

        fadeIn(body)
      }

      async function openHourDrawer(weekday, hour, plays) {
        const d = drawer({
          title: `${WEEKDAYS[weekday]} · ${String(hour).padStart(2, '0')}:00–${String(hour + 1).padStart(2, '0')}:00`,
          subtitle: `${fmtNumber(plays || 0)} Plays in diesem Zeitfenster`,
          contentHtml: `<div id="hourLoading">${spinnerHtml ? spinnerHtml() : ''} Top-Episoden werden geladen…</div>`
        })
        try {
          const eps = topInWindow(rawRows, weekday, hour)
          const html = eps.length === 0
            ? `<div class="empty-state" style="color:var(--text)"><div class="empty-icon">${iconHtml('headphones')}</div><h4 style="color:var(--text)">Keine Episoden in dieser Stunde</h4><p class="muted">Im gewählten Zeitraum wurde hier nichts gehört.</p></div>`
            : `
              <table class="data-table data-table-hover">
                <thead><tr><th>#</th><th>Episode</th><th>Podcast</th><th style="text-align:right">Plays</th></tr></thead>
                <tbody>
                  ${eps.map((e, i) => `
                    <tr>
                      <td class="muted">${i + 1}</td>
                      <td>${htmlEscape(e.title)}</td>
                      <td class="muted">${htmlEscape(e.podcast)}</td>
                      <td style="text-align:right"><strong>${fmtNumber(e.plays)}</strong></td>
                    </tr>`).join('')}
                </tbody>
              </table>`
          if (typeof d.setContent === 'function') {
            d.setContent(html)
          } else if (d.contentEl) {
            d.contentEl.innerHTML = html
          } else if (d.root) {
            const c = d.root.querySelector('.drawer-content, .drawer-body, [data-drawer-content]')
            if (c) c.innerHTML = html
          }
        } catch (err) {
          toast(`Fehler beim Laden: ${err.message || err}`, 'error')
        }
      }

      toolbar.querySelector('[data-act="refresh"]').addEventListener('click', () => {
        toast('Daten werden aktualisiert…', 'info')
        load()
      })
      toolbar.querySelector('[data-act="pdf"]').addEventListener('click', () => {
        try {
          exportPanelAsPdf(container, `listens-pro-tag-${days}d.pdf`, { panelTitle: 'Listens pro Tag' })
        } catch (err) {
          toast(`PDF-Export fehlgeschlagen: ${err.message || err}`, 'error')
        }
      })
      toolbar.querySelector('[data-act="csv"]').addEventListener('click', () => {
        try {
          const daily = normaliseDaily(dailyRows)
          if (daily.length === 0) {
            toast('Keine Daten zum Exportieren.', 'info')
            return
          }
          exportCsv(daily.map(d => ({
            Datum: d.date,
            Plays: d.plays,
            Stunden: Math.round((d.seconds / 3600) * 100) / 100
          })), null, `listens-pro-tag-${days}d.csv`)
        } catch (err) {
          toast(`CSV-Export fehlgeschlagen: ${err.message || err}`, 'error')
        }
      })
      toolbar.querySelector('#rangeSel').addEventListener('change', e => {
        days = parseInt(e.target.value, 10) || 30
        load()
      })

      await load()
    } catch (err) {
      container.innerHTML = `
        <div class="error-state glass-card" style="margin:24px;padding:24px;border:1px solid rgba(244,63,94,.3);border-radius:12px;color:var(--text);background:var(--bg-glass)">
          <h3>Panel konnte nicht initialisiert werden</h3>
          <p style="opacity:.8">${htmlEscape(err && (err.message || String(err)) || 'Unbekannter Fehler')}</p>
          <pre style="opacity:.6;font-size:11px;white-space:pre-wrap">${htmlEscape((err && err.stack) || '')}</pre>
        </div>`
    }
  }
}
