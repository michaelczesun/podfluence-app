// crm/lib/toast.js — Toast/Snackbar System
//
// Ersetzt alert() + console.log Success-Meldungen.
//
// API:
//   toast({ type, title, message, action, duration })
//   toast('Nachricht')                          — info, 4s
//   toast('Nachricht', 'success')               — success, 4s
//   toast('Nachricht', { type: 'error' })       — error, 4s
//   toast({ kind: 'success', text: 'Foo' })     — Legacy-Form
//
// type:     'success' | 'error' | 'info' | 'warning' (auch: warn, danger)
// title:    optionaler Fett-Titel über message
// message:  Hauptinhalt
// action:   { label, onClick }  — optionaler Button rechts
// duration: ms (default 4000, 0 = sticky)
//
// Style: Glas-Card unten rechts, slide-in von rechts, auto-dismiss 4s,
// farbiger Akzent links pro Type. Stapelt vertikal.

const STYLES = `
  .toast-stack {
    position: fixed;
    right: 20px;
    bottom: 20px;
    z-index: 10000;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 10px;
    pointer-events: none;
    max-width: calc(100vw - 40px);
  }
  @media (max-width: 767px) {
    .toast-stack {
      right: 12px;
      left: 12px;
      bottom: calc(72px + env(safe-area-inset-bottom));
      align-items: stretch;
    }
  }
  .toast-card {
    pointer-events: auto;
    min-width: 280px;
    max-width: 420px;
    background: rgba(22, 22, 29, 0.82);
    backdrop-filter: blur(16px) saturate(160%);
    -webkit-backdrop-filter: blur(16px) saturate(160%);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-left: 3px solid var(--toast-accent, #8B5CF6);
    border-radius: 12px;
    box-shadow: 0 12px 36px rgba(0, 0, 0, 0.45);
    padding: 12px 14px;
    color: #fff;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", system-ui, sans-serif;
    font-size: 13px;
    line-height: 1.4;
    display: flex;
    align-items: flex-start;
    gap: 12px;
    transform: translateX(calc(100% + 24px));
    opacity: 0;
    transition: transform 0.32s cubic-bezier(.2,.8,.2,1), opacity 0.22s ease;
  }
  .toast-card.toast-in {
    transform: translateX(0);
    opacity: 1;
  }
  .toast-card.toast-out {
    transform: translateX(calc(100% + 24px));
    opacity: 0;
  }
  @media (max-width: 767px) {
    .toast-card {
      min-width: 0;
      max-width: 100%;
      transform: translateY(calc(100% + 24px));
    }
    .toast-card.toast-in { transform: translateY(0); }
    .toast-card.toast-out { transform: translateY(calc(100% + 24px)); }
  }
  .toast-icon {
    flex-shrink: 0;
    width: 22px; height: 22px;
    display: flex; align-items: center; justify-content: center;
    font-size: 15px;
    background: var(--toast-accent-bg, rgba(139,92,246,0.18));
    color: var(--toast-accent, #8B5CF6);
    border-radius: 6px;
    line-height: 1;
  }
  .toast-body { flex: 1; min-width: 0; }
  .toast-title {
    font-weight: 600;
    font-size: 13px;
    color: #fff;
    margin-bottom: 2px;
  }
  .toast-msg {
    color: #E5E7EB;
    word-wrap: break-word;
  }
  .toast-action {
    background: transparent;
    color: var(--toast-accent, #A78BFA);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 7px;
    padding: 5px 10px;
    font-size: 12px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    flex-shrink: 0;
    transition: background 0.15s;
  }
  .toast-action:hover { background: rgba(255, 255, 255, 0.06); }
  .toast-close {
    background: transparent;
    border: 0;
    color: #9CA3AF;
    font-size: 16px;
    line-height: 1;
    cursor: pointer;
    padding: 2px 4px;
    flex-shrink: 0;
    transition: color 0.12s;
  }
  .toast-close:hover { color: #fff; }
`

const TYPE_META = {
  success: { accent: '#34D399', bg: 'rgba(52,211,153,0.16)', icon: '✓' },
  error:   { accent: '#F87171', bg: 'rgba(248,113,113,0.16)', icon: '!' },
  warning: { accent: '#FCD34D', bg: 'rgba(252,211,77,0.16)',  icon: '⚠' },
  info:    { accent: '#60A5FA', bg: 'rgba(96,165,250,0.16)',  icon: 'i' }
}

function ensureStack() {
  let el = document.getElementById('toast-stack')
  if (el) return el
  const styleEl = document.createElement('style')
  styleEl.id = 'toast-styles'
  styleEl.textContent = STYLES
  document.head.appendChild(styleEl)
  el = document.createElement('div')
  el.id = 'toast-stack'
  el.className = 'toast-stack'
  el.setAttribute('role', 'region')
  el.setAttribute('aria-live', 'polite')
  el.setAttribute('aria-label', 'Benachrichtigungen')
  document.body.appendChild(el)
  return el
}

function normalizeType(t) {
  if (!t) return 'info'
  const k = String(t).toLowerCase()
  if (k === 'warn' || k === 'warning') return 'warning'
  if (k === 'danger' || k === 'error' || k === 'fail') return 'error'
  if (k === 'success' || k === 'ok' || k === 'done') return 'success'
  if (k === 'info' || k === 'note') return 'info'
  return 'info'
}

/**
 * Hauptfunktion. Akzeptiert mehrere Signaturen für Backwards-Compat.
 *   toast('text')
 *   toast('text', 'success')
 *   toast('text', { type: 'error', title: '...', action: {...} })
 *   toast({ type, title, message, action, duration })
 *   toast({ kind: 'success', text: '...' })           // Legacy
 */
export function toast(arg1, arg2) {
  let opts = {}
  if (typeof arg1 === 'string') {
    opts.message = arg1
    if (typeof arg2 === 'string') opts.type = arg2
    else if (arg2 && typeof arg2 === 'object') opts = { ...arg2, message: arg1 }
  } else if (arg1 && typeof arg1 === 'object') {
    opts = { ...arg1 }
    // Legacy-Form { kind, text }
    if (!opts.type && opts.kind) opts.type = opts.kind
    if (!opts.message && opts.text) opts.message = opts.text
  }

  const type = normalizeType(opts.type)
  const meta = TYPE_META[type]
  const duration = opts.duration === 0 ? 0 : (opts.duration || 4000)
  const title = opts.title || ''
  const message = opts.message || ''
  const action = opts.action || null

  const stack = ensureStack()
  const card = document.createElement('div')
  card.className = 'toast-card'
  card.setAttribute('role', type === 'error' ? 'alert' : 'status')
  card.style.setProperty('--toast-accent', meta.accent)
  card.style.setProperty('--toast-accent-bg', meta.bg)

  const iconEl = document.createElement('div')
  iconEl.className = 'toast-icon'
  iconEl.textContent = meta.icon
  card.appendChild(iconEl)

  const body = document.createElement('div')
  body.className = 'toast-body'
  if (title) {
    const t = document.createElement('div')
    t.className = 'toast-title'
    t.textContent = title
    body.appendChild(t)
  }
  const m = document.createElement('div')
  m.className = 'toast-msg'
  m.textContent = message
  body.appendChild(m)
  card.appendChild(body)

  if (action && action.label && typeof action.onClick === 'function') {
    const btn = document.createElement('button')
    btn.className = 'toast-action'
    btn.type = 'button'
    btn.textContent = action.label
    btn.addEventListener('click', (e) => {
      e.preventDefault()
      try { action.onClick() } catch (err) { console.error('[toast] action error', err) }
      dismiss()
    })
    card.appendChild(btn)
  }

  const close = document.createElement('button')
  close.className = 'toast-close'
  close.type = 'button'
  close.setAttribute('aria-label', 'Schließen')
  close.textContent = '×'
  close.addEventListener('click', dismiss)
  card.appendChild(close)

  stack.appendChild(card)
  // next frame → slide-in
  requestAnimationFrame(() => card.classList.add('toast-in'))

  let timer = null
  if (duration > 0) timer = setTimeout(dismiss, duration)

  function dismiss() {
    if (timer) { clearTimeout(timer); timer = null }
    if (!card.parentNode) return
    card.classList.remove('toast-in')
    card.classList.add('toast-out')
    setTimeout(() => { card.remove() }, 320)
  }

  return { dismiss }
}

// Convenience-Shortcuts
toast.success = (msg, opts = {}) => toast({ ...opts, type: 'success', message: msg })
toast.error   = (msg, opts = {}) => toast({ ...opts, type: 'error',   message: msg })
toast.info    = (msg, opts = {}) => toast({ ...opts, type: 'info',    message: msg })
toast.warning = (msg, opts = {}) => toast({ ...opts, type: 'warning', message: msg })

// Global window.toast (Backwards-Compat: ersetzt den Inline-Toast aus index.html)
if (typeof window !== 'undefined') {
  window.toast = toast
}

export default toast
