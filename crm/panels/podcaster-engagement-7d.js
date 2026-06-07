import { sb } from '/lib/supabase.js'
import { toast, confirmDialog, fmtNumber, htmlEscape, iconHtml } from '/lib/ui.js'
import { makeLineChart } from '/lib/charts.js'
import { exportPanelAsPdf, exportCsv } from '/lib/export.js'
import { countUp, fadeIn, skeletonLoader } from '/lib/animations.js'
import { drawer, segmentedControl, statHero } from '/lib/layout-extras.js'
import { showUserDetailModal, sendBroadcastPush } from '/lib/panel-actions.js'

const RANGES = {
  '7d': { days: 7, label: '7 Tage' },
  '30d': { days: 30, label: '30 Tage' }
}

const METRICS = [
  { key: 'posts',    label: 'Posts',    color: '#8b5cf6' },
  { key: 'episodes', label: 'Episodes', color: '#06b6d4' },
  { key: 'listens',  label: 'Listens',  color: '#10b981' },
  { key: 'likes',    label: 'Likes',    color: '#f59e0b' }
]

let state = {
  range: '7d',
  rows: [],
  labels: [],
  activeMetric: 'posts',
  loading: false,
  error: null
}

function isoDay(d) { return d.toISOString().slice(0, 10) }

function buildDayLabels(days) {
  const labels = []
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(today.getDate() - i)
    labels.push(isoDay(d))
  }
  return labels
}

async function fetchData(range) {
  const days = RANGES[range].days
  const since = new Date()
  since.setHours(0, 0, 0, 0)
  since.setDate(since.getDate() - (days - 1))
  const sinceIso = since.toISOString()
  const labels = buildDayLabels(days)

  const [postsR, episodesR, likesR, listensR] = await Promise.all([
    sb.from('posts').select('user_id, created_at').gte('created_at', sinceIso).limit(20000),
    sb.from('episodes').select('user_id, created_at').gte('created_at', sinceIso).limit(20000),
    sb.from('post_likes').select('post_user_id, created_at').gte('created_at', sinceIso).limit(20000),
    sb.from('episode_listens').select('episode_user_id, created_at').gte('created_at', sinceIso).limit(50000)
  ])

  const safePosts    = postsR?.data    || []
  const safeEpisodes = episodesR?.data || []
  const safeLikes    = likesR?.data    || []
  const safeListens  = listensR?.data  || []

  const agg = new Map()
  const ensure = (uid) => {
    if (!agg.has(uid)) {
      agg.set(uid, {
        user_id: uid,
        posts: 0, episodes: 0, listens: 0, likes: 0,
        series: {
          posts:    new Array(days).fill(0),
          episodes: new Array(days).fill(0),
          listens:  new Array(days).fill(0),
          likes:    new Array(days).fill(0)
        }
      })
    }
    return agg.get(uid)
  }
  const idxFor = (createdAt) => labels.indexOf(isoDay(new Date(createdAt)))

  for (const r of safePosts) {
    if (!r.user_id) continue
    const a = ensure(r.user_id); a.posts++
    const i = idxFor(r.created_at); if (i >= 0) a.series.posts[i]++
  }
  for (const r of safeEpisodes) {
    if (!r.user_id) continue
    const a = ensure(r.user_id); a.episodes++
    const i = idxFor(r.created_at); if (i >= 0) a.series.episodes[i]++
  }
  for (const r of safeLikes) {
    if (!r.post_user_id) continue
    const a = ensure(r.post_user_id); a.likes++
    const i = idxFor(r.created_at); if (i >= 0) a.series.likes[i]++
  }
  for (const r of safeListens) {
    if (!r.episode_user_id) continue
    const a = ensure(r.episode_user_id); a.listens++
    const i = idxFor(r.created_at); if (i >= 0) a.series.listens[i]++
  }

  const scored = Array.from(agg.values()).map(a => ({
    ...a,
    total: a.posts * 2 + a.episodes * 5 + a.likes * 1 + a.listens * 0.5
  }))
  scored.sort((a, b) => b.total - a.total)
  const top = scored.slice(0, 5)

  if (top.length) {
    const ids = top.map(r => r.user_id)
    const { data: users } = await sb
      .from('users')
      .select('id, display_name, username, avatar_url')
      .in('id', ids)
    const umap = new Map((users || []).map(u => [u.id, u]))
    for (const r of top) {
      const u = umap.get(r.user_id) || {}
      r.name = u.display_name || u.username || (r.user_id ? r.user_id.slice(0, 8) : 'Unbekannt')
      r.username = u.username || ''
      r.avatar = u.avatar_url || ''
    }
  }

  return { rows: top, labels, days }
}

function renderHero(root, totals) {
  root.innerHTML = `
    ${statHero({ label: 'Posts',    value: fmtNumber(totals.posts),    icon: 'edit' })}
    ${statHero({ label: 'Episodes', value: fmtNumber(totals.episodes), icon: 'mic' })}
    ${statHero({ label: 'Listens',  value: fmtNumber(totals.listens),  icon: 'play' })}
    ${statHero({ label: 'Likes',    value: fmtNumber(totals.likes),    icon: 'heart' })}
  `
  root.querySelectorAll('[data-stat-value]').forEach(el => {
    const v = Number(el.dataset.statValue || el.textContent.replace(/\D/g, '')) || 0
    countUp(el, v)
  })
}

function renderMultiLineChart(root, rows, labels, metric) {
  if (!root) return
  if (!rows.length) {
    const m = METRICS.find(x => x.key === metric)
    root.innerHTML = `<div class="empty-mini">Keine Daten für ${htmlEscape(m ? m.label : metric)}.</div>`
    return
  }
  const palette = ['#8b5cf6','#06b6d4','#10b981','#f59e0b','#ef4444']
  const series = rows.map((r, i) => ({
    name: r.name,
    color: palette[i % palette.length],
    data: r.series[metric] || []
  }))
  makeLineChart(root, {
    labels: labels.map(l => l.slice(5)),
    series,
    height: 320,
    smooth: true,
    legend: true,
    yAxis: true
  })
}

function rowHtml(r, rank) {
  const avatar = r.avatar
    ? `<img src="${htmlEscape(r.avatar)}" alt="" class="avatar-sm" />`
    : `<div class="avatar-sm avatar-fallback">${htmlEscape((r.name || '?').slice(0,1).toUpperCase())}</div>`
  return `
    <tr data-uid="${htmlEscape(r.user_id)}" class="row-hover">
      <td class="rank-cell">#${rank}</td>
      <td>
        <div class="user-cell">
          ${avatar}
          <div>
            <div class="user-name">${htmlEscape(r.name)}</div>
            ${r.username ? `<div class="user-sub">@${htmlEscape(r.username)}</div>` : ''}
          </div>
        </div>
      </td>
      <td class="num">${fmtNumber(r.posts)}</td>
      <td class="num">${fmtNumber(r.episodes)}</td>
      <td class="num">${fmtNumber(r.listens)}</td>
      <td class="num">${fmtNumber(r.likes)}</td>
      <td class="num strong">${fmtNumber(Math.round(r.total))}</td>
      <td class="actions-cell">
        <button class="btn-icon" data-act="detail" title="Details">${iconHtml('user')}</button>
        <button class="btn-icon" data-act="thanks" title="Danke senden">${iconHtml('heart')}</button>
      </td>
    </tr>
  `
}

function tableHtml(rows) {
  if (!rows.length) return ''
  return `
    <table class="data-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Podcaster</th>
          <th class="num">Posts</th>
          <th class="num">Episodes</th>
          <th class="num">Listens</th>
          <th class="num">Likes</th>
          <th class="num">Score</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((r,i) => rowHtml(r, i+1)).join('')}
      </tbody>
    </table>
  `
}

function emptyState() {
  return `
    <div class="empty-state">
      <div class="empty-icon">${iconHtml('mic')}</div>
      <h3>Keine aktiven Podcaster im Zeitraum</h3>
      <p>Im gewählten Fenster gibt es noch keine Posts, Episodes, Listens oder Likes.</p>
      <button class="btn btn-secondary" data-act="switch-30">30 Tage anzeigen</button>
    </div>
  `
}

function errorState(msg) {
  return `
    <div class="empty-state error-state">
      <div class="empty-icon">${iconHtml('alert')}</div>
      <h3>Daten konnten nicht geladen werden</h3>
      <p>${htmlEscape(msg)}</p>
      <button class="btn btn-primary" data-act="retry">Erneut versuchen</button>
    </div>
  `
}

async function massThankYou(rows) {
  if (!rows.length) { toast('Keine Top-5 vorhanden.', 'warn'); return }
  const names = rows.map(r => r.name).join(', ')
  const ok = await confirmDialog({
    title: 'Mass-Thank-You senden',
    body: `Push an die Top-5 Podcaster:<br><strong>${htmlEscape(names)}</strong><br><br>Nachricht: „Danke für deinen Beat diese Woche! 🎙️"`,
    confirmLabel: 'Push senden',
    danger: false
  })
  if (!ok) return
  try {
    const ids = rows.map(r => r.user_id)
    await sendBroadcastPush({
      user_ids: ids,
      title: 'Danke! 🎙️',
      body: 'Du gehörst diese Woche zu den Top-5 Podcastern auf Podfluence. Wir feiern dich!',
      data: { kind: 'mass_thanks', source: 'crm' }
    })
    toast(`Push an ${ids.length} Podcaster gesendet.`, 'success')
  } catch (e) {
    toast('Push fehlgeschlagen: ' + (e?.message || e), 'error')
  }
}

function openDrawer(row) {
  const body = `
    <div class="drawer-content">
      <div class="drawer-header-row">
        ${row.avatar ? `<img src="${htmlEscape(row.avatar)}" class="avatar-lg" />` : `<div class="avatar-lg avatar-fallback">${htmlEscape((row.name||'?').slice(0,1).toUpperCase())}</div>`}
        <div>
          <h2>${htmlEscape(row.name)}</h2>
          ${row.username ? `<div class="muted">@${htmlEscape(row.username)}</div>` : ''}
        </div>
      </div>
      <div class="drawer-stats">
        ${METRICS.map(m => `
          <div class="stat-mini">
            <div class="stat-mini-label">${m.label}</div>
            <div class="stat-mini-value">${fmtNumber(row[m.key])}</div>
          </div>
        `).join('')}
      </div>
      <div class="glass-card" style="padding:12px;margin-top:12px">
        <h4>Verlauf je Metrik</h4>
        <div id="drawer-chart" style="height:260px"></div>
      </div>
      <div class="drawer-actions">
        <button class="btn btn-secondary" data-act="open-user">Profil-Details</button>
        <button class="btn btn-primary" data-act="thanks-one">Danke senden</button>
      </div>
    </div>
  `
  const d = drawer({ title: 'Podcaster-Details', body, width: 520 })
  const chartEl = d.el.querySelector('#drawer-chart')
  if (chartEl) {
    const labels = buildDayLabels(RANGES[state.range].days).map(l => l.slice(5))
    makeLineChart(chartEl, {
      labels,
      series: METRICS.map(m => ({ name: m.label, color: m.color, data: row.series[m.key] || [] })),
      height: 240, smooth: true, legend: true, yAxis: true
    })
  }
  d.el.querySelector('[data-act="open-user"]')?.addEventListener('click', () => {
    showUserDetailModal(row.user_id)
  })
  d.el.querySelector('[data-act="thanks-one"]')?.addEventListener('click', async () => {
    try {
      await sendBroadcastPush({
        user_ids: [row.user_id],
        title: 'Danke! 🎙️',
        body: `Hey ${row.name}, danke für dein Engagement diese Woche!`,
        data: { kind: 'thanks_single', source: 'crm' }
      })
      toast('Push gesendet.', 'success')
    } catch (e) {
      toast('Fehler: ' + (e?.message || e), 'error')
    }
  })
}

async function load(container) {
  const body = container.querySelector('#body')
  if (!body) return
  state.loading = true
  state.error = null
  try {
    body.innerHTML = skeletonLoader({ lines: 6, withChart: true })
  } catch (_) {
    body.innerHTML = '<div class="muted" style="padding:24px">Lade Daten…</div>'
  }
  try {
    const { rows, labels } = await fetchData(state.range)
    state.rows = rows
    state.labels = labels
    render(container)
  } catch (e) {
    state.error = e?.message || String(e)
    body.innerHTML = errorState(state.error)
    body.querySelector('[data-act="retry"]')?.addEventListener('click', () => load(container))
  } finally {
    state.loading = false
  }
}

function render(container) {
  const body = container.querySelector('#body')
  if (!body) return
  const totals = state.rows.reduce((acc, r) => {
    acc.posts += r.posts; acc.episodes += r.episodes
    acc.listens += r.listens; acc.likes += r.likes
    return acc
  }, { posts:0, episodes:0, listens:0, likes:0 })

  body.innerHTML = `
    <div class="hero-row" id="hero"></div>

    <div class="glass-card chart-card">
      <div class="card-head">
        <div>
          <h3>Multi-Metric-Verlauf · Top 5</h3>
          <div class="muted">Parallele Lines je Podcaster — wähle Metrik</div>
        </div>
        <div id="metric-switch"></div>
      </div>
      <div id="multiline" style="height:340px"></div>
    </div>

    <div class="glass-card list-card">
      <div class="card-head">
        <h3>Top-5 Podcaster · ${RANGES[state.range].label}</h3>
        <button class="btn btn-primary" id="mass-thanks">${iconHtml('heart')} Mass-Thank-You an Top-5</button>
      </div>
      <div id="list-area">
        ${state.rows.length ? tableHtml(state.rows) : emptyState()}
      </div>
    </div>
  `

  renderHero(body.querySelector('#hero'), totals)

  const switchHost = body.querySelector('#metric-switch')
  if (switchHost) {
    switchHost.innerHTML = ''
    segmentedControl(switchHost, {
      options: METRICS.map(m => ({ value: m.key, label: m.label })),
      value: state.activeMetric,
      onChange: (v) => {
        state.activeMetric = v
        renderMultiLineChart(body.querySelector('#multiline'), state.rows, state.labels, state.activeMetric)
      }
    })
  }

  renderMultiLineChart(body.querySelector('#multiline'), state.rows, state.labels, state.activeMetric)

  body.querySelector('#mass-thanks')?.addEventListener('click', () => massThankYou(state.rows))

  body.querySelector('[data-act="switch-30"]')?.addEventListener('click', () => {
    state.range = '30d'
    refreshSubnav(container)
    load(container)
  })

  body.querySelectorAll('tr[data-uid]').forEach(tr => {
    const uid = tr.dataset.uid
    const row = state.rows.find(r => r.user_id === uid)
    if (!row) return
    tr.addEventListener('click', (e) => {
      if (e.target.closest('button')) return
      openDrawer(row)
    })
    tr.querySelector('[data-act="detail"]')?.addEventListener('click', (e) => {
      e.stopPropagation(); showUserDetailModal(uid)
    })
    tr.querySelector('[data-act="thanks"]')?.addEventListener('click', async (e) => {
      e.stopPropagation()
      try {
        await sendBroadcastPush({
          user_ids: [uid],
          title: 'Danke! 🎙️',
          body: `Hey ${row.name}, danke für dein Engagement!`,
          data: { kind: 'thanks_single', source: 'crm' }
        })
        toast('Push gesendet.', 'success')
      } catch (err) {
        toast('Fehler: ' + (err?.message || err), 'error')
      }
    })
  })

  try { fadeIn(body) } catch (_) {}
}

function refreshSubnav(container) {
  const seg = container.querySelector('#range-switch')
  if (!seg) return
  seg.querySelectorAll('[data-range]').forEach(el => {
    el.classList.toggle('active', el.dataset.range === state.range)
  })
}

export default {
  id: 'podcaster-engagement-7d',
  title: 'Podcaster-Engagement',
  category: 'engagement',

  async mount(container) {
    try {
      container.innerHTML = `
        <div class="panel-shell">
          <div class="panel-head">
            <div>
              <h2>Podcaster-Engagement</h2>
              <div class="muted">Posts · Episodes · Listens · Likes — Top 5 im Zeitraum</div>
            </div>
            <div class="toolbar">
              <div class="seg-control" id="range-switch">
                <button data-range="7d"  class="${state.range==='7d'?'active':''}">7 Tage</button>
                <button data-range="30d" class="${state.range==='30d'?'active':''}">30 Tage</button>
              </div>
              <button class="btn btn-ghost" id="btn-refresh" title="Aktualisieren">${iconHtml('refresh')} Aktualisieren</button>
              <button class="btn btn-ghost" id="btn-pdf"     title="Als PDF">${iconHtml('file')} PDF</button>
              <button class="btn btn-ghost" id="btn-csv"     title="Als CSV">${iconHtml('download')} CSV</button>
            </div>
          </div>
          <div class="panel-body" id="body">
            <div class="muted" style="padding:24px">Lade…</div>
          </div>
        </div>
      `

      container.querySelectorAll('#range-switch [data-range]').forEach(btn => {
        btn.addEventListener('click', () => {
          if (state.range === btn.dataset.range) return
          state.range = btn.dataset.range
          refreshSubnav(container)
          load(container)
        })
      })

      container.querySelector('#btn-refresh')?.addEventListener('click', () => load(container))

      container.querySelector('#btn-pdf')?.addEventListener('click', () => {
        try {
          exportPanelAsPdf({
            title: `Podcaster-Engagement (${RANGES[state.range].label})`,
            element: container.querySelector('.panel-shell')
          })
        } catch (e) {
          toast('PDF-Export fehlgeschlagen: ' + (e?.message || e), 'error')
        }
      })

      container.querySelector('#btn-csv')?.addEventListener('click', () => {
        try {
          const rows = state.rows.map((r, i) => ({
            rank: i+1,
            user_id: r.user_id,
            name: r.name,
            username: r.username,
            posts: r.posts,
            episodes: r.episodes,
            listens: r.listens,
            likes: r.likes,
            score: Math.round(r.total)
          }))
          exportCsv(`podcaster-engagement-${state.range}.csv`, rows)
        } catch (e) {
          toast('CSV-Export fehlgeschlagen: ' + (e?.message || e), 'error')
        }
      })

      // Background-Load: erst Skeleton, dann Daten
      load(container)
    } catch (e) {
      const msg = e?.message || String(e)
      container.innerHTML = `
        <div class="panel-shell">
          <div class="empty-state error-state" style="padding:32px">
            <div class="empty-icon">${iconHtml ? iconHtml('alert') : '!'}</div>
            <h3>Panel konnte nicht initialisiert werden</h3>
            <p>${(htmlEscape ? htmlEscape(msg) : msg)}</p>
            <button class="btn btn-primary" data-act="mount-retry">Erneut versuchen</button>
          </div>
        </div>
      `
      container.querySelector('[data-act="mount-retry"]')?.addEventListener('click', () => {
        this.mount(container)
      })
    }
  }
}
