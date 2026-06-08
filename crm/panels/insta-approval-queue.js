import { htmlEscape } from '/lib/ui.js?v=20260608i'

// ─────────────────────────────────────────────────────────────────────────────
// Instagram-Posts Freigabe — DEAKTIVIERT
//
// Dieses Panel hing an der Tabelle `insta_posts_queue` (sowie an
// `insta_pending_approvals`, `insta_post_metrics`). Alle drei Tabellen sind
// laut aktueller DB-Schema-Wahrheit TOT — siehe TOTE-Tabellen-Liste im
// CRM-Audit (06/2026). Das ehemalige UI (Approval-Queue, Canvas-Renderer,
// History/Insights-Tabs, CSV/PDF-Export) lief deshalb dauerhaft leer bzw.
// warf Schema-Fehler.
//
// Bis die Insta-Auto-Posting-Pipeline neu gebaut ist, zeigt das Panel
// stattdessen eine prominente "Feature deaktiviert"-Karte mit Hintergrund-
// Erklärung. Kein DB-Zugriff, keine Charts, keine Buttons mit Side-Effects.
//
// Wenn die Pipeline zurückkommt: NEU schreiben gegen die dann reale Tabelle
// (nicht das alte File aus alte versionen/ blind wiederbeleben — Lib-API
// und Theme-Variablen haben sich weiterentwickelt: var(--card-bg),
// var(--text), iconHtml(), drawer({content: Node, contentHtml: string})).
// ─────────────────────────────────────────────────────────────────────────────

function styles() {
  const id = 'insta-approval-queue-disabled-styles'
  if (document.getElementById(id)) return
  const style = document.createElement('style')
  style.id = id
  style.textContent = `
    .iaq-disabled-shell {
      display:flex;
      flex-direction:column;
      gap:18px;
      padding:8px 2px 24px;
    }
    .iaq-disabled-head {
      display:flex;
      align-items:center;
      gap:12px;
      flex-wrap:wrap;
    }
    .iaq-disabled-head h2 {
      margin:0;
      color:var(--text, #fff);
      font-size:22px;
      font-weight:700;
    }
    .iaq-badge {
      display:inline-flex;
      align-items:center;
      gap:6px;
      padding:4px 10px;
      border-radius:999px;
      font-size:11px;
      font-weight:700;
      letter-spacing:.06em;
      text-transform:uppercase;
      background:rgba(239,68,68,.15);
      color:#ef4444;
      border:1px solid rgba(239,68,68,.35);
    }
    .iaq-card {
      background:var(--card-bg, rgba(255,255,255,.04));
      border:1px solid var(--border, rgba(255,255,255,.08));
      border-radius:16px;
      padding:28px;
      color:var(--text, #fff);
      box-shadow:0 4px 24px rgba(0,0,0,.18);
    }
    .iaq-card h3 {
      margin:0 0 12px;
      font-size:18px;
      font-weight:700;
      color:var(--text, #fff);
    }
    .iaq-card p, .iaq-card li {
      color:var(--text-dim, rgba(255,255,255,.72));
      line-height:1.55;
      font-size:14px;
    }
    .iaq-card ul {
      margin:8px 0 0;
      padding-left:18px;
    }
    .iaq-card li { margin:4px 0; }
    .iaq-card code {
      background:var(--bg-glass, rgba(255,255,255,.06));
      padding:1px 6px;
      border-radius:4px;
      font-size:12px;
      color:var(--text, #fff);
    }
    .iaq-icon-wrap {
      width:56px;
      height:56px;
      border-radius:16px;
      display:flex;
      align-items:center;
      justify-content:center;
      background:linear-gradient(135deg, rgba(139,92,246,.22), rgba(236,72,153,.18));
      border:1px solid rgba(139,92,246,.35);
      margin-bottom:14px;
      font-size:28px;
    }
  `
  document.head.appendChild(style)
}

function renderDisabledNotice() {
  const deadTables = ['insta_posts_queue', 'insta_pending_approvals', 'insta_post_metrics']
  return `
    <div class="iaq-card">
      <div class="iaq-icon-wrap" aria-hidden="true">📵</div>
      <h3>Instagram-Auto-Posting derzeit nicht aktiv</h3>
      <p>
        Die zugrunde liegende Datenbank-Pipeline für das Auto-Posting auf Instagram
        wurde abgebaut. Dieses Panel hatte früher Generator-Output zur Freigabe
        gequeued, Canvas-Bilder gerendert und Insights/History angezeigt — alles
        gegen Tabellen, die im aktuellen DB-Schema nicht mehr existieren.
      </p>
      <h3 style="margin-top:18px;">Was fehlt</h3>
      <p>Tote / nicht mehr existierende Tabellen, von denen das Panel abhing:</p>
      <ul>
        ${deadTables.map(t => `<li><code>${htmlEscape(t)}</code></li>`).join('')}
      </ul>
      <h3 style="margin-top:18px;">Nächste Schritte</h3>
      <ul>
        <li>Pipeline neu aufsetzen (Generator + Storage-Tabelle für Queue/History).</li>
        <li>Danach dieses Panel gegen die neue Tabelle neu bauen — Lib-APIs verwenden
          (<code>statHero</code>, <code>makeAreaChart</code>, <code>iconHtml</code>) statt
          hardcoded Farben/Gradients.</li>
        <li>Alle Farbwerte über <code>var(--card-bg)</code> / <code>var(--text)</code>
          — kein <code>#fff</code> oder <code>rgba(255,255,255,...)</code> als Fallback ohne Theme-Variable.</li>
      </ul>
    </div>
  `
}

export default {
  id: 'insta-approval-queue',
  title: 'Instagram-Posts Freigabe',
  category: 'marketing',
  summary: 'Deaktiviert — DB-Pipeline (insta_posts_queue) existiert nicht mehr.',
  async mount(container) {
    styles()
    container.innerHTML = `
      <div class="iaq-disabled-shell">
        <div class="iaq-disabled-head">
          <h2>Instagram-Posts Freigabe</h2>
          <span class="iaq-badge">Feature deaktiviert</span>
        </div>
        ${renderDisabledNotice()}
      </div>
    `
  },
}
