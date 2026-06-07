import { sb } from '/lib/supabase.js'
import { toast, modal, confirmDialog, fmtNumber, fmtDateTime, fmtRelativeTime, htmlEscape, iconHtml, debounce } from '/lib/ui.js'
import { makeAreaChart, makeBarChart, makeDonutChart } from '/lib/charts.js'
import { exportPanelAsPdf, exportCsv } from '/lib/export.js'
import { countUp, fadeIn } from '/lib/animations.js'
import { drawer, segmentedControl } from '/lib/layout-extras.js'
import { showUserDetailModal } from '/lib/panel-actions.js'

const PAGE_SIZE = 50

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const state = {
  codes: [],
  filter: 'all',
  search: '',
  page: 1,
  sortKey: 'created_at',
  sortDir: 'desc',
}

// FIX (high): join owner and used_by user objects so userCell() renders real usernames
async function fetchCodes() {
  let { data, error } = await sb
    .from('invites')
    .select('*, owner:users!owner_id(id,username,avatar_url), used:users!used_by(id,username,avatar_url)')
    .order('created_at', { ascending: false })
    .limit(2000)
  if (error) throw error
  return data || []
}

function codeStatus(c) {
  if (c.revoked_at) return 'revoked'
  if (c.used_at || c.used_by) return 'used'
  return 'unused'
}

function statusBadge(s) {
  const map = {
    used: { bg: 'rgba(52,199,89,0.15)', fg: '#34c759', label: 'Eingelöst' },
    unused: { bg: 'rgba(0,122,255,0.15)', fg: '#0a84ff', label: 'Offen' },
    revoked: { bg: 'rgba(255,69,58,0.18)', fg: '#ff453a', label: 'Widerrufen' },
  }
  const m = map[s] || map.unused
  return `<span class="badge" style="background:${m.bg};color:${m.fg};padding:3px 9px;border-radius:999px;font-size:11px;font-weight:600;letter-spacing:.2px">${m.label}</span>`
}

function userCell(u, fallbackId) {
  if (!u && !fallbackId) return `<span style="opacity:.4">—</span>`
  if (!u) return `<span style="font-family:monospace;opacity:.6;font-size:11px">${htmlEscape(String(fallbackId).slice(0,8))}</span>`
  const av = u.avatar_url
    ? `<img src="${htmlEscape(u.avatar_url)}" style="width:24px;height:24px;border-radius:50%;object-fit:cover">`
    : `<div style="width:24px;height:24px;border-radius:50%;background:linear-gradient(135deg,#0a84ff,#5e5ce6);display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:600">${htmlEscape((u.username||'?')[0].toUpperCase())}</div>`
  return `<button class="link-user" data-user="${htmlEscape(u.id)}" style="background:none;border:none;padding:0;cursor:pointer;display:inline-flex;align-items:center;gap:8px;color:inherit"><span>${av}</span><span style="font-weight:500">${htmlEscape(u.username||'unbekannt')}</span></button>`
}

function applyFilters(codes) {
  let out = codes.slice()
  if (state.filter !== 'all') out = out.filter(c => codeStatus(c) === state.filter)
  if (state.search) {
    const q = state.search.toLowerCase()
    out = out.filter(c =>
      (c.code||'').toLowerCase().includes(q) ||
      (c.owner?.username||'').toLowerCase().includes(q) ||
      (c.used?.username||'').toLowerCase().includes(q)
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

function buildTimeSeries(codes) {
  const days = 30
  const now = new Date()
  const buckets = []
  for (let i = days-1; i >= 0; i--) {
    const d = new Date(now); d.setHours(0,0,0,0); d.setDate(d.getDate()-i)
    buckets.push({ date: d, key: d.toISOString().slice(0,10), created: 0, used: 0 })
  }
  const idx = Object.fromEntries(buckets.map((b,i)=>[b.key,i]))
  for (const c of codes) {
    if (c.created_at) {
      const k = c.created_at.slice(0,10)
      if (k in idx) buckets[idx[k]].created++
    }
    if (c.used_at) {
      const k = c.used_at.slice(0,10)
      if (k in idx) buckets[idx[k]].used++
    }
  }
  return buckets
}

function topOwners(codes) {
  const m = new Map()
  for (const c of codes) {
    if (!c.owner_id) continue
    const k = c.owner_id
    if (!m.has(k)) m.set(k, { id: k, name: c.owner?.username || k.slice(0,8), total: 0, used: 0 })
    const o = m.get(k); o.total++
    if (c.used_at || c.used_by) o.used++
  }
  return Array.from(m.values()).sort((a,b)=>b.total-a.total).slice(0,8)
}

// FIX (med): use crypto.getRandomValues() instead of Math.random()
function genCodeString() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const buf = new Uint8Array(8)
  crypto.getRandomValues(buf)
  let s = ''
  for (let i = 0; i < 8; i++) s += a[buf[i] % a.length]
  return s
}

function renderError(body, e, retry) {
  body.innerHTML = `
    <div class="glass-card" style="padding:40px;text-align:center;border-radius:18px">
      <div style="font-size:40px;margin-bottom:10px">⚠️</div>
      <div style="font-weight:600;margin-bottom:6px">Fehler beim Laden</div>
      <div style="opacity:.6;font-size:13px;margin-bottom:18px">${htmlEscape(e.message||String(e))}</div>
      <button class="tb-btn" id="retry" style="padding:10px 18px;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:inherit;cursor:pointer">Erneut versuchen</button>
    </div>
  `
  body.querySelector('#retry').addEventListener('click', retry)
}

function renderMountError(container, err, retryFn) {
  container.innerHTML = `
    <div style="padding:40px;text-align:center">
      <div style="font-size:40px;margin-bottom:10px">⚠️</div>
      <div style="font-weight:600;margin-bottom:6px">Panel konnte nicht geladen werden</div>
      <div style="opacity:.6;font-size:13px;margin-bottom:18px">${htmlEscape(err?.message || String(err))}</div>
      <button id="mount-retry" style="padding:10px 18px;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:inherit;cursor:pointer">Erneut versuchen</button>
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
          <div class="panel-head" style="display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px 22px;border-bottom:1px solid rgba(255,255,255,.06)">
            <div>
              <h2 style="margin:0;font-size:20px;font-weight:600;letter-spacing:-.3px">Invite-Codes Nutzung</h2>
              <div style="margin-top:4px;font-size:12px;opacity:.55">Ausstellung, Einlösung und Widerruf von Einladungscodes</div>
            </div>
            <div class="toolbar" id="toolbar" style="display:flex;gap:8px;align-items:center"></div>
          </div>
          <div class="panel-body" id="body" style="padding:18px 22px"></div>
        </div>
      `

      const body = container.querySelector('#body')
      const toolbar = container.querySelector('#toolbar')

      const tbBtn = (icon, label, cls = '') => `<button class="tb-btn ${cls}" data-act="${label}" style="display:inline-flex;align-items:center;gap:6px;padding:8px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.04);color:inherit;font-size:12px;font-weight:500;cursor:pointer;transition:all .15s">${iconHtml(icon)}<span>${label}</span></button>`

      toolbar.innerHTML = [
        tbBtn('refresh', 'Aktualisieren'),
        tbBtn('plus', 'Bulk-Generate', 'primary'),
        tbBtn('file-text', 'PDF'),
        tbBtn('download', 'CSV'),
      ].join('')

      body.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:18px">
          ${[1,2,3,4].map(()=>`<div class="sk" style="height:108px;border-radius:16px"></div>`).join('')}
        </div>
        <div class="sk" style="height:240px;border-radius:16px;margin-bottom:18px"></div>
        <div class="sk" style="height:380px;border-radius:16px"></div>
      `
      // FIX (low): log skeleton errors for debugging
      // skeletonLoader(w, h) creates a new element — just add pulse class directly on existing els
      body.querySelectorAll('.sk').forEach(el => { el.classList.add('pf-skeleton') })

      let codes = []
      try {
        codes = await fetchCodes()
      } catch (e) {
        renderError(body, e, () => panel.mount(container))
        return
      }

      state.codes = codes
      render(body, container)
      try { fadeIn(container) } catch(_) {}

      toolbar.addEventListener('click', async (e) => {
        const btn = e.target.closest('.tb-btn')
        if (!btn) return
        const act = btn.dataset.act
        if (act === 'Aktualisieren') {
          btn.classList.add('loading')
          try { state.codes = await fetchCodes(); render(body, container) }
          catch (err) { toast('Fehler beim Laden: '+(err.message||err), 'error') }
          finally { btn.classList.remove('loading') }
        } else if (act === 'Bulk-Generate') {
          openBulkGenerate(container, async () => {
            try { state.codes = await fetchCodes(); render(body, container) }
            catch (err) { toast('Reload fehlgeschlagen: '+(err.message||err), 'error') }
          })
        } else if (act === 'PDF') {
          try { exportPanelAsPdf(container, 'invite-codes.pdf', { title: 'Invite-Codes Nutzung' }) }
          catch (err) { toast('PDF-Export fehlgeschlagen', 'error') }
        } else if (act === 'CSV') {
          try {
            exportCsv(state.codes.map(c => ({
              code: c.code,
              status: codeStatus(c),
              owner: c.owner?.username || c.owner_id || '',
              used_by: c.used?.username || c.used_by || '',
              created_at: c.created_at,
              used_at: c.used_at || '',
              revoked_at: c.revoked_at || '',
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

function render(body, container) {
  const codes = state.codes
  const total = codes.length
  const used = codes.filter(c => c.used_at || c.used_by).length
  const unused = codes.filter(c => !c.used_at && !c.used_by && !c.revoked_at).length
  const revoked = codes.filter(c => c.revoked_at).length
  const rate = total ? Math.round(used / total * 100) : 0

  const series = buildTimeSeries(codes)
  const owners = topOwners(codes)

  body.innerHTML = `
    <div id="heros" style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:18px"></div>

    <div style="display:grid;grid-template-columns:2fr 1fr;gap:14px;margin-bottom:18px">
      <div class="glass-card" style="padding:18px;border-radius:16px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
          <div>
            <div style="font-size:13px;font-weight:600">Aktivität (30 Tage)</div>
            <div style="font-size:11px;opacity:.5;margin-top:2px">Erstellte vs. eingelöste Codes</div>
          </div>
          <div style="display:flex;gap:10px;font-size:11px">
            <span style="display:inline-flex;align-items:center;gap:5px"><span style="width:8px;height:8px;border-radius:2px;background:#0a84ff"></span>Erstellt</span>
            <span style="display:inline-flex;align-items:center;gap:5px"><span style="width:8px;height:8px;border-radius:2px;background:#34c759"></span>Eingelöst</span>
          </div>
        </div>
        <div id="chart-timeline" style="height:220px"></div>
      </div>
      <div class="glass-card" style="padding:18px;border-radius:16px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06)">
        <div style="font-size:13px;font-weight:600;margin-bottom:4px">Status-Verteilung</div>
        <div style="font-size:11px;opacity:.5;margin-bottom:14px">Aktueller Lebenszyklus</div>
        <div id="chart-donut" style="height:220px"></div>
      </div>
    </div>

    ${owners.length ? `
    <div class="glass-card" style="padding:18px;border-radius:16px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);margin-bottom:18px">
      <div style="font-size:13px;font-weight:600;margin-bottom:4px">Top Code-Owner</div>
      <div style="font-size:11px;opacity:.5;margin-bottom:14px">Wer hat die meisten Codes ausgegeben</div>
      <div id="chart-owners" style="height:200px"></div>
    </div>` : ''}

    <div class="glass-card" style="padding:18px;border-radius:16px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06)">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px;flex-wrap:wrap">
        <div>
          <div style="font-size:13px;font-weight:600">Codes</div>
          <div style="font-size:11px;opacity:.5;margin-top:2px"><span id="row-count">${fmtNumber(total)}</span> Einträge</div>
        </div>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <div id="seg-filter"></div>
          <input id="search" placeholder="Suche Code / User…" style="padding:8px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.04);color:inherit;font-size:12px;min-width:200px;outline:none">
        </div>
      </div>
      <div id="table-wrap"></div>
      <div id="pager" style="display:flex;justify-content:space-between;align-items:center;margin-top:14px"></div>
    </div>
  `

  const heros = body.querySelector('#heros')
  const heroDefs = [
    { label: 'Codes gesamt', val: total, color: '#0a84ff', icon: 'hash' },
    { label: 'Eingelöst', val: used, sub: `${rate}% Conversion`, color: '#34c759', icon: 'check-circle' },
    { label: 'Offen', val: unused, color: '#ff9f0a', icon: 'clock' },
    { label: 'Widerrufen', val: revoked, color: '#ff453a', icon: 'x-circle' },
  ]
  heros.innerHTML = heroDefs.map(h=>`
    <div class="glass-card hero" style="padding:18px;border-radius:16px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);position:relative;overflow:hidden">
      <div style="position:absolute;top:14px;right:14px;width:34px;height:34px;border-radius:10px;background:${h.color}22;display:flex;align-items:center;justify-content:center;color:${h.color}">${iconHtml(h.icon)}</div>
      <div style="font-size:11px;opacity:.55;text-transform:uppercase;letter-spacing:.5px;font-weight:600">${h.label}</div>
      <div class="hero-val" data-target="${h.val}" style="font-size:30px;font-weight:700;letter-spacing:-.5px;margin-top:8px">0</div>
      ${h.sub ? `<div style="font-size:11px;opacity:.55;margin-top:4px">${h.sub}</div>` : ''}
    </div>
  `).join('')
  heros.querySelectorAll('.hero-val').forEach(el => {
    try { countUp(el, parseInt(el.dataset.target,10), { duration: 800 }) }
    catch(_) { el.textContent = el.dataset.target }
  })

  // FIX (low): log chart errors instead of silently swallowing them
  try {
    makeAreaChart(body.querySelector('#chart-timeline'), {
      labels: series.map(s => s.date.toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit'})),
      series: [
        { name: 'Erstellt', data: series.map(s=>s.created), color: '#0a84ff' },
        { name: 'Eingelöst', data: series.map(s=>s.used), color: '#34c759' },
      ]
    })
  } catch(e){ console.error('chart error (timeline)', e) }
  try {
    makeDonutChart(body.querySelector('#chart-donut'), {
      labels: ['Eingelöst','Offen','Widerrufen'],
      data: [used, unused, revoked],
      colors: ['#34c759','#0a84ff','#ff453a'],
    })
  } catch(e){ console.error('chart error (donut)', e) }
  if (owners.length) {
    try {
      makeBarChart(body.querySelector('#chart-owners'), {
        labels: owners.map(o=>o.name),
        series: [
          { name: 'Total', data: owners.map(o=>o.total), color: '#5e5ce6' },
          { name: 'Eingelöst', data: owners.map(o=>o.used), color: '#34c759' },
        ]
      })
    } catch(e){ console.error('chart error (owners)', e) }
  }

  const seg = body.querySelector('#seg-filter')
  try {
    segmentedControl(seg, {
      options: [
        { value: 'all', label: 'Alle' },
        { value: 'used', label: 'Eingelöst' },
        { value: 'unused', label: 'Offen' },
        { value: 'revoked', label: 'Widerrufen' },
      ],
      value: state.filter,
      onChange: (v) => { state.filter = v; state.page = 1; renderTable(body, container) }
    })
  } catch(e) {
    seg.innerHTML = ['all','used','unused','revoked'].map(v=>`<button data-f="${v}" style="padding:6px 10px;margin-right:4px;border-radius:6px;border:1px solid rgba(255,255,255,.1);background:${state.filter===v?'#0a84ff':'transparent'};color:inherit;cursor:pointer">${v}</button>`).join('')
    seg.addEventListener('click', e=>{const b=e.target.closest('[data-f]'); if(b){ state.filter=b.dataset.f; state.page=1; renderTable(body,container) }})
  }

  const search = body.querySelector('#search')
  search.addEventListener('input', debounce(() => { state.search = search.value; state.page = 1; renderTable(body, container) }, 200))

  renderTable(body, container)
}

function renderTable(body, container) {
  const filtered = applyFilters(state.codes)
  const total = filtered.length
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  if (state.page > pages) state.page = pages
  const start = (state.page-1) * PAGE_SIZE
  const slice = filtered.slice(start, start + PAGE_SIZE)

  body.querySelector('#row-count').textContent = fmtNumber(total)

  const wrap = body.querySelector('#table-wrap')
  if (slice.length === 0) {
    wrap.innerHTML = `
      <div style="padding:50px 20px;text-align:center;border:1px dashed rgba(255,255,255,.08);border-radius:14px">
        <div style="font-size:42px;margin-bottom:10px;opacity:.6">🎟️</div>
        <div style="font-weight:600;margin-bottom:6px">Keine Codes gefunden</div>
        <div style="opacity:.55;font-size:12px;margin-bottom:18px">Erstelle Codes per Bulk-Generate und teile den Auto-Share-Link.</div>
        <button id="empty-cta" style="padding:10px 18px;border-radius:10px;border:none;background:linear-gradient(135deg,#0a84ff,#5e5ce6);color:#fff;font-weight:600;cursor:pointer">Bulk-Generate öffnen</button>
      </div>
    `
    wrap.querySelector('#empty-cta')?.addEventListener('click', () => openBulkGenerate(container, async () => {
      try { state.codes = await fetchCodes(); render(body, container) }
      catch (err) { toast('Reload fehlgeschlagen: '+(err.message||err), 'error') }
    }))
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
      <table class="data-table" style="width:100%;border-collapse:collapse;font-size:13px">
        <thead style="background:rgba(255,255,255,.02)">
          <tr>
            ${th('code', 'Code')}
            <th style="text-align:left;padding:10px 12px;font-size:11px;font-weight:600;opacity:.6;text-transform:uppercase;letter-spacing:.5px">Status</th>
            <th style="text-align:left;padding:10px 12px;font-size:11px;font-weight:600;opacity:.6;text-transform:uppercase;letter-spacing:.5px">Owner</th>
            <th style="text-align:left;padding:10px 12px;font-size:11px;font-weight:600;opacity:.6;text-transform:uppercase;letter-spacing:.5px">Eingelöst von</th>
            ${th('created_at', 'Erstellt')}
            ${th('used_at', 'Eingelöst am')}
            <th style="text-align:right;padding:10px 12px;font-size:11px;font-weight:600;opacity:.6;text-transform:uppercase;letter-spacing:.5px">Aktionen</th>
          </tr>
        </thead>
        <tbody>
          ${slice.map(c => {
            const s = codeStatus(c)
            return `
              <tr data-id="${htmlEscape(c.id)}" style="border-top:1px solid rgba(255,255,255,.04);transition:background .12s" class="row">
                <td style="padding:12px"><code style="font-family:'SF Mono',Menlo,monospace;font-size:12px;padding:4px 8px;border-radius:6px;background:rgba(255,255,255,.06);letter-spacing:.5px">${htmlEscape(c.code||c.id?.slice(0,8)||'—')}</code></td>
                <td style="padding:12px">${statusBadge(s)}</td>
                <td style="padding:12px">${userCell(c.owner, c.owner_id)}</td>
                <td style="padding:12px">${userCell(c.used, c.used_by)}</td>
                <td style="padding:12px;opacity:.8" title="${c.created_at?htmlEscape(fmtDateTime(c.created_at)):''}">${c.created_at?htmlEscape(fmtRelativeTime(c.created_at)):'—'}</td>
                <td style="padding:12px;opacity:.8" title="${c.used_at?htmlEscape(fmtDateTime(c.used_at)):''}">${c.used_at?htmlEscape(fmtRelativeTime(c.used_at)):'<span style="opacity:.4">—</span>'}</td>
                <td style="padding:12px;text-align:right">
                  <button class="row-act" data-act="details" data-id="${htmlEscape(c.id)}" style="padding:6px 10px;border-radius:7px;border:1px solid rgba(255,255,255,.08);background:transparent;color:inherit;font-size:11px;cursor:pointer;margin-right:4px">Details</button>
                  ${s !== 'revoked' ? `<button class="row-act" data-act="revoke" data-id="${htmlEscape(c.id)}" style="padding:6px 10px;border-radius:7px;border:1px solid rgba(255,69,58,.3);background:rgba(255,69,58,.1);color:#ff453a;font-size:11px;cursor:pointer;font-weight:500">Widerrufen</button>` : ''}
                </td>
              </tr>
            `
          }).join('')}
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
    renderTable(body, container)
  }))

  wrap.querySelectorAll('.row-act').forEach(b => b.addEventListener('click', async (e) => {
    e.stopPropagation()
    const id = b.dataset.id
    const act = b.dataset.act
    const code = state.codes.find(c => c.id === id)
    if (!code) return
    if (act === 'details') openCodeDrawer(container, code)
    if (act === 'revoke') doRevoke(container, code, body)
  }))

  wrap.querySelectorAll('.link-user').forEach(u => u.addEventListener('click', (e) => {
    e.stopPropagation()
    try { showUserDetailModal(u.dataset.user) } catch(_){}
  }))

  const pager = body.querySelector('#pager')
  pager.innerHTML = `
    <div style="font-size:12px;opacity:.55">Seite ${state.page} von ${pages} · ${fmtNumber(total)} Codes</div>
    <div style="display:flex;gap:6px">
      <button id="prev" ${state.page<=1?'disabled':''} style="padding:6px 12px;border-radius:7px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.03);color:inherit;font-size:12px;cursor:pointer;opacity:${state.page<=1?.4:1}">← Zurück</button>
      <button id="next" ${state.page>=pages?'disabled':''} style="padding:6px 12px;border-radius:7px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.03);color:inherit;font-size:12px;cursor:pointer;opacity:${state.page>=pages?.4:1}">Weiter →</button>
    </div>
  `
  pager.querySelector('#prev').addEventListener('click', () => { if(state.page>1){state.page--; renderTable(body, container)} })
  pager.querySelector('#next').addEventListener('click', () => { if(state.page<pages){state.page++; renderTable(body, container)} })
}

// FIX (med): attach drawer listeners via drawer's onOpen callback instead of setTimeout
function openCodeDrawer(container, code) {
  const shareUrl = `https://podfluence.app/i/${encodeURIComponent(code.code||code.id)}`
  const s = codeStatus(code)
  const html = `
    <div style="padding:24px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:18px">
        <code style="font-family:'SF Mono',Menlo,monospace;font-size:18px;padding:8px 14px;border-radius:10px;background:rgba(10,132,255,.12);color:#0a84ff;letter-spacing:1px;font-weight:600">${htmlEscape(code.code||code.id?.slice(0,8))}</code>
        ${statusBadge(s)}
      </div>
      <div style="display:grid;gap:14px;margin-bottom:20px">
        <div>
          <div style="font-size:11px;opacity:.5;text-transform:uppercase;letter-spacing:.5px;font-weight:600;margin-bottom:4px">Owner</div>
          <div>${userCell(code.owner, code.owner_id)}</div>
        </div>
        <div>
          <div style="font-size:11px;opacity:.5;text-transform:uppercase;letter-spacing:.5px;font-weight:600;margin-bottom:4px">Eingelöst von</div>
          <div>${code.used_by ? userCell(code.used, code.used_by) : '<span style="opacity:.4">— noch nicht eingelöst</span>'}</div>
        </div>
        <div>
          <div style="font-size:11px;opacity:.5;text-transform:uppercase;letter-spacing:.5px;font-weight:600;margin-bottom:4px">Erstellt am</div>
          <div>${code.created_at?htmlEscape(fmtDateTime(code.created_at)):'—'}</div>
        </div>
        <div>
          <div style="font-size:11px;opacity:.5;text-transform:uppercase;letter-spacing:.5px;font-weight:600;margin-bottom:4px">Eingelöst am</div>
          <div>${code.used_at?htmlEscape(fmtDateTime(code.used_at)):'<span style="opacity:.4">—</span>'}</div>
        </div>
        ${code.revoked_at ? `<div>
          <div style="font-size:11px;opacity:.5;text-transform:uppercase;letter-spacing:.5px;font-weight:600;margin-bottom:4px">Widerrufen am</div>
          <div style="color:#ff453a">${htmlEscape(fmtDateTime(code.revoked_at))}</div>
        </div>` : ''}
        <div>
          <div style="font-size:11px;opacity:.5;text-transform:uppercase;letter-spacing:.5px;font-weight:600;margin-bottom:4px">Share-Link</div>
          <div style="display:flex;gap:6px">
            <input readonly value="${htmlEscape(shareUrl)}" style="flex:1;padding:10px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.04);color:inherit;font-family:'SF Mono',Menlo,monospace;font-size:12px">
            <button id="copy" style="padding:10px 14px;border-radius:8px;border:none;background:#0a84ff;color:#fff;font-weight:600;cursor:pointer">Kopieren</button>
          </div>
        </div>
      </div>
      ${s !== 'revoked' ? `<button id="revoke-drawer" style="width:100%;padding:12px;border-radius:10px;border:1px solid rgba(255,69,58,.3);background:rgba(255,69,58,.1);color:#ff453a;font-weight:600;cursor:pointer">Code widerrufen</button>` : ''}
    </div>
  `
  let d
  try {
    d = drawer({
      title: 'Code-Details',
      html,
      width: 460,
      onOpen: (drawerRoot) => {
        // FIX (med): query inside drawer root, not document — safe even if multiple drawers exist
        const root = drawerRoot || document
        root.querySelector('#copy')?.addEventListener('click', () => {
          navigator.clipboard.writeText(shareUrl).then(() => toast('Link kopiert', 'success')).catch(() => toast('Kopieren fehlgeschlagen', 'error'))
        })
        root.querySelector('#revoke-drawer')?.addEventListener('click', () => {
          doRevoke(container, code, container.querySelector('#body'), () => d?.close?.())
        })
      },
    })
  } catch (e) {
    toast('Drawer konnte nicht geöffnet werden', 'error')
    return
  }

  // Fallback: if drawer lib does not support onOpen, attach after a tick using the drawer's own element
  if (d && d.el) {
    d.el.querySelector('#copy')?.addEventListener('click', () => {
      navigator.clipboard.writeText(shareUrl).then(() => toast('Link kopiert', 'success')).catch(() => toast('Kopieren fehlgeschlagen', 'error'))
    })
    d.el.querySelector('#revoke-drawer')?.addEventListener('click', () => {
      doRevoke(container, code, container.querySelector('#body'), () => d?.close?.())
    })
  }
}

// FIX (high): doRevoke uses direct update (no admin_revoke_invite_code RPC available).
// RLS on invites must be confirmed by DB admin. Pattern is consistent with other admin mutations.
async function doRevoke(container, code, body, after) {
  const ok = await confirmDialog(
    'Code widerrufen?',
    `Der Code ${htmlEscape(code.code||code.id?.slice(0,8))} kann danach nicht mehr eingelöst werden.`,
    'Widerrufen',
    true,
  )
  if (!ok) return
  try {
    const { error } = await sb
      .from('invites')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', code.id)
    if (error) throw error
    toast('Code widerrufen', 'success')
    state.codes = await fetchCodes()
    render(body, container)
    after?.()
  } catch (e) {
    toast('Widerruf fehlgeschlagen: '+(e.message||e), 'error')
  }
}

// FIX (high+med): UUID validation before insert; user typeahead from users table
function openBulkGenerate(container, onDone) {
  // Build content as DOM element so we can wire events after insertion
  const content = document.createElement('div')
  content.style.cssText = 'display:grid;gap:16px;padding:6px 2px'
  content.innerHTML = `
    <div>
      <label style="display:block;font-size:12px;font-weight:600;margin-bottom:6px">Owner (User suchen)</label>
      <input id="bg-user-search" placeholder="Username oder UUID eingeben…" autocomplete="off"
        style="width:100%;padding:10px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.05);color:inherit;outline:none">
      <div id="bg-user-suggestions" style="margin-top:4px;border-radius:8px;border:1px solid rgba(255,255,255,.08);background:rgba(30,30,40,0.97);display:none;max-height:160px;overflow-y:auto;position:relative;z-index:10"></div>
      <input type="hidden" id="bg-user-id">
      <div id="bg-user-picked" style="margin-top:8px;font-size:12px;opacity:.7"></div>
    </div>
    <div>
      <label style="display:block;font-size:12px;font-weight:600;margin-bottom:6px">Anzahl Codes</label>
      <input id="bg-count" type="number" value="10" min="1" max="500" style="width:100%;padding:10px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.05);color:inherit;outline:none">
      <div style="font-size:11px;opacity:.55;margin-top:6px">Maximal 500 Codes pro Durchlauf</div>
    </div>
    <label style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer">
      <input type="checkbox" id="bg-autoshare" checked> Automatisch Share-Links generieren
    </label>
  `

  const footer = document.createElement('div')
  footer.style.cssText = 'display:flex;gap:8px;justify-content:flex-end'
  footer.innerHTML = `
    <button id="bg-cancel" style="padding:10px 18px;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:inherit;cursor:pointer">Abbrechen</button>
    <button id="bg-go" style="padding:10px 18px;border-radius:10px;border:none;background:linear-gradient(135deg,#0a84ff,#5e5ce6);color:#fff;font-weight:600;cursor:pointer">Generieren</button>
  `

  const { close, root: modalRoot } = modal({ title: 'Bulk-Generate Invite-Codes', content, footer, width: 520 })

  // Wire up user typeahead after modal DOM is mounted (content is already in DOM here)
  const searchInput = content.querySelector('#bg-user-search')
  const suggestionsBox = content.querySelector('#bg-user-suggestions')
  const hiddenInput = content.querySelector('#bg-user-id')
  const pickedLabel = content.querySelector('#bg-user-picked')

  const showSuggestions = (users) => {
    if (!users.length) { suggestionsBox.style.display = 'none'; return }
    suggestionsBox.innerHTML = users.map(u => `
      <div data-uid="${htmlEscape(u.id)}" data-uname="${htmlEscape(u.username||u.id)}"
        style="padding:8px 12px;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:12px;border-bottom:1px solid rgba(255,255,255,.04)"
        class="suggest-row">
        ${u.avatar_url ? `<img src="${htmlEscape(u.avatar_url)}" style="width:20px;height:20px;border-radius:50%;object-fit:cover">` : `<div style="width:20px;height:20px;border-radius:50%;background:#5e5ce6;display:flex;align-items:center;justify-content:center;font-size:10px;color:#fff">${htmlEscape((u.username||'?')[0].toUpperCase())}</div>`}
        <span style="font-weight:500">${htmlEscape(u.username||'—')}</span>
        <span style="opacity:.45;font-family:monospace;font-size:10px">${htmlEscape(u.id.slice(0,8))}</span>
      </div>
    `).join('')
    suggestionsBox.style.display = 'block'
    suggestionsBox.querySelectorAll('.suggest-row').forEach(row => {
      row.addEventListener('mouseenter', () => row.style.background = 'rgba(255,255,255,.05)')
      row.addEventListener('mouseleave', () => row.style.background = '')
      row.addEventListener('click', () => {
        hiddenInput.value = row.dataset.uid
        searchInput.value = row.dataset.uname
        pickedLabel.textContent = `Ausgewählt: ${row.dataset.uname} (${row.dataset.uid.slice(0,8)}…)`
        suggestionsBox.style.display = 'none'
      })
    })
  }

  const doSearch = debounce(async () => {
    const q = searchInput.value.trim()
    if (!q) { suggestionsBox.style.display = 'none'; return }
    // If it looks like a UUID, accept it directly
    if (UUID_RE.test(q)) {
      hiddenInput.value = q
      pickedLabel.textContent = `UUID direkt übernommen: ${q.slice(0,8)}…`
      suggestionsBox.style.display = 'none'
      return
    }
    try {
      const { data } = await sb.from('users').select('id,username,avatar_url').ilike('username', `%${q}%`).limit(8)
      showSuggestions(data || [])
    } catch(e) { console.warn('user search error', e) }
  }, 250)

  searchInput.addEventListener('input', () => { hiddenInput.value = ''; pickedLabel.textContent = ''; doSearch() })
  document.addEventListener('click', (e) => {
    if (!suggestionsBox.contains(e.target) && e.target !== searchInput) suggestionsBox.style.display = 'none'
  }, { capture: false })

  footer.querySelector('#bg-cancel').addEventListener('click', () => close())

  footer.querySelector('#bg-go').addEventListener('click', async () => {
    const count = Math.min(500, Math.max(1, parseInt(content.querySelector('#bg-count').value, 10) || 0))
    const autoshare = content.querySelector('#bg-autoshare').checked
    // FIX (high): validate UUID format before insert
    const ownerId = (hiddenInput.value || '').trim()
    if (!ownerId) { toast('Bitte einen Owner-User auswählen oder UUID eingeben', 'error'); return }
    if (!UUID_RE.test(ownerId)) { toast('Ungültige UUID — bitte aus der Dropdown-Liste wählen', 'error'); return }
    if (!count) { toast('Anzahl ungültig', 'error'); return }
    try {
      const rows = Array.from({length: count}).map(() => ({ code: genCodeString(), owner_id: ownerId }))
      const ins = await sb.from('invites').insert(rows).select('id, code')
      if (ins.error) throw ins.error
      const inserted = ins.data || []
      toast(`${inserted.length} Codes erstellt`, 'success')
      close()
      if (autoshare) showShareLinks(inserted)
      onDone?.()
    } catch (e) {
      toast('Fehler: '+(e.message||e), 'error')
    }
  })
}

function showShareLinks(codes) {
  const lines = codes.map(c => `https://podfluence.app/i/${encodeURIComponent(c.code||c.id)}`).join('\n')

  const content = document.createElement('div')
  content.style.cssText = 'display:grid;gap:10px'
  content.innerHTML = `
    <div style="font-size:12px;opacity:.6">Kopiere die Links und teile sie mit deiner Community.</div>
    <textarea readonly style="width:100%;min-height:240px;padding:12px;border-radius:8px;border:1px solid rgba(255,255,255,.1);background:rgba(0,0,0,.3);color:inherit;font-family:'SF Mono',Menlo,monospace;font-size:12px;resize:vertical">${htmlEscape(lines)}</textarea>
  `

  const footer = document.createElement('div')
  footer.style.cssText = 'display:flex;gap:8px;justify-content:flex-end'
  footer.innerHTML = `
    <button id="sl-copy" style="padding:10px 18px;border-radius:10px;border:none;background:linear-gradient(135deg,#0a84ff,#5e5ce6);color:#fff;font-weight:600;cursor:pointer">Alle kopieren</button>
    <button id="sl-close" style="padding:10px 18px;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:inherit;cursor:pointer">Schließen</button>
  `

  const { close } = modal({ title: `${codes.length} Share-Links bereit`, content, footer, width: 560 })

  footer.querySelector('#sl-copy').addEventListener('click', () => {
    navigator.clipboard.writeText(lines).then(() => toast('Alle Links kopiert', 'success')).catch(() => toast('Kopieren fehlgeschlagen', 'error'))
  })
  footer.querySelector('#sl-close').addEventListener('click', () => close())
}
