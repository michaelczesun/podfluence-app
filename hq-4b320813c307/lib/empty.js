// crm/lib/empty.js — Shared Empty-State Component
//
// Glas-Card mit großem Icon/Emoji, 2 Textzeilen, optional CTA-Button.
// Ersetzt textlose leere Cards quer durchs CRM.
//
// API:
//   emptyState({ icon, title, message, ctaLabel, ctaHref, ctaOnClick })
//     → HTML-String
//
// Parameter:
//   icon        string — Emoji oder Text (z.B. '🔇'). Optional.
//   title       string — Fett, Hauptzeile (Pflicht).
//   message     string — Sub-Zeile, dezent. Optional.
//   ctaLabel    string — Button-Text. Optional.
//   ctaHref     string — Hash-Link (#panel/foo). Optional, gegenseitig zu ctaOnClick.
//   ctaOnClick  string — JS-Hook (z.B. data-action). Optional.
//
// Selektoren:
//   .crm-empty            — Wrapper-Card
//   .crm-empty__icon
//   .crm-empty__title
//   .crm-empty__msg
//   .crm-empty__cta

const STYLE_ID = '__crm_empty_styles__'

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return
  const s = document.createElement('style')
  s.id = STYLE_ID
  s.textContent = `
    .crm-empty{
      display:flex; flex-direction:column; align-items:center; justify-content:center;
      gap:10px; padding:48px 24px; text-align:center;
      border-radius:18px;
      background:color-mix(in srgb, var(--text,#fff) 3%, transparent);
      border:1px solid color-mix(in srgb, var(--text,#fff) 8%, transparent);
      color:var(--text-muted,#8e8e93);
    }
    .crm-empty__icon{
      font-size:42px; line-height:1; margin-bottom:4px;
      filter:drop-shadow(0 4px 14px rgba(124,92,255,0.18));
    }
    .crm-empty__title{
      font-size:16px; font-weight:700; color:var(--text,#fff);
      letter-spacing:-0.01em;
    }
    .crm-empty__msg{
      font-size:13px; max-width:380px; line-height:1.45;
    }
    .crm-empty__cta{
      margin-top:10px; padding:9px 16px; border-radius:10px;
      border:none; cursor:pointer; font-weight:600; font-size:13px;
      background:linear-gradient(135deg,#7C5CFF,#22D3EE); color:#fff;
      text-decoration:none; display:inline-block;
      transition:transform .15s ease, box-shadow .15s ease;
    }
    .crm-empty__cta:hover{ transform:translateY(-1px); box-shadow:0 6px 18px rgba(124,92,255,0.35) }
  `
  document.head.appendChild(s)
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]))
}

export function emptyState({ icon, title, message, ctaLabel, ctaHref, ctaOnClick } = {}) {
  injectStyles()
  const iconHtml = icon ? `<div class="crm-empty__icon">${esc(icon)}</div>` : ''
  const titleHtml = title ? `<div class="crm-empty__title">${esc(title)}</div>` : ''
  const msgHtml = message ? `<div class="crm-empty__msg">${esc(message)}</div>` : ''
  let ctaHtml = ''
  if (ctaLabel) {
    if (ctaHref) {
      ctaHtml = `<a class="crm-empty__cta" href="${esc(ctaHref)}">${esc(ctaLabel)}</a>`
    } else {
      const hook = ctaOnClick ? ` data-action="${esc(ctaOnClick)}"` : ''
      ctaHtml = `<button class="crm-empty__cta" type="button"${hook}>${esc(ctaLabel)}</button>`
    }
  }
  return `<div class="crm-empty">${iconHtml}${titleHtml}${msgHtml}${ctaHtml}</div>`
}

export default emptyState
