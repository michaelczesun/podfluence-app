import { sb } from '/lib/supabase.js'
import { toast, modal, fmtNumber, fmtDateTime, htmlEscape, iconHtml, debounce, spinnerHtml } from '/lib/ui.js'
import { makeAreaChart, makeBarChart, makeDonutChart, makeSparkline, makeLineChart } from '/lib/charts.js'
import { exportPanelAsPdf, exportCsv } from '/lib/export.js'
import { countUp, fadeIn, skeletonLoader } from '/lib/animations.js'
import { drawer, segmentedControl, statHero, glassCard } from '/lib/layout-extras.js'
import { showUserDetailModal } from '/lib/panel-actions.js'

const DAY_MS = 86400000

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
  const { data, error } = await sb
    .from('listening_sessions')
    .select('started_at, duration_seconds, episode_id, episodes(id, title, podcast_id, podcasts(id, title, cover_url, host_user_id))')
    .gte('started_at', since)
    .order('started_at', { ascending: true })
  if (error) throw error
  return data || []
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
  return Array.from(byPodcast.values())
    .map(p => ({
      ...p,
      totalMinutes: Math.round(p.totalMinutes),
      sparkSeries: days.map(d => Math.round(p.spark[d])),
      episodeCount: p.episodeIds.size
    }))
    .sort((a, b) => b.totalMinutes - a.totalMinutes)
}

async function fetchPodcastDetail(podcastId) {
  const since = new Date(Date.now() - 30 * DAY_MS).toISOString()

  const [{ data: podcast, error: pErr }, { data: hosts, error: hErr }, { data: sessions, error: sErr }] = await Promise.all([
    sb.from('podcasts').select('id, title, cover_url, description, host_user_id, created_at').eq('id', podcastId).maybeSingle(),
    sb.from('podcast_hosts').select('user_id, role, users(id, display_name, username, avatar_url)').eq('podcast_id', podcastId),
    sb.from('listening_sessions')
      .select('started_at, duration_seconds, episode_id, episodes!inner(id, title, published_at, podcast_id)')
      .gte('started_at', since)
      .eq('episodes.podcast_id', podcastId)
  ])
  if (pErr) throw pErr
  if (hErr && hErr.code !== 'PGRST116') {
    // ignore missing-table errors; fallback to single host
  }
  if (sErr) throw sErr

  const validSessions = (sessions || []).filter(s => s.episodes)
  const byEpisode = new Map()
  for (const s of validSessions) {
    const ep = s.episodes
    if (!ep?.id) continue
    if (!byEpisode.has(ep.id)) {
      byEpisode.set(ep.id, {
        id: ep.id,
        title: ep.title || 'Unbekannte Episode',
        published_at: ep.published_at,
        plays: 0,
        minutes: 0
      })
    }
    const o = byEpisode.get(ep.id)
    o.plays += 1
    o.minutes += (s.duration_seconds || 0) / 60
  }
  const episodes = Array.from(byEpisode.values())
    .map(e => ({ ...e, minutes: Math.round(e.minutes) }))
    .sort((a, b) => b.minutes - a.minutes)

  // primary host fallback
  let hostList = hosts || []
  if (hostList.length === 0 && podcast?.host_user_id) {
    const { data: hostUser } = await sb.from('users').select('id, display_name, username, avatar_url').eq('id', podcast.host_user_id).maybeSingle()
    if (hostUser) hostList = [{ user_id: hostUser.id, role: 'Host', users: hostUser }]
  }

  return { podcast, hosts: hostList, episodes, sessions: validSessions }
}

export default {
  id: 'top-listened-podcasts',
  title: 'Top gehörte Podcasts',
  category: 'listening',

  async mount(container) {
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
    body.innerHTML = skeletonLoader({ rows: 8, height: 64 })

    async function load() {
      body.innerHTML = skeletonLoader({ rows: 8, height: 64 })
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
            <h3>Noch keine Hörsessions</h3>
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

      // Hero stats
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

      // Bar chart (top 10)
      const barHost = body.querySelector('#barChart')
      const barTop = top.slice(0, 10)
      makeBarChart(barHost, {
        data: barTop.map(p => ({ x: p.title.length > 18 ? p.title.slice(0, 17) + '…' : p.title, y: p.totalMinutes })),
        xLabel: 'Podcast',
        yLabel: 'Minuten',
        color: '#8b5cf6',
        horizontal: true
      })

      // Donut: top 5 vs rest
      const donutHost = body.querySelector('#donutChart')
      const top5 = aggregated.slice(0, 5)
      const restSum = aggregated.slice(5).reduce((s, p) => s + p.totalMinutes, 0)
      const donutData = top5.map((p, i) => ({
        label: p.title.length > 20 ? p.title.slice(0, 19) + '…' : p.title,
        value: p.totalMinutes,
        color: ['#8b5cf6', '#06b6d4', '#f59e0b', '#ec4899', '#10b981'][i]
      }))
      if (restSum > 0) donutData.push({ label: 'Rest', value: restSum, color: '#374151' })
      makeDonutChart(donutHost, { data: donutData })

      renderLeaderboardRows()

      // Sort headers
      body.querySelectorAll('th.sortable').forEach(th => {
        th.addEventListener('click', () => {
          sortKey = th.dataset.sort
          aggregated.sort((a, b) => b[sortKey] - a[sortKey])
          render()
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

      // Mount sparklines
      rows.forEach(p => {
        const host = tbody.querySelector(`[data-spark="${CSS.escape(p.id)}"]`)
        if (host) {
          try {
            makeSparkline(host, { data: p.sparkSeries, color: '#8b5cf6', fill: true })
          } catch (_) {}
        }
      })

      // Row click → drawer
      tbody.querySelectorAll('.leaderboard-row').forEach(row => {
        row.addEventListener('click', e => {
          if (e.target.closest('.host-link')) return
          openPodcastDrawer(row.dataset.podcast)
        })
      })
      // Host click
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
      const root = d.contentEl || d.body || d.el || d

      try {
        const detail = await fetchPodcastDetail(podcastId)
        const totalEpisodeMin = detail.episodes.reduce((s, e) => s + e.minutes, 0)
        const totalEpisodePlays = detail.episodes.reduce((s, e) => s + e.plays, 0)

        const coverHtml = detail.podcast?.cover_url
          ? `<img src="${htmlEscape(detail.podcast.cover_url)}" style="width:88px;height:88px;border-radius:12px;object-fit:cover" onerror="this.style.display='none'">`
          : `<div style="width:88px;height:88px;border-radius:12px;background:linear-gradient(135deg,#8b5cf6,#06b6d4);display:flex;align-items:center;justify-content:center;color:#fff;font-size:32px;font-weight:700">${htmlEscape((detail.podcast?.title || '?').charAt(0).toUpperCase())}</div>`

        const hostsHtml = detail.hosts.length === 0
          ? `<p class="muted">Keine Hosts hinterlegt.</p>`
          : `<div class="host-grid" style="display:flex;flex-wrap:wrap;gap:8px">
              ${detail.hosts.map(h => {
                const u = h.users || {}
                const name = u.display_name || u.username || 'Unbekannt'
                const avatar = u.avatar_url
                  ? `<img src="${htmlEscape(u.avatar_url)}" style="width:28px;height:28px;border-radius:50%;object-fit:cover" onerror="this.style.display='none'">`
                  : `<div style="width:28px;height:28px;border-radius:50%;background:#374151;display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px;font-weight:600">${htmlEscape(name.charAt(0).toUpperCase())}</div>`
                return `<button class="btn btn-ghost host-chip" data-user="${htmlEscape(h.user_id)}" style="display:inline-flex;align-items:center;gap:8px;padding:6px 12px;border-radius:999px">
                  ${avatar}
                  <span>${htmlEscape(name)}</span>
                  <span class="muted" style="font-size:11px">${htmlEscape(h.role || 'Host')}</span>
                </button>`
              }).join('')}
            </div>`

        const epRows = detail.episodes.slice(0, 50).map((e, i) => `
          <tr>
            <td class="muted">${i + 1}</td>
            <td>${htmlEscape(e.title)}</td>
            <td class="muted" style="font-size:12px">${e.published_at ? fmtDateTime(e.published_at).split(',')[0] : '—'}</td>
            <td style="text-align:right;font-variant-numeric:tabular-nums">${fmtNumber(e.plays)}</td>
            <td style="text-align:right;font-variant-numeric:tabular-nums"><strong>${fmtNumber(e.minutes)}</strong></td>
          </tr>`).join('')

        const html = `
          <div class="drawer-content-inner" style="padding:20px;display:flex;flex-direction:column;gap:20px">
            <div style="display:flex;gap:16px;align-items:center">
              ${coverHtml}
              <div style="flex:1;min-width:0">
                <h3 style="margin:0 0 6px">${htmlEscape(detail.podcast?.title || 'Unbekannter Podcast')}</h3>
                <p class="muted" style="margin:0;font-size:13px;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${htmlEscape(detail.podcast?.description || 'Keine Beschreibung')}</p>
              </div>
            </div>

            <div class="hero-row" id="drawerHero" style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px"></div>

            <div class="glass-card" style="padding:16px">
              <h4 style="margin:0 0 12px">Hosts</h4>
              ${hostsHtml}
            </div>

            <div class="glass-card" style="padding:16px">
              <h4 style="margin:0 0 12px">Top Episoden (30 Tage)</h4>
              ${detail.episodes.length === 0
                ? `<div class="empty-state" style="padding:24px"><div class="empty-icon">${iconHtml('headphones')}</div><h4>Keine Plays im Zeitraum</h4><p class="muted">In den letzten 30 Tagen wurden keine Episoden dieses Podcasts gehört.</p></div>`
                : `<table class="data-table data-table-hover">
                    <thead><tr><th>#</th><th>Episode</th><th>Veröffentlicht</th><th style="text-align:right">Plays</th><th style="text-align:right">Minuten</th></tr></thead>
                    <tbody>${epRows}</tbody>
                  </table>`}
            </div>
          </div>
        `

        const loadingEl = root.querySelector ? root.querySelector('#drawerLoading') : null
        if (loadingEl) loadingEl.outerHTML = html
        else if (root.querySelector) {
          const target = root.querySelector('.drawer-content') || root
          target.innerHTML = html
        }

        // Hero stats inside drawer
        const drawerHero = (root.querySelector ? root.querySelector('#drawerHero') : null)
        if (drawerHero) {
          drawerHero.appendChild(statHero({ label: 'Episoden gehört', value: String(detail.episodes.length), accent: 'violet', icon: 'list' }))
          drawerHero.appendChild(statHero({ label: 'Plays (30T)', value: String(totalEpisodePlays), accent: 'cyan', icon: 'play' }))
          drawerHero.appendChild(statHero({ label: 'Minuten (30T)', value: String(totalEpisodeMin), accent: 'amber', icon: 'clock' }))
        }

        // Host chip clicks → user modal
        if (root.querySelectorAll) {
          root.querySelectorAll('.host-chip').forEach(chip => {
            chip.addEventListener('click', () => {
              const uid = chip.dataset.user
              if (uid) showUserDetailModal(uid)
            })
          })
        }
      } catch (err) {
        const loadingEl = root.querySelector ? root.querySelector('#drawerLoading') : null
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
      exportPanelAsPdf(container, { title: 'Top gehörte Podcasts', filename: `top-podcasts-7t.pdf` })
    })
    toolbar.querySelector('[data-act="csv"]').addEventListener('click', () => {
      exportCsv(aggregated.slice(0, limit).map((p, i) => ({
        Rang: i + 1,
        Podcast: p.title,
        'Hörminuten (7T)': p.totalMinutes,
        Plays: p.totalPlays,
        Episoden: p.episodeCount
      })), `top-podcasts-7t.csv`)
    })
    toolbar.querySelector('#limitSel').addEventListener('change', e => {
      limit = parseInt(e.target.value, 10) || 25
      render()
    })

    await load()
  }
}
