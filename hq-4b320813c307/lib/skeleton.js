// crm/lib/skeleton.js — Skeleton-Loader mit Shimmer-Animation
//
// Ersetzt das pauschale "Lädt …" Text-Loading durch animierte Skeleton-
// Platzhalter, die schon die Struktur des kommenden Inhalts andeuten.
// Fühlt sich dadurch deutlich schneller an, auch wenn die RPC gleich
// lange braucht.
//
// API:
//   skeletonRow({ count, height, gap })          → HTML-String mit N Zeilen
//   skeletonCard({ height, width, radius })      → HTML-String einer Tile/Card
//   skeletonChart({ height, bars })              → HTML-String für Chart-Host
//   skeletonGrid({ tiles, minTileWidth, height }) → Grid aus Tiles
//   ensureStyles(root?)                          → injiziert <style> einmalig
//
// Alle Funktionen geben HTML-Strings zurück und können direkt per
// `el.innerHTML = skeletonRow(...)` benutzt werden. ensureStyles() wird
// automatisch beim ersten Aufruf aufgerufen, kann aber für Shadow-Roots
// auch explizit gerufen werden.
//
// CSS-Klassen sind mit `pfsk-` geprefixt, damit sie nicht mit bestehenden
// `.skel-card` / `.pf-skeleton` Klassen kollidieren — die bleiben so lange
// erhalten bis alle Panels migriert sind.

const STYLE_ID = 'pfsk-styles'

const STYLES = `
  .pfsk {
    display: block;
    border-radius: 10px;
    background:
      linear-gradient(
        90deg,
        rgba(255,255,255,0.04) 0%,
        rgba(255,255,255,0.10) 50%,
        rgba(255,255,255,0.04) 100%
      );
    background-size: 200% 100%;
    animation: pfsk-shimmer 1.4s linear infinite;
    will-change: background-position;
  }
  .pfsk-stack { display: flex; flex-direction: column; }
  .pfsk-grid  { display: grid; gap: 14px; }
  .pfsk-row   {
    display: flex; align-items: center; gap: 12px;
    padding: 10px 4px;
    border-bottom: 1px solid rgba(255,255,255,0.04);
  }
  .pfsk-row:last-child { border-bottom: none; }
  .pfsk-avatar { width: 36px; height: 36px; border-radius: 50%; flex-shrink: 0; }
  .pfsk-lines  { flex: 1; display: flex; flex-direction: column; gap: 6px; }
  .pfsk-line   { height: 11px; border-radius: 6px; }
  .pfsk-line.short { width: 40%; }
  .pfsk-line.med   { width: 65%; }
  .pfsk-line.long  { width: 85%; }
  .pfsk-pill   { width: 60px; height: 22px; border-radius: 999px; flex-shrink: 0; }
  .pfsk-card   {
    border-radius: 14px;
    background:
      linear-gradient(
        90deg,
        rgba(255,255,255,0.04) 0%,
        rgba(255,255,255,0.10) 50%,
        rgba(255,255,255,0.04) 100%
      );
    background-size: 200% 100%;
    animation: pfsk-shimmer 1.4s linear infinite;
  }
  .pfsk-chart  {
    position: relative;
    border-radius: 12px;
    background: rgba(255,255,255,0.02);
    border: 1px solid rgba(255,255,255,0.04);
    padding: 12px;
    display: flex;
    align-items: flex-end;
    gap: 8px;
    overflow: hidden;
  }
  .pfsk-chart .pfsk-bar {
    flex: 1;
    border-radius: 4px 4px 0 0;
    min-height: 12%;
    background:
      linear-gradient(
        180deg,
        rgba(255,255,255,0.14) 0%,
        rgba(255,255,255,0.04) 100%
      );
    animation: pfsk-shimmer-y 1.6s ease-in-out infinite;
  }
  @keyframes pfsk-shimmer {
    0%   { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }
  @keyframes pfsk-shimmer-y {
    0%, 100% { opacity: 0.55; }
    50%      { opacity: 1; }
  }
  @media (prefers-reduced-motion: reduce) {
    .pfsk, .pfsk-card, .pfsk-chart .pfsk-bar { animation: none; }
  }
`

let _stylesInjected = false

export function ensureStyles(root) {
  // root: optional ShadowRoot oder Document. Default: document.
  const target = root || document
  // doc-level only once
  if (target === document) {
    if (_stylesInjected) return
    if (document.getElementById(STYLE_ID)) { _stylesInjected = true; return }
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = STYLES
    document.head.appendChild(style)
    _stylesInjected = true
    return
  }
  // Shadow-Root: jedes mal, weil isoliert
  if (target.querySelector && target.querySelector(`#${STYLE_ID}`)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = STYLES
  target.appendChild(style)
}

/**
 * Skeleton-Zeile (Avatar + zwei Textzeilen + optionaler Pill).
 * Eignet sich für Listen wie users-list, recent-feed, etc.
 *
 * opts:
 *   count  — Anzahl Zeilen (default 6)
 *   avatar — Avatar-Kreis links zeigen (default true)
 *   pill   — kleine Pill rechts (Status/Badge) (default true)
 *   lines  — Anzahl Text-Zeilen pro Row (default 2, 1-3)
 */
export function skeletonRow(opts = {}) {
  ensureStyles()
  const {
    count = 6,
    avatar = true,
    pill = true,
    lines = 2,
  } = opts

  const lineClasses = ['long', 'med', 'short']
  const rows = []
  for (let i = 0; i < count; i++) {
    const lineHtml = []
    for (let l = 0; l < Math.max(1, Math.min(3, lines)); l++) {
      lineHtml.push(`<div class="pfsk pfsk-line ${lineClasses[l] || 'med'}"></div>`)
    }
    rows.push(`
      <div class="pfsk-row" aria-hidden="true">
        ${avatar ? '<div class="pfsk pfsk-avatar"></div>' : ''}
        <div class="pfsk-lines">${lineHtml.join('')}</div>
        ${pill ? '<div class="pfsk pfsk-pill"></div>' : ''}
      </div>
    `)
  }
  return `<div class="pfsk-stack" role="status" aria-label="Lädt Inhalte …">${rows.join('')}</div>`
}

/**
 * Skeleton-Card (Hero-Tile, KPI-Card, Stat-Box).
 *
 * opts:
 *   height — px (default 140)
 *   width  — CSS-Wert (default '100%')
 *   radius — px (default 14)
 */
export function skeletonCard(opts = {}) {
  ensureStyles()
  const { height = 140, width = '100%', radius = 14 } = opts
  const w = typeof width === 'number' ? `${width}px` : width
  return `<div class="pfsk-card" role="status" aria-label="Lädt …" style="height:${height}px;width:${w};border-radius:${radius}px;"></div>`
}

/**
 * Skeleton-Grid aus N Tiles. Default: responsive auto-fit.
 *
 * opts:
 *   tiles        — Anzahl (default 4)
 *   minTileWidth — px (default 220)
 *   height       — Tile-Höhe (default 140)
 *   radius       — Tile-Radius (default 14)
 */
export function skeletonGrid(opts = {}) {
  ensureStyles()
  const { tiles = 4, minTileWidth = 220, height = 140, radius = 14 } = opts
  const cards = Array.from({ length: tiles })
    .map(() => skeletonCard({ height, radius }))
    .join('')
  return `<div class="pfsk-grid" style="grid-template-columns:repeat(auto-fit, minmax(${minTileWidth}px, 1fr));">${cards}</div>`
}

/**
 * Skeleton-Chart — Balken-Vorschau für Area/Bar/Donut-Hosts.
 *
 * opts:
 *   height — px (default 180)
 *   bars   — Anzahl Balken (default 14)
 */
export function skeletonChart(opts = {}) {
  ensureStyles()
  const { height = 180, bars = 14 } = opts
  const barHtml = []
  for (let i = 0; i < bars; i++) {
    // Pseudo-Random Höhe (deterministisch pro Index) damit's "lebendig" aussieht
    const h = 30 + ((i * 37) % 65)
    const delay = (i * 0.07).toFixed(2)
    barHtml.push(`<div class="pfsk-bar" style="height:${h}%;animation-delay:${delay}s"></div>`)
  }
  return `<div class="pfsk-chart" role="status" aria-label="Lädt Diagramm …" style="height:${height}px;">${barHtml.join('')}</div>`
}

export default {
  ensureStyles,
  skeletonRow,
  skeletonCard,
  skeletonChart,
  skeletonGrid,
}
