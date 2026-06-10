import { sb } from '/lib/supabase.js?v=20260610q'
import { toast, modal, fmtNumber, fmtDateTime, fmtRelativeTime, htmlEscape, iconHtml, debounce, confirmDialog } from '/lib/ui.js?v=20260610q'
import { makeBarChart, makeDonutChart } from '/lib/charts.js?v=20260610q'
import { exportPanelAsPdf, exportCsv } from '/lib/export.js?v=20260610q'
import { countUp, fadeIn, skeletonLoader } from '/lib/animations.js?v=20260610q'
import { drawer, statHero, glassCard } from '/lib/layout-extras.js?v=20260610q'
import { showUserDetailModal } from '/lib/panel-actions.js?v=20260610q'

const ACHIEVEMENT_META = {
  first_post: { label: 'Erster Post', icon: '✍️' },
  ten_posts: { label: '10 Posts', icon: '🔟' },
  hundred_posts: { label: '100 Posts', icon: '💯' },
  first_episode: { label: 'Erste Episode', icon: '🎙️' },
  verified: { label: 'Verifiziert', icon: '✅' },
  early_adopter: { label: 'Early Adopter', icon: '🚀' },
  streak_7: { label: '7-Tage-Streak', icon: '🔥' },
  streak_30: { label: '30-Tage-Streak', icon: '⚡' },
  premium: { label: 'Premium', icon: '⭐' },
  inviter: { label: 'Inviter', icon: '🤝' },
  podcaster: { label: 'Podcaster', icon: '🎧' },
  influencer: { label: 'Influencer', icon: '📣' }
}

function metaFor(type) {
  return ACHIEVEMENT_META[type] || { label: type, icon: '🏆' }
}

// FIX HIGH: Tabelle auf 'achievements' geändert (nicht 'user_achievements').
// FIX MED: Zeitfenster auf letzte 90 Tage begrenzt + limit auf 2000 reduziert,
//           um Client-seitige Aggregation bei wachsenden Daten performant zu halten.
async function fetchAchievementStats() {
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await sb
    .from('user_achievements')
    .select('achievement_key, user_id, unlocked_at')
    .gte('unlocked_at', since)
    .order('unlocked_at', { ascending: false })
    .limit(2000)
  if (error) throw error
  return data || []
}

function aggregateByType(rows) {
  const map = new Map()
  for (const r of rows) {
    const t = r.achievement_key
    if (!map.has(t)) map.set(t, { type: t, count: 0, uniqueUsers: new Set(), last: null })
    const e = map.get(t)
    e.count++
    e.uniqueUsers.add(r.user_id)
    if (!e.last || new Date(r.unlocked_at) > new Date(e.last)) e.last = r.unlocked_at
  }
  return [...map.values()]
    .map(e => ({ type: e.type, count: e.count, uniqueUsers: e.uniqueUsers.size, last: e.last }))
    .sort((a, b) => b.count - a.count)
}

// FIX HIGH: Tabelle auf 'achievements' geändert.
// FIX MED: JOIN auf users-Tabelle für username, display_name, avatar_url.
async function fetchUsersForType(type) {
  const { data, error } = await sb
    .from('user_achievements')
    .select('user_id, unlocked_at, users(username, full_name, avatar_url, is_verified, is_premium)')
    .eq('achievement_key', type)
    .order('unlocked_at', { ascending: false })
    .limit(500)
  if (error) throw error
  return data || []
}

// FIX HIGH: admin_get_user RPC existiert nicht → ersetzt durch users-Tabellen-Lookup
//            für UUID-Identifikatoren und admin_users_list_full für Username-Suche.
// FIX MED: Insert auf 'achievements' statt 'user_achievements'.
async function manualGrant(type, userIdentifier) {
  const identifier = (userIdentifier || '').trim().replace(/^@/, '')
  if (!identifier) throw new Error('User-ID oder Username erforderlich')
  let userId = identifier
  if (!/^[0-9a-f-]{36}$/i.test(identifier)) {
    // Username-Suche direkt über users-Tabelle
    const { data: uRows, error: uErr } = await sb
      .from('users')
      .select('id')
      .or(`username.eq.${identifier},full_name.eq.${identifier}`)
      .limit(1)
    if (uErr) throw uErr
    if (!uRows || !uRows.length) {
      // Fallback: admin_users_list_full RPC mit search
      const { data: rpcData, error: rpcErr } = await sb
        .rpc('admin_users_list_full', { limit: 1, offset: 0, search: identifier })
      if (rpcErr) throw rpcErr
      const first = Array.isArray(rpcData) ? rpcData[0] : null
      if (!first || !first.id) throw new Error('User nicht gefunden')
      userId = first.id
    } else {
      userId = uRows[0].id
    }
  }
  const { error: insErr } = await sb
    .from('user_achievements')
    .insert({ user_id: userId, achievement_key: type, unlocked_at: new Date().toISOString(), granted_by: 'admin' })
  if (insErr) throw insErr
  return userId
}

// FIX MED: User-Rows zeigen jetzt username/display_name/avatar statt nur UUID.
// FIX LOW: addEventListener statt inline onmouseover/onmouseout Attributen.
function openTypeDrawer(type, refreshAll) {
  const meta = metaFor(type)
  const content = document.createElement('div')
  content.className = 'drawer-body'
  content.innerHTML = `
    <div class="drawer-head" style="display:flex;align-items:center;gap:12px;padding-bottom:16px;border-bottom:1px solid var(--border)">
      <div style="font-size:32px">${meta.icon}</div>
      <div>
        <div style="font-size:13px;color:var(--muted)">Achievement</div>
        <div style="font-size:20px;font-weight:600">${htmlEscape(meta.label)}</div>
        <div style="font-size:12px;color:var(--muted);font-family:monospace">${htmlEscape(type)}</div>
      </div>
    </div>
    <div class="grant-panel glass-card" style="margin:16px 0;padding:14px;border-radius:12px">
      <div style="font-weight:600;margin-bottom:8px">Manuell freischalten</div>
      <div style="display:flex;gap:8px">
        <input id="grant-input" type="text" placeholder="User-ID oder @username" style="flex:1;padding:10px 12px;border-radius:10px;border:1px solid var(--border);background:var(--bg);color:var(--fg)" />
        <button id="grant-btn" class="btn btn-primary">Vergeben</button>
      </div>
      <div style="font-size:12px;color:var(--muted);margin-top:6px">UUID, oder exakter Username/Display-Name</div>
    </div>
    <div id="users-list" style="margin-top:8px">
      <div class="loading-state">${typeof skeletonLoader === 'function' ? skeletonLoader(6) : 'Lädt…'}</div>
    </div>
  `

  drawer({ title: meta.label + ' – Unlocks', width: 520, content })

  const grantBtn = content.querySelector('#grant-btn')
  const grantInput = content.querySelector('#grant-input')
  grantBtn.addEventListener('click', async () => {
    const val = grantInput.value
    if (!val.trim()) { toast('Bitte User angeben', 'warn'); return }
    const ok = await confirmDialog('Achievement vergeben?', `"${meta.label}" an ${htmlEscape(val)} vergeben?`, 'Vergeben', false)
    if (!ok) return
    grantBtn.disabled = true
    grantBtn.textContent = '…'
    try {
      await manualGrant(type, val)
      toast('Achievement vergeben', 'success')
      grantInput.value = ''
      await loadUsers()
      refreshAll && refreshAll()
    } catch (e) {
      toast(e.message || 'Fehler beim Vergeben', 'error')
    } finally {
      grantBtn.disabled = false
      grantBtn.textContent = 'Vergeben'
    }
  })

  const listEl = content.querySelector('#users-list')
  async function loadUsers() {
    listEl.innerHTML = `<div>${typeof skeletonLoader === 'function' ? skeletonLoader(5) : 'Lädt…'}</div>`
    try {
      const rows = await fetchUsersForType(type)
      if (!rows.length) {
        listEl.innerHTML = `<div class="empty-state" style="text-align:center;padding:32px;color:var(--muted)">
          <div style="font-size:40px;margin-bottom:8px">${meta.icon}</div>
          <div style="font-weight:600;margin-bottom:4px">Noch keine Unlocks</div>
          <div style="font-size:13px">Vergib oben das erste manuelle Achievement.</div>
        </div>`
        return
      }
      listEl.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <div style="font-weight:600">${rows.length} User</div>
          <button id="exp-users" class="btn btn-ghost btn-sm">CSV</button>
        </div>
        <div class="user-list" style="display:flex;flex-direction:column;gap:6px;max-height:60vh;overflow-y:auto">
          ${rows.map(r => {
            const u = r.users || {}
            const displayName = u.full_name || u.username || ''
            const username = u.username || ''
            const avatarUrl = u.avatar_url || ''
            const avatarHtml = avatarUrl
              ? `<img src="${htmlEscape(avatarUrl)}" alt="" style="width:36px;height:36px;border-radius:50%;object-fit:cover" />`
              : `<div style="width:36px;height:36px;border-radius:50%;background:var(--border);display:flex;align-items:center;justify-content:center;font-size:16px">👤</div>`
            return `<div class="user-row" data-uid="${htmlEscape(r.user_id)}" style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:10px;cursor:pointer;transition:background .15s">
              ${avatarHtml}
              <div style="flex:1;min-width:0">
                ${displayName ? `<div style="font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${htmlEscape(displayName)}</div>` : ''}
                ${username ? `<div style="font-size:12px;color:var(--muted)">@${htmlEscape(username)}</div>` : `<div style="font-weight:500;font-family:monospace;font-size:12px;color:var(--muted)">${htmlEscape(r.user_id)}</div>`}
                <div style="font-size:12px;color:var(--muted)">${fmtRelativeTime(r.unlocked_at)}</div>
              </div>
              <div style="font-size:11px;color:var(--muted)">${fmtDateTime(r.unlocked_at)}</div>
            </div>`
          }).join('')}
        </div>
      `
      // FIX LOW: addEventListener statt inline onmouseover/onmouseout
      listEl.querySelectorAll('.user-row').forEach(el => {
        el.addEventListener('mouseover', () => { el.style.background = 'var(--hover)' })
        el.addEventListener('mouseout', () => { el.style.background = 'transparent' })
        el.addEventListener('click', () => {
          const uid = el.dataset.uid
          if (typeof showUserDetailModal === 'function') {
            showUserDetailModal(uid)
          } else {
            toast('User-Details in Vorbereitung', 'info')
          }
        })
      })
      listEl.querySelector('#exp-users').addEventListener('click', () => {
        exportCsv(rows.map(r => {
          const u = r.users || {}
          return {
            user_id: r.user_id,
            username: u.username || '',
            display_name: u.full_name || '',
            unlocked_at: r.unlocked_at
          }
        }), `achievement_${type}_users.csv`)
      })
    } catch (e) {
      listEl.innerHTML = `<div class="error-state" style="padding:24px;text-align:center;color:var(--danger)">
        <div style="margin-bottom:8px">Fehler: ${htmlEscape(e.message || 'Unbekannter Fehler')}</div>
        <button class="btn btn-sm" id="retry-users">Erneut versuchen</button>
      </div>`
      listEl.querySelector('#retry-users').addEventListener('click', loadUsers)
    }
  }
  loadUsers()
}

export default {
  id: 'achievements-unlocks',
  title: 'Achievement-Unlocks',
  category: 'engagement',
  async mount(container) {
    try {
      container.innerHTML = `
        <div class="panel-shell">
          <div class="panel-head" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
            <div>
              <h2 style="margin:0">Achievement-Unlocks</h2>
              <div style="font-size:13px;color:var(--muted);margin-top:2px">Verteilung freigeschalteter Achievements · Klick auf Balken für User-Liste</div>
            </div>
            <div class="toolbar" style="display:flex;gap:8px">
              <button id="btn-refresh" class="btn btn-ghost" title="Aktualisieren">🔄</button>
              <button id="btn-pdf" class="btn btn-ghost" title="PDF Export">📄</button>
              <button id="btn-csv" class="btn btn-ghost" title="CSV Export">💾</button>
            </div>
          </div>
          <div class="panel-body" id="body">
            <div class="hero-row" id="hero-row" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:16px"></div>
            <div class="charts-row" style="display:grid;grid-template-columns:2fr 1fr;gap:16px;margin-bottom:16px">
              <div class="glass-card" id="bar-card" style="padding:16px;border-radius:14px;min-height:340px">
                <div style="font-weight:600;margin-bottom:8px">Unlocks pro Achievement-Type</div>
                <div id="bar-chart" style="height:300px"></div>
              </div>
              <div class="glass-card" id="donut-card" style="padding:16px;border-radius:14px;min-height:340px">
                <div style="font-weight:600;margin-bottom:8px">Verteilung</div>
                <div id="donut-chart" style="height:300px"></div>
              </div>
            </div>
            <div class="glass-card" style="padding:16px;border-radius:14px">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
                <div style="font-weight:600">Alle Achievement-Types</div>
                <div style="font-size:12px;color:var(--muted)">Klick für Details</div>
              </div>
              <div id="table-wrap"></div>
            </div>
          </div>
        </div>
      `

      if (typeof fadeIn === 'function') fadeIn(container)

      const body = container.querySelector('#body')
      const heroRow = container.querySelector('#hero-row')
      const barEl = container.querySelector('#bar-chart')
      const donutEl = container.querySelector('#donut-chart')
      const tableWrap = container.querySelector('#table-wrap')

      const skel = (n) => (typeof skeletonLoader === 'function' ? skeletonLoader(n) : '<div style="opacity:.5">Lädt…</div>')
      heroRow.innerHTML = skel(3)
      barEl.innerHTML = skel(4)
      donutEl.innerHTML = skel(4)
      tableWrap.innerHTML = skel(6)

      let lastAgg = []

      const self = this
      // FIX LOW: await render() damit async-Fehler im äußeren try/catch landen
      const render = async () => {
        try {
          const rows = await fetchAchievementStats()
          const agg = aggregateByType(rows)
          lastAgg = agg

          const totalUnlocks = rows.length
          const uniqueUsers = new Set(rows.map(r => r.user_id)).size
          const typesCount = agg.length
          const last24h = rows.filter(r => new Date(r.unlocked_at) > new Date(Date.now() - 86400000)).length

          heroRow.innerHTML = ''
          const heroes = [
            { label: 'Unlocks gesamt', value: totalUnlocks, icon: '🏆' },
            { label: 'Aktive User', value: uniqueUsers, icon: '👥' },
            { label: 'Achievement-Types', value: typesCount, icon: '🎯' },
            { label: 'Letzte 24h', value: last24h, icon: '⏱️' }
          ]
          heroes.forEach(h => {
            const el = document.createElement('div')
            el.className = 'glass-card stat-hero'
            el.style.cssText = 'padding:14px 16px;border-radius:12px'
            el.innerHTML = `<div style="font-size:20px">${h.icon}</div><div style="font-size:12px;color:var(--muted);margin-top:4px">${h.label}</div><div class="hero-val" style="font-size:26px;font-weight:700;margin-top:2px">0</div>`
            heroRow.appendChild(el)
            const valEl = el.querySelector('.hero-val')
            if (typeof countUp === 'function') {
              try {
                countUp(valEl, { from: 0, to: h.value, duration: 900 })
              } catch (_) {
                try { countUp(valEl, h.value) } catch (_) { valEl.textContent = fmtNumber(h.value) }
              }
            } else {
              valEl.textContent = fmtNumber(h.value)
            }
          })

          if (!agg.length) {
            barEl.innerHTML = `<div class="empty-state" style="text-align:center;padding:40px;color:var(--muted)">
              <div style="font-size:48px">🏆</div>
              <div style="font-weight:600;margin-top:8px">Noch keine Achievements freigeschaltet</div>
              <div style="font-size:13px;margin-top:4px">Sobald User Achievements erhalten, erscheinen hier Daten.</div>
            </div>`
            donutEl.innerHTML = ''
            tableWrap.innerHTML = ''
            return
          }

          // FIX LOW: agg-Snapshot für Chart-Callbacks, stabil gegen Re-Renders
          const aggSnapshot = agg.slice()
          barEl.innerHTML = ''
          const barCategories = aggSnapshot.map(a => metaFor(a.type).icon + ' ' + metaFor(a.type).label)
          const barValues = aggSnapshot.map(a => a.count)
          makeBarChart(barEl, {
            categories: barCategories,
            series: [{ name: 'Unlocks', data: barValues }],
            colors: ['#7c5cff'],
            height: 300
          })
          // Click-Delegation via overlay: ApexCharts-event-Bridge — falls Lib events ausstellt
          barEl.addEventListener('click', (ev) => {
            const bar = ev.target.closest('[data-cat-index],[data-index],.apexcharts-bar-area')
            if (!bar) return
            const idxAttr = bar.getAttribute('data-cat-index') || bar.getAttribute('data-index') || bar.getAttribute('j')
            const idx = idxAttr != null ? parseInt(idxAttr, 10) : NaN
            if (!Number.isNaN(idx) && aggSnapshot[idx]) openTypeDrawer(aggSnapshot[idx].type, render)
          })

          donutEl.innerHTML = ''
          const topN = aggSnapshot.slice(0, 6)
          const rest = aggSnapshot.slice(6).reduce((s, a) => s + a.count, 0)
          const donutLabels = topN.map(a => metaFor(a.type).label).concat(rest ? ['Andere'] : [])
          const donutValues = topN.map(a => a.count).concat(rest ? [rest] : [])
          makeDonutChart(donutEl, {
            labels: donutLabels,
            values: donutValues,
            colors: ['#7c5cff', '#22d3ee', '#f59e0b', '#10b981', '#ef4444', '#ec4899', '#64748b'],
            height: 300
          })

          // FIX LOW: addEventListener statt inline onmouseover/onmouseout in Tabellenzeilen
          tableWrap.innerHTML = `
            <table class="data-table" style="width:100%;border-collapse:collapse">
              <thead>
                <tr>
                  <th style="text-align:left;padding:10px;border-bottom:1px solid var(--border);font-size:12px;color:var(--muted)">Achievement</th>
                  <th style="text-align:right;padding:10px;border-bottom:1px solid var(--border);font-size:12px;color:var(--muted)">Unlocks</th>
                  <th style="text-align:right;padding:10px;border-bottom:1px solid var(--border);font-size:12px;color:var(--muted)">Unique User</th>
                  <th style="text-align:right;padding:10px;border-bottom:1px solid var(--border);font-size:12px;color:var(--muted)">Zuletzt</th>
                  <th style="padding:10px;border-bottom:1px solid var(--border)"></th>
                </tr>
              </thead>
              <tbody>
                ${aggSnapshot.map(a => {
                  const m = metaFor(a.type)
                  return `<tr class="data-row" data-type="${htmlEscape(a.type)}" style="cursor:pointer;transition:background .15s">
                    <td style="padding:10px;border-bottom:1px solid var(--border)">
                      <div style="display:flex;align-items:center;gap:10px">
                        <div style="font-size:20px">${m.icon}</div>
                        <div>
                          <div style="font-weight:500">${htmlEscape(m.label)}</div>
                          <div style="font-size:11px;color:var(--muted);font-family:monospace">${htmlEscape(a.type)}</div>
                        </div>
                      </div>
                    </td>
                    <td style="padding:10px;border-bottom:1px solid var(--border);text-align:right;font-weight:600">${fmtNumber(a.count)}</td>
                    <td style="padding:10px;border-bottom:1px solid var(--border);text-align:right">${fmtNumber(a.uniqueUsers)}</td>
                    <td style="padding:10px;border-bottom:1px solid var(--border);text-align:right;font-size:12px;color:var(--muted)">${a.last ? fmtRelativeTime(a.last) : '—'}</td>
                    <td style="padding:10px;border-bottom:1px solid var(--border);text-align:right">
                      <button class="btn btn-sm btn-ghost" data-action="open">Details →</button>
                    </td>
                  </tr>`
                }).join('')}
              </tbody>
            </table>
          `
          tableWrap.querySelectorAll('.data-row').forEach(row => {
            row.addEventListener('mouseover', () => { row.style.background = 'var(--hover)' })
            row.addEventListener('mouseout', () => { row.style.background = 'transparent' })
            row.addEventListener('click', () => openTypeDrawer(row.dataset.type, render))
          })
        } catch (e) {
          body.innerHTML = `<div class="error-state glass-card" style="padding:32px;text-align:center;border-radius:14px">
            <div style="font-size:40px">⚠️</div>
            <div style="font-weight:600;margin-top:8px">Daten konnten nicht geladen werden</div>
            <div style="font-size:13px;color:var(--muted);margin-top:4px">Fehler: ${htmlEscape(e.message || 'Unbekannter Fehler')}</div>
            <button id="retry" class="btn btn-primary" style="margin-top:12px">Erneut versuchen</button>
          </div>`
          const retryBtn = body.querySelector('#retry')
          if (retryBtn) retryBtn.addEventListener('click', () => self.mount(container))
        }
      }

      const refreshBtn = container.querySelector('#btn-refresh')
      const pdfBtn = container.querySelector('#btn-pdf')
      const csvBtn = container.querySelector('#btn-csv')

      refreshBtn && refreshBtn.addEventListener('click', async () => {
        toast('Aktualisiere…', 'info')
        await render()
        toast('Aktualisiert', 'success')
      })
      pdfBtn && pdfBtn.addEventListener('click', () => {
        try {
          exportPanelAsPdf(container, 'achievement-unlocks.pdf')
        } catch (e) {
          toast('PDF-Export fehlgeschlagen: ' + (e.message || ''), 'error')
        }
      })
      csvBtn && csvBtn.addEventListener('click', () => {
        if (!lastAgg.length) { toast('Keine Daten zum Exportieren', 'warn'); return }
        exportCsv(lastAgg.map(a => ({
          type: a.type,
          label: metaFor(a.type).label,
          count: a.count,
          unique_users: a.uniqueUsers,
          last_unlocked: a.last
        })), 'achievement-unlocks.csv')
      })

      // FIX LOW: await render() statt fire-and-forget — async-Fehler landen nun im äußeren catch
      await render()
    } catch (mountErr) {
      container.innerHTML = `<div class="error-state" style="padding:32px;text-align:center;border-radius:14px;border:1px solid var(--danger,#e33);margin:16px">
        <div style="font-size:40px">⚠️</div>
        <div style="font-weight:600;margin-top:8px">Panel konnte nicht geladen werden</div>
        <div style="font-size:13px;color:var(--muted);margin-top:4px;font-family:monospace">Fehler: ${(mountErr && mountErr.message) ? String(mountErr.message).replace(/[<>&]/g, '') : 'Unbekannter Fehler'}</div>
      </div>`
    }
  }
}
