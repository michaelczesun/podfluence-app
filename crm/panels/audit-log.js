import { sb } from '/lib/supabase.js?v=20260608i'
import { toast, fmtNumber, fmtRelativeTime, fmtDateTime, htmlEscape, iconHtml, debounce } from '/lib/ui.js?v=20260608i'
import { exportCsv } from '/lib/export.js?v=20260608i'
import { fadeIn, skeletonLoader } from '/lib/animations.js?v=20260608i'

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

const state = { rows: [], total: 0, page: 1, q: '', loading: false }

async function fetchAudit() {
  const { data, error } = await sb.rpc('admin_audit_recent', { p_limit: PAGE_SIZE, p_offset: (state.page - 1) * PAGE_SIZE })
  if (error) throw error
  return data || []
}

function renderRows(rows) {
  if (!rows.length) {
    return `<div class="audit-empty">
      <div style="font-size:36px;opacity:0.4">📜</div>
      <div style="font-weight:600;margin-top:8px">Noch keine Admin-Aktionen geloggt</div>
      <div style="font-size:13px;color:var(--text-muted);margin-top:4px">Sobald du einen User verifizierst, bannst oder Premium vergibst, taucht's hier auf.</div>
    </div>`
  }
  const filtered = state.q
    ? rows.filter(r => (r.admin_username || '').toLowerCase().includes(state.q) ||
                       (r.admin_full_name || '').toLowerCase().includes(state.q) ||
                       (r.action || '').toLowerCase().includes(state.q) ||
                       (r.target_id || '').toLowerCase().includes(state.q))
    : rows
  if (!filtered.length) return `<div class="audit-empty">Keine Treffer für "${htmlEscape(state.q)}"</div>`

  return filtered.map(r => {
    const m = metaFor(r.action)
    const adminName = r.admin_full_name || ('@' + (r.admin_username || '?'))
    const metaStr = r.meta && Object.keys(r.meta).length
      ? Object.entries(r.meta).map(([k, v]) => `<code>${htmlEscape(k)}=${htmlEscape(typeof v === 'object' ? JSON.stringify(v) : String(v))}</code>`).join(' ')
      : ''
    return `<div class="audit-row">
      <div class="audit-icon" style="background:${m.color}22;color:${m.color}">${m.icon}</div>
      <div class="audit-body">
        <div class="audit-head">
          <strong>${htmlEscape(adminName)}</strong>
          <span class="audit-action">${htmlEscape(m.label)}</span>
          ${r.target_type ? `<span class="audit-target">${htmlEscape(r.target_type)}: <code>${htmlEscape((r.target_id || '').slice(0, 8))}</code></span>` : ''}
        </div>
        ${metaStr ? `<div class="audit-meta">${metaStr}</div>` : ''}
      </div>
      <div class="audit-time" title="${htmlEscape(fmtDateTime(r.created_at))}">${htmlEscape(fmtRelativeTime(r.created_at))}</div>
    </div>`
  }).join('')
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
    .audit-list { display:flex; flex-direction:column; gap:8px; }
    .audit-row { display:flex; gap:14px; align-items:center; padding:14px 16px; border-radius:14px;
      background:linear-gradient(140deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01));
      border:1px solid rgba(255,255,255,0.06); }
    .audit-icon { width:40px; height:40px; border-radius:12px; display:flex; align-items:center; justify-content:center; font-size:20px; flex-shrink:0; }
    .audit-body { flex:1; min-width:0; }
    .audit-head { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
    .audit-action { color:var(--text-muted,#9ca3af); font-size:13px; }
    .audit-target { color:var(--text-muted,#9ca3af); font-size:12px; font-family:monospace; }
    .audit-target code { background:rgba(255,255,255,0.06); padding:1px 5px; border-radius:4px; font-size:11px; }
    .audit-meta { margin-top:4px; display:flex; gap:6px; flex-wrap:wrap; }
    .audit-meta code { font-size:11px; background:rgba(124,92,255,0.12); color:#A78BFA; padding:2px 6px; border-radius:5px; font-family:monospace; }
    .audit-time { font-size:12px; color:var(--text-muted,#9ca3af); white-space:nowrap; flex-shrink:0; }
    .audit-empty { text-align:center; padding:60px 20px; color:var(--text-muted,#9ca3af); background:rgba(255,255,255,0.02); border-radius:18px; border:1px dashed rgba(255,255,255,0.08); }
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
            <input id="audit-q" placeholder="Suche User / Aktion / ID" />
            <button id="audit-refresh">${iconHtml('refresh')} Aktualisieren</button>
            <button id="audit-csv">${iconHtml('download')} CSV</button>
          </div>
        </div>
        <div class="audit-list" id="audit-list">${skeletonLoader ? skeletonLoader({ count: 8, height: '68px' }) : 'Lädt …'}</div>
      </div>`
      try { fadeIn(container) } catch (_) {}

      const listEl = container.querySelector('#audit-list')
      const qEl = container.querySelector('#audit-q')

      const load = async () => {
        state.loading = true
        try {
          state.rows = await fetchAudit()
          listEl.innerHTML = renderRows(state.rows)
        } catch (e) {
          listEl.innerHTML = `<div class="audit-empty"><strong>Fehler:</strong> ${htmlEscape(e.message || String(e))}</div>`
        } finally { state.loading = false }
      }

      const debouncedFilter = debounce(() => {
        state.q = (qEl.value || '').toLowerCase()
        listEl.innerHTML = renderRows(state.rows)
      }, 150)

      qEl.addEventListener('input', debouncedFilter)
      container.querySelector('#audit-refresh').addEventListener('click', load)
      container.querySelector('#audit-csv').addEventListener('click', () => {
        try {
          const rows = state.rows.map(r => ({
            time: r.created_at, admin: r.admin_username || r.admin_id, action: r.action,
            target_type: r.target_type || '', target_id: r.target_id || '',
            meta: JSON.stringify(r.meta || {})
          }))
          exportCsv(rows, ['time','admin','action','target_type','target_id','meta'], `audit-log-${new Date().toISOString().slice(0,10)}.csv`)
        } catch (_) { toast('CSV-Export fehlgeschlagen', 'error') }
      })

      // Realtime: live update bei neuen Audit-Einträgen
      let channel = null
      try {
        channel = sb.channel('admin-audit-live').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'admin_audit_log' }, () => { load() }).subscribe()
      } catch (_) {}

      await load()

      return () => { if (channel) try { sb.removeChannel(channel) } catch (_) {} }
    } catch (e) {
      container.innerHTML = `<div style="padding:40px;text-align:center;color:#ef4444">Audit-Log Panel-Fehler: ${htmlEscape(e.message || String(e))}</div>`
      return () => {}
    }
  }
}
