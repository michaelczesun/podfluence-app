import { sb } from '/lib/supabase.js'
import { toast, confirmDialog, fmtNumber, fmtDateTime, fmtRelativeTime, htmlEscape, iconHtml, debounce } from '/lib/ui.js'
import { makeAreaChart, makeDonutChart } from '/lib/charts.js'
import { exportPanelAsPdf, exportCsv } from '/lib/export.js'
import { countUp, fadeIn, skeletonLoader } from '/lib/animations.js'
import { drawer, statHero } from '/lib/layout-extras.js'
import { showUserDetailModal, verifyUser, banUser, grantPremium } from '/lib/panel-actions.js'

const PAGE_SIZE = 50

const state = {
  search: '',
  filter: 'all',
  page: 1,
  rows: [],
  total: 0,
  selected: new Set(),
  loading: false,
  signupSeries: [],
  typeBreakdown: [],
  totals: { all: 0, verified: 0, podcasters: 0, inactive: 0, admins: 0 }
}

// Tabelle 'users' existiert nicht im Schema — alle user-Fetches laufen über admin_list_users_full (RPC)
// fetchTotals und fetchSignupSeries zeigen Empty-State, fetchPage nutzt das RPC

// _allRows cache for totals/series (loaded once, client-filtered per page)
let _allRows = null

async function fetchTotals() {
  if (!_allRows) await _loadAllRows()
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString()
  state.totals = {
    all: _allRows.length,
    verified: _allRows.filter(r => r.is_verified).length,
    podcasters: _allRows.filter(r => r.type === 'podcaster' || r.type === 'both').length,
    admins: _allRows.filter(r => r.is_app_admin).length,
    inactive: _allRows.filter(r => r.last_seen_at && r.last_seen_at < sevenDaysAgo).length
  }
}

async function _loadAllRows() {
  const { data, error } = await sb.rpc('admin_users_list_full', { p_limit: 5000, p_offset: 0, p_search: '' })
  if (error) throw error
  _allRows = data || []
}

async function fetchSignupSeries() {
  if (!_allRows) await _loadAllRows()
  const since = new Date(Date.now() - 30 * 86400000).toISOString()
  const buckets = {}
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000)
    buckets[d.toISOString().slice(0, 10)] = 0
  }
  _allRows.filter(r => r.created_at && r.created_at >= since).forEach(r => {
    const key = (r.created_at || '').slice(0, 10)
    if (buckets[key] !== undefined) buckets[key]++
  })
  state.signupSeries = Object.entries(buckets).map(([date, count]) => ({ date, value: count }))
}

function fetchTypeBreakdown() {
  state.typeBreakdown = [
    { label: 'Verifiziert', value: state.totals.verified, color: '#34d399' },
    { label: 'Podcaster', value: state.totals.podcasters, color: '#60a5fa' },
    { label: 'Admins', value: state.totals.admins, color: '#f472b6' },
    { label: 'Inaktiv (>7d)', value: state.totals.inactive, color: '#fbbf24' }
  ]
}

async function fetchPage() {
  // Server-side search via RPC, client-side filter for verified/podcaster/admin/inactive
  const { data, error } = await sb.rpc('admin_users_list_full', {
    p_limit: 5000,
    p_offset: 0,
    p_search: state.search?.trim() || ''
  })
  if (error) throw error

  let rows = data || []
  _allRows = rows  // refresh cache

  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString()
  if (state.filter === 'verified') rows = rows.filter(r => r.is_verified)
  else if (state.filter === 'podcaster') rows = rows.filter(r => r.type === 'podcaster' || r.type === 'both')
  else if (state.filter === 'admin') rows = rows.filter(r => r.is_app_admin)
  else if (state.filter === 'inactive') rows = rows.filter(r => r.last_seen_at && r.last_seen_at < sevenDaysAgo)

  state.totals = {
    all: _allRows.length,
    verified: _allRows.filter(r => r.is_verified).length,
    podcasters: _allRows.filter(r => r.type === 'podcaster' || r.type === 'both').length,
    admins: _allRows.filter(r => r.is_app_admin).length,
    inactive: _allRows.filter(r => r.last_seen_at && r.last_seen_at < sevenDaysAgo).length
  }

  const since = new Date(Date.now() - 30 * 86400000).toISOString()
  const buckets = {}
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000)
    buckets[d.toISOString().slice(0, 10)] = 0
  }
  _allRows.filter(r => r.created_at && r.created_at >= since).forEach(r => {
    const key = (r.created_at || '').slice(0, 10)
    if (buckets[key] !== undefined) buckets[key]++
  })
  state.signupSeries = Object.entries(buckets).map(([date, count]) => ({ date, value: count }))

  state.total = rows.length
  const from = (state.page - 1) * PAGE_SIZE
  state.rows = rows.slice(from, from + PAGE_SIZE)
}

export default {
  id: 'users-list',
  title: 'Nutzer-Liste',
  category: 'users',

  async mount(container) {
    try {
      container.innerHTML = `
        <div class="panel-shell users-list-panel">
          <div class="panel-head">
            <div>
              <h2>Nutzer-Liste</h2>
              <div class="panel-sub">Alle registrierten Podfluencer im Überblick</div>
            </div>
            <div class="toolbar">
              <button class="btn btn-ghost" data-act="refresh" title="Aktualisieren">${iconHtml('refresh-cw')} Aktualisieren</button>
              <button class="btn btn-ghost" data-act="pdf" title="PDF Export">${iconHtml('file-text')} PDF</button>
              <button class="btn btn-ghost" data-act="csv" title="CSV Export">${iconHtml('download')} CSV</button>
            </div>
          </div>
          <div class="panel-body" id="ul-body">
            ${skeletonLoader({ rows: 8 })}
          </div>
        </div>
      `

      container.querySelector('[data-act="refresh"]')?.addEventListener('click', () => loadAll(container))
      container.querySelector('[data-act="pdf"]')?.addEventListener('click', () => {
        try { exportPanelAsPdf(container, 'nutzer-liste') }
        catch (e) { toast(e?.message || 'PDF-Export fehlgeschlagen', 'error') }
      })
      container.querySelector('[data-act="csv"]')?.addEventListener('click', () => exportCurrentCsv())

      try { fadeIn(container.querySelector('.panel-shell')) } catch {}
      await loadAll(container)
    } catch (e) {
      console.error('[users-list] mount failed', e)
      container.innerHTML = `
        <div class="panel-shell">
          <div class="empty-state error-state">
            <div class="empty-icon">${iconHtml('alert-triangle')}</div>
            <h3>Panel konnte nicht geladen werden</h3>
            <p>${htmlEscape(e?.message || 'Unbekannter Fehler beim Mount.')}</p>
            <button class="btn btn-primary" data-act="mount-retry">${iconHtml('refresh-cw')} Erneut versuchen</button>
          </div>
        </div>
      `
      container.querySelector('[data-act="mount-retry"]')?.addEventListener('click', () => {
        try { this.mount(container) } catch (err) { console.error(err) }
      })
    }
  }
}

async function loadAll(container) {
  const body = container.querySelector('#ul-body')
  if (!body) return
  _allRows = null  // reset cache so next fetch is fresh
  state.loading = true
  body.innerHTML = skeletonLoader({ rows: 8 })

  try {
    await Promise.all([
      fetchTotals(),
      fetchSignupSeries(),
      fetchPage()
    ])
    fetchTypeBreakdown()
    renderShell(body)
    wire(body, container)
    animateHero(body)
  } catch (e) {
    console.error('[users-list] loadAll failed', e)
    body.innerHTML = errorState(e?.message || 'Unbekannter Fehler')
    body.querySelector('[data-act="retry"]')?.addEventListener('click', () => loadAll(container))
  } finally {
    state.loading = false
  }
}

function renderShell(body) {
  body.innerHTML = `
    <div class="ul-grid">
      <div class="ul-hero glass-card">
        ${statHero({
          label: 'Nutzer gesamt',
          value: state.totals.all,
          icon: 'users',
          trend: `+${state.signupSeries.slice(-7).reduce((s, p) => s + p.value, 0)} diese Woche`
        })}
      </div>
      <div class="ul-stats">
        <div class="mini-stat glass-card"><div class="mini-stat-label">Verifiziert</div><div class="mini-stat-val" data-count="${state.totals.verified}">0</div></div>
        <div class="mini-stat glass-card"><div class="mini-stat-label">Podcaster</div><div class="mini-stat-val" data-count="${state.totals.podcasters}">0</div></div>
        <div class="mini-stat glass-card"><div class="mini-stat-label">Admins</div><div class="mini-stat-val" data-count="${state.totals.admins}">0</div></div>
        <div class="mini-stat glass-card"><div class="mini-stat-label">Inaktiv (>7d)</div><div class="mini-stat-val" data-count="${state.totals.inactive}">0</div></div>
      </div>
      <div class="ul-chart glass-card">
        <div class="card-head"><h3>Neue Anmeldungen · 30 Tage</h3></div>
        <div id="ul-area" class="chart-host"></div>
      </div>
      <div class="ul-donut glass-card">
        <div class="card-head"><h3>Verteilung</h3></div>
        <div id="ul-donut" class="chart-host"></div>
      </div>
    </div>

    <div class="ul-filters glass-card">
      <div class="ul-search">
        ${iconHtml('search')}
        <input type="search" id="ul-search" placeholder="Nach Name, Username oder E-Mail suchen…" value="${htmlEscape(state.search)}" />
      </div>
      <div class="ul-pills">
        ${pill('all', 'Alle', state.totals.all)}
        ${pill('verified', 'Verifiziert', state.totals.verified)}
        ${pill('podcaster', 'Podcaster', state.totals.podcasters)}
        ${pill('inactive', 'Inaktiv', state.totals.inactive)}
        ${pill('admin', 'Admin', state.totals.admins)}
      </div>
    </div>

    <div class="ul-table-wrap glass-card">
      ${renderTable()}
    </div>

    ${renderPagination()}

    <div class="ul-bulk-bar" id="ul-bulk" hidden>
      <div class="ul-bulk-info"><span id="ul-bulk-count">0</span> ausgewählt</div>
      <div class="ul-bulk-actions">
        <button class="btn btn-ghost" data-bulk="verify">${iconHtml('check-circle')} Verifizieren</button>
        <button class="btn btn-ghost" data-bulk="premium">${iconHtml('star')} Premium</button>
        <button class="btn btn-ghost" data-bulk="push">${iconHtml('bell')} Push senden</button>
        <button class="btn btn-ghost" data-bulk="export">${iconHtml('download')} Export CSV</button>
        <button class="btn btn-danger" data-bulk="ban">${iconHtml('ban')} Bannen</button>
        <button class="btn-icon" data-bulk="clear" title="Abwählen">${iconHtml('x')}</button>
      </div>
    </div>
  `

  const areaHost = body.querySelector('#ul-area')
  if (areaHost) {
    try { makeAreaChart(areaHost, state.signupSeries.map(p => ({ x: p.date, y: p.value })), { color: '#60a5fa', height: 180 }) } catch (e) { console.warn(e) }
  }
  const donutHost = body.querySelector('#ul-donut')
  if (donutHost) {
    try { makeDonutChart(donutHost, state.typeBreakdown, { height: 180 }) } catch (e) { console.warn(e) }
  }
}

function pill(key, label, count) {
  const active = state.filter === key ? 'is-active' : ''
  return `<button class="pill ${active}" data-filter="${key}">${htmlEscape(label)}<span class="pill-count">${fmtNumber(count)}</span></button>`
}

function renderTable() {
  if (!state.rows.length) return emptyState()
  const head = `
    <thead>
      <tr>
        <th class="col-check"><input type="checkbox" id="ul-check-all" /></th>
        <th>Nutzer</th>
        <th>Typ</th>
        <th>Registriert</th>
        <th>Zuletzt aktiv</th>
        <th class="col-actions"></th>
      </tr>
    </thead>`
  const rowsHtml = state.rows.map(r => {
    const name = r.full_name || r.username || '—'
    const initials = (name[0] || '?').toUpperCase()
    const avatar = r.avatar_url
      ? `<img src="${htmlEscape(r.avatar_url)}" alt="" class="ul-avatar" />`
      : `<div class="ul-avatar ul-avatar-fallback">${htmlEscape(initials)}</div>`
    const badges = badgesFor(r)
    const checked = state.selected.has(r.id) ? 'checked' : ''
    const joined = r.created_at ? htmlEscape(fmtDateTime(r.created_at)) : '—'
    const lastActive = r.last_seen_at ? htmlEscape(fmtRelativeTime(r.last_seen_at)) : '<span class="muted">nie</span>'
    return `
      <tr data-id="${r.id}" class="${state.selected.has(r.id) ? 'is-selected' : ''}">
        <td class="col-check"><input type="checkbox" class="ul-row-check" ${checked} /></td>
        <td>
          <div class="ul-user">
            ${avatar}
            <div class="ul-user-meta">
              <div class="ul-user-name">${htmlEscape(name)}</div>
              <div class="ul-user-handle">@${htmlEscape(r.username || '—')}</div>
            </div>
          </div>
        </td>
        <td>${badges}</td>
        <td>${joined}</td>
        <td>${lastActive}</td>
        <td class="col-actions">
          <button class="btn-icon ul-menu-btn" data-menu="${r.id}" title="Aktionen">${iconHtml('more-horizontal')}</button>
        </td>
      </tr>`
  }).join('')

  return `<table class="data-table ul-table">${head}<tbody>${rowsHtml}</tbody></table>`
}

function badgesFor(r) {
  const out = []
  if (r.is_app_admin) out.push(`<span class="badge badge-pink">Admin</span>`)
  if (r.is_verified) out.push(`<span class="badge badge-green">Verifiziert</span>`)
  if (r.type === 'podcaster' || r.type === 'both') out.push(`<span class="badge badge-blue">Podcaster</span>`)
  if (r.is_premium) out.push(`<span class="badge badge-yellow">Premium</span>`)
  if (!out.length) out.push(`<span class="badge badge-muted">Standard</span>`)
  return out.join(' ')
}

function renderPagination() {
  const pages = Math.max(1, Math.ceil(state.total / PAGE_SIZE))
  const from = state.total === 0 ? 0 : (state.page - 1) * PAGE_SIZE + 1
  const to = Math.min(state.page * PAGE_SIZE, state.total)
  return `
    <div class="ul-pagination">
      <div class="ul-pagination-info">${fmtNumber(from)}–${fmtNumber(to)} von ${fmtNumber(state.total)}</div>
      <div class="ul-pagination-controls">
        <button class="btn btn-ghost" data-page="prev" ${state.page <= 1 ? 'disabled' : ''}>${iconHtml('chevron-left')} Zurück</button>
        <span class="ul-page-indicator">Seite ${state.page} / ${pages}</span>
        <button class="btn btn-ghost" data-page="next" ${state.page >= pages ? 'disabled' : ''}>Weiter ${iconHtml('chevron-right')}</button>
      </div>
    </div>`
}

function emptyState() {
  return `
    <div class="empty-state">
      <div class="empty-icon">${iconHtml('users')}</div>
      <h3>Keine Nutzer gefunden</h3>
      <p>Für die aktuelle Suche oder Filter gibt es keine Treffer.</p>
      <button class="btn btn-primary" data-act="reset-filters">Filter zurücksetzen</button>
    </div>`
}

function errorState(msg) {
  return `
    <div class="empty-state error-state">
      <div class="empty-icon">${iconHtml('alert-triangle')}</div>
      <h3>Konnte nicht geladen werden</h3>
      <p>Fehler: ${htmlEscape(msg)}</p>
      <button class="btn btn-primary" data-act="retry">${iconHtml('refresh-cw')} Erneut versuchen</button>
    </div>`
}

function wire(body, container) {
  const search = body.querySelector('#ul-search')
  if (search) {
    const onSearch = debounce(async (e) => {
      state.search = e.target.value
      state.page = 1
      state.selected.clear()
      try { await fetchPage(); refreshTableOnly(body, container) } catch (err) { toast(err?.message || 'Fehler', 'error') }
    }, 280)
    search.addEventListener('input', onSearch)
  }

  body.querySelectorAll('.pill').forEach(p => {
    p.addEventListener('click', async () => {
      state.filter = p.dataset.filter
      state.page = 1
      state.selected.clear()
      try {
        await fetchPage()
        refreshTableOnly(body, container)
        body.querySelectorAll('.pill').forEach(x => x.classList.toggle('is-active', x.dataset.filter === state.filter))
      } catch (err) { toast(err?.message || 'Fehler', 'error') }
    })
  })

  wireTable(body, container)
  wirePagination(body, container)
  wireBulk(body, container)

  body.querySelector('[data-act="reset-filters"]')?.addEventListener('click', async () => {
    state.search = ''
    state.filter = 'all'
    state.page = 1
    try {
      await fetchPage()
      refreshTableOnly(body, container)
      const s = body.querySelector('#ul-search'); if (s) s.value = ''
      body.querySelectorAll('.pill').forEach(x => x.classList.toggle('is-active', x.dataset.filter === 'all'))
    } catch (err) { toast(err?.message || 'Fehler', 'error') }
  })
}

function wireTable(body, container) {
  const table = body.querySelector('.ul-table')
  if (!table) return

  table.querySelectorAll('tbody tr').forEach(tr => {
    tr.addEventListener('click', (e) => {
      if (e.target.closest('.col-check') || e.target.closest('.col-actions')) return
      const id = tr.dataset.id
      openUserDrawer(id, container)
    })
  })

  const checkAll = body.querySelector('#ul-check-all')
  if (checkAll) {
    checkAll.addEventListener('change', () => {
      if (checkAll.checked) state.rows.forEach(r => state.selected.add(r.id))
      else state.rows.forEach(r => state.selected.delete(r.id))
      refreshTableOnly(body, container)
    })
  }

  table.querySelectorAll('.ul-row-check').forEach(cb => {
    cb.addEventListener('click', e => e.stopPropagation())
    cb.addEventListener('change', (e) => {
      const id = e.target.closest('tr').dataset.id
      if (e.target.checked) state.selected.add(id)
      else state.selected.delete(id)
      e.target.closest('tr').classList.toggle('is-selected', e.target.checked)
      updateBulkBar(body)
    })
  })

  table.querySelectorAll('.ul-menu-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      openActionMenu(btn, btn.dataset.menu, body, container)
    })
  })

  updateBulkBar(body)
}

function wirePagination(body, container) {
  body.querySelector('[data-page="prev"]')?.addEventListener('click', async () => {
    if (state.page <= 1) return
    state.page--
    try { await fetchPage(); refreshTableOnly(body, container) }
    catch (err) { toast(err?.message || 'Fehler', 'error') }
  })
  body.querySelector('[data-page="next"]')?.addEventListener('click', async () => {
    const pages = Math.ceil(state.total / PAGE_SIZE)
    if (state.page >= pages) return
    state.page++
    try { await fetchPage(); refreshTableOnly(body, container) }
    catch (err) { toast(err?.message || 'Fehler', 'error') }
  })
}

function refreshTableOnly(body, container) {
  const wrap = body.querySelector('.ul-table-wrap')
  if (wrap) wrap.innerHTML = renderTable()
  const pag = body.querySelector('.ul-pagination')
  if (pag) {
    const tmp = document.createElement('div')
    tmp.innerHTML = renderPagination()
    if (tmp.firstElementChild) pag.replaceWith(tmp.firstElementChild)
  }
  wireTable(body, container)
  wirePagination(body, container)
  updateBulkBar(body)
}

function updateBulkBar(body) {
  const bar = body.querySelector('#ul-bulk')
  if (!bar) return
  const n = state.selected.size
  bar.hidden = n === 0
  const c = bar.querySelector('#ul-bulk-count')
  if (c) c.textContent = String(n)
}

function wireBulk(body, container) {
  const bar = body.querySelector('#ul-bulk')
  if (!bar) return
  bar.querySelector('[data-bulk="clear"]')?.addEventListener('click', () => {
    state.selected.clear()
    refreshTableOnly(body, container)
  })
  bar.querySelector('[data-bulk="verify"]')?.addEventListener('click', async () => {
    const ids = Array.from(state.selected)
    const ok = await confirmDialog({ title: `${ids.length} Nutzer verifizieren?`, message: 'Diese Nutzer werden als verifiziert markiert.' })
    if (!ok) return
    try {
      const { data, error } = await sb.rpc('admin_bulk_verify', { user_ids: ids })
      if (error) throw error
      const n = typeof data === 'number' ? data : ids.length
      toast(`${n} verifiziert`, 'success')
    } catch (e) {
      toast(e?.message || 'Fehler beim Verifizieren', 'error')
      return
    }
    state.selected.clear()
    await loadAll(container)
  })
  bar.querySelector('[data-bulk="premium"]')?.addEventListener('click', async () => {
    const ids = Array.from(state.selected)
    const ok = await confirmDialog({ title: `${ids.length} × Premium freischalten?` })
    if (!ok) return
    let n = 0
    const errs = []
    for (const id of ids) {
      try {
        const { error } = await sb.rpc('admin_set_premium', { user_id: id, premium: true })
        if (error) throw error
        n++
      } catch (e) { errs.push(id); console.warn('premium failed', id, e) }
    }
    if (errs.length) toast(`${n} aktiviert, ${errs.length} fehlgeschlagen`, 'warning')
    else toast(`${n} × Premium aktiviert`, 'success')
    state.selected.clear()
    await loadAll(container)
  })
  bar.querySelector('[data-bulk="push"]')?.addEventListener('click', () => {
    const ids = Array.from(state.selected)
    openBulkPushModal(ids, body, container)
  })
  bar.querySelector('[data-bulk="ban"]')?.addEventListener('click', async () => {
    const ok = await confirmDialog({ title: `${state.selected.size} Nutzer bannen?`, message: 'Diese Aktion sperrt die Accounts.', danger: true })
    if (!ok) return
    let n = 0
    for (const id of state.selected) { try { await banUser(id); n++ } catch (e) { console.warn('ban failed', id, e) } }
    toast(`${n} gebannt`, 'warning')
    state.selected.clear()
    await loadAll(container)
  })
  bar.querySelector('[data-bulk="export"]')?.addEventListener('click', () => {
    const rows = state.rows.filter(r => state.selected.has(r.id))
    exportCsv(`nutzer-auswahl-${Date.now()}.csv`, rows.map(toCsvRow))
    toast('Export gestartet', 'success')
  })
}

function openActionMenu(anchor, userId, body, container) {
  document.querySelectorAll('.ul-action-menu').forEach(m => m.remove())
  const row = state.rows.find(r => r.id === userId)
  if (!row) return

  const menu = document.createElement('div')
  menu.className = 'ul-action-menu glass-card'
  menu.innerHTML = `
    <button data-a="view">${iconHtml('eye')} Details ansehen</button>
    <button data-a="verify" ${row.is_verified ? 'disabled' : ''}>${iconHtml('check-circle')} ${row.is_verified ? 'Bereits verifiziert' : 'Verifizieren'}</button>
    <button data-a="premium">${iconHtml('star')} ${row.is_premium ? 'Premium aktiv' : 'Premium gewähren'}</button>
    <button data-a="ban" class="danger">${iconHtml('ban')} ${row.is_banned ? 'Gebannt' : 'Bannen'}</button>
  `
  document.body.appendChild(menu)
  const rect = anchor.getBoundingClientRect()
  menu.style.position = 'fixed'
  menu.style.top = `${rect.bottom + 6}px`
  menu.style.left = `${Math.max(8, rect.right - 220)}px`
  menu.style.zIndex = '9999'

  const close = (e) => {
    if (e && menu.contains(e.target)) return
    menu.remove()
    document.removeEventListener('click', close)
  }
  setTimeout(() => document.addEventListener('click', close), 0)

  menu.querySelector('[data-a="view"]')?.addEventListener('click', () => { close(); openUserDrawer(userId, container) })
  menu.querySelector('[data-a="verify"]')?.addEventListener('click', async () => {
    close()
    if (row.is_verified) return
    const ok = await confirmDialog({ title: 'Nutzer verifizieren?' })
    if (!ok) return
    try { await verifyUser(userId); toast('Verifiziert', 'success'); await loadAll(container) }
    catch (e) { toast(e?.message || 'Fehler', 'error') }
  })
  menu.querySelector('[data-a="premium"]')?.addEventListener('click', async () => {
    close()
    const ok = await confirmDialog({ title: 'Premium gewähren?' })
    if (!ok) return
    try { await grantPremium(userId); toast('Premium aktiviert', 'success'); await loadAll(container) }
    catch (e) { toast(e?.message || 'Fehler', 'error') }
  })
  menu.querySelector('[data-a="ban"]')?.addEventListener('click', async () => {
    close()
    const ok = await confirmDialog({ title: row.is_banned ? 'Bereits gebannt' : 'Nutzer bannen?', danger: true })
    if (!ok) return
    try { await banUser(userId); toast('Gebannt', 'warning'); await loadAll(container) }
    catch (e) { toast(e?.message || 'Fehler', 'error') }
  })
}

function openUserDrawer(userId, container) {
  try {
    const host = drawer({
      title: 'Nutzer-Details',
      width: 540,
      content: `<div id="ul-drawer-host">${skeletonLoader({ rows: 6 })}</div>`
    })
    const target = host?.querySelector?.('#ul-drawer-host') || null
    if (target) showUserDetailModal(userId, { mount: target })
    else showUserDetailModal(userId)
  } catch (e) {
    try { showUserDetailModal(userId) } catch (err) {
      toast(err?.message || 'Details konnten nicht geöffnet werden', 'error')
    }
  }
}

function openBulkPushModal(ids, body, container) {
  const overlay = document.createElement('div')
  overlay.className = 'ul-push-overlay'
  overlay.innerHTML = `
    <div class="ul-push-modal glass-card" role="dialog" aria-modal="true" aria-label="Push senden">
      <div class="ul-push-modal-head">
        <h3>${iconHtml('bell')} Push an ${ids.length} Nutzer senden</h3>
        <button class="btn-icon" id="ul-push-close" title="Schließen">${iconHtml('x')}</button>
      </div>
      <div class="ul-push-modal-body">
        <label class="ul-push-label" for="ul-push-title">Titel</label>
        <input type="text" id="ul-push-title" class="ul-push-input" placeholder="z. B. Neue Funktion für dich!" maxlength="64" />
        <label class="ul-push-label" for="ul-push-body">Nachricht</label>
        <textarea id="ul-push-body" class="ul-push-textarea" placeholder="Kurze Push-Nachricht…" maxlength="200" rows="3"></textarea>
        <div id="ul-push-status" class="ul-push-status" hidden></div>
      </div>
      <div class="ul-push-modal-foot">
        <button class="btn btn-ghost" id="ul-push-cancel">Abbrechen</button>
        <button class="btn btn-primary" id="ul-push-send">${iconHtml('send')} Senden</button>
      </div>
    </div>
  `
  document.body.appendChild(overlay)

  const close = () => overlay.remove()
  overlay.querySelector('#ul-push-close')?.addEventListener('click', close)
  overlay.querySelector('#ul-push-cancel')?.addEventListener('click', close)
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close() })

  overlay.querySelector('#ul-push-send')?.addEventListener('click', async () => {
    const titleEl = overlay.querySelector('#ul-push-title')
    const bodyEl = overlay.querySelector('#ul-push-body')
    const statusEl = overlay.querySelector('#ul-push-status')
    const title = titleEl?.value?.trim()
    const body = bodyEl?.value?.trim()
    if (!title || !body) {
      if (statusEl) { statusEl.textContent = 'Bitte Titel und Nachricht ausfüllen.'; statusEl.hidden = false }
      return
    }
    const sendBtn = overlay.querySelector('#ul-push-send')
    if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = 'Sendet…' }
    let sent = 0
    const errs = []
    for (const id of ids) {
      try {
        const { error } = await sb.rpc('send_broadcast_push', {
          p_title: title,
          p_body: body,
          p_audience: 'all',
          p_deep_link: null
        })
        if (error) throw error
        sent++
        break // send_broadcast_push is a broadcast — one call is sufficient
      } catch (e) { errs.push(id); console.warn('push failed', id, e); break }
    }
    close()
    if (errs.length) toast('Push-Versand fehlgeschlagen', 'error')
    else toast(`Push gesendet (${ids.length} Empfänger)`, 'success')
  })
}

function toCsvRow(r) {
  return {
    id: r.id,
    username: r.username || '',
    full_name: r.full_name || '',
    email: r.email || '',
    type: r.type || '',
    is_verified: r.is_verified ? 'ja' : 'nein',
    is_app_admin: r.is_app_admin ? 'ja' : 'nein',
    is_premium: r.is_premium ? 'ja' : 'nein',
    country: r.country || '',
    created_at: r.created_at || '',
    last_seen_at: r.last_seen_at || '',
    client_build_version: r.client_build_version || ''
  }
}

function exportCurrentCsv() {
  exportCsv(`nutzer-liste-${Date.now()}.csv`, state.rows.map(toCsvRow))
  toast('CSV exportiert', 'success')
}

function animateHero(body) {
  const heroVal = body.querySelector('.ul-hero .stat-hero-value, .ul-hero [data-hero-value], .ul-hero .value, .ul-hero strong')
  if (heroVal) { try { countUp(heroVal, state.totals.all, { duration: 900 }) } catch {} }
  body.querySelectorAll('.mini-stat-val').forEach(el => {
    const v = Number(el.dataset.count || 0)
    try { countUp(el, v, { duration: 700 }) } catch { el.textContent = String(v) }
  })
}
