import { sb } from '/lib/supabase.js?v=20260610q'
import { toast, modal, fmtDateTime, htmlEscape } from '/lib/ui.js?v=20260610q'
import { drawer } from '/lib/layout-extras.js?v=20260610q'
import { exportPanelAsPdf, exportCsv } from '/lib/export.js?v=20260610q'
import { skeletonLoader } from '/lib/animations.js?v=20260610q'

// ─── Constants ───────────────────────────────────────────────────────────────

const STATUS_COLS = [
  { key: 'open',        label: 'Offen',       icon: '🐞', accent: '#ef4444' },
  { key: 'in_progress', label: 'In Arbeit',   icon: '🔧', accent: '#f59e0b' },
  { key: 'resolved',    label: 'Erledigt',    icon: '✅', accent: '#10b981' },
  { key: 'wontfix',     label: 'Kein Fix',    icon: '🚫', accent: '#6b7280' },
]

const FETCH_LIMIT = 500

// ─── State ───────────────────────────────────────────────────────────────────

const FILTERS_KEY = 'crm.bug-reports.filters'
const DEFAULT_FILTERS = { platform: 'alle', age: 'alle' }
function readFilters() {
  try {
    const raw = localStorage.getItem(FILTERS_KEY)
    if (!raw) return { ...DEFAULT_FILTERS }
    return { ...DEFAULT_FILTERS, ...(JSON.parse(raw) || {}) }
  } catch (_) { return { ...DEFAULT_FILTERS } }
}
function writeFilters(f) {
  try { localStorage.setItem(FILTERS_KEY, JSON.stringify(f)) } catch (_) {}
}
function clearFiltersLs() {
  try { localStorage.removeItem(FILTERS_KEY) } catch (_) {}
}

const state = {
  reports: [],
  filters: readFilters(),
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function ageLabel(createdAt) {
  const h = (Date.now() - new Date(createdAt).getTime()) / 3_600_000
  return h < 24 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d`
}

function passesFilters(r, f) {
  const platform = (r.admin_note || '').match(/\bplatform:(ios|android|web)\b/i)?.[1]?.toLowerCase()
    || (r.description || '').match(/\bplatform:(ios|android|web)\b/i)?.[1]?.toLowerCase()
    || null
  if (f.platform !== 'alle' && platform !== f.platform) return false

  const h = (Date.now() - new Date(r.created_at).getTime()) / 3_600_000
  if (f.age === 'heute' && h >= 24)    return false
  if (f.age === '7t'   && h >= 24 * 7) return false
  if (f.age === '30t'  && h >= 24 * 30) return false
  return true
}

// ─── DB / RPC ────────────────────────────────────────────────────────────────

async function fetchReports() {
  // Direct query — RLS on bug_reports must allow SELECT for the admin role.
  // If a SECURITY DEFINER RPC admin_bug_reports_list is added later, swap here.
  const { data, error } = await sb
    .from('bug_reports')
    .select('id, user_id, description, status, admin_note, created_at, resolved_at')
    .order('created_at', { ascending: false })
    .limit(FETCH_LIMIT)
  if (error) throw error
  return data || []
}

async function rpcSetStatus(id, status, note) {
  const { error } = await sb.rpc('admin_set_bug_status', {
    id,
    status,
    ...(note !== undefined ? { note } : {}),
  })
  if (error) throw error
}

// ─── Card HTML ───────────────────────────────────────────────────────────────

function cardHtml(r) {
  const snip = (r.description || '').slice(0, 110)
  const more = (r.description || '').length > 110
  const platform = (r.admin_note || r.description || '').match(/\bplatform:(ios|android|web)\b/i)?.[1] || null
  const appVer  = (r.admin_note || r.description || '').match(/\bv?(\d+\.\d+[\.\d]*)\b/)?.[1] || null

  return `
    <article class="bug-card" draggable="true" data-id="${htmlEscape(String(r.id))}">
      <header class="bc-head">
        <span class="bc-age" title="${fmtDateTime(r.created_at)}">${ageLabel(r.created_at)}</span>
        ${platform ? `<span class="bc-plat">${htmlEscape(platform)}</span>` : ''}
        ${appVer   ? `<span class="bc-ver">v${htmlEscape(appVer)}</span>` : ''}
      </header>
      <p class="bc-desc">${htmlEscape(snip)}${more ? '…' : ''}</p>
      <footer class="bc-foot">
        <span class="bc-uid">👤 ${htmlEscape(String(r.user_id || '–').slice(0, 12))}</span>
      </footer>
    </article>`
}

// ─── Column HTML ─────────────────────────────────────────────────────────────

function columnHtml(col, filtered) {
  const cards = filtered.filter(r => r.status === col.key)
  return `
    <section class="k-col" data-status="${col.key}">
      <header class="k-head" style="--accent:${col.accent}">
        <span>${col.icon} ${col.label}</span>
        <span class="k-badge">${cards.length}</span>
      </header>
      <div class="k-drop" data-status="${col.key}">
        ${cards.length
          ? cards.map(cardHtml).join('')
          : `<div class="k-empty">Keine Tickets</div>`}
      </div>
    </section>`
}

// ─── Filter bar ──────────────────────────────────────────────────────────────

function pill(group, val, label, active) {
  return `<button class="pill ${active ? 'pill-on' : ''}" data-g="${group}" data-v="${htmlEscape(String(val))}">${htmlEscape(label)}</button>`
}

function filterBarHtml(truncated) {
  const { platform, age } = state.filters
  return `
    <div class="filter-bar">
      <span class="fl">Plattform</span>
      ${[['alle','Alle'],['ios','iOS'],['android','Android'],['web','Web']].map(([v,l]) => pill('platform', v, l, platform === v)).join('')}
      <span class="fl" style="margin-left:12px">Alter</span>
      ${[['alle','Alle'],['heute','Heute'],['7t','7 Tage'],['30t','30 Tage']].map(([v,l]) => pill('age', v, l, age === v)).join('')}
    </div>
    ${truncated ? `<div class="brt-truncate-warn">⚠️ Es werden nur die ${FETCH_LIMIT} neuesten Reports angezeigt. Ältere Tickets sind nicht sichtbar.</div>` : ''}`
}

// ─── Detail drawer ───────────────────────────────────────────────────────────

function openDetail(r, refresh) {
  const statusOpts = STATUS_COLS.map(c =>
    `<option value="${c.key}" ${r.status === c.key ? 'selected' : ''}>${c.icon} ${c.label}</option>`
  ).join('')

  const html = `
    <div class="bd">
      <div class="bd-meta">
        <div><span>ID</span><strong>${htmlEscape(String(r.id).slice(0, 8))}</strong></div>
        <div><span>Erstellt</span><strong>${fmtDateTime(r.created_at)}</strong></div>
        ${r.resolved_at ? `<div><span>Gelöst</span><strong>${fmtDateTime(r.resolved_at)}</strong></div>` : ''}
        <div><span>User-ID</span><strong>${htmlEscape(String(r.user_id || '–'))}</strong></div>
      </div>
      <section class="bd-sec">
        <h4>Beschreibung</h4>
        <pre class="bd-pre">${htmlEscape(r.description || '— keine —')}</pre>
      </section>
      <section class="bd-sec">
        <h4>Admin-Notiz</h4>
        <textarea id="note-ta" class="bd-ta" rows="4" placeholder="Interne Notiz…">${htmlEscape(r.admin_note || '')}</textarea>
      </section>
      <section class="bd-sec">
        <h4>Status</h4>
        <select id="status-sel" class="bd-sel">${statusOpts}</select>
      </section>
      <footer class="bd-foot">
        <button class="btn btn-p" id="bd-save">💾 Speichern</button>
        <button class="btn btn-resolve" id="bd-resolve">✅ Als Erledigt markieren</button>
      </footer>
    </div>`

  let closeDrawer = () => {}
  if (typeof drawer === 'function') {
    try {
      const ret = drawer({ title: `Bug #${String(r.id).slice(0,8)}`, side: 'right', width: 520, content: html })
      if (typeof ret === 'function') closeDrawer = ret
      else if (ret?.close) closeDrawer = () => ret.close()
    } catch (_) { modal({ title: `Bug #${String(r.id).slice(0,8)}`, content: html }) }
  } else {
    modal({ title: `Bug #${String(r.id).slice(0,8)}`, content: html })
  }

  // Use 150ms to reduce race condition risk when drawer render is slow
  setTimeout(() => {
    const host = document.querySelector('.drawer-content, .drawer, .modal-content, .modal') || document
    const ta   = host.querySelector('#note-ta')
    const sel  = host.querySelector('#status-sel')

    async function save(forceStatus) {
      const newStatus = forceStatus || sel?.value || r.status
      const note = ta?.value ?? undefined
      try {
        await rpcSetStatus(r.id, newStatus, note !== undefined ? note : undefined)
        toast(`Bug #${String(r.id).slice(0,8)} gespeichert`, 'success')
        closeDrawer()
        await refresh()
      } catch (e) { toast('Fehler: ' + e.message, 'error') }
    }

    host.querySelector('#bd-save')?.addEventListener('click', () => save())
    host.querySelector('#bd-resolve')?.addEventListener('click', () => save('resolved'))
  }, 150)
}

// ─── Drag & Drop ─────────────────────────────────────────────────────────────

function wireDnD(container, refresh) {
  let dragId = null

  container.querySelectorAll('.bug-card').forEach(card => {
    card.addEventListener('dragstart', e => {
      dragId = card.dataset.id
      card.classList.add('dragging')
      e.dataTransfer.effectAllowed = 'move'
    })
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging')
      dragId = null
    })
    card.addEventListener('click', () => {
      const r = state.reports.find(x => String(x.id) === String(card.dataset.id))
      if (r) openDetail(r, refresh)
    })
  })

  container.querySelectorAll('.k-drop').forEach(zone => {
    zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('dh') })
    zone.addEventListener('dragleave', ()  => zone.classList.remove('dh'))
    zone.addEventListener('drop', async e => {
      e.preventDefault()
      zone.classList.remove('dh')
      if (!dragId) return
      const newStatus = zone.dataset.status
      const r = state.reports.find(x => String(x.id) === String(dragId))
      if (!r || r.status === newStatus) return
      try {
        await rpcSetStatus(r.id, newStatus)
        toast(`→ ${STATUS_COLS.find(c => c.key === newStatus)?.label}`, 'success')
        await refresh()
      } catch (err) { toast('Fehler: ' + err.message, 'error') }
    })
  })
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function injectStyles() {
  if (document.getElementById('brt-css')) return
  const s = document.createElement('style')
  s.id = 'brt-css'
  s.textContent = `
    .brt-shell{padding:20px;display:flex;flex-direction:column;gap:16px}
    .brt-head{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px}
    .brt-head h2{margin:0;font-size:21px;font-weight:700;letter-spacing:-.02em}
    .brt-toolbar{display:flex;gap:8px;flex-wrap:wrap}
    .tb-btn{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);color:inherit;padding:7px 13px;border-radius:9px;cursor:pointer;font-size:12.5px;font-weight:500;transition:all .15s}
    .tb-btn:hover{background:rgba(255,255,255,.12)}
    .filter-bar{display:flex;align-items:center;flex-wrap:wrap;gap:7px;padding:12px 16px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:12px}
    .fl{font-size:10px;opacity:.5;text-transform:uppercase;letter-spacing:.08em;font-weight:600;margin-right:2px}
    .pill{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:inherit;padding:4px 11px;border-radius:999px;font-size:12px;cursor:pointer;transition:all .15s}
    .pill:hover{background:rgba(255,255,255,.1)}
    .pill-on{background:rgba(99,102,241,.25);border-color:rgba(99,102,241,.6);color:#a5b4fc}
    .brt-truncate-warn{padding:8px 14px;background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.25);border-radius:9px;font-size:12px;color:#fcd34d}
    .k-board{display:grid;grid-template-columns:repeat(4,1fr);gap:13px}
    @media(max-width:1100px){.k-board{grid-template-columns:repeat(2,1fr)}}
    @media(max-width:680px){.k-board{grid-template-columns:1fr}}
    .k-col{background:rgba(255,255,255,.025);border:1px solid rgba(255,255,255,.07);border-radius:13px;display:flex;flex-direction:column;min-height:280px;overflow:hidden}
    .k-head{display:flex;justify-content:space-between;align-items:center;padding:11px 14px;border-bottom:1px solid rgba(255,255,255,.07);font-size:13px;font-weight:600;border-top:3px solid var(--accent)}
    .k-badge{background:rgba(255,255,255,.08);padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700}
    .k-drop{padding:9px;display:flex;flex-direction:column;gap:8px;flex:1;min-height:160px;transition:background .15s}
    .k-drop.dh{background:rgba(99,102,241,.07);outline:2px dashed rgba(99,102,241,.4);outline-offset:-5px}
    .k-empty{text-align:center;padding:24px 8px;font-size:12px;opacity:.35;font-style:italic}
    .bug-card{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.09);border-radius:9px;padding:10px 12px;cursor:grab;display:flex;flex-direction:column;gap:5px;transition:all .15s}
    .bug-card:hover{background:rgba(255,255,255,.08);transform:translateY(-1px);box-shadow:0 4px 14px rgba(0,0,0,.2)}
    .bug-card.dragging{opacity:.35;cursor:grabbing}
    .bc-head{display:flex;align-items:center;gap:6px;font-size:10px}
    .bc-age{opacity:.5}
    .bc-plat{background:rgba(99,102,241,.18);color:#a5b4fc;padding:1px 7px;border-radius:999px;font-weight:600}
    .bc-ver{font-family:ui-monospace,monospace;background:rgba(255,255,255,.06);padding:1px 5px;border-radius:4px;opacity:.7}
    .bc-desc{margin:0;font-size:12px;opacity:.75;line-height:1.45;word-break:break-word}
    .bc-foot{font-size:10.5px;opacity:.5}
    .bd{display:flex;flex-direction:column;gap:15px;padding:4px}
    .bd-meta{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:12px;background:rgba(255,255,255,.03);border-radius:10px}
    .bd-meta>div{display:flex;flex-direction:column;gap:2px}
    .bd-meta span{font-size:10px;opacity:.5;text-transform:uppercase;letter-spacing:.05em}
    .bd-meta strong{font-size:12.5px;font-weight:500}
    .bd-sec h4{margin:0 0 8px;font-size:11px;font-weight:600;opacity:.55;text-transform:uppercase;letter-spacing:.06em}
    .bd-pre{margin:0;font-size:12.5px;line-height:1.5;white-space:pre-wrap;word-break:break-word;background:rgba(255,255,255,.03);padding:11px;border-radius:9px;font-family:inherit}
    .bd-ta{width:100%;min-height:90px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);border-radius:9px;padding:10px;color:inherit;font-size:13px;font-family:inherit;resize:vertical;box-sizing:border-box}
    .bd-ta:focus{outline:none;border-color:rgba(99,102,241,.6)}
    .bd-sel{width:100%;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);border-radius:9px;padding:9px 12px;color:inherit;font-size:13px;cursor:pointer}
    .bd-sel:focus{outline:none;border-color:rgba(99,102,241,.6)}
    .bd-foot{display:flex;gap:9px;justify-content:flex-end;border-top:1px solid rgba(255,255,255,.08);padding-top:13px}
    .btn{padding:8px 17px;border-radius:9px;font-size:13px;font-weight:500;cursor:pointer;border:1px solid transparent;transition:all .15s}
    .btn-p{background:#6366f1;color:#fff}
    .btn-p:hover{background:#7c7ef5}
    .btn-resolve{background:rgba(16,185,129,.15);border-color:rgba(16,185,129,.4);color:#6ee7b7}
    .btn-resolve:hover{background:rgba(16,185,129,.25)}
    .brt-err{padding:36px;text-align:center;background:rgba(239,68,68,.06);border:1px solid rgba(239,68,68,.2);border-radius:13px;margin:12px}
  `
  document.head.appendChild(s)
}

// ─── Mount ────────────────────────────────────────────────────────────────────

export default {
  id: 'bug-reports-triage',
  title: 'Bug-Reports Triage',
  category: 'admin_actions',

  async mount(container) {
    try {
      injectStyles()

      container.innerHTML = `
        <div class="brt-shell">
          <div class="brt-head">
            <h2>🐞 Bug-Reports Triage</h2>
            <div class="brt-toolbar">
              <button class="tb-btn" id="tb-refresh">🔄 Aktualisieren</button>
              <button class="tb-btn" id="tb-reset" title="Filter zurücksetzen">↺ Filter-Reset</button>
              <button class="tb-btn" id="tb-pdf">📄 PDF</button>
              <button class="tb-btn" id="tb-csv">💾 CSV</button>
            </div>
          </div>
          <div id="brt-body"></div>
        </div>`

      const body = container.querySelector('#brt-body')

      const render = () => {
        const filtered = state.reports.filter(r => passesFilters(r, state.filters))
        const truncated = state.reports.length >= FETCH_LIMIT

        body.innerHTML = `
          ${filterBarHtml(truncated)}
          <div class="k-board" style="margin-top:14px">
            ${STATUS_COLS.map(c => columnHtml(c, filtered)).join('')}
          </div>`

        body.querySelectorAll('.pill').forEach(p => {
          p.addEventListener('click', () => {
            state.filters[p.dataset.g] = p.dataset.v
            writeFilters(state.filters)
            render()
          })
        })

        wireDnD(body, refresh)
      }

      const refresh = async () => {
        body.innerHTML = ''
        body.appendChild(skeletonLoader('100%', 280))
        try {
          state.reports = await fetchReports()
          render()
        } catch (e) {
          body.innerHTML = `
            <div class="brt-err">
              <div style="font-size:34px;margin-bottom:8px">⚠️</div>
              <h3 style="margin:0 0 6px">Fehler beim Laden</h3>
              <p style="opacity:.7;margin:8px 0 14px;font-size:13px">${htmlEscape(e.message || String(e))}</p>
              <button class="btn btn-p" id="brt-retry">Erneut versuchen</button>
            </div>`
          body.querySelector('#brt-retry')?.addEventListener('click', refresh)
        }
      }

      container.querySelector('#tb-refresh').addEventListener('click', refresh)

      container.querySelector('#tb-reset').addEventListener('click', () => {
        state.filters = { ...DEFAULT_FILTERS }
        clearFiltersLs()
        render()
      })

      container.querySelector('#tb-pdf').addEventListener('click', () => {
        try { exportPanelAsPdf({ title: 'Bug-Reports Triage', element: container, filename: 'bug-reports-triage.pdf' }) }
        catch (e) { toast('PDF-Export fehlgeschlagen', 'error') }
      })

      container.querySelector('#tb-csv').addEventListener('click', () => {
        try {
          const rows = state.reports.map(r => ({
            id: r.id,
            user_id: r.user_id || '',
            description: (r.description || '').replace(/\n/g, ' '),
            status: r.status,
            admin_note: r.admin_note || '',
            created_at: r.created_at,
            resolved_at: r.resolved_at || '',
          }))
          exportCsv(rows, 'bug-reports.csv')
          toast(`${rows.length} Reports exportiert`, 'success')
        } catch (e) { toast('CSV-Export fehlgeschlagen', 'error') }
      })

      await refresh()

    } catch (err) {
      try {
        container.innerHTML = `
          <div class="brt-err" style="margin:20px">
            <div style="font-size:34px;margin-bottom:8px">⚠️</div>
            <h3 style="margin:0 0 6px">Panel konnte nicht geladen werden</h3>
            <p style="opacity:.7;font-size:12px;font-family:ui-monospace,monospace">${htmlEscape((err?.message || String(err)))}</p>
          </div>`
      } catch (_) {}
    }
  },
}
