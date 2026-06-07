// animations.js — Micro-Interaction-Helpers (Vanilla JS)
// Pfad: /tmp/podfluence-app/lib/animations.js

// ----------------------------------------------------------------------------
// Global Keyframe-Injection (einmalig beim ersten Import)
// ----------------------------------------------------------------------------
const STYLE_ID = "podfluence-animations-keyframes";

function injectGlobalKeyframes() {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    @keyframes pf-shimmer {
      0%   { background-position: -400px 0; }
      100% { background-position: 400px 0; }
    }
    @keyframes pf-pulse-glow {
      0%   { box-shadow: 0 0 0 0 var(--pf-pulse-color, rgba(139, 92, 246, 0.7)); }
      50%  { box-shadow: 0 0 16px 6px var(--pf-pulse-color, rgba(139, 92, 246, 0.5)); }
      100% { box-shadow: 0 0 0 0 rgba(139, 92, 246, 0); }
    }
    @keyframes pf-fade-in {
      from { opacity: 0; }
      to   { opacity: 1; }
    }
    @keyframes pf-slide-in-right {
      from { opacity: 0; transform: translateX(20px); }
      to   { opacity: 1; transform: translateX(0); }
    }
    .pf-skeleton {
      display: inline-block;
      background: linear-gradient(
        90deg,
        rgba(140, 140, 160, 0.12) 0%,
        rgba(140, 140, 160, 0.28) 50%,
        rgba(140, 140, 160, 0.12) 100%
      );
      background-size: 800px 100%;
      animation: pf-shimmer 1.4s linear infinite;
      border-radius: 8px;
    }
  `;
  document.head.appendChild(style);
}

injectGlobalKeyframes();

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------
function easeOutQuart(t) {
  return 1 - Math.pow(1 - t, 4);
}

function now() {
  return typeof performance !== "undefined" && performance.now
    ? performance.now()
    : Date.now();
}

// ----------------------------------------------------------------------------
// countUp — animiert von `from` zu `to` mit easeOutQuart
// ----------------------------------------------------------------------------
export function countUp(
  element,
  from,
  to,
  durationMs = 900,
  formatter = (n) => n.toLocaleString("de-DE")
) {
  if (!element) return;
  // Backward-compat: panels ufen mit ({from, to, duration, format}) als
  // 2. Argument. Wenn `from` ein Objekt ist, parsen wir's auseinander.
  if (from && typeof from === 'object') {
    const opts = from;
    from = Number(opts.from) || 0;
    to = Number(opts.to) || 0;
    durationMs = Number(opts.duration ?? opts.durationMs) || 900;
    if (typeof opts.format === 'function') formatter = opts.format;
    else if (typeof opts.formatter === 'function') formatter = opts.formatter;
  } else {
    from = Number(from) || 0;
    to = Number(to) || 0;
  }
  const start = now();
  const delta = to - from;

  function frame() {
    const t = Math.min(1, (now() - start) / durationMs);
    const eased = easeOutQuart(t);
    const value = from + delta * eased;
    // Ganze Zahlen, wenn from und to ganzzahlig sind
    const isInt = Number.isInteger(from) && Number.isInteger(to);
    const current = isInt ? Math.round(value) : value;
    element.textContent = formatter(current);
    if (t < 1) requestAnimationFrame(frame);
    else element.textContent = formatter(to);
  }
  requestAnimationFrame(frame);
}

// ----------------------------------------------------------------------------
// fadeIn — Opacity 0 → 1
// ----------------------------------------------------------------------------
export function fadeIn(element, durationMs = 400, delayMs = 0) {
  if (!element) return;
  element.style.opacity = "0";
  element.style.animation = `pf-fade-in ${durationMs}ms ease-out ${delayMs}ms forwards`;
  // Cleanup nach Ende, damit weitere Animationen nicht blockiert werden
  const total = durationMs + delayMs;
  setTimeout(() => {
    element.style.animation = "";
    element.style.opacity = "1";
  }, total + 20);
}

// ----------------------------------------------------------------------------
// slideInRight — translateX(20px) + opacity 0 → 0/1
// ----------------------------------------------------------------------------
export function slideInRight(element, durationMs = 350) {
  if (!element) return;
  element.style.opacity = "0";
  element.style.transform = "translateX(20px)";
  element.style.animation = `pf-slide-in-right ${durationMs}ms cubic-bezier(0.22, 1, 0.36, 1) forwards`;
  setTimeout(() => {
    element.style.animation = "";
    element.style.opacity = "1";
    element.style.transform = "translateX(0)";
  }, durationMs + 20);
}

// ----------------------------------------------------------------------------
// pulse — kurzer Glow-Effekt
// ----------------------------------------------------------------------------
function hexToRgba(hex, alpha) {
  const clean = hex.replace("#", "");
  const bigint = parseInt(
    clean.length === 3
      ? clean.split("").map((c) => c + c).join("")
      : clean,
    16
  );
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function pulse(element, color = "#8B5CF6") {
  if (!element) return;
  const rgba = color.startsWith("#") ? hexToRgba(color, 0.7) : color;
  const prevPosition = element.style.position;
  if (!prevPosition || prevPosition === "static") {
    element.style.position = "relative";
  }
  element.style.setProperty("--pf-pulse-color", rgba);
  element.style.animation = "pf-pulse-glow 700ms ease-out";
  setTimeout(() => {
    element.style.animation = "";
    element.style.removeProperty("--pf-pulse-color");
  }, 720);
}

// ----------------------------------------------------------------------------
// skeletonLoader — gibt ein HTMLElement mit shimmer-animation zurück
// ----------------------------------------------------------------------------
export function skeletonLoader(width, height) {
  const el = document.createElement("div");
  el.className = "pf-skeleton";
  el.style.width = typeof width === "number" ? `${width}px` : String(width);
  el.style.height = typeof height === "number" ? `${height}px` : String(height);
  return el;
}

// ----------------------------------------------------------------------------
// toggleExpand — height auto ↔ 0 mit smooth transition
// ----------------------------------------------------------------------------
export function toggleExpand(element, durationMs = 300) {
  if (!element) return;

  const isCollapsed =
    element.dataset.pfCollapsed === "true" ||
    element.style.height === "0px" ||
    element.offsetHeight === 0;

  // Set transition
  element.style.overflow = "hidden";
  element.style.transition = `height ${durationMs}ms cubic-bezier(0.4, 0, 0.2, 1)`;

  if (isCollapsed) {
    // Expand: 0 → auto (via measured scrollHeight)
    element.style.height = "0px";
    // Force reflow
    void element.offsetHeight;
    const target = element.scrollHeight;
    element.style.height = target + "px";
    element.dataset.pfCollapsed = "false";
    setTimeout(() => {
      // Auf "auto" zurück, damit dynamischer Content nicht clippt
      element.style.height = "auto";
      element.style.overflow = "";
    }, durationMs + 20);
  } else {
    // Collapse: aktuelle Höhe → 0
    const current = element.scrollHeight;
    element.style.height = current + "px";
    // Force reflow
    void element.offsetHeight;
    element.style.height = "0px";
    element.dataset.pfCollapsed = "true";
    setTimeout(() => {
      // overflow bleibt hidden, height bleibt 0
    }, durationMs + 20);
  }
}

// ----------------------------------------------------------------------------
// Default-Export für bequemen Import
// ----------------------------------------------------------------------------
export default {
  countUp,
  fadeIn,
  slideInRight,
  pulse,
  skeletonLoader,
  toggleExpand,
};
