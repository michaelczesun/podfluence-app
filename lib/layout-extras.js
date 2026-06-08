/* layout-extras.js — CRM Panel Layout Components
 * Vanilla JS. Glassmorphism style.
 */
(function (global) {
  'use strict';

  // ---------- Style Injection ----------
  const STYLE_ID = 'layout-extras-styles';
  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const css = `
    :root {
      --lx-purple: rgba(139,92,246,1);
      --lx-purple-soft: rgba(139,92,246,0.15);
      --lx-purple-glow: 0 8px 32px rgba(139,92,246,0.15), 0 0 0 1px rgba(139,92,246,0.18);
      /* Dark-Theme passend zum CRM (--bg-deep #07070A in index.html).
         Vorher war es Light-Theme → unlesbar dunkler Text auf hellem Drawer. */
      --lx-bg-glass: rgba(22,22,29,0.92);
      --lx-bg-glass-dark: rgba(11,11,15,0.95);
      --lx-border: rgba(139,92,246,0.18);
      --lx-text: #FFFFFF;
      --lx-text-soft: rgba(255,255,255,0.65);
      --lx-surface-elev: rgba(255,255,255,0.04);
      --lx-ease: cubic-bezier(.22,.61,.36,1);
    }

    .lx-backdrop {
      position: fixed; inset: 0;
      background: rgba(10,8,20,0.45);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
      opacity: 0;
      transition: opacity 250ms var(--lx-ease);
      z-index: 9998;
    }
    .lx-backdrop.lx-show { opacity: 1; }

    .lx-drawer {
      position: fixed; top: 0; right: 0; bottom: 0;
      background: var(--lx-bg-glass);
      backdrop-filter: blur(20px) saturate(180%);
      -webkit-backdrop-filter: blur(20px) saturate(180%);
      border-left: 1px solid var(--lx-border);
      box-shadow: -20px 0 60px rgba(139,92,246,0.15), -1px 0 0 rgba(139,92,246,0.08);
      transform: translateX(100%);
      transition: transform 250ms var(--lx-ease);
      z-index: 9999;
      display: flex; flex-direction: column;
      color: var(--lx-text);
    }
    .lx-drawer.lx-show { transform: translateX(0); }
    .lx-drawer-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 20px 22px;
      border-bottom: 1px solid rgba(139,92,246,0.08);
    }
    .lx-drawer-title { font-size: 18px; font-weight: 600; letter-spacing: -0.01em; }
    .lx-drawer-close {
      width: 32px; height: 32px; border-radius: 10px;
      border: none; background: rgba(139,92,246,0.08);
      color: var(--lx-text); cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      font-size: 18px; line-height: 1;
      transition: background 250ms var(--lx-ease), transform 250ms var(--lx-ease);
    }
    .lx-drawer-close:hover { background: rgba(139,92,246,0.18); transform: rotate(90deg); }
    .lx-drawer-content {
      flex: 1; overflow-y: auto; padding: 22px;
    }

    .lx-tabs {
      display: flex; align-items: center; gap: 4px;
      padding: 4px;
      background: rgba(139,92,246,0.06);
      border-radius: 12px;
      margin-bottom: 16px;
    }
    .lx-tab {
      flex: 1; padding: 8px 14px;
      border: none; background: transparent;
      border-radius: 9px; cursor: pointer;
      font-size: 13px; font-weight: 500; color: var(--lx-text-soft);
      transition: all 250ms var(--lx-ease);
    }
    .lx-tab:hover { color: var(--lx-text); }
    .lx-tab.lx-active {
      background: var(--lx-bg-glass);
      color: #fff;
      box-shadow: 0 2px 8px rgba(139,92,246,0.25), 0 0 0 1px rgba(139,92,246,0.35);
    }
    .lx-tab-panel { display: none; }
    .lx-tab-panel.lx-active { display: block; animation: lxFadeIn 250ms var(--lx-ease); }

    .lx-segmented {
      display: inline-flex; align-items: center; gap: 2px;
      padding: 3px;
      background: rgba(139,92,246,0.08);
      border-radius: 999px;
      position: relative;
    }
    .lx-seg-btn {
      padding: 6px 14px;
      border: none; background: transparent;
      border-radius: 999px; cursor: pointer;
      font-size: 12px; font-weight: 600; color: var(--lx-text-soft);
      transition: color 250ms var(--lx-ease);
      position: relative; z-index: 1;
    }
    .lx-seg-btn.lx-active {
      color: #fff;
      background: linear-gradient(135deg, rgba(139,92,246,1), rgba(168,85,247,1));
      box-shadow: 0 4px 12px rgba(139,92,246,0.35);
    }
    .lx-seg-btn:not(.lx-active):hover { color: var(--lx-text); }

    .lx-trp {
      display: flex; flex-direction: column; gap: 10px;
    }
    .lx-trp-custom {
      display: none; gap: 8px; align-items: center;
      padding: 10px 12px;
      background: rgba(139,92,246,0.06);
      border-radius: 12px;
    }
    .lx-trp-custom.lx-show { display: flex; }
    .lx-trp-custom input {
      flex: 1; padding: 6px 10px;
      border: 1px solid rgba(139,92,246,0.25);
      border-radius: 8px;
      background: rgba(255,255,255,0.06);
      font-size: 13px; color: var(--lx-text);
      outline: none;
      transition: border-color 250ms var(--lx-ease);
    }
    .lx-trp-custom input::-webkit-calendar-picker-indicator { filter: invert(1); opacity: 0.7; }
    .lx-trp-custom input:focus { border-color: var(--lx-purple); }
    .lx-trp-custom span { font-size: 12px; color: var(--lx-text-soft); }

    .lx-hero {
      padding: 22px 22px 20px;
      background: var(--lx-bg-glass);
      backdrop-filter: blur(20px) saturate(180%);
      -webkit-backdrop-filter: blur(20px) saturate(180%);
      border: 1px solid var(--lx-border);
      border-radius: 14px;
      box-shadow: var(--lx-purple-glow);
      color: var(--lx-text);
      position: relative; overflow: hidden;
    }
    .lx-hero::before {
      content: ''; position: absolute; top: 0; left: 0; right: 0; height: 1px;
      background: linear-gradient(90deg, transparent, rgba(139,92,246,0.4), transparent);
    }
    .lx-hero-row {
      display: flex; align-items: center; justify-content: space-between; gap: 16px;
    }
    .lx-hero-label {
      font-size: 12px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase;
      color: var(--lx-text-soft);
      margin-bottom: 8px;
    }
    .lx-hero-value {
      font-size: 44px; font-weight: 700; letter-spacing: -0.02em;
      color: var(--lx-text); line-height: 1;
      font-variant-numeric: tabular-nums;
    }
    .lx-hero-icon {
      width: 56px; height: 56px; border-radius: 16px;
      display: flex; align-items: center; justify-content: center;
      background: linear-gradient(135deg, rgba(139,92,246,0.18), rgba(168,85,247,0.1));
      color: var(--lx-purple);
      font-size: 26px;
      flex-shrink: 0;
    }
    .lx-hero-icon svg { width: 28px; height: 28px; stroke: currentColor; }
    .lx-hero-change {
      display: inline-flex; align-items: center; gap: 4px;
      margin-top: 10px;
      padding: 4px 10px;
      border-radius: 999px;
      font-size: 12px; font-weight: 600;
    }
    .lx-hero-change.lx-up { background: rgba(34,197,94,0.18); color: rgb(134,239,172); }
    .lx-hero-change.lx-down { background: rgba(239,68,68,0.18); color: rgb(252,165,165); }
    .lx-hero-change.lx-neutral { background: rgba(148,163,184,0.18); color: rgb(203,213,225); }

    .lx-glass {
      padding: 20px;
      background: var(--lx-bg-glass);
      backdrop-filter: blur(20px) saturate(180%);
      -webkit-backdrop-filter: blur(20px) saturate(180%);
      border: 1px solid var(--lx-border);
      border-radius: 14px;
      box-shadow:
        0 8px 32px rgba(139,92,246,0.15),
        0 0 0 1px rgba(139,92,246,0.06),
        inset 0 1px 0 rgba(255,255,255,0.06);
      position: relative;
      transition: transform 250ms var(--lx-ease), box-shadow 250ms var(--lx-ease);
    }
    .lx-glass::after {
      content: ''; position: absolute; inset: 0;
      border-radius: 14px;
      padding: 1px;
      background: linear-gradient(135deg, rgba(139,92,246,0.4), transparent 40%, transparent 60%, rgba(168,85,247,0.3));
      -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
      -webkit-mask-composite: xor;
              mask-composite: exclude;
      pointer-events: none;
    }

    @keyframes lxFadeIn {
      from { opacity: 0; transform: translateY(4px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    /* ---------- pullToRefresh ---------- */
    .lx-ptr-host { position: relative; overflow-anchor: none; }
    .lx-ptr-indicator {
      position: absolute; top: 0; left: 50%;
      transform: translate(-50%, -100%);
      width: 36px; height: 36px;
      display: flex; align-items: center; justify-content: center;
      background: var(--lx-bg-glass);
      border: 1px solid var(--lx-border);
      border-radius: 50%;
      box-shadow: 0 4px 16px rgba(139,92,246,0.25);
      color: var(--lx-text);
      pointer-events: none;
      opacity: 0;
      z-index: 5;
      transition: opacity 180ms var(--lx-ease);
    }
    .lx-ptr-indicator.lx-armed { background: var(--lx-purple-soft); border-color: var(--lx-purple); }
    .lx-ptr-arrow {
      width: 14px; height: 14px;
      border-left: 2px solid currentColor;
      border-bottom: 2px solid currentColor;
      transform: rotate(-45deg);
      transition: transform 180ms var(--lx-ease);
      margin-top: -3px;
    }
    .lx-ptr-indicator.lx-armed .lx-ptr-arrow { transform: rotate(135deg); margin-top: 3px; }
    .lx-ptr-spinner {
      width: 18px; height: 18px;
      border-radius: 50%;
      border: 2px solid rgba(255,255,255,0.18);
      border-top-color: var(--lx-purple);
      animation: lxPtrSpin 0.8s linear infinite;
    }
    @keyframes lxPtrSpin { to { transform: rotate(360deg); } }
    `;
    const tag = document.createElement('style');
    tag.id = STYLE_ID;
    tag.textContent = css;
    document.head.appendChild(tag);
  }

  // ---------- Helpers ----------
  function el(tag, attrs, html) {
    const e = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        if (k === 'class') e.className = attrs[k];
        else if (k === 'style') e.style.cssText = attrs[k];
        else e.setAttribute(k, attrs[k]);
      }
    }
    if (html != null) e.innerHTML = html;
    return e;
  }

  function ensureContainer(c) {
    if (typeof c === 'string') return document.querySelector(c);
    return c;
  }

  // ---------- drawer ----------
  function drawer(opts) {
    injectStyles();
    opts = opts || {};
    const width = opts.width || 480;
    const title = opts.title || '';
    // Backwards-compat: Panels nutzen variabel {contentHtml|html|bodyHtml|body} und {content}.
    // Akzeptiere alle Aliasse statt leeren Drawer zu rendern.
    const contentHtml = opts.contentHtml || opts.html || opts.bodyHtml || opts.body || '';
    const contentNode = (opts.content instanceof Node) ? opts.content : null;
    const subtitle = opts.subtitle || '';
    const onClose = typeof opts.onClose === 'function' ? opts.onClose : null;
    const onMount = typeof opts.onMount === 'function' ? opts.onMount : null;

    // Full-Page Slide-In auf Mobile: <768px → komplette Viewport-Breite, Back-Button-Header
    const isMobile = (typeof window !== 'undefined' && window.innerWidth < 768);

    const backdrop = el('div', { class: 'lx-backdrop' });
    const rootClass = 'lx-drawer' + (isMobile ? ' lx-drawer-mobile-fullscreen' : '');
    const rootStyle = isMobile
      ? 'width:100vw;max-width:100vw;'
      : `width:${width}px;max-width:100vw;`;
    const root = el('div', { class: rootClass, style: rootStyle });

    const header = el('div', { class: 'lx-drawer-header' });
    let closeBtn;
    if (isMobile) {
      // Back-Button links, Titel rechts daneben — statt Close-X rechts.
      closeBtn = el('button', {
        class: 'lx-drawer-back',
        'aria-label': 'Zurück'
      }, '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>');
      header.appendChild(closeBtn);
      const titleWrap = el('div', { style: 'flex:1;min-width:0;' });
      titleWrap.appendChild(el('div', { class: 'lx-drawer-title' }, title));
      if (subtitle) {
        titleWrap.appendChild(el('div', {
          class: 'lx-drawer-subtitle',
          style: 'font-size:12px;color:var(--lx-text-soft);margin-top:4px;'
        }, subtitle));
      }
      header.appendChild(titleWrap);
    } else {
      const titleWrap = el('div');
      titleWrap.appendChild(el('div', { class: 'lx-drawer-title' }, title));
      if (subtitle) {
        titleWrap.appendChild(el('div', {
          class: 'lx-drawer-subtitle',
          style: 'font-size:12px;color:var(--lx-text-soft);margin-top:4px;'
        }, subtitle));
      }
      header.appendChild(titleWrap);
      closeBtn = el('button', { class: 'lx-drawer-close', 'aria-label': 'Close' }, '&times;');
      header.appendChild(closeBtn);
    }

    const content = el('div', { class: 'lx-drawer-content' }, contentHtml);
    if (contentNode instanceof Node) { content.innerHTML = ''; content.appendChild(contentNode); }

    root.appendChild(header);
    root.appendChild(content);

    document.body.appendChild(backdrop);
    document.body.appendChild(root);

    let closed = false;
    function close() {
      if (closed) return;
      closed = true;
      backdrop.classList.remove('lx-show');
      root.classList.remove('lx-show');
      document.removeEventListener('keydown', onKey);
      setTimeout(() => {
        backdrop.remove();
        root.remove();
      }, 280);
      if (onClose) onClose();
    }

    function onKey(e) {
      if (e.key === 'Escape') close();
    }

    closeBtn.addEventListener('click', close);
    backdrop.addEventListener('click', close);
    document.addEventListener('keydown', onKey);

    requestAnimationFrame(() => {
      backdrop.classList.add('lx-show');
      root.classList.add('lx-show');
      if (onMount) {
        try { onMount(content); } catch (e) { console.warn('[drawer] onMount threw', e); }
      }
    });

    function setContent(html) {
      if (typeof html === 'string') content.innerHTML = html;
      else if (html instanceof Node) {
        content.innerHTML = '';
        content.appendChild(html);
      }
    }

    return { close, root, setContent };
  }

  // ---------- tabs ----------
  function tabs(container, tabsArray) {
    injectStyles();
    container = ensureContainer(container);
    if (!container || !Array.isArray(tabsArray) || !tabsArray.length) return;

    container.innerHTML = '';
    const nav = el('div', { class: 'lx-tabs', role: 'tablist' });
    const panels = el('div', { class: 'lx-tab-panels' });

    const refs = [];

    tabsArray.forEach((t, i) => {
      const btn = el('button', { class: 'lx-tab', role: 'tab', 'data-key': t.key }, t.label);
      const panel = el('div', { class: 'lx-tab-panel', 'data-key': t.key });
      if (t.content instanceof HTMLElement) panel.appendChild(t.content);
      else if (typeof t.content === 'function') {
        const out = t.content();
        if (out instanceof HTMLElement) panel.appendChild(out);
        else if (typeof out === 'string') panel.innerHTML = out;
      } else if (typeof t.content === 'string') {
        panel.innerHTML = t.content;
      }
      nav.appendChild(btn);
      panels.appendChild(panel);
      refs.push({ btn, panel, key: t.key });

      btn.addEventListener('click', () => activate(t.key));
    });

    function activate(key) {
      refs.forEach(r => {
        const on = r.key === key;
        r.btn.classList.toggle('lx-active', on);
        r.panel.classList.toggle('lx-active', on);
      });
    }

    container.appendChild(nav);
    container.appendChild(panels);
    activate(tabsArray[0].key);

    return { activate };
  }

  // ---------- segmentedControl ----------
  function segmentedControl(container, options, activeKey, onChange) {
    injectStyles();
    container = ensureContainer(container);
    if (!container) return;

    // Accept object-form signature: segmentedControl(host, { options, value, onChange, activeKey })
    if (options && !Array.isArray(options) && typeof options === 'object') {
      const cfg = options;
      options = cfg.options || cfg.items || [];
      activeKey = cfg.value != null ? cfg.value : (cfg.activeKey != null ? cfg.activeKey : activeKey);
      onChange = cfg.onChange || onChange;
    }

    if (!Array.isArray(options)) options = [];

    const wrap = el('div', { class: 'lx-segmented', role: 'tablist' });
    const refs = [];

    options.forEach(opt => {
      const key = typeof opt === 'object' ? opt.key : opt;
      const label = typeof opt === 'object' ? (opt.label || opt.key) : opt;
      const btn = el('button', { class: 'lx-seg-btn', 'data-key': key }, label);
      btn.addEventListener('click', () => {
        setActive(key);
        if (typeof onChange === 'function') onChange(key);
      });
      wrap.appendChild(btn);
      refs.push({ btn, key });
    });

    function setActive(key) {
      refs.forEach(r => r.btn.classList.toggle('lx-active', r.key === key));
    }

    container.appendChild(wrap);
    setActive(activeKey || (typeof options[0] === 'object' ? options[0].key : options[0]));

    return { setActive, root: wrap };
  }

  // ---------- timeRangePicker ----------
  function timeRangePicker(container, onChange) {
    injectStyles();
    container = ensureContainer(container);
    if (!container) return;

    const wrap = el('div', { class: 'lx-trp' });
    const segWrap = el('div');
    const custom = el('div', { class: 'lx-trp-custom' });

    const fromInput = el('input', { type: 'date' });
    const toInput = el('input', { type: 'date' });
    custom.appendChild(el('span', null, 'Von'));
    custom.appendChild(fromInput);
    custom.appendChild(el('span', null, 'Bis'));
    custom.appendChild(toInput);

    wrap.appendChild(segWrap);
    wrap.appendChild(custom);
    container.appendChild(wrap);

    const options = [
      { key: 'today',   label: 'Heute' },
      { key: 'yesterday', label: 'Gestern' },
      { key: '7d',  label: '7T' },
      { key: '30d', label: '30T' },
      { key: '90d', label: '90T' },
      { key: 'custom', label: 'Custom' }
    ];

    function rangeFor(key) {
      const now = new Date();
      const end = new Date(now);
      end.setHours(23,59,59,999);
      const start = new Date(now);
      start.setHours(0,0,0,0);
      switch (key) {
        case 'today': return { key, from: start, to: end };
        case 'yesterday': {
          const s = new Date(start); s.setDate(s.getDate()-1);
          const e = new Date(end); e.setDate(e.getDate()-1);
          return { key, from: s, to: e };
        }
        case '7d':  { const s = new Date(start); s.setDate(s.getDate()-6);  return { key, from: s, to: end }; }
        case '30d': { const s = new Date(start); s.setDate(s.getDate()-29); return { key, from: s, to: end }; }
        case '90d': { const s = new Date(start); s.setDate(s.getDate()-89); return { key, from: s, to: end }; }
        default: return null;
      }
    }

    const seg = segmentedControl(segWrap, options, '7d', function (key) {
      if (key === 'custom') {
        custom.classList.add('lx-show');
        emitCustom();
      } else {
        custom.classList.remove('lx-show');
        if (typeof onChange === 'function') onChange(rangeFor(key));
      }
    });

    function emitCustom() {
      const from = fromInput.value ? new Date(fromInput.value + 'T00:00:00') : null;
      const to   = toInput.value   ? new Date(toInput.value   + 'T23:59:59') : null;
      if (typeof onChange === 'function') onChange({ key: 'custom', from, to });
    }

    fromInput.addEventListener('change', emitCustom);
    toInput.addEventListener('change', emitCustom);

    // initial emit
    if (typeof onChange === 'function') onChange(rangeFor('7d'));

    return {
      setRange: function (key) { seg.setActive(key); },
      root: wrap
    };
  }

  // ---------- countUp ----------
  function countUp(node, target, duration) {
    duration = duration || 900;
    const isNumber = typeof target === 'number';
    let num = isNumber ? target : parseFloat(String(target).replace(/[^0-9.\-]/g, ''));
    if (!isFinite(num)) { node.textContent = String(target); return; }
    const prefix = !isNumber ? String(target).match(/^[^0-9\-]*/)[0] : '';
    const suffix = !isNumber ? String(target).match(/[^0-9.]*$/)[0] : '';
    const decimals = (String(num).split('.')[1] || '').length;
    const start = performance.now();
    function tick(t) {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      const v = num * eased;
      node.textContent = prefix + v.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + suffix;
      if (p < 1) requestAnimationFrame(tick);
      else node.textContent = prefix + (decimals ? num.toFixed(decimals) : num.toLocaleString('de-DE')) + suffix;
    }
    requestAnimationFrame(tick);
  }

  // ---------- statHero ----------
  function statHero(opts) {
    injectStyles();
    opts = opts || {};
    const root = el('div', { class: 'lx-hero' });
    const row = el('div', { class: 'lx-hero-row' });

    const left = el('div');
    left.appendChild(el('div', { class: 'lx-hero-label' }, opts.label || ''));
    // FIX: echten Wert direkt ins HTML schreiben — wenn Panel statHero() in
    // template-literal nutzt, wird outerHTML serialisiert BEVOR requestAnimationFrame
    // feuern kann. Daher würde "0" eingebrannt bleiben (Panel zeigt 0 obwohl Daten da).
    const _vStr = (opts.value == null) ? '0' : (typeof opts.value === 'number' ? opts.value.toLocaleString('de-DE') : String(opts.value));
    const valNode = el('div', { class: 'lx-hero-value' }, _vStr);
    left.appendChild(valNode);

    if (opts.change != null) {
      const kind = opts.changeKind || (typeof opts.change === 'number'
        ? (opts.change > 0 ? 'up' : opts.change < 0 ? 'down' : 'neutral')
        : 'neutral');
      const arrow = kind === 'up' ? '↑' : kind === 'down' ? '↓' : '→';
      const changeText = typeof opts.change === 'number'
        ? (opts.change > 0 ? '+' : '') + opts.change + '%'
        : opts.change;
      const chg = el('div', { class: 'lx-hero-change lx-' + kind }, arrow + ' ' + changeText);
      left.appendChild(chg);
    }

    row.appendChild(left);

    if (opts.icon) {
      // FIX: Panels übergeben oft nur einen Icon-Namen wie 'user-plus' / 'edit' —
      // bisher wurde der String wörtlich als Text gerendert (siehe verified-premium-flags
      // Screenshot). iconHtml() lebt in /lib/ui.js (ES-Module), nicht auf window. Daher:
      //  1) DOM-Node → direkt anhängen
      //  2) Markup-String (enthält '<') → innerHTML
      //  3) Icon-Name → falls iconHtml-Cache auf window vorhanden, synchron; sonst
      //     lazy-import aus /lib/ui.js und Markup nachträglich setzen.
      const icon = el('div', { class: 'lx-hero-icon' });
      const iconVal = opts.icon;
      if (iconVal instanceof Node) {
        icon.appendChild(iconVal);
      } else if (typeof iconVal === 'string') {
        if (iconVal.indexOf('<') !== -1) {
          icon.innerHTML = iconVal;
        } else {
          const cached = (typeof window !== 'undefined' && window.__LX_iconHtml__);
          if (typeof cached === 'function') {
            icon.innerHTML = cached(iconVal) || '';
          } else {
            icon.innerHTML = '';
            try {
              import('/lib/ui.js?v=20260608k').then(mod => {
                if (mod && typeof mod.iconHtml === 'function') {
                  if (typeof window !== 'undefined') window.__LX_iconHtml__ = mod.iconHtml;
                  icon.innerHTML = mod.iconHtml(iconVal) || '';
                }
              }).catch(() => { /* keep empty rather than raw name */ });
            } catch (_e) { /* dynamic import not supported → keep empty */ }
          }
        }
      }
      row.appendChild(icon);
    }

    root.appendChild(row);

    requestAnimationFrame(() => countUp(valNode, opts.value));

    // Fix für template-literal-Usage: wenn Panel ${statHero(...)} schreibt,
    // serialisiert default-toString zu "[object HTMLDivElement]". Override:
    root.toString = function() { return this.outerHTML; };
    return root;
  }

  // ---------- glassCard ----------
  function glassCard(contentHtml) {
    injectStyles();
    const card = el('div', { class: 'lx-glass' });
    if (contentHtml instanceof Node) card.appendChild(contentHtml);
    else card.innerHTML = contentHtml || '';
    return card;
  }

  // ---------- pullToRefresh ----------
  // Touch-Gesture: wenn Container am scrollTop=0 ist und nach unten gezogen wird,
  // erscheint ein Indikator. Bei Threshold (80px) wird onRefresh() gefeuert
  // und der Spinner gezeigt bis das Promise auflöst.
  function pullToRefresh(container, onRefresh, opts) {
    injectStyles();
    const host = ensureContainer(container);
    if (!host || typeof onRefresh !== 'function') return () => {};
    const threshold = (opts && opts.threshold) || 80;
    const maxPull   = (opts && opts.maxPull)   || 140;
    const resistance = 0.55;

    // host muss positioniert sein, damit Indikator absolute andocken kann
    const prevPosition = host.style.position;
    if (!host.style.position && getComputedStyle(host).position === 'static') {
      host.style.position = 'relative';
    }
    host.classList.add('lx-ptr-host');

    const indicator = el('div', { class: 'lx-ptr-indicator', 'aria-hidden': 'true' });
    const arrow = el('div', { class: 'lx-ptr-arrow' });
    indicator.appendChild(arrow);
    host.appendChild(indicator);

    let startY = 0;
    let pull = 0;
    let dragging = false;
    let refreshing = false;
    let armed = false;

    // Scrollroot bestimmen — entweder host selbst oder ein scrollender Vorfahr/window
    function atTop() {
      // bevorzugt: host scrollt selbst
      if (host.scrollHeight > host.clientHeight + 1) return host.scrollTop <= 0;
      // sonst: dokument-scroll
      const docTop = window.pageYOffset || document.documentElement.scrollTop || 0;
      return docTop <= 0;
    }

    function setIndicator(offset) {
      const cap = Math.min(offset, maxPull);
      indicator.style.transform = `translate(-50%, ${cap - 40}px)`;
      indicator.style.opacity = offset > 4 ? String(Math.min(1, offset / threshold)) : '0';
      const nowArmed = offset >= threshold;
      if (nowArmed !== armed) {
        armed = nowArmed;
        indicator.classList.toggle('lx-armed', armed);
      }
    }

    function reset() {
      dragging = false;
      pull = 0;
      armed = false;
      indicator.classList.remove('lx-armed');
      indicator.innerHTML = '';
      indicator.appendChild(arrow);
      indicator.style.transform = 'translate(-50%, -100%)';
      indicator.style.opacity = '0';
    }

    function showSpinner() {
      indicator.innerHTML = '';
      const spin = el('div', { class: 'lx-ptr-spinner' });
      indicator.appendChild(spin);
      indicator.classList.remove('lx-armed');
      indicator.style.transform = `translate(-50%, ${threshold - 40}px)`;
      indicator.style.opacity = '1';
    }

    function onTouchStart(ev) {
      if (refreshing) return;
      if (!atTop()) return;
      const t = ev.touches && ev.touches[0];
      if (!t) return;
      startY = t.clientY;
      dragging = true;
      pull = 0;
    }

    function onTouchMove(ev) {
      if (!dragging || refreshing) return;
      const t = ev.touches && ev.touches[0];
      if (!t) return;
      const dy = t.clientY - startY;
      if (dy <= 0) { setIndicator(0); return; }
      if (!atTop()) { dragging = false; setIndicator(0); return; }
      pull = dy * resistance;
      // Default-Scroll unterbinden während wir die Geste besitzen
      if (ev.cancelable) ev.preventDefault();
      setIndicator(pull);
    }

    async function onTouchEnd() {
      if (!dragging || refreshing) { reset(); return; }
      dragging = false;
      if (pull >= threshold) {
        refreshing = true;
        showSpinner();
        try {
          await Promise.resolve(onRefresh());
        } catch (e) {
          console.warn('[pullToRefresh] onRefresh threw', e);
        } finally {
          refreshing = false;
          reset();
        }
      } else {
        reset();
      }
    }

    host.addEventListener('touchstart', onTouchStart, { passive: true });
    host.addEventListener('touchmove',  onTouchMove,  { passive: false });
    host.addEventListener('touchend',   onTouchEnd,   { passive: true });
    host.addEventListener('touchcancel', onTouchEnd,  { passive: true });

    // Destroy-Handle
    return function destroy() {
      host.removeEventListener('touchstart', onTouchStart);
      host.removeEventListener('touchmove',  onTouchMove);
      host.removeEventListener('touchend',   onTouchEnd);
      host.removeEventListener('touchcancel', onTouchEnd);
      host.classList.remove('lx-ptr-host');
      if (indicator.parentNode) indicator.parentNode.removeChild(indicator);
      host.style.position = prevPosition;
    };
  }

  // ---------- Export ----------
  const api = {
    drawer,
    tabs,
    segmentedControl,
    timeRangePicker,
    statHero,
    glassCard,
    pullToRefresh
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.LayoutExtras = api;
  }
  // ES-Module bridge: stuff auf window damit das Top-Level-export unten
  // (außerhalb der IIFE) drauf zugreifen kann.
  global.__LX_API__ = api;
})(typeof window !== 'undefined' ? window : this);

// ES-Module Named Exports — Panels nutzen `import { drawer } from '/lib/layout-extras.js'`
const __LX = (typeof window !== 'undefined' ? window : globalThis).__LX_API__;
export const drawer = __LX.drawer;
export const tabs = __LX.tabs;
export const segmentedControl = __LX.segmentedControl;
export const timeRangePicker = __LX.timeRangePicker;
export const statHero = __LX.statHero;
export const glassCard = __LX.glassCard;
export const pullToRefresh = __LX.pullToRefresh;
export default __LX;
