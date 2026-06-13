/**
 * Styled Confirm-Dialog
 *
 * Drop-in-Ersatz für window.confirm() — gibt Promise<boolean> zurück.
 *
 * Verwendung:
 *   import { openConfirm } from '/hq-4b320813c307/lib/confirm.js'
 *   if (await openConfirm({ title: 'Wirklich löschen?', message: '...', danger: true })) {
 *     // … do it
 *   }
 *
 * Parameter:
 *   title         string  — Header-Titel (Pflicht)
 *   message       string  — Body-Text (optional, Mehrzeilig via \n)
 *   confirmLabel  string  — Default "OK"
 *   cancelLabel   string  — Default "Abbrechen"
 *   danger        bool    — rote Confirm-Farbe (für destruktive Aktionen)
 *   onConfirm     fn      — optional, läuft VOR resolve(true); kann async sein
 *
 * Tastatur:
 *   Enter   → confirm
 *   Esc     → cancel
 *   Tab     → focus loop
 */

const STYLE_ID = '__crm_confirm_styles__'

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return
  const s = document.createElement('style')
  s.id = STYLE_ID
  s.textContent = `
    .crm-confirm-backdrop {
      position: fixed; inset: 0;
      background: rgba(7,7,10,0.72);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      z-index: 99999;
      display: flex; align-items: center; justify-content: center;
      padding: 20px;
      animation: crmConfirmFadeIn 140ms ease-out;
    }
    .crm-confirm-card {
      background: #16161D;
      border: 1px solid #2A2A33;
      border-radius: 16px;
      box-shadow: 0 24px 64px rgba(0,0,0,0.6), 0 2px 8px rgba(0,0,0,0.4);
      max-width: 440px;
      width: 100%;
      padding: 24px;
      color: #FFFFFF;
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", system-ui, sans-serif;
      animation: crmConfirmCardIn 180ms cubic-bezier(0.2, 0.8, 0.2, 1);
    }
    .crm-confirm-title {
      font-size: 17px;
      font-weight: 600;
      margin: 0 0 8px;
      letter-spacing: -0.01em;
    }
    .crm-confirm-message {
      font-size: 14px;
      line-height: 1.5;
      color: #9CA3AF;
      margin: 0 0 20px;
      white-space: pre-wrap;
    }
    .crm-confirm-actions {
      display: flex; gap: 8px;
      justify-content: flex-end;
    }
    .crm-confirm-btn {
      border: 1px solid #2A2A33;
      background: #1C1C25;
      color: #FFFFFF;
      padding: 10px 18px;
      border-radius: 10px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: background 120ms, transform 120ms, border-color 120ms;
      font-family: inherit;
    }
    .crm-confirm-btn:hover { background: #25252F; }
    .crm-confirm-btn:active { transform: scale(0.98); }
    .crm-confirm-btn:focus-visible {
      outline: 2px solid #8B5CF6;
      outline-offset: 2px;
    }
    .crm-confirm-btn--primary {
      background: #8B5CF6;
      border-color: #8B5CF6;
    }
    .crm-confirm-btn--primary:hover { background: #7C3AED; border-color: #7C3AED; }
    .crm-confirm-btn--danger {
      background: #DC2626;
      border-color: #DC2626;
    }
    .crm-confirm-btn--danger:hover { background: #B91C1C; border-color: #B91C1C; }
    @keyframes crmConfirmFadeIn {
      from { opacity: 0; }
      to   { opacity: 1; }
    }
    @keyframes crmConfirmCardIn {
      from { opacity: 0; transform: translateY(8px) scale(0.98); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }
  `
  document.head.appendChild(s)
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Open styled confirm. Returns Promise<boolean>.
 * @param {object} opts
 * @param {string} opts.title
 * @param {string} [opts.message]
 * @param {string} [opts.confirmLabel="OK"]
 * @param {string} [opts.cancelLabel="Abbrechen"]
 * @param {boolean} [opts.danger=false]
 * @param {Function} [opts.onConfirm]
 * @returns {Promise<boolean>}
 */
export function openConfirm(opts = {}) {
  injectStyles()
  const {
    title = 'Sicher?',
    message = '',
    confirmLabel = 'OK',
    cancelLabel = 'Abbrechen',
    danger = false,
    onConfirm = null,
  } = opts

  return new Promise((resolve) => {
    const backdrop = document.createElement('div')
    backdrop.className = 'crm-confirm-backdrop'
    backdrop.setAttribute('role', 'dialog')
    backdrop.setAttribute('aria-modal', 'true')

    const confirmBtnClass = danger
      ? 'crm-confirm-btn crm-confirm-btn--danger'
      : 'crm-confirm-btn crm-confirm-btn--primary'

    backdrop.innerHTML = `
      <div class="crm-confirm-card">
        <h3 class="crm-confirm-title">${escapeHtml(title)}</h3>
        ${message ? `<p class="crm-confirm-message">${escapeHtml(message)}</p>` : ''}
        <div class="crm-confirm-actions">
          <button type="button" class="crm-confirm-btn" data-act="cancel">${escapeHtml(cancelLabel)}</button>
          <button type="button" class="${confirmBtnClass}" data-act="ok">${escapeHtml(confirmLabel)}</button>
        </div>
      </div>
    `

    const prevActive = document.activeElement
    let settled = false

    const close = async (result) => {
      if (settled) return
      settled = true
      if (result && typeof onConfirm === 'function') {
        try { await onConfirm() } catch (e) { console.error('[openConfirm] onConfirm threw', e) }
      }
      document.removeEventListener('keydown', onKey, true)
      backdrop.remove()
      try { prevActive && prevActive.focus && prevActive.focus() } catch {}
      resolve(!!result)
    }

    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(false) }
      else if (e.key === 'Enter') { e.preventDefault(); close(true) }
      else if (e.key === 'Tab') {
        const focusables = backdrop.querySelectorAll('button')
        if (!focusables.length) return
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      }
    }

    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close(false)
    })
    backdrop.querySelector('[data-act="cancel"]').addEventListener('click', () => close(false))
    backdrop.querySelector('[data-act="ok"]').addEventListener('click', () => close(true))

    document.addEventListener('keydown', onKey, true)
    document.body.appendChild(backdrop)

    // Focus primary button by default
    requestAnimationFrame(() => {
      const btn = backdrop.querySelector('[data-act="ok"]')
      btn && btn.focus()
    })
  })
}

// Convenience: globaler Zugriff für non-module Panels
if (typeof window !== 'undefined') {
  window.openConfirm = openConfirm
}

export default openConfirm
