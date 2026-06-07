// User-Timeline Component — extracted module
// Public API: renderUserTimeline({ sb, userId, container, onDetail })
//
// Aggregates chronologically (DESC):
//   - Signup-Event           (users.created_at)
//   - Profile-Updates        (users.updated_at)
//   - Posts                  (updates.created_at)         — last 30
//   - Comments               (comments.created_at)        — last 30
//   - Listening-Sessions     (listening_activity.created_at) — last 30
//   - Bug-Reports            (bug_reports.created_at)
//   - Admin-Actions          (admin_audit_log.created_at WHERE target_id = userId)
//
// Renders: Icon + Label + Timestamp + Click-Detail (calls onDetail(event)).
// Virtualization: only the first MAX_VISIBLE items are rendered into the DOM at once.
// Additional items are mounted as the user scrolls (IntersectionObserver-driven).

const STYLE_ID = 'user-timeline-styles'
const MAX_VISIBLE = 100
const FETCH_LIMIT = 30

const EVENT_META = {
  signup:    { icon: '🌱', label: 'Signup',          color: '#10B981' },
  profile:   { icon: '✏️', label: 'Profil-Update',   color: '#6366F1' },
  post:      { icon: '📝', label: 'Post',            color: '#3B82F6' },
  comment:   { icon: '💬', label: 'Kommentar',       color: '#8B5CF6' },
  listening: { icon: '🎧', label: 'Hör-Session',     color: '#EC4899' },
  bug:       { icon: '🐛', label: 'Bug-Report',      color: '#EF4444' },
  admin:     { icon: '🛡️', label: 'Admin-Aktion',    color: '#F59E0B' },
}

function injectStylesOnce() {
  if (document.getElementById(STYLE_ID)) return
  const css = `
    .utl-wrap { display: flex; flex-direction: column; gap: 0; max-height: 100%; overflow-y: auto; padding: 4px 0; }
    .utl-empty, .utl-loading, .utl-error {
      padding: 24px 16px; text-align: center;
      color: var(--text-dim, #6B7280); font-size: 14px;
    }
    .utl-error { color: #EF4444; }
    .utl-item {
      display: flex; align-items: flex-start; gap: 12px;
      padding: 12px 14px; border-bottom: 1px solid var(--border, #2A2A33);
      cursor: pointer; transition: background 0.12s ease;
      background: transparent;
    }
    .utl-item:hover { background: var(--surface-elev, rgba(255,255,255,0.03)); }
    .utl-item:last-child { border-bottom: none; }
    .utl-icon {
      flex: 0 0 32px; width: 32px; height: 32px; border-radius: 8px;
      display: flex; align-items: center; justify-content: center;
      font-size: 16px; line-height: 1;
      background: var(--surface-elev, #1C1C25);
    }
    .utl-body { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .utl-label { color: var(--text, #E5E7EB); font-size: 13px; font-weight: 600; }
    .utl-detail {
      color: var(--text-dim, #9CA3AF); font-size: 12px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .utl-time {
      flex: 0 0 auto; color: var(--text-dim, #6B7280);
      font-size: 11px; white-space: nowrap; padding-top: 2px;
    }
    .utl-sentinel { height: 1px; }
  `
  const tag = document.createElement('style')
  tag.id = STYLE_ID
  tag.textContent = css
  document.head.appendChild(tag)
}

function fmtTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const now = Date.now()
  const diff = (now - d.getTime()) / 1000
  if (diff < 60) return 'jetzt'
  if (diff < 3600) return `vor ${Math.floor(diff / 60)} Min`
  if (diff < 86400) return `vor ${Math.floor(diff / 3600)} Std`
  if (diff < 86400 * 7) return `vor ${Math.floor(diff / 86400)} Tg`
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

function safeStr(v, max = 80) {
  if (v == null) return ''
  const s = String(v).replace(/\s+/g, ' ').trim()
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

async function fetchAll(sb, userId) {
  const tasks = [
    sb.from('users').select('id, created_at, updated_at, email, display_name').eq('id', userId).maybeSingle(),
    sb.from('updates').select('id, created_at, content, podcast_id').eq('user_id', userId).order('created_at', { ascending: false }).limit(FETCH_LIMIT),
    sb.from('comments').select('id, created_at, content, update_id').eq('user_id', userId).order('created_at', { ascending: false }).limit(FETCH_LIMIT),
    sb.from('listening_activity').select('id, created_at, podcast_title, episode_title, listened_ms').eq('user_id', userId).order('created_at', { ascending: false }).limit(FETCH_LIMIT),
    sb.from('bug_reports').select('id, created_at, title, description, severity').eq('user_id', userId).order('created_at', { ascending: false }),
    sb.from('admin_audit_log').select('id, created_at, action, actor_id, payload').eq('target_id', userId).order('created_at', { ascending: false }),
  ]

  const results = await Promise.allSettled(tasks)
  const events = []

  // users row → signup + profile-update
  const usersRes = results[0]
  if (usersRes.status === 'fulfilled' && usersRes.value.data) {
    const u = usersRes.value.data
    if (u.created_at) {
      events.push({
        type: 'signup', ts: u.created_at,
        detail: u.email || u.display_name || u.id,
        raw: u,
      })
    }
    if (u.updated_at && u.updated_at !== u.created_at) {
      events.push({
        type: 'profile', ts: u.updated_at,
        detail: 'Profil zuletzt geändert',
        raw: u,
      })
    }
  }

  // updates / posts
  const postsRes = results[1]
  if (postsRes.status === 'fulfilled' && Array.isArray(postsRes.value.data)) {
    for (const p of postsRes.value.data) {
      events.push({
        type: 'post', ts: p.created_at,
        detail: safeStr(p.content) || `Post #${p.id}`,
        raw: p,
      })
    }
  }

  // comments
  const commentsRes = results[2]
  if (commentsRes.status === 'fulfilled' && Array.isArray(commentsRes.value.data)) {
    for (const c of commentsRes.value.data) {
      events.push({
        type: 'comment', ts: c.created_at,
        detail: safeStr(c.content) || `Kommentar #${c.id}`,
        raw: c,
      })
    }
  }

  // listening_activity
  const listenRes = results[3]
  if (listenRes.status === 'fulfilled' && Array.isArray(listenRes.value.data)) {
    for (const l of listenRes.value.data) {
      const mins = l.listened_ms ? Math.round(l.listened_ms / 60000) : 0
      const title = l.episode_title || l.podcast_title || 'Episode'
      events.push({
        type: 'listening', ts: l.created_at,
        detail: `${safeStr(title, 60)}${mins ? ` · ${mins} Min` : ''}`,
        raw: l,
      })
    }
  }

  // bug_reports
  const bugRes = results[4]
  if (bugRes.status === 'fulfilled' && Array.isArray(bugRes.value.data)) {
    for (const b of bugRes.value.data) {
      events.push({
        type: 'bug', ts: b.created_at,
        detail: safeStr(b.title || b.description) || `Bug #${b.id}`,
        raw: b,
      })
    }
  }

  // admin_audit_log
  const adminRes = results[5]
  if (adminRes.status === 'fulfilled' && Array.isArray(adminRes.value.data)) {
    for (const a of adminRes.value.data) {
      events.push({
        type: 'admin', ts: a.created_at,
        detail: safeStr(a.action) || 'Admin-Aktion',
        raw: a,
      })
    }
  }

  // Sort DESC by ts
  events.sort((a, b) => {
    const ta = a.ts ? new Date(a.ts).getTime() : 0
    const tb = b.ts ? new Date(b.ts).getTime() : 0
    return tb - ta
  })

  return events
}

function renderItem(ev, onDetail) {
  const meta = EVENT_META[ev.type] || { icon: '•', label: ev.type, color: '#9CA3AF' }
  const row = document.createElement('div')
  row.className = 'utl-item'
  row.setAttribute('role', 'button')
  row.setAttribute('tabindex', '0')

  const ic = document.createElement('div')
  ic.className = 'utl-icon'
  ic.style.color = meta.color
  ic.textContent = meta.icon

  const body = document.createElement('div')
  body.className = 'utl-body'
  const label = document.createElement('div')
  label.className = 'utl-label'
  label.textContent = meta.label
  const detail = document.createElement('div')
  detail.className = 'utl-detail'
  detail.textContent = ev.detail || ''
  body.appendChild(label)
  if (ev.detail) body.appendChild(detail)

  const time = document.createElement('div')
  time.className = 'utl-time'
  time.textContent = fmtTime(ev.ts)
  time.title = ev.ts || ''

  row.appendChild(ic)
  row.appendChild(body)
  row.appendChild(time)

  const fire = () => { if (typeof onDetail === 'function') onDetail(ev) }
  row.addEventListener('click', fire)
  row.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fire() }
  })

  return row
}

/**
 * Render the timeline into `container`.
 * @param {Object} opts
 * @param {Object} opts.sb        Supabase client
 * @param {string} opts.userId    Target user id
 * @param {HTMLElement} opts.container  Mount point
 * @param {Function} [opts.onDetail]    Click handler (event)=>void
 * @returns {Promise<{events: Array, destroy: Function}>}
 */
export async function renderUserTimeline({ sb, userId, container, onDetail }) {
  injectStylesOnce()
  if (!container) throw new Error('renderUserTimeline: container is required')
  if (!sb)        throw new Error('renderUserTimeline: sb is required')
  if (!userId)    throw new Error('renderUserTimeline: userId is required')

  container.innerHTML = ''
  const wrap = document.createElement('div')
  wrap.className = 'utl-wrap'
  container.appendChild(wrap)

  const loading = document.createElement('div')
  loading.className = 'utl-loading'
  loading.textContent = 'Lade Timeline …'
  wrap.appendChild(loading)

  let events = []
  try {
    events = await fetchAll(sb, userId)
  } catch (err) {
    loading.remove()
    const e = document.createElement('div')
    e.className = 'utl-error'
    e.textContent = `Fehler: ${err && err.message ? err.message : String(err)}`
    wrap.appendChild(e)
    return { events: [], destroy: () => { container.innerHTML = '' } }
  }

  loading.remove()

  if (!events.length) {
    const empty = document.createElement('div')
    empty.className = 'utl-empty'
    empty.textContent = 'Keine Aktivitäten gefunden.'
    wrap.appendChild(empty)
    return { events, destroy: () => { container.innerHTML = '' } }
  }

  // Virtualization: mount in batches of MAX_VISIBLE
  let cursor = 0
  let sentinel = null
  let io = null

  const mountBatch = () => {
    const end = Math.min(cursor + MAX_VISIBLE, events.length)
    const frag = document.createDocumentFragment()
    for (let i = cursor; i < end; i++) {
      frag.appendChild(renderItem(events[i], onDetail))
    }
    if (sentinel && sentinel.parentNode) sentinel.parentNode.removeChild(sentinel)
    wrap.appendChild(frag)
    cursor = end
    if (cursor < events.length) {
      sentinel = document.createElement('div')
      sentinel.className = 'utl-sentinel'
      wrap.appendChild(sentinel)
      if (io) io.observe(sentinel)
    } else {
      sentinel = null
    }
  }

  if ('IntersectionObserver' in window) {
    io = new IntersectionObserver((entries) => {
      for (const ent of entries) {
        if (ent.isIntersecting) { mountBatch(); break }
      }
    }, { root: wrap, rootMargin: '200px' })
  }

  mountBatch()

  return {
    events,
    destroy: () => {
      if (io) { try { io.disconnect() } catch (_) {} }
      container.innerHTML = ''
    },
  }
}

export default { renderUserTimeline }
