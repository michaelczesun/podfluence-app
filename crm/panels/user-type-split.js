import { sb } from '/lib/supabase.js?v=20260608m'
import { toast, fmtNumber, fmtDateTime, htmlEscape, iconHtml, debounce } from '/lib/ui.js?v=20260608m'
import { makeAreaChart, makeDonutChart } from '/lib/charts.js?v=20260608m'
import { exportPanelAsPdf, exportCsv } from '/lib/export.js?v=20260608m'
import { countUp, fadeIn, skeletonLoader } from '/lib/animations.js?v=20260608m'
import { drawer, statHero } from '/lib/layout-extras.js?v=20260608m'
import { showUserDetailModal } from '/lib/panel-actions.js?v=20260608m'

export default {
  id: 'user-type-split',
  title: 'Listener vs. Podcaster',
  category: 'users',

  async mount(container) {
    try {
      container.innerHTML = `
        <div class="panel-shell">
          <div class="panel-head">
            <div>
              <h2>Listener vs. Podcaster</h2>
              <p class="panel-sub">Verteilung der User-Typen und Wachstums-Trend</p>
            </div>
            <div class="toolbar" id="utsToolbar">
              <button class="btn btn-ghost" data-act="refresh" title="Aktualisieren">${iconHtml('refresh')} Aktualisieren</button>
              <button class="btn btn-ghost" data-act="pdf" title="Als PDF exportieren">${iconHtml('file-text')} PDF</button>
              <button class="btn btn-ghost" data-act="csv" title="Als CSV exportieren">${iconHtml('download')} CSV</button>
            </div>
          </div>
          <div class="panel-body" id="utsBody"></div>
        </div>
      `

      const body = container.querySelector('#utsBody')
      body.innerHTML = skeletonLoader({ rows: 4, height: 140 })

      container.querySelector('[data-act="refresh"]').addEventListener('click', () => {
        toast('Daten werden aktualisiert…')
        this._load(container)
      })
      container.querySelector('[data-act="pdf"]').addEventListener('click', () => {
        exportPanelAsPdf(container, { title: 'Listener vs. Podcaster' })
      })
      container.querySelector('[data-act="csv"]').addEventListener('click', () => {
        if (this._lastTrend?.length) {
          exportCsv(this._lastTrend, { filename: 'listener-podcaster-trend.csv' })
        } else {
          toast('Keine Daten zum Exportieren')
        }
      })

      // FIX #8 (low): _load first, fadeIn after content is ready (called inside _load)
      this._load(container)
    } catch (err) {
      console.error('[user-type-split] mount error', err)
      container.innerHTML = `
        <div class="error-state">
          <div class="error-icon">${iconHtml ? iconHtml('alert-triangle') : '⚠'}</div>
          <h3>Panel konnte nicht initialisiert werden</h3>
          <p>${(err && err.message) ? String(err.message).replace(/[<>&]/g, '') : 'Unbekannter Fehler'}</p>
        </div>
      `
    }
  },

  async _load(container) {
    const body = container.querySelector('#utsBody')
    if (!body) return
    body.innerHTML = skeletonLoader({ rows: 4, height: 140 })

    try {
      // FIX #1: Use correct RPC param names — without p_ prefix: limit, offset, search
      const [splitRes, usersRes] = await Promise.all([
        sb.rpc('admin_user_type_split'),
        sb.rpc('admin_users_list_full', { p_limit: 5000, p_offset: 0, p_search: '' })
      ])
      if (splitRes.error) throw splitRes.error
      if (usersRes.error) throw usersRes.error

      const split = splitRes.data || {}
      const all = usersRes.data || []

      // FIX #3: Consistent total — always from split counts (listener + podcaster + both)
      // listeners = type==='listener' only (NOT !u.type), both-users counted once in split.both
      const splitListeners = split.listener || 0
      const splitPodcasters = split.podcaster || 0
      const splitBoth = split.both || 0
      const effectiveTotal = (splitListeners + splitPodcasters + splitBoth) || all.length || 1

      // FIX #3: listeners filter strictly type==='listener', not fallback !u.type to avoid double-count
      const listeners = all.filter(u => u.type === 'listener')
      const podcasters = all.filter(u => u.type === 'podcaster' || u.type === 'both')
      const verifiedPodcasters = podcasters.filter(u => u.is_verified)

      const months = {}
      const now = new Date()
      for (let i = 11; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
        months[key] = { month: key, listeners: 0, podcasters: 0 }
      }
      for (const u of all) {
        if (u.created_at) {
          const d = new Date(u.created_at)
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
          if (months[key]) {
            if (u.type === 'podcaster' || u.type === 'both') months[key].podcasters++
            else months[key].listeners++
          }
        }
      }
      const trend = Object.values(months)
      this._lastTrend = trend
      this._lastUsers = all

      const convRate = effectiveTotal ? ((podcasters.length / effectiveTotal) * 100).toFixed(1) : '0.0'

      body.innerHTML = `
        <div class="uts-hero-grid">
          <div id="heroTotal"></div>
          <div id="heroListeners"></div>
          <div id="heroPodcasters"></div>
          <div id="heroConv"></div>
        </div>

        <div class="glass-card uts-donut-card">
          <div class="card-head">
            <h3>User-Verteilung</h3>
            <span class="hint">Klick auf ein Segment für gefilterte User-Liste</span>
          </div>
          <div class="uts-donut-wrap">
            <div id="utsDonut" class="uts-donut"></div>
            <div class="uts-legend" id="utsLegend">
              <button class="legend-item" data-seg="listeners">
                <span class="dot" style="background:#6366f1"></span>
                <div class="legend-meta">
                  <strong>Listener</strong>
                  <span>${fmtNumber(listeners.length)} · ${effectiveTotal ? ((listeners.length/effectiveTotal)*100).toFixed(1) : 0}%</span>
                </div>
              </button>
              <button class="legend-item" data-seg="podcasters">
                <span class="dot" style="background:#ec4899"></span>
                <div class="legend-meta">
                  <strong>Podcaster</strong>
                  <span>${fmtNumber(podcasters.length)} · ${effectiveTotal ? ((podcasters.length/effectiveTotal)*100).toFixed(1) : 0}%</span>
                </div>
              </button>
              <button class="legend-item" data-seg="verified">
                <span class="dot" style="background:#10b981"></span>
                <div class="legend-meta">
                  <strong>Verifiziert</strong>
                  <span>${fmtNumber(verifiedPodcasters.length)} · ${podcasters.length ? ((verifiedPodcasters.length/podcasters.length)*100).toFixed(1) : 0}%</span>
                </div>
              </button>
            </div>
          </div>
        </div>

        <div class="glass-card uts-trend-card">
          <div class="card-head">
            <h3>Wachstums-Trend</h3>
            <span class="hint">Neue Listener und Podcaster pro Monat (12 Monate)</span>
          </div>
          <div id="utsTrend" class="uts-trend"></div>
        </div>
      `

      // FIX: statHero(opts) returns DOM-Node — first-arg-as-container war ignoriert,
      // dadurch leere Hero-Container. Korrekt: returned-Node ans Target hängen.
      // FIX (Fix-Pass 20260608i): icon als iconHtml()-Markup übergeben, nicht roher Name.
      // statHero hat zwar einen Lazy-Import-Fallback für rohe Namen, der die Icons aber
      // kurz leer rendert (FOUC). Direktes Markup spart den Async-Hop.
      body.querySelector('#heroTotal').replaceChildren(statHero({ label: 'Gesamt-User', value: effectiveTotal, icon: iconHtml('users') }))
      body.querySelector('#heroListeners').replaceChildren(statHero({ label: 'Listener', value: listeners.length, icon: iconHtml('headphones'), accent: '#6366f1' }))
      body.querySelector('#heroPodcasters').replaceChildren(statHero({ label: 'Podcaster', value: podcasters.length, icon: iconHtml('mic'), accent: '#ec4899' }))
      body.querySelector('#heroConv').replaceChildren(statHero({ label: 'Podcaster-Anteil', value: convRate, suffix: '%', icon: iconHtml('trending-up'), accent: '#10b981' }))

      // FIX: statHero schreibt .lx-hero-value (nicht .value) — querySelector('.value') war null.
      // statHero feuert intern bereits countUp via requestAnimationFrame; eigener countUp-Aufruf
      // hier zusätzlich nur für Hero-Conv (Float-Decimals) nötig — Rest skippen.
      const convValNode = body.querySelector('#heroConv .lx-hero-value')
      if (convValNode) countUp(convValNode, parseFloat(convRate), { duration: 900, decimals: 1 })

      // FIX: makeDonutChart-Signatur ist (container, {labels, values, colors, height}) —
      // positional Array war undefined-values → leeres Donut.
      const donutValues = [
        listeners.length,
        Math.max(0, podcasters.length - verifiedPodcasters.length),
        verifiedPodcasters.length
      ]
      const donutLabels = ['Listener', 'Podcaster (unverif.)', 'Podcaster (verif.)']
      const donutKeys = ['listeners', 'podcasters', 'verified']
      const donut = (donutValues.some(v => v > 0))
        ? makeDonutChart(body.querySelector('#utsDonut'), {
            labels: donutLabels,
            values: donutValues,
            colors: ['#6366f1', '#ec4899', '#10b981'],
            height: 280
          })
        : (body.querySelector('#utsDonut').innerHTML = `
            <div class="empty-state" style="padding:48px 16px;text-align:center;color:var(--text-soft, #94a3b8);">
              <div class="empty-icon" style="opacity:0.5;margin-bottom:8px;">${iconHtml('pie-chart')}</div>
              <h3 style="color:var(--text, #e2e8f0);margin:0 0 4px;">Noch keine User-Verteilung</h3>
              <p style="margin:0;font-size:13px;">Sobald Listener und Podcaster registriert sind, erscheint die Verteilung hier.</p>
            </div>
          `, null)

      // Schema-Truth: makeAreaChart erwartet { series, categories } (ApexCharts-Shape).
      makeAreaChart(body.querySelector('#utsTrend'), {
        categories: (trend || []).map(t => t.month),
        series: [
          { name: 'Neue Listener',   data: (trend || []).map(t => Number(t.listeners) || 0) },
          { name: 'Neue Podcaster', data: (trend || []).map(t => Number(t.podcasters) || 0) }
        ],
        colors: ['#6366f1', '#ec4899'],
        height: 260,
      })

      body.querySelectorAll('.legend-item').forEach(btn => {
        btn.addEventListener('mouseenter', () => donut?.highlight?.(btn.dataset.seg))
        btn.addEventListener('mouseleave', () => donut?.highlight?.(null))
        btn.addEventListener('click', () => this._openSegmentDrawer(btn.dataset.seg, all))
      })

      // FIX #8: fadeIn after content rendered
      fadeIn(body)
    } catch (err) {
      console.error('[user-type-split] load error', err)
      body.innerHTML = `
        <div class="error-state">
          <div class="error-icon">${iconHtml('alert-triangle')}</div>
          <h3>Daten konnten nicht geladen werden</h3>
          <p>Fehler: ${htmlEscape(err?.message || 'Unbekannter Fehler')}</p>
          <button class="btn btn-primary" data-act="retry">${iconHtml('refresh')} Erneut versuchen</button>
        </div>
      `
      body.querySelector('[data-act="retry"]')?.addEventListener('click', () => this._load(container))
    }
  },

  _openSegmentDrawer(segment, allUsers) {
    let filtered = []
    let title = ''
    if (segment === 'listeners') {
      // FIX #3: strictly type==='listener' — 'both' users are NOT listeners
      filtered = allUsers.filter(u => u.type === 'listener')
      title = 'Listener'
    } else if (segment === 'podcasters') {
      filtered = allUsers.filter(u => (u.type === 'podcaster' || u.type === 'both') && !u.is_verified)
      title = 'Podcaster (unverifiziert)'
    } else if (segment === 'verified') {
      filtered = allUsers.filter(u => (u.type === 'podcaster' || u.type === 'both') && u.is_verified)
      title = 'Verifizierte Podcaster'
    } else {
      filtered = allUsers
      title = 'Alle User'
    }

    if (!filtered.length) {
      // FIX: drawer-Lib akzeptiert contentHtml (String) oder content (Node). String an
      // `content` wurde ignoriert → leerer Drawer.
      drawer({
        title,
        contentHtml: `
          <div class="empty-state">
            <div class="empty-icon">${iconHtml('users')}</div>
            <h3>Keine User in dieser Gruppe</h3>
            <p>Für das gewählte Segment liegen aktuell keine Datensätze vor.</p>
          </div>
        `
      })
      return
    }

    // FIX #5: Render all filtered rows (not just slice(0,500)) so search works over full set
    const rows = filtered.map(u => `
      <tr data-uid="${htmlEscape(u.id)}" class="row-clickable">
        <td>
          <div class="user-cell">
            ${u.avatar_url ? `<img src="${htmlEscape(u.avatar_url)}" class="avatar" alt="">` : `<div class="avatar avatar-fallback">${htmlEscape((u.full_name||u.username||'?').slice(0,1).toUpperCase())}</div>`}
            <div>
              <strong>${htmlEscape(u.full_name || u.username || 'Unbekannt')}</strong>
              <span class="muted">@${htmlEscape(u.username || '—')}</span>
            </div>
          </div>
        </td>
        <td>${(u.type === 'podcaster' || u.type === 'both') ? '<span class="badge badge-pink">Podcaster</span>' : '<span class="badge badge-indigo">Listener</span>'}</td>
        <td>${u.is_verified ? '<span class="badge badge-green">✓ Verifiziert</span>' : '<span class="muted">—</span>'}</td>
        <td>${u.created_at ? fmtDateTime(u.created_at) : '—'}</td>
      </tr>
    `).join('')

    drawer({
      title: `${title} · ${fmtNumber(filtered.length)}`,
      width: 720,
      contentHtml: `
        <div class="drawer-toolbar">
          <input type="search" class="search-input" id="utsSearch" placeholder="Name oder Username suchen…">
          <button class="btn btn-ghost" data-act="csv-seg">${iconHtml('download')} CSV</button>
        </div>
        <div class="table-wrap">
          <table class="data-table data-table-hover">
            <thead>
              <tr>
                <th>User</th>
                <th>Typ</th>
                <th>Status</th>
                <th>Registriert</th>
              </tr>
            </thead>
            <tbody id="utsRows">${rows}</tbody>
          </table>
        </div>
      `,
      onMount: (drawerEl) => {
        const search = drawerEl.querySelector('#utsSearch')
        const tbody = drawerEl.querySelector('#utsRows')
        const allRows = Array.from(tbody.querySelectorAll('tr'))

        // FIX #5: Search filters over all rows (full filtered array rendered), not just first 500
        const onSearch = debounce(() => {
          const q = search.value.trim().toLowerCase()
          allRows.forEach(tr => {
            tr.style.display = !q || tr.textContent.toLowerCase().includes(q) ? '' : 'none'
          })
        }, 120)
        search.addEventListener('input', onSearch)

        drawerEl.querySelector('[data-act="csv-seg"]').addEventListener('click', () => {
          exportCsv(filtered, { filename: `${segment}-users.csv` })
        })

        allRows.forEach(tr => {
          tr.addEventListener('click', () => {
            const uid = tr.dataset.uid
            if (uid) showUserDetailModal(uid)
          })
        })
      }
    })
  }
}
