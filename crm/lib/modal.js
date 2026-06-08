// /crm/lib/modal.js
// Zentralisierte Modal-Lib für alle CRM-Panels.
//
// Features:
//  - X-Button top-right
//  - Backdrop-Click schließt (außer hasUnsavedChanges() === true)
//  - Escape-Key schließt (gleiche Guard wie Backdrop)
//  - Focus-Trap: Tab/Shift+Tab bleibt im Modal
//  - Body-Scroll-Lock auf <html>
//  - Mobile fullscreen, Desktop centered max-width
//  - KAV: padding-bottom: env(keyboard-inset-height) +
//         window.visualViewport listener — Buttons bleiben über der Tastatur
//  - Smooth-In Animation (fade + slide-up)
//
// Public API:
//   openModal({
//     title:           string | HTMLElement,
//     body:            string | HTMLElement,
//     onClose?:        () => void,
//     footerActions?:  Array<{
//       label:          string,
//       onClick:        (api) => void | Promise<void>,
//       variant?:       'primary' | 'danger' | 'ghost',
//       closeOnClick?:  boolean   // default: true
//     }>,
//     width?:           number  // Desktop max-width (default 560)
//     hasUnsavedChanges?: () => boolean,
//     className?:       string   // extra class auf .modal-card
//     showClose?:       boolean  // default true
//   }) -> {
//     close(force?: boolean): void,
//     card: HTMLElement,
//     body: HTMLElement,
//     header: HTMLElement,
//     footer: HTMLElement | null,
//     setTitle(t: string | HTMLElement): void,
//     setBody(b: string | HTMLElement): void
//   }
//
// CSS-Klassen (siehe injectStyles unten):
//   .modal-backdrop, .modal-card, .modal-header, .modal-body, .modal-footer

const STYLE_ID = '__pf_modal_lib_styles__'
const SCROLL_LOCK_ATTR = 'data-pf-modal-locks'

let openCount = 0

function injectStyles() {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID)) return
  const s = document.createElement('style')
  s.id = STYLE_ID
  s.textContent = `
  .modal-backdrop {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.62);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
    display: flex; align-items: center; justify-content: center;
    z-index: 10050;
    padding: 16px;
    box-sizing: border-box;
    animation: pfModalFadeIn .18s ease-out;
  }
  .modal-backdrop.is-closing { animation: pfModalFadeOut .14s ease-in forwards; }

  .modal-card {
    width: 100%;
    max-width: var(--modal-width, 560px);
    /* KAV: max-height ist visualViewport-aware (JS pflegt --modal-vh) */
    max-height: var(--modal-vh, calc(100vh - 32px));
    background: rgba(22,22,29,0.86);
    backdrop-filter: blur(22px) saturate(160%);
    -webkit-backdrop-filter: blur(22px) saturate(160%);
    border: 1px solid rgba(139,92,246,0.22);
    border-radius: 18px;
    box-shadow: 0 24px 70px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04) inset;
    display: flex; flex-direction: column;
    overflow: hidden;
    color: #E4E4E7;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", system-ui, sans-serif;
    animation: pfModalSlideUp .22s cubic-bezier(.2,.8,.2,1);
    /* KAV-Fallback für iOS Safari 16+ */
    padding-bottom: env(keyboard-inset-height, 0px);
  }
  @media (max-width: 560px) {
    .modal-backdrop { padding: 0; }
    .modal-card {
      width: 100%;
      max-width: 100%;
      height: 100vh;
      max-height: var(--modal-vh, 100vh);
      border-radius: 0;
      border-left: none; border-right: none; border-bottom: none;
    }
  }

  .modal-header {
    display: flex; align-items: center; gap: 12px;
    padding: 16px 20px;
    border-bottom: 1px solid rgba(255,255,255,0.06);
    background: linear-gradient(180deg, rgba(139,92,246,0.08), transparent);
    flex-shrink: 0;
  }
  .modal-header-title {
    flex: 1; min-width: 0;
    font-size: 16px; font-weight: 700; color: #fff;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .modal-close {
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.08);
    color: #E4E4E7; width: 32px; height: 32px; border-radius: 10px;
    font-size: 18px; line-height: 1; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: all .15s; flex-shrink: 0;
  }
  .modal-close:hover {
    background: rgba(248,113,113,0.18);
    border-color: rgba(248,113,113,0.4);
    color: #F87171;
  }
  .modal-close:focus-visible {
    outline: 2px solid #A78BFA; outline-offset: 2px;
  }

  .modal-body {
    flex: 1; min-height: 0;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    padding: 16px 20px;
    color: #E4E4E7;
    font-size: 14px;
    line-height: 1.5;
  }

  .modal-footer {
    display: flex; gap: 8px; justify-content: flex-end;
    padding: 12px 20px 14px;
    border-top: 1px solid rgba(255,255,255,0.06);
    background: rgba(0,0,0,0.18);
    flex-shrink: 0;
    flex-wrap: wrap;
  }
  .modal-footer-btn {
    padding: 9px 16px;
    border-radius: 10px;
    border: 1px solid rgba(255,255,255,0.1);
    background: rgba(255,255,255,0.06);
    color: #E4E4E7;
    font-size: 13px; font-weight: 600;
    cursor: pointer;
    transition: transform .12s, background .15s, border-color .15s;
    font-family: inherit;
  }
  .modal-footer-btn:hover { background: rgba(255,255,255,0.12); }
  .modal-footer-btn:active { transform: scale(0.98); }
  .modal-footer-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .modal-footer-btn:focus-visible { outline: 2px solid #A78BFA; outline-offset: 2px; }
  .modal-footer-btn.primary {
    background: linear-gradient(180deg,#8B5CF6,#7C3AED);
    border-color: #7C3AED; color: #fff;
  }
  .modal-footer-btn.primary:hover { filter: brightness(1.08); background: linear-gradient(180deg,#8B5CF6,#7C3AED); }
  .modal-footer-btn.danger {
    background: linear-gradient(180deg,#EF4444,#DC2626);
    border-color: #DC2626; color: #fff;
  }
  .modal-footer-btn.danger:hover { filter: brightness(1.08); background: linear-gradient(180deg,#EF4444,#DC2626); }
  .modal-footer-btn.ghost {
    background: transparent;
    border-color: rgba(255,255,255,0.12);
    color: #BBB;
  }

  @keyframes pfModalFadeIn  { from { opacity: 0 } to { opacity: 1 } }
  @keyframes pfModalFadeOut { from { opacity: 1 } to { opacity: 0 } }
  @keyframes pfModalSlideUp {
    from { transform: translateY(14px); opacity: 0 }
    to   { transform: translateY(0);    opacity: 1 }
  }
  `
  document.head.appendChild(s)
}

// ---------- Scroll-Lock auf <html> ----------
// Verwendet einen Zähler-Datensatz, damit verschachtelte Modals sauber bleiben.
function acquireScrollLock() {
  if (typeof document === 'undefined') return
  const html = document.documentElement
  const cur = Number(html.getAttribute(SCROLL_LOCK_ATTR) || '0')
  if (cur === 0) {
    html.dataset.pfScrollPrev = html.style.overflow || ''
    html.style.overflow = 'hidden'
  }
  html.setAttribute(SCROLL_LOCK_ATTR, String(cur + 1))
}
function releaseScrollLock() {
  if (typeof document === 'undefined') return
  const html = document.documentElement
  const cur = Number(html.getAttribute(SCROLL_LOCK_ATTR) || '0')
  const next = Math.max(0, cur - 1)
  if (next === 0) {
    html.style.overflow = html.dataset.pfScrollPrev || ''
    delete html.dataset.pfScrollPrev
    html.removeAttribute(SCROLL_LOCK_ATTR)
  } else {
    html.setAttribute(SCROLL_LOCK_ATTR, String(next))
  }
}

// ---------- Focus-Trap ----------
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',')

function getFocusable(root) {
  return Array.from(root.querySelectorAll(FOCUSABLE))
    .filter(el => !el.hasAttribute('aria-hidden') && el.offsetParent !== null)
}

// ---------- Render-Helper ----------
function setNode(parent, content) {
  if (content == null) { parent.innerHTML = ''; return }
  if (content instanceof HTMLElement) { parent.innerHTML = ''; parent.appendChild(content) }
  else if (typeof content === 'string') { parent.innerHTML = content }
  else { parent.textContent = String(content) }
}

// ---------- Main: openModal ----------
export function openModal(opts = {}) {
  injectStyles()

  const {
    title = '',
    body = '',
    onClose,
    footerActions,
    width = 560,
    hasUnsavedChanges,
    className,
    showClose = true
  } = opts

  // ----- DOM bauen -----
  const backdrop = document.createElement('div')
  backdrop.className = 'modal-backdrop'

  const card = document.createElement('div')
  card.className = 'modal-card' + (className ? ` ${className}` : '')
  card.setAttribute('role', 'dialog')
  card.setAttribute('aria-modal', 'true')
  card.style.setProperty('--modal-width', typeof width === 'number' ? `${width}px` : String(width))

  const header = document.createElement('div')
  header.className = 'modal-header'
  const titleEl = document.createElement('div')
  titleEl.className = 'modal-header-title'
  setNode(titleEl, title)
  header.appendChild(titleEl)

  let closeBtn = null
  if (showClose) {
    closeBtn = document.createElement('button')
    closeBtn.type = 'button'
    closeBtn.className = 'modal-close'
    closeBtn.setAttribute('aria-label', 'Schließen')
    closeBtn.innerHTML = '&times;'
    header.appendChild(closeBtn)
  }

  const bodyEl = document.createElement('div')
  bodyEl.className = 'modal-body'
  setNode(bodyEl, body)

  let footerEl = null
  if (Array.isArray(footerActions) && footerActions.length > 0) {
    footerEl = document.createElement('div')
    footerEl.className = 'modal-footer'
  }

  card.appendChild(header)
  card.appendChild(bodyEl)
  if (footerEl) card.appendChild(footerEl)
  backdrop.appendChild(card)
  document.body.appendChild(backdrop)

  // ----- State -----
  let closed = false
  const prevActive = document.activeElement instanceof HTMLElement ? document.activeElement : null

  // ----- KAV: visualViewport listener -----
  let kavRaf = 0
  function updateKav() {
    if (kavRaf) cancelAnimationFrame(kavRaf)
    kavRaf = requestAnimationFrame(() => {
      const vv = window.visualViewport
      if (!vv) return
      const h = Math.min(vv.height, window.innerHeight)
      // Auf Mobile (fullscreen) den vollen vv.height nutzen, sonst minus padding.
      if (window.innerWidth <= 560) {
        card.style.setProperty('--modal-vh', `${h}px`)
      } else {
        card.style.setProperty('--modal-vh', `${Math.max(280, h - 32)}px`)
      }
    })
  }
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', updateKav)
    window.visualViewport.addEventListener('scroll', updateKav)
  }
  window.addEventListener('resize', updateKav)
  updateKav()

  // ----- Close-Handling -----
  function tryClose() {
    if (closed) return
    try {
      if (typeof hasUnsavedChanges === 'function' && hasUnsavedChanges()) return
    } catch (_) { /* ignore */ }
    close(false)
  }

  function close(force = false) {
    if (closed) return
    if (!force) {
      try {
        if (typeof hasUnsavedChanges === 'function' && hasUnsavedChanges()) return
      } catch (_) {}
    }
    closed = true
    document.removeEventListener('keydown', onKey, true)
    if (window.visualViewport) {
      window.visualViewport.removeEventListener('resize', updateKav)
      window.visualViewport.removeEventListener('scroll', updateKav)
    }
    window.removeEventListener('resize', updateKav)
    openCount = Math.max(0, openCount - 1)
    backdrop.classList.add('is-closing')
    // animation 140ms — danach entfernen
    setTimeout(() => {
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop)
      releaseScrollLock()
      if (prevActive && document.contains(prevActive)) {
        try { prevActive.focus() } catch (_) {}
      }
      if (typeof onClose === 'function') {
        try { onClose() } catch (_) {}
      }
    }, 150)
  }

  // ----- Key-Handling (Escape + Focus-Trap) -----
  function onKey(e) {
    if (closed) return
    if (e.key === 'Escape') {
      e.stopPropagation()
      tryClose()
      return
    }
    if (e.key === 'Tab') {
      const items = getFocusable(card)
      if (items.length === 0) { e.preventDefault(); return }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (e.shiftKey) {
        if (active === first || !card.contains(active)) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (active === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
  }
  document.addEventListener('keydown', onKey, true)

  // ----- Backdrop-Click -----
  backdrop.addEventListener('mousedown', (e) => {
    // mousedown statt click, damit Drag-to-Backdrop (Selektion) nicht schließt.
    if (e.target === backdrop) {
      // capture initial — wir prüfen mouseup unten
      backdrop.__pfClickStart = true
    } else {
      backdrop.__pfClickStart = false
    }
  })
  backdrop.addEventListener('mouseup', (e) => {
    if (e.target === backdrop && backdrop.__pfClickStart) tryClose()
    backdrop.__pfClickStart = false
  })

  // ----- X-Button -----
  if (closeBtn) closeBtn.addEventListener('click', () => tryClose())

  // ----- Footer-Actions -----
  if (footerEl && Array.isArray(footerActions)) {
    for (const act of footerActions) {
      if (!act) continue
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'modal-footer-btn' + (act.variant ? ` ${act.variant}` : '')
      btn.textContent = act.label || 'OK'
      btn.addEventListener('click', async () => {
        const closeOnClick = act.closeOnClick !== false
        try {
          if (typeof act.onClick === 'function') {
            await act.onClick(api)
          }
          if (closeOnClick && !closed) close(true)
        } catch (e) {
          // Fehler hochreichen, aber Modal bleibt offen
          console.error('[modal] footer action failed:', e)
        }
      })
      footerEl.appendChild(btn)
    }
  }

  // ----- Scroll-Lock & Body-Counter -----
  acquireScrollLock()
  openCount += 1

  // ----- Initialer Fokus -----
  // Erstes fokussierbares Element im Body, sonst Close-Button.
  setTimeout(() => {
    if (closed) return
    const items = getFocusable(bodyEl)
    const target = items[0] || closeBtn || card
    try { target.focus({ preventScroll: true }) } catch (_) {}
  }, 30)

  // ----- Public API -----
  const api = {
    close,
    card,
    body: bodyEl,
    header,
    footer: footerEl,
    setTitle(t) { setNode(titleEl, t) },
    setBody(b) { setNode(bodyEl, b) }
  }
  return api
}

// Optional Default-Export für ergonomischen Import.
export default { openModal }
