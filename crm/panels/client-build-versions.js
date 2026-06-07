import { sb } from '/lib/supabase.js'
import { toast, confirmDialog, fmtNumber, fmtDateTime, fmtRelativeTime, htmlEscape, iconHtml, spinnerHtml } from '/lib/ui.js'
import { makeBarChart, makeDonutChart } from '/lib/charts.js'
import { exportPanelAsPdf, exportCsv } from '/lib/export.js'
import { countUp, fadeIn, skeletonLoader } from '/lib/animations.js'
import { drawer, glassCard, statHero } from '/lib/layout-extras.js'
import { showUserDetailModal, sendBroadcastPush } from '/lib/panel-actions.js'

// ---------- Versionsvergleich (semver light) ----------
function parseVersion(v) {
  if (!v) return [0, 0, 0]
  const m = String(v).trim().replace(/^v/i, '').split(/[.\-+]/).map(s => parseInt(s, 10))
  return [m[0] || 0, m[1] || 0, m[2] || 0]
}
function cmpVersion(a, b) {
  const pa = parseVersion(a), pb = parseVersion(b)
  for (let i = 0; i < 3; i++) { if (pa[i] !== pb[i]) return pa[i] - pb[i] }
  return 0
}
function versionRank(v, sortedDesc) {
  const idx = sortedDesc.findIndex(x => cmpVersion(x, v) === 0)
  return idx < 0 ? sortedDesc.length : idx
}
function colorFor(rank) {
  if (rank === 0) return { fill: '#8b5cf6', label: 'Aktuell', tone: 'violet' }
  if (rank === 1) return { fill: '#eab308', label: 'Eine Version alt', tone: 'amber' }
  return { fill: '#ef4444', label: 'Mehrere Versionen alt', tone: 'red' }
}

// ---------- Daten laden ----------
async function fetchVersionData() {
  // RPC crm_app_versions_in_field und Tabelle user_devices existieren noch nicht im Schema.
  // Sobald sie angelegt sind, diese Funktion reaktivieren.
  return []
}

function normalize(rows) {
  const arr = rows.map(r => ({
    version: r.version,
    user_count: Number(r.user_count || r.users || 0),
    platforms: r.platforms || {},
    last_seen: r.last_seen || r.last_login_at || null
  })).filter(r => r.version && r.user_count > 0)
  const versions = [...new Set(arr.map(r => r.version))].sort((a, b) => cmpVersion(b, a))
  return arr.map(r => ({ ...r, rank: versionRank(r.version, versions) }))
    .sort((a, b) => cmpVersion(b.version, a.version))
}

async function fetchUsersOnVersion(version) {
  // RPC crm_users_on_app_version und Tabelle user_devices existieren noch nicht im Schema.
  // Sobald sie angelegt sind, diese Funktion reaktivieren.
  return []
}

export default {
  id: 'client-build-versions',
  title: 'App-Versionen im Feld',
  category: 'users',

  async mount(container) {
    try {
      container.innerHTML = `
        <div class="panel-shell">
          <div class="panel-head">
            <div>
              <h2>App-Versionen im Feld</h2>
              <p class="panel-sub">Verteilung aktiver Builds, Update-Druck und Force-Push pro Version.</p>
            </div>
            <div class="toolbar" id="cbv-toolbar">
              <button class="btn btn-ghost" data-act="refresh">${iconHtml('refresh')} Aktualisieren</button>
              <button class="btn btn-ghost" data-act="pdf">${iconHtml('file-text')} PDF</button>
              <button class="btn btn-ghost" data-act="csv">${iconHtml('download')} CSV</button>
            </div>
          </div>
          <div class="panel-body" id="cbv-body"></div>
        </div>
      `

      const body = container.querySelector('#cbv-body')
      body.innerHTML = skeletonLoader({ rows: 6, height: 64 })
      fadeIn(container)

      const state = { rows: [], latest: null }

      const renderAll = async () => {
        body.innerHTML = skeletonLoader({ rows: 6, height: 64 })
        try {
          const rows = await fetchVersionData()
          state.rows = rows
          state.latest = rows.length ? rows.map(r => r.version).sort((a, b) => cmpVersion(b, a))[0] : null
          renderContent(body, state, renderAll)
        } catch (err) {
          console.error(err)
          body.innerHTML = renderError(err)
          body.querySelector('[data-act="retry"]')?.addEventListener('click', renderAll)
        }
      }

      container.querySelector('[data-act="refresh"]').addEventListener('click', () => {
        toast('Aktualisiere…')
        renderAll()
      })
      container.querySelector('[data-act="pdf"]').addEventListener('click', () => {
        try {
          exportPanelAsPdf({ container, title: 'App-Versionen im Feld' })
        } catch (err) {
          console.error(err)
          toast(`PDF-Export fehlgeschlagen: ${err?.message || 'Fehler'}`, 'error')
        }
      })
      container.querySelector('[data-act="csv"]').addEventListener('click', () => {
        if (!state.rows.length) return toast('Keine Daten')
        try {
          exportCsv({
            filename: `app-versions-${new Date().toISOString().slice(0, 10)}.csv`,
            rows: state.rows.map(r => ({
              Version: r.version,
              Nutzer: r.user_count,
              Status: colorFor(r.rank).label,
              Plattformen: Object.entries(r.platforms).map(([k, v]) => `${k}:${v}`).join('|'),
              'Zuletzt aktiv': r.last_seen ? fmtDateTime(r.last_seen) : ''
            }))
          })
        } catch (err) {
          console.error(err)
          toast(`CSV-Export fehlgeschlagen: ${err?.message || 'Fehler'}`, 'error')
        }
      })

      await renderAll()
    } catch (mountErr) {
      console.error('client-build-versions mount failed', mountErr)
      container.innerHTML = `
        <div class="panel-shell">
          <div class="empty-state error">
            ${iconHtml('alert-triangle')}
            <h3>Panel konnte nicht geladen werden</h3>
            <p>${htmlEscape(mountErr?.message || 'Unbekannter Fehler beim Initialisieren')}</p>
            <button class="btn btn-primary" data-act="mount-retry">${iconHtml('refresh')} Erneut versuchen</button>
          </div>
        </div>
      `
      container.querySelector('[data-act="mount-retry"]')?.addEventListener('click', () => {
        try { this.mount(container) } catch (_) {}
      })
    }
  }
}

function renderError(err) {
  return `
    <div class="empty-state error">
      ${iconHtml('alert-triangle')}
      <h3>Konnte App-Versionen nicht laden</h3>
      <p>${htmlEscape(err?.message || 'Unbekannter Fehler')}</p>
      <button class="btn btn-primary" data-act="retry">${iconHtml('refresh')} Erneut versuchen</button>
    </div>
  `
}

function renderEmpty(body) {
  body.innerHTML = `
    <div class="glass-card" style="padding:2rem;text-align:center;">
      ${iconHtml('alert')}
      <p style="margin-top:1rem;">Daten kommen sobald die Tabelle <code>user_devices</code> oder das RPC <code>crm_app_versions_in_field</code> angelegt ist.</p>
    </div>
  `
}

function renderContent(body, state, refresh) {
  const rows = state.rows
  if (!rows.length) return renderEmpty(body)

  const totalUsers = rows.reduce((a, r) => a + r.user_count, 0)
  const latestUsers = rows.filter(r => r.rank === 0).reduce((a, r) => a + r.user_count, 0)
  const oneOld = rows.filter(r => r.rank === 1).reduce((a, r) => a + r.user_count, 0)
  const stale = rows.filter(r => r.rank >= 2).reduce((a, r) => a + r.user_count, 0)
  const adoption = totalUsers ? Math.round((latestUsers / totalUsers) * 100) : 0

  body.innerHTML = `
    <div class="cbv-grid">
      <div class="cbv-heros">
        ${statHero({ label: 'Nutzer gesamt', value: '<span data-cu="' + totalUsers + '">0</span>', icon: 'users', tone: 'neutral' })}
        ${statHero({ label: 'Auf aktueller Version', value: '<span data-cu="' + latestUsers + '">0</span>', sub: adoption + '% Adoption', icon: 'check-circle', tone: 'violet' })}
        ${statHero({ label: 'Eine Version alt', value: '<span data-cu="' + oneOld + '">0</span>', icon: 'clock', tone: 'amber' })}
        ${statHero({ label: 'Mehrere Versionen zurück', value: '<span data-cu="' + stale + '">0</span>', icon: 'alert-triangle', tone: 'red' })}
      </div>

      <div class="cbv-row">
        ${glassCard({
          title: 'Verteilung nach Version',
          subtitle: 'Klick auf Balken öffnet Nutzerliste & Force-Update',
          bodyHtml: '<div id="cbv-bar" style="height:' + Math.max(rows.length * 44 + 40, 220) + 'px"></div>'
        })}
        ${glassCard({
          title: 'Update-Druck',
          subtitle: 'Aktuell vs. veraltet',
          bodyHtml: '<div id="cbv-donut" style="height:260px"></div>'
        })}
      </div>

      <div class="glass-card">
        <div class="card-head">
          <div>
            <h3>Alle Versionen</h3>
            <p class="muted">Sortiert nach Version (neueste zuerst).</p>
          </div>
        </div>
        <div class="card-body">
          <table class="data-table data-table-hover">
            <thead>
              <tr>
                <th>Version</th>
                <th>Status</th>
                <th class="num">Nutzer</th>
                <th>Plattformen</th>
                <th>Zuletzt aktiv</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(r => {
                const c = colorFor(r.rank)
                const platforms = Object.entries(r.platforms || {}).map(([k, v]) => `<span class="chip chip-xs">${htmlEscape(k)} · ${fmtNumber(v)}</span>`).join(' ')
                return `
                  <tr data-version="${htmlEscape(r.version)}" class="row-clickable">
                    <td><strong>${htmlEscape(r.version)}</strong></td>
                    <td><span class="badge badge-${c.tone}">${c.label}</span></td>
                    <td class="num">${fmtNumber(r.user_count)}</td>
                    <td>${platforms || '<span class="muted">—</span>'}</td>
                    <td>${r.last_seen ? fmtRelativeTime(r.last_seen) : '<span class="muted">—</span>'}</td>
                    <td class="row-actions">
                      <button class="btn btn-xs" data-act="users" data-version="${htmlEscape(r.version)}">${iconHtml('users')} Nutzer</button>
                      ${r.rank > 0 ? `<button class="btn btn-xs btn-warn" data-act="force" data-version="${htmlEscape(r.version)}">${iconHtml('bell')} Force-Push</button>` : ''}
                    </td>
                  </tr>
                `
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `

  body.querySelectorAll('[data-cu]').forEach(el => {
    const target = parseInt(el.dataset.cu, 10) || 0
    countUp(el, target, { duration: 900 })
  })

  const sortedAsc = [...rows].sort((a, b) => a.user_count - b.user_count)
  try {
    makeBarChart(body.querySelector('#cbv-bar'), {
      horizontal: true,
      categories: sortedAsc.map(r => r.version),
      series: [{
        name: 'Nutzer',
        data: sortedAsc.map(r => ({
          x: r.version,
          y: r.user_count,
          fillColor: colorFor(r.rank).fill
        }))
      }],
      onBarClick: (i) => {
        const r = sortedAsc[i]
        if (r) openVersionDrawer(r, state, refresh)
      }
    })
  } catch (err) {
    console.error('bar chart failed', err)
  }

  try {
    makeDonutChart(body.querySelector('#cbv-donut'), {
      labels: ['Aktuell', 'Eine alt', 'Mehrere alt'],
      series: [latestUsers, oneOld, stale],
      colors: ['#8b5cf6', '#eab308', '#ef4444']
    })
  } catch (err) {
    console.error('donut chart failed', err)
  }

  body.querySelectorAll('tr[data-version]').forEach(tr => {
    tr.addEventListener('click', (ev) => {
      if (ev.target.closest('button')) return
      const v = tr.dataset.version
      const r = rows.find(x => x.version === v)
      if (r) openVersionDrawer(r, state, refresh)
    })
  })
  body.querySelectorAll('button[data-act="users"]').forEach(b => {
    b.addEventListener('click', (e) => {
      e.stopPropagation()
      const r = rows.find(x => x.version === b.dataset.version)
      if (r) openVersionDrawer(r, state, refresh)
    })
  })
  body.querySelectorAll('button[data-act="force"]').forEach(b => {
    b.addEventListener('click', async (e) => {
      e.stopPropagation()
      const v = b.dataset.version
      const r = rows.find(x => x.version === v)
      if (r) await forceUpdatePush(r, refresh)
    })
  })
}

async function openVersionDrawer(versionRow, state, refresh) {
  const c = colorFor(versionRow.rank)
  const d = drawer({
    title: `Version ${versionRow.version}`,
    subtitle: `${fmtNumber(versionRow.user_count)} Nutzer · ${c.label}`,
    width: 560,
    bodyHtml: `
      <div class="drawer-toolbar">
        <span class="badge badge-${c.tone}">${c.label}</span>
        ${versionRow.rank > 0
          ? `<button class="btn btn-warn" data-act="force-bulk">${iconHtml('bell')} Force-Update an alle (${fmtNumber(versionRow.user_count)})</button>`
          : `<span class="muted">Diese Version ist aktuell – kein Push nötig.</span>`}
      </div>
      <div id="cbv-userlist" class="user-list">${typeof spinnerHtml === 'function' ? spinnerHtml() : 'Lade Nutzer…'}</div>
    `
  })

  const listEl = d.el.querySelector('#cbv-userlist')
  try {
    const users = await fetchUsersOnVersion(versionRow.version)
    if (!users.length) {
      listEl.innerHTML = `
        <div class="glass-card" style="padding:1.5rem;text-align:center;">
          ${iconHtml('alert')}
          <p style="margin-top:.75rem;">Daten kommen sobald die Tabelle <code>user_devices</code> oder das RPC <code>crm_users_on_app_version</code> angelegt ist.</p>
        </div>
      `
    } else {
      listEl.innerHTML = users.map(u => `
        <div class="user-row" data-uid="${htmlEscape(u.id)}">
          <div class="avatar">${u.avatar_url ? `<img src="${htmlEscape(u.avatar_url)}" alt="">` : iconHtml('user')}</div>
          <div class="user-meta">
            <div class="user-name">${htmlEscape(u.display_name || u.username || '—')}</div>
            <div class="user-sub muted">${htmlEscape(u.username ? '@' + u.username : (u.email || ''))} ${u.platform ? '· ' + htmlEscape(u.platform) : ''}</div>
          </div>
          <div class="user-last muted">${u.last_login_at ? fmtRelativeTime(u.last_login_at) : ''}</div>
        </div>
      `).join('')
      listEl.querySelectorAll('.user-row').forEach(row => {
        row.addEventListener('click', () => showUserDetailModal(row.dataset.uid))
      })
    }
  } catch (err) {
    console.error(err)
    listEl.innerHTML = `<div class="empty-state error small">${iconHtml('alert-triangle')}<p>${htmlEscape(err.message || 'Fehler beim Laden')}</p></div>`
  }

  d.el.querySelector('[data-act="force-bulk"]')?.addEventListener('click', async () => {
    await forceUpdatePush(versionRow, refresh, d)
  })
}

async function forceUpdatePush(versionRow, refresh, drawerInstance) {
  const ok = await confirmDialog({
    title: 'Force-Update-Push senden?',
    body: `Alle <strong>${fmtNumber(versionRow.user_count)}</strong> Nutzer auf Version <strong>${htmlEscape(versionRow.version)}</strong> erhalten eine Push-Nachricht mit der Aufforderung zu aktualisieren.`,
    confirmLabel: 'Push senden',
    danger: true
  })
  if (!ok) return

  try {
    let sent = 0
    try {
      const { data, error } = await sb.rpc('crm_force_update_push', { p_version: versionRow.version })
      if (error) throw error
      sent = Number(data?.sent ?? data ?? versionRow.user_count)
    } catch (rpcErr) {
      const res = await sendBroadcastPush({
        title: 'Update verfügbar',
        body: 'Bitte aktualisiere Podfluence auf die neueste Version für beste Stabilität.',
        segment: { app_version: versionRow.version },
        data: { type: 'force_update', target_version: versionRow.version }
      })
      sent = Number(res?.sent || versionRow.user_count)
    }
    toast(`Push an ${fmtNumber(sent)} Nutzer gesendet`, 'success')
    drawerInstance?.close?.()
    refresh?.()
  } catch (err) {
    console.error(err)
    toast(`Fehler: ${err.message || 'Push fehlgeschlagen'}`, 'error')
  }
}
