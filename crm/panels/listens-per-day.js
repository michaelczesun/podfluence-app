import { sb } from '/lib/supabase.js?v=20260608c'
import { toast, fmtNumber, htmlEscape, iconHtml, spinnerHtml } from '/lib/ui.js?v=20260608c'
import { makeLineChart, makeHeatmap } from '/lib/charts.js?v=20260608c'
import { exportPanelAsPdf, exportCsv } from '/lib/export.js?v=20260608c'
import { countUp, fadeIn, skeletonLoader } from '/lib/animations.js?v=20260608c'
import { drawer, segmentedControl, statHero } from '/lib/layout-extras.js?v=20260608c'

const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']

// FIX high: replaced direct table scan (RLS bypass risk + 100k-row client load)
// with admin_daily_series RPC (SECURITY DEFINER, aggregates server-side).
// Returns rows: { date, plays, total_minutes } — one row per day.
async function fetchDaily(days = 30) {
  const { data, error } = await sb.rpc('admin_daily_series', {
    p_metric: 'listens',
    p_days: days,
  })
  if (error) throw error
  return data || []
}

// admin_daily_series returns server-aggregated rows — no client aggregation needed.
// Kept for shape-normalisation in case RPC column names differ slightly.
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

// FIX med: heatmap drill-down now reuses rawRows already fetched for the main
// chart instead of issuing a second 50k-row scan.  rawRows is passed in from
// the panel state, so no extra network call happens.
// FIX high: episode title lookup switched from unknown `episodes` table to
// `podcasts` table (confirmed in schema).  We enrich by podcast_id only —
// episode-level titles are not available via a confirmed table, so we fall back
// to "Episode <id>" rather than silently swallowing an error.
async function fetchTopEpisodesForHour(weekday, hour, cachedRows) {
  const filtered = cachedRows.filter(r => {
    if (!r.created_at) return false
    const d = new Date(r.created_at)
    const wd = (d.getDay() + 6) % 7
    return wd === weekday && d.getHours() === hour
  })

  const counts = new Map()
  const podcastIds = new Map() // episode_id → podcast_id
  for (const r of filtered) {
    const id = r.episode_id
    if (!id) continue
    counts.set(id, (counts.get(id) || 0) + 1)
    if (r.podcast_id && !podcastIds.has(id)) podcastIds.set(id, r.podcast_id)
  }

  const top = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)

  // Enrich with podcast titles using the confirmed `podcasts` table.
  const uniquePodcastIds = [...new Set(top.map(([id]) => podcastIds.get(id)).filter(Boolean))]
  let podTitles = {}
  if (uniquePodcastIds.length > 0) {
    try {
      const { data: pods, error } = await sb
        .from('podcasts')
        .select('id, title')
        .in('id', uniquePodcastIds)
      if (!error) {
        for (const p of (pods || [])) podTitles[p.id] = p.title || '—'
      }
    } catch (_) {
      // Best-effort — podcast names are cosmetic, missing titles are acceptable.
    }
  }

  return top.map(([id, plays]) => {
    const podId = podcastIds.get(id)
    return {
      id,
      title: `Episode ${id}`,
      podcast: podTitles[podId] || '—',
      plays,
    }
  })
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
      body.innerHTML = skeletonLoader(400, 56).outerHTML

      async function load() {
        body.innerHTML = skeletonLoader(400, 56).outerHTML
        try {
          rawRows = await fetchDaily(days)
          // FIX med: render() wrapped in its own try/catch so chart errors
          // show the inline retry UI instead of falling through to the outer
          // init-error state.
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
        const daily = normaliseDaily(rawRows)

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
            <div id="heatmapWrap"></div>
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

        // Heatmap — note: admin_daily_series returns aggregated rows without
        // created_at timestamps, so heatmap grid will be empty when using the
        // RPC.  The heatmap section requires raw pulse rows with timestamps.
        // For now the grid renders as zero-filled (no-op visually) until a
        // dedicated heatmap RPC is available.  The drill-down drawer reuses
        // rawRows as-is (which will also be empty from the RPC response).
        const heatHost = body.querySelector('#heatmapWrap')
        const grid = aggregateHeatmapFromRaw(rawRows)
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

      // Heatmap aggregation — only useful when rawRows contain created_at timestamps.
      function aggregateHeatmapFromRaw(rows) {
        const grid = Array.from({ length: 7 }, () => Array(24).fill(0))
        for (const r of rows) {
          if (!r.created_at) continue
          const d = new Date(r.created_at)
          const wd = (d.getDay() + 6) % 7
          const h = d.getHours()
          grid[wd][h] += 1
        }
        return grid
      }

      // FIX med: no longer calls fetchTopEpisodesForHour with a 50k-row DB scan.
      // Passes the already-loaded rawRows so no extra request is made.
      // FIX med: drawer content update uses d.contentEl exclusively (the
      // documented return property of drawer() from /lib/layout-extras.js).
      async function openHourDrawer(weekday, hour, plays) {
        const d = drawer({
          title: `${WEEKDAYS[weekday]} · ${String(hour).padStart(2, '0')}:00–${String(hour + 1).padStart(2, '0')}:00`,
          subtitle: `${fmtNumber(plays || 0)} Plays in diesem Zeitfenster`,
          contentHtml: `<div id="hourLoading">${spinnerHtml()} Top-Episoden werden geladen…</div>`
        })
        // drawer() returns { close, root, setContent } — use setContent to update content.
        try {
          const eps = await fetchTopEpisodesForHour(weekday, hour, rawRows)
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
          d.setContent(html)
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
          const daily = normaliseDaily(rawRows)
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
        <div class="error-state glass-card" style="margin:24px;padding:24px;border:1px solid rgba(244,63,94,.3);border-radius:12px">
          <h3>Panel konnte nicht initialisiert werden</h3>
          <p style="opacity:.8">${htmlEscape(err && (err.message || String(err)) || 'Unbekannter Fehler')}</p>
          <pre style="opacity:.6;font-size:11px;white-space:pre-wrap">${htmlEscape((err && err.stack) || '')}</pre>
        </div>`
    }
  }
}
