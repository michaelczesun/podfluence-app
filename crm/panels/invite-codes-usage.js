import { sb } from '/lib/supabase.js?v=20260608g'
import { toast, modal, confirmDialog, fmtNumber, fmtDateTime, fmtRelativeTime, htmlEscape, iconHtml, debounce } from '/lib/ui.js?v=20260608g'
import { makeAreaChart, makeBarChart, makeDonutChart } from '/lib/charts.js?v=20260608g'
import { exportPanelAsPdf, exportCsv } from '/lib/export.js?v=20260608g'
import { countUp, fadeIn } from '/lib/animations.js?v=20260608g'
import { drawer, segmentedControl } from '/lib/layout-extras.js?v=20260608g'
import { showUserDetailModal } from '/lib/panel-actions.js?v=20260608g'

const PAGE_SIZE = 50

const state = {
  rows: [],
  filter: 'all',
  search: '',
  page: 1,
  sortKey: 'created_at',
  sortDir: 'desc',
}

// Data model: this DB has no `invites`/`invite_codes` tables. The closest concept
// is the `referrals` table (inviter_id, invitee_id, created_at). Each row is a
// successfully *used* invitation. We treat each referral row as a record and
// surface owner/invitee user joins so the panel still makes sense.
async function fetchReferrals() {
  const { data, error } = await sb
    .from('referrals')
    .select('id, inviter_id, invitee_id, created_at, owner:users!inviter_id(id,username,avatar_url), invitee:users!invitee_id(id,username,avatar_url)')
    .order('created_at', { ascending: false })
    .limit(2000)
  if (error) throw error
  return data || []
}

function userCell(u, fallbackId) {
  if (!u && !fallbackId) return `<span style="opacity:.4">—</span>`
  if (!u) return `<span style="font-family:monospace;opacity:.6;font-size:11px">${htmlEscape(String(fallbackId).slice(0,8))}</span>`
  const av = u.avatar_url
    ? `<img src="${htmlEscape(u.avatar_url)}" style="width:24px;height:24px;border-radius:50%;object-fit:cover">`
    : `<div style="width:24px;height:24px;border-radius:50%;background:linear-gradient(135deg,#0a84ff,#5e5ce6);display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:600">${htmlEscape((u.username||'?')[0].toUpperCase())}</div>`
  return `<button class="link-user" data-user="${htmlEscape(u.id)}" style="background:none;border:none;padding:0;cursor:pointer;display:inline-flex;align-items:center;gap:8px;color:var(--text,inherit)"><span>${av}</span><span style="font-weight:500">${htmlEscape(u.username||'unbekannt')}</span></button>`
}

function applyFilters(rows) {
  let out = rows.slice()
  if (state.filter !== 'all') {
    const since = new Date()
    if (state.filter === '7d') since.setDate(since.getDate()-7)
    else if (state.filter === '30d') since.setDate(since.getDate()-30)
    else if (state.filter === '90d') since.setDate(since.getDate()-90)
    const iso = since.toISOString()
    out = out.filter(r => (r.created_at || '') >= iso)
  }
  if (state.search) {
    const q = state.search.toLowerCase()
    out = out.filter(r =>
      (r.owner?.username||'').toLowerCase().includes(q) ||
      (r.invitee?.username||'').toLowerCase().includes(q) ||
      (r.inviter_id||'').toLowerCase().includes(q) ||
      (r.invitee_id||'').toLowerCase().includes(q)
    )
  }
  out.sort((a,b) => {
    const k = state.sortKey
    const av = a[k] || ''
    const bv = b[k] || ''
    if (av < bv) return state.sortDir === 'asc' ? -1 : 1
    if (av > bv) return state.sortDir === 'asc' ? 1 : -1
    return 0
  })
  return out
}

function buildTimeSeries(rows) {
  const days = 30
  const now = new Date()
  const buckets = []
  for (let i = days-1; i >= 0; i--) {
    const d = new Date(now); d.setHours(0,0,0,0); d.setDate(d.getDate()-i)
    buckets.push({ date: d, key: d.toISOString().slice(0,10), used: 0 })
  }
  const idx = Object.fromEntries(buckets.map((b,i)=>[b.key,i]))
  for (const r of rows) {
    if (!r.created_at) continue
    const k = r.created_at.slice(0,10)
    if (k in idx) buckets[idx[k]].used++
  }
  return buckets
}

function topOwners(rows) {
  const m = new Map()
  for (const r of rows) {
    if (!r.inviter_id) continue
    const k = r.inviter_id
    if (!m.has(k)) m.set(k, { id: k, name: r.owner?.username || k.slice(0,8), avatar: r.owner?.avatar_url, used: 0 })
    m.get(k).used++
  }
  return Array.from(m.values()).sort((a,b)=>b.used-a.used).slice(0,8)
}

function renderError(body, e, retry) {
  body.innerHTML = `
    <div class="glass-card" style="padding:40px;text-align:center;border-radius:18px;background:var(--bg-glass,rgba(255,255,255,.03));border:1px solid var(--border,rgba(255,255,255,.06));color:var(--text,inherit)">
      <div style="font-size:40px;margin-bottom:10px">${iconHtml('alert-triangle')}</div>
      <div style="font-weight:600;margin-bottom:6px">Fehler beim Laden</div>
      <div style="opacity:.6;font-size:13px;margin-bottom:18px">${htmlEscape(e.message||String(e))}</div>
      <button class="tb-btn" id="retry" style="padding:10px 18px;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:var(--text,inherit);cursor:pointer">Erneut versuchen</button>
    </div>
  `
  body.querySelector('#retry').addEventListener('click', retry)
}

function renderMountError(container, err, retryFn) {
  container.innerHTML = `
    <div style="padding:40px;text-align:center;color:var(--text,inherit)">
      <div style="font-size:40px;margin-bottom:10px">${iconHtml('alert-triangle')}</div>
      <div style="font-weight:600;margin-bottom:6px">Panel konnte nicht geladen werden</div>
      <div style="opacity:.6;font-size:13px;margin-bottom:18px">${htmlEscape(err?.message || String(err))}</div>
      <button id="mount-retry" style="padding:10px 18px;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:var(--text,inherit);cursor:pointer">Erneut versuchen</button>
    </div>
  `
  container.querySelector('#mount-retry')?.addEventListener('click', retryFn)
}

const panel = {
  id: 'invite-codes-usage',
  title: 'Invite-Codes Nutzung',
  category: 'growth',

  async mount(container) {
    try {
      container.innerHTML = `
        <div class="panel-shell">
          <div class="panel-head" style="display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px 22px;border-bottom:1px solid var(--border,rgba(255,255,255,.06));color:var(--text,inherit)">
            <div>
              <h2 style="margin:0;font-size:20px;font-weight:600;letter-spacing:-.3px">Invite-Codes Nutzung</h2>
              <div style="margin-top:4px;font-size:12px;opacity:.55">Eingelöste Einladungen (Referral-Tracking) — Owner, Invitee, Zeitverlauf</div>
            </div>
            <div class="toolbar" id="toolbar" style="display:flex;gap:8px;align-items:center"></div>
          </div>
          <div class="panel-body" id="body" style="padding:18px 22px;color:var(--text,inherit)"></div>
        </div>
      `

      const body = container.querySelector('#body')
      const toolbar = container.querySelector('#toolbar')

      const tbBtn = (icon, label, cls = '') => `<button class="tb-btn ${cls}" data-act="${label}" style="display:inline-flex;align-items:center;gap:6px;padding:8px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.04);color:var(--text,inherit);font-size:12px;font-weight:500;cursor:pointer;transition:all .15s">${iconHtml(icon)}<span>${label}</span></button>`

      toolbar.innerHTML = [
        tbBtn('refresh', 'Aktualisieren'),
        tbBtn('file-text', 'PDF'),
        tbBtn('download', 'CSV'),
      ].join('')

      body.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:18px">
          ${[1,2,3,4].map(()=>`<div class="pf-skeleton" style="height:108px;border-radius:16px;background:linear-gradient(90deg,rgba(255,255,255,.03),rgba(255,255,255,.08),rgba(255,255,255,.03));background-size:200% 100%;animation:pf-sk 1.4s ease-in-out infinite"></div>`).join('')}
        </div>
        <div class="pf-skeleton" style="height:240px;border-radius:16px;margin-bottom:18px;background:linear-gradient(90deg,rgba(255,255,255,.03),rgba(255,255,255,.08),rgba(255,255,255,.03));background-size:200% 100%;animation:pf-sk 1.4s ease-in-out infinite"></div>
        <div class="pf-skeleton" style="height:380px;border-radius:16px;background:linear-gradient(90deg,rgba(255,255,255,.03),rgba(255,255,255,.08),rgba(255,255,255,.03));background-size:200% 100%;animation:pf-sk 1.4s ease-in-out infinite"></div>
        <style>@keyframes pf-sk { 0%{background-position:200% 0} 100%{background-position:-200% 0} }</style>
      `

      let rows = []
      try {
        rows = await fetchReferrals()
      } catch (e) {
        renderError(body, e, () => panel.mount(container))
        return
      }

      state.rows = rows
      render(body, container)
      try { fadeIn(container) } catch(_) {}

      toolbar.addEventListener('click', async (e) => {
        const btn = e.target.closest('.tb-btn')
        if (!btn) return
        const act = btn.dataset.act
        if (act === 'Aktualisieren') {
          btn.classList.add('loading')
          try { state.rows = await fetchReferrals(); render(body, container) }
          catch (err) { toast('Fehler beim Laden: '+(err.message||err), 'error') }
          finally { btn.classList.remove('loading') }
        } else if (act === 'PDF') {
          try { exportPanelAsPdf(container, 'invite-codes.pdf', { title: 'Invite-Codes Nutzung' }) }
          catch (err) { toast('PDF-Export fehlgeschlagen', 'error') }
        } else if (act === 'CSV') {
          try {
            exportCsv(state.rows.map(r => ({
              id: r.id,
              owner: r.owner?.username || r.inviter_id || '',
              invitee: r.invitee?.username || r.invitee_id || '',
              inviter_id: r.inviter_id || '',
              invitee_id: r.invitee_id || '',
              created_at: r.created_at || '',
            })), null, 'invite-codes.csv')
          } catch (err) { toast('CSV-Export fehlgeschlagen', 'error') }
        }
      })
    } catch (err) {
      renderMountError(container, err, () => panel.mount(container))
    }
  },
}

export default panel

function render(body, rootContainer) {
  const rows = state.rows
  const total = rows.length
  const uniqueOwners = new Set(rows.map(r => r.inviter_id).filter(Boolean)).size
  const uniqueInvitees = new Set(rows.map(r => r.invitee_id).filter(Boolean)).size

  // Last 30 days
  const since30 = new Date(); since30.setDate(since30.getDate()-30)
  const last30 = rows.filter(r => r.created_at && new Date(r.created_at) >= since30).length

  const series = buildTimeSeries(rows)
  const owners = topOwners(rows)

  body.innerHTML = `
    <div id="heros" style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:18px"></div>

    <div style="display:grid;grid-template-columns:2fr 1fr;gap:14px;margin-bottom:18px">
      <div class="glass-card" style="padding:18px;border-radius:16px;background:var(--bg-glass,rgba(255,255,255,.03));border:1px solid var(--border,rgba(255,255,255,.06));color:var(--text,inherit)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
          <div>
            <div style="font-size:13px;font-weight:600">Aktivität (30 Tage)</div>
            <div style="font-size:11px;opacity:.5;margin-top:2px">Eingelöste Einladungen pro Tag</div>
          </div>
          <div style="display:flex;gap:10px;font-size:11px">
            <span style="display:inline-flex;align-items:center;gap:5px"><span style="width:8px;height:8px;border-radius:2px;background:#34c759"></span>Eingelöst</span>
          </div>
        </div>
        <div id="chart-timeline" style="height:220px"></div>
      </div>
      <div class="glass-card" style="padding:18px;border-radius:16px;background:var(--bg-glass,rgba(255,255,255,.03));border:1px solid var(--border,rgba(255,255,255,.06));color:var(--text,inherit)">
        <div style="font-size:13px;font-weight:600;margin-bottom:4px">Verteilung</div>
        <div style="font-size:11px;opacity:.5;margin-bottom:14px">Owner vs Invitees vs Gesamt</div>
        <div id="chart-donut" style="height:220px"></div>
      </div>
    </div>

    ${owners.length ? `
    <div class="glass-card" style="padding:18px;border-radius:16px;background:var(--bg-glass,rgba(255,255,255,.03));border:1px solid var(--border,rgba(255,255,255,.06));color:var(--text,inherit);margin-bottom:18px">
      <div style="font-size:13px;font-weight:600;margin-bottom:4px">Top Code-Owner</div>
      <div style="font-size:11px;opacity:.5;margin-bottom:14px">Wer hat die meisten Einladungen eingelöst bekommen</div>
      <div id="chart-owners" style="height:200px"></div>
    </div>` : ''}

    <div class="glass-card" style="padding:18px;border-radius:16px;background:var(--bg-glass,rgba(255,255,255,.03));border:1px solid var(--border,rgba(255,255,255,.06));color:var(--text,inherit)">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px;flex-wrap:wrap">
        <div>
          <div style="font-size:13px;font-weight:600">Eingelöste Codes</div>
          <div style="font-size:11px;opacity:.5;margin-top:2px"><span id="row-count">${fmtNumber(total)}</span> Einträge</div>
        </div>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <div id="seg-filter"></div>
          <input id="search" placeholder="Suche User…" style="padding:8px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.04);color:var(--text,inherit);font-size:12px;min-width:200px;outline:none">
        </div>
      </div>
      <div id="table-wrap"></div>
      <div id="pager" style="display:flex;justify-content:space-between;align-items:center;margin-top:14px"></div>
    </div>
  `

  const heros = body.querySelector('#heros')
  const heroDefs = [
    { label: 'Eingelöst gesamt', val: total, color: '#34c759', icon: 'check-circle' },
    { label: 'Letzte 30 Tage', val: last30, color: '#0a84ff', icon: 'trending-up' },
    { label: 'Unique Owner', val: uniqueOwners, color: '#5e5ce6', icon: 'user-plus' },
    { label: 'Unique Invitees', val: uniqueInvitees, color: '#ff9f0a', icon: 'users' },
  ]
  heros.innerHTML = heroDefs.map(h=>`
    <div class="glass-card hero" style="padding:18px;border-radius:16px;background:var(--bg-glass,rgba(255,255,255,.03));border:1px solid var(--border,rgba(255,255,255,.06));color:var(--text,inherit);position:relative;overflow:hidden">
      <div style="position:absolute;top:14px;right:14px;width:34px;height:34px;border-radius:10px;background:${h.color}22;display:flex;align-items:center;justify-content:center;color:${h.color}">${iconHtml(h.icon)}</div>
      <div style="font-size:11px;opacity:.55;text-transform:uppercase;letter-spacing:.5px;font-weight:600">${h.label}</div>
      <div class="hero-val" data-target="${h.val}" style="font-size:30px;font-weight:700;letter-spacing:-.5px;margin-top:8px">0</div>
    </div>
  `).join('')
  heros.querySelectorAll('.hero-val').forEach(el => {
    try { countUp(el, parseInt(el.dataset.target,10), { duration: 800 }) }
    catch(_) { el.textContent = el.dataset.target }
  })

  // Charts: canonical signatures
  // makeAreaChart / makeBarChart: { categories, series:[{name,data}], colors, height }
  // makeDonutChart:                { labels, values, colors, height }
  try {
    makeAreaChart(body.querySelector('#chart-timeline'), {
      categories: series.map(s => s.date.toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit'})),
      series: [
        { name: 'Eingelöst', data: series.map(s=>s.used) },
      ],
      colors: ['#34c759'],
      height: 220,
    })
  } catch(e){ console.error('chart error (timeline)', e) }

  try {
    const donutVals = [uniqueOwners, uniqueInvitees, Math.max(0, total - uniqueInvitees)]
    if (donutVals.every(v => v === 0)) {
      body.querySelector('#chart-donut').innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;flex-direction:column;gap:6px;opacity:.55;font-size:12px">${iconHtml('pie-chart')}<span>Noch keine Einlösungen</span></div>`
    } else {
      makeDonutChart(body.querySelector('#chart-donut'), {
        labels: ['Unique Owner', 'Unique Invitees', 'Wiederholte Owner-Hits'],
        values: donutVals,
        colors: ['#5e5ce6','#ff9f0a','#34c759'],
        height: 220,
      })
    }
  } catch(e){ console.error('chart error (donut)', e) }

  if (owners.length) {
    try {
      makeBarChart(body.querySelector('#chart-owners'), {
        categories: owners.map(o=>o.name),
        series: [
          { name: 'Eingelöst', data: owners.map(o=>o.used) },
        ],
        colors: ['#34c759'],
        height: 200,
      })
    } catch(e){ console.error('chart error (owners)', e) }
  }

  const seg = body.querySelector('#seg-filter')
  try {
    // segmentedControl(container, options, activeKey, onChange) — positional
    segmentedControl(
      seg,
      [
        { key: 'all', label: 'Alle' },
        { key: '7d', label: '7 Tage' },
        { key: '30d', label: '30 Tage' },
        { key: '90d', label: '90 Tage' },
      ],
      state.filter,
      (v) => { state.filter = v; state.page = 1; renderTable(body, rootContainer) }
    )
  } catch(e) {
    seg.innerHTML = ['all','7d','30d','90d'].map(v=>`<button data-f="${v}" style="padding:6px 10px;margin-right:4px;border-radius:6px;border:1px solid rgba(255,255,255,.1);background:${state.filter===v?'#0a84ff':'transparent'};color:var(--text,inherit);cursor:pointer">${v}</button>`).join('')
    seg.addEventListener('click', e=>{const b=e.target.closest('[data-f]'); if(b){ state.filter=b.dataset.f; state.page=1; renderTable(body,rootContainer) }})
  }

  const search = body.querySelector('#search')
  search.addEventListener('input', debounce(() => { state.search = search.value; state.page = 1; renderTable(body, rootContainer) }, 200))

  renderTable(body, rootContainer)
}

function renderTable(body, rootContainer) {
  const filtered = applyFilters(state.rows)
  const total = filtered.length
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  if (state.page > pages) state.page = pages
  const start = (state.page-1) * PAGE_SIZE
  const slice = filtered.slice(start, start + PAGE_SIZE)

  body.querySelector('#row-count').textContent = fmtNumber(total)

  const wrap = body.querySelector('#table-wrap')
  if (slice.length === 0) {
    wrap.innerHTML = `
      <div style="padding:50px 20px;text-align:center;border:1px dashed rgba(255,255,255,.08);border-radius:14px;color:var(--text,inherit)">
        <div style="font-size:42px;margin-bottom:10px;opacity:.6">${iconHtml('inbox')}</div>
        <div style="font-weight:600;margin-bottom:6px">Keine Einlösungen im Zeitraum</div>
        <div style="opacity:.55;font-size:12px">Sobald User über einen Einladungslink registrieren, erscheinen die Referrals hier.</div>
      </div>
    `
    body.querySelector('#pager').innerHTML = ''
    return
  }

  const th = (key, label) => {
    const active = state.sortKey === key
    const arrow = active ? (state.sortDir==='asc'?'▲':'▼') : ''
    return `<th data-sort="${key}" style="text-align:left;padding:10px 12px;font-size:11px;font-weight:600;opacity:.6;text-transform:uppercase;letter-spacing:.5px;cursor:pointer;user-select:none">${label} <span style="opacity:.7">${arrow}</span></th>`
  }

  wrap.innerHTML = `
    <div style="overflow-x:auto;border-radius:12px;border:1px solid rgba(255,255,255,.06)">
      <table class="data-table" style="width:100%;border-collapse:collapse;font-size:13px;color:var(--text,inherit)">
        <thead style="background:rgba(255,255,255,.02)">
          <tr>
            <th style="text-align:left;padding:10px 12px;font-size:11px;font-weight:600;opacity:.6;text-transform:uppercase;letter-spacing:.5px">Owner</th>
            <th style="text-align:left;padding:10px 12px;font-size:11px;font-weight:600;opacity:.6;text-transform:uppercase;letter-spacing:.5px">Eingelöst von</th>
            ${th('created_at', 'Eingelöst am')}
            <th style="text-align:right;padding:10px 12px;font-size:11px;font-weight:600;opacity:.6;text-transform:uppercase;letter-spacing:.5px">Aktionen</th>
          </tr>
        </thead>
        <tbody>
          ${slice.map(r => `
            <tr data-id="${htmlEscape(r.id)}" style="border-top:1px solid rgba(255,255,255,.04);transition:background .12s" class="row">
              <td style="padding:12px">${userCell(r.owner, r.inviter_id)}</td>
              <td style="padding:12px">${userCell(r.invitee, r.invitee_id)}</td>
              <td style="padding:12px;opacity:.8" title="${r.created_at?htmlEscape(fmtDateTime(r.created_at)):''}">${r.created_at?htmlEscape(fmtRelativeTime(r.created_at)):'—'}</td>
              <td style="padding:12px;text-align:right">
                <button class="row-act" data-act="details" data-id="${htmlEscape(r.id)}" style="padding:6px 10px;border-radius:7px;border:1px solid rgba(255,255,255,.08);background:transparent;color:var(--text,inherit);font-size:11px;cursor:pointer">Details</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `

  wrap.querySelectorAll('.row').forEach(r => {
    r.addEventListener('mouseenter', () => r.style.background = 'rgba(255,255,255,.025)')
    r.addEventListener('mouseleave', () => r.style.background = '')
  })

  wrap.querySelectorAll('[data-sort]').forEach(h => h.addEventListener('click', () => {
    const k = h.dataset.sort
    if (state.sortKey === k) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc'
    else { state.sortKey = k; state.sortDir = 'desc' }
    renderTable(body, rootContainer)
  }))

  wrap.querySelectorAll('.row-act').forEach(b => b.addEventListener('click', async (e) => {
    e.stopPropagation()
    const id = b.dataset.id
    const row = state.rows.find(c => c.id === id)
    if (!row) return
    if (b.dataset.act === 'details') openReferralDrawer(row)
  }))

  wrap.querySelectorAll('.link-user').forEach(u => u.addEventListener('click', (e) => {
    e.stopPropagation()
    try { showUserDetailModal(u.dataset.user) } catch(_){}
  }))

  const pager = body.querySelector('#pager')
  pager.innerHTML = `
    <div style="font-size:12px;opacity:.55">Seite ${state.page} von ${pages} · ${fmtNumber(total)} Einlösungen</div>
    <div style="display:flex;gap:6px">
      <button id="prev" ${state.page<=1?'disabled':''} style="padding:6px 12px;border-radius:7px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.03);color:var(--text,inherit);font-size:12px;cursor:pointer;opacity:${state.page<=1?.4:1}">← Zurück</button>
      <button id="next" ${state.page>=pages?'disabled':''} style="padding:6px 12px;border-radius:7px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.03);color:var(--text,inherit);font-size:12px;cursor:pointer;opacity:${state.page>=pages?.4:1}">Weiter →</button>
    </div>
  `
  pager.querySelector('#prev').addEventListener('click', () => { if(state.page>1){state.page--; renderTable(body, rootContainer)} })
  pager.querySelector('#next').addEventListener('click', () => { if(state.page<pages){state.page++; renderTable(body, rootContainer)} })
}

function openReferralDrawer(row) {
  const html = `
    <div style="padding:24px;color:var(--text,inherit)">
      <div style="display:grid;gap:14px;margin-bottom:20px">
        <div>
          <div style="font-size:11px;opacity:.5;text-transform:uppercase;letter-spacing:.5px;font-weight:600;margin-bottom:4px">Owner (Inviter)</div>
          <div>${userCell(row.owner, row.inviter_id)}</div>
        </div>
        <div>
          <div style="font-size:11px;opacity:.5;text-transform:uppercase;letter-spacing:.5px;font-weight:600;margin-bottom:4px">Eingelöst von (Invitee)</div>
          <div>${userCell(row.invitee, row.invitee_id)}</div>
        </div>
        <div>
          <div style="font-size:11px;opacity:.5;text-transform:uppercase;letter-spacing:.5px;font-weight:600;margin-bottom:4px">Eingelöst am</div>
          <div>${row.created_at?htmlEscape(fmtDateTime(row.created_at)):'—'}</div>
        </div>
        <div>
          <div style="font-size:11px;opacity:.5;text-transform:uppercase;letter-spacing:.5px;font-weight:600;margin-bottom:4px">Referral-ID</div>
          <div style="font-family:monospace;font-size:12px;opacity:.7">${htmlEscape(row.id)}</div>
        </div>
      </div>
    </div>
  `
  try {
    drawer({
      title: 'Referral-Details',
      contentHtml: html,
      width: 460,
      onMount: (root) => {
        root.querySelectorAll('.link-user').forEach(u => u.addEventListener('click', (e) => {
          e.stopPropagation()
          try { showUserDetailModal(u.dataset.user) } catch(_){}
        }))
      },
    })
  } catch (e) {
    toast('Drawer konnte nicht geöffnet werden', 'error')
  }
}
