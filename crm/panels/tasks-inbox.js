import { sb } from '/lib/supabase.js?v=20260608l'
import { toast, modal, fmtDateTime, htmlEscape, iconHtml, debounce } from '/lib/ui.js?v=20260608l'
import { drawer } from '/lib/layout-extras.js?v=20260608l'
import { fadeIn, skeletonLoader } from '/lib/animations.js?v=20260608l'

// ─── Constants ───────────────────────────────────────────────────────────────

const STATUS_COLS = [
  { key: 'open',        label: 'Meine offenen', icon: '📥', accent: '#ef4444' },
  { key: 'in_progress', label: 'In Arbeit',     icon: '🔧', accent: '#f59e0b' },
  { key: 'done',        label: 'Erledigt',      icon: '✅', accent: '#10b981' },
]

const REFRESH_MS = 60_000
const FETCH_LIMIT = 500

// ─── State ───────────────────────────────────────────────────────────────────

const state = {
  tasks: [],
  filter: 'alle',  // 'alle' | 'mine'
  meId: null,
  userIndex: new Map(), // id → {username, full_name}
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isOverdue(t) {
  if (!t.due_at || t.status === 'done') return false
  return new Date(t.due_at).getTime() < Date.now()
}

function initials(s) {
  if (!s) return '?'
  return s.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase() || '?'
}

function avatarHtml(uid, title) {
  if (!uid) return ''
  const u = state.userIndex.get(uid)
  const label = u?.full_name || u?.username || String(uid).slice(0, 6)
  return `<span class="ti-avatar" title="${htmlEscape(title || '')}: ${htmlEscape(label)}">${htmlEscape(initials(label))}</span>`
}

function userOptionsHtml(selectedId) {
  const opts = [...state.userIndex.entries()]
    .map(([id, u]) => {
      const lbl = u.full_name || u.username || String(id).slice(0, 8)
      return `<option value="${htmlEscape(id)}" ${selectedId === id ? 'selected' : ''}>${htmlEscape(lbl)}</option>`
    })
    .join('')
  return opts
}

// ─── DB / RPC ────────────────────────────────────────────────────────────────

async function fetchMe() {
  try {
    const { data } = await sb.auth.getUser()
    state.meId = data?.user?.id || null
  } catch (_) { state.meId = null }
}

async function fetchTasks() {
  // Try RPC first
  try {
    const { data, error } = await sb.rpc('admin_tasks_list')
    if (!error && Array.isArray(data)) return data
  } catch (_) { /* fall through */ }

  // Fallback: direct query
  const { data, error } = await sb
    .from('admin_tasks')
    .select('id, title, description, status, assigned_to, related_user, due_at, created_at, created_by, updated_at')
    .order('due_at', { ascending: true, nullsFirst: false })
    .limit(FETCH_LIMIT)
  if (error) throw error
  return data || []
}

async function loadUserIndex(tasks) {
  const ids = new Set()
  for (const t of tasks) {
    if (t.assigned_to) ids.add(t.assigned_to)
    if (t.related_user) ids.add(t.related_user)
    if (t.created_by) ids.add(t.created_by)
  }
  // Always include admin users for picker
  try {
    const { data: admins } = await sb
      .from('users')
      .select('id, username, full_name')
      .eq('is_app_admin', true)
      .limit(50)
    for (const u of (admins || [])) {
      state.userIndex.set(u.id, { username: u.username, full_name: u.full_name })
      ids.delete(u.id)
    }
  } catch (_) {}

  if (ids.size) {
    try {
      const { data } = await sb
        .from('users')
        .select('id, username, full_name')
        .in('id', [...ids])
      for (const u of (data || [])) {
        state.userIndex.set(u.id, { username: u.username, full_name: u.full_name })
      }
    } catch (_) {}
  }
}

async function updateTaskStatus(id, status) {
  const patch = { status, updated_at: new Date().toISOString() }
  const { error } = await sb.from('admin_tasks').update(patch).eq('id', id)
  if (error) throw error
  try { await sb.rpc('admin_log_action', { action: 'task_status', target_type: 'admin_tasks', target_id: String(id), meta: { status } }) } catch (_) {}
}

async function createTask(payload) {
  const row = {
    title: payload.title,
    description: payload.description || null,
    assigned_to: payload.assigned_to || null,
    related_user: payload.related_user || null,
    due_at: payload.due_at || null,
    status: 'open',
    created_by: state.meId,
  }
  const { data, error } = await sb.from('admin_tasks').insert(row).select().single()
  if (error) throw error
  try { await sb.rpc('admin_log_action', { action: 'task_create', target_type: 'admin_tasks', target_id: String(data?.id ?? ''), meta: { title: row.title } }) } catch (_) {}
  return data
}

// ─── Card HTML ───────────────────────────────────────────────────────────────

function nextStatus(s) {
  if (s === 'open') return 'in_progress'
  if (s === 'in_progress') return 'done'
  return null
}

function prevStatus(s) {
  if (s === 'in_progress') return 'open'
  if (s === 'done') return 'in_progress'
  return null
}

function cardHtml(t) {
  const overdue = isOverdue(t)
  const due = t.due_at ? `<span class="ti-due ${overdue ? 'is-overdue' : ''}" title="${fmtDateTime(t.due_at)}">⏰ ${fmtDateTime(t.due_at)}</span>` : ''
  const next = nextStatus(t.status)
  const prev = prevStatus(t.status)

  return `
    <article class="ti-card ${overdue ? 'overdue' : ''}" data-id="${htmlEscape(String(t.id))}">
      <div class="ti-card-head">
        <h4 class="ti-title">${htmlEscape(t.title || '(ohne Titel)')}</h4>
        <div class="ti-avatars">
          ${t.assigned_to ? avatarHtml(t.assigned_to, 'Zugewiesen') : ''}
          ${t.related_user ? `<span class="ti-rel">→</span>${avatarHtml(t.related_user, 'Bezug')}` : ''}
        </div>
      </div>
      ${t.description ? `<p class="ti-desc">${htmlEscape(t.description.slice(0, 130))}${t.description.length > 130 ? '…' : ''}</p>` : ''}
      <footer class="ti-foot">
        ${due}
        <div class="ti-actions">
          ${prev ? `<button class="ti-mini" data-act="prev" data-id="${htmlEscape(String(t.id))}" title="Zurück">←</button>` : ''}
          ${next ? `<button class="ti-mini ti-next" data-act="next" data-id="${htmlEscape(String(t.id))}" title="Weiter">→ ${nextLabel(next)}</button>` : ''}
        </div>
      </footer>
    </article>`
}

function nextLabel(s) {
  const c = STATUS_COLS.find(x => x.key === s)
  return c ? c.label : s
}

// ─── Column HTML ─────────────────────────────────────────────────────────────

function columnHtml(col, tasks) {
  const inCol = tasks.filter(t => t.status === col.key)
  return `
    <section class="ti-col" data-status="${col.key}">
      <header class="ti-col-head" style="--accent:${col.accent}">
        <span>${col.icon} ${col.label}</span>
        <span class="ti-col-badge">${inCol.length}</span>
      </header>
      <div class="ti-col-body">
        ${inCol.length
          ? inCol.map(cardHtml).join('')
          : `<div class="ti-empty">
              <div class="ti-empty-icon">${col.icon}</div>
              <div class="ti-empty-title">Keine Aufgaben in "${htmlEscape(col.label)}"</div>
              <div class="ti-empty-sub">${col.key === 'open' ? 'Alles erledigt — oder noch nichts angelegt.' : col.key === 'in_progress' ? 'Nichts in Bearbeitung.' : 'Noch keine Aufgaben abgeschlossen.'}</div>
              ${col.key === 'open' ? `<button class="ti-btn ti-btn-p ti-empty-cta" data-empty-new="1" style="margin-top:10px">＋ Aufgabe anlegen</button>` : ''}
            </div>`}
      </div>
    </section>`
}

// ─── New-Task Modal ──────────────────────────────────────────────────────────

function openNewTaskModal(onCreated) {
  const html = `
    <form id="ti-new-form" class="ti-form">
      <label class="ti-field">
        <span>Titel *</span>
        <input type="text" id="ti-f-title" required maxlength="200" />
      </label>
      <label class="ti-field">
        <span>Beschreibung</span>
        <textarea id="ti-f-desc" rows="3"></textarea>
      </label>
      <div class="ti-row">
        <label class="ti-field">
          <span>Zugewiesen an</span>
          <select id="ti-f-assignee">
            <option value="">— keine —</option>
            ${userOptionsHtml(state.meId)}
          </select>
        </label>
        <label class="ti-field">
          <span>Fällig am</span>
          <input type="datetime-local" id="ti-f-due" />
        </label>
      </div>
      <label class="ti-field">
        <span>Bezug User (optional)</span>
        <select id="ti-f-related">
          <option value="">— keiner —</option>
          ${userOptionsHtml(null)}
        </select>
      </label>
      <div class="ti-form-foot">
        <button type="button" class="ti-btn" data-act="cancel">Abbrechen</button>
        <button type="submit" class="ti-btn ti-btn-p">Erstellen</button>
      </div>
    </form>`

  const m = modal({ title: '➕ Neue Aufgabe', content: html })
  const close = typeof m === 'function' ? m : (m?.close ? () => m.close() : () => {})

  setTimeout(() => {
    const host = document.querySelector('.modal-content, .modal') || document
    const form = host.querySelector('#ti-new-form')
    host.querySelector('[data-act="cancel"]')?.addEventListener('click', () => close())
    form?.addEventListener('submit', async (e) => {
      e.preventDefault()
      const title = host.querySelector('#ti-f-title')?.value?.trim()
      if (!title) { toast('Titel fehlt', 'error'); return }
      const due = host.querySelector('#ti-f-due')?.value
      const payload = {
        title,
        description: host.querySelector('#ti-f-desc')?.value?.trim() || null,
        assigned_to: host.querySelector('#ti-f-assignee')?.value || null,
        related_user: host.querySelector('#ti-f-related')?.value || null,
        due_at: due ? new Date(due).toISOString() : null,
      }
      try {
        await createTask(payload)
        toast('Aufgabe erstellt', 'success')
        close()
        await onCreated()
      } catch (err) { toast('Fehler: ' + err.message, 'error') }
    })
  }, 120)
}

// ─── Filter pills ────────────────────────────────────────────────────────────

function filterBarHtml() {
  const f = state.filter
  return `
    <div class="ti-filter">
      <button class="ti-pill ${f === 'alle' ? 'on' : ''}" data-f="alle">Alle</button>
      <button class="ti-pill ${f === 'mine' ? 'on' : ''}" data-f="mine">Nur meine</button>
      <span class="ti-pill-spacer"></span>
      <span class="ti-live"><span class="ti-live-dot"></span>Live</span>
    </div>`
}

// ─── Styles ──────────────────────────────────────────────────────────────────

function injectStyles() {
  if (document.getElementById('ti-css')) return
  const s = document.createElement('style')
  s.id = 'ti-css'
  s.textContent = `
    .ti-shell{padding:20px;display:flex;flex-direction:column;gap:16px}
    .ti-head{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px}
    .ti-head h2{margin:0;font-size:22px;font-weight:700;letter-spacing:-.02em}
    .ti-sub{font-size:13px;color:var(--text-muted,rgba(255,255,255,.55));margin-top:2px}
    .ti-toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
    .ti-tb-btn{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);color:inherit;padding:8px 14px;border-radius:10px;cursor:pointer;font-size:13px;font-weight:500;transition:all .15s;display:inline-flex;align-items:center;gap:6px}
    .ti-tb-btn:hover{background:rgba(255,255,255,.1)}
    .ti-tb-new{background:linear-gradient(135deg,#6366f1,#8b5cf6);border-color:transparent;color:#fff}
    .ti-tb-new:hover{filter:brightness(1.1)}

    .ti-filter{display:flex;align-items:center;gap:8px;padding:10px 14px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:12px}
    .ti-pill{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:inherit;padding:5px 12px;border-radius:999px;font-size:12px;cursor:pointer;transition:all .15s}
    .ti-pill:hover{background:rgba(255,255,255,.1)}
    .ti-pill.on{background:rgba(99,102,241,.25);border-color:rgba(99,102,241,.6);color:#a5b4fc}
    .ti-pill-spacer{flex:1}
    .ti-live{display:inline-flex;align-items:center;gap:6px;font-size:11px;color:#22c55e;font-weight:600}
    .ti-live-dot{width:7px;height:7px;border-radius:50%;background:#22c55e;box-shadow:0 0 8px #22c55e;animation:ti-pulse 1.8s ease-in-out infinite}
    @keyframes ti-pulse{50%{opacity:.4}}

    .ti-board{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
    @media(max-width:1000px){.ti-board{grid-template-columns:1fr}}
    .ti-col{background:rgba(255,255,255,.025);border:1px solid rgba(255,255,255,.07);border-radius:14px;display:flex;flex-direction:column;min-height:300px;overflow:hidden}
    .ti-col-head{display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid rgba(255,255,255,.07);font-size:13px;font-weight:600;border-top:3px solid var(--accent)}
    .ti-col-badge{background:rgba(255,255,255,.08);padding:2px 9px;border-radius:999px;font-size:11px;font-weight:700}
    .ti-col-body{padding:10px;display:flex;flex-direction:column;gap:9px;flex:1;min-height:180px}
    .ti-empty{text-align:center;padding:28px 12px;display:flex;flex-direction:column;align-items:center;gap:4px}
    .ti-empty-icon{font-size:30px;opacity:.4;margin-bottom:4px}
    .ti-empty-title{font-size:13px;font-weight:600;opacity:.75}
    .ti-empty-sub{font-size:11.5px;opacity:.5;line-height:1.4;max-width:220px}

    .ti-card{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.09);border-radius:11px;padding:12px;display:flex;flex-direction:column;gap:8px;transition:all .15s}
    .ti-card:hover{background:rgba(255,255,255,.07);transform:translateY(-1px);box-shadow:0 4px 14px rgba(0,0,0,.2)}
    .ti-card.overdue{border-color:rgba(239,68,68,.4);background:rgba(239,68,68,.04)}
    .ti-card-head{display:flex;justify-content:space-between;align-items:flex-start;gap:8px}
    .ti-title{margin:0;font-size:13.5px;font-weight:600;line-height:1.3;flex:1;word-break:break-word}
    .ti-avatars{display:flex;align-items:center;gap:4px;flex-shrink:0}
    .ti-avatar{display:inline-flex;width:24px;height:24px;border-radius:50%;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;font-size:10px;font-weight:700;align-items:center;justify-content:center;border:1.5px solid rgba(255,255,255,.1)}
    .ti-rel{opacity:.4;font-size:11px}
    .ti-desc{margin:0;font-size:12px;opacity:.7;line-height:1.45;word-break:break-word}
    .ti-foot{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:2px}
    .ti-due{font-size:11px;opacity:.6}
    .ti-due.is-overdue{color:#ef4444;opacity:1;font-weight:600}
    .ti-actions{display:flex;gap:5px}
    .ti-mini{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);color:inherit;padding:4px 9px;border-radius:7px;font-size:11px;cursor:pointer;transition:all .15s}
    .ti-mini:hover{background:rgba(255,255,255,.14)}
    .ti-next{background:rgba(99,102,241,.18);border-color:rgba(99,102,241,.4);color:#a5b4fc}
    .ti-next:hover{background:rgba(99,102,241,.3)}

    .ti-form{display:flex;flex-direction:column;gap:13px;padding:4px}
    .ti-field{display:flex;flex-direction:column;gap:5px}
    .ti-field>span{font-size:11px;opacity:.6;text-transform:uppercase;letter-spacing:.05em;font-weight:600}
    .ti-field input, .ti-field textarea, .ti-field select{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);border-radius:9px;padding:9px 11px;color:inherit;font-size:13px;font-family:inherit;box-sizing:border-box}
    .ti-field textarea{resize:vertical}
    .ti-field input:focus, .ti-field textarea:focus, .ti-field select:focus{outline:none;border-color:rgba(99,102,241,.6)}
    .ti-row{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    @media(max-width:520px){.ti-row{grid-template-columns:1fr}}
    .ti-form-foot{display:flex;gap:9px;justify-content:flex-end;border-top:1px solid rgba(255,255,255,.08);padding-top:13px;margin-top:4px}
    .ti-btn{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);color:inherit;padding:8px 16px;border-radius:9px;cursor:pointer;font-size:13px;font-weight:500;transition:all .15s}
    .ti-btn:hover{background:rgba(255,255,255,.12)}
    .ti-btn-p{background:#6366f1;border-color:transparent;color:#fff}
    .ti-btn-p:hover{background:#7c7ef5}

    .ti-err{padding:36px;text-align:center;background:rgba(239,68,68,.06);border:1px solid rgba(239,68,68,.2);border-radius:13px;margin:12px}
  `
  document.head.appendChild(s)
}

// ─── Mount ───────────────────────────────────────────────────────────────────

export default {
  id: 'tasks-inbox',
  title: 'Team-Aufgaben',
  category: 'admin_actions',

  async mount(container) {
    try {
      injectStyles()

      container.innerHTML = `
        <div class="ti-shell">
          <div class="ti-head">
            <div>
              <h2>📋 Team-Aufgaben</h2>
              <div class="ti-sub" id="ti-last-upd">Lädt …</div>
            </div>
            <div class="ti-toolbar">
              <button class="ti-tb-btn ti-tb-new" id="ti-new">＋ Neue Aufgabe</button>
              <button class="ti-tb-btn" id="ti-refresh">🔄 Aktualisieren</button>
            </div>
          </div>
          <div id="ti-body"></div>
        </div>`

      try { fadeIn(container) } catch (_) {}

      const body = container.querySelector('#ti-body')
      const lastUpd = container.querySelector('#ti-last-upd')

      const render = () => {
        const visible = state.tasks.filter(t => {
          if (state.filter === 'mine') return t.assigned_to === state.meId
          return true
        })

        body.innerHTML = `
          ${filterBarHtml()}
          <div class="ti-board" style="margin-top:14px">
            ${STATUS_COLS.map(c => columnHtml(c, visible)).join('')}
          </div>`

        body.querySelectorAll('[data-empty-new]').forEach(b => {
          b.addEventListener('click', () => openNewTaskModal(load))
        })

        body.querySelectorAll('.ti-pill').forEach(p => {
          p.addEventListener('click', () => {
            state.filter = p.dataset.f
            render()
          })
        })

        body.querySelectorAll('.ti-mini').forEach(btn => {
          btn.addEventListener('click', async (e) => {
            e.stopPropagation()
            const id = btn.dataset.id
            const t = state.tasks.find(x => String(x.id) === String(id))
            if (!t) return
            const target = btn.dataset.act === 'next' ? nextStatus(t.status) : prevStatus(t.status)
            if (!target) return
            try {
              await updateTaskStatus(t.id, target)
              t.status = target
              render()
              toast(`→ ${nextLabel(target)}`, 'success')
            } catch (err) { toast('Fehler: ' + err.message, 'error') }
          })
        })
      }

      const load = async () => {
        try {
          const tasks = await fetchTasks()
          state.tasks = tasks
          await loadUserIndex(tasks)
          lastUpd.textContent = `Aktualisiert: ${fmtDateTime(new Date().toISOString())} · ${tasks.length} Aufgaben`
          render()
        } catch (e) {
          body.innerHTML = `
            <div class="ti-err">
              <div style="font-size:34px;margin-bottom:8px">⚠️</div>
              <h3 style="margin:0 0 6px">Fehler beim Laden</h3>
              <p style="opacity:.7;margin:8px 0 14px;font-size:13px">${htmlEscape(e.message || String(e))}</p>
              <button class="ti-btn ti-btn-p" id="ti-retry">Erneut versuchen</button>
            </div>`
          body.querySelector('#ti-retry')?.addEventListener('click', load)
        }
      }

      // Realtime: coalesce bursts to max 1 load per 1.5s (war 400ms → zu spammy bei Bulk-Updates)
      const debouncedLoad = debounce(load, 1500)

      // initial skeleton
      body.innerHTML = ''
      try { body.appendChild(skeletonLoader('100%', 300)) } catch (_) { body.innerHTML = '<div style="opacity:.4;padding:30px;text-align:center">Lädt …</div>' }

      await fetchMe()
      await load()

      container.querySelector('#ti-refresh').addEventListener('click', load)
      container.querySelector('#ti-new').addEventListener('click', () => openNewTaskModal(load))

      const refreshTimer = setInterval(load, REFRESH_MS)

      let rtCh = null
      try {
        rtCh = sb.channel('admin_tasks_inbox')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'admin_tasks' }, () => debouncedLoad())
          .subscribe()
      } catch (_) {}

      return () => {
        clearInterval(refreshTimer)
        try { if (rtCh) sb.removeChannel(rtCh) } catch (_) {}
      }
    } catch (err) {
      try {
        container.innerHTML = `
          <div class="ti-err" style="margin:20px">
            <div style="font-size:34px;margin-bottom:8px">⚠️</div>
            <h3 style="margin:0 0 6px">Panel konnte nicht geladen werden</h3>
            <p style="opacity:.7;font-size:12px;font-family:ui-monospace,monospace">${htmlEscape(err?.message || String(err))}</p>
          </div>`
      } catch (_) {}
      return () => {}
    }
  },
}
