import { sb } from '/lib/supabase.js?v=20260608l'
import { toast, confirmDialog, fmtNumber, fmtDateTime, fmtRelativeTime, htmlEscape, iconHtml, spinnerHtml } from '/lib/ui.js?v=20260608l'
import { makeBarChart, makeDonutChart } from '/lib/charts.js?v=20260608l'
import { exportPanelAsPdf, exportCsv } from '/lib/export.js?v=20260608l'
import { countUp, fadeIn, skeletonLoader } from '/lib/animations.js?v=20260608l'
import { drawer, glassCard, statHero } from '/lib/layout-extras.js?v=20260608l'
import { showUserDetailModal, sendBroadcastPush } from '/lib/panel-actions.js?v=20260608l'

// App Store Review 6.6.: Aktive Runtimes 1.3.0 / 1.3.1 / 1.4.0.
// Alles darunter gilt als nicht mehr unterstützt und löst Force-Push-Empfehlung aus.
const MIN_SUPPORTED_VERSION = '1.4.0'
const STALE_RATE_THRESHOLD = 0.15 // 15%

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
  // admin_build_versions → [{ version, count }]
  const { data, error } = await sb.rpc('admin_build_versions')
  if (error) throw error
  return (data || []).map(r => ({
    version: String(r.version || 'unbekannt'),
    user_count: Number(r.count || 0),
    platforms: {},
    last_seen: null
  }))
}

function normalize(rows) {
  // FIX #1: r.users fallback entfernt — admin_build_versions liefert nur count, bereits als user_count gemappt
  const arr = rows.map(r => ({
    version: r.version,
    user_count: Number(r.user_count || 0),
    platforms: {},
    last_seen: null
  })).filter(r => r.version && r.user_count > 0)
  const versions = [...new Set(arr.map(r => r.version))].sort((a, b) => cmpVersion(b, a))
  return arr.map(r => ({ ...r, rank: versionRank(r.version, versions) }))
    .sort((a, b) => cmpVersion(b.version, a.version))
}

// FIX #3: Kein 5000-Row-Dump mehr — direkt per p_search auf die Version filtern
async function fetchUsersOnVersion(version) {
  const { data, error } = await sb.rpc('admin_users_list_full', {
    p_limit: 500,
    p_offset: 0,
    p_search: String(version)
  })
  if (error) throw error
  // p_search trifft ggf. auch andere Felder — clientseitig auf exakte Version einschränken
  return (data || []).filter(u => String(u.client_build_version || '') === String(version))
}

// Exportiert als benannte Funktion damit mount() sich sicher selbst aufrufen kann (FIX #8)
async function mountPanel(container) {
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
        exportPanelAsPdf(container, { filename: `app-versions-${new Date().toISOString().slice(0,10)}.pdf`, title: 'App-Versionen im Feld' })
      } catch (err) {
        console.error(err)
        toast(`PDF-Export fehlgeschlagen: ${err?.message || 'Fehler'}`, 'error')
      }
    })
    // FIX #9 (low): Plattformen-Spalte aus CSV-Export entfernt — immer leer
    container.querySelector('[data-act="csv"]').addEventListener('click', () => {
      if (!state.rows.length) return toast('Keine Daten')
      try {
        exportCsv(
          state.rows.map(r => ({
            Version: r.version,
            Nutzer: r.user_count,
            Status: colorFor(r.rank).label
          })),
          `app-versions-${new Date().toISOString().slice(0, 10)}.csv`
        )
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
    // FIX #8: mountPanel statt this.mount — korrekte Referenz unabhängig vom this-Kontext
    container.querySelector('[data-act="mount-retry"]')?.addEventListener('click', () => {
      mountPanel(container)
    })
  }
}

export default {
  id: 'client-build-versions',
  title: 'App-Versionen im Feld',
  category: 'users',
  mount: mountPanel
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

// FIX #5: Empty-State-Text aktualisiert — kein Verweis auf nicht-existente user_devices / crm_app_versions_in_field
function renderEmpty(body) {
  body.innerHTML = `
    <div class="glass-card" style="padding:2rem;text-align:center;">
      ${iconHtml('alert')}
      <p style="margin-top:1rem;">Kein Build-Versions-Tracking vorhanden. Sobald Nutzer <code>client_build_version</code> in der users-Tabelle schreiben, erscheinen hier Daten.</p>
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

  // Smart-Alert: User unterhalb MIN_SUPPORTED_VERSION
  const unsupportedUsers = rows
    .filter(r => cmpVersion(r.version, MIN_SUPPORTED_VERSION) < 0)
    .reduce((a, r) => a + r.user_count, 0)
  const unsupportedPct = totalUsers ? unsupportedUsers / totalUsers : 0
  const showStaleBanner = unsupportedPct > STALE_RATE_THRESHOLD
  const bannerHtml = showStaleBanner ? `
    <div class="glass-card" style="border:1px solid #ef4444;background:rgba(239,68,68,0.08);padding:1rem 1.25rem;display:flex;align-items:center;gap:.85rem;margin-bottom:1rem;">
      <div style="color:#ef4444;display:flex;align-items:center;">${iconHtml('alert-triangle')}</div>
      <div style="flex:1;">
        <strong style="color:#ef4444;">${fmtNumber(unsupportedUsers)} Nutzer (${Math.round(unsupportedPct * 100)}%) laufen auf einer Version &lt; ${htmlEscape(MIN_SUPPORTED_VERSION)}</strong>
        <div class="muted" style="margin-top:.15rem;">Force-Push empfohlen — App Store Review erfordert aktuelle Runtime.</div>
      </div>
    </div>
  ` : ''

  // FIX #2: Spalten "Plattformen" und "Zuletzt aktiv" entfernt — admin_build_versions liefert keine Plattform-/Last-seen-Daten
  body.innerHTML = `
    <div class="cbv-grid">
      ${bannerHtml}
      <div class="cbv-heros">
        ${statHero({ label: 'Nutzer gesamt', value: totalUsers, icon: 'users' })}
        ${statHero({ label: 'Auf aktueller Version', value: latestUsers, change: adoption + '% Adoption', icon: 'check-circle' })}
        ${statHero({ label: 'Eine Version alt', value: oneOld, icon: 'clock' })}
        ${statHero({ label: 'Mehrere Versionen zurück', value: stale, icon: 'alert-triangle' })}
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
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(r => {
                const c = colorFor(r.rank)
                const unsupported = cmpVersion(r.version, MIN_SUPPORTED_VERSION) < 0
                const rowStyle = unsupported ? ' style="box-shadow:inset 3px 0 0 #ef4444;background:rgba(239,68,68,0.04);"' : ''
                const unsupportedBadge = unsupported ? ` <span class="badge badge-red" title="Unter MIN_SUPPORTED_VERSION ${MIN_SUPPORTED_VERSION}">Nicht unterstützt</span>` : ''
                return `
                  <tr data-version="${htmlEscape(r.version)}" class="row-clickable"${rowStyle}>
                    <td><strong>${htmlEscape(r.version)}</strong></td>
                    <td><span class="badge badge-${c.tone}">${c.label}</span>${unsupportedBadge}</td>
                    <td class="num">${fmtNumber(r.user_count)}</td>
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

  const sortedAsc = [...rows].sort((a, b) => a.user_count - b.user_count)
  try {
    makeBarChart(body.querySelector('#cbv-bar'), {
      horizontal: true,
      categories: sortedAsc.map(r => r.version),
      series: [{
        name: 'Nutzer',
        data: sortedAsc.map(r => r.user_count)
      }],
      colors: sortedAsc.map(r => colorFor(r.rank).fill),
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
      values: [latestUsers, oneOld, stale],
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
    width: 560,
    contentHtml: `
      <div class="drawer-subtitle muted" style="margin-bottom:.75rem;">${fmtNumber(versionRow.user_count)} Nutzer · ${c.label}</div>
      <div class="drawer-toolbar" style="display:flex;align-items:center;gap:.75rem;margin-bottom:1rem;">
        <span class="badge badge-${c.tone}">${c.label}</span>
        ${versionRow.rank > 0
          ? `<button class="btn btn-warn" data-act="force-bulk">${iconHtml('bell')} Force-Update an alle (${fmtNumber(versionRow.user_count)})</button>`
          : `<span class="muted">Diese Version ist aktuell – kein Push nötig.</span>`}
      </div>
      <div id="cbv-userlist" class="user-list">${typeof spinnerHtml === 'function' ? spinnerHtml() : '<div class="muted">Lade…</div>'}</div>
    `
  })

  const listEl = d.el.querySelector('#cbv-userlist')
  try {
    const users = await fetchUsersOnVersion(versionRow.version)
    if (!users.length) {
      // FIX #6: Stale-Text ersetzt — kein Verweis auf nicht-existente Tabellen/RPCs
      listEl.innerHTML = `
        <div class="glass-card" style="padding:1.5rem;text-align:center;">
          ${iconHtml('alert')}
          <p style="margin-top:.75rem;">Keine Nutzer auf dieser Version gefunden. Möglicherweise ist <code>client_build_version</code> in der users-Tabelle noch nicht befüllt.</p>
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
          <div class="user-last muted">${u.last_seen_at ? fmtRelativeTime(u.last_seen_at) : ''}</div>
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

// FIX #4: crm_force_update_push entfernt (RPC existiert nicht) — direkt sendBroadcastPush aufrufen
// Parameter-Key 'segment' auf 'audience' korrigiert gemäß send_broadcast_push(title,body,audience,deep_link?)
async function forceUpdatePush(versionRow, refresh, drawerInstance) {
  const ok = await confirmDialog({
    title: 'Force-Update-Push senden?',
    body: `Alle <strong>${fmtNumber(versionRow.user_count)}</strong> Nutzer auf Version <strong>${htmlEscape(versionRow.version)}</strong> erhalten eine Push-Nachricht mit der Aufforderung zu aktualisieren.`,
    confirmLabel: 'Push senden',
    danger: true
  })
  if (!ok) return

  try {
    const res = await sendBroadcastPush(
      'Update verfügbar',
      'Bitte aktualisiere Podfluence auf die neueste Version für beste Stabilität.',
      { app_version: versionRow.version },
      null
    )
    const sent = Number(res?.sent || versionRow.user_count)
    toast(`Push an ${fmtNumber(sent)} Nutzer gesendet`, 'success')
    drawerInstance?.close?.()
    refresh?.()
  } catch (err) {
    console.error(err)
    toast(`Fehler: ${err.message || 'Push fehlgeschlagen'}`, 'error')
  }
}
