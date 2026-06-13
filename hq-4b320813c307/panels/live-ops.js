// LIVE-OPS-FEED — der Puls der App in Echtzeit.
// Chronologischer Stream aller App-Events: neue Posts (updates), Kommentare,
// Likes, Follows, Signups (users) und listening_activity. Neue Events erscheinen
// oben mit dezenter Highlight-Animation.
//
// Schema-Wahrheit (12.6. per REST geprobt, NICHT geraten):
//   updates(id, user_id, content, created_at)                      Akteur = user_id
//   comments(id, user_id, update_id, content, created_at)          Akteur = user_id
//   likes(id, user_id, update_id, created_at)                      Akteur = user_id
//   follows(id, follower_id, following_id, created_at)             Akteur = follower_id
//   users(id, username, full_name, avatar_url, is_verified, created_at)  Akteur = id selbst
//   listening_activity(id, listener_id, podcast_title, episode_title, listened_ms, created_at)
//                                                                  Akteur = listener_id (NICHT user_id!)
//
// Realtime-Publication (aus expo/supabase/migrations verifiziert):
//   IN publication  → echte postgres_changes-Subscription:
//     updates, comments, likes, follows, listening_activity
//   NICHT in publication → 30s-Polling-Fallback statt toter Subscription:
//     users
//
// Channel-Name pro Mount einzigartig (Lesson aus CommunityListeningCard):
//   `${base}:${Date.now()}:${random}` — statische Namen kollidieren bei Remount.

import { sb } from '/lib/supabase.js?v=20260610q'
import { toast, fmtRelativeTime, htmlEscape } from '/lib/ui.js?v=20260610q'
import { exportCsv } from '/lib/export.js?v=20260610q'
import { fadeIn } from '/lib/animations.js?v=20260610q'

const MAX_ITEMS = 100
const INITIAL_PER_TABLE = 15
const POLL_MS = 30000

// ---------- EVENT-TYPEN ----------
// realtime: true  → in supabase_realtime publication → postgres_changes
// realtime: false → 30s-Polling-Fallback (users ist NICHT in der publication)
const EVENT_TYPES = {
  post: {
    table: 'updates',
    label: 'Beitrag',
    icon: '📝',
    color: '#F59E0B',
    actorCol: 'user_id',
    realtime: true,
    select: 'id, user_id, content, created_at',
    detail: (r) => snippet(r.content, 90)
  },
  comment: {
    table: 'comments',
    label: 'Kommentar',
    icon: '💬',
    color: '#60A5FA',
    actorCol: 'user_id',
    realtime: true,
    select: 'id, user_id, update_id, content, created_at',
    detail: (r) => snippet(r.content, 90)
  },
  like: {
    table: 'likes',
    label: 'Like',
    icon: '❤️',
    color: '#F472B6',
    actorCol: 'user_id',
    realtime: true,
    select: 'id, user_id, update_id, created_at',
    detail: () => 'hat einen Beitrag geliked'
  },
  follow: {
    table: 'follows',
    label: 'Follow',
    icon: '👤',
    color: '#A78BFA',
    actorCol: 'follower_id',
    realtime: true,
    select: 'id, follower_id, following_id, created_at',
    detail: (r) => 'folgt jetzt einem Profil',
    // follows hat 2 User-Refs — beide auflösen für Detail-Text
    targetCol: 'following_id'
  },
  signup: {
    table: 'users',
    label: 'Signup',
    icon: '✨',
    color: '#34D399',
    actorCol: 'id',
    realtime: false, // users NICHT in supabase_realtime → Polling
    select: 'id, username, full_name, avatar_url, is_verified, created_at',
    detail: () => 'ist neu dabei'
  },
  listen: {
    table: 'listening_activity',
    label: 'Hör-Event',
    icon: '🎧',
    color: '#22D3EE',
    actorCol: 'listener_id', // NICHT user_id!
    realtime: true,
    select: 'id, listener_id, podcast_title, episode_title, listened_ms, created_at',
    detail: (r) => {
      const ep = r.episode_title || r.podcast_title || 'Episode'
      return 'hört: ' + snippet(ep, 70)
    }
  }
}

const TYPE_KEYS = Object.keys(EVENT_TYPES)

// ---------- STATE ----------
const state = {
  items: [],            // [{ key, type, actorId, created_at, detail, raw }]
  seen: new Set(),      // dedup über `${type}:${id}`
  filter: 'all',        // 'all' | <typeKey>
  paused: false,
  userCache: new Map(), // userId -> { username, full_name, avatar_url, is_verified }
  channels: [],         // realtime channels (zum unsubscribe)
  pollHandle: null,     // setInterval-Handle für users-Polling
  pollSince: null       // ISO-Timestamp ab dem Polling neue Signups holt
}

let panelRoot = null

// ---------- HELPERS ----------

function snippet(text, n = 90) {
  if (!text) return ''
  const t = String(text).replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n) + '…' : t
}

function itemKey(type, id) {
  return type + ':' + id
}

// Eindeutiger Channel-Name pro Mount (Lesson: statische Namen kollidieren bei Remount)
function uniqueChannelName(base) {
  return `${base}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`
}

// User-Infos für eine Menge IDs nachladen (Zweitquery), Cache-aware.
async function resolveUsers(ids) {
  const missing = [...new Set(ids)].filter(id => id && !state.userCache.has(id))
  if (!missing.length) return
  try {
    const { data, error } = await sb
      .from('users')
      .select('id, username, full_name, avatar_url, is_verified')
      .in('id', missing)
    if (error) throw error
    for (const u of (data || [])) {
      state.userCache.set(u.id, {
        username: u.username || null,
        full_name: u.full_name || null,
        avatar_url: u.avatar_url || null,
        is_verified: !!u.is_verified
      })
    }
  } catch (_) {
    // Stumm: fehlende User werden als "Unbekannt" gerendert, kein Hard-Fail.
  }
}

function actorLabel(actorId) {
  const u = state.userCache.get(actorId)
  if (!u) return 'Unbekannt'
  return u.full_name || u.username || 'Unbekannt'
}

function actorUsername(actorId) {
  const u = state.userCache.get(actorId)
  return u?.username || null
}

function actorAvatar(actorId) {
  const u = state.userCache.get(actorId)
  return u?.avatar_url || null
}

function actorVerified(actorId) {
  return !!state.userCache.get(actorId)?.is_verified
}

// Roh-Row einer Tabelle in ein normalisiertes Stream-Item übersetzen.
function toItem(type, raw) {
  const def = EVENT_TYPES[type]
  const actorId = raw[def.actorCol] || null
  return {
    key: itemKey(type, raw.id),
    type,
    actorId,
    created_at: raw.created_at,
    detail: def.detail ? def.detail(raw) : '',
    raw
  }
}

// ---------- INITIAL FETCH ----------

async function fetchInitial() {
  const results = await Promise.all(TYPE_KEYS.map(async (type) => {
    const def = EVENT_TYPES[type]
    try {
      const { data, error } = await sb
        .from(def.table)
        .select(def.select)
        .order('created_at', { ascending: false })
        .limit(INITIAL_PER_TABLE)
      if (error) throw error
      return (data || []).map(r => toItem(type, r))
    } catch (_) {
      return []
    }
  }))

  const merged = results.flat()
  // dedup + Akteure auflösen
  const actorIds = merged.map(it => it.actorId).filter(Boolean)
  await resolveUsers(actorIds)

  // chronologisch sortiert (neu oben), gekappt
  merged.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  state.items = merged.slice(0, MAX_ITEMS)
  state.seen = new Set(state.items.map(it => it.key))

  // Polling-Fenster ab jetzt — verhindert Doppel-Insert der bereits geladenen Signups
  state.pollSince = new Date().toISOString()
}

// ---------- LIVE PREPEND ----------

// Neues Item vorne einfügen (mit Dedup + Cap), danach DOM-Prepend mit Highlight.
async function prependItem(type, raw) {
  if (state.paused) return
  if (!raw || raw.id == null) return
  const key = itemKey(type, raw.id)
  if (state.seen.has(key)) return

  const item = toItem(type, raw)
  // Akteur ggf. nachladen, bevor wir rendern
  if (item.actorId && !state.userCache.has(item.actorId)) {
    await resolveUsers([item.actorId])
  }

  state.seen.add(key)
  state.items.unshift(item)
  // Cap: ältestes Item droppen
  if (state.items.length > MAX_ITEMS) {
    const dropped = state.items.pop()
    if (dropped) state.seen.delete(dropped.key)
  }

  renderNewItem(item)
}

// ---------- RENDER ----------

function rowHtml(item) {
  const def = EVENT_TYPES[item.type]
  const name = actorLabel(item.actorId)
  const uname = actorUsername(item.actorId)
  const verified = actorVerified(item.actorId)
    ? ' <span class="lo-verified" title="Verifiziert">✓</span>'
    : ''
  const av = actorAvatar(item.actorId)
  const avatar = av
    ? `<img class="lo-avatar" loading="lazy" src="${htmlEscape(av)}" alt="" />`
    : `<div class="lo-avatar lo-avatar--ph" style="background:${def.color}22;color:${def.color};">${htmlEscape((name || '?').slice(0, 1).toUpperCase())}</div>`
  const sub = uname ? `@${htmlEscape(uname)}` : '—'

  return `
    <div class="lo-row" data-type="${item.type}" data-key="${htmlEscape(item.key)}">
      <div class="lo-ico" style="background:${def.color}1f;color:${def.color};" title="${htmlEscape(def.label)}">${def.icon}</div>
      ${avatar}
      <div class="lo-main">
        <div class="lo-line1">
          <span class="lo-actor">${htmlEscape(name)}${verified}</span>
          <span class="lo-chip chip" style="background:${def.color}1f;color:${def.color};">${htmlEscape(def.label)}</span>
        </div>
        <div class="lo-line2">${htmlEscape(item.detail || '')}</div>
        <div class="lo-line3 text-muted">${sub} · ${htmlEscape(fmtRelativeTime(item.created_at))}</div>
      </div>
    </div>`
}

function visibleItems() {
  if (state.filter === 'all') return state.items
  return state.items.filter(it => it.type === state.filter)
}

function renderList() {
  if (!panelRoot) return
  const list = panelRoot.querySelector('#lo-list')
  const empty = panelRoot.querySelector('#lo-empty')
  if (!list || !empty) return

  const items = visibleItems()
  if (!items.length) {
    list.innerHTML = ''
    empty.style.display = ''
    empty.innerHTML = `
      <div class="empty-state glass-card">
        <div class="empty-state__icon">📡</div>
        <div class="empty-state__title">Noch keine Events</div>
        <div class="empty-state__text">Sobald in der App etwas passiert, erscheint es hier live.</div>
      </div>`
    return
  }
  empty.style.display = 'none'
  list.innerHTML = items.map(rowHtml).join('')
  updateCount()
}

// Einzelnes neues Item live oben einfügen (nur wenn es zum Filter passt).
function renderNewItem(item) {
  if (!panelRoot) return
  if (state.filter !== 'all' && state.filter !== item.type) {
    updateCount()
    return
  }
  const list = panelRoot.querySelector('#lo-list')
  const empty = panelRoot.querySelector('#lo-empty')
  if (!list) return
  if (empty) empty.style.display = 'none'

  const tmp = document.createElement('div')
  tmp.innerHTML = rowHtml(item).trim()
  const node = tmp.firstElementChild
  if (!node) return
  node.classList.add('lo-row--new')
  list.insertBefore(node, list.firstChild)

  // Highlight-Animation entfernen, sobald durch
  setTimeout(() => node.classList.remove('lo-row--new'), 1600)

  // DOM auf MAX_ITEMS halten
  while (list.children.length > MAX_ITEMS) {
    list.removeChild(list.lastElementChild)
  }
  updateCount()
}

function updateCount() {
  if (!panelRoot) return
  const el = panelRoot.querySelector('#lo-count')
  if (el) el.textContent = String(visibleItems().length)
}

// ---------- REALTIME + POLLING ----------

function subscribeRealtime() {
  for (const type of TYPE_KEYS) {
    const def = EVENT_TYPES[type]
    if (!def.realtime) continue // users → Polling, keine Subscription
    try {
      const ch = sb
        .channel(uniqueChannelName(`crm-live-ops-${def.table}`))
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: def.table },
          (payload) => {
            try { prependItem(type, payload.new || payload.record || {}) } catch (_) {}
          }
        )
        .subscribe()
      state.channels.push(ch)
    } catch (_) {
      // Subscription-Aufbau fehlgeschlagen — kein Hard-Fail, andere Tabellen laufen weiter.
    }
  }
}

// users ist NICHT in der Realtime-Publication → 30s-Polling auf neue Signups.
function startSignupPolling() {
  const def = EVENT_TYPES.signup
  const poll = async () => {
    if (state.paused) return
    try {
      let q = sb
        .from(def.table)
        .select(def.select)
        .order('created_at', { ascending: false })
        .limit(INITIAL_PER_TABLE)
      if (state.pollSince) q = q.gt('created_at', state.pollSince)
      const { data, error } = await q
      if (error) throw error
      const rows = data || []
      if (rows.length) {
        // Polling-Fenster vorrücken
        state.pollSince = rows[0].created_at
        // älteste zuerst einfügen, damit Reihenfolge oben stimmt
        for (const r of rows.slice().reverse()) {
          await prependItem('signup', r)
        }
      }
    } catch (_) {
      // Stumm — nächster Poll-Tick versucht es erneut.
    }
  }
  state.pollHandle = setInterval(poll, POLL_MS)
}

function teardownLive() {
  for (const ch of state.channels) {
    try { sb.removeChannel(ch) } catch (_) {}
  }
  state.channels = []
  if (state.pollHandle) {
    clearInterval(state.pollHandle)
    state.pollHandle = null
  }
}

// ---------- TOOLBAR ----------

function setPaused(paused) {
  state.paused = paused
  if (!panelRoot) return
  const btn = panelRoot.querySelector('#lo-pause')
  if (btn) {
    btn.classList.toggle('is-active', paused)
    btn.innerHTML = paused ? '▶️ Fortsetzen' : '⏸ Pause'
  }
  const dot = panelRoot.querySelector('#lo-livedot')
  if (dot) dot.classList.toggle('lo-livedot--off', paused)
}

function exportRows() {
  const rows = visibleItems().map(it => ({
    typ: EVENT_TYPES[it.type]?.label || it.type,
    akteur: actorLabel(it.actorId),
    username: actorUsername(it.actorId) || '',
    detail: it.detail || '',
    zeit: it.created_at
  }))
  const columns = [
    { key: 'typ', label: 'Typ' },
    { key: 'akteur', label: 'Akteur' },
    { key: 'username', label: 'Username' },
    { key: 'detail', label: 'Detail' },
    { key: 'zeit', label: 'Zeit' }
  ]
  try {
    exportCsv(rows, columns, 'live-ops-feed.csv')
  } catch (e) {
    toast('CSV-Export fehlgeschlagen: ' + (e?.message || e), 'error')
  }
}

function wireToolbar() {
  if (!panelRoot) return
  panelRoot.querySelector('#lo-pause')?.addEventListener('click', () => setPaused(!state.paused))
  panelRoot.querySelector('#lo-csv')?.addEventListener('click', exportRows)

  panelRoot.querySelectorAll('.lo-filter').forEach(el => {
    el.addEventListener('click', () => {
      state.filter = el.dataset.filter
      panelRoot.querySelectorAll('.lo-filter').forEach(x => x.classList.toggle('is-active', x === el))
      renderList()
    })
  })
}

// ---------- STYLES (panel-scoped) ----------

function styles() {
  const chips = TYPE_KEYS.map(t => {
    const d = EVENT_TYPES[t]
    return `<button class="filter-pill lo-filter" data-filter="${t}">${d.icon} ${htmlEscape(d.label)}</button>`
  }).join('')
  return { chips }
}

function panelStyleTag() {
  return `<style>
    #panel-live-ops .lo-shell { display:flex; flex-direction:column; gap:14px; }
    #panel-live-ops .lo-head {
      display:flex; align-items:center; justify-content:space-between;
      gap:12px; flex-wrap:wrap; padding:14px 16px;
    }
    #panel-live-ops .lo-head__left { display:flex; flex-direction:column; gap:3px; }
    #panel-live-ops .lo-title { margin:0; font-size:18px; font-weight:700; display:flex; align-items:center; gap:8px; }
    #panel-live-ops .lo-sub { font-size:12px; color:var(--text-muted,#9CA3AF); }
    #panel-live-ops .lo-livedot {
      width:8px; height:8px; border-radius:50%;
      background:#22D3EE; box-shadow:0 0 10px #22D3EE;
      animation: loPulse 1.6s infinite ease-in-out;
    }
    #panel-live-ops .lo-livedot--off { background:#6B7280; box-shadow:none; animation:none; }
    @keyframes loPulse { 0%,100%{opacity:1} 50%{opacity:.3} }

    #panel-live-ops .lo-toolbar { display:flex; gap:8px; flex-wrap:wrap; }

    #panel-live-ops .lo-filters {
      display:flex; gap:8px; flex-wrap:wrap; align-items:center;
      padding:12px 16px;
    }
    #panel-live-ops .lo-count {
      margin-left:auto; font-size:12px; color:var(--text-muted,#9CA3AF);
      background:rgba(255,255,255,0.05); padding:3px 10px; border-radius:10px;
    }

    #panel-live-ops .lo-list { display:flex; flex-direction:column; gap:8px; }
    #panel-live-ops .lo-row {
      display:flex; align-items:flex-start; gap:12px;
      padding:12px 14px;
      background:rgba(255,255,255,0.03);
      border:1px solid rgba(255,255,255,0.06);
      border-radius:14px;
    }
    #panel-live-ops .lo-row--new {
      animation: loFlash 1.6s ease-out;
    }
    @keyframes loFlash {
      0%   { background:rgba(34,211,238,0.16); border-color:rgba(34,211,238,0.4); transform:translateY(-2px); }
      100% { background:rgba(255,255,255,0.03); border-color:rgba(255,255,255,0.06); transform:translateY(0); }
    }
    #panel-live-ops .lo-ico {
      width:36px; height:36px; border-radius:10px; flex-shrink:0;
      display:flex; align-items:center; justify-content:center; font-size:18px;
    }
    #panel-live-ops .lo-avatar {
      width:34px; height:34px; border-radius:50%; flex-shrink:0; object-fit:cover;
    }
    #panel-live-ops .lo-avatar--ph {
      display:flex; align-items:center; justify-content:center;
      font-weight:700; font-size:14px;
    }
    #panel-live-ops .lo-main { flex:1; min-width:0; }
    #panel-live-ops .lo-line1 { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
    #panel-live-ops .lo-actor { font-size:14px; font-weight:600; color:var(--text,#fff); }
    #panel-live-ops .lo-verified { color:#34D399; font-weight:700; }
    #panel-live-ops .lo-chip { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.4px; }
    #panel-live-ops .lo-line2 { font-size:13px; color:var(--text,#E5E7EB); margin-top:2px; word-break:break-word; }
    #panel-live-ops .lo-line3 { font-size:11px; margin-top:3px; }
    /* .text-muted ist global NICHT als Klasse definiert (nur als CSS-Var --text-muted).
       Panel-scoped definieren, damit keine undefinierte Klasse genutzt wird (CRM-Bug-Klasse). */
    #panel-live-ops .text-muted { color:var(--text-muted,#9CA3AF); }

    @media (max-width: 767px) {
      #panel-live-ops .lo-head { flex-direction:column; align-items:stretch; }
      #panel-live-ops .lo-filters { overflow-x:auto; flex-wrap:nowrap; }
      #panel-live-ops .lo-filter { flex-shrink:0; white-space:nowrap; }
    }
  </style>`
}

// ---------- PANEL ----------

export default {
  id: 'live-ops',
  title: 'Live-Ops',
  category: 'pulse',

  async mount(container) {
    try {
      panelRoot = container
      container.id = 'panel-live-ops'

      // State zurücksetzen (Panel kann remountet werden)
      state.items = []
      state.seen = new Set()
      state.filter = 'all'
      state.paused = false
      state.userCache = new Map()
      state.channels = []
      state.pollHandle = null
      state.pollSince = null

      const { chips } = styles()

      container.innerHTML = `${panelStyleTag()}
        <div class="lo-shell">
          <div class="lo-head glass-card">
            <div class="lo-head__left">
              <h2 class="lo-title"><span id="lo-livedot" class="lo-livedot" aria-hidden="true"></span> Live-Ops-Feed</h2>
              <div class="lo-sub">Echtzeit-Puls der App — Beiträge, Kommentare, Likes, Follows, Signups &amp; Hör-Events</div>
            </div>
            <div class="lo-toolbar">
              <button class="btn" id="lo-pause" title="Stream pausieren">⏸ Pause</button>
              <button class="btn" id="lo-csv" title="CSV exportieren">💾 CSV</button>
            </div>
          </div>

          <div class="lo-filters glass-card">
            <button class="filter-pill lo-filter is-active" data-filter="all">Alle</button>
            ${chips}
            <span class="lo-count" title="Sichtbare Events"><span id="lo-count">0</span> Events</span>
          </div>

          <div id="lo-list" class="lo-list"></div>
          <div id="lo-empty" style="display:none"></div>
        </div>`

      wireToolbar()

      // Initial-Befüllung
      const list = container.querySelector('#lo-list')
      if (list) list.innerHTML = `<div class="text-muted" style="padding:20px;text-align:center;">⏳ Lade Live-Stream…</div>`

      try {
        await fetchInitial()
        renderList()
      } catch (e) {
        if (list) {
          list.innerHTML = `
            <div class="empty-state glass-card">
              <div class="empty-state__icon">⚠️</div>
              <div class="empty-state__title">Stream konnte nicht geladen werden</div>
              <div class="empty-state__text">${htmlEscape(e?.message || String(e))}</div>
            </div>`
        }
      }

      // Realtime-Subscriptions (5 Tabellen) + Polling-Fallback (users)
      subscribeRealtime()
      startSignupPolling()

      try { fadeIn(container, 260) } catch (_) {}
    } catch (e) {
      container.innerHTML = `
        <div class="empty-state glass-card" style="padding:24px;margin:16px;">
          <div class="empty-state__icon">⚠️</div>
          <div class="empty-state__title">Panel konnte nicht geladen werden</div>
          <div class="empty-state__text">${htmlEscape(e?.message || String(e))}</div>
        </div>`
    }
  },

  unmount() {
    teardownLive()
    state.items = []
    state.seen = new Set()
    state.userCache = new Map()
    state.paused = false
    panelRoot = null
  }
}
