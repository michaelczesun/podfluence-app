import { sb } from '/lib/supabase.js?v=20260608i'
import { toast, confirmDialog, fmtNumber, fmtDateTime, fmtRelativeTime, htmlEscape, iconHtml, debounce } from '/lib/ui.js?v=20260608i'
import { makeAreaChart, makeDonutChart } from '/lib/charts.js?v=20260608i'
import { exportPanelAsPdf, exportCsv } from '/lib/export.js?v=20260608i'
import { countUp, fadeIn } from '/lib/animations.js?v=20260608i'
import { drawer, statHero } from '/lib/layout-extras.js?v=20260608i'
// FIX #6: added unverifyUser import; FIX #7: added unbanUser import
import { showUserDetailModal, verifyUser, unverifyUser, banUser, unbanUser, grantPremium } from '/lib/panel-actions.js?v=20260608i'

const PAGE_SIZE = 50

// Bug #8: Test-Account-Filter — Apple Reviewer & reviewbot per Default ausblenden,
// per Toggle ein-/ausblendbar, Status in localStorage.
const TEST_ACCOUNT_USERNAMES = ['applereview', 'reviewbot']
const TEST_ACCOUNT_EMAIL_PATTERNS = [/@apple\.com$/i]
function isTestAccount(r) {
  if (!r) return false
  const u = (r.username || '').toLowerCase()
  if (TEST_ACCOUNT_USERNAMES.includes(u)) return true
  const email = (r.email || '').toLowerCase()
  if (email && TEST_ACCOUNT_EMAIL_PATTERNS.some(re => re.test(email))) return true
  return false
}
function readShowTestAccounts() {
  try { return localStorage.getItem('crm.showTestAccounts') === '1' } catch { return false }
}
function writeShowTestAccounts(v) {
  try { localStorage.setItem('crm.showTestAccounts', v ? '1' : '0') } catch {}
}

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
  totals: { all: 0, verified: 0, podcasters: 0, inactive: 0, admins: 0 },
  filterBuilder: {}, // E-Feature: type/verified/premium/country/createdFrom/createdTo
  showTestAccounts: readShowTestAccounts(), // Bug #8: Default = false
  testAccountCount: 0
}

// Tabelle 'users' existiert nicht im Schema — alle user-Fetches laufen über admin_users_list_full (RPC)
// fetchTotals und fetchSignupSeries zeigen Empty-State, fetchPage nutzt das RPC

// _allRows cache for totals/series (loaded once, client-filtered per page)
let _allRows = null
// FIX #1: in-flight promise guard to prevent duplicate concurrent RPC calls
let _allRowsInflight = null

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
  // FIX #1: if a fetch is already in flight, wait for it instead of issuing a second RPC call
  if (_allRowsInflight) {
    await _allRowsInflight
    return
  }
  _allRowsInflight = (async () => {
    const { data, error } = await sb.rpc('admin_users_list_full', { p_limit: 5000, p_offset: 0, p_search: '' })
    if (error) throw error
    _allRows = data || []
    // FIX #5: warn admin if result may be truncated at 5000
    if (_allRows.length === 5000) {
      toast('Hinweis: Ergebnis bei 5.000 Nutzern abgeschnitten. Ggf. nicht alle Nutzer sichtbar.', 'warning')
    }
  })()
  try {
    await _allRowsInflight
  } finally {
    _allRowsInflight = null
  }
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
  // FILTER-BUILDER: nutzt admin_users_list_filtered RPC mit Multi-Kriterien.
  const f = state.filterBuilder || {}
  let rows = []
  let res = await sb.rpc('admin_users_list_filtered', {
    p_limit: 5000, p_offset: 0,
    p_search: state.search?.trim() || null,
    p_type: f.type || null,
    p_verified: typeof f.verified === 'boolean' ? f.verified : null,
    p_premium: typeof f.premium === 'boolean' ? f.premium : null,
    p_country: f.country || null,
    p_created_from: f.createdFrom || null,
    p_created_to: f.createdTo || null,
  })
  if (res.error) {
    // Fallback auf alte RPC falls die neue noch nicht im Schema-Cache
    res = await sb.rpc('admin_users_list_full', {
      p_limit: 5000, p_offset: 0, p_search: state.search?.trim() || ''
    })
    if (res.error) throw res.error
  }
  rows = res.data || []
  _allRows = rows
  if (rows.length === 5000) toast('Hinweis: Ergebnis bei 5.000 Nutzern abgeschnitten.', 'warning')

  // Bug #8: Test-Accounts ausfiltern, wenn Toggle nicht aktiv
  state.testAccountCount = _allRows.filter(isTestAccount).length
  if (!state.showTestAccounts) {
    rows = rows.filter(r => !isTestAccount(r))
  }

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
        <style>
          .ul-fbuilder { display:flex; gap:6px; flex-wrap:wrap; margin-top:10px; }
          .ul-fbuilder select, .ul-fbuilder input { padding:6px 8px; border-radius:7px; border:1px solid var(--border, rgba(255,255,255,0.08)); background:var(--surface-elev, rgba(255,255,255,0.04)); color:inherit; font-size:12px; }
          .ul-inline-actions { display:flex; gap:4px; align-items:center; justify-content:flex-end; }
          .btn-pill { width:30px; height:30px; border-radius:8px; border:1px solid var(--border, rgba(255,255,255,0.08)); background:var(--surface-elev, rgba(255,255,255,0.04)); color:#aaa; cursor:pointer; font-size:13px; padding:0; display:inline-flex; align-items:center; justify-content:center; transition:all .15s; }
          .btn-pill:hover { background:var(--surface-elev-2, rgba(255,255,255,0.1)); transform:translateY(-1px); }
          .btn-pill.on { background:rgba(34,197,94,0.18); color:#22c55e; border-color:rgba(34,197,94,0.4); }
          .btn-pill.on.yellow { background:rgba(245,158,11,0.18); color:#F59E0B; border-color:rgba(245,158,11,0.4); }
          .btn-pill.red { color:#f87171; }
          .btn-pill.red:hover { background:rgba(239,68,68,0.18); border-color:rgba(239,68,68,0.4); }
          .btn-pill.orange { color:#fb923c; }
          .btn-pill.orange:hover { background:rgba(251,146,60,0.18); border-color:rgba(251,146,60,0.4); }
          .btn-pill:disabled { opacity:0.4; cursor:wait; }

          /* SWIPE-ACTIONS */
          .ul-table tbody tr[data-swipe-ready="1"] { position:relative; will-change:transform; }
          .ul-table tbody tr[data-swipe-ready="1"]::before,
          .ul-table tbody tr[data-swipe-ready="1"]::after {
            content:''; position:absolute; top:0; bottom:0; width:120px;
            display:flex; align-items:center; justify-content:center;
            font-weight:600; font-size:13px; letter-spacing:.02em;
            pointer-events:none; opacity:0; transition:opacity .15s ease;
            z-index:-1;
          }
          .ul-table tbody tr[data-swipe-ready="1"]::before {
            left:0;
            content:'+ Notiz';
            background:linear-gradient(90deg, rgba(96,165,250,.28), rgba(96,165,250,.05));
            color:#60a5fa;
            padding-left:18px; justify-content:flex-start;
          }
          .ul-table tbody tr[data-swipe-ready="1"]::after {
            right:0;
            content:'✓ Verify';
            background:linear-gradient(270deg, rgba(34,197,94,.28), rgba(34,197,94,.05));
            color:#22c55e;
            padding-right:18px; justify-content:flex-end;
          }
          .ul-table tbody tr[data-swipe-dir="right"]::before { opacity:1; }
          .ul-table tbody tr[data-swipe-dir="left"]::after  { opacity:1; }
          .ul-table tbody tr[data-swipe-armed="1"][data-swipe-dir="right"]::before,
          .ul-table tbody tr[data-swipe-armed="1"][data-swipe-dir="left"]::after {
            filter:brightness(1.25);
          }
        </style>
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
            <div class="pf-skeleton" style="width:100%;height:320px;"></div>
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

      // FEATURE C: Realtime — neue/geänderte User live nachziehen.
      let rtCh = null
      try {
        // FIX: realtime debounce auf 2500ms erhöht — User-Tabelle ändert sich oft (last_seen_at),
        // jedes Event triggerte ein full RPC-Reload und machte das Panel träge.
        rtCh = sb.channel('users-list-live')
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'users' }, () => {
            clearTimeout(window.__ulRtTimer)
            window.__ulRtTimer = setTimeout(() => { loadAll(container).catch(() => {}) }, 2500)
          })
          .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'users' }, () => {
            clearTimeout(window.__ulRtTimer)
            window.__ulRtTimer = setTimeout(() => { loadAll(container).catch(() => {}) }, 2500)
          })
          .subscribe()
      } catch (_) {}
      // Container destruktor merken damit Channel beim Panel-Wechsel weggeht
      container.__cleanup = () => { if (rtCh) try { sb.removeChannel(rtCh) } catch (_) {} }
      return container.__cleanup
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
  // FIX #1: pre-load _allRows ONCE before Promise.all to prevent triple concurrent RPC calls
  _allRows = null
  _allRowsInflight = null
  state.loading = true
  body.innerHTML = '<div class="pf-skeleton" style="width:100%;height:320px;"></div>'

  try {
    await _loadAllRows()  // single fetch — all three helpers will reuse the cache
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
          icon: iconHtml('users'),
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
      <div class="ul-fbuilder">
        <select id="fb-type"><option value="">Typ: Alle</option><option value="listener" ${state.filterBuilder.type==='listener'?'selected':''}>Hörer</option><option value="podcaster" ${state.filterBuilder.type==='podcaster'?'selected':''}>Podcaster</option><option value="both" ${state.filterBuilder.type==='both'?'selected':''}>Beide</option></select>
        <select id="fb-verified"><option value="">Verifiziert: egal</option><option value="true" ${state.filterBuilder.verified===true?'selected':''}>Ja</option><option value="false" ${state.filterBuilder.verified===false?'selected':''}>Nein</option></select>
        <select id="fb-premium"><option value="">Premium: egal</option><option value="true" ${state.filterBuilder.premium===true?'selected':''}>Ja</option><option value="false" ${state.filterBuilder.premium===false?'selected':''}>Nein</option></select>
        <input id="fb-country" type="text" placeholder="Land (z.B. AT)" value="${htmlEscape(state.filterBuilder.country || '')}" style="width:100px" />
        <input id="fb-from" type="date" value="${(state.filterBuilder.createdFrom || '').slice(0,10)}" title="Registriert von" />
        <input id="fb-to" type="date" value="${(state.filterBuilder.createdTo || '').slice(0,10)}" title="Registriert bis" />
        <button id="fb-clear" class="btn-pill">Reset</button>
        <button id="fb-test-accounts" class="btn-pill ${state.showTestAccounts ? 'on' : ''}" title="${state.showTestAccounts ? 'Test-Accounts (Apple Reviewer) ausblenden' : 'Test-Accounts (Apple Reviewer) einblenden'}" style="width:auto;padding:0 10px;">👁 Test-Accounts${state.testAccountCount ? ` (${state.testAccountCount})` : ''}${state.showTestAccounts ? ' an' : ' aus'}</button>
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
    try {
      makeAreaChart(areaHost, {
        categories: state.signupSeries.map(p => p.date),
        series: [{ name: 'Anmeldungen', data: state.signupSeries.map(p => p.value) }],
        color: '#60a5fa',
        height: 180
      })
    } catch (e) { console.warn(e) }
  }
  const donutHost = body.querySelector('#ul-donut')
  if (donutHost) {
    try {
      makeDonutChart(donutHost, {
        labels: state.typeBreakdown.map(s => s.label),
        values: state.typeBreakdown.map(s => s.value),
        colors: state.typeBreakdown.map(s => s.color),
        height: 180
      })
    } catch (e) { console.warn(e) }
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
          <div class="ul-inline-actions">
            <button class="btn-pill ${r.is_verified ? 'on' : ''}" data-act="verify" data-uid="${r.id}" title="${r.is_verified ? 'Verifizierung entziehen' : 'Verifizieren'}">✓</button>
            <button class="btn-pill ${r.is_premium ? 'on yellow' : ''}" data-act="premium" data-uid="${r.id}" title="${r.is_premium ? 'Premium entziehen' : 'Premium vergeben'}">⭐</button>
            <button class="btn-pill red" data-act="ban" data-uid="${r.id}" title="Bannen">🚫</button>
            <button class="btn-pill orange" data-act="impersonate" data-uid="${r.id}" title="Als User ansehen">👁</button>
            <button class="btn-icon ul-menu-btn" data-menu="${r.id}" title="Mehr Aktionen">${iconHtml('more-horizontal')}</button>
          </div>
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
  const hasFilters = state.search || state.filter !== 'all' || Object.values(state.filterBuilder || {}).some(v => v !== null && v !== '' && v !== undefined)
  return `
    <div class="empty-state">
      <div class="empty-icon">${iconHtml('users')}</div>
      <h3>Keine Nutzer gefunden</h3>
      <p>${hasFilters
        ? 'Für die aktuelle Suche oder Filter-Kombination gibt es keine Treffer.'
        : 'Es sind aktuell keine Nutzer in der Datenbank vorhanden.'}</p>
      <p class="muted">${hasFilters
        ? 'Tipp: Setze die Filter zurück oder probiere einen kürzeren Suchbegriff.'
        : 'Sobald sich Nutzer registrieren, erscheinen sie hier automatisch.'}</p>
      ${hasFilters ? `<button class="btn btn-primary" data-act="reset-filters">${iconHtml('refresh-cw')} Filter zurücksetzen</button>` : ''}
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
      if (tr.__swipeMoved) { tr.__swipeMoved = false; return }
      const id = tr.dataset.id
      openUserDrawer(id, container)
    })
    attachSwipeActions(tr, body, container)
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

  // FEATURE D: Inline-Actions in der Row
  table.querySelectorAll('.ul-inline-actions [data-act]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation()
      const uid = btn.dataset.uid
      const act = btn.dataset.act
      btn.disabled = true
      try {
        const pa = await import('/lib/panel-actions.js')
        const row = state.rows.find(r => r.id === uid)
        if (act === 'verify') {
          if (row?.is_verified) await pa.unverifyUser(uid); else await pa.verifyUser(uid)
        } else if (act === 'premium') {
          if (row?.is_premium) await pa.revokePremium(uid); else await pa.grantPremium(uid)
        } else if (act === 'ban') {
          await pa.banUser(uid)
        } else if (act === 'impersonate') {
          await pa.impersonateUser(uid)
        }
        // Optimistic UI: nach Action neu laden
        if (act !== 'impersonate') {
          try { await fetchPage(); refreshTableOnly(body, container) } catch (_) {}
        }
      } catch (err) {
        toast(err?.message || 'Aktion fehlgeschlagen', 'error')
      } finally {
        btn.disabled = false
      }
    })
  })

  // FEATURE E: Filter-Builder
  const onFbChange = async () => {
    const tEl = body.querySelector('#fb-type')
    const vEl = body.querySelector('#fb-verified')
    const pEl = body.querySelector('#fb-premium')
    const cEl = body.querySelector('#fb-country')
    const fEl = body.querySelector('#fb-from')
    const dEl = body.querySelector('#fb-to')
    state.filterBuilder = {
      type: tEl?.value || null,
      verified: vEl?.value === 'true' ? true : vEl?.value === 'false' ? false : null,
      premium:  pEl?.value === 'true' ? true : pEl?.value === 'false' ? false : null,
      country: cEl?.value?.trim() || null,
      createdFrom: fEl?.value ? new Date(fEl.value).toISOString() : null,
      createdTo: dEl?.value ? new Date(dEl.value).toISOString() : null,
    }
    state.page = 1
    try { await fetchPage(); refreshTableOnly(body, container) }
    catch (err) { toast(err?.message || 'Filter-Fehler', 'error') }
  }
  body.querySelector('#fb-type')?.addEventListener('change', onFbChange)
  body.querySelector('#fb-verified')?.addEventListener('change', onFbChange)
  body.querySelector('#fb-premium')?.addEventListener('change', onFbChange)
  body.querySelector('#fb-country')?.addEventListener('change', onFbChange)
  body.querySelector('#fb-from')?.addEventListener('change', onFbChange)
  body.querySelector('#fb-to')?.addEventListener('change', onFbChange)
  // Bug #8: Toggle Test-Accounts (Apple Reviewer etc.) sichtbar/unsichtbar
  body.querySelector('#fb-test-accounts')?.addEventListener('click', async () => {
    state.showTestAccounts = !state.showTestAccounts
    writeShowTestAccounts(state.showTestAccounts)
    state.page = 1
    try { await fetchPage(); refreshTableOnly(body, container) } catch (_) {}
    // Toggle-Button-Label aktualisieren
    const btn = body.querySelector('#fb-test-accounts')
    if (btn) {
      btn.classList.toggle('on', state.showTestAccounts)
      btn.title = state.showTestAccounts ? 'Test-Accounts (Apple Reviewer) ausblenden' : 'Test-Accounts (Apple Reviewer) einblenden'
      btn.textContent = `👁 Test-Accounts${state.testAccountCount ? ` (${state.testAccountCount})` : ''}${state.showTestAccounts ? ' an' : ' aus'}`
    }
  })
  body.querySelector('#fb-clear')?.addEventListener('click', async () => {
    state.filterBuilder = {}
    ;['#fb-type','#fb-verified','#fb-premium'].forEach(s => { const el = body.querySelector(s); if (el) el.value = '' })
    ;['#fb-country','#fb-from','#fb-to'].forEach(s => { const el = body.querySelector(s); if (el) el.value = '' })
    state.page = 1
    try { await fetchPage(); refreshTableOnly(body, container) } catch (_) {}
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
    const ok = await confirmDialog(`${ids.length} Nutzer verifizieren?`, 'Diese Nutzer werden als verifiziert markiert.')
    if (!ok) return
    try {
      // FIX #4: correct RPC param name is uids[] not user_ids
      const { data, error } = await sb.rpc('admin_bulk_verify', { uids: ids })
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
    const ok = await confirmDialog(`${ids.length} × Premium freischalten?`)
    if (!ok) return
    let n = 0
    const errs = []
    for (const id of ids) {
      try {
        // FIX #3: correct RPC param names are uid + bool (not user_id + premium)
        const { error } = await sb.rpc('admin_set_premium', { uid: id, bool: true })
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
    const ok = await confirmDialog(`${state.selected.size} Nutzer bannen?`, 'Diese Aktion sperrt die Accounts.', 'Bannen', true)
    if (!ok) return
    let n = 0
    for (const id of state.selected) { try { await banUser(id); n++ } catch (e) { console.warn('ban failed', id, e) } }
    toast(`${n} gebannt`, 'warning')
    state.selected.clear()
    await loadAll(container)
  })
  bar.querySelector('[data-bulk="export"]')?.addEventListener('click', () => {
    const rows = state.rows.filter(r => state.selected.has(r.id))
    exportCsv(rows.map(toCsvRow), [], `nutzer-auswahl-${Date.now()}.csv`)
    toast('Export gestartet', 'success')
  })
}

function openActionMenu(anchor, userId, body, container) {
  document.querySelectorAll('.ul-action-menu').forEach(m => m.remove())
  const row = state.rows.find(r => r.id === userId)
  if (!row) return

  const menu = document.createElement('div')
  menu.className = 'ul-action-menu glass-card'
  // FIX #6: show Unverify button for already-verified users instead of disabled Verify
  // FIX #7: show Unban button for already-banned users instead of always calling banUser
  menu.innerHTML = `
    <button data-a="view">${iconHtml('eye')} Details ansehen</button>
    ${row.is_verified
      ? `<button data-a="unverify">${iconHtml('x-circle')} Verifizierung entziehen</button>`
      : `<button data-a="verify">${iconHtml('check-circle')} Verifizieren</button>`
    }
    <button data-a="premium">${iconHtml('star')} ${row.is_premium ? 'Premium aktiv' : 'Premium gewähren'}</button>
    ${row.is_banned
      ? `<button data-a="unban">${iconHtml('unlock')} Entbannen</button>`
      : `<button data-a="ban" class="danger">${iconHtml('ban')} Bannen</button>`
    }
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
    const ok = await confirmDialog('Nutzer verifizieren?')
    if (!ok) return
    try { await verifyUser(userId); toast('Verifiziert', 'success'); await loadAll(container) }
    catch (e) { toast(e?.message || 'Fehler', 'error') }
  })
  // FIX #6: wire unverify action
  menu.querySelector('[data-a="unverify"]')?.addEventListener('click', async () => {
    close()
    const ok = await confirmDialog('Verifizierung entziehen?', '', 'Entziehen', true)
    if (!ok) return
    try { await unverifyUser(userId); toast('Verifizierung entzogen', 'warning'); await loadAll(container) }
    catch (e) { toast(e?.message || 'Fehler', 'error') }
  })
  menu.querySelector('[data-a="premium"]')?.addEventListener('click', async () => {
    close()
    const ok = await confirmDialog('Premium gewähren?')
    if (!ok) return
    try { await grantPremium(userId); toast('Premium aktiviert', 'success'); await loadAll(container) }
    catch (e) { toast(e?.message || 'Fehler', 'error') }
  })
  menu.querySelector('[data-a="ban"]')?.addEventListener('click', async () => {
    close()
    const ok = await confirmDialog('Nutzer bannen?', '', 'Bannen', true)
    if (!ok) return
    try { await banUser(userId); toast('Gebannt', 'warning'); await loadAll(container) }
    catch (e) { toast(e?.message || 'Fehler', 'error') }
  })
  // FIX #7: wire unban action
  menu.querySelector('[data-a="unban"]')?.addEventListener('click', async () => {
    close()
    const ok = await confirmDialog('Nutzer entbannen?')
    if (!ok) return
    try { await unbanUser(userId); toast('Entbannt', 'success'); await loadAll(container) }
    catch (e) { toast(e?.message || 'Fehler', 'error') }
  })
}

function openUserDrawer(userId, container) {
  try {
    const host = drawer({
      title: 'Nutzer-Details',
      width: 540,
      content: `<div id="ul-drawer-host"><div class="pf-skeleton" style="width:100%;height:240px;"></div></div>`
    })
    showUserDetailModal(userId)
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
        <h3>${iconHtml('bell')} Push-Broadcast senden</h3>
        <button class="btn-icon" id="ul-push-close" title="Schließen">${iconHtml('x')}</button>
      </div>
      <div class="ul-push-modal-body">
        <div class="ul-push-notice">${iconHtml('alert-circle')} Dieser Push wird als Broadcast an <strong>alle</strong> Nutzer gesendet, nicht nur an die Auswahl.</div>
        <label class="ul-push-label" for="ul-push-title">Titel</label>
        <input type="text" id="ul-push-title" class="ul-push-input" placeholder="z. B. Neue Funktion für dich!" maxlength="64" />
        <label class="ul-push-label" for="ul-push-body">Nachricht</label>
        <textarea id="ul-push-body" class="ul-push-textarea" placeholder="Kurze Push-Nachricht…" maxlength="200" rows="3"></textarea>
        <div id="ul-push-status" class="ul-push-status" hidden></div>
      </div>
      <div class="ul-push-modal-foot">
        <button class="btn btn-ghost" id="ul-push-cancel">Abbrechen</button>
        <button class="btn btn-primary" id="ul-push-send">${iconHtml('send')} An alle senden</button>
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
    // FIX #2: send_broadcast_push sends to ALL users (audience='all') — one single call, no per-user loop
    try {
      const { error } = await sb.rpc('send_broadcast_push', {
        p_title: title,
        p_body: body,
        p_audience: 'all',
        p_deep_link: null
      })
      if (error) throw error
      close()
      toast('Broadcast-Push gesendet (alle Nutzer)', 'success')
    } catch (e) {
      close()
      toast(e?.message || 'Push-Versand fehlgeschlagen', 'error')
    }
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
  exportCsv(state.rows.map(toCsvRow), [], `nutzer-liste-${Date.now()}.csv`)
  toast('CSV exportiert', 'success')
}

// SWIPE-ACTIONS: library-frei, TouchStart/Move/End
// swipe-left  (Finger nach links, deltaX < -60) → Verify Quick-Action
// swipe-right (Finger nach rechts, deltaX > +60) → Notiz hinzufügen
const SWIPE_THRESHOLD = 60
const SWIPE_MAX = 120

function attachSwipeActions(tr, body, container) {
  if (tr.__swipeWired) return
  tr.__swipeWired = true

  // Row in einen Wrapper packen, der die Action-Backgrounds zeigt
  // Wir setzen position:relative auf TR und einen ::before / ::after via inline styles ist tricky —
  // stattdessen: wir nutzen transform auf der Row und blenden zwei absolut positionierte Hint-Layer ein.
  tr.style.position = tr.style.position || 'relative'
  tr.style.touchAction = 'pan-y'

  // Indikator-Container (links: Note, rechts: Verify) — als sibling-Overlay über das tr nicht möglich,
  // also stylen wir tr direkt via ::before/::after-Ersatz: zwei Pseudo-Elements per data-attr CSS unten.
  // Hint via data-swipe-hint
  tr.dataset.swipeReady = '1'

  let startX = 0, startY = 0, dx = 0, dragging = false, locked = null

  const reset = (animate = true) => {
    if (animate) tr.style.transition = 'transform 220ms cubic-bezier(.22,.9,.36,1)'
    tr.style.transform = 'translateX(0)'
    tr.dataset.swipeDir = ''
    setTimeout(() => { tr.style.transition = '' }, 240)
  }

  const onStart = (e) => {
    const t = e.touches ? e.touches[0] : e
    // Skip wenn Touch auf Buttons/Checkboxen
    if (e.target.closest('.col-check') || e.target.closest('.col-actions') || e.target.closest('button') || e.target.closest('input')) return
    startX = t.clientX
    startY = t.clientY
    dx = 0
    dragging = true
    locked = null
    tr.style.transition = ''
  }

  const onMove = (e) => {
    if (!dragging) return
    const t = e.touches ? e.touches[0] : e
    const rawDx = t.clientX - startX
    const rawDy = t.clientY - startY
    if (locked === null) {
      if (Math.abs(rawDx) < 6 && Math.abs(rawDy) < 6) return
      locked = Math.abs(rawDx) > Math.abs(rawDy) ? 'x' : 'y'
    }
    if (locked !== 'x') { dragging = false; return }
    if (e.cancelable) e.preventDefault()
    // Resistance ab MAX
    let clamped = rawDx
    if (Math.abs(rawDx) > SWIPE_MAX) {
      const over = Math.abs(rawDx) - SWIPE_MAX
      clamped = Math.sign(rawDx) * (SWIPE_MAX + over * 0.25)
    }
    dx = clamped
    tr.style.transform = `translateX(${dx}px)`
    tr.dataset.swipeDir = dx < 0 ? 'left' : 'right'
    tr.dataset.swipeArmed = Math.abs(dx) >= SWIPE_THRESHOLD ? '1' : '0'
  }

  const onEnd = async () => {
    if (!dragging) return
    dragging = false
    const finalDx = dx
    if (Math.abs(finalDx) < SWIPE_THRESHOLD) {
      reset(true)
      return
    }
    tr.__swipeMoved = true
    // Spring back nach Action-Trigger
    reset(true)
    const uid = tr.dataset.id
    try {
      if (finalDx < 0) {
        // swipe-left → Verify Quick-Action
        await doSwipeVerify(uid, body, container)
      } else {
        // swipe-right → Note hinzufügen
        await doSwipeNote(uid, body, container)
      }
    } catch (err) {
      toast(err?.message || 'Aktion fehlgeschlagen', 'error')
    }
  }

  const onCancel = () => {
    if (!dragging) return
    dragging = false
    reset(true)
  }

  tr.addEventListener('touchstart', onStart, { passive: true })
  tr.addEventListener('touchmove', onMove, { passive: false })
  tr.addEventListener('touchend', onEnd)
  tr.addEventListener('touchcancel', onCancel)

  // Pointer-Events für Desktop-Tests / Trackpad-Drag (optional, robust)
  tr.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') return // touch läuft schon über touch-events
    if (e.pointerType === 'mouse') return // Maus soll Row-Klick auslösen, nicht swipen
  })
}

async function doSwipeVerify(uid, body, container) {
  const row = state.rows.find(r => r.id === uid)
  if (!row) return
  const pa = await import('/lib/panel-actions.js')
  if (row.is_verified) {
    await pa.unverifyUser(uid)
    toast('Verifizierung entzogen', 'warning')
  } else {
    await pa.verifyUser(uid)
    toast('Verifiziert', 'success')
  }
  try { await fetchPage(); refreshTableOnly(body, container) } catch (_) {}
}

async function doSwipeNote(uid, body, container) {
  const row = state.rows.find(r => r.id === uid)
  if (!row) return
  const note = await promptNote(row)
  if (note === null) return // abgebrochen
  if (!note.trim()) return
  try {
    // Best-Effort: zuerst dedizierte RPC, sonst Fallback in user_notes Tabelle
    let res = await sb.rpc('admin_add_user_note', { p_user_id: uid, p_note: note.trim() })
    if (res.error) {
      // Fallback: direkter Insert (Tabelle muss existieren; sonst landet das im catch)
      res = await sb.from('user_notes').insert({ user_id: uid, note: note.trim() })
      if (res.error) throw res.error
    }
    toast('Notiz hinzugefügt', 'success')
  } catch (e) {
    toast(e?.message || 'Notiz konnte nicht gespeichert werden', 'error')
  }
}

function promptNote(row) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div')
    overlay.className = 'ul-push-overlay'
    overlay.innerHTML = `
      <div class="ul-push-modal glass-card" role="dialog" aria-modal="true" aria-label="Notiz hinzufügen">
        <div class="ul-push-modal-head">
          <h3>${iconHtml('edit-3')} Notiz für ${htmlEscape(row.full_name || row.username || 'Nutzer')}</h3>
          <button class="btn-icon" data-x="close" title="Schließen">${iconHtml('x')}</button>
        </div>
        <div class="ul-push-modal-body">
          <textarea id="ul-note-text" class="ul-push-textarea" placeholder="Interne Notiz…" rows="4" maxlength="500"></textarea>
        </div>
        <div class="ul-push-modal-foot">
          <button class="btn btn-ghost" data-x="cancel">Abbrechen</button>
          <button class="btn btn-primary" data-x="save">${iconHtml('save')} Speichern</button>
        </div>
      </div>
    `
    document.body.appendChild(overlay)
    const ta = overlay.querySelector('#ul-note-text')
    setTimeout(() => ta?.focus(), 30)
    const done = (val) => { overlay.remove(); resolve(val) }
    overlay.querySelector('[data-x="close"]').addEventListener('click', () => done(null))
    overlay.querySelector('[data-x="cancel"]').addEventListener('click', () => done(null))
    overlay.querySelector('[data-x="save"]').addEventListener('click', () => done(ta?.value || ''))
    overlay.addEventListener('click', (e) => { if (e.target === overlay) done(null) })
  })
}

function animateHero(body) {
  const heroVal = body.querySelector('.ul-hero .stat-hero-value, .ul-hero [data-hero-value], .ul-hero .value, .ul-hero strong')
  if (heroVal) { try { countUp(heroVal, state.totals.all, { duration: 900 }) } catch {} }
  body.querySelectorAll('.mini-stat-val').forEach(el => {
    const v = Number(el.dataset.count || 0)
    try { countUp(el, v, { duration: 700 }) } catch { el.textContent = String(v) }
  })
}
