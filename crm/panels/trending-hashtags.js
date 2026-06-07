import { sb } from '/lib/supabase.js'
import { toast, modal, fmtNumber, fmtDateTime, fmtRelativeTime, htmlEscape, iconHtml } from '/lib/ui.js'
import { makeAreaChart, makeBarChart, makeDonutChart } from '/lib/charts.js'
import { exportPanelAsPdf, exportCsv } from '/lib/export.js'
import { countUp, fadeIn, skeletonLoader } from '/lib/animations.js'
import { drawer, glassCard, statHero } from '/lib/layout-extras.js'
import { showUserDetailModal } from '/lib/panel-actions.js'

const PALETTE = ['#7c5cff', '#22c1c3', '#fdbb2d', '#ff5e7e', '#3ee8a3', '#ffa057', '#5d9cff', '#c97bff']

async function fetchHashtags() {
  const { data, error } = await sb
    .from('hashtags')
    .select('tag, usage_count, posts_24h, posts_7d, last_used_at, trend')
    .order('usage_count', { ascending: false })
    .limit(80)

  if (!error && data && data.length) return data

  const { data: posts } = await sb
    .from('posts')
    .select('hashtags, created_at')
    .not('hashtags', 'is', null)
    .order('created_at', { ascending: false })
    .limit(2000)

  if (!posts) return []
  const now = Date.now()
  const map = new Map()
  for (const p of posts) {
    const tags = Array.isArray(p.hashtags) ? p.hashtags : []
    for (const raw of tags) {
      const tag = String(raw || '').toLowerCase().replace(/^#/, '').trim()
      if (!tag) continue
      const t = map.get(tag) || { tag, usage_count: 0, posts_24h: 0, posts_7d: 0, last_used_at: null }
      t.usage_count++
      const ageH = (now - new Date(p.created_at).getTime()) / 3600000
      if (ageH <= 24) t.posts_24h++
      if (ageH <= 168) t.posts_7d++
      if (!t.last_used_at || new Date(p.created_at) > new Date(t.last_used_at)) t.last_used_at = p.created_at
      map.set(tag, t)
    }
  }
  const arr = Array.from(map.values()).map(t => {
    const prev = Math.max(1, t.posts_7d - t.posts_24h)
    const ratio = t.posts_24h / prev
    t.trend = ratio > 1.2 ? 'up' : ratio < 0.7 ? 'down' : 'flat'
    return t
  })
  arr.sort((a, b) => b.usage_count - a.usage_count)
  return arr.slice(0, 60)
}

async function fetchPostsForTag(tag) {
  const { data, error } = await sb
    .from('posts')
    .select('id, content, user_id, created_at, like_count, comment_count, users(username, avatar_url)')
    .contains('hashtags', [tag])
    .order('created_at', { ascending: false })
    .limit(30)
  if (error) return []
  return data || []
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
  if (!items.length) return '<div class="empty-mini">Keine Daten</div>'
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
  const posts = await fetchPostsForTag(tag)
  const body = document.getElementById('tag-drawer-body')
  if (!body) return
  if (!posts.length) {
    body.innerHTML = `<div class="empty-state">
      <div class="empty-icon">${iconHtml('hash')}</div>
      <h3>Keine Posts</h3>
      <p>Für #${htmlEscape(tag)} wurden noch keine Posts gefunden.</p>
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
            <button class="user-chip" data-user="${p.user_id}">
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

    fadeIn(container)

    const body = container.querySelector('#body')

    const render = async () => {
      body.innerHTML = skeletonLoader({ rows: 8 })
      let items = []
      try {
        items = await fetchHashtags()
      } catch (e) {
        body.innerHTML = `<div class="error-state">
          <div class="empty-icon">${iconHtml('alert-triangle')}</div>
          <h3>Fehler beim Laden</h3>
          <p>${htmlEscape(e.message || 'Unbekannter Fehler')}</p>
          <button class="btn primary" id="btn-retry">Erneut versuchen</button>
        </div>`
        body.querySelector('#btn-retry')?.addEventListener('click', render)
        return
      }

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
          ${glassCard({
            title: 'Hashtag-Cloud',
            subtitle: 'Größe = Nutzungsanzahl · Klick = Posts anzeigen',
            content: `<div id="cloud">${bubbleCloud(items)}</div>`
          })}
          ${glassCard({
            title: 'Top 10 Verteilung',
            subtitle: 'Anteil an Top-Verwendungen',
            content: `<div id="chart-donut" style="height:280px"></div>`
          })}
        </div>

        <div class="grid-2">
          ${glassCard({
            title: 'Top 15 nach Anzahl',
            subtitle: 'Posts insgesamt pro Tag',
            content: `<div id="chart-bar" style="height:300px"></div>`
          })}
          ${glassCard({
            title: 'Aktivität letzte 24h',
            subtitle: 'Neue Posts mit Top-Tags',
            content: `<div id="chart-area" style="height:300px"></div>`
          })}
        </div>

        ${glassCard({
          title: 'Ranking',
          subtitle: 'Sortiert nach Verwendungsanzahl · Zeile klicken für Drilldown',
          content: `<div id="rank-list">${rankList(items)}</div>`
        })}
      `

      countUp(body.querySelector('#hero-tags'), uniqueTags)
      countUp(body.querySelector('#hero-uses'), total)
      countUp(body.querySelector('#hero-24'), last24)
      countUp(body.querySelector('#hero-up'), rising)

      const top10 = items.slice(0, 10)
      const top15 = items.slice(0, 15)

      try {
        makeDonutChart(body.querySelector('#chart-donut'), {
          labels: top10.map(t => '#' + t.tag),
          values: top10.map(t => t.usage_count),
          colors: PALETTE
        })
      } catch {}

      try {
        makeBarChart(body.querySelector('#chart-bar'), {
          categories: top15.map(t => '#' + t.tag),
          series: [{ name: 'Verwendungen', data: top15.map(t => t.usage_count) }],
          horizontal: true,
          color: '#7c5cff'
        })
      } catch {}

      try {
        makeAreaChart(body.querySelector('#chart-area'), {
          categories: top10.map(t => '#' + t.tag),
          series: [{ name: '24h Posts', data: top10.map(t => t.posts_24h || 0) }],
          color: '#3ee8a3'
        })
      } catch {}

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

      container.querySelector('#btn-csv').onclick = () => {
        exportCsv('trending-hashtags', items.map((t, i) => ({
          rang: i + 1,
          tag: t.tag,
          verwendungen: t.usage_count,
          posts_24h: t.posts_24h || 0,
          posts_7d: t.posts_7d || 0,
          trend: t.trend || 'flat',
          zuletzt: t.last_used_at ? fmtDateTime(t.last_used_at) : ''
        })))
        toast('CSV exportiert', 'success')
      }
    }

    container.querySelector('#btn-refresh').onclick = () => {
      render()
      toast('Aktualisiert', 'info')
    }
    container.querySelector('#btn-pdf').onclick = () => {
      exportPanelAsPdf(container, 'trending-hashtags')
      toast('PDF wird erzeugt …', 'info')
    }

    await render()
  }
}
