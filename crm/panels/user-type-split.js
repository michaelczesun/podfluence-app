import { sb } from '/lib/supabase.js'
import { toast, fmtNumber, fmtDateTime, htmlEscape, iconHtml, debounce } from '/lib/ui.js'
import { makeAreaChart, makeDonutChart } from '/lib/charts.js'
import { exportPanelAsPdf, exportCsv } from '/lib/export.js'
import { countUp, fadeIn, skeletonLoader } from '/lib/animations.js'
import { drawer, statHero } from '/lib/layout-extras.js'
import { showUserDetailModal } from '/lib/panel-actions.js'

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
              <p class="panel-sub">Verteilung der User-Typen und Conversion-Trend</p>
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

      // Hintergrund-Fetch — Skeleton steht schon, fadeIn parallel
      this._load(container)
      fadeIn(container)
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
      const { data: users, error } = await sb
        .from('users')
        .select('id, full_name, username, avatar_url, is_podcaster, is_verified, created_at, converted_at')
        .limit(20000)

      if (error) throw error

      const all = users || []
      const total = all.length
      const podcasters = all.filter(u => u.is_podcaster)
      const listeners = all.filter(u => !u.is_podcaster)
      const verifiedPodcasters = podcasters.filter(u => u.is_verified)

      const months = {}
      const now = new Date()
      for (let i = 11; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
        months[key] = { month: key, listeners: 0, podcasters: 0, conversions: 0 }
      }
      for (const u of all) {
        if (u.created_at) {
          const d = new Date(u.created_at)
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
          if (months[key]) {
            if (u.is_podcaster) months[key].podcasters++
            else months[key].listeners++
          }
        }
        if (u.converted_at) {
          const cd = new Date(u.converted_at)
          const ckey = `${cd.getFullYear()}-${String(cd.getMonth() + 1).padStart(2, '0')}`
          if (months[ckey]) months[ckey].conversions++
        }
      }
      const trend = Object.values(months)
      this._lastTrend = trend
      this._lastUsers = all

      const convRate = total ? ((podcasters.length / total) * 100).toFixed(1) : '0.0'

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
                  <span>${fmtNumber(listeners.length)} · ${total ? ((listeners.length/total)*100).toFixed(1) : 0}%</span>
                </div>
              </button>
              <button class="legend-item" data-seg="podcasters">
                <span class="dot" style="background:#ec4899"></span>
                <div class="legend-meta">
                  <strong>Podcaster</strong>
                  <span>${fmtNumber(podcasters.length)} · ${total ? ((podcasters.length/total)*100).toFixed(1) : 0}%</span>
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
            <h3>Conversion-Trend</h3>
            <span class="hint">Listener → Podcaster pro Monat (12 Monate)</span>
          </div>
          <div id="utsTrend" class="uts-trend"></div>
        </div>
      `

      statHero(body.querySelector('#heroTotal'), { label: 'Gesamt-User', value: total, icon: 'users' })
      statHero(body.querySelector('#heroListeners'), { label: 'Listener', value: listeners.length, icon: 'headphones', accent: '#6366f1' })
      statHero(body.querySelector('#heroPodcasters'), { label: 'Podcaster', value: podcasters.length, icon: 'mic', accent: '#ec4899' })
      statHero(body.querySelector('#heroConv'), { label: 'Podcaster-Anteil', value: convRate, suffix: '%', icon: 'trending-up', accent: '#10b981' })

      body.querySelectorAll('.stat-hero .value').forEach(el => {
        const raw = el.textContent.replace(/[^0-9.]/g, '')
        const num = parseFloat(raw)
        if (!isNaN(num)) countUp(el, num, { duration: 900 })
      })

      const donut = makeDonutChart(body.querySelector('#utsDonut'), {
        data: [
          { label: 'Listener', value: listeners.length, color: '#6366f1', key: 'listeners' },
          { label: 'Podcaster (unverif.)', value: podcasters.length - verifiedPodcasters.length, color: '#ec4899', key: 'podcasters' },
          { label: 'Podcaster (verif.)', value: verifiedPodcasters.length, color: '#10b981', key: 'verified' }
        ],
        size: 280,
        thickness: 36,
        centerLabel: `${convRate}%`,
        centerSub: 'Podcaster',
        onSegmentClick: (seg) => this._openSegmentDrawer(seg.key, all)
      })

      makeAreaChart(body.querySelector('#utsTrend'), {
        data: trend,
        x: 'month',
        series: [
          { key: 'listeners', label: 'Neue Listener', color: '#6366f1' },
          { key: 'podcasters', label: 'Neue Podcaster', color: '#ec4899' },
          { key: 'conversions', label: 'Conversions', color: '#10b981' }
        ],
        height: 260,
        smooth: true,
        gradient: true
      })

      body.querySelectorAll('.legend-item').forEach(btn => {
        btn.addEventListener('mouseenter', () => donut?.highlight?.(btn.dataset.seg))
        btn.addEventListener('mouseleave', () => donut?.highlight?.(null))
        btn.addEventListener('click', () => this._openSegmentDrawer(btn.dataset.seg, all))
      })
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
      filtered = allUsers.filter(u => !u.is_podcaster)
      title = 'Listener'
    } else if (segment === 'podcasters') {
      filtered = allUsers.filter(u => u.is_podcaster && !u.is_verified)
      title = 'Podcaster (unverifiziert)'
    } else if (segment === 'verified') {
      filtered = allUsers.filter(u => u.is_podcaster && u.is_verified)
      title = 'Verifizierte Podcaster'
    } else {
      filtered = allUsers
      title = 'Alle User'
    }

    if (!filtered.length) {
      drawer({
        title,
        content: `
          <div class="empty-state">
            <div class="empty-icon">${iconHtml('users')}</div>
            <h3>Keine User in dieser Gruppe</h3>
            <p>Für das gewählte Segment liegen aktuell keine Datensätze vor.</p>
          </div>
        `
      })
      return
    }

    const rows = filtered.slice(0, 500).map(u => `
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
        <td>${u.is_podcaster ? '<span class="badge badge-pink">Podcaster</span>' : '<span class="badge badge-indigo">Listener</span>'}</td>
        <td>${u.is_verified ? '<span class="badge badge-green">✓ Verifiziert</span>' : '<span class="muted">—</span>'}</td>
        <td>${u.created_at ? fmtDateTime(u.created_at) : '—'}</td>
      </tr>
    `).join('')

    drawer({
      title: `${title} · ${fmtNumber(filtered.length)}`,
      width: 720,
      content: `
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
        ${filtered.length > 500 ? `<p class="muted center">Zeige erste 500 von ${fmtNumber(filtered.length)}. CSV-Export enthält alle.</p>` : ''}
      `,
      onMount: (drawerEl) => {
        const search = drawerEl.querySelector('#utsSearch')
        const tbody = drawerEl.querySelector('#utsRows')
        const onSearch = debounce(() => {
          const q = search.value.trim().toLowerCase()
          tbody.querySelectorAll('tr').forEach(tr => {
            tr.style.display = !q || tr.textContent.toLowerCase().includes(q) ? '' : 'none'
          })
        }, 120)
        search.addEventListener('input', onSearch)

        drawerEl.querySelector('[data-act="csv-seg"]').addEventListener('click', () => {
          exportCsv(filtered, { filename: `${segment}-users.csv` })
        })

        tbody.querySelectorAll('tr.row-clickable').forEach(tr => {
          tr.addEventListener('click', () => {
            const uid = tr.dataset.uid
            if (uid) showUserDetailModal(uid)
          })
        })
      }
    })
  }
}
