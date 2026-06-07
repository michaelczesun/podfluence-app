import { sb } from '/lib/supabase.js'
import { toast, modal, confirmDialog, fmtNumber, fmtDateTime, fmtRelativeTime, htmlEscape, iconHtml, debounce, spinnerHtml } from '/lib/ui.js'
import { makeDonutChart, makeBarChart, makeAreaChart } from '/lib/charts.js'
import { exportPanelAsPdf, exportCsv } from '/lib/export.js'
import { countUp, fadeIn, skeletonLoader } from '/lib/animations.js'
import { drawer, statHero, glassCard } from '/lib/layout-extras.js'
import { resolveBugReport, showUserDetailModal } from '/lib/panel-actions.js'

const STATUS_COLS = [
  { key: 'open', label: 'Offen', icon: '🐞', accent: '#ef4444' },
  { key: 'in-progress', label: 'In Arbeit', icon: '🔧', accent: '#f59e0b' },
  { key: 'resolved', label: 'Erledigt', icon: '✅', accent: '#10b981' }
]

const PRIORITY_META = {
  critical: { label: 'Kritisch', color: '#dc2626', rank: 0 },
  high:     { label: 'Hoch',     color: '#f97316', rank: 1 },
  medium:   { label: 'Mittel',   color: '#eab308', rank: 2 },
  low:      { label: 'Niedrig',  color: '#3b82f6', rank: 3 }
}

const state = {
  reports: [],
  filters: { priority: 'all', age: 'all', reporter: 'all' },
  loading: false
}

function ageBucket(createdAt) {
  const diff = (Date.now() - new Date(createdAt).getTime()) / 36e5
  if (diff < 24) return 'today'
  if (diff < 24 * 7) return 'week'
  return 'older'
}

function normalizeStatus(s) {
  if (!s) return 'open'
  const v = String(s).toLowerCase().replace('_', '-')
  if (v === 'inprogress' || v === 'in-progress' || v === 'wip') return 'in-progress'
  if (v === 'resolved' || v === 'closed' || v === 'done') return 'resolved'
  return 'open'
}

function normalizePriority(p) {
  const v = (p || 'medium').toLowerCase()
  return PRIORITY_META[v] ? v : 'medium'
}

async function fetchReports() {
  const { data, error } = await sb
    .from('bug_reports')
    .select('id, title, description, status, priority, reporter_id, reporter_name, reporter_email, resolution, resolved_at, resolved_by, device_info, app_version, screenshot_url, created_at, updated_at')
    .order('created_at', { ascending: false })
    .limit(500)
  if (error) throw error
  return (data || []).map(r => ({
    ...r,
    status: normalizeStatus(r.status),
    priority: normalizePriority(r.priority)
  }))
}

function applyFilters(reports, f) {
  return reports.filter(r => {
    if (f.priority !== 'all' && r.priority !== f.priority) return false
    if (f.age !== 'all' && ageBucket(r.created_at) !== f.age) return false
    if (f.reporter !== 'all' && r.reporter_id !== f.reporter) return false
    return true
  })
}

function cardHtml(r) {
  const p = PRIORITY_META[r.priority]
  const ageH = (Date.now() - new Date(r.created_at).getTime()) / 36e5
  const ageStr = ageH < 24 ? `${Math.round(ageH)}h` : `${Math.round(ageH / 24)}d`
  return `
    <article class="bug-card glass-card" draggable="true" data-id="${htmlEscape(String(r.id))}" data-status="${r.status}" style="border-left:3px solid ${p.color}">
      <header class="bug-card-head">
        <span class="bug-pri" style="background:${p.color}22;color:${p.color};border:1px solid ${p.color}55">${p.label}</span>
        <span class="bug-age" title="${fmtDateTime(r.created_at)}">${ageStr}</span>
      </header>
      <h4 class="bug-title">${htmlEscape(r.title || 'Ohne Titel')}</h4>
      <p class="bug-snip">${htmlEscape((r.description || '').slice(0, 110))}${(r.description || '').length > 110 ? '…' : ''}</p>
      <footer class="bug-card-foot">
        <span class="bug-reporter">👤 ${htmlEscape(r.reporter_name || r.reporter_email || 'Unbekannt')}</span>
        ${r.app_version ? `<span class="bug-ver">v${htmlEscape(r.app_version)}</span>` : ''}
      </footer>
    </article>`
}

function columnHtml(col, reports) {
  const items = reports.filter(r => r.status === col.key)
  return `
    <section class="kanban-col" data-status="${col.key}">
      <header class="kanban-col-head" style="--accent:${col.accent}">
        <div class="kanban-col-title">
          <span class="kanban-ico">${col.icon}</span>
          <span>${col.label}</span>
        </div>
        <span class="kanban-count">${items.length}</span>
      </header>
      <div class="kanban-drop" data-status="${col.key}">
        ${items.length ? items.map(cardHtml).join('') : `<div class="kanban-empty">Keine Tickets</div>`}
      </div>
    </section>`
}

function filterPillHtml(group, value, label, active) {
  return `<button class="pill ${active ? 'pill-active' : ''}" data-group="${group}" data-value="${htmlEscape(String(value))}">${htmlEscape(label)}</button>`
}

function renderFilters(reporters) {
  const f = state.filters
  const priPills = ['all', 'critical', 'high', 'medium', 'low']
    .map(v => filterPillHtml('priority', v, v === 'all' ? 'Alle Prios' : PRIORITY_META[v].label, f.priority === v))
    .join('')
  const agePills = [['all','Alle Zeiten'],['today','< 24h'],['week','< 7 Tage'],['older','> 7 Tage']]
    .map(([v,l]) => filterPillHtml('age', v, l, f.age === v)).join('')
  const repPills = [['all', 'Alle Reporter']]
    .concat(reporters.slice(0, 8).map(r => [r.id, r.name]))
    .map(([v, l]) => filterPillHtml('reporter', v, l, f.reporter === v)).join('')
  return `
    <div class="filter-pills-row glass-card">
      <div class="filter-group"><span class="filter-label">Priorität</span>${priPills}</div>
      <div class="filter-group"><span class="filter-label">Alter</span>${agePills}</div>
      <div class="filter-group"><span class="filter-label">Reporter</span>${repPills}</div>
    </div>`
}

function buildStats(reports) {
  const open = reports.filter(r => r.status === 'open').length
  const wip = reports.filter(r => r.status === 'in-progress').length
  const resolved = reports.filter(r => r.status === 'resolved').length
  const critical = reports.filter(r => r.priority === 'critical' && r.status !== 'resolved').length
  return { open, wip, resolved, critical, total: reports.length }
}

function renderHero(stats) {
  const heroCard = (label, value, accent, icon) => {
    if (typeof statHero === 'function') {
      try { return statHero({ label, value, accent, icon }) } catch(e) {}
    }
    return `<div class="stat-hero glass-card" style="--accent:${accent}"><div class="stat-ico">${icon}</div><div class="stat-label">${label}</div><div class="stat-value" data-count="${value}">0</div></div>`
  }
  return `
    <div class="hero-grid">
      ${heroCard('Offene Tickets', stats.open, '#ef4444', '🐞')}
      ${heroCard('In Arbeit', stats.wip, '#f59e0b', '🔧')}
      ${heroCard('Erledigt', stats.resolved, '#10b981', '✅')}
      ${heroCard('Kritisch offen', stats.critical, '#dc2626', '🚨')}
    </div>`
}

function buildTrendSeries(reports) {
  const days = []
  const now = new Date(); now.setHours(0,0,0,0)
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now); d.setDate(d.getDate() - i)
    days.push({ date: d, label: d.toLocaleDateString('de-DE', { day:'2-digit', month:'2-digit' }), count: 0 })
  }
  reports.forEach(r => {
    const c = new Date(r.created_at); c.setHours(0,0,0,0)
    const idx = days.findIndex(d => d.date.getTime() === c.getTime())
    if (idx >= 0) days[idx].count++
  })
  return days
}

function buildPriorityBreakdown(reports) {
  const acc = { critical: 0, high: 0, medium: 0, low: 0 }
  reports.filter(r => r.status !== 'resolved').forEach(r => { acc[r.priority] = (acc[r.priority] || 0) + 1 })
  return Object.entries(acc).map(([k, v]) => ({ label: PRIORITY_META[k].label, value: v, color: PRIORITY_META[k].color }))
}

function detailDrawerHtml(r) {
  const p = PRIORITY_META[r.priority]
  const statusLabel = STATUS_COLS.find(c => c.key === r.status)?.label || r.status
  return `
    <div class="bug-detail">
      <div class="bug-detail-head">
        <span class="bug-pri" style="background:${p.color}22;color:${p.color};border:1px solid ${p.color}55">${p.label}</span>
        <span class="bug-status-tag bug-status-${r.status}">${statusLabel}</span>
      </div>
      <h3>${htmlEscape(r.title || 'Ohne Titel')}</h3>
      <div class="bug-meta">
        <div><span>Reporter</span><strong>${htmlEscape(r.reporter_name || r.reporter_email || 'Unbekannt')}</strong></div>
        <div><span>Erstellt</span><strong>${fmtDateTime(r.created_at)}</strong></div>
        <div><span>Vor</span><strong>${fmtRelativeTime(r.created_at)}</strong></div>
        ${r.app_version ? `<div><span>Version</span><strong>v${htmlEscape(r.app_version)}</strong></div>` : ''}
        ${r.device_info ? `<div><span>Gerät</span><strong>${htmlEscape(r.device_info)}</strong></div>` : ''}
      </div>
      <section class="bug-section">
        <h4>Beschreibung</h4>
        <p class="bug-desc">${htmlEscape(r.description || '— keine Beschreibung —')}</p>
      </section>
      ${r.screenshot_url ? `<section class="bug-section"><h4>Screenshot</h4><a href="${htmlEscape(r.screenshot_url)}" target="_blank"><img src="${htmlEscape(r.screenshot_url)}" class="bug-shot"/></a></section>` : ''}
      <section class="bug-section">
        <h4>Resolution</h4>
        <textarea id="bug-resolution" class="bug-resolution" placeholder="Was wurde gemacht? Root cause, Fix, Workaround…">${htmlEscape(r.resolution || '')}</textarea>
      </section>
      <section class="bug-section bug-status-switch">
        <h4>Status ändern</h4>
        <div class="status-buttons">
          ${STATUS_COLS.map(c => `<button class="status-btn ${r.status === c.key ? 'active' : ''}" data-status="${c.key}" style="--accent:${c.accent}">${c.icon} ${c.label}</button>`).join('')}
        </div>
      </section>
      <footer class="bug-actions">
        ${r.reporter_id ? `<button class="btn btn-ghost" id="bug-view-user">👤 Reporter ansehen</button>` : ''}
        <button class="btn btn-primary" id="bug-save-resolution">💾 Speichern</button>
      </footer>
    </div>`
}

async function updateStatus(id, newStatus, resolution) {
  const patch = { status: newStatus, updated_at: new Date().toISOString() }
  if (newStatus === 'resolved') {
    patch.resolved_at = new Date().toISOString()
    if (resolution) patch.resolution = resolution
  } else if (resolution !== undefined && resolution !== null) {
    patch.resolution = resolution
  }
  const { error } = await sb.from('bug_reports').update(patch).eq('id', id)
  if (error) throw error
}

function openDetail(r, refresh) {
  const content = detailDrawerHtml(r)
  let close = () => {}
  let host = null
  if (typeof drawer === 'function') {
    try {
      const ret = drawer({ title: `Bug #${String(r.id).slice(0, 8)}`, side: 'right', width: 540, content })
      if (typeof ret === 'function') close = ret
      else if (ret && typeof ret.close === 'function') close = () => ret.close()
    } catch (e) {
      modal({ title: `Bug #${String(r.id).slice(0, 8)}`, content })
    }
  } else {
    modal({ title: `Bug #${String(r.id).slice(0, 8)}`, content })
  }

  setTimeout(() => {
    host = document.querySelector('.drawer-content, .drawer, .modal-content, .modal') || document
    const txt = host.querySelector('#bug-resolution')
    host.querySelectorAll('.status-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const ns = btn.dataset.status
        try {
          await updateStatus(r.id, ns, txt?.value)
          toast(`Status → ${STATUS_COLS.find(c=>c.key===ns).label}`, 'success')
          close()
          await refresh()
        } catch (e) { toast('Fehler: ' + e.message, 'error') }
      })
    })
    host.querySelector('#bug-save-resolution')?.addEventListener('click', async () => {
      try {
        await updateStatus(r.id, r.status, txt?.value)
        toast('Resolution gespeichert', 'success')
        close()
        await refresh()
      } catch (e) { toast('Fehler: ' + e.message, 'error') }
    })
    host.querySelector('#bug-view-user')?.addEventListener('click', () => {
      if (r.reporter_id && typeof showUserDetailModal === 'function') showUserDetailModal(r.reporter_id)
    })
  }, 80)
}

function wireDragDrop(container, refresh) {
  let draggedId = null
  container.querySelectorAll('.bug-card').forEach(card => {
    card.addEventListener('dragstart', e => {
      draggedId = card.dataset.id
      card.classList.add('dragging')
      e.dataTransfer.effectAllowed = 'move'
    })
    card.addEventListener('dragend', () => { card.classList.remove('dragging'); draggedId = null })
    card.addEventListener('click', () => {
      const r = state.reports.find(x => String(x.id) === String(card.dataset.id))
      if (r) openDetail(r, refresh)
    })
  })
  container.querySelectorAll('.kanban-drop').forEach(drop => {
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('drop-hover') })
    drop.addEventListener('dragleave', () => drop.classList.remove('drop-hover'))
    drop.addEventListener('drop', async e => {
      e.preventDefault()
      drop.classList.remove('drop-hover')
      if (!draggedId) return
      const newStatus = drop.dataset.status
      const r = state.reports.find(x => String(x.id) === String(draggedId))
      if (!r || r.status === newStatus) return
      try {
        await updateStatus(r.id, newStatus)
        toast(`Verschoben → ${STATUS_COLS.find(c=>c.key===newStatus).label}`, 'success')
        await refresh()
      } catch (err) { toast('Fehler: ' + err.message, 'error') }
    })
  })
}

function injectStyles() {
  if (document.getElementById('bug-triage-styles')) return
  const s = document.createElement('style')
  s.id = 'bug-triage-styles'
  s.textContent = `
    .panel-shell{padding:20px;display:flex;flex-direction:column;gap:18px}
    .panel-head{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap}
    .panel-head h2{margin:0;font-size:22px;font-weight:600;letter-spacing:-0.02em}
    .toolbar{display:flex;gap:8px}
    .tb-btn{background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:inherit;padding:8px 14px;border-radius:10px;cursor:pointer;font-size:13px;font-weight:500;transition:all .15s}
    .tb-btn:hover{background:rgba(255,255,255,0.12);transform:translateY(-1px)}
    .panel-body{display:flex;flex-direction:column;gap:16px}
    .hero-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px}
    .stat-hero{padding:18px;border-radius:14px;display:flex;flex-direction:column;gap:6px;position:relative;overflow:hidden}
    .stat-hero::after{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--accent,#6366f1)}
    .stat-ico{font-size:20px}
    .stat-label{font-size:11px;opacity:.6;text-transform:uppercase;letter-spacing:.06em;font-weight:600}
    .stat-value{font-size:30px;font-weight:700;letter-spacing:-0.02em;font-variant-numeric:tabular-nums}
    .charts-row{display:grid;grid-template-columns:2fr 1fr;gap:16px}
    @media (max-width:900px){.charts-row{grid-template-columns:1fr}}
    .chart-card{padding:16px;border-radius:14px}
    .chart-card h4{margin:0 0 12px;font-size:12px;font-weight:600;opacity:.65;text-transform:uppercase;letter-spacing:.05em}
    .filter-pills-row{display:flex;flex-wrap:wrap;gap:18px;padding:14px;border-radius:14px}
    .filter-group{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
    .filter-label{font-size:10px;opacity:.55;text-transform:uppercase;letter-spacing:.08em;margin-right:4px;font-weight:600}
    .pill{background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:inherit;padding:5px 11px;border-radius:999px;font-size:12px;cursor:pointer;transition:all .15s}
    .pill:hover{background:rgba(255,255,255,0.1)}
    .pill-active{background:rgba(99,102,241,0.25);border-color:rgba(99,102,241,0.6);color:#a5b4fc}
    .kanban{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
    @media (max-width:1000px){.kanban{grid-template-columns:1fr}}
    .kanban-col{display:flex;flex-direction:column;background:rgba(255,255,255,0.025);border:1px solid rgba(255,255,255,0.06);border-radius:14px;min-height:300px;overflow:hidden}
    .kanban-col-head{display:flex;justify-content:space-between;align-items:center;padding:12px 14px;border-bottom:1px solid rgba(255,255,255,0.06)}
    .kanban-col-title{display:flex;align-items:center;gap:8px;font-weight:600;font-size:13px}
    .kanban-ico{font-size:15px}
    .kanban-count{background:rgba(255,255,255,0.08);padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600}
    .kanban-drop{padding:10px;display:flex;flex-direction:column;gap:9px;flex:1;min-height:200px;transition:background .15s}
    .kanban-drop.drop-hover{background:rgba(99,102,241,0.08);outline:2px dashed rgba(99,102,241,0.4);outline-offset:-6px}
    .kanban-empty{text-align:center;padding:28px 14px;opacity:.35;font-size:12px;font-style:italic}
    .bug-card{padding:11px 13px;border-radius:10px;cursor:grab;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);transition:all .15s;display:flex;flex-direction:column;gap:6px}
    .bug-card:hover{background:rgba(255,255,255,0.08);transform:translateY(-1px);box-shadow:0 4px 16px rgba(0,0,0,.25)}
    .bug-card.dragging{opacity:.4;cursor:grabbing}
    .bug-card-head{display:flex;justify-content:space-between;align-items:center;font-size:10px}
    .bug-pri{padding:2px 8px;border-radius:999px;font-weight:600;font-size:10px}
    .bug-age{opacity:.55;font-size:11px}
    .bug-title{margin:0;font-size:13px;font-weight:600;line-height:1.3}
    .bug-snip{margin:0;font-size:11.5px;opacity:.65;line-height:1.4}
    .bug-card-foot{display:flex;justify-content:space-between;align-items:center;font-size:10.5px;opacity:.7;margin-top:2px;gap:8px}
    .bug-reporter{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .bug-ver{font-family:ui-monospace,monospace;background:rgba(255,255,255,0.06);padding:1px 6px;border-radius:4px;flex-shrink:0}
    .bug-detail{padding:6px 4px;display:flex;flex-direction:column;gap:16px}
    .bug-detail-head{display:flex;gap:8px}
    .bug-status-tag{padding:3px 10px;border-radius:999px;font-size:11px;font-weight:600}
    .bug-status-open{background:rgba(239,68,68,.15);color:#fca5a5}
    .bug-status-in-progress{background:rgba(245,158,11,.15);color:#fcd34d}
    .bug-status-resolved{background:rgba(16,185,129,.15);color:#6ee7b7}
    .bug-detail h3{margin:0;font-size:18px;font-weight:600;line-height:1.3}
    .bug-meta{display:grid;grid-template-columns:1fr 1fr;gap:8px 16px;padding:12px;background:rgba(255,255,255,0.03);border-radius:10px}
    .bug-meta>div{display:flex;flex-direction:column;gap:2px}
    .bug-meta span{font-size:10px;opacity:.5;text-transform:uppercase;letter-spacing:.05em}
    .bug-meta strong{font-size:12.5px;font-weight:500}
    .bug-section h4{margin:0 0 8px;font-size:11px;font-weight:600;opacity:.6;text-transform:uppercase;letter-spacing:.06em}
    .bug-desc{margin:0;font-size:13.5px;line-height:1.55;white-space:pre-wrap;padding:12px;background:rgba(255,255,255,0.03);border-radius:10px}
    .bug-shot{max-width:100%;border-radius:10px;border:1px solid rgba(255,255,255,0.1)}
    .bug-resolution{width:100%;min-height:120px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.12);border-radius:10px;padding:12px;color:inherit;font-size:13px;font-family:inherit;resize:vertical;box-sizing:border-box}
    .bug-resolution:focus{outline:none;border-color:rgba(99,102,241,.6);background:rgba(255,255,255,0.06)}
    .status-buttons{display:flex;gap:8px;flex-wrap:wrap}
    .status-btn{flex:1;min-width:110px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);color:inherit;padding:10px;border-radius:10px;cursor:pointer;font-size:12.5px;font-weight:500;transition:all .15s}
    .status-btn:hover{background:rgba(255,255,255,0.08);border-color:var(--accent)}
    .status-btn.active{background:color-mix(in srgb,var(--accent) 20%,transparent);border-color:var(--accent);color:var(--accent)}
    .bug-actions{display:flex;gap:10px;justify-content:flex-end;border-top:1px solid rgba(255,255,255,0.08);padding-top:14px}
    .btn{padding:9px 18px;border-radius:10px;font-size:13px;font-weight:500;cursor:pointer;border:1px solid transparent;transition:all .15s}
    .btn-primary{background:#6366f1;color:white}
    .btn-primary:hover{background:#7c7ef5}
    .btn-ghost{background:rgba(255,255,255,0.05);border-color:rgba(255,255,255,0.1);color:inherit}
    .btn-ghost:hover{background:rgba(255,255,255,0.1)}
    .empty-state{padding:60px 24px;text-align:center;border-radius:14px}
    .empty-state .ico{font-size:48px;margin-bottom:12px;opacity:.6}
    .empty-state h3{margin:0 0 6px;font-size:16px;font-weight:600}
    .empty-state p{margin:0;opacity:.6;font-size:13px}
    .error-state{padding:40px;text-align:center;border-radius:14px;background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.2)}
  `
  document.head.appendChild(s)
}

function getReporters(reports) {
  const map = new Map()
  reports.forEach(r => {
    if (r.reporter_id) {
      const name = r.reporter_name || r.reporter_email || String(r.reporter_id).slice(0, 8)
      if (!map.has(r.reporter_id)) map.set(r.reporter_id, { id: r.reporter_id, name, count: 0 })
      map.get(r.reporter_id).count++
    }
  })
  return [...map.values()].sort((a, b) => b.count - a.count)
}

export default {
  id: 'bug-reports-triage',
  title: 'Bug-Reports Triage',
  category: 'admin_actions',

  async mount(container) {
    injectStyles()

    container.innerHTML = `
      <div class="panel-shell">
        <div class="panel-head">
          <h2>🐞 Bug-Reports Triage</h2>
          <div class="toolbar">
            <button class="tb-btn" id="tb-refresh">🔄 Aktualisieren</button>
            <button class="tb-btn" id="tb-pdf">📄 PDF</button>
            <button class="tb-btn" id="tb-csv">💾 CSV</button>
          </div>
        </div>
        <div class="panel-body" id="body"></div>
      </div>`

    const body = container.querySelector('#body')

    // Loading skeleton
    if (typeof skeletonLoader === 'function') {
      try { body.innerHTML = skeletonLoader({ rows: 6 }) || '' } catch(e) {}
    }
    if (!body.innerHTML) {
      body.innerHTML = `
        <div class="hero-grid">
          ${[0,1,2,3].map(()=>`<div class="stat-hero" style="opacity:.4"><div class="stat-label">— —</div><div class="stat-value">···</div></div>`).join('')}
        </div>
        <div class="kanban">
          ${[0,1,2].map(()=>`<div class="kanban-col"><div class="kanban-col-head"><div class="kanban-col-title"><span>Lade</span></div></div><div class="kanban-drop"></div></div>`).join('')}
        </div>`
    }

    if (typeof fadeIn === 'function') { try { fadeIn(container) } catch(e) {} }

    const refresh = async () => {
      try {
        state.loading = true
        const reports = await fetchReports()
        state.reports = reports
        render()
      } catch (e) {
        body.innerHTML = `
          <div class="error-state">
            <div style="font-size:38px;margin-bottom:10px">⚠️</div>
            <h3>Fehler beim Laden</h3>
            <p style="opacity:.7;margin:8px 0 16px">${htmlEscape(e.message || String(e))}</p>
            <button class="btn btn-primary" id="err-retry">Erneut versuchen</button>
          </div>`
        body.querySelector('#err-retry')?.addEventListener('click', refresh)
      } finally {
        state.loading = false
      }
    }

    const render = () => {
      const filtered = applyFilters(state.reports, state.filters)
      const stats = buildStats(filtered)
      const reporters = getReporters(state.reports)
      const trend = buildTrendSeries(state.reports)
      const priBreak = buildPriorityBreakdown(state.reports)

      if (!state.reports.length) {
        body.innerHTML = `
          <div class="empty-state glass-card">
            <div class="ico">🎉</div>
            <h3>Keine Bug-Reports</h3>
            <p>Alles ruhig im Frontend. Lehn dich zurück.</p>
          </div>`
        return
      }

      body.innerHTML = `
        ${renderHero(stats)}
        <div class="charts-row">
          <div class="chart-card glass-card">
            <h4>Bug-Reports — letzte 14 Tage</h4>
            <div id="chart-trend" style="height:200px"></div>
          </div>
          <div class="chart-card glass-card">
            <h4>Offen nach Priorität</h4>
            <div id="chart-pri" style="height:200px"></div>
          </div>
        </div>
        ${renderFilters(reporters)}
        <div class="kanban">
          ${STATUS_COLS.map(c => columnHtml(c, filtered)).join('')}
        </div>`

      // Animate hero counts
      body.querySelectorAll('.stat-value[data-count]').forEach(el => {
        const target = +el.dataset.count
        if (typeof countUp === 'function') { try { countUp(el, target); return } catch(e) {} }
        el.textContent = fmtNumber ? fmtNumber(target) : target
      })

      // Charts
      try {
        const tEl = body.querySelector('#chart-trend')
        if (tEl && typeof makeAreaChart === 'function') {
          makeAreaChart(tEl, {
            labels: trend.map(d => d.label),
            data: trend.map(d => d.count),
            series: [{ name: 'Bugs', data: trend.map(d => d.count) }],
            color: '#6366f1'
          })
        }
      } catch (e) {}
      try {
        const pEl = body.querySelector('#chart-pri')
        if (pEl && typeof makeDonutChart === 'function') {
          makeDonutChart(pEl, {
            labels: priBreak.map(p => p.label),
            data: priBreak.map(p => p.value),
            series: priBreak.map(p => p.value),
            colors: priBreak.map(p => p.color)
          })
        }
      } catch (e) {}

      body.querySelectorAll('.pill').forEach(p => {
        p.addEventListener('click', () => {
          state.filters[p.dataset.group] = p.dataset.value
          render()
        })
      })

      wireDragDrop(body, refresh)
    }

    container.querySelector('#tb-refresh').addEventListener('click', refresh)
    container.querySelector('#tb-pdf').addEventListener('click', () => {
      try { exportPanelAsPdf({ title: 'Bug-Reports Triage', element: container, filename: 'bug-reports-triage.pdf' }) }
      catch (e) { toast('PDF-Export fehlgeschlagen', 'error') }
    })
    container.querySelector('#tb-csv').addEventListener('click', () => {
      try {
        const rows = state.reports.map(r => ({
          id: r.id,
          title: r.title || '',
          status: r.status,
          priority: r.priority,
          reporter: r.reporter_name || r.reporter_email || '',
          created_at: r.created_at,
          resolved_at: r.resolved_at || '',
          resolution: r.resolution || '',
          app_version: r.app_version || ''
        }))
        exportCsv(rows, 'bug-reports.csv')
        toast(`${rows.length} Reports exportiert`, 'success')
      } catch (e) { toast('CSV-Export fehlgeschlagen', 'error') }
    })

    await refresh()
  }
}
