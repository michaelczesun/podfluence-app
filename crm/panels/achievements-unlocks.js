import { sb } from '/lib/supabase.js'
import { toast, modal, fmtNumber, fmtDateTime, fmtRelativeTime, htmlEscape, iconHtml, debounce, confirmDialog } from '/lib/ui.js'
import { makeBarChart, makeDonutChart } from '/lib/charts.js'
import { exportPanelAsPdf, exportCsv } from '/lib/export.js'
import { countUp, fadeIn, skeletonLoader } from '/lib/animations.js'
import { drawer, statHero, glassCard } from '/lib/layout-extras.js'
import { showUserDetailModal } from '/lib/panel-actions.js'

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

async function fetchAchievementStats() {
  const { data, error } = await sb
    .from('user_achievements')
    .select('achievement_type, user_id, unlocked_at')
    .order('unlocked_at', { ascending: false })
    .limit(10000)
  if (error) throw error
  return data || []
}

function aggregateByType(rows) {
  const map = new Map()
  for (const r of rows) {
    const t = r.achievement_type
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

async function fetchUsersForType(type) {
  const { data, error } = await sb
    .from('user_achievements')
    .select('user_id, unlocked_at, users:users(id, display_name, username, avatar_url, is_verified)')
    .eq('achievement_type', type)
    .order('unlocked_at', { ascending: false })
    .limit(500)
  if (error) throw error
  return data || []
}

async function manualGrant(type, userIdentifier) {
  const identifier = userIdentifier.trim()
  if (!identifier) throw new Error('User-ID oder Username erforderlich')
  let userId = identifier
  if (!/^[0-9a-f-]{36}$/i.test(identifier)) {
    const { data, error } = await sb
      .from('users')
      .select('id')
      .or(`username.eq.${identifier},display_name.eq.${identifier}`)
      .limit(1)
      .maybeSingle()
    if (error) throw error
    if (!data) throw new Error('User nicht gefunden')
    userId = data.id
  }
  const { error: insErr } = await sb
    .from('user_achievements')
    .insert({ user_id: userId, achievement_type: type, unlocked_at: new Date().toISOString(), granted_by: 'admin' })
  if (insErr) throw insErr
  return userId
}

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
      <div class="loading-state">${skeletonLoader ? skeletonLoader(6) : 'Lädt…'}</div>
    </div>
  `

  drawer({ title: meta.label + ' – Unlocks', width: 520, content })

  const grantBtn = content.querySelector('#grant-btn')
  const grantInput = content.querySelector('#grant-input')
  grantBtn.addEventListener('click', async () => {
    const val = grantInput.value
    if (!val.trim()) { toast('Bitte User angeben', 'warn'); return }
    const ok = await confirmDialog({ title: 'Achievement vergeben?', message: `"${meta.label}" an ${htmlEscape(val)} vergeben?`, confirmLabel: 'Vergeben' })
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
    listEl.innerHTML = `<div>${skeletonLoader ? skeletonLoader(5) : 'Lädt…'}</div>`
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
            return `<div class="user-row" data-uid="${htmlEscape(r.user_id)}" style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:10px;cursor:pointer;transition:background .15s" onmouseover="this.style.background='var(--hover)'" onmouseout="this.style.background='transparent'">
              <img src="${htmlEscape(u.avatar_url || '/img/default-avatar.png')}" style="width:36px;height:36px;border-radius:50%;object-fit:cover" onerror="this.src='/img/default-avatar.png'"/>
              <div style="flex:1;min-width:0">
                <div style="font-weight:500;display:flex;align-items:center;gap:4px">${htmlEscape(u.display_name || 'Unbekannt')} ${u.is_verified ? '<span style="color:#1d9bf0">✓</span>' : ''}</div>
                <div style="font-size:12px;color:var(--muted)">@${htmlEscape(u.username || '—')} · ${fmtRelativeTime(r.unlocked_at)}</div>
              </div>
              <div style="font-size:11px;color:var(--muted)">${fmtDateTime(r.unlocked_at)}</div>
            </div>`
          }).join('')}
        </div>
      `
      listEl.querySelectorAll('.user-row').forEach(el => {
        el.addEventListener('click', () => {
          const uid = el.dataset.uid
          showUserDetailModal && showUserDetailModal(uid)
        })
      })
      listEl.querySelector('#exp-users').addEventListener('click', () => {
        exportCsv(rows.map(r => ({
          user_id: r.user_id,
          username: r.users?.username || '',
          display_name: r.users?.display_name || '',
          unlocked_at: r.unlocked_at
        })), `achievement_${type}_users.csv`)
      })
    } catch (e) {
      listEl.innerHTML = `<div class="error-state" style="padding:24px;text-align:center;color:var(--danger)">
        <div>Fehler beim Laden</div>
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

    fadeIn(container)

    const body = container.querySelector('#body')
    const heroRow = container.querySelector('#hero-row')
    const barEl = container.querySelector('#bar-chart')
    const donutEl = container.querySelector('#donut-chart')
    const tableWrap = container.querySelector('#table-wrap')

    heroRow.innerHTML = skeletonLoader ? skeletonLoader(3) : ''
    barEl.innerHTML = skeletonLoader ? skeletonLoader(4) : ''
    donutEl.innerHTML = skeletonLoader ? skeletonLoader(4) : ''
    tableWrap.innerHTML = skeletonLoader ? skeletonLoader(6) : ''

    let lastAgg = []

    const self = this
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
          countUp && countUp(valEl, h.value)
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

        barEl.innerHTML = ''
        const barLabels = agg.map(a => metaFor(a.type).icon + ' ' + metaFor(a.type).label)
        const barValues = agg.map(a => a.count)
        makeBarChart(barEl, {
          labels: barLabels,
          values: barValues,
          height: 300,
          onBarClick: (idx) => openTypeDrawer(agg[idx].type, render),
          tooltip: (idx) => `${metaFor(agg[idx].type).label}: ${fmtNumber(agg[idx].count)} Unlocks (${agg[idx].uniqueUsers} User)`
        })

        donutEl.innerHTML = ''
        const topN = agg.slice(0, 6)
        const rest = agg.slice(6).reduce((s, a) => s + a.count, 0)
        const donutLabels = topN.map(a => metaFor(a.type).label).concat(rest ? ['Andere'] : [])
        const donutValues = topN.map(a => a.count).concat(rest ? [rest] : [])
        makeDonutChart(donutEl, { labels: donutLabels, values: donutValues, height: 300 })

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
              ${agg.map(a => {
                const meta = metaFor(a.type)
                return `<tr class="data-row" data-type="${htmlEscape(a.type)}" style="cursor:pointer;transition:background .15s" onmouseover="this.style.background='var(--hover)'" onmouseout="this.style.background='transparent'">
                  <td style="padding:10px;border-bottom:1px solid var(--border)">
                    <div style="display:flex;align-items:center;gap:10px">
                      <div style="font-size:20px">${meta.icon}</div>
                      <div>
                        <div style="font-weight:500">${htmlEscape(meta.label)}</div>
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
          row.addEventListener('click', () => openTypeDrawer(row.dataset.type, render))
        })
      } catch (e) {
        body.innerHTML = `<div class="error-state glass-card" style="padding:32px;text-align:center;border-radius:14px">
          <div style="font-size:40px">⚠️</div>
          <div style="font-weight:600;margin-top:8px">Daten konnten nicht geladen werden</div>
          <div style="font-size:13px;color:var(--muted);margin-top:4px">${htmlEscape(e.message || 'Unbekannter Fehler')}</div>
          <button id="retry" class="btn btn-primary" style="margin-top:12px">Erneut versuchen</button>
        </div>`
        body.querySelector('#retry').addEventListener('click', () => self.mount(container))
      }
    }

    container.querySelector('#btn-refresh').addEventListener('click', async () => {
      toast('Aktualisiere…', 'info')
      await render()
      toast('Aktualisiert', 'success')
    })
    container.querySelector('#btn-pdf').addEventListener('click', () => {
      exportPanelAsPdf(container, 'achievement-unlocks.pdf')
    })
    container.querySelector('#btn-csv').addEventListener('click', () => {
      if (!lastAgg.length) { toast('Keine Daten zum Exportieren', 'warn'); return }
      exportCsv(lastAgg.map(a => ({
        type: a.type,
        label: metaFor(a.type).label,
        count: a.count,
        unique_users: a.uniqueUsers,
        last_unlocked: a.last
      })), 'achievement-unlocks.csv')
    })

    await render()
  }
}
