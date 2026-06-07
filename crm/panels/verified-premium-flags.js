import { sb } from '/lib/supabase.js'
import { toast, modal, confirmDialog, fmtNumber, fmtDateTime, fmtRelativeTime, htmlEscape, iconHtml, debounce } from '/lib/ui.js'
import { makeDonutChart, makeBarChart } from '/lib/charts.js'
import { exportPanelAsPdf, exportCsv } from '/lib/export.js'
import { countUp, fadeIn, skeletonLoader } from '/lib/animations.js'
import { drawer, statHero } from '/lib/layout-extras.js'
import { showUserDetailModal } from '/lib/panel-actions.js'

async function fetchUsers() {
  const { data, error } = await sb.rpc('admin_users_list_full', { p_limit: 5000, p_offset: 0, p_search: '' })
  if (error) throw error
  const all = data || []
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
  }
}

function avatarHtml(u) {
  const initials = (u.full_name || u.username || '?').slice(0, 2).toUpperCase()
  if (u.avatar_url) {
    return `<img src="${htmlEscape(u.avatar_url)}" alt="" class="row-avatar" />`
  }
  return `<div class="row-avatar avatar-fallback">${htmlEscape(initials)}</div>`
}

function userRowHtml(u, kind) {
  const sub = kind === 'premium'
    ? (u.is_premium ? `bis ${fmtDateTime(u.is_premium)}` : 'Lifetime')
    : (u.verified_at   ? `seit ${fmtRelativeTime(u.verified_at)}` : '—')
  const badge = kind === 'premium'
    ? `<span class="badge badge-premium">PREMIUM</span>`
    : `<span class="badge badge-verified">VERIFIED</span>`
  return `
    <div class="user-row" data-id="${u.id}" data-kind="${kind}">
      ${avatarHtml(u)}
      <div class="user-row-main">
        <div class="user-row-name">
          <span class="name">${htmlEscape(u.full_name || u.username || 'Unbekannt')}</span>
          ${badge}
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
  const { error } = await sb.rpc('admin_unverify_user', { target_user_id: userId })
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
  const { error } = await sb.rpc('admin_set_premium', { user_id: userId, premium: false })
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

  modal({
    title: 'Premium vergeben (Bulk)',
    body,
    confirmText: 'Vergeben',
    cancelText: 'Abbrechen',
    width: 560,
    onConfirm: async () => {
      if (selected.size === 0) { toast('Bitte mindestens einen Nutzer wählen', 'warn'); return false }
      const userIds = Array.from(selected.keys())
      const results = await Promise.all(
        userIds.map(uid => sb.rpc('admin_set_premium', { user_id: uid, premium: true }))
      )
      const failed = results.filter(r => r.error)
      if (failed.length > 0) { toast(`Fehler bei ${failed.length} Nutzer(n)`, 'error'); return false }
      toast(`${userIds.length} Nutzer erhielten Premium`, 'success')
      onDone?.()
      return true
    },
  })

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
}

function buildPremiumDurationBuckets(premium) {
  const now = Date.now()
  const buckets = { 'Lifetime': 0, '< 30 Tage': 0, '30–90 Tage': 0, '90–365 Tage': 0, '> 1 Jahr': 0, 'Abgelaufen': 0 }
  for (const u of premium) {
    if (!u.is_premium) { buckets['Lifetime']++; continue }
    const days = (new Date(u.is_premium).getTime() - now) / 86400_000
    if (days < 0)          buckets['Abgelaufen']++
    else if (days < 30)    buckets['< 30 Tage']++
    else if (days < 90)    buckets['30–90 Tage']++
    else if (days < 365)   buckets['90–365 Tage']++
    else                   buckets['> 1 Jahr']++
  }
  return buckets
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

    let state = { verified: [], premium: [], loading: true, error: null }

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

      body.innerHTML = `
        <div class="hero-row">
          <div class="glass-card hero-card" id="hero-verified">
            ${statHero({
              label: 'Verifizierte Nutzer',
              value: 0,
              icon: 'badge-check',
              accent: 'blue',
            })}
          </div>
          <div class="glass-card hero-card" id="hero-premium">
            ${statHero({
              label: 'Premium-Nutzer',
              value: 0,
              icon: 'star',
              accent: 'gold',
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
            <div class="user-list" id="list-premium">
              ${premiumCount === 0
                ? emptyListHtml('Premium', 'Premium vergeben', 'empty-grant-btn')
                : state.premium.map(u => userRowHtml(u, 'premium')).join('')}
            </div>
          </div>
        </div>
      `

      // Hero count-up
      const vHeroVal = body.querySelector('#hero-verified .stat-hero-value')
      const pHeroVal = body.querySelector('#hero-premium .stat-hero-value')
      if (vHeroVal) countUp(vHeroVal, 0, verifiedCount, 900)
      if (pHeroVal) countUp(pHeroVal, 0, premiumCount, 900)

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
        const filtered = !q ? src : src.filter(u =>
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
                <div class="kv"><span>Premium bis</span><span>${u.is_premium ? fmtDateTime(u.is_premium) : 'Lifetime'}</span></div>
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
        const { verified, premium } = await fetchUsers()
        state = { verified, premium, loading: false, error: null }
      } catch (e) {
        state = { verified: [], premium: [], loading: false, error: e }
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
        ...state.verified.map(u => ({ type: 'verified', id: u.id, username: u.username, display_name: u.full_name, since: u.verified_at, is_premium: '' })),
        ...state.premium.map(u  => ({ type: 'premium',  id: u.id, username: u.username, display_name: u.full_name, since: u.premium_granted_at, is_premium: u.is_premium || 'lifetime' })),
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
    container.querySelector('#mount-retry-btn')?.addEventListener('click', () => {
      this.mount(container)
    })
   }
  }
}
