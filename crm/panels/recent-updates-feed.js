import { sb } from '/lib/supabase.js'
import { toast, modal, confirmDialog, fmtNumber, fmtRelativeTime, fmtDateTime, htmlEscape, iconHtml, debounce, spinnerHtml } from '/lib/ui.js'
import { makeAreaChart, makeDonutChart } from '/lib/charts.js'
import { exportPanelAsPdf, exportCsv } from '/lib/export.js'
import { countUp, fadeIn, skeletonLoader } from '/lib/animations.js'
import { drawer, statHero } from '/lib/layout-extras.js'
import { showUserDetailModal, deletePost } from '/lib/panel-actions.js'

const REFRESH_MS = 20000

const state = {
  posts: [],
  filtered: [],
  search: '',
  filter: 'all',
  autoRefresh: false,
  refreshHandle: null,
  loading: false
}

function snippet(text, n = 180) {
  if (!text) return ''
  const t = String(text).replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n) + '…' : t
}

function classifyPost(p) {
  if (p.poll_id || p.type === 'poll' || p.kind === 'poll') return 'poll'
  if ((p.content || '').length > 400 || p.type === 'longform') return 'longform'
  if (p.image_url || p.media_url) return 'with-image'
  return 'standard'
}

// 7.6.: Tabelle heißt `updates`, nicht `posts`. Voriger Agent hatte das
// als "missing" markiert — falsch. Hier echter Fetch gegen updates.
async function fetchData() {
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()
  const { data: posts, error } = await sb
    .from('updates')
    .select('id, user_id, content, image_url, media_url, type, kind, poll_id, likes_count, comments_count, created_at, users:user_id(id, username, full_name, is_verified)')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) throw error
  return (posts || []).map(p => ({ ...p, profiles: p.users || {} }))
}

function applyFilters() {
  const q = state.search.trim().toLowerCase()
  state.filtered = state.posts.filter(p => {
    const cat = classifyPost(p)
    if (state.filter === 'longform' && cat !== 'longform') return false
    if (state.filter === 'poll' && cat !== 'poll') return false
    if (state.filter === 'with-image' && cat !== 'with-image') return false
    if (!q) return true
    const hay = (p.content || '') + ' ' + (p.profiles?.username || '') + ' ' + (p.profiles?.display_name || '')
    return hay.toLowerCase().includes(q)
  })
}

function renderHeros(root) {
  const total = state.posts.length
  const totalLikes = state.posts.reduce((s, p) => s + (p.likes_count || 0), 0)
  const totalComments = state.posts.reduce((s, p) => s + (p.comments_count || 0), 0)
  const withImg = state.posts.filter(p => p.image_url || p.media_url).length

  const wrap = root.querySelector('#heros')
  if (!wrap) return
  wrap.innerHTML = `
    ${statHero({ label: 'Posts (7 Tage)', value: 0, dataValue: total, icon: '📝', accent: 'primary' })}
    ${statHero({ label: 'Likes gesamt', value: 0, dataValue: totalLikes, icon: '❤️', accent: 'pink' })}
    ${statHero({ label: 'Kommentare', value: 0, dataValue: totalComments, icon: '💬', accent: 'blue' })}
    ${statHero({ label: 'Mit Bild', value: 0, dataValue: withImg, icon: '🖼️', accent: 'amber' })}
  `
  wrap.querySelectorAll('[data-value]').forEach(el => {
    const v = parseInt(el.dataset.value, 10) || 0
    try { countUp(el, v, { duration: 900 }) } catch (_) { el.textContent = String(v) }
  })
}

function renderCharts(root) {
  const byDay = new Map()
  for (const p of state.posts) {
    const d = new Date(p.created_at)
    const key = d.toISOString().slice(0, 10)
    byDay.set(key, (byDay.get(key) || 0) + 1)
  }
  const days = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  const timeData = days.map(([k, v]) => ({ x: k, y: v }))

  const catMap = { longform: 0, poll: 0, 'with-image': 0, standard: 0 }
  for (const p of state.posts) catMap[classifyPost(p)]++
  const catData = [
    { label: 'Longform', value: catMap.longform },
    { label: 'Umfrage', value: catMap.poll },
    { label: 'Mit Bild', value: catMap['with-image'] },
    { label: 'Standard', value: catMap.standard }
  ]

  const ts = root.querySelector('#chart-timeseries')
  const dc = root.querySelector('#chart-donut')
  if (ts) {
    ts.innerHTML = ''
    try { makeAreaChart(ts, timeData, { height: 200, color: '#7c5cff', label: 'Posts/Tag' }) }
    catch (e) { ts.innerHTML = `<div class="text-muted">Chart konnte nicht gerendert werden.</div>` }
  }
  if (dc) {
    dc.innerHTML = ''
    try { makeDonutChart(dc, catData, { height: 200 }) }
    catch (e) { dc.innerHTML = `<div class="text-muted">Chart konnte nicht gerendert werden.</div>` }
  }
}

function postCardHtml(p) {
  const u = p.profiles || {}
  const avatar = u.avatar_url
    ? `<img src="${htmlEscape(u.avatar_url)}" alt="" class="post-avatar" />`
    : `<div class="post-avatar post-avatar--placeholder">${htmlEscape((u.display_name || u.username || '?').slice(0, 1).toUpperCase())}</div>`
  const verified = u.is_verified ? `<span class="badge badge--verified" title="Verifiziert">✓</span>` : ''
  const cat = classifyPost(p)
  const catBadge = {
    longform: '<span class="chip chip--violet">Longform</span>',
    poll: '<span class="chip chip--amber">Umfrage</span>',
    'with-image': '<span class="chip chip--blue">Bild</span>',
    standard: ''
  }[cat]
  const image = (p.image_url || p.media_url)
    ? `<div class="post-media"><img loading="lazy" src="${htmlEscape(p.image_url || p.media_url)}" alt="" /></div>`
    : ''
  return `
    <article class="post-card glass-card" data-id="${htmlEscape(p.id)}">
      <header class="post-card__head">
        <button class="post-user" data-action="open-user" data-uid="${htmlEscape(u.id || p.user_id || '')}">
          ${avatar}
          <div class="post-user__meta">
            <div class="post-user__name">${htmlEscape(u.display_name || u.username || 'Unbekannt')} ${verified}</div>
            <div class="post-user__sub">@${htmlEscape(u.username || '—')} · ${fmtRelativeTime(p.created_at)}</div>
          </div>
        </button>
        <div class="post-card__tags">${catBadge}</div>
      </header>
      <div class="post-card__body">
        <p class="post-content">${htmlEscape(snippet(p.content, 280))}</p>
        ${image}
      </div>
      <footer class="post-card__foot">
        <div class="post-metrics">
          <span title="Likes">❤️ ${fmtNumber(p.likes_count || 0)}</span>
          <span title="Kommentare">💬 ${fmtNumber(p.comments_count || 0)}</span>
        </div>
        <div class="post-actions">
          <button class="btn btn--ghost" data-action="view" title="Ansehen">${iconHtml('eye')} Ansehen</button>
          <button class="btn btn--ghost" data-action="edit" title="Bearbeiten">${iconHtml('edit')} Bearbeiten</button>
          <button class="btn btn--ghost btn--danger" data-action="delete" title="Löschen">${iconHtml('trash')} Löschen</button>
        </div>
      </footer>
    </article>
  `
}

function renderFeed(root) {
  const grid = root.querySelector('#feed-grid')
  const empty = root.querySelector('#feed-empty')
  if (!grid || !empty) return

  if (!state.filtered.length) {
    grid.innerHTML = ''
    empty.style.display = ''
    empty.innerHTML = `
      <div class="empty-state glass-card">
        <div class="empty-state__icon">📭</div>
        <div class="empty-state__title">Keine Posts gefunden</div>
        <div class="empty-state__text">Versuche einen anderen Suchbegriff oder Filter.</div>
        <button class="btn btn--primary" id="empty-reset">Filter zurücksetzen</button>
      </div>`
    empty.querySelector('#empty-reset')?.addEventListener('click', () => {
      state.search = ''
      state.filter = 'all'
      const si = root.querySelector('#search')
      if (si) si.value = ''
      root.querySelectorAll('.filter-pill').forEach(el => el.classList.toggle('is-active', el.dataset.filter === 'all'))
      applyFilters(); renderFeed(root)
    })
    return
  }
  empty.style.display = 'none'
  grid.innerHTML = state.filtered.slice(0, 60).map(postCardHtml).join('')
}

function openUserDrawer(userId) {
  if (!userId) return
  if (typeof showUserDetailModal === 'function') {
    try { showUserDetailModal(userId); return } catch (_) {}
  }
  // Tabelle 'profiles' existiert nicht im Schema — Empty-State anzeigen
  const d = drawer({ title: 'Benutzer-Details', width: 480 })
  d.body.innerHTML = `
    <div class="empty-state glass-card" style="padding:24px;">
      <div class="empty-state__icon">${iconHtml('alert')}</div>
      <div class="empty-state__title">Tabelle nicht verfügbar</div>
      <div class="empty-state__text">Daten kommen sobald die Tabelle <code>profiles</code> angelegt ist.</div>
    </div>`
}

function viewPost(post) {
  const m = modal({ title: 'Post anzeigen', width: 640 })
  const u = post.profiles || {}
  m.body.innerHTML = `
    <div class="post-view">
      <div class="post-view__head">
        <strong>${htmlEscape(u.display_name || u.username || '—')}</strong>
        <span class="text-muted">· ${fmtDateTime(post.created_at)}</span>
      </div>
      <div class="post-view__content">${htmlEscape(post.content || '')}</div>
      ${(post.image_url || post.media_url) ? `<img class="post-view__img" src="${htmlEscape(post.image_url || post.media_url)}" />` : ''}
      <div class="post-view__metrics">❤️ ${fmtNumber(post.likes_count || 0)} · 💬 ${fmtNumber(post.comments_count || 0)}</div>
    </div>`
}

function editPost(post) {
  const m = modal({ title: 'Post bearbeiten', width: 560 })
  m.body.innerHTML = `
    <div class="form">
      <label class="form__label">Inhalt</label>
      <textarea id="edit-content" class="form__textarea" rows="6">${htmlEscape(post.content || '')}</textarea>
      <div class="form__actions">
        <button class="btn" id="edit-cancel">Abbrechen</button>
        <button class="btn btn--primary" id="edit-save">Speichern</button>
      </div>
    </div>`
  m.body.querySelector('#edit-cancel').addEventListener('click', () => m.close())
  m.body.querySelector('#edit-save').addEventListener('click', async () => {
    const next = m.body.querySelector('#edit-content').value
    try {
      const { error } = await sb.from('updates').update({ content: next }).eq('id', post.id)
      if (error) throw error
      toast({ kind: 'success', text: 'Post aktualisiert.' })
      m.close()
      await reload()
    } catch (e) {
      toast({ kind: 'error', text: 'Fehler: ' + (e?.message || e) })
    }
  })
}

async function deletePostFlow(post) {
  const ok = await confirmDialog({
    title: 'Post löschen?',
    text: 'Diese Aktion kann nicht rückgängig gemacht werden.',
    danger: true,
    confirmText: 'Löschen'
  })
  if (!ok) return
  try {
    if (typeof deletePost === 'function') {
      await deletePost(post.id)
    } else {
      const { error } = await sb.from('updates').delete().eq('id', post.id)
      if (error) throw error
    }
    toast({ kind: 'success', text: 'Post gelöscht.' })
    state.posts = state.posts.filter(p => p.id !== post.id)
    applyFilters()
    if (panelRoot) {
      renderFeed(panelRoot)
      renderHeros(panelRoot)
      renderCharts(panelRoot)
    }
  } catch (e) {
    toast({ kind: 'error', text: 'Löschen fehlgeschlagen: ' + (e?.message || e) })
  }
}

let panelRoot = null

async function reload() {
  if (!panelRoot) return
  const body = panelRoot.querySelector('#body')
  try {
    state.loading = true
    state.posts = await fetchData()
    applyFilters()
    renderHeros(panelRoot)
    renderCharts(panelRoot)
    renderFeed(panelRoot)
  } catch (e) {
    if (body) {
      body.innerHTML = `
        <div class="error-state glass-card">
          <div class="error-state__icon">⚠️</div>
          <div class="error-state__title">Konnte Posts nicht laden</div>
          <div class="error-state__text">${htmlEscape(e?.message || String(e))}</div>
          <button class="btn btn--primary" id="retry">Erneut versuchen</button>
        </div>`
      body.querySelector('#retry')?.addEventListener('click', reload)
    } else {
      toast({ kind: 'error', text: 'Fehler: ' + (e?.message || e) })
    }
  } finally {
    state.loading = false
  }
}

function wireToolbar(root) {
  root.querySelector('#btn-refresh')?.addEventListener('click', () => reload())
  root.querySelector('#btn-pdf')?.addEventListener('click', () => {
    try { exportPanelAsPdf({ title: 'Aktuelle Posts', element: root }) }
    catch (e) { toast({ kind: 'error', text: 'PDF-Export fehlgeschlagen: ' + (e?.message || e) }) }
  })
  root.querySelector('#btn-csv')?.addEventListener('click', () => {
    try {
      const rows = state.filtered.map(p => ({
        id: p.id,
        user: p.profiles?.username || '',
        content: snippet(p.content, 240),
        type: classifyPost(p),
        likes: p.likes_count || 0,
        comments: p.comments_count || 0,
        created_at: p.created_at
      }))
      exportCsv('aktuelle-posts.csv', rows)
    } catch (e) {
      toast({ kind: 'error', text: 'CSV-Export fehlgeschlagen: ' + (e?.message || e) })
    }
  })
  const autoBtn = root.querySelector('#btn-auto')
  autoBtn?.addEventListener('click', () => {
    state.autoRefresh = !state.autoRefresh
    autoBtn.classList.toggle('is-active', state.autoRefresh)
    autoBtn.innerHTML = state.autoRefresh ? '⏸ Auto-Refresh AN' : '▶️ Auto-Refresh'
    if (state.autoRefresh) {
      state.refreshHandle = setInterval(reload, REFRESH_MS)
    } else if (state.refreshHandle) {
      clearInterval(state.refreshHandle); state.refreshHandle = null
    }
  })

  const search = root.querySelector('#search')
  search?.addEventListener('input', debounce(() => {
    state.search = search.value
    applyFilters(); renderFeed(root)
  }, 180))

  root.querySelectorAll('.filter-pill').forEach(el => {
    el.addEventListener('click', () => {
      state.filter = el.dataset.filter
      root.querySelectorAll('.filter-pill').forEach(x => x.classList.toggle('is-active', x === el))
      applyFilters(); renderFeed(root)
    })
  })

  root.querySelector('#feed-grid')?.addEventListener('click', (ev) => {
    const userBtn = ev.target.closest('[data-action="open-user"]')
    if (userBtn) {
      ev.preventDefault()
      openUserDrawer(userBtn.dataset.uid)
      return
    }
    const card = ev.target.closest('.post-card')
    if (!card) return
    const id = card.dataset.id
    const post = state.posts.find(p => String(p.id) === String(id))
    if (!post) return
    const actBtn = ev.target.closest('[data-action]')
    if (!actBtn) return
    const action = actBtn.dataset.action
    if (action === 'view') viewPost(post)
    else if (action === 'edit') editPost(post)
    else if (action === 'delete') deletePostFlow(post)
  })
}

export default {
  id: 'recent-updates-feed',
  title: 'Aktuelle Posts',
  category: 'content',

  async mount(container) {
    try {
      panelRoot = container
      container.id = 'panel-recent-updates'
      container.innerHTML = `
        <div class="panel-shell">
          <div class="panel-head glass-card">
            <div class="panel-head__left">
              <h2 class="panel-title">Aktuelle Posts</h2>
              <p class="panel-sub">Live-Feed der letzten 7 Tage · Suche, Filter und schnelle Aktionen</p>
            </div>
            <div class="toolbar">
              <button class="btn" id="btn-auto" title="Automatisch alle 20s aktualisieren">▶️ Auto-Refresh</button>
              <button class="btn" id="btn-refresh" title="Aktualisieren">🔄 Aktualisieren</button>
              <button class="btn" id="btn-pdf" title="PDF exportieren">📄 PDF</button>
              <button class="btn" id="btn-csv" title="CSV exportieren">💾 CSV</button>
            </div>
          </div>

          <div class="hero-grid" id="heros">
            ${skeletonLoader({ count: 4, height: 96, layout: 'grid' })}
          </div>

          <div class="chart-grid">
            <div class="glass-card chart-card">
              <div class="chart-card__head"><h3>Posts pro Tag</h3><span class="text-muted">letzte 7 Tage</span></div>
              <div id="chart-timeseries" class="chart-card__body">${skeletonLoader({ height: 200 })}</div>
            </div>
            <div class="glass-card chart-card">
              <div class="chart-card__head"><h3>Verteilung</h3><span class="text-muted">nach Typ</span></div>
              <div id="chart-donut" class="chart-card__body">${skeletonLoader({ height: 200 })}</div>
            </div>
          </div>

          <div class="filters glass-card">
            <div class="filters__search">
              <input id="search" type="search" placeholder="Suche nach Inhalt oder Nutzer…" class="input input--search" />
            </div>
            <div class="filters__pills">
              <button class="filter-pill is-active" data-filter="all">Alle</button>
              <button class="filter-pill" data-filter="longform">Longform</button>
              <button class="filter-pill" data-filter="poll">Umfragen</button>
              <button class="filter-pill" data-filter="with-image">Mit Bild</button>
            </div>
          </div>

          <div class="panel-body" id="body">
            <div id="feed-grid" class="feed-grid">
              ${skeletonLoader({ count: 6, height: 180, layout: 'grid' })}
            </div>
            <div id="feed-empty" style="display:none"></div>
          </div>
        </div>
      `

      wireToolbar(container)
      try { fadeIn(container, { duration: 280 }) } catch (_) {}
      reload().catch(e => {
        const body = container.querySelector('#body')
        if (body) {
          body.innerHTML = `
            <div class="error-state glass-card">
              <div class="error-state__icon">⚠️</div>
              <div class="error-state__title">Konnte Posts nicht laden</div>
              <div class="error-state__text">${htmlEscape(e?.message || String(e))}</div>
              <button class="btn btn--primary" id="retry">Erneut versuchen</button>
            </div>`
          body.querySelector('#retry')?.addEventListener('click', reload)
        }
      })
    } catch (e) {
      container.innerHTML = `
        <div class="error-state glass-card" style="padding:24px;margin:16px;">
          <div class="error-state__icon">⚠️</div>
          <div class="error-state__title">Panel konnte nicht geladen werden</div>
          <div class="error-state__text">${htmlEscape(e?.message || String(e))}</div>
        </div>`
    }
  },

  unmount() {
    if (state.refreshHandle) {
      clearInterval(state.refreshHandle)
      state.refreshHandle = null
    }
    state.autoRefresh = false
    panelRoot = null
  }
}
