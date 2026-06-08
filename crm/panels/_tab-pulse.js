// Pulse Top-Tab — bundelt 4 Sub-Panels (Now / Today / Alerts / Stream)
// Schema-Truth: nutzt NUR die in CLAUDE-Memory dokumentierten Tabellen + RPCs.
// Sub-Panels:
//   - now:             reused → admin-home.js (Smart-Alerts + Hero)
//   - today:           NEU — Tagesreport (signups/posts/listens/bugs + Δ vs gestern)
//   - alerts:          NEU — admin_anomaly_detect() RPC → Liste z>2 Anomalien (mit Fallback)
//   - activity-stream: reused → audit-log.js (Realtime Audit-Feed)

import { sb } from '/lib/supabase.js?v=20260608g'
import { toast, fmtNumber, fmtDateTime, fmtRelativeTime, htmlEscape, iconHtml } from '/lib/ui.js?v=20260608g'
import { fadeIn, countUp } from '/lib/animations.js?v=20260608g'
import { glassCard, pullToRefresh } from '/lib/layout-extras.js?v=20260608g'

import adminHome from '/panels/admin-home.js?v=20260608g'
import auditLog  from '/panels/audit-log.js?v=20260608g'

// ---------- STYLES ----------

function styles() {
  return `<style>
    .pulse-shell { display:flex; flex-direction:column; gap:16px; }
    .pulse-head { display:flex; flex-direction:column; gap:4px; padding:4px 4px 0; }
    .pulse-head h2 { margin:0; font-size:22px; font-weight:700; letter-spacing:-0.3px; }
    .pulse-head .sub { font-size:13px; color:var(--text-muted,#9ca3af); }

    .pulse-seg {
      display:inline-flex; gap:4px; padding:4px;
      background:rgba(255,255,255,0.04);
      border:1px solid rgba(255,255,255,0.06);
      border-radius:14px;
      align-self:flex-start;
      flex-wrap:wrap;
    }
    .pulse-seg button {
      background:transparent; border:0; color:var(--text-muted,#9ca3af);
      padding:8px 14px; border-radius:10px;
      font-size:13px; font-weight:600; cursor:pointer;
      display:inline-flex; align-items:center; gap:6px;
      transition: background .15s, color .15s, transform .15s;
    }
    .pulse-seg button:hover { color:var(--text,#fff); }
    .pulse-seg button.active {
      background: linear-gradient(135deg, #7C5CFF 0%, #5B8DEF 100%);
      color:#fff; box-shadow:0 4px 12px rgba(124,92,255,0.35);
    }
    .pulse-seg .dot {
      width:6px; height:6px; border-radius:50%;
      background:#22D3EE; box-shadow:0 0 8px #22D3EE;
      animation: pulseDot 1.8s infinite ease-in-out;
    }
    @keyframes pulseDot { 0%,100%{opacity:1} 50%{opacity:.35} }

    .pulse-body { min-height:240px; position:relative; }

    /* Today-Report */
    .td-grid {
      display:grid; gap:14px;
      grid-template-columns:repeat(auto-fit,minmax(190px,1fr));
    }
    .td-card {
      background:rgba(255,255,255,0.03);
      border:1px solid rgba(255,255,255,0.06);
      border-radius:18px; padding:18px;
      display:flex; flex-direction:column; gap:8px;
      position:relative; overflow:hidden;
    }
    .td-card .lab { font-size:12px; color:var(--text-muted,#9ca3af); text-transform:uppercase; letter-spacing:0.5px; }
    .td-card .val { font-size:28px; font-weight:700; line-height:1; }
    .td-card .delta { font-size:12px; font-weight:600; display:inline-flex; align-items:center; gap:3px; }
    .td-card .delta.up   { color:#10B981; }
    .td-card .delta.down { color:#EF4444; }
    .td-card .delta.flat { color:var(--text-muted,#9ca3af); }
    .td-card .ico {
      position:absolute; top:14px; right:14px; opacity:.18; font-size:36px;
    }
    .td-empty { text-align:center; padding:40px 20px; color:var(--text-muted,#9ca3af); }

    /* Alerts */
    .al-list { display:flex; flex-direction:column; gap:10px; }
    .al-item {
      display:flex; gap:12px; padding:14px;
      background:rgba(255,255,255,0.03);
      border:1px solid rgba(255,255,255,0.06);
      border-radius:14px;
      align-items:flex-start;
    }
    .al-item.sev-critical { border-left:3px solid #EF4444; }
    .al-item.sev-warn     { border-left:3px solid #F59E0B; }
    .al-item.sev-info     { border-left:3px solid #22D3EE; }
    .al-icon {
      width:36px; height:36px; border-radius:10px;
      background:rgba(255,255,255,0.05);
      display:flex; align-items:center; justify-content:center;
      flex-shrink:0; font-size:18px;
    }
    .al-body { flex:1; min-width:0; }
    .al-title { font-size:14px; font-weight:600; margin-bottom:2px; }
    .al-meta { font-size:12px; color:var(--text-muted,#9ca3af); }
    .al-z {
      padding:3px 8px; border-radius:8px;
      font-size:11px; font-weight:700;
      background:rgba(239,68,68,0.15); color:#EF4444;
      white-space:nowrap;
    }
    .al-empty { text-align:center; padding:40px 20px; color:var(--text-muted,#9ca3af);
      background:rgba(255,255,255,0.02); border-radius:18px; border:1px dashed rgba(255,255,255,0.08);
    }
    .al-empty .big { font-size:32px; margin-bottom:8px; opacity:.7; }
  </style>`
}

// ---------- TODAY-REPORT ----------

const TODAY_METRICS = [
  { key:'signups',  label:'Signups',   icon:'👥', color:'#7C5CFF' },
  { key:'posts',    label:'Beiträge',  icon:'📝', color:'#F59E0B' },
  { key:'listens',  label:'Hör-Events',icon:'🎧', color:'#10B981' },
  { key:'bugs',     label:'Bug-Reports',icon:'🐞',color:'#EF4444' }
]

async function fetchTodaySeries(metric) {
  // 2 Tage: heute + gestern, via admin_daily_series (SECURITY DEFINER)
  try {
    const { data, error } = await sb.rpc('admin_daily_series', { p_metric: metric, p_days: 2 })
    if (error) throw error
    const arr = Array.isArray(data) ? data : []
    // erwartet: [{ day, value }] absteigend oder aufsteigend — beide Fälle absichern
    if (!arr.length) return { today: 0, yest: 0 }
    const sorted = [...arr].sort((a, b) => String(a.day).localeCompare(String(b.day)))
    const today = Number(sorted[sorted.length - 1]?.value || 0)
    const yest  = Number(sorted[sorted.length - 2]?.value || 0)
    return { today, yest }
  } catch (_) {
    // Fallback: bugs via direkte Query (admin_daily_series unterstützt 'bugs' evtl. nicht)
    if (metric === 'bugs') {
      try {
        const startToday = new Date(); startToday.setHours(0,0,0,0)
        const startYest  = new Date(startToday.getTime() - 86400000)
        const [{ count: c1 }, { count: c2 }] = await Promise.all([
          sb.from('bug_reports').select('id', { count:'exact', head:true }).gte('created_at', startToday.toISOString()),
          sb.from('bug_reports').select('id', { count:'exact', head:true })
            .gte('created_at', startYest.toISOString())
            .lt('created_at', startToday.toISOString())
        ])
        return { today: c1 || 0, yest: c2 || 0 }
      } catch (_) { return { today: 0, yest: 0 } }
    }
    return { today: 0, yest: 0 }
  }
}

function deltaHtml(today, yest) {
  if (yest === 0 && today === 0) return `<span class="delta flat">·</span>`
  if (yest === 0) return `<span class="delta up">▲ neu</span>`
  const pct = ((today - yest) / yest) * 100
  if (Math.abs(pct) < 0.5) return `<span class="delta flat">≈ ${fmtNumber(yest)} gestern</span>`
  const cls = pct > 0 ? 'up' : 'down'
  const arr = pct > 0 ? '▲' : '▼'
  return `<span class="delta ${cls}">${arr} ${Math.abs(pct).toFixed(0)}% vs ${fmtNumber(yest)} gestern</span>`
}

async function mountToday(host) {
  host.innerHTML = `<div class="td-grid">${
    TODAY_METRICS.map(m => `
      <div class="td-card" data-metric="${m.key}">
        <div class="ico">${m.icon}</div>
        <div class="lab">${m.label}</div>
        <div class="val" data-val>—</div>
        <div data-delta>…</div>
      </div>
    `).join('')
  }</div>`

  const results = await Promise.all(TODAY_METRICS.map(m => fetchTodaySeries(m.key)))
  TODAY_METRICS.forEach((m, i) => {
    const { today, yest } = results[i]
    const card = host.querySelector(`[data-metric="${m.key}"]`)
    if (!card) return
    const valEl = card.querySelector('[data-val]')
    valEl.textContent = fmtNumber(today)
    try { countUp(valEl, 0, today, 800) } catch (_) {}
    card.querySelector('[data-delta]').innerHTML = deltaHtml(today, yest)
  })
}

// ---------- ALERTS (Anomaly-Detect) ----------

function severityFor(z) {
  const az = Math.abs(z || 0)
  if (az >= 3.5) return 'critical'
  if (az >= 2.0) return 'warn'
  return 'info'
}

function iconForMetric(m) {
  const map = { signups:'👥', posts:'📝', listens:'🎧', bugs:'🐞', app_opens:'📱', listening_hours:'⏱️' }
  return map[m] || '📊'
}

async function fetchAnomalies() {
  // Primär: admin_anomaly_detect RPC (server-side z-score Berechnung)
  try {
    const { data, error } = await sb.rpc('admin_anomaly_detect')
    if (!error && Array.isArray(data)) {
      return data
        .map(r => ({
          metric: r.metric || r.key || 'unknown',
          value:  Number(r.value ?? r.today ?? 0),
          mean:   Number(r.mean ?? r.avg ?? 0),
          z:      Number(r.z ?? r.z_score ?? r.zscore ?? 0),
          direction: r.direction || (Number(r.z ?? 0) > 0 ? 'up' : 'down'),
          note:   r.note || r.message || null
        }))
        .filter(a => Math.abs(a.z) >= 2)
        .sort((a, b) => Math.abs(b.z) - Math.abs(a.z))
    }
  } catch (_) {}

  // Fallback: client-side z-score über admin_daily_series (14 Tage)
  const metrics = ['signups', 'posts', 'listens', 'app_opens']
  const out = []
  await Promise.all(metrics.map(async (metric) => {
    try {
      const { data } = await sb.rpc('admin_daily_series', { p_metric: metric, p_days: 14 })
      const arr = Array.isArray(data) ? data : []
      if (arr.length < 4) return
      const sorted = [...arr].sort((a, b) => String(a.day).localeCompare(String(b.day)))
      const today = Number(sorted[sorted.length - 1]?.value || 0)
      const hist = sorted.slice(0, -1).map(r => Number(r.value || 0))
      const mean = hist.reduce((s, v) => s + v, 0) / hist.length
      const variance = hist.reduce((s, v) => s + (v - mean) ** 2, 0) / hist.length
      const sd = Math.sqrt(variance)
      if (sd < 0.5) return
      const z = (today - mean) / sd
      if (Math.abs(z) >= 2) {
        out.push({
          metric, value: today, mean: Math.round(mean), z,
          direction: z > 0 ? 'up' : 'down',
          note: null
        })
      }
    } catch (_) {}
  }))
  return out.sort((a, b) => Math.abs(b.z) - Math.abs(a.z))
}

async function mountAlerts(host) {
  host.innerHTML = `<div class="al-list" data-list>
    <div class="al-empty"><div class="big">📡</div>Scanne Metriken …</div>
  </div>`
  const listEl = host.querySelector('[data-list]')

  let items = []
  try { items = await fetchAnomalies() } catch (e) {
    listEl.innerHTML = `<div class="al-empty">Anomaly-Detect nicht verfügbar.<br><small>${htmlEscape(e.message || String(e))}</small></div>`
    return
  }

  if (!items.length) {
    listEl.innerHTML = `<div class="al-empty">
      <div class="big">✓</div>
      Alles im grünen Bereich — keine Metriken außerhalb z &gt; 2.
    </div>`
    return
  }

  listEl.innerHTML = items.map(a => {
    const sev = severityFor(a.z)
    const arr = a.direction === 'up' ? '▲' : '▼'
    const noteStr = a.note ? ` · ${htmlEscape(a.note)}` : ''
    return `<div class="al-item sev-${sev}">
      <div class="al-icon">${iconForMetric(a.metric)}</div>
      <div class="al-body">
        <div class="al-title">${htmlEscape(a.metric)} ${arr} ${fmtNumber(a.value)}</div>
        <div class="al-meta">Ø ${fmtNumber(a.mean)} · ${a.direction === 'up' ? 'über' : 'unter'} dem Mittel${noteStr}</div>
      </div>
      <div class="al-z">z = ${a.z.toFixed(1)}</div>
    </div>`
  }).join('')
}

// ---------- SUB-TAB DISPATCH ----------

const SUB_TABS = [
  { id:'now',    label:'Now',    live:true,  icon:'⚡' },
  { id:'today',  label:'Today',  live:false, icon:'📅' },
  { id:'alerts', label:'Alerts', live:false, icon:'🚨' },
  { id:'stream', label:'Stream', live:true,  icon:'📜' }
]

async function mountSubTab(id, host) {
  // jeder Sub-Tab bekommt frischen Container — vorheriger wird verworfen
  host.innerHTML = ''
  const inner = document.createElement('div')
  host.appendChild(inner)

  try {
    if (id === 'now') {
      await adminHome.mount(inner)
    } else if (id === 'today') {
      await mountToday(inner)
    } else if (id === 'alerts') {
      await mountAlerts(inner)
    } else if (id === 'stream') {
      await auditLog.mount(inner)
    }
    try { fadeIn(inner) } catch (_) {}
  } catch (e) {
    inner.innerHTML = `<div class="al-empty">Fehler beim Laden: ${htmlEscape(e.message || String(e))}</div>`
  }
}

// ---------- EXPORT ----------

export default {
  id: 'tab-pulse',
  title: 'Pulse',
  category: 'pulse',

  async mount(container) {
    container.innerHTML = `${styles()}
      <div class="pulse-shell">
        <div class="pulse-head">
          <h2>Pulse</h2>
          <div class="sub">Live-Puls des Systems — Now, Today, Alerts &amp; Activity-Stream.</div>
        </div>

        <div class="pulse-seg" role="tablist" id="pulse-seg">
          ${SUB_TABS.map((t, i) => `
            <button data-sub="${t.id}" class="${i === 0 ? 'active' : ''}" role="tab">
              <span>${t.icon}</span><span>${t.label}</span>
              ${t.live ? `<span class="dot" aria-hidden="true"></span>` : ''}
            </button>
          `).join('')}
        </div>

        <div class="pulse-body" id="pulse-body"></div>
      </div>`

    try { fadeIn(container) } catch (_) {}

    const seg  = container.querySelector('#pulse-seg')
    const body = container.querySelector('#pulse-body')
    let current = 'now'

    const switchTo = async (id) => {
      if (id === current) return
      current = id
      seg.querySelectorAll('button').forEach(b => {
        b.classList.toggle('active', b.dataset.sub === id)
      })
      await mountSubTab(id, body)
    }

    seg.addEventListener('click', (ev) => {
      const btn = ev.target.closest('button[data-sub]')
      if (!btn) return
      switchTo(btn.dataset.sub).catch(e => toast?.('Fehler: ' + (e.message || e), 'error'))
    })

    // initial: Now
    await mountSubTab('now', body)

    // Pull-to-Refresh: re-mountet aktuellen Sub-Tab
    try {
      pullToRefresh(container, async () => {
        await mountSubTab(current, body)
      })
    } catch (_) {}
  }
}
