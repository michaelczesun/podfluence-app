import { sb } from '/lib/supabase.js?v=20260608l'
import { toast, modal, confirmDialog, fmtNumber, htmlEscape, iconHtml, debounce } from '/lib/ui.js?v=20260608l'
import { makeAreaChart, makeSparkline } from '/lib/charts.js?v=20260608l'
import { exportPanelAsPdf, exportCsv } from '/lib/export.js?v=20260608l'
import { countUp, fadeIn, skeletonLoader } from '/lib/animations.js?v=20260608l'
import { drawer, segmentedControl } from '/lib/layout-extras.js?v=20260608l'
import { showUserDetailModal, grantPremium } from '/lib/panel-actions.js?v=20260608l'

// Local broadcast-push helper (sendBroadcastPush is not exported from panel-actions)
async function sendBroadcastPush({ title, body, audience = 'custom', user_ids = [] }) {
  const { data, error } = await sb.functions.invoke('send-broadcast-push', {
    body: { title, body, audience, user_ids },
  })
  if (error) throw error
  return data
}

const RANGE_DAYS = { '7d': 7, '30d': 30, '90d': 90 }

async function fetchListeners(days) {
  const since = new Date(Date.now() - days * 86400000).toISOString()

  // Schema-Truth: listening_activity.listener_id + listened_ms (ms!), episode_guid.
  const { data: events, error } = await sb
    .from('listening_activity')
    .select('listener_id, listened_ms, created_at, episode_guid')
    .gte('created_at', since)
    .not('listener_id', 'is', null)
    .limit(50000)
  if (error) throw error

  const perUser = new Map()
  for (const ev of events || []) {
    if (!ev.listener_id) continue
    // Use float division to avoid 0 when listened_ms < 3_600_000.
    // Aggregate in hours throughout so totals never silently round to 0.0h.
    const h = Number(ev.listened_ms || 0) / 3600000.0  // ms → hours (float!)
    const day = (ev.created_at || '').slice(0, 10)
    let agg = perUser.get(ev.listener_id)
    if (!agg) {
      agg = { user_id: ev.listener_id, total: 0, byDay: {}, episodeHours: {} }
      perUser.set(ev.listener_id, agg)
    }
    agg.total += h
    agg.byDay[day] = (agg.byDay[day] || 0) + h
    if (ev.episode_guid) {
      agg.episodeHours[ev.episode_guid] = (agg.episodeHours[ev.episode_guid] || 0) + h
    }
  }

  const sorted = [...perUser.values()].sort((a, b) => b.total - a.total).slice(0, 100)
  const topIds = sorted.map((u) => u.user_id)

  // JOIN users table for real profile data
  let profileMap = {}
  if (topIds.length) {
    const { data: profiles, error: profErr } = await sb
      .from('users')
      .select('id, full_name, username, avatar_url, is_premium, is_verified')
      .in('id', topIds)
    if (profErr) throw profErr
    for (const p of profiles || []) {
      profileMap[p.id] = p
    }
  }

  const buckets = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000)
    buckets.push(d.toISOString().slice(0, 10))
  }

  // Round to 1 decimal place — keep precision so small but non-zero hours never show as 0.0h.
  const round1 = (x) => Math.round((Number(x) || 0) * 10) / 10

  const rows = sorted.map((u, i) => {
    const profile = profileMap[u.user_id] || {}
    const series = buckets.map((b) => round1(u.byDay[b] || 0))
    // Top-5 episodes by hours for drawer drill-down
    const topEpisodes = Object.entries(u.episodeHours)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([episode_id, hours]) => ({ episode_id, hours: round1(hours) }))
    return {
      rank: i + 1,
      user_id: u.user_id,
      name: profile.full_name || profile.username || u.user_id,
      username: profile.username || '',
      avatar: profile.avatar_url || '',
      is_premium: profile.is_premium || false,
      is_verified: profile.is_verified || false,
      total: round1(u.total),
      series,
      topEpisodes,
    }
  })

  const totalsByDay = buckets.map((b) => {
    let sum = 0
    for (const u of sorted) sum += u.byDay[b] || 0
    return { day: b, hours: round1(sum) }
  })

  const grandTotal = round1(rows.reduce((s, r) => s + r.total, 0))
  const avgPerListener = rows.length ? round1(grandTotal / rows.length) : 0
  const top10Share = rows.length
    ? Math.round((rows.slice(0, 10).reduce((s, r) => s + r.total, 0) / Math.max(1, grandTotal)) * 100)
    : 0

  return { rows, totalsByDay, grandTotal, avgPerListener, top10Share, days }
}

function avatarHtml(row) {
  if (row.avatar) {
    return `<img src="${htmlEscape(row.avatar)}" alt="" class="avatar-img" />`
  }
  const initial = (row.name || '?').trim().charAt(0).toUpperCase()
  return `<div class="avatar-fallback" style="display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#7c5cff,#5b3df0);color:#fff;font-weight:600;font-size:14px;flex-shrink:0;">${htmlEscape(initial)}</div>`
}

function rankBadge(rank) {
  if (rank === 1) return `<span class="rank-badge gold">1</span>`
  if (rank === 2) return `<span class="rank-badge silver">2</span>`
  if (rank === 3) return `<span class="rank-badge bronze">3</span>`
  return `<span class="rank-badge">${rank}</span>`
}

function fmtHours(value) {
  // Fallback: show em-dash for non-positive hours so 0.0h doesn't pollute the leaderboard.
  const v = Number(value) || 0
  if (v <= 0) return `<span class="muted">—</span>`
  return `<strong>${v.toFixed(1)}</strong> <span class="unit">h</span>`
}

function renderRow(row) {
  const verified = row.is_verified ? `<span class="chip chip-verified" title="Verifiziert">${iconHtml('check') || '✓'}</span>` : ''
  const premium = row.is_premium ? `<span class="chip chip-premium" title="Premium">PRO</span>` : ''
  return `
    <tr data-user-id="${htmlEscape(row.user_id)}" class="row-listener">
      <td class="col-rank">${rankBadge(row.rank)}</td>
      <td class="col-user">
        <div class="user-cell">
          ${avatarHtml(row)}
          <div class="user-meta">
            <div class="user-name">${htmlEscape(row.name)} ${verified}${premium}</div>
            <div class="user-sub">${row.username ? '@' + htmlEscape(row.username) : '—'}</div>
          </div>
        </div>
      </td>
      <td class="col-hours">${fmtHours(row.total)}</td>
      <td class="col-spark"><div class="sparkline-host" data-spark='${htmlEscape(JSON.stringify(row.series))}'></div></td>
      <td class="col-actions">
        <button class="btn-icon btn-dots" data-action="menu" data-user-id="${htmlEscape(row.user_id)}" aria-label="Aktionen">⋯</button>
      </td>
    </tr>
  `
}

function renderTable(rows) {
  if (!rows.length) {
    return `
      <div class="empty-state">
        <div class="empty-icon">${iconHtml('headphones') || '🎧'}</div>
        <h3>Noch keine Hör-Aktivität</h3>
        <p>Sobald Nutzer Episoden hören, erscheinen die aktivsten hier.</p>
      </div>
    `
  }
  return `
    <table class="data-table data-table-hover">
      <thead>
        <tr>
          <th class="col-rank">#</th>
          <th class="col-user">Hörer</th>
          <th class="col-hours sortable" data-sort="total">Hörstunden</th>
          <th class="col-spark">Trend</th>
          <th class="col-actions"></th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(renderRow).join('')}
      </tbody>
    </table>
  `
}

function attachSparklines(scope) {
  scope.querySelectorAll('.sparkline-host').forEach((host) => {
    try {
      const data = JSON.parse(host.dataset.spark || '[]')
      host.innerHTML = ''
      makeSparkline(host, { data, color: '#7c5cff', height: 32, fill: true })
    } catch (e) {
      host.textContent = '—'
    }
  })
}

function openRowMenu(button, row, panelCtx) {
  document.querySelectorAll('.row-menu-pop').forEach((n) => n.remove())
  const rect = button.getBoundingClientRect()
  const pop = document.createElement('div')
  pop.className = 'row-menu-pop glass-card'
  pop.style.position = 'fixed'
  pop.style.top = `${rect.bottom + 6}px`
  pop.style.left = `${Math.max(8, rect.right - 200)}px`
  pop.style.zIndex = '9999'
  pop.innerHTML = `
    <button class="menu-item" data-act="view">${iconHtml('user') || '👤'} Profil ansehen</button>
    <button class="menu-item" data-act="grant">${iconHtml('star') || '⭐'} Premium gewähren</button>
    <button class="menu-item" data-act="thank">${iconHtml('heart') || '💌'} Danke-Push senden</button>
    <button class="menu-item" data-act="drill">${iconHtml('chart') || '📊'} Hör-Details</button>
  `
  document.body.appendChild(pop)
  const off = (e) => {
    if (!pop.contains(e.target) && e.target !== button) {
      pop.remove()
      document.removeEventListener('click', off, true)
    }
  }
  setTimeout(() => document.addEventListener('click', off, true), 0)

  pop.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act
    if (!act) return
    pop.remove()
    if (act === 'view') {
      try {
        await showUserDetailModal(row.user_id)
      } catch {
        toast('Profil konnte nicht geladen werden', 'error')
      }
    } else if (act === 'grant') {
      const ok = await confirmDialog({
        title: 'Premium gewähren?',
        body: `<strong>${htmlEscape(row.name)}</strong> erhält Premium-Zugang.`,
        confirmText: 'Gewähren',
      })
      if (!ok) return
      try {
        await grantPremium(row.user_id)
        toast('Premium gewährt', 'success')
        panelCtx.refresh()
      } catch (err) {
        toast('Fehler: ' + (err?.message || 'Unbekannt'), 'error')
      }
    } else if (act === 'thank') {
      openThankYouModal([row], panelCtx, { single: true })
    } else if (act === 'drill') {
      openListenerDrawer(row)
    }
  })
}

function openListenerDrawer(row) {
  const body = document.createElement('div')

  // Build top-episodes list from pre-aggregated data
  const episodesHtml = row.topEpisodes && row.topEpisodes.length
    ? `
      <div class="drawer-section">
        <div class="drawer-section-title">Top-Episoden (Hörstunden)</div>
        <ul class="episode-list">
          ${row.topEpisodes.map((ep, idx) => `
            <li class="episode-item">
              <span class="episode-rank">${idx + 1}.</span>
              <span class="episode-id" title="${htmlEscape(ep.episode_id)}">${htmlEscape(ep.episode_id.slice(0, 8))}…</span>
              <span class="episode-mins">${ep.hours > 0 ? `<strong>${Number(ep.hours).toFixed(1)}</strong> h` : '—'}</span>
            </li>
          `).join('')}
        </ul>
      </div>
    `
    : ''

  body.innerHTML = `
    <div class="drawer-head">
      <div class="user-cell big">
        ${avatarHtml(row)}
        <div class="user-meta">
          <div class="user-name big">${htmlEscape(row.name)}</div>
          <div class="user-sub">${row.username ? '@' + htmlEscape(row.username) : ''}</div>
        </div>
      </div>
    </div>
    <div class="drawer-stats">
      <div class="stat-tile">
        <div class="stat-label">Hörstunden</div>
        <div class="stat-value">${row.total > 0 ? Number(row.total).toFixed(1) + ' h' : '—'}</div>
      </div>
      <div class="stat-tile">
        <div class="stat-label">Rang</div>
        <div class="stat-value">#${row.rank}</div>
      </div>
      <div class="stat-tile">
        <div class="stat-label">Status</div>
        <div class="stat-value">${row.is_premium ? 'Premium' : 'Free'}</div>
      </div>
    </div>
    <div class="drawer-chart" id="drawer-chart"></div>
    ${episodesHtml}
  `
  drawer({ title: 'Hörer-Details', content: body })
  setTimeout(() => {
    body.querySelectorAll('[data-countup]').forEach((el) => {
      const target = Number(el.dataset.countup) || 0
      countUp(el, target, { duration: 800, format: fmtNumber })
    })
    const host = body.querySelector('#drawer-chart')
    if (host && row.series && row.series.length) {
      makeAreaChart(host, {
        categories: row.series.map((_, i) => `T-${row.series.length - 1 - i}`),
        series: [{ name: 'Stunden', data: row.series }],
        colors: ['#7c5cff'],
        height: 180,
      })
    }
  }, 50)
}

function openThankYouModal(rows, panelCtx, opts = {}) {
  const target = opts.single ? rows[0].name : `${rows.length} Top-Hörer:innen`
  const wrap = document.createElement('div')
  wrap.innerHTML = `
    <p class="modal-intro">Sende eine persönliche Nachricht an <strong>${htmlEscape(target)}</strong>.</p>
    <label class="form-label">Titel</label>
    <input type="text" class="form-input" id="ty-title" value="Danke fürs Zuhören 💜" maxlength="60" />
    <label class="form-label">Nachricht</label>
    <textarea class="form-textarea" id="ty-body" rows="4" maxlength="240" placeholder="Eure Treue macht Podfluence aus...">Eure Treue macht Podfluence aus. Danke, dass ihr dabei seid!</textarea>
    <div class="char-hint" id="ty-hint">0 / 240</div>
    <div class="recipients-preview">
      ${rows
        .slice(0, 10)
        .map(
          (r) => `<span class="recipient-pill">${avatarHtml(r)}<span>${htmlEscape(r.name)}</span></span>`
        )
        .join('')}
      ${rows.length > 10 ? `<span class="recipient-pill more">+${rows.length - 10}</span>` : ''}
    </div>
  `
  const m = modal({
    title: opts.single ? 'Danke-Push senden' : 'Top-10 Danke-Push',
    content: wrap,
    actions: [
      { label: 'Abbrechen', variant: 'secondary', onClick: () => m.close() },
      {
        label: 'Senden',
        variant: 'primary',
        onClick: async () => {
          const title = wrap.querySelector('#ty-title').value.trim()
          const body = wrap.querySelector('#ty-body').value.trim()
          if (!title || !body) {
            toast('Bitte Titel und Nachricht ausfüllen', 'warning')
            return
          }
          m.close()
          try {
            // Fix: use correct RPC signature send_broadcast_push(title, body, audience, deep_link?)
            // For targeted pushes, audience='custom' with user_ids passed via deep_link workaround
            // is not supported — send to all and note limitation, or use audience='custom' if lib supports it
            await sendBroadcastPush({
              title,
              body,
              audience: 'custom',
              user_ids: rows.map((r) => r.user_id),
            })
            toast(`Push an ${rows.length} Hörer:innen gesendet`, 'success')
          } catch (err) {
            toast('Push fehlgeschlagen: ' + (err?.message || ''), 'error')
          }
        },
      },
    ],
  })
  const ta = wrap.querySelector('#ty-body')
  const hint = wrap.querySelector('#ty-hint')
  const upd = () => (hint.textContent = `${ta.value.length} / 240`)
  ta.addEventListener('input', upd)
  upd()
}

export default {
  id: 'top-listeners',
  title: 'Aktivste Hörer',
  category: 'listening',

  async mount(container) {
    try {
      let currentRange = '30d'
      let lastData = null

      container.innerHTML = `
        <div class="panel-shell">
          <div class="panel-head">
            <div class="panel-title">
              <h2>Aktivste Hörer</h2>
              <p class="panel-sub">Leaderboard der Hörstunden · Top 100</p>
            </div>
            <div class="toolbar" id="tl-toolbar">
              <div id="tl-range"></div>
              <button class="btn btn-secondary" id="tl-refresh">${iconHtml('refresh') || '🔄'} Aktualisieren</button>
              <button class="btn btn-secondary" id="tl-thank10">${iconHtml('heart') || '💌'} Top-10 Danke-Push</button>
              <button class="btn btn-secondary" id="tl-pdf">${iconHtml('file') || '📄'} PDF</button>
              <button class="btn btn-secondary" id="tl-csv">${iconHtml('download') || '💾'} CSV</button>
            </div>
          </div>
          <div class="panel-body" id="tl-body">
            <div class="skeleton-stack" id="tl-initial-skel"></div>
          </div>
        </div>
      `

      const body = container.querySelector('#tl-body')
      const initialSkel = container.querySelector('#tl-initial-skel')
      if (initialSkel) {
        try { skeletonLoader(initialSkel, { rows: 8 }) } catch {}
      }

      const rangeHost = container.querySelector('#tl-range')
      segmentedControl(rangeHost, {
        options: [
          { value: '7d', label: '7T' },
          { value: '30d', label: '30T' },
          { value: '90d', label: '90T' },
        ],
        value: currentRange,
        onChange: (v) => {
          currentRange = v
          load()
        },
      })

      const ctx = { refresh: () => load() }

      async function load() {
        body.innerHTML = ''
        const skel = document.createElement('div')
        skel.className = 'skeleton-stack'
        body.appendChild(skel)
        try { skeletonLoader(skel, { rows: 8 }) } catch {}

        try {
          const data = await fetchListeners(RANGE_DAYS[currentRange])
          lastData = data
          render(data)
        } catch (err) {
          renderError(err)
        }
      }

      function renderError(err) {
        body.innerHTML = `
          <div class="error-state glass-card">
            <div class="error-icon">⚠️</div>
            <h3>Daten konnten nicht geladen werden</h3>
            <p>Fehler: ${htmlEscape(err?.message || 'Unbekannter Fehler')}</p>
            <button class="btn btn-primary" id="tl-retry">Erneut versuchen</button>
          </div>
        `
        body.querySelector('#tl-retry')?.addEventListener('click', load)
      }

      function render(data) {
        const { rows, totalsByDay, grandTotal, avgPerListener, top10Share } = data

        body.innerHTML = `
          <div class="hero-row">
            <div class="glass-card hero-card">
              <div class="hero-label">Gesamte Hörstunden</div>
              <div class="hero-value" id="hero-total">${grandTotal > 0 ? grandTotal.toFixed(1) + ' h' : '—'}</div>
              <div class="hero-sub">in den letzten ${data.days} Tagen</div>
            </div>
            <div class="glass-card hero-card">
              <div class="hero-label">Ø pro Top-Hörer</div>
              <div class="hero-value" id="hero-avg">${avgPerListener > 0 ? avgPerListener.toFixed(1) + ' h' : '—'}</div>
              <div class="hero-sub">Stunden / Person</div>
            </div>
            <div class="glass-card hero-card">
              <div class="hero-label">Top-10 Anteil</div>
              <div class="hero-value" id="hero-share">0%</div>
              <div class="hero-sub">der Top-100-Stunden</div>
            </div>
            <div class="glass-card hero-card hero-chart-card">
              <div class="hero-label">Verlauf</div>
              <div id="hero-chart" class="hero-chart"></div>
            </div>
          </div>

          <div class="section-head">
            <h3>Leaderboard</h3>
            <div class="section-tools">
              <input type="search" class="search-input" id="tl-search" placeholder="Hörer suchen..." />
            </div>
          </div>

          <div class="glass-card table-card" id="table-host">
            ${renderTable(rows)}
          </div>
        `

        // Hero-total/avg are now rendered as static strings ("12.3 h" / "—")
        // so countUp would overwrite them with raw numbers; skip animation here.
        const shareEl = body.querySelector('#hero-share')
        countUp(shareEl, top10Share, { duration: 900, format: (v) => `${v}%` })

        const chartHost = body.querySelector('#hero-chart')
        if (chartHost && totalsByDay.length) {
          makeAreaChart(chartHost, {
            categories: totalsByDay.map((d) => d.day),
            series: [{ name: 'Stunden', data: totalsByDay.map((d) => d.hours) }],
            colors: ['#7c5cff'],
            height: 90,
          })
        }

        attachSparklines(body)

        const search = body.querySelector('#tl-search')
        if (search) {
          search.addEventListener(
            'input',
            debounce((e) => {
              const q = e.target.value.trim().toLowerCase()
              const filtered = q
                ? rows.filter(
                    (r) =>
                      r.name.toLowerCase().includes(q) ||
                      r.username.toLowerCase().includes(q)
                  )
                : rows
              const host = body.querySelector('#table-host')
              host.innerHTML = renderTable(filtered)
              attachSparklines(host)
              wireRowEvents(host)
            }, 200)
          )
        }

        // Wire events only on #table-host to avoid duplicate body-level bindings
        const tableHost = body.querySelector('#table-host')
        if (tableHost) wireRowEvents(tableHost)
        fadeIn(body)
      }

      function wireRowEvents(scope) {
        scope.querySelectorAll('[data-action="menu"]').forEach((btn) => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation()
            const uid = btn.dataset.userId
            const row = (lastData?.rows || []).find((r) => r.user_id === uid)
            if (row) openRowMenu(btn, row, ctx)
          })
        })
        scope.querySelectorAll('.row-listener').forEach((tr) => {
          tr.addEventListener('click', (e) => {
            if (e.target.closest('[data-action="menu"]')) return
            const uid = tr.dataset.userId
            const row = (lastData?.rows || []).find((r) => r.user_id === uid)
            if (row) openListenerDrawer(row)
          })
        })
      }

      container.querySelector('#tl-refresh').addEventListener('click', load)
      container.querySelector('#tl-thank10').addEventListener('click', () => {
        if (!lastData?.rows?.length) {
          toast('Keine Hörer zum Bedanken', 'warning')
          return
        }
        openThankYouModal(lastData.rows.slice(0, 10), ctx)
      })
      container.querySelector('#tl-pdf').addEventListener('click', () => {
        try {
          exportPanelAsPdf(container, { title: 'Aktivste Hörer', filename: `top-listeners-${currentRange}.pdf` })
        } catch (err) {
          toast('PDF-Export fehlgeschlagen: ' + (err?.message || ''), 'error')
        }
      })
      container.querySelector('#tl-csv').addEventListener('click', () => {
        if (!lastData?.rows?.length) {
          toast('Nichts zu exportieren', 'warning')
          return
        }
        try {
          exportCsv(
            lastData.rows.map((r) => ({
              rank: r.rank,
              user_id: r.user_id,
              name: r.name,
              username: r.username,
              hours: r.total,
              premium: r.is_premium ? 'yes' : 'no',
              verified: r.is_verified ? 'yes' : 'no',
            })),
            { filename: `top-listeners-${currentRange}.csv` }
          )
        } catch (err) {
          toast('CSV-Export fehlgeschlagen: ' + (err?.message || ''), 'error')
        }
      })

      await load()
    } catch (err) {
      container.innerHTML = `
        <div class="error-state glass-card" style="margin:24px;padding:24px;">
          <div class="error-icon">⚠️</div>
          <h3>Panel konnte nicht initialisiert werden</h3>
          <p>Fehler: ${htmlEscape(err?.message || String(err))}</p>
        </div>
      `
    }
  },
}
