import { sb } from '/lib/supabase.js?v=20260608j'
import { toast, fmtNumber, fmtDateTime, fmtRelativeTime, htmlEscape, iconHtml } from '/lib/ui.js?v=20260608j'
import { makeAreaChart, makeBarChart, makeDonutChart } from '/lib/charts.js?v=20260608j'
import { exportPanelAsPdf, exportCsv } from '/lib/export.js?v=20260608j'
import { countUp, fadeIn, skeletonLoader } from '/lib/animations.js?v=20260608j'
import { drawer, statHero } from '/lib/layout-extras.js?v=20260608j'
import { showUserDetailModal } from '/lib/panel-actions.js?v=20260608j'

const PALETTE = ['#7c5cff', '#22c1c3', '#fdbb2d', '#ff5e7e', '#3ee8a3', '#ffa057', '#5d9cff', '#c97bff']

// Max rows fetched from updates for hashtag aggregation.
// Keep this low to avoid expensive client-side scans.
// TODO: replace with server-side RPC admin_hashtag_stats when available.
const FALLBACK_FETCH_LIMIT = 500

async function fetchHashtags() {
  // Direct fallback: parse hashtags from updates table (last 30 days).
  // No materialized view is guaranteed to exist, so we skip the brute-force
  // view probe and use the updates table directly.
  const since30 = new Date(Date.now() - 30 * 86400000).toISOString()
  const since24 = new Date(Date.now() - 86400000).toISOString()
  const since7  = new Date(Date.now() - 7 * 86400000).toISOString()

  const { data: posts, error } = await sb
    .from('updates')
    .select('content, created_at')
    .gte('created_at', since30)
    .order('created_at', { ascending: false })
    .limit(FALLBACK_FETCH_LIMIT)
  if (error) throw error

  const TAG_RE = /#([a-zA-ZäöüÄÖÜß0-9_]+)/g
  const counts30 = new Map()
  const counts7  = new Map()
  const counts24 = new Map()
  const lastSeen = new Map()

  for (const p of (posts || [])) {
    const content = p.content || ''
    const ts = p.created_at || ''
    const matches = [...content.matchAll(TAG_RE)]
    for (const m of matches) {
      const tag = m[1].toLowerCase()
      counts30.set(tag, (counts30.get(tag) || 0) + 1)
      if (ts >= since7)  counts7.set(tag,  (counts7.get(tag)  || 0) + 1)
      if (ts >= since24) counts24.set(tag, (counts24.get(tag) || 0) + 1)
      if (!lastSeen.has(tag) || ts > lastSeen.get(tag)) lastSeen.set(tag, ts)
    }
  }

  return Array.from(counts30.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 80)
    .map(([tag, usage_count]) => {
      const c7  = counts7.get(tag)  || 0
      const c24 = counts24.get(tag) || 0
      // trend: compare 24h-rate vs 7d-average-daily-rate
      const daily7 = c7 / 7
      const trend = c24 > daily7 * 1.3 ? 'up' : c24 < daily7 * 0.5 ? 'down' : 'flat'
      return {
        tag,
        usage_count,
        posts_24h: c24,
        posts_7d: c7,
        last_used_at: lastSeen.get(tag) || null,
        trend,
      }
    })
}

async function fetchPostsForTag(tag) {
  const since = new Date(Date.now() - 30 * 86400000).toISOString()

  // Avoid FK join on users — the FK may not exist or the users table may not
  // be accessible via Supabase FK syntax. Fetch posts first, then batch-load
  // user profiles separately.
  const { data: posts, error } = await sb
    .from('updates')
    .select('id, user_id, content, created_at, likes_count, comments_count')
    .gte('created_at', since)
    .ilike('content', `%#${tag}%`)
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) throw error

  const userIds = [...new Set((posts || []).map(p => p.user_id).filter(Boolean))]
  let usersMap = {}
  if (userIds.length) {
    const { data: userRows } = await sb
      .from('users')
      .select('id, username, avatar_url')
      .in('id', userIds)
    for (const u of (userRows || [])) usersMap[u.id] = u
  }

  return (posts || []).map(p => ({
    ...p,
    users: usersMap[p.user_id] || null,
    // likes_count / comments_count may not exist on all rows — default to 0
    like_count: p.likes_count || 0,
    comment_count: p.comments_count || 0,
  }))
}

function bubbleCloud(items) {
  if (!items.length) return '<div class="empty-mini">Keine Hashtags</div>'
  const max = Math.max(...items.map(i => i.usage_count))
  const min = Math.min(...items.map(i => i.usage_count))
  const range = Math.max(1, max - min)
  const top = items.slice(0, 40)
  return `<div class="bubble-cloud">${top.map((t, i) => {
    const norm = (t.usage_count - min) / range
    const size = 14 + Math.round(norm * 36)
    const pad = 8 + Math.round(norm * 14)
    const color = PALETTE[i % PALETTE.length]
    const trendIcon = t.trend === 'up' ? '▲' : t.trend === 'down' ? '▼' : '◆'
    const trendCol = t.trend === 'up' ? '#3ee8a3' : t.trend === 'down' ? '#ff5e7e' : '#9aa0b4'
    return `<button class="bubble" data-tag="${htmlEscape(t.tag)}" style="
      font-size:${size}px;
      padding:${pad}px ${pad + 6}px;
      background:linear-gradient(135deg, ${color}33, ${color}11);
      border:1px solid ${color}55;
      color:${color};
    " title="#${htmlEscape(t.tag)} • ${fmtNumber(t.usage_count)} Posts">
      <span class="bubble-tag">#${htmlEscape(t.tag)}</span>
      <span class="bubble-trend" style="color:${trendCol}">${trendIcon}</span>
    </button>`
  }).join('')}</div>`
}

function trendArrow(trend) {
  if (trend === 'up') return '<span class="trend up">▲</span>'
  if (trend === 'down') return '<span class="trend down">▼</span>'
  return '<span class="trend flat">◆</span>'
}

function rankList(items) {
  if (!items.length) return `<div class="empty-mini" style="text-align:center;padding:24px 12px;color:var(--text-muted)">
    <div style="font-size:24px;opacity:.45;margin-bottom:4px">${iconHtml('hash')}</div>
    <div style="font-weight:600;color:var(--text);margin-bottom:2px">Noch keine Hashtags im Zeitraum</div>
    <div style="font-size:12px;line-height:1.4">Sobald User in Posts oder Newslettern #tags verwenden, wird das Ranking hier aktualisiert.</div>
  </div>`
  return `<table class="data-table hover sortable">
    <thead><tr><th style="width:48px">#</th><th>Tag</th><th style="width:90px">Anzahl</th><th style="width:60px">24h</th><th style="width:60px">Trend</th></tr></thead>
    <tbody>
      ${items.slice(0, 50).map((t, i) => `
        <tr data-tag="${htmlEscape(t.tag)}" class="row-clickable">
          <td><span class="rank-badge ${i < 3 ? 'top' : ''}">${i + 1}</span></td>
          <td><span class="tag-pill">#${htmlEscape(t.tag)}</span></td>
          <td><strong>${fmtNumber(t.usage_count)}</strong></td>
          <td>${fmtNumber(t.posts_24h || 0)}</td>
          <td>${trendArrow(t.trend)}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>`
}

async function openTagDrawer(tag) {
  drawer({
    title: `#${tag}`,
    width: 540,
    content: `<div id="tag-drawer-body">${skeletonLoader({ rows: 6 })}</div>`
  })

  // Wait one animation frame to ensure the drawer has rendered its DOM
  // before we try to access #tag-drawer-body.
  await new Promise(resolve => requestAnimationFrame(resolve))

  let posts = []
  try {
    posts = await fetchPostsForTag(tag)
  } catch (e) {
    const body = document.getElementById('tag-drawer-body')
    if (body) {
      body.innerHTML = `<div class="error-state">
        <div class="empty-icon">${iconHtml('alert-triangle')}</div>
        <h3>Fehler</h3>
        <p>${htmlEscape(e.message || 'Posts konnten nicht geladen werden')}</p>
      </div>`
    }
    return
  }
  const body = document.getElementById('tag-drawer-body')
  if (!body) return
  if (!posts.length) {
    body.innerHTML = `<div class="glass-card" style="padding:24px;text-align:center">
      <div class="empty-icon">${iconHtml('hash')}</div>
      <p>Keine Posts mit <strong>#${htmlEscape(tag)}</strong> in den letzten 30 Tagen gefunden.</p>
    </div>`
    return
  }
  body.innerHTML = `
    <div class="drawer-stats">
      <div class="ds-item"><span class="ds-num">${fmtNumber(posts.length)}</span><span class="ds-lbl">Posts</span></div>
      <div class="ds-item"><span class="ds-num">${fmtNumber(posts.reduce((s, p) => s + (p.like_count || 0), 0))}</span><span class="ds-lbl">Likes</span></div>
      <div class="ds-item"><span class="ds-num">${fmtNumber(posts.reduce((s, p) => s + (p.comment_count || 0), 0))}</span><span class="ds-lbl">Kommentare</span></div>
    </div>
    <div class="post-list">
      ${posts.map(p => `
        <div class="post-card glass-card-mini">
          <div class="post-head">
            <button class="user-chip" data-user="${htmlEscape(p.user_id || '')}">
              ${p.users?.avatar_url ? `<img src="${htmlEscape(p.users.avatar_url)}" alt="">` : '<span class="avatar-fallback"></span>'}
              <span>@${htmlEscape(p.users?.username || 'unbekannt')}</span>
            </button>
            <span class="post-time">${fmtRelativeTime(p.created_at)}</span>
          </div>
          <div class="post-content">${htmlEscape((p.content || '').slice(0, 240))}${(p.content || '').length > 240 ? '…' : ''}</div>
          <div class="post-meta">
            <span>♥ ${fmtNumber(p.like_count || 0)}</span>
            <span>💬 ${fmtNumber(p.comment_count || 0)}</span>
          </div>
        </div>
      `).join('')}
    </div>
  `
  body.querySelectorAll('.user-chip').forEach(el => {
    el.addEventListener('click', () => {
      const uid = el.getAttribute('data-user')
      if (uid) showUserDetailModal(uid)
    })
  })
}

export default {
  id: 'trending-hashtags',
  title: 'Trending Hashtags',
  category: 'content',
  async mount(container) {
    try {
      // Sofort-Render: Shell + Skeleton, damit kein weißer Screen entsteht
      container.innerHTML = `
        <div class="panel-shell">
          <div class="panel-head">
            <div>
              <h2>Trending Hashtags</h2>
              <p class="panel-sub">Bubble-Cloud nach Nutzung · Klick öffnet Posts mit Tag</p>
            </div>
            <div class="toolbar">
              <button class="btn-icon" id="btn-refresh" title="Aktualisieren">${iconHtml('refresh')}</button>
              <button class="btn-icon" id="btn-pdf" title="Als PDF exportieren">${iconHtml('file-pdf')}</button>
              <button class="btn-icon" id="btn-csv" title="Als CSV exportieren">${iconHtml('download')}</button>
            </div>
          </div>
          <div class="panel-body" id="body">${skeletonLoader({ rows: 8 })}</div>
        </div>
      `

      try { fadeIn(container) } catch (_) {}

      const body = container.querySelector('#body')
      let currentItems = []
      let isLoading = false

      const setExportButtonsDisabled = (disabled) => {
        const btnPdf = container.querySelector('#btn-pdf')
        const btnCsv = container.querySelector('#btn-csv')
        if (btnPdf) btnPdf.disabled = disabled
        if (btnCsv) btnCsv.disabled = disabled
      }

      const render = async () => {
        isLoading = true
        setExportButtonsDisabled(true)
        body.innerHTML = skeletonLoader({ rows: 8 })
        let items = []
        try {
          items = await fetchHashtags()
        } catch (e) {
          isLoading = false
          setExportButtonsDisabled(false)
          body.innerHTML = `<div class="error-state">
            <div class="empty-icon">${iconHtml('alert-triangle')}</div>
            <h3>Fehler beim Laden</h3>
            <p>${htmlEscape(e.message || 'Unbekannter Fehler')}</p>
            <button class="btn primary" id="btn-retry">Erneut versuchen</button>
          </div>`
          body.querySelector('#btn-retry')?.addEventListener('click', render)
          return
        }

        currentItems = items
        isLoading = false
        setExportButtonsDisabled(false)

        if (!items.length) {
          body.innerHTML = `<div class="empty-state">
            <div class="empty-icon">${iconHtml('hash')}</div>
            <h3>Noch keine Hashtags</h3>
            <p>Sobald User Posts mit Hashtags veröffentlichen, erscheinen sie hier als Cloud.</p>
          </div>`
          return
        }

        const total = items.reduce((s, t) => s + (t.usage_count || 0), 0)
        const last24 = items.reduce((s, t) => s + (t.posts_24h || 0), 0)
        const rising = items.filter(t => t.trend === 'up').length
        const uniqueTags = items.length

        body.innerHTML = `
          <div class="hero-row">
            ${statHero({ label: 'Hashtags gesamt', value: '<span id="hero-tags">0</span>', icon: 'hash', accent: '#7c5cff' })}
            ${statHero({ label: 'Verwendungen', value: '<span id="hero-uses">0</span>', icon: 'activity', accent: '#22c1c3' })}
            ${statHero({ label: 'Posts (24h)', value: '<span id="hero-24">0</span>', icon: 'clock', accent: '#fdbb2d' })}
            ${statHero({ label: 'Steigend', value: '<span id="hero-up">0</span>', icon: 'trending-up', accent: '#3ee8a3' })}
          </div>

          <div class="grid-2">
            <div class="glass-card">
              <div class="card-header"><h3>Hashtag-Cloud</h3><p class="card-sub">Größe = Nutzungsanzahl · Klick = Posts anzeigen</p></div>
              <div id="cloud">${bubbleCloud(items)}</div>
            </div>
            <div class="glass-card">
              <div class="card-header"><h3>Top 10 Verteilung</h3><p class="card-sub">Anteil an Top-Verwendungen</p></div>
              <div id="chart-donut" style="height:280px"></div>
            </div>
          </div>

          <div class="grid-2">
            <div class="glass-card">
              <div class="card-header"><h3>Top 15 nach Anzahl</h3><p class="card-sub">Posts insgesamt pro Tag</p></div>
              <div id="chart-bar" style="height:300px"></div>
            </div>
            <div class="glass-card">
              <div class="card-header"><h3>Top-Tags nach 24h-Posts</h3><p class="card-sub">Neue Posts mit Top-Tags in den letzten 24h</p></div>
              <div id="chart-area" style="height:300px"></div>
            </div>
          </div>

          <div class="glass-card">
            <div class="card-header"><h3>Ranking</h3><p class="card-sub">Sortiert nach Verwendungsanzahl · Zeile klicken für Drilldown</p></div>
            <div id="rank-list">${rankList(items)}</div>
          </div>
        `

        try { countUp(body.querySelector('#hero-tags'), uniqueTags) } catch (_) {}
        try { countUp(body.querySelector('#hero-uses'), total) } catch (_) {}
        try { countUp(body.querySelector('#hero-24'), last24) } catch (_) {}
        try { countUp(body.querySelector('#hero-up'), rising) } catch (_) {}

        const top10 = items.slice(0, 10)
        const top15 = items.slice(0, 15)

        try {
          makeDonutChart(body.querySelector('#chart-donut'), {
            labels: top10.map(t => '#' + t.tag),
            values: top10.map(t => t.usage_count),
            colors: PALETTE
          })
        } catch (_) {}

        try {
          makeBarChart(body.querySelector('#chart-bar'), {
            categories: top15.map(t => '#' + t.tag),
            series: [{ name: 'Verwendungen', data: top15.map(t => t.usage_count) }],
            horizontal: true,
            color: '#7c5cff'
          })
        } catch (_) {}

        try {
          makeAreaChart(body.querySelector('#chart-area'), {
            categories: top10.map(t => '#' + t.tag),
            series: [{ name: '24h Posts', data: top10.map(t => t.posts_24h || 0) }],
            color: '#3ee8a3'
          })
        } catch (_) {}

        body.querySelectorAll('.bubble').forEach(el => {
          el.addEventListener('click', () => {
            const tag = el.getAttribute('data-tag')
            if (tag) openTagDrawer(tag)
          })
        })

        body.querySelectorAll('.row-clickable').forEach(el => {
          el.addEventListener('click', () => {
            const tag = el.getAttribute('data-tag')
            if (tag) openTagDrawer(tag)
          })
        })
      }

      // Toolbar-Handler EINMAL binden — referenzieren currentItems
      const btnRefresh = container.querySelector('#btn-refresh')
      const btnPdf = container.querySelector('#btn-pdf')
      const btnCsv = container.querySelector('#btn-csv')

      if (btnRefresh) {
        btnRefresh.onclick = () => {
          if (!isLoading) {
            render()
            toast('Aktualisiert', 'info')
          }
        }
      }
      if (btnPdf) {
        btnPdf.onclick = () => {
          if (isLoading) return
          try {
            exportPanelAsPdf(container, 'trending-hashtags')
            toast('PDF wird erzeugt …', 'info')
          } catch (e) {
            toast('PDF-Export fehlgeschlagen: ' + (e.message || ''), 'error')
          }
        }
      }
      if (btnCsv) {
        btnCsv.onclick = () => {
          if (isLoading) return
          if (!currentItems.length) {
            toast('Keine Daten zum Exportieren', 'warning')
            return
          }
          try {
            exportCsv('trending-hashtags', currentItems.map((t, i) => ({
              rang: i + 1,
              tag: t.tag,
              verwendungen: t.usage_count,
              posts_24h: t.posts_24h || 0,
              posts_7d: t.posts_7d || 0,
              trend: t.trend || 'flat',
              zuletzt: t.last_used_at ? fmtDateTime(t.last_used_at) : ''
            })))
            toast('CSV exportiert', 'success')
          } catch (e) {
            toast('CSV-Export fehlgeschlagen: ' + (e.message || ''), 'error')
          }
        }
      }

      // Background-Loading: skeleton ist bereits sichtbar, jetzt Daten holen
      await render()
    } catch (e) {
      // Mount-Fehler — sichtbare Fehler-Box statt weißer Bildschirm
      container.innerHTML = `
        <div class="panel-shell">
          <div class="error-state" style="padding:32px">
            <div class="empty-icon">${iconHtml ? iconHtml('alert-triangle') : '⚠'}</div>
            <h3>Panel konnte nicht geladen werden</h3>
            <p>${htmlEscape ? htmlEscape(e.message || String(e)) : (e.message || String(e))}</p>
            <button class="btn primary" id="btn-mount-retry">Erneut versuchen</button>
          </div>
        </div>
      `
      container.querySelector('#btn-mount-retry')?.addEventListener('click', () => {
        this.mount(container)
      })
    }
  }
}
