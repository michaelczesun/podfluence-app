import { sb } from '/lib/supabase.js?v=20260608d'
import { toast, fmtNumber, fmtDateTime, htmlEscape, iconHtml, spinnerHtml } from '/lib/ui.js?v=20260608d'
import { makeBarChart, makeDonutChart, makeSparkline } from '/lib/charts.js?v=20260608d'
import { exportPanelAsPdf, exportCsv } from '/lib/export.js?v=20260608d'
import { countUp, fadeIn, skeletonLoader } from '/lib/animations.js?v=20260608d'
import { drawer, statHero } from '/lib/layout-extras.js?v=20260608d'
import { showUserDetailModal } from '/lib/panel-actions.js?v=20260608d'

const DAY_MS = 86400000
// FIX #1: module-scope constant so render() can safely reference it
const DAYS = 7

function dayKey(d) {
  return new Date(d).toISOString().slice(0, 10)
}

function last7Days() {
  const out = []
  const today = new Date()
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today.getTime() - i * DAY_MS)
    out.push(d.toISOString().slice(0, 10))
  }
  return out
}

async function fetchSessions(days = 7) {
  const since = new Date(Date.now() - days * DAY_MS).toISOString()
  // Schema-Truth: listening_activity hat alles inline (kein JOIN nötig).
  // Spalten: listener_id, podcast_id, podcast_title, episode_guid, episode_title, episode_image,
  //          listened_ms, created_at, podcaster_id
  const { data, error } = await sb
    .from('listening_activity')
    .select('listener_id, podcast_id, podcast_title, episode_guid, episode_title, episode_image, listened_ms, created_at, podcaster_id')
    .gte('created_at', since)
    .limit(100000)
  if (error) throw error

  const rows = data || []
  if (rows.length >= 100000) {
    console.warn('[top-listened-podcasts] fetchSessions: 100k-cap erreicht — Daten evtl. truncated.')
    toast('Hinweis: Datenmenge sehr groß – Ergebnisse könnten unvollständig sein.', 'warning')
  }

  // Form an shape angleichen, die aggregatePodcasts erwartet (r.episodes.podcasts).
  return rows.map(r => ({
    user_id: r.listener_id,
    episode_id: r.episode_guid,
    duration_seconds: Math.round(Number(r.listened_ms || 0) / 1000),
    started_at: r.created_at,
    episodes: {
      id: r.episode_guid,
      title: r.episode_title || 'Unbekannte Episode',
      podcast_id: r.podcast_id,
      podcasts: {
        id: r.podcast_id,
        title: r.podcast_title || 'Unbekannter Podcast',
        cover_url: r.episode_image || null,
        host_user_id: r.podcaster_id || null,
      },
    },
  }))
}

function aggregatePodcasts(rows) {
  const days = last7Days()
  const byPodcast = new Map()
  for (const r of rows) {
    const p = r.episodes?.podcasts
    if (!p?.id) continue
    const key = p.id
    if (!byPodcast.has(key)) {
      byPodcast.set(key, {
        id: p.id,
        title: p.title || 'Unbekannter Podcast',
        cover: p.cover_url || null,
        host_user_id: p.host_user_id || null,
        totalMinutes: 0,
        totalPlays: 0,
        spark: Object.fromEntries(days.map(d => [d, 0])),
        episodeIds: new Set()
      })
    }
    const o = byPodcast.get(key)
    const minutes = (r.duration_seconds || 0) / 60
    o.totalMinutes += minutes
    o.totalPlays += 1
    if (r.episode_id) o.episodeIds.add(r.episode_id)
    const k = dayKey(r.started_at)
    if (k in o.spark) o.spark[k] += minutes
  }

  const result = Array.from(byPodcast.values())
    .map(p => ({
      ...p,
      totalMinutes: Math.round(p.totalMinutes),
      sparkSeries: days.map(d => Math.round(p.spark[d])),
      episodeCount: p.episodeIds.size
    }))
    .sort((a, b) => b.totalMinutes - a.totalMinutes)

  // FIX #4: warn if schema mismatch silently dropped all rows
  if (result.length === 0 && rows.length > 0) {
    console.warn('[top-listened-podcasts] aggregatePodcasts: rawRows had', rows.length, 'entries but 0 survived aggregation — possible schema mismatch (episodes FK or podcasts FK missing or returning null).')
  }

  return result
}

export default {
  id: 'top-listened-podcasts',
  title: 'Top gehörte Podcasts',
  category: 'listening',

  async mount(container) {
    try {
      let rawRows = []
      let aggregated = []
      let limit = 25
      let sortKey = 'totalMinutes'

      container.innerHTML = `
        <div class="panel-shell">
          <div class="panel-head">
            <div>
              <h2>Top gehörte Podcasts</h2>
              <p class="panel-sub">Leaderboard der letzten 7 Tage nach Hörminuten.</p>
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
        <select class="select-mini" id="limitSel">
          <option value="10">Top 10</option>
          <option value="25" selected>Top 25</option>
          <option value="50">Top 50</option>
          <option value="100">Top 100</option>
        </select>
      `

      const body = container.querySelector('#body')
      body.appendChild(skeletonLoader('100%', 64))

      async function load() {
        body.innerHTML = ''
        body.appendChild(skeletonLoader('100%', 64))
        try {
          rawRows = await fetchSessions(7)
          aggregated = aggregatePodcasts(rawRows)
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
        if (aggregated.length === 0) {
          body.innerHTML = `
            <div class="empty-state glass-card">
              <div class="empty-icon">${iconHtml('headphones')}</div>
              <h3>Noch keine Hör-Aktivität in den letzten ${DAYS} Tagen</h3>
              <p>Sobald Nutzer Episoden anhören, erscheint das Leaderboard hier.</p>
              <button class="btn btn-primary" data-act="reload">Erneut laden</button>
            </div>`
          body.querySelector('[data-act="reload"]')?.addEventListener('click', load)
          fadeIn(body)
          return
        }

        const top = aggregated.slice(0, limit)
        const totalMinutes = aggregated.reduce((s, p) => s + p.totalMinutes, 0)
        const totalPlays = aggregated.reduce((s, p) => s + p.totalPlays, 0)
        const totalPodcasts = aggregated.length
        const topShare = top[0] ? Math.round((top[0].totalMinutes / Math.max(totalMinutes, 1)) * 100) : 0

        body.innerHTML = `
          <div class="hero-row" id="heroRow"></div>

          <div class="grid-2col" style="display:grid;grid-template-columns:1.4fr 1fr;gap:16px;margin-top:16px">
            <section class="glass-card panel-section">
              <div class="section-head">
                <div>
                  <h3>Top ${Math.min(10, top.length)} nach Hörminuten</h3>
                  <p class="muted">Letzte 7 Tage</p>
                </div>
              </div>
              <div id="barChart" class="chart-host" style="height:320px"></div>
            </section>

            <section class="glass-card panel-section">
              <div class="section-head">
                <div>
                  <h3>Anteil am Hörvolumen</h3>
                  <p class="muted">Top 5 vs. Rest</p>
                </div>
              </div>
              <div id="donutChart" class="chart-host" style="height:320px"></div>
            </section>
          </div>

          <section class="glass-card panel-section" style="margin-top:16px">
            <div class="section-head">
              <div>
                <h3>Leaderboard</h3>
                <p class="muted">Klick auf eine Zeile für Detail-Drawer mit Episoden &amp; Hosts.</p>
              </div>
            </div>
            <div class="table-wrap">
              <table class="data-table data-table-hover" id="leaderboard">
                <thead>
                  <tr>
                    <th style="width:48px">#</th>
                    <th>Podcast</th>
                    <th>Host</th>
                    <th style="width:200px">Hörminuten (7T)</th>
                    <th style="text-align:right;width:130px" data-sort="totalMinutes" class="sortable">Total Min ${sortKey === 'totalMinutes' ? '▾' : ''}</th>
                    <th style="text-align:right;width:110px" data-sort="totalPlays" class="sortable">Plays ${sortKey === 'totalPlays' ? '▾' : ''}</th>
                  </tr>
                </thead>
                <tbody id="leaderboardBody"></tbody>
              </table>
            </div>
          </section>
        `

        const heroRow = body.querySelector('#heroRow')
        heroRow.appendChild(statHero({ label: 'Hörminuten gesamt', value: '0', accent: 'violet', icon: 'clock' }))
        heroRow.appendChild(statHero({ label: 'Plays gesamt', value: '0', accent: 'cyan', icon: 'play' }))
        heroRow.appendChild(statHero({ label: 'Aktive Podcasts', value: '0', accent: 'amber', icon: 'mic' }))
        heroRow.appendChild(statHero({
          label: 'Spitzenreiter',
          value: top[0] ? top[0].title.slice(0, 22) : '—',
          sub: top[0] ? `${topShare}% Anteil` : '',
          accent: 'rose',
          icon: 'star'
        }))
        const heroValues = heroRow.querySelectorAll('.stat-hero-value')
        if (heroValues[0]) countUp(heroValues[0], totalMinutes, { duration: 900 })
        if (heroValues[1]) countUp(heroValues[1], totalPlays, { duration: 900 })
        if (heroValues[2]) countUp(heroValues[2], totalPodcasts, { duration: 900 })

        const barHost = body.querySelector('#barChart')
        const barTop = top.slice(0, 10)
        try {
          makeBarChart(barHost, {
            data: barTop.map(p => ({ x: p.title.length > 18 ? p.title.slice(0, 17) + '…' : p.title, y: p.totalMinutes })),
            xLabel: 'Podcast',
            yLabel: 'Minuten',
            color: '#8b5cf6',
            horizontal: true
          })
        } catch (e) {
          barHost.innerHTML = `<div class="muted" style="padding:24px">Chart konnte nicht gerendert werden: ${htmlEscape(e.message || String(e))}</div>`
        }

        const donutHost = body.querySelector('#donutChart')
        const top5 = aggregated.slice(0, 5)
        const restSum = aggregated.slice(5).reduce((s, p) => s + p.totalMinutes, 0)
        const donutData = top5.map((p, i) => ({
          label: p.title.length > 20 ? p.title.slice(0, 19) + '…' : p.title,
          value: p.totalMinutes,
          color: ['#8b5cf6', '#06b6d4', '#f59e0b', '#ec4899', '#10b981'][i]
        }))
        if (restSum > 0) donutData.push({ label: 'Rest', value: restSum, color: '#374151' })
        try {
          makeDonutChart(donutHost, { data: donutData })
        } catch (e) {
          donutHost.innerHTML = `<div class="muted" style="padding:24px">Chart konnte nicht gerendert werden: ${htmlEscape(e.message || String(e))}</div>`
        }

        renderLeaderboardRows()

        // FIX #5: on sort, only re-render table rows — avoid full render() which re-creates charts
        body.querySelectorAll('th.sortable').forEach(th => {
          th.addEventListener('click', () => {
            sortKey = th.dataset.sort
            aggregated.sort((a, b) => b[sortKey] - a[sortKey])
            // Update sort indicators in headers without full re-render
            body.querySelectorAll('th.sortable').forEach(h => {
              const base = h.dataset.sort === 'totalMinutes' ? 'Total Min' : 'Plays'
              h.textContent = base + (h.dataset.sort === sortKey ? ' ▾' : '')
            })
            renderLeaderboardRows()
          })
        })

        fadeIn(body)
      }

      function renderLeaderboardRows() {
        const tbody = body.querySelector('#leaderboardBody')
        if (!tbody) return
        const rows = aggregated.slice(0, limit)
        tbody.innerHTML = rows.map((p, i) => {
          const rank = i + 1
          const cover = p.cover
            ? `<img src="${htmlEscape(p.cover)}" alt="" class="podcast-cover" style="width:40px;height:40px;border-radius:8px;object-fit:cover;flex-shrink:0" onerror="this.style.display='none'">`
            : `<div class="podcast-cover-fallback" style="width:40px;height:40px;border-radius:8px;background:linear-gradient(135deg,#8b5cf6,#06b6d4);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;flex-shrink:0">${htmlEscape(p.title.charAt(0).toUpperCase())}</div>`
          const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `<span class="muted">${rank}</span>`
          return `
            <tr data-podcast="${htmlEscape(p.id)}" class="leaderboard-row" style="cursor:pointer">
              <td>${medal}</td>
              <td>
                <div style="display:flex;align-items:center;gap:12px">
                  ${cover}
                  <div>
                    <div style="font-weight:600">${htmlEscape(p.title)}</div>
                    <div class="muted" style="font-size:12px">${fmtNumber(p.episodeCount)} Episoden gehört</div>
                  </div>
                </div>
              </td>
              <td>
                ${p.host_user_id
                  ? `<button class="btn-link host-link" data-host="${htmlEscape(p.host_user_id)}">Host öffnen</button>`
                  : '<span class="muted">—</span>'}
              </td>
              <td><div data-spark="${htmlEscape(p.id)}" style="height:36px;width:180px"></div></td>
              <td style="text-align:right;font-variant-numeric:tabular-nums"><strong>${fmtNumber(p.totalMinutes)}</strong></td>
              <td style="text-align:right;font-variant-numeric:tabular-nums">${fmtNumber(p.totalPlays)}</td>
            </tr>`
        }).join('')

        rows.forEach(p => {
          const host = tbody.querySelector(`[data-spark="${CSS.escape(p.id)}"]`)
          if (host) {
            try {
              makeSparkline(host, { data: p.sparkSeries, color: '#8b5cf6', fill: true })
            } catch (_) {}
          }
        })

        tbody.querySelectorAll('.leaderboard-row').forEach(row => {
          row.addEventListener('click', e => {
            if (e.target.closest('.host-link')) return
            openPodcastDrawer(row.dataset.podcast)
          })
        })
        tbody.querySelectorAll('.host-link').forEach(btn => {
          btn.addEventListener('click', e => {
            e.stopPropagation()
            const userId = btn.dataset.host
            if (userId) showUserDetailModal(userId)
          })
        })
      }

      async function openPodcastDrawer(podcastId) {
        const podcast = aggregated.find(p => p.id === podcastId)
        const d = drawer({
          title: podcast ? podcast.title : 'Podcast-Details',
          subtitle: 'Letzte 30 Tage · Episoden & Hosts',
          content: `<div id="drawerLoading" style="padding:32px;text-align:center">${spinnerHtml()} Details werden geladen…</div>`
        })
        // FIX #2: guard against drawer() returning an object without querySelector
        const root = d.contentEl || d.body || d.el || d
        if (!root || typeof root.querySelector !== 'function') {
          console.error('[top-listened-podcasts] drawer() did not return an element with querySelector. Received:', d)
          toast('Drawer konnte nicht geöffnet werden.', 'error')
          return
        }

        try {
          const p = aggregated.find(x => x.id === podcastId)
          const episodeRows = rawRows
            .filter(r => r.episodes?.podcast_id === podcastId || r.episodes?.podcasts?.id === podcastId)
          const byEpisode = new Map()
          for (const r of episodeRows) {
            const epId = r.episode_id
            if (!epId) continue
            if (!byEpisode.has(epId)) {
              byEpisode.set(epId, {
                id: epId,
                title: r.episodes?.title || 'Unbekannte Episode',
                plays: 0,
                minutes: 0,
              })
            }
            const o = byEpisode.get(epId)
            o.plays += 1
            o.minutes += (r.duration_seconds || 0) / 60
          }
          const topEps = Array.from(byEpisode.values())
            .sort((a, b) => b.minutes - a.minutes)
            .slice(0, 15)

          const html = `
            <div class="drawer-content-inner" style="padding:20px">
              <div style="display:flex;align-items:center;gap:14px;margin-bottom:18px">
                ${p?.cover ? `<img src="${htmlEscape(p.cover)}" style="width:56px;height:56px;border-radius:10px;object-fit:cover">` : ''}
                <div>
                  <div style="font-weight:700;font-size:17px">${htmlEscape(p?.title || podcastId)}</div>
                  <div style="color:var(--muted);font-size:13px">${fmtNumber(p?.totalMinutes || 0)} Hörmin · ${fmtNumber(p?.totalPlays || 0)} Plays · letzte 7 Tage</div>
                </div>
              </div>
              ${topEps.length ? `
              <h4 style="margin:0 0 10px;font-size:14px">Top Episodes</h4>
              <table class="data-table" style="width:100%">
                <thead><tr><th>#</th><th>Episode</th><th style="text-align:right">Min</th><th style="text-align:right">Plays</th></tr></thead>
                <tbody>
                  ${topEps.map((ep, i) => `
                    <tr>
                      <td style="color:var(--muted)">${i + 1}</td>
                      <td>${htmlEscape(ep.title)}</td>
                      <td style="text-align:right">${Math.round(ep.minutes)}</td>
                      <td style="text-align:right">${ep.plays}</td>
                    </tr>`).join('')}
                </tbody>
              </table>` : `<div class="empty-state" style="padding:24px;text-align:center">Keine Episode-Daten verfügbar.</div>`}
            </div>
          `
          const loadingEl = root.querySelector('#drawerLoading')
          if (loadingEl) loadingEl.outerHTML = html
          else {
            const target = root.querySelector('.drawer-content') || root
            target.innerHTML = html
          }
        } catch (err) {
          const loadingEl = root.querySelector('#drawerLoading')
          const html = `<div class="error-state" style="padding:24px">
            <div class="error-icon">${iconHtml('alert')}</div>
            <h3>Details konnten nicht geladen werden</h3>
            <p>${htmlEscape(err.message || String(err))}</p>
          </div>`
          if (loadingEl) loadingEl.outerHTML = html
          toast(`Fehler: ${err.message || err}`, 'error')
        }
      }

      toolbar.querySelector('[data-act="refresh"]').addEventListener('click', () => {
        toast('Daten werden aktualisiert…', 'info')
        load()
      })
      toolbar.querySelector('[data-act="pdf"]').addEventListener('click', () => {
        try {
          exportPanelAsPdf(container, { title: 'Top gehörte Podcasts', filename: `top-podcasts-7t.pdf` })
        } catch (e) {
          toast(`PDF-Export fehlgeschlagen: ${e.message || e}`, 'error')
        }
      })
      toolbar.querySelector('[data-act="csv"]').addEventListener('click', () => {
        try {
          exportCsv(aggregated.slice(0, limit).map((p, i) => ({
            Rang: i + 1,
            Podcast: p.title,
            'Hörminuten (7T)': p.totalMinutes,
            Plays: p.totalPlays,
            Episoden: p.episodeCount
          })), null, `top-podcasts-7t.csv`)
        } catch (e) {
          toast(`CSV-Export fehlgeschlagen: ${e.message || e}`, 'error')
        }
      })
      toolbar.querySelector('#limitSel').addEventListener('change', e => {
        limit = parseInt(e.target.value, 10) || 25
        render()
      })

      load()
    } catch (mountErr) {
      container.innerHTML = `
        <div class="panel-shell">
          <div class="error-state glass-card" style="margin:24px">
            <div class="error-icon">${iconHtml ? iconHtml('alert') : '⚠️'}</div>
            <h3>Panel konnte nicht initialisiert werden</h3>
            <p>${htmlEscape ? htmlEscape(mountErr.message || String(mountErr)) : (mountErr.message || String(mountErr))}</p>
          </div>
        </div>`
    }
  }
}
