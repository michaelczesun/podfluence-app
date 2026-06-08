// Cmd-K Universal Bar — extracted module
// Public API: openCmdK(), closeCmdK(), toggleCmdK(), installCmdK({sb, panels, buildHashFor, role})
// Mounts a modal overlay with fuzzy-search over panels + users (via Supabase).
// Mobile: full-screen layout. Keyboard nav: ↑↓ Enter Esc. Trigger via Cmd/Ctrl+K (caller wires the keydown).
//
// Sticky Quick-Actions: 5 pinned items aus cmdk-actions.js bleiben IMMER sichtbar wenn der
// Input leer ist. Reihenfolge per pinnedOrder. Sortiert vor allen Panels.

import { searchActions, getActionById } from '/crm/lib/cmdk-actions.js?v=20260608-sticky1'

let _sb = null
let _panels = []
let _buildHashFor = (id) => id
let _role = null

let backdrop = null
let items = []
let sel = 0
let userResults = []
let userSearchTimer = null
let lastTriggerEl = null

const STYLE_ID = 'cmdk-styles'

function injectStylesOnce() {
  if (document.getElementById(STYLE_ID)) return
  const css = `
    .cmdk-backdrop {
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.55);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      z-index: 9500;
      display: flex; align-items: flex-start; justify-content: center;
      padding-top: 12vh;
      animation: cmdk-fade 0.18s ease;
    }
    @keyframes cmdk-fade { from { opacity: 0; } to { opacity: 1; } }
    .cmdk-modal {
      width: min(640px, calc(100% - 32px));
      background: var(--surface-elev, #1C1C25);
      border: 1px solid var(--border, #2A2A33);
      border-radius: 14px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.5);
      overflow: hidden;
      display: flex; flex-direction: column;
      max-height: 76vh;
    }
    .cmdk-input-wrap { display: flex; align-items: center; padding: 0 18px; border-bottom: 1px solid var(--border, #2A2A33); }
    .cmdk-input-wrap .cmdk-ic { color: var(--text-dim, #6B7280); font-size: 16px; margin-right: 10px; }
    .cmdk-modal input.cmdk-input {
      flex: 1;
      background: transparent;
      border: none; outline: none;
      color: #fff;
      padding: 18px 0;
      font-size: 16px;
      font-family: inherit;
    }
    .cmdk-mic-btn {
      background: transparent; border: none;
      color: var(--text-muted, #9CA3AF);
      font-size: 16px; cursor: pointer;
      padding: 6px 10px; border-radius: 8px;
      display: inline-flex; align-items: center; justify-content: center;
    }
    .cmdk-mic-btn:hover { background: rgba(255,255,255,0.05); color: #fff; }
    .cmdk-mic-btn.recording { color: #F87171; animation: cmdk-pulse 1.2s ease-in-out infinite; }
    @keyframes cmdk-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.45; } }
    .cmdk-list { flex: 1; overflow-y: auto; padding: 6px; }
    .cmdk-group-head {
      font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em;
      color: var(--text-dim, #6B7280); padding: 8px 14px 4px;
    }
    .cmdk-item {
      display: flex; align-items: center; gap: 10px;
      padding: 10px 14px;
      border-radius: 8px;
      cursor: pointer;
      color: var(--text-muted, #9CA3AF);
      font-size: 13px;
    }
    .cmdk-item .cmdk-cat { color: var(--text-dim, #6B7280); font-size: 11px; text-transform: uppercase; letter-spacing: 0.6px; }
    .cmdk-item .cmdk-title { color: var(--text, #fff); flex: 1; font-weight: 500; }
    .cmdk-item.sel, .cmdk-item:hover { background: rgba(139,92,246,0.18); }
    .cmdk-item.sel { border-left: 2px solid var(--primary-2, #A78BFA); padding-left: 12px; }
    .cmdk-item.cmdk-sticky { background: rgba(139,92,246,0.07); }
    .cmdk-item.cmdk-sticky.sel { background: rgba(139,92,246,0.22); }
    .cmdk-shortcut {
      font-family: ui-monospace, monospace;
      font-size: 10px;
      color: var(--text-dim, #6B7280);
      background: rgba(255,255,255,0.05);
      border: 1px solid var(--border, #2A2A33);
      border-radius: 4px;
      padding: 1px 5px;
      margin-right: 6px;
      letter-spacing: 0.5px;
    }
    /* User-row: Avatar + Username + Full-Name + Action-Buttons */
    .cmdk-item.cmdk-user-row { padding: 8px 14px; }
    .cmdk-user-avatar {
      width: 32px; height: 32px; border-radius: 50%;
      object-fit: cover; flex: 0 0 32px;
      background: rgba(255,255,255,0.06);
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 11px; font-weight: 600; color: #fff;
    }
    .cmdk-user-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
    .cmdk-user-name { color: var(--text, #fff); font-weight: 500; font-size: 13px;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .cmdk-user-handle { color: var(--text-dim, #6B7280); font-size: 11px;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .cmdk-user-actions { display: flex; gap: 4px; flex: 0 0 auto; }
    .cmdk-user-actions button {
      background: rgba(255,255,255,0.06);
      border: 1px solid var(--border, #2A2A33);
      color: var(--text-muted, #9CA3AF);
      font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em;
      padding: 4px 8px; border-radius: 6px;
      cursor: pointer; font-family: inherit;
    }
    .cmdk-user-actions button:hover { background: rgba(139,92,246,0.25); color: #fff; }
    .cmdk-user-actions button:disabled { opacity: 0.4; cursor: default; }
    .cmdk-user-actions button.verified { color: #34D399; }
    .cmdk-empty { padding: 28px; text-align: center; color: var(--text-dim, #6B7280); font-size: 13px; }
    .cmdk-footer {
      display: flex; gap: 14px;
      padding: 10px 16px;
      border-top: 1px solid var(--border, #2A2A33);
      color: var(--text-dim, #6B7280);
      font-size: 11px;
    }
    .cmdk-footer kbd {
      background: rgba(255,255,255,0.06);
      border: 1px solid var(--border, #2A2A33);
      padding: 1px 5px; border-radius: 3px;
      font-family: ui-monospace, monospace; font-size: 10px;
      color: var(--text-muted, #9CA3AF);
    }
    /* Mic FAB — bottom-right floating action button, above bottom-bar (mobile only).
       Bottom-bar height = 56px + safe-area-inset-bottom. FAB sits 12px above it. */
    .cmdk-mic-fab {
      display: flex; align-items: center; justify-content: center;
      width: 52px; height: 52px;
      border-radius: 50%;
      background: linear-gradient(135deg, var(--primary, #8B5CF6), var(--primary-dark, #7C3AED));
      color: #fff;
      box-shadow: 0 8px 22px rgba(139,92,246,0.45);
      border: none;
      cursor: pointer;
      position: fixed;
      right: 16px;
      bottom: calc(56px + 12px + env(safe-area-inset-bottom, 0px));
      z-index: 1100;
    }
    /* Desktop (>=768px): no bottom-bar, sit closer to bottom-right corner. */
    @media (min-width: 768px) {
      .cmdk-mic-fab { bottom: calc(20px + env(safe-area-inset-bottom, 0px)); }
    }
    .cmdk-mic-fab svg { width: 22px; height: 22px; stroke: currentColor; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .cmdk-mic-fab:active { transform: scale(0.94); }
    /* Hide Mic-FAB while any modal/drawer is open — avoids z-index fights. */
    body.modal-open .cmdk-mic-fab { opacity: 0; pointer-events: none; transition: opacity 0.2s; }

    /* Mobile: full-screen modal */
    @media (max-width: 640px) {
      .cmdk-backdrop { padding-top: 0; align-items: stretch; }
      .cmdk-modal {
        width: 100%;
        max-height: 100vh; height: 100vh;
        border-radius: 0; border: none;
      }
      .cmdk-list { max-height: none; }
    }
  `
  const s = document.createElement('style')
  s.id = STYLE_ID
  s.textContent = css
  document.head.appendChild(s)
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
}

function scoreMatch(haystack, needle) {
  if (!needle) return 1
  if (haystack.includes(needle)) return 10
  let idx = 0
  for (const ch of needle) {
    idx = haystack.indexOf(ch, idx)
    if (idx === -1) return 0
    idx++
  }
  return 1
}

function buildItems(query) {
  const q = (query || '').trim().toLowerCase()

  // ── Sticky Quick-Actions: nur wenn Input LEER ist, immer am Anfang. ──
  let pinned = []
  if (!q) {
    try {
      const all = searchActions('', { role: _role })
      pinned = all
        .filter(a => a.pinned)
        .sort((a, b) => (a.pinnedOrder ?? 99) - (b.pinnedOrder ?? 99))
        .slice(0, 5)
        .map(a => ({
          type: 'action',
          id: a.id,
          title: a.label,
          cat: 'Quick-Action',
          icon: a.icon || '⚡',
          match: 100,
          action: a,
          sticky: true
        }))
    } catch (e) {
      console.warn('[cmdk] sticky actions load failed', e)
    }
  }

  // ── Tippt der Nutzer, suche auch ALLE Actions (nicht nur pinned) ──
  let actionMatches = []
  if (q) {
    try {
      actionMatches = searchActions(q, { role: _role, limit: 8 }).map(a => ({
        type: 'action',
        id: a.id,
        title: a.label,
        cat: a.kind === 'action' ? 'Aktion' : a.kind === 'navigation' ? 'Navigation' : a.kind === 'settings' ? 'Settings' : a.kind === 'help' ? 'Hilfe' : 'Aktion',
        icon: a.icon || '•',
        match: (a._score ?? 1) + 5,
        action: a
      }))
    } catch (e) {
      console.warn('[cmdk] action search failed', e)
    }
  }

  const panels = (_panels || []).map(p => ({
    type: 'panel',
    id: p.id,
    title: p.title,
    cat: 'Tab',
    icon: p.icon || '•',
    match: scoreMatch((p.title || '').toLowerCase(), q)
  }))
  let panelOut = panels.filter(i => !q || i.match > 0)
  panelOut.sort((a, b) => b.match - a.match || a.title.localeCompare(b.title))

  let out = [...pinned, ...actionMatches, ...panelOut]

  if (userResults.length) {
    out = out.concat(userResults.map(u => ({
      type: 'user',
      id: u.id,
      title: u.full_name || u.username || u.display_name || (u.id || '').slice(0, 8),
      cat: 'Nutzer',
      icon: '👤',
      match: 1,
      user: u
    })))
  }
  return out.slice(0, 30)
}

// Trigger: query starts with "@" OR has >2 chars (i.e. >=3).
// Calls RPC `admin_users_list_filtered` with p_search + p_limit:10.
// Result rows expose id, username, full_name, avatar_url, is_verified.
async function searchUsers(query) {
  const raw = String(query || '')
  const trimmed = raw.trim()
  const hasAt = trimmed.startsWith('@')
  const term = hasAt ? trimmed.slice(1).trim() : trimmed

  // Reset wenn keine Trigger-Bedingung erfüllt.
  if (!_sb || (!hasAt && trimmed.length <= 2) || (hasAt && term.length === 0)) {
    userResults = []
    return
  }

  try {
    const { data, error } = await _sb.rpc('admin_users_list_filtered', {
      p_search: term,
      p_limit: 10
    })
    if (error) { userResults = []; return }
    userResults = (data || []).slice(0, 10)
  } catch { userResults = [] }
}

function render(query) {
  items = buildItems(query)
  sel = 0
  const list = backdrop?.querySelector('.cmdk-list')
  if (!list) return
  if (!items.length) {
    list.innerHTML = `<div class="cmdk-empty">Nichts gefunden für „${escapeHtml(query || '')}"</div>`
    return
  }
  let lastCat = null
  list.innerHTML = items.map((it, i) => {
    let groupHead = ''
    if (it.cat !== lastCat) {
      const headLabel = it.sticky ? '⚡ Quick-Aktionen' : it.cat
      groupHead = `<div class="cmdk-group-head">${escapeHtml(headLabel)}</div>`
      lastCat = it.cat
    }
    if (it.type === 'user') return groupHead + renderUserRow(it, i, i === 0)
    const sc = it.action?.shortcut
    const shortcutBadge = sc
      ? `<span class="cmdk-shortcut">${sc.map(k => k === 'mod' ? '⌘' : k === 'shift' ? '⇧' : k.toUpperCase()).join('')}</span>`
      : ''
    return groupHead + `
    <div class="cmdk-item ${i === 0 ? 'sel' : ''} ${it.sticky ? 'cmdk-sticky' : ''}" data-idx="${i}">
      <span style="font-size:14px">${it.icon}</span>
      <span class="cmdk-title">${escapeHtml(it.title)}</span>
      ${shortcutBadge}
      <span class="cmdk-cat">${escapeHtml(it.cat)}</span>
    </div>`
  }).join('')
  list.querySelectorAll('.cmdk-item').forEach(el => {
    el.addEventListener('mouseenter', () => {
      list.querySelectorAll('.cmdk-item').forEach(x => x.classList.remove('sel'))
      el.classList.add('sel')
      sel = +el.dataset.idx
    })
    el.addEventListener('click', (ev) => {
      // Klicks auf Action-Buttons (View/Verify/Note) gehen NICHT in activate().
      if (ev.target.closest('[data-cmdk-user-action]')) return
      activate(items[+el.dataset.idx])
    })
  })
  // User-Action-Buttons (View / Verify / Note) verdrahten.
  list.querySelectorAll('[data-cmdk-user-action]').forEach(btn => {
    btn.addEventListener('click', async (ev) => {
      ev.preventDefault()
      ev.stopPropagation()
      const action = btn.getAttribute('data-cmdk-user-action')
      const userId = btn.getAttribute('data-user-id')
      if (!userId) return
      await runUserAction(action, userId, btn)
    })
  })
}

function renderUserRow(it, i, selected) {
  const u = it.user || {}
  const username = u.username || ''
  const fullName = u.full_name || u.display_name || ''
  const verified = !!u.is_verified
  const initials = (fullName || username || '?')
    .split(/\s+/).map(s => s[0] || '').join('').slice(0, 2).toUpperCase()
  const avatar = u.avatar_url
    ? `<img src="${escapeHtml(u.avatar_url)}" alt="" class="cmdk-user-avatar" />`
    : `<div class="cmdk-user-avatar">${escapeHtml(initials)}</div>`
  const uid = escapeHtml(u.id || it.id || '')
  const verifyBtn = verified
    ? `<button class="verified" disabled title="bereits verifiziert">✓</button>`
    : `<button data-cmdk-user-action="verify" data-user-id="${uid}" title="Verifizieren">Verify</button>`
  return `
    <div class="cmdk-item cmdk-user-row ${selected ? 'sel' : ''}" data-idx="${i}" role="option">
      ${avatar}
      <div class="cmdk-user-info">
        <div class="cmdk-user-name">${escapeHtml(fullName || username || '—')}</div>
        <div class="cmdk-user-handle">@${escapeHtml(username || '—')}</div>
      </div>
      <div class="cmdk-user-actions">
        <button data-cmdk-user-action="view" data-user-id="${uid}" title="Profil ansehen">View</button>
        ${verifyBtn}
        <button data-cmdk-user-action="note" data-user-id="${uid}" title="Notiz anlegen">Note</button>
      </div>
    </div>`
}

// View / Verify / Note Handler. Lazy-importiert panel-actions, damit cmdk.js
// keine harten Top-Level-Imports von Panel-Code braucht (cmdk wird sehr früh geladen).
async function runUserAction(action, userId, btn) {
  try {
    if (action === 'view') {
      // Schließt Modal und navigiert zur Users-Liste mit Detail-Modal-Auto-Open.
      closeCmdK()
      location.hash = '#people/users?u=' + encodeURIComponent(userId)
    } else if (action === 'verify') {
      const mod = await import('/lib/panel-actions.js?v=20260608k').catch(() => null)
      if (mod?.verifyUser) {
        await mod.verifyUser(userId)
        btn.disabled = true
        btn.classList.add('verified')
        btn.textContent = '✓'
        btn.title = 'verifiziert'
      } else {
        // Fallback: direkt-Update via RPC, falls panel-actions nicht geladen.
        await _sb?.rpc?.('admin_set_user_verified', { p_user_id: userId, p_verified: true })
        btn.disabled = true
        btn.classList.add('verified')
        btn.textContent = '✓'
      }
    } else if (action === 'note') {
      // Andere Module hören auf dieses Event und öffnen den Notiz-Composer.
      window.dispatchEvent(new CustomEvent('cmdk:open-note', { detail: { userId } }))
      closeCmdK()
    }
  } catch (err) {
    console.warn('[cmdk] user-action', action, 'failed:', err)
  }
}

function updateSel() {
  const list = backdrop?.querySelector('.cmdk-list')
  if (!list) return
  list.querySelectorAll('.cmdk-item').forEach((el, i) => {
    el.classList.toggle('sel', i === sel)
    if (i === sel) el.scrollIntoView({ block: 'nearest' })
  })
}

function activate(it) {
  if (!it) return
  if (it.type === 'panel') {
    location.hash = '#' + _buildHashFor(it.id)
    closeCmdK()
    return
  }
  if (it.type === 'user') {
    location.hash = '#people/users?u=' + it.id
    closeCmdK()
    return
  }
  if (it.type === 'action') {
    // Close first so any modal/toast triggered by run() lands on a clean DOM.
    closeCmdK()
    try {
      const result = it.action?.run?.()
      if (result && typeof result.catch === 'function') {
        result.catch(err => {
          console.error('[cmdk] action error', it.id, err)
          window.toast?.(err?.message || 'Aktion fehlgeschlagen')
        })
      }
    } catch (err) {
      console.error('[cmdk] action throw', it.id, err)
      window.toast?.(err?.message || 'Aktion fehlgeschlagen')
    }
    return
  }
}

// Speech-to-Text via webkitSpeechRecognition (de-DE)
let recognition = null
function startSpeech(input, micBtn) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition
  if (!SR) { input?.focus(); return }
  try {
    recognition = new SR()
    recognition.lang = 'de-DE'
    recognition.interimResults = true
    recognition.continuous = false
    micBtn?.classList.add('recording')
    recognition.onresult = (ev) => {
      let txt = ''
      for (let i = ev.resultIndex; i < ev.results.length; i++) txt += ev.results[i][0].transcript
      input.value = txt
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    recognition.onend = () => { micBtn?.classList.remove('recording'); recognition = null }
    recognition.onerror = () => { micBtn?.classList.remove('recording'); recognition = null }
    recognition.start()
  } catch {
    micBtn?.classList.remove('recording')
    recognition = null
  }
}
function stopSpeech() {
  try { recognition?.stop() } catch {}
  recognition = null
}

export function openCmdK() {
  if (backdrop) return
  injectStylesOnce()
  lastTriggerEl = document.activeElement
  backdrop = document.createElement('div')
  backdrop.className = 'cmdk-backdrop'
  backdrop.setAttribute('role', 'dialog')
  backdrop.setAttribute('aria-modal', 'true')
  backdrop.innerHTML = `
    <div class="cmdk-modal">
      <div class="cmdk-input-wrap">
        <span class="cmdk-ic">⌕</span>
        <input class="cmdk-input" type="text" placeholder="Suche Panels, Nutzer, Aktionen…" autocomplete="off" spellcheck="false" />
        <button class="cmdk-mic-btn" type="button" title="Sprache (de-DE)" aria-label="Spracheingabe">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/></svg>
        </button>
      </div>
      <div class="cmdk-list"></div>
      <div class="cmdk-footer">
        <span><kbd>↑↓</kbd> Navigieren</span>
        <span><kbd>↵</kbd> Öffnen</span>
        <span><kbd>Esc</kbd> Schließen</span>
      </div>
    </div>
  `
  document.body.appendChild(backdrop)
  const input = backdrop.querySelector('input.cmdk-input')
  const micBtn = backdrop.querySelector('.cmdk-mic-btn')
  render('')
  input.addEventListener('input', e => {
    const v = e.target.value
    render(v)
    clearTimeout(userSearchTimer)
    userSearchTimer = setTimeout(async () => {
      await searchUsers(v)
      render(v)
    }, 80)
  })
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
      e.preventDefault()
      sel = Math.min(items.length - 1, sel + 1)
      updateSel()
    } else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
      e.preventDefault()
      sel = Math.max(0, sel - 1)
      updateSel()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      activate(items[sel])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      closeCmdK()
    }
  })
  micBtn.addEventListener('click', e => {
    e.preventDefault()
    if (recognition) { stopSpeech(); micBtn.classList.remove('recording'); return }
    startSpeech(input, micBtn)
  })
  backdrop.addEventListener('click', e => {
    if (e.target === backdrop) closeCmdK()
  })
  setTimeout(() => input.focus(), 10)
}

export function closeCmdK() {
  stopSpeech()
  backdrop?.remove()
  backdrop = null
  userResults = []
  clearTimeout(userSearchTimer)
  try { lastTriggerEl?.focus?.() } catch {}
  lastTriggerEl = null
}

export function toggleCmdK() {
  if (backdrop) closeCmdK(); else openCmdK()
}

export function isCmdKOpen() {
  return !!backdrop
}

/**
 * Install Cmd-K globally.
 * @param {Object} opts
 * @param {Object} opts.sb          Supabase client (for user search)
 * @param {Array}  opts.panels      [{id, title, icon}]
 * @param {Function} opts.buildHashFor  (panelId) => hashPath
 * @param {boolean} [opts.bindKeyboard=true] register Cmd/Ctrl+K listener
 * @param {boolean} [opts.installMicFab=true] inject mic FAB in #mobile-bottom-bar (mobile only)
 */
export function installCmdK(opts = {}) {
  _sb = opts.sb || _sb
  _panels = opts.panels || _panels
  _buildHashFor = opts.buildHashFor || _buildHashFor
  _role = opts.role || _role || (typeof window !== 'undefined' && window.__CRM_ROLE__) || null
  injectStylesOnce()

  if (opts.bindKeyboard !== false) {
    window.addEventListener('keydown', (e) => {
      const meta = e.metaKey || e.ctrlKey
      if (!meta) return
      // Cmd+K — Toggle palette
      if (e.key === 'k' || e.key === 'K') {
        e.preventDefault()
        toggleCmdK()
        return
      }
      // Sticky Quick-Action Shortcuts
      // Cmd+L → Neuer Lead, Cmd+T → Neuer Task
      // Cmd+Shift+A → Audit 1h, Cmd+Shift+V → Bulk-Verify, Cmd+Shift+P → Push Premium
      const key = (e.key || '').toLowerCase()
      const shift = e.shiftKey
      let runId = null
      if (!shift && key === 'l') runId = 'new-lead'
      else if (!shift && key === 't') runId = 'new-task'
      else if (shift && key === 'a') runId = 'audit-last-hour'
      else if (shift && key === 'v') runId = 'bulk-verify-pending'
      else if (shift && key === 'p') runId = 'push-premium'
      if (runId) {
        // Nicht in Inputs/Textareas hijacken (außer Cmd+Shift+* — selten getippt)
        const inField = e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) && !shift
        if (inField) return
        e.preventDefault()
        const act = getActionById(runId)
        if (!act) return
        if (Array.isArray(act.scope) && act.scope.length && _role && !act.scope.includes(_role)) return
        try {
          const r = act.run?.()
          if (r && typeof r.catch === 'function') r.catch(err => console.error('[cmdk] shortcut error', runId, err))
        } catch (err) {
          console.error('[cmdk] shortcut throw', runId, err)
        }
      }
    })
  }

  if (opts.installMicFab !== false) {
    installMicFab()
  }
}

/**
 * Inject a centered Mic FAB into the mobile bottom-bar that opens Cmd-K.
 * No-op if bar not present or FAB already injected.
 */
export function installMicFab() {
  const bar = document.getElementById('mobile-bottom-bar')
  if (!bar) return
  if (document.querySelector('.cmdk-mic-fab')) return
  injectStylesOnce()
  const fab = document.createElement('button')
  fab.type = 'button'
  fab.className = 'cmdk-mic-fab'
  fab.setAttribute('aria-label', 'Cmd-K öffnen')
  fab.title = 'Suche / Sprache'
  fab.innerHTML = `<svg viewBox="0 0 24 24"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/></svg>`
  fab.addEventListener('click', (e) => {
    e.preventDefault()
    openCmdK()
  })
  // FAB is position:fixed (bottom-right) — append to body so bar's overflow doesn't clip it
  document.body.appendChild(fab)
  installModalOpenObserver()
}

/**
 * Tracks whether any modal/drawer is currently open and reflects that state
 * as `body.modal-open`. The Mic-FAB CSS hides itself when this class is set,
 * so we don't fight z-index with whatever modal a panel decides to mount.
 *
 * We watch for:
 *  - `.modal.open`, `.drawer.open` (CRM convention — see index.html ESC handler)
 *  - `.modal-backdrop`, `.drawer-backdrop` (transient overlay nodes)
 *  - `[data-dismiss-on-esc].open` (custom dismiss-on-esc dialogs)
 */
let _modalObserverInstalled = false
function installModalOpenObserver() {
  if (_modalObserverInstalled) return
  _modalObserverInstalled = true
  const SELECTOR = '.modal.open, .drawer.open, .modal-backdrop, .drawer-backdrop, [data-dismiss-on-esc].open'
  const recompute = () => {
    const hasOpen = !!document.querySelector(SELECTOR)
    document.body.classList.toggle('modal-open', hasOpen)
  }
  const mo = new MutationObserver(recompute)
  mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] })
  recompute()
}
