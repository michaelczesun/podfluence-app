import { sb } from '/lib/supabase.js?v=20260608i'
import { toast, modal, htmlEscape, iconHtml, debounce, fmtDateTime } from '/lib/ui.js?v=20260608i'
import { exportCsv } from '/lib/export.js?v=20260608i'
import { fadeIn, skeletonLoader } from '/lib/animations.js?v=20260608i'

const REFRESH_MS = 60000

const STATUSES = [
  { key: 'cold',      label: 'Cold',      color: '#60A5FA', icon: '🧊' },
  { key: 'warm',      label: 'Warm',      color: '#F59E0B', icon: '🔥' },
  { key: 'hot',       label: 'Hot',       color: '#EF4444', icon: '🚀' },
  { key: 'converted', label: 'Converted', color: '#10B981', icon: '✅' },
]

const SOURCES = [
  { key: 'manual',      label: 'Manuell',       color: '#7C5CFF' },
  { key: 'referral',    label: 'Referral',      color: '#22D3EE' },
  { key: 'invite',      label: 'Invite',        color: '#A78BFA' },
  { key: 'website',     label: 'Website',       color: '#60A5FA' },
  { key: 'social',      label: 'Social',        color: '#F472B6' },
  { key: 'event',       label: 'Event',         color: '#FBBF24' },
  { key: 'other',       label: 'Sonstiges',     color: '#9CA3AF' },
]

const state = {
  rows: [],
  loading: false,
  filterAssignee: '',
  filterSource: '',
  search: '',
  assignees: [],
}

function sourceMeta(s) { return SOURCES.find(x => x.key === s) || { key: s || 'other', label: s || 'Sonstiges', color: '#9CA3AF' } }
function statusMeta(s) { return STATUSES.find(x => x.key === s) || STATUSES[0] }

function initial(name, email) {
  const src = (name || email || '?').trim()
  return src.charAt(0).toUpperCase()
}

function daysUntil(iso) {
  if (!iso) return null
  const ms = new Date(iso).getTime() - Date.now()
  return Math.round(ms / 86400000)
}

function timerHtml(lead) {
  const d = daysUntil(lead.next_action_at)
  if (d === null) return `<span class="lead-timer lead-timer-none">Kein Follow-Up</span>`
  if (d < 0) return `<span class="lead-timer lead-timer-overdue">⚠︎ ${Math.abs(d)}d überfällig</span>`
  if (d === 0) return `<span class="lead-timer lead-timer-today">Heute fällig</span>`
  if (d <= 2) return `<span class="lead-timer lead-timer-soon">In ${d}d</span>`
  return `<span class="lead-timer lead-timer-future">In ${d}d</span>`
}

async function fetchLeads() {
  const { data, error } = await sb.rpc('admin_leads_list', {
    p_assigned_to: state.filterAssignee || null,
    p_source:      state.filterSource   || null,
  })
  if (error) throw error
  return data || []
}

function applySearch(rows) {
  const q = (state.search || '').toLowerCase().trim()
  if (!q) return rows
  return rows.filter(r =>
    (r.name  || '').toLowerCase().includes(q) ||
    (r.email || '').toLowerCase().includes(q) ||
    (r.source|| '').toLowerCase().includes(q)
  )
}

function renderCard(lead) {
  const src = sourceMeta(lead.source)
  const init = initial(lead.name, lead.email)
  const avatar = lead.avatar_url
    ? `<img src="${htmlEscape(lead.avatar_url)}" alt="" class="lead-avatar-img"/>`
    : `<div class="lead-avatar-fallback">${htmlEscape(init)}</div>`
  return `<div class="lead-card" draggable="true" data-lead-id="${htmlEscape(lead.id)}" data-status="${htmlEscape(lead.status)}">
    <div class="lead-card-top">
      <div class="lead-avatar">${avatar}</div>
      <div class="lead-card-id">
        <div class="lead-name">${htmlEscape(lead.name || '— ohne Name —')}</div>
        <div class="lead-email">${htmlEscape(lead.email || '')}</div>
      </div>
    </div>
    <div class="lead-card-mid">
      <span class="source-badge" style="--src:${src.color}">${htmlEscape(src.label)}</span>
      ${timerHtml(lead)}
    </div>
    ${lead.note ? `<div class="lead-note">${htmlEscape(lead.note).slice(0,140)}</div>` : ''}
  </div>`
}

function renderColumn(status, rows) {
  const m = statusMeta(status)
  const filtered = rows.filter(r => r.status === status)
  return `<div class="lead-col" data-status="${m.key}" style="--col:${m.color}">
    <div class="lead-col-head">
      <div class="lead-col-title">
        <span class="lead-col-dot"></span>
        <span>${m.icon} ${m.label}</span>
      </div>
      <span class="lead-col-count">${filtered.length}</span>
    </div>
    <div class="lead-col-body" data-drop-status="${m.key}">
      ${filtered.length
        ? filtered.map(renderCard).join('')
        : `<div class="lead-col-empty">Hier hin ziehen</div>`}
    </div>
  </div>`
}

function renderBoard(container) {
  const rows = applySearch(state.rows)
  const board = container.querySelector('#lead-board')
  if (!board) return
  board.innerHTML = STATUSES.map(s => renderColumn(s.key, rows)).join('')
  wireDnD(board, container)
}

function wireDnD(board, container) {
  let draggedId = null
  let originStatus = null

  board.querySelectorAll('.lead-card').forEach(card => {
    card.addEventListener('dragstart', (e) => {
      draggedId = card.dataset.leadId
      originStatus = card.dataset.status
      card.classList.add('is-dragging')
      try { e.dataTransfer.setData('text/plain', draggedId); e.dataTransfer.effectAllowed = 'move' } catch(_) {}
    })
    card.addEventListener('dragend', () => {
      card.classList.remove('is-dragging')
      board.querySelectorAll('.lead-col-body.is-over').forEach(b => b.classList.remove('is-over'))
    })
  })

  board.querySelectorAll('.lead-col-body').forEach(body => {
    body.addEventListener('dragover', (e) => { e.preventDefault(); body.classList.add('is-over'); try { e.dataTransfer.dropEffect='move' } catch(_) {} })
    body.addEventListener('dragleave', () => body.classList.remove('is-over'))
    body.addEventListener('drop', async (e) => {
      e.preventDefault()
      body.classList.remove('is-over')
      const newStatus = body.dataset.dropStatus
      if (!draggedId || !newStatus || newStatus === originStatus) return
      const lead = state.rows.find(r => r.id === draggedId)
      if (!lead) return
      const prev = lead.status
      lead.status = newStatus
      renderBoard(container)
      try {
        const { error } = await sb.rpc('admin_lead_upsert', {
          p_id:     lead.id,
          p_email:  lead.email,
          p_name:   lead.name,
          p_source: lead.source,
          p_status: newStatus,
        })
        if (error) throw error
        toast(`Lead → ${statusMeta(newStatus).label}`, 'success')
      } catch (err) {
        lead.status = prev
        renderBoard(container)
        toast(`Status-Update fehlgeschlagen: ${err.message || err}`, 'error')
      }
    })
  })
}

function openNewLeadModal(container, reload) {
  const sourceOpts = SOURCES.map(s => `<option value="${s.key}">${htmlEscape(s.label)}</option>`).join('')
  const statusOpts = STATUSES.map(s => `<option value="${s.key}">${s.icon} ${htmlEscape(s.label)}</option>`).join('')
  const html = `<div class="lead-form">
    <div class="lead-form-row">
      <label>Email *</label>
      <input id="nl-email" type="email" placeholder="name@domain.de" />
    </div>
    <div class="lead-form-row">
      <label>Name</label>
      <input id="nl-name" type="text" placeholder="Vor- und Nachname" />
    </div>
    <div class="lead-form-row">
      <label>Source</label>
      <select id="nl-source">${sourceOpts}</select>
    </div>
    <div class="lead-form-row">
      <label>Status</label>
      <select id="nl-status">${statusOpts}</select>
    </div>
    <div class="lead-form-row">
      <label>Notiz (optional)</label>
      <textarea id="nl-note" rows="3" placeholder="Kontext, Pitch, nächste Schritte …"></textarea>
    </div>
    <div class="lead-form-actions">
      <button class="btn-secondary" id="nl-cancel">Abbrechen</button>
      <button class="btn-primary" id="nl-save">${iconHtml('check')} Lead anlegen</button>
    </div>
  </div>`

  const m = modal({ title: '➕ Neuer Lead', contentHtml: html, width: 520 })
  const root = (m && m.element) || document
  const get = sel => root.querySelector ? root.querySelector(sel) : document.querySelector(sel)

  const close = () => { try { m && m.close && m.close() } catch(_) {} }
  ;(get('#nl-cancel') || document.querySelector('#nl-cancel'))?.addEventListener('click', close)
  ;(get('#nl-save') || document.querySelector('#nl-save'))?.addEventListener('click', async () => {
    const email  = (get('#nl-email') || document.querySelector('#nl-email')).value.trim()
    const name   = (get('#nl-name')  || document.querySelector('#nl-name')).value.trim()
    const source = (get('#nl-source')|| document.querySelector('#nl-source')).value
    const status = (get('#nl-status')|| document.querySelector('#nl-status')).value
    const note   = (get('#nl-note')  || document.querySelector('#nl-note')).value.trim()
    if (!email || !email.includes('@')) { toast('Gültige Email nötig', 'error'); return }
    try {
      const { error } = await sb.rpc('admin_lead_upsert', {
        p_id: null, p_email: email, p_name: name || null, p_source: source, p_status: status, p_note: note || null,
      })
      if (error) throw error
      toast('Lead angelegt', 'success')
      close()
      reload()
    } catch (e) {
      toast(`Anlegen fehlgeschlagen: ${e.message || e}`, 'error')
    }
  })
}

function toolbarHtml() {
  const sourceOpts = ['<option value="">Alle Quellen</option>']
    .concat(SOURCES.map(s => `<option value="${s.key}">${htmlEscape(s.label)}</option>`)).join('')
  return `<div class="toolbar">
    <span class="live-dot"></span>
    <input id="lead-search" placeholder="Suchen (Name, Email, Source) …" />
    <select id="lead-filter-assignee"><option value="">Alle Owner</option></select>
    <select id="lead-filter-source">${sourceOpts}</select>
    <button id="lead-new" class="btn-primary">${iconHtml('plus')} Neuer Lead</button>
    <button id="lead-refresh">${iconHtml('refresh')} Aktualisieren</button>
    <button id="lead-csv">${iconHtml('download')} CSV</button>
  </div>`
}

function styles() {
  return `<style>
    .lp-shell { padding:20px; display:flex; flex-direction:column; gap:16px; }
    .lp-head { display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; }
    .lp-head h2 { margin:0; font-size:22px; font-weight:700; letter-spacing:-.02em; }
    .lp-head .sub { font-size:13px; color:var(--text-muted,#9ca3af); margin-top:4px; }
    .toolbar { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
    .toolbar input, .toolbar select { padding:8px 12px; border-radius:10px; background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.08); color:inherit; font-size:13px; }
    .toolbar input { width:220px; }
    .toolbar button { padding:8px 14px; border-radius:10px; background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.08); color:inherit; cursor:pointer; font-size:13px; font-weight:500; display:inline-flex; gap:6px; align-items:center; }
    .toolbar button:hover { background:rgba(255,255,255,.08); }
    .toolbar .btn-primary { background:linear-gradient(135deg,#7C5CFF,#22D3EE); border:none; color:#fff; }
    .toolbar .btn-primary:hover { filter:brightness(1.1); }
    .live-dot { width:8px; height:8px; border-radius:50%; background:#10B981; box-shadow:0 0 0 4px rgba(16,185,129,.18); animation:pulseDot 2s infinite; }
    @keyframes pulseDot { 0%,100%{opacity:1} 50%{opacity:.5} }

    .lead-board { display:grid; grid-template-columns:repeat(4, minmax(220px, 1fr)); gap:14px; }
    @media (max-width:1100px){ .lead-board{ grid-template-columns:repeat(2, 1fr); } }
    @media (max-width:640px){  .lead-board{ grid-template-columns:1fr; } }

    .lead-col { background:var(--surface-elev, linear-gradient(140deg, rgba(255,255,255,.04), rgba(255,255,255,.01))); border:1px solid rgba(255,255,255,.06); border-radius:18px; padding:14px; display:flex; flex-direction:column; gap:10px; min-height:300px; position:relative; }
    .lead-col::before { content:''; position:absolute; top:0; left:0; right:0; height:3px; background:var(--col); border-radius:18px 18px 0 0; }
    .lead-col-head { display:flex; justify-content:space-between; align-items:center; padding-top:4px; }
    .lead-col-title { display:flex; gap:8px; align-items:center; font-weight:700; font-size:14px; }
    .lead-col-dot { width:10px; height:10px; border-radius:50%; background:var(--col); box-shadow:0 0 12px var(--col); }
    .lead-col-count { font-size:12px; padding:2px 9px; border-radius:999px; background:rgba(255,255,255,.06); font-weight:600; }
    .lead-col-body { display:flex; flex-direction:column; gap:10px; min-height:200px; border-radius:12px; padding:4px; transition:background .15s; }
    .lead-col-body.is-over { background:rgba(255,255,255,.05); outline:2px dashed var(--col); outline-offset:-4px; }
    .lead-col-empty { text-align:center; padding:30px 10px; color:var(--text-muted,#9ca3af); font-size:12px; border:1px dashed rgba(255,255,255,.08); border-radius:10px; }

    .lead-card { background:var(--surface-elev, linear-gradient(140deg, rgba(255,255,255,.05), rgba(255,255,255,.02))); border:1px solid rgba(255,255,255,.07); border-radius:14px; padding:12px; display:flex; flex-direction:column; gap:8px; cursor:grab; transition:transform .12s, box-shadow .12s; }
    .lead-card:hover { transform:translateY(-2px); box-shadow:0 8px 20px rgba(0,0,0,.3); border-color:rgba(255,255,255,.14); }
    .lead-card.is-dragging { opacity:.4; cursor:grabbing; }
    .lead-card-top { display:flex; gap:10px; align-items:center; }
    .lead-avatar { width:36px; height:36px; border-radius:50%; overflow:hidden; flex-shrink:0; }
    .lead-avatar-img { width:100%; height:100%; object-fit:cover; }
    .lead-avatar-fallback { width:100%; height:100%; display:flex; align-items:center; justify-content:center; background:linear-gradient(135deg,#7C5CFF,#22D3EE); color:#fff; font-weight:700; font-size:15px; }
    .lead-card-id { min-width:0; flex:1; }
    .lead-name { font-weight:600; font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .lead-email { font-size:11px; color:var(--text-muted,#9ca3af); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .lead-card-mid { display:flex; gap:6px; align-items:center; flex-wrap:wrap; }
    .source-badge { padding:2px 8px; border-radius:999px; font-size:10px; font-weight:600; background:color-mix(in srgb, var(--src) 18%, transparent); color:var(--src); border:1px solid color-mix(in srgb, var(--src) 30%, transparent); }
    .lead-timer { font-size:10px; padding:2px 7px; border-radius:999px; font-weight:600; }
    .lead-timer-none     { background:rgba(255,255,255,.06); color:var(--text-muted,#9ca3af); }
    .lead-timer-future   { background:rgba(96,165,250,.15); color:#60A5FA; }
    .lead-timer-soon     { background:rgba(245,158,11,.18); color:#F59E0B; }
    .lead-timer-today    { background:rgba(239,68,68,.18); color:#EF4444; }
    .lead-timer-overdue  { background:rgba(239,68,68,.25); color:#FCA5A5; }
    .lead-note { font-size:11px; color:var(--text-muted,#9ca3af); padding:6px 8px; border-radius:8px; background:rgba(255,255,255,.03); }

    .lead-form { display:flex; flex-direction:column; gap:12px; padding:4px; }
    .lead-form-row { display:flex; flex-direction:column; gap:5px; }
    .lead-form-row label { font-size:12px; color:var(--text-muted,#9ca3af); font-weight:500; }
    .lead-form-row input, .lead-form-row select, .lead-form-row textarea { padding:9px 12px; border-radius:10px; background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.1); color:inherit; font-size:13px; font-family:inherit; resize:vertical; }
    .lead-form-actions { display:flex; gap:8px; justify-content:flex-end; margin-top:8px; }
    .lead-form-actions button { padding:9px 16px; border-radius:10px; cursor:pointer; font-size:13px; font-weight:600; border:1px solid rgba(255,255,255,.08); background:rgba(255,255,255,.04); color:inherit; }
    .lead-form-actions .btn-primary { background:linear-gradient(135deg,#7C5CFF,#22D3EE); border:none; color:#fff; }

    .lp-empty { text-align:center; padding:60px 20px; color:var(--text-muted,#9ca3af); background:rgba(255,255,255,.02); border-radius:18px; border:1px dashed rgba(255,255,255,.08); }
  </style>`
}

export default {
  id: 'leads-pipeline',
  title: 'Lead-Pipeline',
  category: 'admin_actions',

  async mount(container) {
    try {
      container.innerHTML = `${styles()}<div class="lp-shell">
        <div class="lp-head">
          <div>
            <h2>🎯 Lead-Pipeline</h2>
            <div class="sub" id="lp-sub">Lädt …</div>
          </div>
          ${toolbarHtml()}
        </div>
        <div id="lead-board" class="lead-board">
          ${skeletonLoader ? skeletonLoader({ count: 4, height: '280px' }) : 'Lädt …'}
        </div>
      </div>`
      try { fadeIn(container) } catch(_) {}

      const subEl       = container.querySelector('#lp-sub')
      const searchEl    = container.querySelector('#lead-search')
      const assigneeSel = container.querySelector('#lead-filter-assignee')
      const sourceSel   = container.querySelector('#lead-filter-source')

      const load = async () => {
        state.loading = true
        try {
          state.rows = await fetchLeads()
          // Owner-Dropdown füllen (Distinct assignee names aus rows)
          const owners = {}
          for (const r of state.rows) {
            if (r.assigned_to && !owners[r.assigned_to]) {
              owners[r.assigned_to] = r.assigned_to_name || r.assigned_to_username || r.assigned_to.slice(0,8)
            }
          }
          const cur = assigneeSel.value
          assigneeSel.innerHTML = '<option value="">Alle Owner</option>' +
            Object.entries(owners).map(([id,name]) => `<option value="${htmlEscape(id)}">${htmlEscape(name)}</option>`).join('')
          assigneeSel.value = cur
          const total = state.rows.length
          const counts = STATUSES.map(s => `${s.icon} ${state.rows.filter(r=>r.status===s.key).length}`).join(' · ')
          subEl.textContent = `${total} Leads · ${counts} · zuletzt ${fmtDateTime(new Date())}`
          renderBoard(container)
        } catch (e) {
          container.querySelector('#lead-board').innerHTML = `<div class="lp-empty"><strong>Fehler:</strong> ${htmlEscape(e.message || String(e))}</div>`
        } finally { state.loading = false }
      }

      const debouncedSearch = debounce(() => {
        state.search = (searchEl.value || '').toLowerCase()
        renderBoard(container)
      }, 150)

      searchEl.addEventListener('input', debouncedSearch)
      assigneeSel.addEventListener('change', () => { state.filterAssignee = assigneeSel.value; load() })
      sourceSel.addEventListener('change',  () => { state.filterSource   = sourceSel.value;   load() })
      container.querySelector('#lead-refresh').addEventListener('click', load)
      container.querySelector('#lead-new').addEventListener('click', () => openNewLeadModal(container, load))
      container.querySelector('#lead-csv').addEventListener('click', () => {
        try {
          const rows = state.rows.map(r => ({
            email: r.email || '', name: r.name || '', source: r.source || '', status: r.status || '',
            assigned_to: r.assigned_to_name || r.assigned_to || '',
            next_action_at: r.next_action_at || '', created_at: r.created_at || '',
          }))
          exportCsv(rows, ['email','name','source','status','assigned_to','next_action_at','created_at'], `leads-${new Date().toISOString().slice(0,10)}.csv`)
        } catch (_) { toast('CSV-Export fehlgeschlagen', 'error') }
      })

      await load()

      const refreshTimer = setInterval(load, REFRESH_MS)
      let rtCh = null
      try {
        rtCh = sb.channel('admin-leads-live')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, () => load())
          .subscribe()
      } catch(_) {}

      return () => {
        clearInterval(refreshTimer)
        if (rtCh) { try { sb.removeChannel(rtCh) } catch(_) {} }
      }
    } catch (e) {
      container.innerHTML = `<div style="padding:40px;text-align:center;color:#ef4444">Lead-Pipeline Panel-Fehler: ${htmlEscape(e.message || String(e))}</div>`
      return () => {}
    }
  }
}
