import { sb } from '/lib/supabase.js'
import { toast, fmtNumber, htmlEscape, iconHtml, spinnerHtml } from '/lib/ui.js'
import { makeLineChart, makeHeatmap } from '/lib/charts.js'
import { exportPanelAsPdf, exportCsv } from '/lib/export.js'
import { countUp, fadeIn, skeletonLoader } from '/lib/animations.js'
import { drawer, segmentedControl, statHero } from '/lib/layout-extras.js'

const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']

async function fetchDaily(days = 30) {
  const since = new Date(Date.now() - days * 86400000).toISOString()
  const { data, error } = await sb
    .from('listening_sessions')
    .select('started_at, duration_seconds, episode_id')
    .gte('started_at', since)
    .order('started_at', { ascending: true })
  if (error) throw error
  return data || []
}

function aggregateDaily(rows) {
  const byDay = new Map()
  for (const r of rows) {
    const d = new Date(r.started_at)
    const key = d.toISOString().slice(0, 10)
    if (!byDay.has(key)) byDay.set(key, { date: key, plays: 0, seconds: 0 })
    const o = byDay.get(key)
    o.plays += 1
    o.seconds += r.duration_seconds || 0
  }
  return Array.from(byDay.values()).sort((a, b) => a.date.localeCompare(b.date))
}

function aggregateHeatmap(rows) {
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0))
  for (const r of rows) {
    const d = new Date(r.started_at)
    const wd = (d.getDay() + 6) % 7
    const h = d.getHours()
    grid[wd][h] += 1
  }
  return grid
}

async function fetchTopEpisodesForHour(weekday, hour, days = 30) {
  const since = new Date(Date.now() - days * 86400000).toISOString()
  const { data, error } = await sb
    .from('listening_sessions')
    .select('episode_id, started_at, episodes(title, podcast_title)')
    .gte('started_at', since)
  if (error) throw error
  const filtered = (data || []).filter(r => {
    const d = new Date(r.started_at)
    const wd = (d.getDay() + 6) % 7
    return wd === weekday && d.getHours() === hour
  })
  const counts = new Map()
  for (const r of filtered) {
    const id = r.episode_id
    if (!id) continue
    if (!counts.has(id)) counts.set(id, { id, title: r.episodes?.title || 'Unbekannte Episode', podcast: r.episodes?.podcast_title || '—', plays: 0 })
    counts.get(id).plays += 1
  }
  return Array.from(counts.values()).sort((a, b) => b.plays - a.plays).slice(0, 10)
}

export default {
  id: 'listens-per-day',
  title: 'Listens pro Tag',
  category: 'listening',

  async mount(container) {
    try {
      let mode = 'plays'
      let days = 30
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
      body.innerHTML = skeletonLoader({ rows: 6, height: 56 })

      async function load() {
        body.innerHTML = skeletonLoader({ rows: 6, height: 56 })
        try {
          rawRows = await fetchDaily(days)
          render()
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
        const daily = aggregateDaily(rawRows)

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
                <p class="muted">Plays nach Wochentag × Stunde — klick eine Zelle für Top-Episoden</p>
              </div>
            </div>
            <div id="heatmapWrap"></div>
          </section>
        `

        const heroRow = body.querySelector('#heroRow')
        heroRow.appendChild(statHero({
          label: 'Plays gesamt',
          value: '0',
          accent: 'violet',
          icon: 'play'
        }))
        heroRow.appendChild(statHero({
          label: 'Stunden gesamt',
          value: '0',
          accent: 'cyan',
          icon: 'clock'
        }))
        heroRow.appendChild(statHero({
          label: 'Ø pro Tag',
          value: '0',
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

        const heroValues = heroRow.querySelectorAll('.stat-hero-value')
        if (heroValues[0]) countUp(heroValues[0], totalPlays, { duration: 900 })
        if (heroValues[1]) countUp(heroValues[1], Math.round(totalHours), { duration: 900 })
        if (heroValues[2]) countUp(heroValues[2], Math.round(avgPerDay), { duration: 900 })

        const toggleHost = body.querySelector('#modeToggle')
        toggleHost.appendChild(segmentedControl({
          options: [
            { value: 'plays', label: 'Plays' },
            { value: 'hours', label: 'Stunden' }
          ],
          value: mode,
          onChange: v => { mode = v; drawLine() }
        }))

        function drawLine() {
          const chartHost = body.querySelector('#lineChart')
          if (!chartHost) return
          chartHost.innerHTML = ''
          const series = daily.map(d => ({
            x: d.date,
            y: mode === 'plays' ? d.plays : Math.round((d.seconds / 3600) * 10) / 10
          }))
          makeLineChart(chartHost, {
            data: series,
            xLabel: 'Datum',
            yLabel: mode === 'plays' ? 'Plays' : 'Stunden',
            color: mode === 'plays' ? '#8b5cf6' : '#06b6d4',
            smooth: true,
            area: true
          })
        }
        drawLine()

        const heatHost = body.querySelector('#heatmapWrap')
        const grid = aggregateHeatmap(rawRows)
        const heatPoints = []
        for (let wd = 0; wd < 7; wd++) {
          for (let h = 0; h < 24; h++) {
            heatPoints.push({ x: h, y: wd, value: grid[wd][h] })
          }
        }
        makeHeatmap(heatHost, {
          data: heatPoints,
          xLabels: Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}h`),
          yLabels: WEEKDAYS,
          colorScale: ['#1a1a2e', '#3b1d6b', '#7c3aed', '#a78bfa', '#f0abfc'],
          onCellClick: async ({ x, y, value }) => openHourDrawer(y, x, value)
        })

        fadeIn(body)
      }

      async function openHourDrawer(weekday, hour, plays) {
        const d = drawer({
          title: `${WEEKDAYS[weekday]} · ${String(hour).padStart(2, '0')}:00–${String(hour + 1).padStart(2, '0')}:00`,
          subtitle: `${fmtNumber(plays || 0)} Plays in diesem Zeitfenster`,
          content: `<div id="hourLoading">${spinnerHtml()} Top-Episoden werden geladen…</div>`
        })
        try {
          const eps = await fetchTopEpisodesForHour(weekday, hour, days)
          const root = d.contentEl || d.body || d.el || d
          const loading = root.querySelector ? root.querySelector('#hourLoading') : null
          const html = eps.length === 0
            ? `<div class="empty-state"><div class="empty-icon">${iconHtml('headphones')}</div><h4>Keine Episoden in dieser Stunde</h4><p class="muted">Im gewählten Zeitraum wurde hier nichts gehört.</p></div>`
            : `
              <table class="data-table data-table-hover">
                <thead><tr><th>#</th><th>Episode</th><th>Podcast</th><th style="text-align:right">Plays</th></tr></thead>
                <tbody>
                  ${eps.map((e, i) => `
                    <tr data-ep="${htmlEscape(String(e.id))}">
                      <td class="muted">${i + 1}</td>
                      <td>${htmlEscape(e.title)}</td>
                      <td class="muted">${htmlEscape(e.podcast)}</td>
                      <td style="text-align:right"><strong>${fmtNumber(e.plays)}</strong></td>
                    </tr>`).join('')}
                </tbody>
              </table>`
          if (loading) loading.outerHTML = html
          else if (root.querySelector) {
            const target = root.querySelector('.drawer-content') || root
            target.innerHTML = html
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
          exportPanelAsPdf(container, { title: 'Listens pro Tag', filename: `listens-pro-tag-${days}d.pdf` })
        } catch (err) {
          toast(`PDF-Export fehlgeschlagen: ${err.message || err}`, 'error')
        }
      })
      toolbar.querySelector('[data-act="csv"]').addEventListener('click', () => {
        try {
          const daily = aggregateDaily(rawRows)
          if (daily.length === 0) {
            toast('Keine Daten zum Exportieren.', 'info')
            return
          }
          exportCsv(daily.map(d => ({
            Datum: d.date,
            Plays: d.plays,
            Stunden: Math.round((d.seconds / 3600) * 100) / 100
          })), `listens-pro-tag-${days}d.csv`)
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
        <div class="error-state glass-card" style="margin:24px;padding:24px;border:1px solid rgba(244,63,94,.3);border-radius:12px">
          <h3>Panel konnte nicht initialisiert werden</h3>
          <p style="opacity:.8">${htmlEscape(err && (err.message || String(err)) || 'Unbekannter Fehler')}</p>
          <pre style="opacity:.6;font-size:11px;white-space:pre-wrap">${htmlEscape((err && err.stack) || '')}</pre>
        </div>`
    }
  }
}
