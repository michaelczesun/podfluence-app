import { sb } from '/lib/supabase.js?v=20260608l'
import { toast, fmtNumber, fmtRelativeTime, fmtDateTime, htmlEscape, iconHtml, debounce } from '/lib/ui.js?v=20260608l'
import { exportCsv } from '/lib/export.js?v=20260608l'
import { fadeIn, skeletonLoader } from '/lib/animations.js?v=20260608l'
import { emptyState } from '/crm/lib/empty.js?v=20260608l'

const PAGE_SIZE = 100

const ACTION_META = {
  set_flag:         { icon: '🚩', label: 'Flag gesetzt',   color: '#7C5CFF' },
  ban_user:         { icon: '🚫', label: 'User gebannt',   color: '#EF4444' },
  unban_user:       { icon: '✅', label: 'Ban aufgehoben', color: '#10B981' },
  impersonate_view: { icon: '👁',  label: 'Impersonation',  color: '#F59E0B' },
  set_premium:      { icon: '⭐', label: 'Premium',         color: '#22D3EE' },
  bulk_verify:      { icon: '✔︎', label: 'Bulk-Verify',     color: '#10B981' },
  set_bug_status:   { icon: '🐛', label: 'Bug-Status',      color: '#7C5CFF' },
}
function metaFor(action) { return ACTION_META[action] || { icon: '•', label: action, color: '#999' } }

const SYSTEM_UUID = '00000000-0000-0000-0000-000000000000'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function renderTargetId(tid) {
  if (!tid) return ''
  const s = String(tid)
  if (s === SYSTEM_UUID || s.startsWith('00000000-')) {
    return `<span class="audit-system-pill" title="System / automatisch">🤖 System</span>`
  }
  if (UUID_RE.test(s)) {
    return `<code title="${htmlEscape(s)}">${htmlEscape(s.slice(0, 8))}•</code>`
  }
  return `<code title="${htmlEscape(s)}">${htmlEscape(s.slice(0, 8))}</code>`
}

const state = {
  rows: [],
  total: 0,
  page: 1,
  loading: false,
  // filters
  q: '',
  action: '',
  targetType: '',
  dateRange: 'all', // 'today' | '7d' | '30d' | 'custom' | 'all'
  customFrom: '',
  customTo: '',
}

async function fetchAudit() {
  const { data, error } = await sb.rpc('admin_audit_recent', { p_limit: PAGE_SIZE, p_offset: (state.page - 1) * PAGE_SIZE })
  if (error) throw error
  return data || []
}

function dateRangeBounds() {
  const now = new Date()
  if (state.dateRange === 'today') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    return { from: start, to: null }
  }
  if (state.dateRange === '7d') {
    const d = new Date(now); d.setDate(d.getDate() - 7); return { from: d, to: null }
  }
  if (state.dateRange === '30d') {
    const d = new Date(now); d.setDate(d.getDate() - 30); return { from: d, to: null }
  }
  if (state.dateRange === 'custom') {
    return {
      from: state.customFrom ? new Date(state.customFrom) : null,
      to:   state.customTo   ? new Date(state.customTo + 'T23:59:59') : null,
    }
  }
  return { from: null, to: null }
}

function applyFilters(rows) {
  const { from, to } = dateRangeBounds()
  return rows.filter(r => {
    if (state.action && r.action !== state.action) return false
    if (state.targetType && (r.target_type || '') !== state.targetType) return false
    if (from || to) {
      const t = r.created_at ? new Date(r.created_at) : null
      if (!t) return false
      if (from && t < from) return false
      if (to && t > to) return false
    }
    if (state.q) {
      const q = state.q
      const hay = [r.admin_username, r.admin_full_name, r.admin_id].map(x => (x || '').toLowerCase()).join(' ')
      if (!hay.includes(q)) return false
    }
    return true
  })
}

function renderRows(rows) {
  if (!rows.length) {
    return emptyState({
      icon: '🔇',
      title: 'Noch keine Admin-Aktionen heute',
      message: "Sobald du einen User verifizierst, bannst oder Premium vergibst, taucht's hier auf."
    })
  }
  const filtered = applyFilters(rows)
  if (!filtered.length) return `<div class="audit-empty">Keine Treffer für aktive Filter</div>`

  return filtered.map(r => {
    const m = metaFor(r.action)
    const adminName = r.admin_full_name || ('@' + (r.admin_username || '?'))
    const metaStr = r.meta && Object.keys(r.meta).length
      ? Object.entries(r.meta).map(([k, v]) => `<code>${htmlEscape(k)}=${htmlEscape(typeof v === 'object' ? JSON.stringify(v) : String(v))}</code>`).join(' ')
      : ''
    const stateIdx = state.rows.indexOf(r)
    return `<div class="audit-row">
      <div class="audit-icon" style="background:${m.color}22;color:${m.color}">${m.icon}</div>
      <div class="audit-body">
        <div class="audit-head">
          <strong>${htmlEscape(adminName)}</strong>
          <span class="audit-action">${htmlEscape(m.label)}</span>
          ${r.target_type ? `<span class="audit-target">${htmlEscape(r.target_type)}: ${renderTargetId(r.target_id)}</span>` : ''}
        </div>
        ${metaStr ? `<div class="audit-meta">${metaStr}</div>` : ''}
      </div>
      <div class="audit-row-right">
        <button class="audit-detail-btn" data-idx="${stateIdx}" title="Details ansehen">Details</button>
        <div class="audit-time" title="${htmlEscape(fmtDateTime(r.created_at))}">${htmlEscape(fmtRelativeTime(r.created_at))}</div>
      </div>
    </div>`
  }).join('')
}

function distinct(rows, key) {
  const set = new Set()
  for (const r of rows) { const v = r[key]; if (v) set.add(v) }
  return [...set].sort()
}

function renderFilterBar(container) {
  const actions = distinct(state.rows, 'action')
  const targetTypes = distinct(state.rows, 'target_type')
  const showCustom = state.dateRange === 'custom'
  container.innerHTML = `
    <select id="audit-f-action" class="audit-f-select">
      <option value="">Alle Aktionen</option>
      ${actions.map(a => `<option value="${htmlEscape(a)}" ${state.action===a?'selected':''}>${htmlEscape((ACTION_META[a]||{}).label || a)}</option>`).join('')}
    </select>
    <input id="audit-f-actor" class="audit-f-input" placeholder="Actor (User/Name)" value="${htmlEscape(state.q)}" />
    <select id="audit-f-range" class="audit-f-select">
      <option value="all"    ${state.dateRange==='all'?'selected':''}>Gesamter Zeitraum</option>
      <option value="today"  ${state.dateRange==='today'?'selected':''}>Heute</option>
      <option value="7d"     ${state.dateRange==='7d'?'selected':''}>Letzte 7 Tage</option>
      <option value="30d"    ${state.dateRange==='30d'?'selected':''}>Letzte 30 Tage</option>
      <option value="custom" ${state.dateRange==='custom'?'selected':''}>Custom …</option>
    </select>
    <span class="audit-f-custom" style="${showCustom?'':'display:none'}">
      <input type="date" id="audit-f-from" value="${htmlEscape(state.customFrom)}" />
      <span style="opacity:.6">–</span>
      <input type="date" id="audit-f-to" value="${htmlEscape(state.customTo)}" />
    </span>
    <select id="audit-f-target" class="audit-f-select">
      <option value="">Alle Target-Typen</option>
      ${targetTypes.map(t => `<option value="${htmlEscape(t)}" ${state.targetType===t?'selected':''}>${htmlEscape(t)}</option>`).join('')}
    </select>
    <button id="audit-f-reset" class="audit-f-reset" title="Filter zurücksetzen">Reset</button>
  `
}

function openDetailModal(row) {
  if (!row) return
  const meta = row.meta || {}
  let pretty = ''
  try { pretty = JSON.stringify(meta, null, 2) } catch (_) { pretty = String(meta) }
  const adminName = row.admin_full_name || ('@' + (row.admin_username || '?'))
  const m = metaFor(row.action)

  const overlay = document.createElement('div')
  overlay.className = 'audit-modal-overlay'
  overlay.innerHTML = `
    <div class="audit-modal" role="dialog" aria-modal="true">
      <div class="audit-modal-head">
        <div class="audit-modal-title">
          <span class="audit-icon" style="background:${m.color}22;color:${m.color};width:32px;height:32px;font-size:16px;border-radius:10px">${m.icon}</span>
          <div>
            <div style="font-weight:700">${htmlEscape(m.label)}</div>
            <div style="font-size:12px;color:var(--text-muted,#9ca3af)">${htmlEscape(adminName)} · ${htmlEscape(fmtDateTime(row.created_at))}</div>
          </div>
        </div>
        <button class="audit-modal-close" aria-label="Schließen">×</button>
      </div>
      <div class="audit-modal-body">
        <div class="audit-modal-grid">
          <div><span class="audit-modal-label">Action</span><code>${htmlEscape(row.action || '')}</code></div>
          <div><span class="audit-modal-label">Target-Type</span><code>${htmlEscape(row.target_type || '—')}</code></div>
          <div><span class="audit-modal-label">Target-ID</span><code>${htmlEscape(row.target_id || '—')}</code></div>
          <div><span class="audit-modal-label">Admin-ID</span><code>${htmlEscape(row.admin_id || '—')}</code></div>
          <div><span class="audit-modal-label">Zeitpunkt</span><code>${htmlEscape(row.created_at || '—')}</code></div>
        </div>
        <div class="audit-modal-label" style="margin-top:14px">Meta (JSON)</div>
        <pre class="audit-modal-json">${htmlEscape(pretty)}</pre>
      </div>
      <div class="audit-modal-foot">
        <button class="audit-modal-copy">Meta kopieren</button>
        <button class="audit-modal-close-btn">Schließen</button>
      </div>
    </div>
  `
  document.body.appendChild(overlay)

  const close = () => { try { overlay.remove() } catch (_) {} ; document.removeEventListener('keydown', onKey) }
  const onKey = (e) => { if (e.key === 'Escape') close() }
  document.addEventListener('keydown', onKey)
  overlay.addEventListener('click', e => { if (e.target === overlay) close() })
  overlay.querySelector('.audit-modal-close').addEventListener('click', close)
  overlay.querySelector('.audit-modal-close-btn').addEventListener('click', close)
  overlay.querySelector('.audit-modal-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(pretty); toast('Meta in Zwischenablage', 'success') }
    catch (_) { toast('Kopieren fehlgeschlagen', 'error') }
  })
}

function styles() {
  return `<style>
    .audit-shell { padding: 20px; display:flex; flex-direction:column; gap:16px; }
    .audit-head-bar { display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; }
    .audit-head-bar h2 { margin:0; font-size:22px; font-weight:700; letter-spacing:-0.02em; }
    .audit-toolbar { display:flex; gap:8px; }
    .audit-toolbar input { padding:9px 12px; border-radius:10px; border:1px solid rgba(255,255,255,0.1); background:rgba(255,255,255,0.04); color:inherit; font-size:13px; width:240px; }
    .audit-toolbar button { padding:8px 14px; border-radius:10px; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); color:inherit; cursor:pointer; font-size:13px; font-weight:500; display:inline-flex; gap:6px; align-items:center; }
    .audit-toolbar button:hover { background:rgba(255,255,255,0.08); }

    .audit-filter-bar { display:flex; flex-wrap:wrap; gap:8px; align-items:center;
      padding:10px 12px; border-radius:14px;
      background:var(--surface-elev, rgba(255,255,255,0.03));
      border:1px solid var(--border-subtle, rgba(255,255,255,0.06)); }
    .audit-f-select, .audit-f-input, .audit-filter-bar input[type=date] {
      padding:7px 10px; border-radius:8px; border:1px solid rgba(255,255,255,0.08);
      background:rgba(255,255,255,0.04); color:inherit; font-size:12px; }
    .audit-f-input { min-width:180px; }
    .audit-f-custom { display:inline-flex; gap:6px; align-items:center; }
    .audit-f-reset { padding:7px 12px; border-radius:8px; border:1px solid rgba(255,255,255,0.08);
      background:rgba(255,255,255,0.04); color:inherit; font-size:12px; cursor:pointer; }
    .audit-f-reset:hover { background:rgba(255,255,255,0.08); }

    .audit-list { display:flex; flex-direction:column; gap:8px; }
    .audit-row { display:flex; gap:14px; align-items:center; padding:14px 16px; border-radius:14px;
      background:var(--surface-elev, rgba(255,255,255,0.03));
      border:1px solid var(--border-subtle, rgba(255,255,255,0.06)); }
    .audit-icon { width:40px; height:40px; border-radius:12px; display:flex; align-items:center; justify-content:center; font-size:20px; flex-shrink:0; }
    .audit-body { flex:1; min-width:0; }
    .audit-head { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
    .audit-action { color:var(--text-muted,#9ca3af); font-size:13px; }
    .audit-target { color:var(--text-muted,#9ca3af); font-size:12px; font-family:monospace; }
    .audit-target code { background:rgba(255,255,255,0.06); padding:1px 5px; border-radius:4px; font-size:11px; }
    .audit-system-pill { display:inline-flex; align-items:center; gap:4px; background:rgba(124,92,255,0.14); color:#A78BFA; padding:2px 8px; border-radius:999px; font-size:11px; font-weight:600; font-family:inherit; letter-spacing:0.01em; }
    .audit-meta { margin-top:4px; display:flex; gap:6px; flex-wrap:wrap; }
    .audit-meta code { font-size:11px; background:rgba(124,92,255,0.12); color:#A78BFA; padding:2px 6px; border-radius:5px; font-family:monospace; }
    .audit-row-right { display:flex; flex-direction:column; align-items:flex-end; gap:6px; flex-shrink:0; }
    .audit-detail-btn { padding:5px 10px; border-radius:8px; border:1px solid rgba(124,92,255,0.3);
      background:rgba(124,92,255,0.12); color:#A78BFA; font-size:11px; font-weight:600; cursor:pointer; }
    .audit-detail-btn:hover { background:rgba(124,92,255,0.22); }
    .audit-time { font-size:12px; color:var(--text-muted,#9ca3af); white-space:nowrap; }
    .audit-empty { text-align:center; padding:60px 20px; color:var(--text-muted,#9ca3af); background:var(--surface-elev, rgba(255,255,255,0.02)); border-radius:18px; border:1px dashed var(--border-subtle, rgba(255,255,255,0.08)); }

    .audit-modal-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.6); backdrop-filter:blur(4px);
      display:flex; align-items:center; justify-content:center; z-index:9999; padding:20px; }
    .audit-modal { width:min(720px, 100%); max-height:85vh; display:flex; flex-direction:column;
      background:var(--surface-elev, #1a1a1f); border:1px solid rgba(255,255,255,0.08);
      border-radius:18px; box-shadow:0 20px 60px rgba(0,0,0,0.5); overflow:hidden; }
    .audit-modal-head { display:flex; justify-content:space-between; align-items:center; padding:16px 20px;
      border-bottom:1px solid rgba(255,255,255,0.06); }
    .audit-modal-title { display:flex; gap:12px; align-items:center; }
    .audit-modal-close { background:transparent; border:none; color:inherit; font-size:24px; cursor:pointer;
      width:32px; height:32px; border-radius:8px; line-height:1; }
    .audit-modal-close:hover { background:rgba(255,255,255,0.06); }
    .audit-modal-body { padding:18px 20px; overflow:auto; }
    .audit-modal-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px 16px; }
    .audit-modal-grid > div { display:flex; flex-direction:column; gap:4px; min-width:0; }
    .audit-modal-grid code { background:rgba(255,255,255,0.05); padding:4px 8px; border-radius:6px;
      font-size:12px; font-family:monospace; word-break:break-all; }
    .audit-modal-label { font-size:11px; text-transform:uppercase; letter-spacing:0.05em;
      color:var(--text-muted,#9ca3af); font-weight:600; }
    .audit-modal-json { margin:6px 0 0; padding:14px; border-radius:10px;
      background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.06);
      font-family:monospace; font-size:12px; line-height:1.55;
      color:#cdd9e5; white-space:pre-wrap; word-break:break-word; max-height:340px; overflow:auto; }
    .audit-modal-foot { display:flex; justify-content:flex-end; gap:8px; padding:14px 20px;
      border-top:1px solid rgba(255,255,255,0.06); }
    .audit-modal-foot button { padding:8px 14px; border-radius:10px; border:1px solid rgba(255,255,255,0.08);
      background:rgba(255,255,255,0.04); color:inherit; cursor:pointer; font-size:13px; font-weight:500; }
    .audit-modal-foot button:hover { background:rgba(255,255,255,0.08); }
    .audit-modal-copy { border-color:rgba(124,92,255,0.3) !important; background:rgba(124,92,255,0.12) !important; color:#A78BFA !important; }
  </style>`
}

export default {
  id: 'audit-log',
  title: 'Audit-Log',
  category: 'admin_actions',

  async mount(container) {
    try {
      container.innerHTML = `${styles()}<div class="audit-shell">
        <div class="audit-head-bar">
          <div>
            <h2>📜 Audit-Log</h2>
            <div style="font-size:13px;color:var(--text-muted);margin-top:4px">Jede Admin-Aktion mit Zeitstempel + Wer</div>
          </div>
          <div class="audit-toolbar">
            <button id="audit-refresh">${iconHtml('refresh')} Aktualisieren</button>
            <button id="audit-csv">${iconHtml('download')} CSV</button>
          </div>
        </div>
        <div class="audit-filter-bar" id="audit-filter-bar"></div>
        <div class="audit-list" id="audit-list">${skeletonLoader ? skeletonLoader({ count: 8, height: '68px' }) : 'Lädt …'}</div>
      </div>`
      try { fadeIn(container) } catch (_) {}

      const listEl = container.querySelector('#audit-list')
      const filterBarEl = container.querySelector('#audit-filter-bar')

      const renderList = () => { listEl.innerHTML = renderRows(state.rows) }

      const wireFilterBar = () => {
        const actionEl = filterBarEl.querySelector('#audit-f-action')
        const actorEl  = filterBarEl.querySelector('#audit-f-actor')
        const rangeEl  = filterBarEl.querySelector('#audit-f-range')
        const fromEl   = filterBarEl.querySelector('#audit-f-from')
        const toEl     = filterBarEl.querySelector('#audit-f-to')
        const targetEl = filterBarEl.querySelector('#audit-f-target')
        const resetEl  = filterBarEl.querySelector('#audit-f-reset')

        actionEl?.addEventListener('change', () => { state.action = actionEl.value; renderList() })
        targetEl?.addEventListener('change', () => { state.targetType = targetEl.value; renderList() })
        rangeEl?.addEventListener('change', () => {
          state.dateRange = rangeEl.value
          rebuildFilterBar(); renderList()
        })
        fromEl?.addEventListener('change', () => { state.customFrom = fromEl.value; renderList() })
        toEl?.addEventListener('change',   () => { state.customTo   = toEl.value;   renderList() })

        const debouncedActor = debounce(() => {
          state.q = (actorEl.value || '').toLowerCase().trim()
          renderList()
        }, 150)
        actorEl?.addEventListener('input', debouncedActor)

        resetEl?.addEventListener('click', () => {
          state.action = ''; state.targetType = ''; state.q = '';
          state.dateRange = 'all'; state.customFrom = ''; state.customTo = '';
          rebuildFilterBar(); renderList()
        })
      }

      const rebuildFilterBar = () => {
        // Preserve focus on actor input if it's the active element
        const wasActor = filterBarEl.querySelector('#audit-f-actor') === document.activeElement
        const caret = wasActor ? document.activeElement.selectionStart : null
        renderFilterBar(filterBarEl)
        wireFilterBar()
        if (wasActor) {
          const el = filterBarEl.querySelector('#audit-f-actor')
          if (el) { el.focus(); if (caret != null) try { el.setSelectionRange(caret, caret) } catch (_) {} }
        }
      }

      const load = async () => {
        state.loading = true
        try {
          state.rows = await fetchAudit()
          rebuildFilterBar()
          renderList()
        } catch (e) {
          listEl.innerHTML = `<div class="audit-empty"><strong>Fehler:</strong> ${htmlEscape(e.message || String(e))}</div>`
        } finally { state.loading = false }
      }

      // Detail-Modal: event delegation
      listEl.addEventListener('click', (e) => {
        const btn = e.target.closest('.audit-detail-btn')
        if (!btn) return
        const idx = parseInt(btn.getAttribute('data-idx'), 10)
        if (!Number.isFinite(idx)) return
        const row = state.rows[idx]
        if (row) openDetailModal(row)
      })

      container.querySelector('#audit-refresh').addEventListener('click', load)
      container.querySelector('#audit-csv').addEventListener('click', () => {
        try {
          const rows = applyFilters(state.rows).map(r => ({
            time: r.created_at, admin: r.admin_username || r.admin_id, action: r.action,
            target_type: r.target_type || '', target_id: r.target_id || '',
            meta: JSON.stringify(r.meta || {})
          }))
          exportCsv(rows, ['time','admin','action','target_type','target_id','meta'], `audit-log-${new Date().toISOString().slice(0,10)}.csv`)
        } catch (_) { toast('CSV-Export fehlgeschlagen', 'error') }
      })

      // Realtime: live update bei neuen Audit-Einträgen (throttled — verhindert RPC-Sturm bei Bulk-Aktionen)
      let channel = null
      let reloadTimer = null
      const throttledReload = () => {
        if (reloadTimer) return
        reloadTimer = setTimeout(() => { reloadTimer = null; if (!state.loading) load() }, 2000)
      }
      try {
        channel = sb.channel('admin-audit-live').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'admin_audit_log' }, throttledReload).subscribe()
      } catch (_) {}

      await load()

      return () => {
        if (reloadTimer) { clearTimeout(reloadTimer); reloadTimer = null }
        if (channel) try { sb.removeChannel(channel) } catch (_) {}
        document.querySelectorAll('.audit-modal-overlay').forEach(el => { try { el.remove() } catch (_) {} })
      }
    } catch (e) {
      container.innerHTML = `<div style="padding:40px;text-align:center;color:#ef4444">Audit-Log Panel-Fehler: ${htmlEscape(e.message || String(e))}</div>`
      return () => {}
    }
  }
}
