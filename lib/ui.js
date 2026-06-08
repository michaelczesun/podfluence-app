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
    border-radius: 14px; box-shadow: 0 20px 60px rgba(0,0,0,0.5);
    max-width: 92vw; max-height: 90vh; display: flex; flex-direction: column;
    overflow: hidden;
  }
  .pf-modal-header {
    padding: 18px 20px; border-bottom: 1px solid #2A2A33;
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
    border-radius: 14px; padding: 12px 16px; font-size: 13px;
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
  .glass-card { background: rgba(22,22,29,0.6); backdrop-filter: blur(20px); border: 1px solid rgba(139,92,246,0.15); border-radius: 14px; padding: 20px; transition: all 250ms cubic-bezier(0.4,0,0.2,1); }
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
  .drawer { position: fixed; top: 0; right: 0; height: 100vh; background: rgba(11,11,15,0.95); backdrop-filter: blur(20px); border-left: 1px solid rgba(139,92,246,0.2); padding: 22px; overflow-y: auto; z-index: 100; box-shadow: -10px 0 40px rgba(0,0,0,0.5); animation: slideInRight 300ms cubic-bezier(0.4,0,0.2,1); }
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
  'settings': '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  // ---- ergänzt 2026-06-08: alle Icons die _tab-*.js + admin-home.js anfragen
  'refresh-cw': '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
  'database': '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>',
  'check-circle': '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
  'chevron-right': '<polyline points="9 18 15 12 9 6"/>',
  'chevron-left': '<polyline points="15 18 9 12 15 6"/>',
  'send': '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
  'file-text': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>',
  'pie-chart': '<path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/>',
  'alert-triangle': '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  'alert-circle': '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
  'activity': '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
  'arrow-down': '<line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>',
  'arrow-right': '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>',
  'badge-check': '<path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"/><path d="m9 12 2 2 4-4"/>',
  'ban': '<circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>',
  'bar-chart': '<line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/>',
  'chart': '<line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/>',
  'bell': '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
  'calendar': '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  'clock': '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  'crown': '<path d="m2 4 3 12h14l3-12-6 7-4-7-4 7-6-7zm3 16h14"/>',
  'edit': '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',
  'external-link': '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>',
  'eye': '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  'file': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
  'file-pdf': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><text x="7" y="18" font-size="6" fill="currentColor" stroke="none">PDF</text>',
  'globe': '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  'hard-drive': '<line x1="22" y1="12" x2="2" y2="12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><line x1="6" y1="16" x2="6.01" y2="16"/><line x1="10" y1="16" x2="10.01" y2="16"/>',
  'hash': '<line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/>',
  'headphones': '<path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>',
  'heart': '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>',
  'inbox': '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  'info': '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
  'list': '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
  'loader': '<line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/>',
  'lock': '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  'unlock': '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
  'mail': '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>',
  'mic': '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>',
  'more-horizontal': '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  'plug': '<path d="M9 2v6"/><path d="M15 2v6"/><path d="M6 8h12v4a6 6 0 0 1-12 0z"/><path d="M12 18v4"/>',
  'plus': '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  'poll': '<line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/>',
  'rss': '<path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/>',
  'save': '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>',
  'shield-check': '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/>',
  'star': '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  'trash': '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  'user': '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  'user-check': '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><polyline points="17 11 19 13 23 9"/>',
  'user-plus': '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>',
  'user-x': '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="17" y1="8" x2="23" y2="14"/><line x1="23" y1="8" x2="17" y2="14"/>',
  'x-circle': '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>',
  'zap': '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>'
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
