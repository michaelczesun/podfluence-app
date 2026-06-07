import { sb } from '/lib/supabase.js?v=20260608e'
import { toast, modal, confirmDialog, fmtNumber, fmtDateTime, fmtRelativeTime, htmlEscape, iconHtml, debounce } from '/lib/ui.js?v=20260608e'
import { makeDonutChart, makeBarChart } from '/lib/charts.js?v=20260608e'
import { exportPanelAsPdf, exportCsv } from '/lib/export.js?v=20260608e'
import { countUp, fadeIn, skeletonLoader } from '/lib/animations.js?v=20260608e'
import { drawer, statHero, segmentedControl } from '/lib/layout-extras.js?v=20260608e'
import { showUserDetailModal } from '/lib/panel-actions.js?v=20260608e'

async function fetchUsers() {
  const { data, error } = await sb.rpc('admin_users_list_full', { p_limit: 5000, p_offset: 0, p_search: '' })
  if (error) throw error
  const all = data || []
  // FIX(med): warn when result set may be truncated at 5000
  if (all.length >= 5000) {
    console.warn('[verified-premium-flags] fetchUsers: result capped at 5000 — some users may be missing')
  }
  return {
    verified: all.filter(u => u.is_verified).sort((a, b) => {
      if (!a.verified_at && !b.verified_at) return 0
      if (!a.verified_at) return 1
      if (!b.verified_at) return -1
      return new Date(b.verified_at) - new Date(a.verified_at)
    }).slice(0, 500),
    premium: all.filter(u => u.is_premium).sort((a, b) => {
      if (!a.premium_granted_at && !b.premium_granted_at) return 0
      if (!a.premium_granted_at) return 1
      if (!b.premium_granted_at) return -1
      return new Date(b.premium_granted_at) - new Date(a.premium_granted_at)
    }).slice(0, 500),
    truncated: all.length >= 5000,
  }
}

function avatarHtml(u) {
  const initials = (u.full_name || u.username || '?').slice(0, 2).toUpperCase()
  if (u.avatar_url) {
    return `<img src="${htmlEscape(u.avatar_url)}" alt="" class="row-avatar" />`
  }
  return `<div class="row-avatar avatar-fallback">${htmlEscape(initials)}</div>`
}

// FIX(high): is_premium is treated as a timestamp (premium_expires_at) when truthy.
// A truthy is_premium means the user has premium; if it is a date string it represents
// the expiry. If the DB stores it as a boolean, premium_expires_at (separate col) is used
// for expiry display. We guard with isValidDate to avoid 'Invalid Date' output.
function fmtPremiumExpiry(u) {
  if (!u.is_premium) return null
  // Try premium_expires_at first (preferred separate column), then is_premium as fallback
  const raw = u.premium_expires_at || (typeof u.is_premium === 'string' ? u.is_premium : null)
  if (!raw) return null
  const d = new Date(raw)
  return isNaN(d.getTime()) ? null : fmtDateTime(raw)
}

// Premium-Expiry-Status: returns one of 'expired' | 'soon' | 'ok' | 'lifetime'
// soon = expires within next 30 days
function premiumExpiryStatus(u) {
  if (!u.is_premium) return 'ok'
  const raw = u.premium_expires_at || (typeof u.is_premium === 'string' ? u.is_premium : null)
  if (!raw) return 'lifetime'
  const ts = new Date(raw).getTime()
  if (isNaN(ts)) return 'lifetime'
  const days = (ts - Date.now()) / 86400_000
  if (days < 0) return 'expired'
  if (days < 30) return 'soon'
  return 'ok'
}

function daysUntilExpiry(u) {
  const raw = u.premium_expires_at || (typeof u.is_premium === 'string' ? u.is_premium : null)
  if (!raw) return null
  const ts = new Date(raw).getTime()
  if (isNaN(ts)) return null
  return Math.ceil((ts - Date.now()) / 86400_000)
}

function userRowHtml(u, kind) {
  let sub
  let expiryChip = ''
  let rowFlagClass = ''
  if (kind === 'premium') {
    const expiry = fmtPremiumExpiry(u)
    sub = expiry ? `bis ${expiry}` : 'Lifetime'
    const status = premiumExpiryStatus(u)
    if (status === 'expired') {
      rowFlagClass = ' row-expired'
      expiryChip = `<span class="badge badge-warn-red">ABGELAUFEN</span>`
    } else if (status === 'soon') {
      const d = daysUntilExpiry(u)
      rowFlagClass = ' row-expiring-soon'
      const label = d === null ? 'Läuft bald ab' : (d <= 0 ? 'Läuft heute ab' : `Läuft in ${d} Tag${d === 1 ? '' : 'en'} ab`)
      expiryChip = `<span class="badge badge-warn-yellow" title="${htmlEscape(label)}">${htmlEscape(label)}</span>`
    }
  } else {
    sub = u.verified_at ? `seit ${fmtRelativeTime(u.verified_at)}` : '—'
  }
  const badge = kind === 'premium'
    ? `<span class="badge badge-premium">PREMIUM</span>`
    : `<span class="badge badge-verified">VERIFIED</span>`
  return `
    <div class="user-row${rowFlagClass}" data-id="${u.id}" data-kind="${kind}">
      ${avatarHtml(u)}
      <div class="user-row-main">
        <div class="user-row-name">
          <span class="name">${htmlEscape(u.full_name || u.username || 'Unbekannt')}</span>
          ${badge}
          ${expiryChip}
        </div>
        <div class="user-row-sub">@${htmlEscape(u.username || '—')} · ${sub}</div>
      </div>
      <div class="user-row-actions">
        <button class="btn-ghost btn-detail"  title="Details">${iconHtml('eye')}</button>
        <button class="btn-danger-ghost btn-revoke" title="Entziehen">${iconHtml('x')}</button>
      </div>
    </div>
  `
}

function injectExpiryStyles() {
  if (document.getElementById('verified-premium-expiry-styles')) return
  const s = document.createElement('style')
  s.id = 'verified-premium-expiry-styles'
  s.textContent = `
    .user-row.row-expiring-soon { border-left: 3px solid #f59e0b; background: linear-gradient(90deg, rgba(245,158,11,.08), transparent 40%); }
    .user-row.row-expired { border-left: 3px solid #ef4444; background: linear-gradient(90deg, rgba(239,68,68,.10), transparent 40%); }
    .badge-warn-yellow { background: rgba(245,158,11,.15); color: var(--text, #fcd34d); border: 1px solid rgba(245,158,11,.45); font-size: 11px; padding: 2px 6px; border-radius: 6px; margin-left: 4px; }
    .badge-warn-red    { background: rgba(239,68,68,.15); color: var(--text, #fca5a5); border: 1px solid rgba(239,68,68,.45); font-size: 11px; padding: 2px 6px; border-radius: 6px; margin-left: 4px; }
    .premium-filter-bar { display:flex; align-items:center; gap:10px; padding: 8px 12px; border-bottom: 1px solid var(--border, rgba(255,255,255,.08)); }
    .premium-filter-bar .muted { font-size: 12px; }
  `
  document.head.appendChild(s)
}

function emptyListHtml(label, ctaLabel, ctaId) {
  return `
    <div class="empty-state">
      <div class="empty-icon">${iconHtml('users')}</div>
      <div class="empty-title">Keine ${htmlEscape(label)}-Nutzer</div>
      <div class="empty-sub">Es gibt aktuell niemanden in dieser Liste.</div>
      ${ctaId ? `<button class="btn-primary" id="${ctaId}">${htmlEscape(ctaLabel)}</button>` : ''}
    </div>
  `
}

function errorHtml() {
  return `
    <div class="error-state">
      <div class="error-icon">${iconHtml('alert-triangle')}</div>
      <div class="error-title">Fehler beim Laden</div>
      <div class="error-sub">Die Daten konnten nicht geladen werden.</div>
      <button class="btn-primary" id="retry-btn">Erneut versuchen</button>
    </div>
  `
}

async function revokeVerified(userId) {
  const ok = await confirmDialog({
    title: 'Verifizierung entziehen?',
    body: 'Der Nutzer verliert seinen Verified-Status. Du kannst ihn später wieder verifizieren.',
    confirmText: 'Entziehen',
    danger: true,
  })
  if (!ok) return false
  // FIX(med): admin_unverify_user param name confirmed as uid (not target_user_id)
  const { error } = await sb.rpc('admin_unverify_user', { uid: userId })
  if (error) { toast(`Fehler: ${error.message}`, 'error'); return false }
  toast('Verifizierung entzogen', 'success')
  return true
}

async function revokePremium(userId) {
  const ok = await confirmDialog({
    title: 'Premium entziehen?',
    body: 'Der Nutzer verliert sofort alle Premium-Vorteile.',
    confirmText: 'Entziehen',
    danger: true,
  })
  if (!ok) return false
  // FIX(med): admin_set_premium params are uid + bool (not user_id + premium)
  const { error } = await sb.rpc('admin_set_premium', { uid: userId, bool: false })
  if (error) { toast(`Fehler: ${error.message}`, 'error'); return false }
  toast('Premium entzogen', 'success')
  return true
}

async function searchUsersForPicker(q) {
  const { data, error } = await sb.rpc('admin_users_list_full', { p_limit: 30, p_offset: 0, p_search: (q || '').trim() })
  if (error) return []
  return (data || []).slice(0, 30)
}

function openBulkGrantModal(onDone) {
  const selected = new Map()
  const MAX_SELECT = 50

  const renderSelected = () => Array.from(selected.values()).map(u => `
    <span class="chip" data-id="${u.id}">
      ${htmlEscape(u.full_name || u.username || '?')}
      <button class="chip-x" data-id="${u.id}">×</button>
    </span>
  `).join('')

  const body = document.createElement('div')
  body.className = 'bulk-grant-body'
  body.innerHTML = `
    <div class="form-section">
      <label class="form-label">Nutzer auswählen <span class="muted">(max. ${MAX_SELECT})</span></label>
      <div class="picker-search">
        <input type="text" id="bg-search" placeholder="Nach Nutzername oder Name suchen…" class="input" autocomplete="off" />
      </div>
      <div id="bg-results" class="picker-results"></div>
      <div id="bg-selected" class="picker-chips">${renderSelected()}</div>
    </div>
    <div class="form-section bulk-grant-summary">
      <span id="bg-summary"></span>
    </div>
  `

  const updateSummary = () => {
    const n = selected.size
    body.querySelector('#bg-summary').textContent =
      n === 0 ? 'Noch keine Nutzer ausgewählt.' : `${n} Nutzer erhalten Premium.`
  }

  const refreshResults = async (q) => {
    const list = await searchUsersForPicker(q)
    body.querySelector('#bg-results').innerHTML = list.length
      ? list.map(u => `
          <div class="picker-row ${selected.has(u.id) ? 'is-selected' : ''}" data-id="${u.id}">
            ${avatarHtml(u)}
            <div class="picker-row-main">
              <div>${htmlEscape(u.full_name || u.username || '?')}</div>
              <div class="muted">@${htmlEscape(u.username || '—')}${u.is_premium ? ' · bereits Premium' : ''}</div>
            </div>
            <div class="picker-row-check">${selected.has(u.id) ? iconHtml('check') : ''}</div>
          </div>
        `).join('')
      : `<div class="muted picker-empty">Keine Treffer.</div>`
  }

  // FIX(med): register event listeners AFTER modal() mounts the body, then trigger initial load
  modal({
    title: 'Premium vergeben (Bulk)',
    body,
    confirmText: 'Vergeben',
    cancelText: 'Abbrechen',
    width: 560,
    onConfirm: async () => {
      if (selected.size === 0) { toast('Bitte mindestens einen Nutzer wählen', 'warn'); return false }
      const userIds = Array.from(selected.keys())
      // FIX(med): admin_set_premium params are uid + bool
      const results = await Promise.all(
        userIds.map(uid => sb.rpc('admin_set_premium', { uid, bool: true }))
      )
      const failed = results.filter(r => r.error)
      if (failed.length > 0) { toast(`Fehler bei ${failed.length} Nutzer(n)`, 'error'); return false }
      toast(`${userIds.length} Nutzer erhielten Premium`, 'success')
      onDone?.()
      return true
    },
    onMount: () => {
      // FIX(med): all event listeners wired here, after modal has attached body to the DOM
      const searchEl = body.querySelector('#bg-search')
      const onSearch = debounce(() => refreshResults(searchEl.value), 220)
      searchEl.addEventListener('input', onSearch)

      body.querySelector('#bg-results').addEventListener('click', async (e) => {
        const row = e.target.closest('.picker-row')
        if (!row) return
        const id = row.dataset.id
        if (selected.has(id)) {
          selected.delete(id)
        } else {
          if (selected.size >= MAX_SELECT) { toast(`Maximal ${MAX_SELECT} Nutzer auswählbar`, 'warn'); return }
          const list = await searchUsersForPicker(searchEl.value)
          const u = list.find(x => x.id === id)
          if (u) selected.set(id, u)
        }
        body.querySelector('#bg-selected').innerHTML = renderSelected()
        refreshResults(searchEl.value)
        updateSummary()
      })

      body.querySelector('#bg-selected').addEventListener('click', (e) => {
        const x = e.target.closest('.chip-x')
        if (!x) return
        selected.delete(x.dataset.id)
        body.querySelector('#bg-selected').innerHTML = renderSelected()
        refreshResults(searchEl.value)
        updateSummary()
      })

      refreshResults('')
      updateSummary()
    },
  })
}

// FIX(high): buildPremiumDurationBuckets now uses premium_expires_at (or is_premium as date
// fallback) for expiry calculation. Records where is_premium is falsy should never reach here
// because the caller already filters to state.premium (is_premium truthy only). Users with no
// expiry date are classified as Lifetime — not revoked/false users.
function buildPremiumDurationBuckets(premium) {
  const now = Date.now()
  const buckets = { 'Lifetime': 0, '< 30 Tage': 0, '30–90 Tage': 0, '90–365 Tage': 0, '> 1 Jahr': 0, 'Abgelaufen': 0 }
  for (const u of premium) {
    // Only process users that are actually premium (is_premium truthy) — state.premium is
    // already pre-filtered, but guard defensively.
    if (!u.is_premium) continue

    const raw = u.premium_expires_at || (typeof u.is_premium === 'string' ? u.is_premium : null)
    if (!raw) {
      buckets['Lifetime']++
      continue
    }
    const ts = new Date(raw).getTime()
    if (isNaN(ts)) {
      // Unparseable date — treat as Lifetime rather than silently bucketing wrong
      buckets['Lifetime']++
      continue
    }
    const days = (ts - now) / 86400_000
    if (days < 0)          buckets['Abgelaufen']++
    else if (days < 30)    buckets['< 30 Tage']++
    else if (days < 90)    buckets['30–90 Tage']++
    else if (days < 365)   buckets['90–365 Tage']++
    else                   buckets['> 1 Jahr']++
  }
  return buckets
}

function applyPremiumFilter(premium, filter) {
  if (!filter || filter === 'all') return premium
  if (filter === 'soon') return premium.filter(u => premiumExpiryStatus(u) === 'soon')
  if (filter === 'expired') return premium.filter(u => premiumExpiryStatus(u) === 'expired')
  return premium
}

function buildGrowthSeries(users, dateField) {
  const map = new Map()
  for (const u of users) {
    const ts = u[dateField] || u.created_at
    if (!ts) continue
    const d = new Date(ts)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    map.set(key, (map.get(key) || 0) + 1)
  }
  const keys = Array.from(map.keys()).sort()
  return keys.map(k => ({ label: k, value: map.get(k) }))
}

export default {
  id: 'verified-premium-flags',
  title: 'Verifiziert & Premium',
  category: 'users',

  async mount(container) {
    // FIX(med): capture module ref so retry handler inside arrow function can call mount()
    const self = this
    try {
      container.innerHTML = `
        <div class="panel-shell">
          <div class="panel-head">
            <div>
              <h2>Verifiziert & Premium</h2>
              <div class="panel-sub muted">Statusflags der Community verwalten</div>
            </div>
            <div class="toolbar">
              <button class="btn-ghost"   id="btn-refresh" title="Aktualisieren">${iconHtml('refresh')} <span>Aktualisieren</span></button>
              <button class="btn-ghost"   id="btn-pdf"     title="PDF exportieren">${iconHtml('file-text')} <span>PDF</span></button>
              <button class="btn-ghost"   id="btn-csv"     title="CSV exportieren">${iconHtml('download')} <span>CSV</span></button>
              <button class="btn-primary" id="btn-bulk"    title="Premium vergeben">${iconHtml('star')} <span>Premium vergeben</span></button>
            </div>
          </div>
          <div class="panel-body" id="body"></div>
        </div>
      `

      const body = container.querySelector('#body')
      body.innerHTML = `
        <div class="hero-row">
          ${skeletonLoader({ width: '100%', height: 132 })}
          ${skeletonLoader({ width: '100%', height: 132 })}
        </div>
        <div class="grid-2 mt-16">
          ${skeletonLoader({ width: '100%', height: 360 })}
          ${skeletonLoader({ width: '100%', height: 360 })}
        </div>
      `

      injectExpiryStyles()
      let state = { verified: [], premium: [], loading: true, error: null, truncated: false, premiumFilter: 'all' }

      const renderBody = () => {
        if (state.error) {
          body.innerHTML = errorHtml()
          body.querySelector('#retry-btn')?.addEventListener('click', load)
          return
        }
        const verifiedCount = state.verified.length
        const premiumCount  = state.premium.length
        const premiumBuckets = buildPremiumDurationBuckets(state.premium)
        const verifiedGrowth = buildGrowthSeries(state.verified, 'verified_at')
        const expiringSoonCount = state.premium.filter(u => premiumExpiryStatus(u) === 'soon').length
        const expiredCount      = state.premium.filter(u => premiumExpiryStatus(u) === 'expired').length

        // FIX(med): show truncation warning banner when result set hit the 5000 cap
        const truncationWarning = state.truncated
          ? `<div class="alert alert-warn mb-16">
               ${iconHtml('alert-triangle')} Ergebnisse möglicherweise unvollständig — Nutzerbasis übersteigt 5.000. Bitte serverseitige Filterung einsetzen.
             </div>`
          : ''

        body.innerHTML = `
          ${truncationWarning}
          <div class="hero-row">
            <div class="glass-card hero-card" id="hero-verified">
              ${statHero({
                label: 'Verifizierte Nutzer',
                value: 0,
                icon: iconHtml('badge-check'),
                accent: 'blue',
              })}
            </div>
            <div class="glass-card hero-card" id="hero-premium">
              ${statHero({
                label: 'Premium-Nutzer',
                value: 0,
                icon: iconHtml('star'),
                accent: 'gold',
              })}
            </div>
            <div class="glass-card hero-card" id="hero-expiring" style="cursor:pointer;" title="Klick: Filter auf 'Läuft bald' setzen">
              ${statHero({
                label: 'Läuft <30d ab',
                value: 0,
                icon: iconHtml('alert-triangle'),
                accent: (expiringSoonCount + expiredCount) > 0 ? 'red' : 'gold',
              })}
            </div>
          </div>

          <div class="grid-2 mt-16">
            <div class="glass-card chart-card">
              <div class="card-head">
                <h3>${iconHtml('trending-up')} Verifizierungs-Verlauf</h3>
                <span class="muted">letzte Monate</span>
              </div>
              <div id="chart-verified" class="chart-host"></div>
            </div>
            <div class="glass-card chart-card">
              <div class="card-head">
                <h3>${iconHtml('pie-chart')} Premium-Laufzeiten</h3>
                <span class="muted">Verteilung</span>
              </div>
              <div id="chart-premium" class="chart-host"></div>
            </div>
          </div>

          <div class="grid-2 mt-16">
            <div class="glass-card list-card">
              <div class="card-head">
                <h3>${iconHtml('badge-check')} Verified-Nutzer <span class="pill">${fmtNumber(verifiedCount)}</span></h3>
                <input type="text" id="search-verified" class="input input-compact" placeholder="Suchen…" />
              </div>
              <div class="user-list" id="list-verified">
                ${verifiedCount === 0 ? emptyListHtml('Verified', '', '') : state.verified.map(u => userRowHtml(u, 'verified')).join('')}
              </div>
            </div>

            <div class="glass-card list-card">
              <div class="card-head">
                <h3>${iconHtml('star')} Premium-Nutzer <span class="pill pill-gold">${fmtNumber(premiumCount)}</span></h3>
                <input type="text" id="search-premium" class="input input-compact" placeholder="Suchen…" />
              </div>
              <div class="premium-filter-bar">
                <div id="premium-filter-seg"></div>
                <span class="muted">${expiringSoonCount > 0 ? `${fmtNumber(expiringSoonCount)} läuft bald ab` : ''}${expiringSoonCount > 0 && expiredCount > 0 ? ' · ' : ''}${expiredCount > 0 ? `${fmtNumber(expiredCount)} abgelaufen` : ''}</span>
              </div>
              <div class="user-list" id="list-premium">
                ${premiumCount === 0
                  ? emptyListHtml('Premium', 'Premium vergeben', 'empty-grant-btn')
                  : applyPremiumFilter(state.premium, state.premiumFilter).map(u => userRowHtml(u, 'premium')).join('')}
              </div>
            </div>
          </div>
        `

        // Hero count-up — statHero uses class 'lx-hero-value' (not 'stat-hero-value')
        const vHeroVal = body.querySelector('#hero-verified .lx-hero-value')
        const pHeroVal = body.querySelector('#hero-premium .lx-hero-value')
        const eHeroVal = body.querySelector('#hero-expiring .lx-hero-value')
        if (vHeroVal) countUp(vHeroVal, 0, verifiedCount, 900)
        if (pHeroVal) countUp(pHeroVal, 0, premiumCount, 900)
        if (eHeroVal) countUp(eHeroVal, 0, expiringSoonCount + expiredCount, 900)

        // Premium-Filter segmentedControl
        const segHost = body.querySelector('#premium-filter-seg')
        if (segHost) {
          segmentedControl(segHost, [
            { key: 'all',     label: `Alle (${fmtNumber(premiumCount)})` },
            { key: 'soon',    label: `Läuft bald (${fmtNumber(expiringSoonCount)})` },
            { key: 'expired', label: `Abgelaufen (${fmtNumber(expiredCount)})` },
          ], state.premiumFilter, (key) => {
            state.premiumFilter = key
            const listP = body.querySelector('#list-premium')
            const filtered = applyPremiumFilter(state.premium, key)
            if (filtered.length === 0) {
              listP.innerHTML = emptyListHtml('Premium', '', '')
            } else {
              listP.innerHTML = filtered.map(u => userRowHtml(u, 'premium')).join('')
            }
          })
        }

        // Hero-Klick → Filter auf 'soon' setzen
        body.querySelector('#hero-expiring')?.addEventListener('click', () => {
          state.premiumFilter = 'soon'
          renderBody()
          body.querySelector('#list-premium')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        })

        // Charts
        const chartVerifiedEl = body.querySelector('#chart-verified')
        const chartPremiumEl  = body.querySelector('#chart-premium')
        if (verifiedGrowth.length > 0) {
          makeBarChart(chartVerifiedEl, {
            data: verifiedGrowth,
            xKey: 'label', yKey: 'value',
            color: '#3b82f6',
            height: 220,
          })
        } else {
          chartVerifiedEl.innerHTML = `<div class="muted chart-empty">Noch keine Verifizierungs-Daten.</div>`
        }
        const donutData = Object.entries(premiumBuckets)
          .filter(([, v]) => v > 0)
          .map(([label, value]) => ({ label, value }))
        if (donutData.length > 0) {
          makeDonutChart(chartPremiumEl, {
            data: donutData,
            labelKey: 'label', valueKey: 'value',
            colors: ['#f59e0b', '#ef4444', '#f97316', '#eab308', '#84cc16', '#94a3b8'],
            height: 220,
          })
        } else {
          chartPremiumEl.innerHTML = `<div class="muted chart-empty">Noch keine Premium-Daten.</div>`
        }

        wireListInteractions()
        fadeIn(body)
      }

      const wireListInteractions = () => {
        const searchV = body.querySelector('#search-verified')
        const searchP = body.querySelector('#search-premium')
        const listV   = body.querySelector('#list-verified')
        const listP   = body.querySelector('#list-premium')

        const filter = (input, list, src, kind) => {
          const q = (input.value || '').toLowerCase().trim()
          let base = src
          if (kind === 'premium') base = applyPremiumFilter(src, state.premiumFilter)
          const filtered = !q ? base : base.filter(u =>
            (u.username || '').toLowerCase().includes(q) ||
            (u.full_name || '').toLowerCase().includes(q))
          list.innerHTML = filtered.length === 0
            ? emptyListHtml(kind === 'premium' ? 'Premium' : 'Verified', '', '')
            : filtered.map(u => userRowHtml(u, kind)).join('')
        }

        searchV?.addEventListener('input', debounce(() => filter(searchV, listV, state.verified, 'verified'), 150))
        searchP?.addEventListener('input', debounce(() => filter(searchP, listP, state.premium, 'premium'), 150))

        const handleRowClick = async (e) => {
          const row = e.target.closest('.user-row')
          if (!row) return
          const id = row.dataset.id
          const kind = row.dataset.kind
          if (e.target.closest('.btn-revoke')) {
            e.stopPropagation()
            const ok = kind === 'premium' ? await revokePremium(id) : await revokeVerified(id)
            if (ok) load()
            return
          }
          if (e.target.closest('.btn-detail')) {
            e.stopPropagation()
            showUserDetailModal?.(id)
            return
          }
          const u = (kind === 'premium' ? state.premium : state.verified).find(x => x.id === id)
          if (!u) return
          const expiry = fmtPremiumExpiry(u)
          drawer({
            title: u.full_name || u.username || 'Nutzer',
            width: 420,
            body: `
              <div class="drawer-user">
                ${avatarHtml(u)}
                <div class="drawer-name">${htmlEscape(u.full_name || u.username || '—')}</div>
                <div class="drawer-handle muted">@${htmlEscape(u.username || '—')}</div>
              </div>
              <div class="kv-list">
                <div class="kv"><span>Status</span><span>${kind === 'premium' ? 'Premium' : 'Verified'}</span></div>
                ${kind === 'premium' ? `
                  <div class="kv"><span>Premium bis</span><span>${expiry || 'Lifetime'}</span></div>
                  <div class="kv"><span>Vergeben am</span><span>${u.premium_granted_at ? fmtDateTime(u.premium_granted_at) : '—'}</span></div>
                ` : `
                  <div class="kv"><span>Verifiziert am</span><span>${u.verified_at ? fmtDateTime(u.verified_at) : '—'}</span></div>
                `}
                <div class="kv"><span>Registriert</span><span>${u.created_at ? fmtDateTime(u.created_at) : '—'}</span></div>
                <div class="kv"><span>User-ID</span><span class="mono">${htmlEscape(u.id)}</span></div>
              </div>
              <div class="drawer-actions">
                <button class="btn-ghost"        id="drawer-detail">${iconHtml('eye')} Details öffnen</button>
                <button class="btn-danger-ghost" id="drawer-revoke">${iconHtml('x')} ${kind === 'premium' ? 'Premium entziehen' : 'Verifizierung entziehen'}</button>
              </div>
            `,
            onMount: (root) => {
              root.querySelector('#drawer-detail')?.addEventListener('click', () => showUserDetailModal?.(u.id))
              root.querySelector('#drawer-revoke')?.addEventListener('click', async () => {
                const ok = kind === 'premium' ? await revokePremium(u.id) : await revokeVerified(u.id)
                if (ok) load()
              })
            },
          })
        }

        listV?.addEventListener('click', handleRowClick)
        listP?.addEventListener('click', handleRowClick)

        body.querySelector('#empty-grant-btn')?.addEventListener('click', () => openBulkGrantModal(load))
      }

      const load = async () => {
        state.loading = true
        try {
          const { verified, premium, truncated } = await fetchUsers()
          state = { verified, premium, loading: false, error: null, truncated }
        } catch (e) {
          state = { verified: [], premium: [], loading: false, error: e, truncated: false }
        }
        renderBody()
      }

      container.querySelector('#btn-refresh')?.addEventListener('click', () => { toast('Aktualisiere…', 'info'); load() })
      container.querySelector('#btn-pdf')?.addEventListener('click', async () => {
        try { await exportPanelAsPdf(container, { filename: 'verified-premium.pdf', title: 'Verifiziert & Premium' }); toast('PDF erstellt', 'success') }
        catch (e) { toast(`PDF-Export fehlgeschlagen: ${e.message || e}`, 'error') }
      })
      container.querySelector('#btn-csv')?.addEventListener('click', () => {
        const rows = [
          ...state.verified.map(u => ({ type: 'verified', id: u.id, username: u.username, display_name: u.full_name, since: u.verified_at, premium_expires_at: '' })),
          ...state.premium.map(u  => ({ type: 'premium',  id: u.id, username: u.username, display_name: u.full_name, since: u.premium_granted_at, premium_expires_at: u.premium_expires_at || (typeof u.is_premium === 'string' ? u.is_premium : 'lifetime') })),
        ]
        exportCsv(rows, 'verified-premium.csv')
        toast('CSV exportiert', 'success')
      })
      container.querySelector('#btn-bulk')?.addEventListener('click', () => openBulkGrantModal(load))

      await load()
      fadeIn(container)
    } catch (e) {
      container.innerHTML = `
        <div class="panel-shell">
          <div class="panel-body">
            <div class="error-state">
              <div class="error-icon">${iconHtml('alert-triangle')}</div>
              <div class="error-title">Panel konnte nicht geladen werden</div>
              <div class="error-sub">${htmlEscape(e?.message || String(e))}</div>
              <button class="btn-primary" id="mount-retry-btn">Erneut versuchen</button>
            </div>
          </div>
        </div>
      `
      // FIX(med): use captured `self` reference instead of `this` in arrow function context
      container.querySelector('#mount-retry-btn')?.addEventListener('click', () => {
        self.mount(container)
      })
    }
  }
}
