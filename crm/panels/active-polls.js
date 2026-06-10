import { sb } from '/lib/supabase.js?v=20260610q'
import { toast, confirmDialog, fmtNumber, fmtDateTime, fmtRelativeTime, htmlEscape, iconHtml } from '/lib/ui.js?v=20260610q'
import { makeBarChart, makeDonutChart } from '/lib/charts.js?v=20260610q'
import { exportPanelAsPdf, exportCsv } from '/lib/export.js?v=20260610q'
import { countUp, fadeIn, skeletonLoader } from '/lib/animations.js?v=20260610q'
import { drawer, statHero } from '/lib/layout-extras.js?v=20260610q'
import { showUserDetailModal } from '/lib/panel-actions.js?v=20260610q'

const PALETTE = ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#ef4444', '#84cc16']

// Status der Tabellen 'polls' / 'poll_votes' in der DB-Schema-Wahrheit nicht bestätigt.
// Statt das ganze Panel in den error-state zu kippen wenn die Tabelle fehlt
// (Postgres 42P01 = relation does not exist), behandeln wir das als "Keine Daten"
// und zeigen den freundlichen Empty-State.
const MISSING_TABLE_CODES = new Set(['42P01', 'PGRST106', 'PGRST205'])

function isMissingTableError(error) {
  if (!error) return false
  if (error.code && MISSING_TABLE_CODES.has(error.code)) return true
  const msg = String(error.message || '').toLowerCase()
  return msg.includes('does not exist') || msg.includes('relation') && msg.includes('not') || msg.includes('not find')
}

async function fetchPolls() {
  const { data, error } = await sb.from('polls')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) {
    if (isMissingTableError(error)) return { rows: [], table: 'polls', missing: true }
    throw error
  }
  return { rows: data || [], table: 'polls' }
}

async function fetchVotes(pollIds) {
  if (!pollIds.length) return { byPoll: {}, table: 'poll_votes' }
  const { data, error } = await sb.from('poll_votes')
    .select('*')
    .in('poll_id', pollIds)
  if (error) {
    if (isMissingTableError(error)) return { byPoll: {}, table: 'poll_votes', missing: true }
    throw error
  }
  const grouped = {}
  for (const v of (data || [])) {
    if (!grouped[v.poll_id]) grouped[v.poll_id] = []
    grouped[v.poll_id].push(v)
  }
  return { byPoll: grouped, table: 'poll_votes' }
}

function normalizePoll(p) {
  let options = p.options || p.choices || p.answers || []
  if (typeof options === 'string') {
    try { options = JSON.parse(options) } catch { options = [] }
  }
  if (!Array.isArray(options)) options = []
  const normalized = options.map((o, i) => {
    if (typeof o === 'string') return { id: i, label: o, votes: 0 }
    return {
      id: o.id ?? i,
      label: o.label ?? o.text ?? o.title ?? `Option ${i + 1}`,
      votes: Number(o.votes ?? o.count ?? 0)
    }
  })
  const closesAt = p.closes_at || p.ends_at || p.expires_at || null
  const isActive = (p.is_active ?? p.active ?? true) && (!closesAt || new Date(closesAt) > new Date())
  return {
    id: p.id,
    question: p.question || p.title || p.text || 'Umfrage',
    creator_id: p.user_id || p.creator_id || p.author_id,
    created_at: p.created_at,
    closes_at: closesAt,
    is_active: isActive,
    options: normalized,
    raw: p
  }
}

function mergeVotes(poll, votes) {
  const counts = {}
  for (const v of votes) {
    const k = v.option_id ?? v.choice_id ?? v.option_index ?? v.value
    counts[k] = (counts[k] || 0) + 1
  }
  let total = 0
  const opts = poll.options.map((o, i) => {
    const c = counts[o.id] ?? counts[i] ?? o.votes ?? 0
    total += c
    return { ...o, votes: c }
  })
  return { ...poll, options: opts, totalVotes: total, voters: votes }
}

function pollCard(poll) {
  const total = poll.totalVotes || 0
  const top = [...poll.options].sort((a, b) => b.votes - a.votes)[0]
  const topPct = total ? Math.round((top?.votes || 0) / total * 100) : 0
  const closesIn = poll.closes_at ? fmtRelativeTime(poll.closes_at) : 'Kein Enddatum'
  return `
    <div class="glass-card poll-card" data-poll-id="${htmlEscape(String(poll.id))}">
      <div class="poll-card-head">
        <div class="poll-status-dot ${poll.is_active ? 'active' : 'closed'}"></div>
        <div class="poll-meta">
          <div class="poll-q">${htmlEscape(poll.question)}</div>
          <div class="poll-sub">
            <span>${fmtNumber(total)} Stimmen</span>
            <span class="dot-sep">·</span>
            <span>${poll.closes_at ? `Endet ${htmlEscape(closesIn)}` : htmlEscape(closesIn)}</span>
          </div>
        </div>
      </div>
      <div class="poll-chart"></div>
      <div class="poll-leader">
        ${total === 0
          ? `<span class="leader-label">Noch keine Stimmen</span>`
          : `<span class="leader-label">Führend</span>
             <span class="leader-opt">${htmlEscape(top?.label || '—')}</span>
             <span class="leader-pct">${topPct}%</span>`}
      </div>
      <div class="poll-actions">
        <button class="btn btn-ghost" data-action="details">${iconHtml('eye')} Details</button>
        <button class="btn btn-danger" data-action="close" ${!poll.is_active ? 'disabled' : ''}>${iconHtml('lock')} Schließen</button>
      </div>
    </div>
  `
}

function renderBars(el, poll) {
  if (!el) return
  try {
    makeBarChart(el, {
      categories: poll.options.map(o => o.label.length > 18 ? o.label.slice(0, 16) + '…' : o.label),
      series: [{ name: 'Stimmen', data: poll.options.map(o => o.votes) }],
      colors: PALETTE,
      height: 140
    })
  } catch (e) {
    const max = Math.max(1, ...poll.options.map(o => o.votes))
    el.innerHTML = poll.options.map((o, i) => `
      <div class="mini-bar-row">
        <span class="mini-bar-label">${htmlEscape(o.label)}</span>
        <div class="mini-bar-track"><div class="mini-bar-fill" style="width:${(o.votes / max * 100).toFixed(1)}%;background:${PALETTE[i % PALETTE.length]}"></div></div>
        <span class="mini-bar-val">${fmtNumber(o.votes)}</span>
      </div>
    `).join('')
  }
}

async function closePoll(pollId) {
  const ok = await confirmDialog({
    title: 'Umfrage schließen?',
    message: 'Die Umfrage wird sofort beendet. Nutzer können nicht mehr abstimmen.',
    confirmText: 'Schließen',
    danger: true
  })
  if (!ok) return false
  try {
    const { data, error } = await sb.from('polls')
      .update({ is_active: false, closes_at: new Date().toISOString() })
      .eq('id', pollId)
      .select('id')
    if (error) throw error
    if (!data || data.length === 0) throw new Error('Keine Zeile aktualisiert — RLS blockiert möglicherweise das Update')
    toast({ type: 'success', message: 'Umfrage geschlossen' })
    return true
  } catch (e) {
    toast({ type: 'error', message: 'Fehler: ' + (e.message || e) })
    return false
  }
}

function openVoterDrawer(poll) {
  const voters = poll.voters || []
  const byOption = {}
  for (const v of voters) {
    const k = v.option_id ?? v.choice_id ?? v.option_index ?? v.value ?? '?'
    if (!byOption[k]) byOption[k] = []
    byOption[k].push(v)
  }
  const chartHostId = `drawer-chart-${poll.id}`
  const totalsHtml = `
    <div class="drawer-stat-grid">
      <div class="drawer-stat"><div class="ds-val" data-cu="${poll.totalVotes}">0</div><div class="ds-lbl">Stimmen</div></div>
      <div class="drawer-stat"><div class="ds-val">${poll.options.length}</div><div class="ds-lbl">Optionen</div></div>
      <div class="drawer-stat"><div class="ds-val">${poll.is_active ? 'Aktiv' : 'Beendet'}</div><div class="ds-lbl">Status</div></div>
    </div>
  `
  const votersListHtml = poll.options.map((o, i) => {
    const list = byOption[String(o.id)] || byOption[String(i)] || []
    return `
      <div class="voter-group">
        <div class="voter-group-head">
          <span class="vg-dot" style="background:${PALETTE[i % PALETTE.length]}"></span>
          <span class="vg-label">${htmlEscape(o.label)}</span>
          <span class="vg-count">${fmtNumber(list.length)}</span>
        </div>
        <div class="voter-list">
          ${list.length === 0 ? '<div class="voter-empty">Noch keine Stimmen</div>' : list.slice(0, 50).map(v => `
            <div class="voter-row" data-user-id="${htmlEscape(String(v.user_id || ''))}">
              <div class="voter-avatar">${(v.user_id || '?').toString().slice(0, 2).toUpperCase()}</div>
              <div class="voter-meta">
                <div class="voter-id">${htmlEscape(String(v.user_id || 'Anonym').slice(0, 8))}&hellip;</div>
                <div class="voter-time">${v.created_at ? fmtRelativeTime(v.created_at) : ''}</div>
              </div>
              ${v.user_id ? '<button class="btn btn-ghost btn-sm" data-action="open-user">Profil</button>' : ''}
            </div>
          `).join('')}
          ${list.length > 50 ? `<div class="voter-more">+ ${list.length - 50} weitere</div>` : ''}
        </div>
      </div>
    `
  }).join('')

  const d = drawer({
    title: 'Umfrage-Details',
    width: 560,
    contentHtml: `
      <div class="drawer-body poll-drawer">
        <div class="drawer-question">${htmlEscape(poll.question)}</div>
        <div class="drawer-meta-line">
          <span>Erstellt ${poll.created_at ? fmtRelativeTime(poll.created_at) : '—'}</span>
          ${poll.closes_at ? `<span class="dot-sep">·</span><span>Endet ${fmtDateTime(poll.closes_at)}</span>` : ''}
        </div>
        ${totalsHtml}
        <div class="drawer-section-title">Verteilung</div>
        <div id="${chartHostId}" style="height:220px"></div>
        <div class="drawer-section-title">Wähler (${fmtNumber(poll.voters?.length || 0)})</div>
        ${votersListHtml || '<div class="empty-inline">Keine Wähler-Daten verfügbar</div>'}
      </div>
    `
  })

  try {
    const drawerEl = d?.el ?? (d instanceof Element ? d : null)
    const cu = drawerEl?.querySelector('[data-cu]')
    if (cu) countUp(cu, Number(cu.dataset.cu || 0))
  } catch (_) {}

  setTimeout(() => {
    const host = document.getElementById(chartHostId)
    if (!host) return
    try {
      makeDonutChart(host, {
        labels: poll.options.map(o => o.label),
        values: poll.options.map(o => o.votes),
        colors: PALETTE,
        height: 220
      })
    } catch (_) {}
  }, 30)

  try {
    const drawerEl = d?.el ?? (d instanceof Element ? d : null)
    drawerEl?.querySelectorAll('[data-action="open-user"]').forEach(btn => {
      btn.addEventListener('click', (ev) => {
        const row = ev.currentTarget.closest('[data-user-id]')
        const uid = row?.dataset.userId
        if (uid) showUserDetailModal(uid)
      })
    })
  } catch (_) {}
}

function emptyState(container) {
  container.innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">${iconHtml('poll', 48) || '<span aria-label="Umfrage">&#x1F4CA;</span>'}</div>
      <h3>Keine aktiven Umfragen</h3>
      <p>Sobald Nutzer Umfragen starten, erscheinen sie hier mit Live-Verteilung und Voter-Insights.</p>
    </div>
  `
}

function errorState(container, msg, onRetry) {
  container.innerHTML = `
    <div class="error-state">
      <div class="error-icon">${iconHtml('alert', 40) || '⚠️'}</div>
      <h3>Daten konnten nicht geladen werden</h3>
      <p>${htmlEscape(msg || 'Unbekannter Fehler')}</p>
      <button class="btn btn-primary" id="retry-btn">${iconHtml('refresh')} Erneut versuchen</button>
    </div>
  `
  container.querySelector('#retry-btn')?.addEventListener('click', onRetry)
}

function mountErrorState(container, msg) {
  try {
    container.innerHTML = `
      <div class="panel-shell">
        <div class="error-state">
          <div class="error-icon">⚠️</div>
          <h3>Panel konnte nicht initialisiert werden</h3>
          <p>${htmlEscape(msg || 'Unbekannter Fehler')}</p>
        </div>
      </div>
    `
  } catch (_) {}
}

export default {
  id: 'active-polls',
  title: 'Aktive Umfragen',
  category: 'content',

  async mount(container) {
    try {
      container.innerHTML = `
        <div class="panel-shell active-polls-panel">
          <div class="panel-head">
            <div class="panel-head-left">
              <h2>Aktive Umfragen</h2>
              <span class="panel-sub">Live-Verteilung & Voter-Insights</span>
            </div>
            <div class="toolbar">
              <button class="btn btn-ghost" id="btn-refresh" title="Aktualisieren">${iconHtml('refresh')} Aktualisieren</button>
              <button class="btn btn-ghost" id="btn-pdf" title="PDF Export">${iconHtml('file-text')} PDF</button>
              <button class="btn btn-ghost" id="btn-csv" title="CSV Export">${iconHtml('download')} CSV</button>
            </div>
          </div>
          <div class="hero-row" id="hero-row"></div>
          <div class="panel-body" id="body"></div>
        </div>
      `

      const body = container.querySelector('#body')
      const heroRow = container.querySelector('#hero-row')
      const state = { polls: [] }

      const renderSkeleton = () => {
        heroRow.innerHTML = `<div class="hero-skel"></div><div class="hero-skel"></div><div class="hero-skel"></div>`
        body.innerHTML = `<div class="poll-grid">${Array.from({ length: 6 }).map(() => `
          <div class="glass-card skel-card">
            <div class="skel skel-line w-70"></div>
            <div class="skel skel-line w-40"></div>
            <div class="skel skel-block h-120"></div>
            <div class="skel skel-line w-50"></div>
          </div>
        `).join('')}</div>`
        try { skeletonLoader(body) } catch (_) {}
      }

      // Sofort Skeleton zeigen — kein weißer Screen
      renderSkeleton()

      const render = () => {
        const polls = state.polls
        const totalVotes = polls.reduce((s, p) => s + (p.totalVotes || 0), 0)
        const avgVotes = polls.length ? Math.round(totalVotes / polls.length) : 0
        const closingSoon = polls.filter(p => p.closes_at && (new Date(p.closes_at) - Date.now() < 24 * 3600 * 1000)).length

        heroRow.innerHTML = ''
        try {
          heroRow.appendChild(statHero({ label: 'Aktive Umfragen', value: polls.length, icon: 'bar-chart-3', accent: 'indigo', countUpTo: polls.length }))
          heroRow.appendChild(statHero({ label: 'Stimmen gesamt', value: totalVotes, icon: 'vote', accent: 'violet', countUpTo: totalVotes }))
          heroRow.appendChild(statHero({ label: 'Schließen < 24h', value: closingSoon, icon: 'clock', accent: 'amber', countUpTo: closingSoon }))
        } catch (_) {
          heroRow.innerHTML = `
            <div class="stat-hero"><div class="sh-label">Aktive Umfragen</div><div class="sh-value" data-cu="${polls.length}">0</div></div>
            <div class="stat-hero"><div class="sh-label">Stimmen gesamt</div><div class="sh-value" data-cu="${totalVotes}">0</div></div>
            <div class="stat-hero"><div class="sh-label">Schließen < 24h</div><div class="sh-value" data-cu="${closingSoon}">0</div></div>
          `
          heroRow.querySelectorAll('[data-cu]').forEach(el => { try { countUp(el, Number(el.dataset.cu)) } catch (_) {} })
        }

        if (!polls.length) {
          emptyState(body)
          try { fadeIn(container) } catch (_) {}
          return
        }

        const top = [...polls].sort((a, b) => (b.totalVotes || 0) - (a.totalVotes || 0)).slice(0, 8)
        body.innerHTML = `
          <div class="glass-card overview-card">
            <div class="overview-head">
              <div>
                <div class="overview-title">Top Umfragen nach Beteiligung</div>
                <div class="overview-sub">${polls.length} aktiv · Ø ${fmtNumber(avgVotes)} Stimmen / Umfrage</div>
              </div>
            </div>
            <div id="overview-chart" style="height:260px"></div>
          </div>
          <div class="section-title-row">
            <h3>Alle aktiven Umfragen</h3>
            <span class="muted">${polls.length}</span>
          </div>
          <div class="poll-grid" id="poll-grid">
            ${polls.map(pollCard).join('')}
          </div>
        `

        setTimeout(() => {
          const host = document.getElementById('overview-chart')
          if (host) {
            try {
              makeBarChart(host, {
                categories: top.map(p => (p.question.length > 24 ? p.question.slice(0, 22) + '…' : p.question)),
                series: [{ name: 'Stimmen', data: top.map(p => p.totalVotes || 0) }],
                colors: PALETTE,
                height: 260
              })
            } catch (_) {}
          }
          polls.forEach(p => {
            const card = body.querySelector(`.poll-card[data-poll-id="${CSS.escape(String(p.id))}"]`)
            if (!card) return
            const chartEl = card.querySelector('.poll-chart')
            renderBars(chartEl, p)
          })
        }, 20)

        body.querySelectorAll('.poll-card').forEach(card => {
          const id = card.dataset.pollId
          const poll = polls.find(p => String(p.id) === id)
          if (!poll) return
          card.querySelector('[data-action="details"]')?.addEventListener('click', () => openVoterDrawer(poll))
          card.querySelector('[data-action="close"]')?.addEventListener('click', async () => {
            const ok = await closePoll(poll.id)
            if (ok) load()
          })
        })

        try { fadeIn(container) } catch (_) {}
      }

      const load = async () => {
        renderSkeleton()
        try {
          const { rows } = await fetchPolls()
          const normalized = rows.map(normalizePoll)
          const active = normalized.filter(p => p.is_active)
          const ids = active.map(p => p.id)
          const { byPoll } = await fetchVotes(ids)
          state.polls = active.map(p => mergeVotes(p, byPoll[p.id] || []))
          render()
        } catch (e) {
          errorState(body, e.message || String(e), load)
        }
      }

      container.querySelector('#btn-refresh')?.addEventListener('click', () => {
        toast({ type: 'info', message: 'Aktualisiere …' })
        load()
      })
      container.querySelector('#btn-pdf')?.addEventListener('click', () => {
        try { exportPanelAsPdf(container, { title: 'Aktive Umfragen', filename: 'aktive-umfragen.pdf' }) }
        catch (e) { toast({ type: 'error', message: 'PDF-Export fehlgeschlagen' }) }
      })
      container.querySelector('#btn-csv')?.addEventListener('click', () => {
        const rows = state.polls.flatMap(p => p.options.map(o => ({
          poll_id: p.id,
          frage: p.question,
          option: o.label,
          stimmen: o.votes,
          gesamt_stimmen: p.totalVotes,
          endet: p.closes_at || '',
          erstellt: p.created_at || ''
        })))
        if (!rows.length) return toast({ type: 'info', message: 'Keine Daten zum Export' })
        try { exportCsv(rows, 'aktive-umfragen.csv') }
        catch (e) { toast({ type: 'error', message: 'CSV-Export fehlgeschlagen' }) }
      })

      // Data-Fetch im Hintergrund — Skeleton ist schon sichtbar
      load()
    } catch (e) {
      mountErrorState(container, e?.message || String(e))
    }
  }
}
