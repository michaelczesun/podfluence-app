// /lib/ui.js — Gemeinsame UI-Utilities für CRM-Panels
// Self-contained ES module. Style: dunkler bg #16161D, lila #8B5CF6, rounded 12px, borders #2A2A33.

// ---------- Style injection (once) ----------
const STYLE_ID = '__pf_ui_styles__';
function injectStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = `
  .pf-overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.6);
    display: flex; align-items: center; justify-content: center;
    z-index: 9999; backdrop-filter: blur(4px);
    animation: pfFadeIn .15s ease-out;
  }
  .pf-modal {
    background: #16161D; color: #E4E4E7; border: 1px solid #2A2A33;
    border-radius: 12px; box-shadow: 0 20px 60px rgba(0,0,0,0.5);
    max-width: 92vw; max-height: 90vh; display: flex; flex-direction: column;
    overflow: hidden;
  }
  .pf-modal-header {
    padding: 16px 20px; border-bottom: 1px solid #2A2A33;
    display: flex; align-items: center; justify-content: space-between;
    font-weight: 600; font-size: 15px;
  }
  .pf-modal-close {
    background: transparent; border: none; color: #71717A; cursor: pointer;
    font-size: 20px; line-height: 1; padding: 4px 8px; border-radius: 6px;
  }
  .pf-modal-close:hover { background: #2A2A33; color: #E4E4E7; }
  .pf-modal-body { padding: 20px; overflow: auto; flex: 1; font-size: 14px; line-height: 1.5; }
  .pf-modal-footer {
    padding: 12px 20px; border-top: 1px solid #2A2A33;
    display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap;
  }
  .pf-btn {
    background: #2A2A33; color: #E4E4E7; border: 1px solid #3A3A45;
    border-radius: 8px; padding: 8px 14px; font-size: 13px; font-weight: 500;
    cursor: pointer; transition: all .12s; display: inline-flex; align-items: center; gap: 6px;
  }
  .pf-btn:hover:not(:disabled) { background: #3A3A45; border-color: #4A4A55; }
  .pf-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .pf-btn-primary { background: #8B5CF6; border-color: #8B5CF6; color: white; }
  .pf-btn-primary:hover:not(:disabled) { background: #7C4DEF; border-color: #7C4DEF; }
  .pf-btn-danger { background: #DC2626; border-color: #DC2626; color: white; }
  .pf-btn-danger:hover:not(:disabled) { background: #B91C1C; border-color: #B91C1C; }
  .pf-toast-container {
    position: fixed; top: 16px; right: 16px; z-index: 10000;
    display: flex; flex-direction: column; gap: 8px; pointer-events: none;
  }
  .pf-toast {
    background: #16161D; color: #E4E4E7; border: 1px solid #2A2A33;
    border-radius: 12px; padding: 12px 16px; font-size: 13px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.4); pointer-events: auto;
    min-width: 240px; max-width: 380px;
    animation: pfFadeIn .2s ease-out;
    border-left: 3px solid #8B5CF6;
  }
  .pf-toast.success { border-left-color: #10B981; }
  .pf-toast.error { border-left-color: #DC2626; }
  .pf-toast.info { border-left-color: #8B5CF6; }
  .pf-toast.fadeout { animation: pfFadeOut .25s ease-in forwards; }
  @keyframes pfFadeIn { from { opacity:0; transform: translateY(-6px); } to { opacity:1; transform: translateY(0); } }
  @keyframes pfFadeOut { from { opacity:1; } to { opacity:0; transform: translateY(-6px); } }
  .pf-spinner {
    display: inline-block; width: 14px; height: 14px;
    border: 2px solid #3A3A45; border-top-color: #8B5CF6;
    border-radius: 50%; animation: pfSpin .8s linear infinite;
    vertical-align: middle; margin-right: 6px;
  }
  @keyframes pfSpin { to { transform: rotate(360deg); } }
  .pf-input {
    background: #0F0F14; color: #E4E4E7; border: 1px solid #2A2A33;
    border-radius: 8px; padding: 8px 12px; font-size: 13px; outline: none;
    transition: border-color .12s;
  }
  .pf-input:focus { border-color: #8B5CF6; }
  .pf-search {
    background: #0F0F14; color: #E4E4E7; border: 1px solid #2A2A33;
    border-radius: 10px; padding: 9px 14px; font-size: 13px; outline: none;
    width: 100%; box-sizing: border-box;
  }
  .pf-search:focus { border-color: #8B5CF6; }
  .pf-pagination {
    display: flex; align-items: center; gap: 12px; padding: 12px 0;
    font-size: 13px; color: #A1A1AA; justify-content: center;
  }
  .pf-action-row { display: inline-flex; gap: 6px; flex-wrap: wrap; }
  `;
  document.head.appendChild(s);
}
injectStyles();

// ---------- htmlEscape ----------
export function htmlEscape(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------- debounce ----------
export function debounce(fn, ms = 250) {
  let t;
  const debounced = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  debounced.cancel = () => clearTimeout(t);
  return debounced;
}

// ---------- modal ----------
export function modal({ title, content, footer, width = 600 }) {
  injectStyles();
  const overlay = document.createElement('div');
  overlay.className = 'pf-overlay';

  const m = document.createElement('div');
  m.className = 'pf-modal';
  m.style.width = typeof width === 'number' ? `${width}px` : width;

  const header = document.createElement('div');
  header.className = 'pf-modal-header';
  const titleEl = document.createElement('span');
  titleEl.textContent = title || '';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'pf-modal-close';
  closeBtn.setAttribute('aria-label', 'Schließen');
  closeBtn.innerHTML = '&times;';
  header.appendChild(titleEl);
  header.appendChild(closeBtn);

  const body = document.createElement('div');
  body.className = 'pf-modal-body';
  if (content instanceof HTMLElement) body.appendChild(content);
  else if (typeof content === 'string') body.innerHTML = content;

  m.appendChild(header);
  m.appendChild(body);

  if (footer) {
    const f = document.createElement('div');
    f.className = 'pf-modal-footer';
    if (footer instanceof HTMLElement) f.appendChild(footer);
    else if (typeof footer === 'string') f.innerHTML = footer;
    m.appendChild(f);
  }

  overlay.appendChild(m);
  document.body.appendChild(overlay);

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    overlay.remove();
  }
  function onKey(e) {
    if (e.key === 'Escape') close();
  }
  document.addEventListener('keydown', onKey);
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  return { close, root: m, body };
}

// ---------- confirmDialog ----------
export function confirmDialog(title, message, confirmLabel = 'Bestätigen', danger = false) {
  return new Promise((resolve) => {
    const footer = document.createElement('div');
    footer.style.display = 'flex';
    footer.style.gap = '8px';
    footer.style.justifyContent = 'flex-end';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'pf-btn';
    cancelBtn.textContent = 'Abbrechen';

    const okBtn = document.createElement('button');
    okBtn.className = 'pf-btn ' + (danger ? 'pf-btn-danger' : 'pf-btn-primary');
    okBtn.textContent = confirmLabel;

    footer.appendChild(cancelBtn);
    footer.appendChild(okBtn);

    const msgEl = document.createElement('div');
    msgEl.textContent = message || '';

    const { close } = modal({ title, content: msgEl, footer, width: 460 });

    let resolved = false;
    function done(v) {
      if (resolved) return;
      resolved = true;
      close();
      resolve(v);
    }
    cancelBtn.addEventListener('click', () => done(false));
    okBtn.addEventListener('click', () => done(true));

    // Hook into ESC via overlay click — modal's own ESC closes without resolving true
    const obs = new MutationObserver(() => {
      if (!document.body.contains(okBtn)) done(false);
    });
    obs.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => okBtn.focus(), 50);
  });
}

// ---------- toast ----------
let toastContainer = null;
function ensureToastContainer() {
  injectStyles();
  if (toastContainer && document.body.contains(toastContainer)) return toastContainer;
  toastContainer = document.createElement('div');
  toastContainer.className = 'pf-toast-container';
  document.body.appendChild(toastContainer);
  return toastContainer;
}
export function toast(msg, kind = 'info', durationMs = 3000) {
  const c = ensureToastContainer();
  const el = document.createElement('div');
  el.className = `pf-toast ${kind}`;
  el.textContent = msg;
  c.appendChild(el);
  const remove = () => {
    el.classList.add('fadeout');
    setTimeout(() => el.remove(), 250);
  };
  el.addEventListener('click', remove);
  setTimeout(remove, durationMs);
}

// ---------- spinnerHtml ----------
export function spinnerHtml(label = '') {
  return `<span class="pf-spinner"></span>${label ? htmlEscape(label) : ''}`;
}

// ---------- fmtNumber ----------
export function fmtNumber(n, opts = {}) {
  if (n == null || isNaN(n)) return '–';
  try {
    return new Intl.NumberFormat('de-DE', opts).format(n);
  } catch {
    return String(n);
  }
}

// ---------- fmtRelativeTime ----------
export function fmtRelativeTime(date) {
  if (!date) return '';
  const d = (date instanceof Date) ? date : new Date(date);
  if (isNaN(d.getTime())) return '';
  const diffSec = Math.round((Date.now() - d.getTime()) / 1000);
  const abs = Math.abs(diffSec);
  const past = diffSec >= 0;
  if (abs < 30) return 'gerade';
  const units = [
    { s: 60, name: 'Sek', singular: 'Sek' },
    { s: 3600, name: 'Min', singular: 'Min', div: 60 },
    { s: 86400, name: 'Std', singular: 'Std', div: 3600 },
    { s: 604800, name: 'Tagen', singular: 'Tag', div: 86400 },
    { s: 2629800, name: 'Wochen', singular: 'Woche', div: 604800 },
    { s: 31557600, name: 'Monaten', singular: 'Monat', div: 2629800 },
    { s: Infinity, name: 'Jahren', singular: 'Jahr', div: 31557600 }
  ];
  for (const u of units) {
    if (abs < u.s) {
      const val = Math.max(1, Math.floor(abs / (u.div || 1)));
      const name = val === 1 ? u.singular : u.name;
      return past ? `vor ${val} ${name}` : `in ${val} ${name}`;
    }
  }
  return d.toLocaleDateString('de-DE');
}

// ---------- fmtDateTime ----------
export function fmtDateTime(date) {
  if (!date) return '';
  const d = (date instanceof Date) ? date : new Date(date);
  if (isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---------- exportCsv ----------
export function exportCsv(rows, columns, filename = 'export.csv') {
  // columns: [{ key, label }] or string[]
  const cols = (columns || []).map(c => typeof c === 'string' ? { key: c, label: c } : c);
  const escape = (v) => {
    if (v == null) return '';
    const s = String(v);
    if (/[",;\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  const header = cols.map(c => escape(c.label ?? c.key)).join(';');
  const lines = (rows || []).map(r =>
    cols.map(c => {
      let v = r?.[c.key];
      if (v instanceof Date) v = fmtDateTime(v);
      return escape(v);
    }).join(';')
  );
  const csv = '﻿' + [header, ...lines].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : filename + '.csv';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 100);
}

// ---------- copyToClipboard ----------
export async function copyToClipboard(text) {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    toast('In Zwischenablage kopiert', 'success', 2000);
    return true;
  } catch (e) {
    toast('Kopieren fehlgeschlagen', 'error', 2500);
    return false;
  }
}

// ---------- renderActionButtons ----------
export function renderActionButtons(actions = []) {
  const frag = document.createDocumentFragment();
  const wrap = document.createElement('span');
  wrap.className = 'pf-action-row';
  for (const a of actions) {
    const btn = document.createElement('button');
    btn.className = 'pf-btn' + (a.danger ? ' pf-btn-danger' : '');
    if (a.disabled) btn.disabled = true;
    if (a.icon) {
      const ic = document.createElement('span');
      ic.innerHTML = a.icon;
      btn.appendChild(ic);
    }
    const lbl = document.createElement('span');
    lbl.textContent = a.label || '';
    btn.appendChild(lbl);
    if (a.onClick) btn.addEventListener('click', (e) => a.onClick(e));
    wrap.appendChild(btn);
  }
  frag.appendChild(wrap);
  return frag;
}

// ---------- searchInput ----------
export function searchInput(onChange, placeholder = 'Suchen…') {
  const input = document.createElement('input');
  input.type = 'search';
  input.className = 'pf-search';
  input.placeholder = placeholder;
  const debounced = debounce((v) => onChange?.(v), 250);
  input.addEventListener('input', () => debounced(input.value));
  return input;
}

// ---------- pagination ----------
export function pagination({ page, pageSize, total, onPage }) {
  const wrap = document.createElement('div');
  wrap.className = 'pf-pagination';
  const totalPages = Math.max(1, Math.ceil((total || 0) / (pageSize || 1)));
  const cur = Math.min(Math.max(1, page || 1), totalPages);

  const prev = document.createElement('button');
  prev.className = 'pf-btn';
  prev.textContent = '‹ Zurück';
  prev.disabled = cur <= 1;
  prev.addEventListener('click', () => onPage?.(cur - 1));

  const info = document.createElement('span');
  info.textContent = `Seite ${cur} von ${totalPages}` + (total ? `  ·  ${fmtNumber(total)} gesamt` : '');

  const next = document.createElement('button');
  next.className = 'pf-btn';
  next.textContent = 'Weiter ›';
  next.disabled = cur >= totalPages;
  next.addEventListener('click', () => onPage?.(cur + 1));

  wrap.appendChild(prev);
  wrap.appendChild(info);
  wrap.appendChild(next);
  return wrap;
}

export default {
  confirmDialog, modal, toast, spinnerHtml,
  fmtNumber, fmtRelativeTime, fmtDateTime,
  exportCsv, copyToClipboard, debounce, htmlEscape,
  renderActionButtons, searchInput, pagination
};

// ---------- Premium styles injection (once) ----------
const PREMIUM_STYLE_ID = '__pf_ui_premium_styles__';
function injectPremiumStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(PREMIUM_STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = PREMIUM_STYLE_ID;
  s.textContent = `
  .glass-card { background: rgba(22,22,29,0.6); backdrop-filter: blur(20px); border: 1px solid rgba(139,92,246,0.15); border-radius: 16px; padding: 20px; transition: all 250ms cubic-bezier(0.4,0,0.2,1); }
  .glass-card:hover { border-color: rgba(139,92,246,0.35); transform: translateY(-2px); box-shadow: 0 12px 40px rgba(139,92,246,0.15); }
  .hero-stat { display: flex; flex-direction: column; gap: 8px; }
  .hero-stat .label { font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: #9CA3AF; }
  .hero-stat .value { font-size: 48px; font-weight: 700; color: #fff; line-height: 1; font-variant-numeric: tabular-nums; }
  .hero-stat .change { display: inline-flex; align-items: center; gap: 4px; font-size: 13px; padding: 4px 10px; border-radius: 20px; }
  .hero-stat .change.up { color: #34D399; background: rgba(52,211,153,0.1); }
  .hero-stat .change.down { color: #F87171; background: rgba(248,113,113,0.1); }
  .toolbar { display: flex; gap: 8px; align-items: center; padding: 8px 0; }
  .toolbar-btn { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 8px 14px; border-radius: 10px; font-size: 13px; cursor: pointer; transition: all 200ms; display: inline-flex; align-items: center; gap: 6px; }
  .toolbar-btn:hover { background: rgba(139,92,246,0.15); border-color: rgba(139,92,246,0.4); }
  .toolbar-btn.primary { background: linear-gradient(135deg, #8B5CF6, #7C3AED); border: none; }
  .toolbar-btn.danger { color: #F87171; border-color: rgba(248,113,113,0.3); }
  .subnav { display: flex; gap: 4px; background: rgba(255,255,255,0.05); border-radius: 12px; padding: 4px; margin-bottom: 16px; width: fit-content; }
  .subnav-item { padding: 8px 16px; border-radius: 8px; font-size: 13px; color: #9CA3AF; cursor: pointer; transition: all 200ms; }
  .subnav-item.active { background: rgba(139,92,246,0.2); color: #fff; }
  .skeleton { background: linear-gradient(90deg, rgba(255,255,255,0.03), rgba(255,255,255,0.08), rgba(255,255,255,0.03)); background-size: 200% 100%; animation: shimmer 1.5s infinite; border-radius: 8px; }
  @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
  .drawer { position: fixed; top: 0; right: 0; height: 100vh; background: rgba(11,11,15,0.95); backdrop-filter: blur(20px); border-left: 1px solid rgba(139,92,246,0.2); padding: 24px; overflow-y: auto; z-index: 100; box-shadow: -10px 0 40px rgba(0,0,0,0.5); animation: slideInRight 300ms cubic-bezier(0.4,0,0.2,1); }
  .drawer-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 99; animation: fadeIn 200ms; }
  @keyframes slideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } }
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  `;
  document.head.appendChild(s);
}
injectPremiumStyles();

// ---------- iconHtml (lucide-style SVG icons) ----------
const ICON_PATHS = {
  'download': '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  'refresh': '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
  'search': '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  'filter': '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>',
  'x': '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  'check': '<polyline points="20 6 9 17 4 12"/>',
  'alert': '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
  'trending-up': '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>',
  'trending-down': '<polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/>',
  'users': '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  'podcast': '<path d="M12 2a9 9 0 0 0-9 9c0 3.18 1.65 5.97 4.14 7.57"/><path d="M21 11a9 9 0 0 0-9-9"/><circle cx="12" cy="11" r="2"/><path d="M12 17v5"/>',
  'play': '<polygon points="5 3 19 12 5 21 5 3"/>',
  'settings': '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>'
};
export function iconHtml(name) {
  const body = ICON_PATHS[name];
  if (!body) return '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

// promptDialog — fehlte, panel-actions.js importiert es aber. Minimaler
// Wrapper um window.prompt damit der ganze Action-Pfad nicht crasht.
// Signatur: ({ title, message, placeholder, defaultValue }) → string|null
export async function promptDialog(opts = {}) {
  const { title = '', message = '', placeholder = '', defaultValue = '' } = opts;
  const label = [title, message].filter(Boolean).join('\n\n') +
                (placeholder ? `\n(${placeholder})` : '');
  // eslint-disable-next-line no-alert
  const r = window.prompt(label, defaultValue);
  return r;
}
