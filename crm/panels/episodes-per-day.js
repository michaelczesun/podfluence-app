import { sb } from '/lib/supabase.js'
import { toast, htmlEscape, iconHtml, fmtDateTime } from '/lib/ui.js'
import { makeBarChart } from '/lib/charts.js'
import { exportPanelAsPdf, exportCsv } from '/lib/export.js'
import { countUp, fadeIn, skeletonLoader } from '/lib/animations.js'
import { drawer } from '/lib/layout-extras.js'

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
    buckets.set(isoDay(d), { day: isoDay(d), count: 0, episodes: [] })
  }

  // admin_daily_series returns [{date, value}]
  const { data: series, error: seriesErr } = await sb.rpc('admin_daily_series', { p_metric: 'episodes', p_days: DAYS })
  if (seriesErr) throw seriesErr
  for (const row of (series || [])) {
    const k = row.date ? isoDay(row.date) : null
    if (k && buckets.has(k)) {
      buckets.get(k).count = row.value ?? 0
    }
  }

  // Optionally enrich with actual episode rows for the drawer (best-effort)
  try {
    const sinceIso = since.toISOString()
    const { data: eps } = await sb
      .from('podcasts')
      .select('id, title, cover_url')
      .limit(1)
    // Only fetch episode details if podcasts table accessible
    if (eps !== null) {
      const { data: epRows } = await sb
        .from('episodes')
        .select('id, title, published_at, audio_url, podcast_id, podcasts:podcast_id(title, cover_url)')
        .gte('published_at', sinceIso)
        .order('published_at', { ascending: true })
        .limit(500)
      for (const ep of (epRows || [])) {
        const k = ep.published_at ? isoDay(ep.published_at) : null
        if (k && buckets.has(k)) {
          buckets.get(k).episodes.push(ep)
        }
      }
    }
  } catch (_) {}

  return Array.from(buckets.values())
}

function dayDrawer(bucket) {
  const eps = bucket.episodes
  const body = eps.length === 0
    ? `<div class="empty-state"><div class="empty-icon">${iconHtml('mic-off')}</div><h3>Keine Episoden</h3><p>An diesem Tag wurde keine Episode veröffentlicht.</p></div>`
    : `<div class="episode-list">${eps.map(ep => `
        <div class="episode-row glass-card" data-id="${htmlEscape(ep.id)}">
          <div class="ep-cover">${ep.podcasts?.cover_url ? `<img src="${htmlEscape(ep.podcasts.cover_url)}" alt="">` : iconHtml('mic')}</div>
          <div class="ep-meta">
            <div class="ep-title">${htmlEscape(ep.title || 'Ohne Titel')}</div>
            <div class="ep-sub">${htmlEscape(ep.podcasts?.title || 'Unbekannter Podcast')} · ${fmtDateTime(ep.published_at)}</div>
            ${ep.audio_url ? `<audio class="ep-audio" controls preload="none" src="${htmlEscape(ep.audio_url)}"></audio>` : `<div class="ep-noaudio">${iconHtml('alert-circle')} Kein Audio verfügbar</div>`}
          </div>
        </div>`).join('')}</div>`

  drawer({
    title: `Episoden am ${fmtDay(bucket.day)}`,
    subtitle: `${eps.length} ${eps.length === 1 ? 'Episode' : 'Episoden'}`,
    html: body,
    width: 560
  })
}

export default {
  id: 'episodes-per-day',
  title: 'Neue Episoden pro Tag',
  category: 'content',

  async mount(container) {
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
          <div class="panel-body" id="body">${skeletonLoader({ rows: 4, height: 80 })}</div>
        </div>`

      const body = container.querySelector('#body')
      fadeIn(container)

      const render = async () => {
        body.innerHTML = skeletonLoader({ rows: 4, height: 80 })
        let series
        try {
          series = await fetchSeries()
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
              labels: series.map(b => fmtDay(b.day)),
              values: series.map(b => b.count),
              color: '#7c5cff',
              onBarClick: (i) => dayDrawer(series[i])
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
      container.querySelector('[data-act="csv"]').addEventListener('click', async () => {
        try {
          const s = await fetchSeries()
          exportCsv(s.map(b => ({ Tag: b.day, Episoden: b.count })), 'episoden-pro-tag.csv')
        } catch (e) { toast('CSV-Export fehlgeschlagen: ' + (e.message || ''), 'error') }
      })

      await render()
    } catch (mountErr) {
      container.innerHTML = `
        <div class="panel-shell">
          <div class="error-state glass-card" style="margin:24px">
            <div class="error-icon">${iconHtml ? iconHtml('alert-triangle') : '!'}</div>
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
