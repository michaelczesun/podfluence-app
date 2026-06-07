// Cmd-K Universal Bar — extracted module
// Public API: openCmdK(), closeCmdK(), toggleCmdK(), installCmdK({sb, panels, buildHashFor})
// Mounts a modal overlay with fuzzy-search over panels + users (via Supabase).
// Mobile: full-screen layout. Keyboard nav: ↑↓ Enter Esc. Trigger via Cmd/Ctrl+K (caller wires the keydown).

let _sb = null
let _panels = []
let _buildHashFor = (id) => id

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
    /* Mic FAB in mobile bottom bar */
    .cmdk-mic-fab {
      flex: 0 0 auto;
      display: flex; align-items: center; justify-content: center;
      width: 52px; height: 52px;
      margin: -16px 6px 0;
      border-radius: 50%;
      background: linear-gradient(135deg, var(--primary, #8B5CF6), var(--primary-dark, #7C3AED));
      color: #fff;
      box-shadow: 0 8px 22px rgba(139,92,246,0.45);
      border: none;
      cursor: pointer;
      position: relative; z-index: 1;
    }
    .cmdk-mic-fab svg { width: 22px; height: 22px; stroke: currentColor; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .cmdk-mic-fab:active { transform: scale(0.94); }

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
  const panels = (_panels || []).map(p => ({
    type: 'panel',
    id: p.id,
    title: p.title,
    cat: 'Tab',
    icon: p.icon || '•',
    match: scoreMatch((p.title || '').toLowerCase(), q)
  }))
  let out = panels.filter(i => !q || i.match > 0)
  out.sort((a, b) => b.match - a.match || a.title.localeCompare(b.title))
  if (userResults.length && q) {
    out = out.concat(userResults.map(u => ({
      type: 'user',
      id: u.id,
      title: u.display_name || u.username || u.email || (u.id || '').slice(0, 8),
      cat: 'Nutzer',
      icon: '👤',
      match: 1
    })))
  }
  return out.slice(0, 30)
}

async function searchUsers(query) {
  if (!_sb || !query || query.length < 2) { userResults = []; return }
  try {
    const { data } = await _sb.from('users')
      .select('id, display_name, username, email')
      .or(`display_name.ilike.%${query}%,username.ilike.%${query}%,email.ilike.%${query}%`)
      .limit(5)
    userResults = data || []
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
  list.innerHTML = items.map((it, i) => `
    <div class="cmdk-item ${i === 0 ? 'sel' : ''}" data-idx="${i}">
      <span style="font-size:14px">${it.icon}</span>
      <span class="cmdk-title">${escapeHtml(it.title)}</span>
      <span class="cmdk-cat">${escapeHtml(it.cat)}</span>
    </div>
  `).join('')
  list.querySelectorAll('.cmdk-item').forEach(el => {
    el.addEventListener('mouseenter', () => {
      list.querySelectorAll('.cmdk-item').forEach(x => x.classList.remove('sel'))
      el.classList.add('sel')
      sel = +el.dataset.idx
    })
    el.addEventListener('click', () => activate(items[+el.dataset.idx]))
  })
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
  } else if (it.type === 'user') {
    location.hash = '#people/users?u=' + it.id
  }
  closeCmdK()
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
    }, 220)
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
  injectStylesOnce()

  if (opts.bindKeyboard !== false) {
    window.addEventListener('keydown', (e) => {
      const meta = e.metaKey || e.ctrlKey
      if (meta && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        toggleCmdK()
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
  if (bar.querySelector('.cmdk-mic-fab')) return
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
  // Insert in the middle of the bar
  const kids = Array.from(bar.children)
  const mid = Math.floor(kids.length / 2)
  if (kids[mid]) bar.insertBefore(fab, kids[mid])
  else bar.appendChild(fab)
}
