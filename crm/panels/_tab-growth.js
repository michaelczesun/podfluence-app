// Growth Top-Tab — Meta-Panel
// Hosts 5 sub-tabs: Funnel · Cohorts · Retention · Forecast · DAU
//
//   Funnel    → existing onboarding-funnel + NEU admin_funnel_v2 RPC (wenn vorhanden)
//   Cohorts   → NEU — Tabelle aus view view_cohort_retention (D1/D7/D30 pro Woche)
//   Retention → NEU — Heat-Map Retention pro Cohort × Day
//   Forecast  → NEU — Linechart aus admin_signup_forecast(30) mit CI-Band
//   DAU       → existing dau-trend
//
// Schema-Truth: Wenn view_cohort_retention oder admin_signup_forecast (noch) nicht
// existieren, zeigt das jeweilige Sub-Tab einen klaren Fallback-State mit DB-Hinweis
// statt zu crashen. Keine Spalten geraten — toleranter Normalizer für alternative
// Feld-Namen (d1/day_1/retention_d1, etc.).
//
// CACHE-BUST: ?v=20260608p

import { sb } from '/lib/supabase.js?v=20260608p'
import {
  toast, htmlEscape, fmtNumber, fmtRelativeTime, iconHtml, spinnerHtml
} from '/lib/ui.js?v=20260608p'
import * as Charts from '/lib/charts.js?v=20260608p'
import { exportCsv, exportPanelAsPdf } from '/lib/export.js?v=20260608p'
import { fadeIn, skeletonLoader, countUp } from '/lib/animations.js?v=20260608p'
import { statHero } from '/lib/layout-extras.js?v=20260608p'

// -------------------- Sub-Tab Registry --------------------------------------

const SUBTABS = [
  { key: 'funnel',    label: 'Funnel',    icon: '🔻', desc: 'Signup → Profil → First Listen → Active' },
  { key: 'cohorts',   label: 'Cohorts',   icon: '👥', desc: 'D1 / D7 / D30 Retention pro Wochen-Cohort' },
  { key: 'retention', label: 'Retention', icon: '🟪', desc: 'Heat-Map Retention pro Cohort × Day' },
  { key: 'forecast',  label: 'Forecast',  icon: '📈', desc: 'Signup-Forecast 30 Tage mit Konfidenzband' },
  { key: 'dau',       label: 'DAU',       icon: '⚡', desc: 'Tägliche aktive Nutzer' }
]
const DEFAULT_SUB = 'funnel'

// -------------------- Module State (für unmount) ----------------------------

const state = {
  panelRoot: null,
  activeSub: DEFAULT_SUB,
  childCache: new Map(), // id -> module
  mounted: [],           // [{ id, container, mod }] für unmount der Child-Panels
  ctx: null
}

// -------------------- Helpers -----------------------------------------------

async function unmountAllChildren() {
  for (const { id, container, mod } of state.mounted) {
    try {
      if (mod && typeof mod.unmount === 'function') mod.unmount()
    } catch (e) {
      console.warn('[_tab-growth] child unmount failed', id, e)
    }
    try { container.innerHTML = '' } catch (_) {}
  }
  state.mounted = []
}

async function mountChildPanel(id, container) {
  try {
    container.innerHTML = `<div class="loading">${typeof spinnerHtml === 'function' ? spinnerHtml() : 'Lädt…'}</div>`
    let mod = state.childCache.get(id)
    if (!mod) {
      const v = '20260608f'
      mod = await import(`./${id}.js?v=${v}`)
      state.childCache.set(id, mod)
    }
    const panel = mod.default || mod
    if (!panel || typeof panel.mount !== 'function') {
      throw new Error(`Panel "${id}" exportiert kein mount()`)
    }
    container.innerHTML = ''
    await panel.mount(container)
    state.mounted.push({ id, container, mod: panel })
  } catch (e) {
    console.error('[_tab-growth] mountChild failed', id, e)
    container.innerHTML = `
      <div class="error-state glass-card" style="padding:16px;">
        <div class="error-state__icon">⚠️</div>
        <div class="error-state__title">Panel „${htmlEscape(id)}" konnte nicht geladen werden</div>
        <div class="error-state__text">${htmlEscape(e?.message || String(e))}</div>
      </div>`
  }
}

function injectStyles() {
  if (document.getElementById('tab-growth-styles')) return
  const s = document.createElement('style')
  s.id = 'tab-growth-styles'
  s.textContent = `
    #panel-tab-growth .subtab-pill.is-active {
      background: linear-gradient(135deg, #7C3AED, #A78BFA) !important;
      border-color: #A78BFA !important;
      color: #fff !important;
      box-shadow: 0 4px 14px rgba(124,58,237,0.35);
    }
    #panel-tab-growth .subtab-pill:hover:not(.is-active) {
      background: rgba(255,255,255,0.08) !important;
    }
    #panel-tab-growth .growth-tile .panel-shell { padding: 12px !important; }

    /* Cohort-Tabelle */
    #panel-tab-growth .tg-cohort-table { width:100%; border-collapse:collapse; font-size:13px; }
    #panel-tab-growth .tg-cohort-table th,
    #panel-tab-growth .tg-cohort-table td {
      padding:10px 12px; text-align:left;
      border-bottom:1px solid rgba(255,255,255,.06); color:#E5E7EB;
    }
    #panel-tab-growth .tg-cohort-table th {
      font-weight:600; color:#9CA3AF; text-transform:uppercase;
      font-size:11px; letter-spacing:.5px;
      background:rgba(255,255,255,.02); position:sticky; top:0;
    }
    #panel-tab-growth .tg-cohort-table tbody tr:hover { background:rgba(139,92,246,.06); }
    #panel-tab-growth .tg-cohort-table td.num { text-align:right; font-variant-numeric: tabular-nums; }
    #panel-tab-growth .tg-pct-pill {
      display:inline-block; padding:2px 10px; border-radius:999px;
      font-size:12px; font-weight:600; font-variant-numeric: tabular-nums;
    }
    #panel-tab-growth .tg-heatmap td.tg-cohort-heat {
      text-align:center; font-variant-numeric: tabular-nums;
      transition: transform .12s ease;
    }
    #panel-tab-growth .tg-heatmap tbody tr:hover td.tg-cohort-heat { filter: brightness(1.15); }

    /* Heat-Map */
    #panel-tab-growth .tg-heat { display:grid; gap:3px; font-size:11px; }
    #panel-tab-growth .tg-heat-cell {
      aspect-ratio: 1.5 / 1;
      display:flex; align-items:center; justify-content:center;
      border-radius:6px; color:#fff; font-weight:600;
      font-variant-numeric: tabular-nums;
      transition: transform .12s ease, box-shadow .12s ease;
    }
    #panel-tab-growth .tg-heat-cell:hover {
      transform: scale(1.06); box-shadow:0 6px 18px rgba(0,0,0,.45);
      position:relative; z-index:2;
    }
    #panel-tab-growth .tg-heat-label {
      color:#9CA3AF; display:flex; align-items:center;
      padding:0 6px; font-size:11px;
    }
    #panel-tab-growth .tg-heat-legend {
      display:flex; align-items:center; gap:6px;
      font-size:11px; color:#9CA3AF; margin-top:14px;
    }
    #panel-tab-growth .tg-heat-legend .grad {
      flex:1; height:10px; border-radius:5px; max-width:220px;
      background: linear-gradient(90deg, #1f1f2e, #4c1d95, #8b5cf6, #a78bfa, #fbbf24);
    }

    /* Empty / Error */
    #panel-tab-growth .tg-empty {
      text-align:center; padding:48px 20px; color:#9CA3AF;
    }
    #panel-tab-growth .tg-empty svg { width:42px; height:42px; opacity:.5; margin-bottom:10px; }
    #panel-tab-growth .tg-empty h4 { margin:0 0 6px; color:#fff; font-size:15px; font-weight:600; }
    #panel-tab-growth .tg-empty p { margin:0 auto; font-size:13px; max-width:480px; line-height:1.5; }

    #panel-tab-growth .tg-card-title {
      font-size:13px; font-weight:600; color:#9CA3AF;
      text-transform:uppercase; letter-spacing:.5px; margin:0 0 12px;
      display:flex; align-items:center; gap:6px;
    }

    #panel-tab-growth .tg-funnel-v2-grid {
      display:grid; grid-template-columns: repeat(auto-fit, minmax(180px,1fr));
      gap:12px;
    }

    #panel-tab-growth .tg-forecast-meta {
      display:flex; gap:18px; flex-wrap:wrap;
      margin-top:12px; color:#9CA3AF; font-size:13px;
    }
    #panel-tab-growth .tg-forecast-meta strong { color:#fff; }

    #panel-tab-growth .tg-tools {
      display:flex; gap:8px; flex-wrap:wrap; margin-top:12px;
    }
    #panel-tab-growth .tg-btn {
      display:inline-flex; align-items:center; gap:6px;
      padding:8px 14px; border-radius:10px;
      border:1px solid rgba(255,255,255,.08);
      background:rgba(255,255,255,.04); color:#fff;
      cursor:pointer; font-family:inherit; font-size:13px; font-weight:500;
      transition: background .15s, border-color .15s;
    }
    #panel-tab-growth .tg-btn:hover { background:rgba(255,255,255,.08); }

    /* Mobile: prevent horizontal overflow */
    @media (max-width: 767px) {
      #panel-tab-growth .panel-shell { max-width: 100%; overflow-x: hidden; padding: 8px !important; }
      #panel-tab-growth .subtab-bar { overflow-x: auto; flex-wrap: nowrap !important; }
      #panel-tab-growth .subtab-bar .subtab-pill { white-space: nowrap; flex-shrink: 0; }
      #panel-tab-growth .tg-funnel-v2-grid { grid-template-columns: 1fr 1fr !important; }
      #panel-tab-growth .tg-cohort-table th,
      #panel-tab-growth .tg-cohort-table td { padding: 6px 8px; font-size: 12px; }
    }
  `
  document.head.appendChild(s)
}

function pctColor(p) {
  if (p == null || isNaN(p)) return '#1f1f2e'
  const v = Math.max(0, Math.min(100, p)) / 100
  if (v < 0.2) return `rgba(31,31,46,${0.6 + v})`
  if (v < 0.4) return `rgba(76,29,149,${0.55 + v * 0.45})`
  if (v < 0.6) return `rgba(124,58,237,${0.7 + v * 0.3})`
  if (v < 0.8) return `rgba(167,139,250,${0.8 + v * 0.2})`
  return `rgba(251,191,36,${0.85 + v * 0.15})`
}

function pctPill(p) {
  if (p == null || isNaN(p)) {
    return '<span class="tg-pct-pill" style="background:rgba(156,163,175,.15); color:#9CA3AF;">—</span>'
  }
  const v = Math.round(p)
  const bg = v >= 50 ? 'rgba(52,211,153,.18)' : v >= 25 ? 'rgba(252,211,77,.18)' : 'rgba(248,113,113,.18)'
  const fg = v >= 50 ? '#34D399' : v >= 25 ? '#FCD34D' : '#F87171'
  return `<span class="tg-pct-pill" style="background:${bg};color:${fg};">${v}%</span>`
}

function normalizePct(v, base) {
  if (v == null) return null
  const n = Number(v)
  if (isNaN(n)) return null
  // > 100 = User-Count, runter rechnen mit base
  if (n > 100 && base) return Math.round((n / base) * 100)
  // 0..1 = Faktor → in %
  if (n > 0 && n <= 1) return Math.round(n * 100)
  return Math.round(n)
}

function getISOWeek(d) {
  const date = new Date(d.valueOf())
  const dayNum = (date.getUTCDay() + 6) % 7
  date.setUTCDate(date.getUTCDate() - dayNum + 3)
  const firstThursday = date.valueOf()
  date.setUTCMonth(0, 1)
  if (date.getUTCDay() !== 4) {
    date.setUTCMonth(0, 1 + ((4 - date.getUTCDay()) + 7) % 7)
  }
  return 1 + Math.ceil((firstThursday - date) / 604800000)
}

function formatWeek(w) {
  if (!w) return '—'
  try {
    const d = new Date(w)
    if (!isNaN(d.getTime())) {
      return `KW ${getISOWeek(d)} · ${d.toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: '2-digit' })}`
    }
  } catch (_) {}
  return String(w)
}

function renderEmptyState(host, { title, message, icon = '📭' }) {
  host.innerHTML = `
    <div class="tg-empty">
      <div style="font-size:42px; opacity:.55; margin-bottom:8px;">${icon}</div>
      <h4>${htmlEscape(title)}</h4>
      <p>${htmlEscape(message)}</p>
    </div>
  `
}

function renderErrorState(host, err, retry) {
  host.innerHTML = `
    <div class="tg-empty">
      <div style="font-size:42px; opacity:.6; margin-bottom:8px;">⚠️</div>
      <h4>Daten konnten nicht geladen werden</h4>
      <p>${htmlEscape(err?.message || 'Unbekannter Fehler')}</p>
      <div class="tg-tools" style="justify-content:center; margin-top:16px;">
        <button class="tg-btn" id="tg-retry">🔄 Erneut versuchen</button>
      </div>
    </div>
  `
  host.querySelector('#tg-retry')?.addEventListener('click', retry)
}

// -------------------- Sub-Tab: Funnel ---------------------------------------

async function renderFunnel(host) {
  host.innerHTML = `
    <div class="growth-pane">
      <div id="tg-funnel-v2" class="glass-card" style="padding:16px; margin-bottom:14px; display:none;"></div>
      <div class="growth-tile glass-card" id="tg-funnel-host" style="padding:0; overflow:hidden;"></div>
    </div>
  `

  // 1) admin_funnel_v2 als Hero-Reihe oben — optional, fail-safe
  const v2Host = host.querySelector('#tg-funnel-v2')
  try {
    const { data, error } = await sb.rpc('admin_funnel_v2', { p_days: 90 })
    if (!error && data) {
      const stages = Array.isArray(data) ? data : (data.stages || [])
      if (stages.length) {
        v2Host.style.display = 'block'
        v2Host.innerHTML = `
          <div class="tg-card-title">⚡ Funnel V2 · Live-Stats (90 Tage)</div>
          <div class="tg-funnel-v2-grid" id="tg-v2-grid"></div>
        `
        const grid = v2Host.querySelector('#tg-v2-grid')
        stages.forEach(s => {
          const label = s.label || s.stage || s.name || '—'
          const count = s.count ?? s.users ?? s.value ?? 0
          const conv  = s.conversion ?? s.conv ?? s.rate
          const sub   = conv != null ? `${Math.min(100, Math.round(Number(conv) <= 1 ? Number(conv) * 100 : Number(conv)))}% Conversion` : ''
          const card = document.createElement('div')
          card.style.cssText = 'padding:14px; border-radius:12px; background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.06);'
          card.innerHTML = `
            <div style="font-size:11px; color:#9CA3AF; text-transform:uppercase; letter-spacing:.5px;">${htmlEscape(String(label))}</div>
            <div style="font-size:26px; font-weight:700; margin-top:4px; color:#fff;">${fmtNumber(Number(count) || 0)}</div>
            ${sub ? `<div style="font-size:12px; color:#34D399; margin-top:2px;">${htmlEscape(sub)}</div>` : ''}
          `
          grid.appendChild(card)
        })
      }
    } else if (error) {
      console.warn('[_tab-growth] admin_funnel_v2 RPC:', error.message)
    }
  } catch (e) {
    console.warn('[_tab-growth] admin_funnel_v2 throw:', e.message)
  }

  // 2) Existing onboarding-funnel — Hauptansicht
  const funnelHost = host.querySelector('#tg-funnel-host')
  await mountChildPanel('onboarding-funnel', funnelHost)
}

// -------------------- Sub-Tab: Cohorts --------------------------------------

async function fetchCohortRetention() {
  try {
    const { data, error } = await sb
      .from('view_cohort_retention')
      .select('*')
      .order('cohort_week', { ascending: false })
      .limit(20)
    if (!error && Array.isArray(data)) return { rows: data, ok: true }
    if (error) console.warn('[_tab-growth] view_cohort_retention:', error.message)
  } catch (e) {
    console.warn('[_tab-growth] view_cohort_retention throw:', e.message)
  }
  return { rows: [], ok: false }
}

function normalizeCohortRows(rows) {
  return rows.map(r => {
    const size = Number(r.cohort_size || r.signups_count || r.size || r.users || 0)
    return {
      week: r.cohort_week || r.week || r.cohort || '',
      size,
      d1: normalizePct(r.d1_rate ?? r.d1 ?? r.day_1 ?? r.retention_d1, size),
      d7: normalizePct(r.d7_rate ?? r.d7 ?? r.day_7 ?? r.retention_d7, size),
      d30: normalizePct(r.d30_rate ?? r.d30 ?? r.day_30 ?? r.retention_d30, size)
    }
  })
}

function heatCell(p) {
  if (p == null || isNaN(p)) {
    return '<td class="num tg-cohort-heat" style="background:rgba(31,31,46,.4); color:#6B7280;">—</td>'
  }
  const v = Math.round(p)
  const bg = pctColor(v)
  // Contrast: dark bg → light text, light/yellow bg → dark text
  const fg = v >= 70 ? '#111827' : '#F9FAFB'
  return `<td class="num tg-cohort-heat" style="background:${bg}; color:${fg}; font-weight:600;">${v}%</td>`
}

async function renderCohorts(host) {
  host.innerHTML = `
    <div class="glass-card" style="padding:18px;">
      <div class="tg-card-title">👥 Wochen-Cohorts · D1 / D7 / D30 Retention</div>
      <div id="tg-cohorts-body"></div>
    </div>
  `
  const body = host.querySelector('#tg-cohorts-body')
  body.innerHTML = skeletonLoader({ count: 6, height: 44, layout: 'list' })

  try {
    const { rows, ok } = await fetchCohortRetention()
    if (!ok || !rows.length) {
      renderEmptyState(body, {
        icon: '🗃️',
        title: 'View view_cohort_retention fehlt',
        message: 'Sobald die DB-View view_cohort_retention(cohort_week, cohort_size, d1, d7, d30) angelegt ist, erscheinen die Cohorts hier automatisch. Spalten d1/d7/d30 dürfen als Prozent (0–100), Faktor (0–1) oder absolute User-Anzahl geliefert werden — wird automatisch normalisiert.'
      })
      return
    }

    const normalized = normalizeCohortRows(rows)

    body.innerHTML = `
      <div style="overflow-x:auto; border-radius:10px;">
        <table class="tg-cohort-table tg-heatmap">
          <thead>
            <tr>
              <th>Cohort-Woche</th>
              <th class="num">Signups</th>
              <th class="num">D1</th>
              <th class="num">D7</th>
              <th class="num">D30</th>
            </tr>
          </thead>
          <tbody>
            ${normalized.map(r => `
              <tr>
                <td>${htmlEscape(formatWeek(r.week))}</td>
                <td class="num">${fmtNumber(r.size)}</td>
                ${heatCell(r.d1)}
                ${heatCell(r.d7)}
                ${heatCell(r.d30)}
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      <div style="display:flex; gap:8px; align-items:center; margin-top:10px; font-size:11px; color:#9CA3AF;">
        <span>0%</span>
        <div style="flex:1; height:10px; border-radius:5px; background:linear-gradient(90deg, ${pctColor(5)}, ${pctColor(25)}, ${pctColor(50)}, ${pctColor(75)}, ${pctColor(95)});"></div>
        <span>100%</span>
      </div>
      <div class="tg-tools">
        <button class="tg-btn" id="tg-cohorts-csv">⬇️ CSV exportieren</button>
        <div style="color:#9CA3AF; font-size:12px; align-self:center;">
          ${normalized.length} Cohorts · Quelle: view_cohort_retention
        </div>
      </div>
    `

    body.querySelector('#tg-cohorts-csv')?.addEventListener('click', () => {
      try {
        exportCsv('cohorts.csv', normalized.map(r => ({
          cohort_week: r.week,
          cohort_size: r.size,
          d1_pct: r.d1 ?? '',
          d7_pct: r.d7 ?? '',
          d30_pct: r.d30 ?? ''
        })))
        toast('CSV exportiert', 'success')
      } catch (e) {
        toast('CSV-Export fehlgeschlagen: ' + (e.message || ''), 'error')
      }
    })
  } catch (e) {
    renderErrorState(body, e, () => renderCohorts(host))
  }
}

// -------------------- Sub-Tab: Retention Heat-Map ---------------------------

async function renderRetention(host) {
  host.innerHTML = `
    <div class="glass-card" style="padding:18px;">
      <div class="tg-card-title">🟪 Retention Heat-Map · Cohort × Day</div>
      <div id="tg-retention-body"></div>
    </div>
  `
  const body = host.querySelector('#tg-retention-body')
  body.innerHTML = skeletonLoader({ height: 320, radius: 10 })

  try {
    const { rows, ok } = await fetchCohortRetention()
    if (!ok || !rows.length) {
      renderEmptyState(body, {
        icon: '🗃️',
        title: 'View view_cohort_retention fehlt',
        message: 'Die Heat-Map nutzt dieselbe View wie das Cohort-Tab. Sobald view_cohort_retention da ist, wird sie hier automatisch gerendert.'
      })
      return
    }

    const normalized = normalizeCohortRows(rows)
    const cols = [
      { key: 'd1',  label: 'D1' },
      { key: 'd7',  label: 'D7' },
      { key: 'd30', label: 'D30' }
    ]
    const gridCols = `minmax(180px, 1.3fr) repeat(${cols.length}, minmax(70px, 1fr))`

    let html = `<div style="overflow-x:auto; -webkit-overflow-scrolling:touch; border-radius:10px;"><div class="tg-heat" style="grid-template-columns:${gridCols}; min-width:380px;">`
    // Header
    html += `<div class="tg-heat-label" style="font-weight:600; color:#fff;">Cohort</div>`
    cols.forEach(c => {
      html += `<div class="tg-heat-label" style="justify-content:center; font-weight:600; color:#fff;">${c.label}</div>`
    })
    // Rows
    normalized.forEach(r => {
      html += `
        <div class="tg-heat-label" title="Cohort-Größe: ${fmtNumber(r.size)} Nutzer">
          <div>
            ${htmlEscape(formatWeek(r.week))}
            <div style="opacity:.55; font-size:10px;">${fmtNumber(r.size)} Nutzer</div>
          </div>
        </div>
      `
      cols.forEach(c => {
        const v = r[c.key]
        const bg = pctColor(v)
        const txt = v == null ? '—' : `${v}%`
        const title = v == null ? `${c.label}: keine Daten` : `Cohort ${formatWeek(r.week)} · ${c.label}: ${v}%`
        html += `<div class="tg-heat-cell" style="background:${bg};" title="${htmlEscape(title)}">${txt}</div>`
      })
    })
    html += `</div></div>`
    html += `
      <div class="tg-heat-legend">
        <span>0%</span>
        <div class="grad"></div>
        <span>100%</span>
        <span style="margin-left:auto;">${normalized.length} Cohorts</span>
      </div>
    `
    body.innerHTML = html
  } catch (e) {
    renderErrorState(body, e, () => renderRetention(host))
  }
}

// -------------------- Sub-Tab: Forecast -------------------------------------

async function fetchForecast() {
  // admin_signup_forecast(p_days int) — toleranter Param-Name Fallback
  let lastErr = null
  for (const argName of ['p_days', 'days']) {
    try {
      const { data, error } = await sb.rpc('admin_signup_forecast', { [argName]: 30 })
      if (!error) return { rows: data || [], ok: true }
      lastErr = error
    } catch (e) {
      lastErr = e
    }
  }
  return { rows: [], ok: false, error: lastErr }
}

async function renderForecast(host) {
  host.innerHTML = `
    <div class="glass-card" style="padding:18px;">
      <div class="tg-card-title">📈 Signup-Forecast · 30 Tage mit Konfidenzband</div>
      <div id="tg-forecast-body"></div>
    </div>
  `
  const body = host.querySelector('#tg-forecast-body')
  body.innerHTML = skeletonLoader({ height: 340, radius: 10 })

  const { rows, ok, error } = await fetchForecast()
  if (!ok) {
    renderEmptyState(body, {
      icon: '📉',
      title: 'RPC admin_signup_forecast fehlt',
      message: `Sobald admin_signup_forecast(p_days int) angelegt ist (Rückgabe: date, value/yhat, ci_lower/yhat_lower, ci_upper/yhat_upper), erscheint der Forecast hier automatisch. ${error?.message ? '(' + error.message + ')' : ''}`
    })
    return
  }
  if (!rows.length) {
    renderEmptyState(body, {
      icon: '📉',
      title: 'Keine Forecast-Daten',
      message: 'Das RPC lieferte 0 Zeilen. Prüfe ob Trainings-Daten vorhanden sind.'
    })
    return
  }

  const points = rows.map(r => ({
    date: r.forecast_date || r.date || r.day || r.ds || r.t,
    value: Number(r.predicted_count ?? r.value ?? r.forecast ?? r.yhat ?? r.signups ?? 0),
    lo:    Number(r.lower_ci ?? r.ci_lower ?? r.lower ?? r.yhat_lower ?? r.lo ?? NaN),
    hi:    Number(r.upper_ci ?? r.ci_upper ?? r.upper ?? r.yhat_upper ?? r.hi ?? NaN)
  })).filter(p => p.date)

  const categories = points.map(p => p.date)
  const hasCI = points.some(p => !isNaN(p.lo) && !isNaN(p.hi))

  // CI-Band als gefüllte Area: untere Linie (transparent) + Differenz (hi-lo)
  // gestapelt darüber → sichtbares Band zwischen lower_ci und upper_ci.
  // Die Forecast-Linie liegt als Line-Series oben drauf.
  const series = []
  if (hasCI) {
    series.push({
      name: 'CI unten',
      type: 'area',
      data: points.map(p => isNaN(p.lo) ? null : p.lo)
    })
    series.push({
      name: 'CI-Band',
      type: 'area',
      data: points.map(p => (isNaN(p.lo) || isNaN(p.hi)) ? null : (p.hi - p.lo))
    })
  }
  series.push({
    name: 'Forecast',
    type: 'line',
    data: points.map(p => p.value)
  })

  const total = points.reduce((s, p) => s + p.value, 0)
  const avg = Math.round(total / Math.max(1, points.length))

  body.innerHTML = `
    <div id="tg-forecast-chart" style="height:280px;"></div>
    <div class="tg-forecast-meta">
      <div>Datenpunkte: <strong>${fmtNumber(points.length)}</strong></div>
      <div>Prognose-Summe: <strong>${fmtNumber(total)}</strong></div>
      <div>Ø pro Tag: <strong>${fmtNumber(avg)}</strong></div>
      <div>CI-Band: <strong style="color:${hasCI ? '#34D399' : '#FCD34D'};">${hasCI ? 'aktiv' : 'nicht in RPC-Response'}</strong></div>
    </div>
    <div class="tg-tools">
      <button class="tg-btn" id="tg-forecast-csv">⬇️ CSV exportieren</button>
    </div>
  `

  const chartHost = body.querySelector('#tg-forecast-chart')
  try {
    const draw = (typeof Charts.makeLineChart === 'function')
      ? Charts.makeLineChart
      : Charts.makeAreaChart
    if (typeof draw !== 'function') throw new Error('Kein passender Chart-Helper in /lib/charts.js')
    // Farben: CI-Band in transparentem Lila-Ton, Forecast in #7C5CFF.
    const colors = hasCI
      ? ['transparent', 'rgba(124,92,255,0.18)', '#7C5CFF']
      : ['#7C5CFF']
    draw(chartHost, {
      categories,
      series,
      colors,
      height: 280,
      stacked: hasCI,
      smooth: true
    })
  } catch (e) {
    chartHost.innerHTML = `<div class="tg-empty"><div style="font-size:32px;">⚠️</div><h4>Chart-Fehler</h4><p>${htmlEscape(e.message || '')}</p></div>`
  }

  body.querySelector('#tg-forecast-csv')?.addEventListener('click', () => {
    try {
      exportCsv('signup-forecast-30d.csv', points.map(p => ({
        date: p.date,
        forecast: p.value,
        ci_lower: isNaN(p.lo) ? '' : p.lo,
        ci_upper: isNaN(p.hi) ? '' : p.hi
      })))
      toast('CSV exportiert', 'success')
    } catch (e) {
      toast('CSV-Export fehlgeschlagen: ' + (e.message || ''), 'error')
    }
  })
}

// -------------------- Sub-Tab: DAU ------------------------------------------

async function renderDau(host) {
  host.innerHTML = `<div class="growth-tile glass-card" id="tg-dau-host" style="padding:0; overflow:hidden;"></div>`
  const dauHost = host.querySelector('#tg-dau-host')
  await mountChildPanel('dau-trend', dauHost)
}

// -------------------- Render Sub-Tab Body -----------------------------------

async function renderSubTab(subKey) {
  state.activeSub = subKey
  const meta = SUBTABS.find(s => s.key === subKey)
  if (!meta) return

  // Active-Pill
  state.panelRoot?.querySelectorAll('.subtab-pill').forEach(p => {
    p.classList.toggle('is-active', p.dataset.sub === subKey)
  })

  // Sub-Description
  const subDesc = state.panelRoot?.querySelector('#tg-subdesc')
  if (subDesc) subDesc.textContent = meta.desc || ''

  const body = state.panelRoot?.querySelector('#subtab-body')
  if (!body) return

  // Unmount prior children
  await unmountAllChildren()

  // Loading state
  body.innerHTML = `<div class="loading">${typeof spinnerHtml === 'function' ? spinnerHtml() : 'Lädt…'}</div>`

  try {
    switch (subKey) {
      case 'funnel':    await renderFunnel(body);    break
      case 'cohorts':   await renderCohorts(body);   break
      case 'retention': await renderRetention(body); break
      case 'forecast':  await renderForecast(body);  break
      case 'dau':       await renderDau(body);       break
      default:          await renderFunnel(body)
    }
  } catch (e) {
    console.error('[_tab-growth] renderSubTab failed', subKey, e)
    renderErrorState(body, e, () => renderSubTab(subKey))
  }
}

// -------------------- URL-Hash Helpers --------------------------------------
// Hash-Format ist `<tab>/<sub>` — entspricht dem Outer-Router in index.html.
// Wir nutzen replaceState beim Sub-Wechsel um keinen weiteren loadPanel()-Cycle
// auszulösen (Outer-Loader triggert nur bei vollem hashchange).

function setSubInHash(subKey) {
  const raw = location.hash.replace(/^#/, '')
  const [path, query = ''] = raw.split('?')
  const segs = path.split('/').filter(Boolean)
  const tab = segs[0] || 'growth'
  if (tab !== 'growth') return
  const next = `#growth/${subKey}${query ? '?' + query : ''}`
  if (location.hash !== next) {
    history.replaceState(null, '', next)
  }
}

// -------------------- Public mount() / unmount() ----------------------------

export default {
  id: 'growth',
  title: 'Growth',
  category: 'growth',

  async mount(container, ctx = {}) {
    injectStyles()
    state.panelRoot = container
    state.ctx = ctx
    container.id = 'panel-tab-growth'

    // Initial sub aus Outer-Router ctx (z.B. 'cohorts'), Fallback Default.
    const initialSub = (ctx?.sub && SUBTABS.find(s => s.key === ctx.sub))
      ? ctx.sub
      : DEFAULT_SUB
    state.activeSub = initialSub

    const pillsHtml = SUBTABS.map(s => `
      <button class="subtab-pill ${s.key === state.activeSub ? 'is-active' : ''}"
              data-sub="${s.key}"
              style="padding:8px 14px;border-radius:999px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.04);color:#E5E7EB;cursor:pointer;font-size:.9rem;display:inline-flex;align-items:center;gap:6px;font-family:inherit;font-weight:500;">
        <span>${s.icon}</span><span>${htmlEscape(s.label)}</span>
      </button>
    `).join('')

    container.innerHTML = `
      <div class="panel-shell">
        <div class="panel-head glass-card" style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; padding:14px 18px;">
          <div>
            <h2 class="panel-title" style="margin:0;">📈 Growth</h2>
            <p class="panel-sub" id="tg-subdesc" style="margin:2px 0 0; color:#9CA3AF; font-size:13px;">${htmlEscape(SUBTABS.find(s => s.key === initialSub)?.desc || '')}</p>
          </div>
          <div class="tg-tools" style="margin:0;">
            <button class="tg-btn" id="tg-refresh" title="Aktualisieren">🔄 Aktualisieren</button>
            <button class="tg-btn" id="tg-pdf" title="PDF-Export">📄 PDF</button>
          </div>
        </div>

        <div class="subtab-bar glass-card" style="display:flex;flex-wrap:wrap;gap:8px;padding:10px 12px;margin:12px 0;">
          ${pillsHtml}
        </div>

        <div id="subtab-body"><div class="loading">Lädt…</div></div>
      </div>
    `

    try { fadeIn(container, { duration: 240 }) } catch (_) {}

    // Wire Pills
    container.querySelectorAll('.subtab-pill').forEach(btn => {
      btn.addEventListener('click', async () => {
        const sub = btn.dataset.sub
        if (!sub || sub === state.activeSub) return
        setSubInHash(sub)
        await renderSubTab(sub)
      })
    })

    // Refresh-Button: aktiven Sub neu rendern
    container.querySelector('#tg-refresh')?.addEventListener('click', async () => {
      try { toast('Aktualisiere…', 'info') } catch (_) {}
      await renderSubTab(state.activeSub)
    })

    // PDF-Export
    container.querySelector('#tg-pdf')?.addEventListener('click', () => {
      try {
        exportPanelAsPdf(container, {
          title: `Growth · ${SUBTABS.find(s => s.key === state.activeSub)?.label || ''}`,
          filename: `growth-${state.activeSub}.pdf`
        })
      } catch (e) {
        try { toast('PDF-Export fehlgeschlagen: ' + (e.message || ''), 'error') } catch (_) {}
      }
    })

    // Initial render
    await renderSubTab(initialSub)
  },

  async unmount() {
    await unmountAllChildren()
    state.panelRoot = null
    state.activeSub = DEFAULT_SUB
    state.ctx = null
  }
}
