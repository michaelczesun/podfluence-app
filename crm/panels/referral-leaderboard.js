import { sb } from '/lib/supabase.js?v=20260608j'
import { toast, modal, confirmDialog, fmtNumber, fmtRelativeTime, fmtDateTime, htmlEscape, iconHtml, debounce, spinnerHtml } from '/lib/ui.js?v=20260608j'
import { makeAreaChart, makeBarChart, makeDonutChart } from '/lib/charts.js?v=20260608j'
import { exportPanelAsPdf, exportCsv } from '/lib/export.js?v=20260608j'
import { countUp, fadeIn, skeletonLoader } from '/lib/animations.js?v=20260608j'
import { drawer, tabs, segmentedControl, statHero, glassCard } from '/lib/layout-extras.js?v=20260608j'
import { showUserDetailModal } from '/lib/panel-actions.js?v=20260608j'

const MEDALS = ['🥇', '🥈', '🥉']

// Fallback skeleton HTML in case skeletonLoader import is unavailable
const SKELETON_FALLBACK = '<div style="opacity:.3;padding:12px;text-align:center;">Lade…</div>'

async function fetchLeaderboard() {
  // Kein referral_leaderboard-RPC vorhanden — direkt aus referrals-Tabelle aggregieren
  const { data: refs, error } = await sb
    .from('referrals')
    .select('inviter_id, invitee_id, created_at')
    .order('created_at', { ascending: false })
    .limit(5000)
  if (error) throw error

  const map = new Map()
  for (const r of (refs || [])) {
    if (!r.inviter_id) continue
    const e = map.get(r.inviter_id) || { inviter_id: r.inviter_id, total: 0, last_at: null, last_30d: 0 }
    e.total += 1
    const t = new Date(r.created_at).getTime()
    if (!e.last_at || t > e.last_at) e.last_at = t
    if (Date.now() - t < 30 * 86400000) e.last_30d += 1
    map.set(r.inviter_id, e)
  }
  const list = [...map.values()].sort((a, b) => b.total - a.total).slice(0, 20)

  const ids = list.map(l => l.inviter_id)
  if (ids.length) {
    try {
      // FIX: 'profiles' → 'users' (korrekte Tabelle laut Schema)
      const { data: users } = await sb
        .from('users')
        .select('id, full_name, username, avatar_url, is_verified')
        .in('id', ids)
      const um = new Map((users || []).map(u => [u.id, u]))
      list.forEach(l => {
        const u = um.get(l.inviter_id) || {}
        l.display_name = u.full_name || u.username || 'Unbekannt'
        l.username = u.username || ''
        l.avatar_url = u.avatar_url || null
        l.is_verified = !!u.is_verified
        l.last_referral_at = l.last_at ? new Date(l.last_at).toISOString() : null
      })
    } catch (_) {
      list.forEach(l => {
        l.display_name = 'Unbekannt'
        l.username = ''
        l.avatar_url = null
        l.is_verified = false
        l.last_referral_at = l.last_at ? new Date(l.last_at).toISOString() : null
      })
    }
  }
  return list
}

async function fetchReferralTimeseries() {
  const since = new Date(Date.now() - 30 * 86400000).toISOString()
  const { data, error } = await sb
    .from('referrals')
    .select('created_at')
    .gte('created_at', since)
    .limit(5000)
  if (error) return []
  const buckets = new Map()
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000)
    const key = d.toISOString().slice(0, 10)
    buckets.set(key, 0)
  }
  for (const r of (data || [])) {
    const key = (r.created_at || '').slice(0, 10)
    if (buckets.has(key)) buckets.set(key, buckets.get(key) + 1)
  }
  return [...buckets.entries()].map(([date, count]) => ({ date, count }))
}

async function fetchReferredUsers(inviterId) {
  // FIX: select('*') → konkrete Spalten
  const { data, error } = await sb
    .from('referrals')
    .select('id, inviter_id, invitee_id, created_at, status, bonus_granted')
    .eq('inviter_id', inviterId)
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) return []
  const ids = (data || []).map(r => r.invitee_id).filter(Boolean)
  let users = []
  if (ids.length) {
    try {
      // FIX: 'profiles' → 'users'
      const { data: u } = await sb
        .from('users')
        .select('id, full_name, username, avatar_url, is_verified, created_at')
        .in('id', ids)
      users = u || []
    } catch (_) {}
  }
  const um = new Map(users.map(u => [u.id, u]))
  return (data || []).map(r => ({
    ...r,
    user: um.get(r.invitee_id) || null,
  }))
}

// FIX: grantBonusCode() entfernt — RPC 'grant_referral_bonus_code' existiert nicht.
// Button wird im Drawer ausgeblendet bis Feature implementiert ist.

function podiumCard(row, rank) {
  const heightCls = rank === 0 ? 'podium-1' : rank === 1 ? 'podium-2' : 'podium-3'
  const avatar = row.avatar_url
    ? `<img src="${htmlEscape(row.avatar_url)}" alt="">`
    : `<div class="avatar-fallback">${htmlEscape((row.display_name || '?').slice(0, 1).toUpperCase())}</div>`
  return `
    <div class="podium-card glass-card ${heightCls}" data-uid="${htmlEscape(row.inviter_id)}">
      <div class="podium-medal">${MEDALS[rank]}</div>
      <div class="podium-avatar">${avatar}</div>
      <div class="podium-name">
        ${htmlEscape(row.display_name || 'Unbekannt')}
        ${row.is_verified ? '<span class="verified-badge">✓</span>' : ''}
      </div>
      <div class="podium-username">@${htmlEscape(row.username || '')}</div>
      <div class="podium-count" data-count="${row.total}">0</div>
      <div class="podium-sub">Einladungen</div>
      <div class="podium-meta">
        <span>30d: <strong>${fmtNumber(row.last_30d || 0)}</strong></span>
        ${row.last_referral_at ? `<span>· zuletzt ${fmtRelativeTime(row.last_referral_at)}</span>` : ''}
      </div>
    </div>
  `
}

function listRow(row, rank) {
  const avatar = row.avatar_url
    ? `<img src="${htmlEscape(row.avatar_url)}" alt="" class="row-avatar">`
    : `<div class="row-avatar avatar-fallback">${htmlEscape((row.display_name || '?').slice(0, 1).toUpperCase())}</div>`
  return `
    <tr data-uid="${htmlEscape(row.inviter_id)}" class="lb-row">
      <td class="rank-cell">#${rank}</td>
      <td>
        <div class="user-cell">
          ${avatar}
          <div>
            <div class="user-name">${htmlEscape(row.display_name || 'Unbekannt')} ${row.is_verified ? '<span class="verified-badge">✓</span>' : ''}</div>
            <div class="user-sub">@${htmlEscape(row.username || '')}</div>
          </div>
        </div>
      </td>
      <td class="num-cell"><strong>${fmtNumber(row.total)}</strong></td>
      <td class="num-cell">${fmtNumber(row.last_30d || 0)}</td>
      <td class="muted">${row.last_referral_at ? fmtRelativeTime(row.last_referral_at) : '—'}</td>
      <td class="action-cell">
        <button class="btn-ghost btn-sm" data-act="open">Details</button>
      </td>
    </tr>
  `
}

function emptyState() {
  return `
    <div class="empty-state glass-card">
      <div class="empty-icon">👥</div>
      <h3>Noch keine Einladungen</h3>
      <p class="muted">Sobald die ersten Inviter Nutzer einladen, erscheinen sie hier im Ranking.</p>
      <button class="btn-primary" id="empty-retry">Neu laden</button>
    </div>
  `
}

function errorState(msg) {
  return `
    <div class="error-state glass-card">
      <div class="empty-icon">⚠️</div>
      <h3>Daten konnten nicht geladen werden</h3>
      <p class="muted">${htmlEscape(msg || 'Unbekannter Fehler')}</p>
      <button class="btn-primary" id="err-retry">Erneut versuchen</button>
    </div>
  `
}

async function openInviterDrawer(row) {
  const skeletonHtml = typeof skeletonLoader === 'function'
    ? skeletonLoader({ rows: 6 })
    : (typeof spinnerHtml === 'function' ? spinnerHtml() : SKELETON_FALLBACK)

  const d = drawer({
    title: `Einladungen von ${row.display_name || 'User'}`,
    width: 560,
    contentHtml: `
      <div class="drawer-inviter">
        <div class="drawer-head glass-card">
          <div class="user-cell">
            ${row.avatar_url ? `<img src="${htmlEscape(row.avatar_url)}" class="row-avatar lg">` : `<div class="row-avatar lg avatar-fallback">${htmlEscape((row.display_name || '?').slice(0, 1).toUpperCase())}</div>`}
            <div>
              <div class="user-name">${htmlEscape(row.display_name || '')} ${row.is_verified ? '<span class="verified-badge">✓</span>' : ''}</div>
              <div class="user-sub">@${htmlEscape(row.username || '')}</div>
            </div>
          </div>
          <div class="drawer-stats">
            <div><span class="muted">Gesamt</span><strong>${fmtNumber(row.total)}</strong></div>
            <div><span class="muted">30 Tage</span><strong>${fmtNumber(row.last_30d || 0)}</strong></div>
            <div><span class="muted">Zuletzt</span><strong>${row.last_referral_at ? fmtRelativeTime(row.last_referral_at) : '—'}</strong></div>
          </div>
          <div class="drawer-actions">
            <!-- FIX: Bonus-Code-Button entfernt — RPC nicht implementiert -->
            <button class="btn-secondary" id="open-profile">Profil öffnen</button>
          </div>
        </div>
        <div class="section-title">Eingeladene Nutzer</div>
        <div id="referred-list" class="referred-list">${skeletonHtml}</div>
      </div>
    `,
  })

  // FIX: drawer() gibt Objekt zurück — body-Zugriff absichern; d selbst kann Element sein
  const drawerRoot = (d && typeof d.body !== 'undefined') ? d.body : (d instanceof Element ? d : null)

  try {
    const refs = await fetchReferredUsers(row.inviter_id)
    const listEl = drawerRoot ? drawerRoot.querySelector('#referred-list') : null
    if (!listEl) return
    if (!refs.length) {
      listEl.innerHTML = `<div class="muted small" style="padding:16px;text-align:center;">Keine eingeladenen Nutzer.</div>`
    } else {
      listEl.innerHTML = refs.map(r => {
        const u = r.user || {}
        const av = u.avatar_url
          ? `<img src="${htmlEscape(u.avatar_url)}" class="row-avatar sm">`
          : `<div class="row-avatar sm avatar-fallback">${htmlEscape((u.full_name || u.username || '?').slice(0, 1).toUpperCase())}</div>`
        // status und bonus_granted kommen jetzt sicher aus dem expliziten SELECT
        const statusText = r.status ? htmlEscape(r.status) : 'aktiv'
        const bonusText = r.bonus_granted ? ' · 🎁 Bonus' : ''
        return `
          <div class="referred-row" data-uid="${htmlEscape(r.invitee_id || '')}">
            ${av}
            <div class="referred-meta">
              <div>${htmlEscape(u.full_name || u.username || 'Gelöscht')} ${u.is_verified ? '<span class="verified-badge">✓</span>' : ''}</div>
              <div class="muted small">${fmtDateTime(r.created_at)} · ${statusText}${bonusText}</div>
            </div>
            <button class="btn-ghost btn-sm" data-act="open-user">↗</button>
          </div>
        `
      }).join('')
    }

    drawerRoot.querySelector('#open-profile')?.addEventListener('click', () => {
      if (typeof showUserDetailModal === 'function') showUserDetailModal(row.inviter_id)
      else toast('Profil-Modal nicht verfügbar', { type: 'info' })
    })
    drawerRoot.querySelectorAll('[data-act="open-user"]').forEach(b => {
      b.addEventListener('click', (e) => {
        const uid = e.currentTarget.closest('[data-uid]')?.dataset.uid
        if (uid && typeof showUserDetailModal === 'function') showUserDetailModal(uid)
      })
    })
  } catch (e) {
    const listEl = drawerRoot ? drawerRoot.querySelector('#referred-list') : null
    if (listEl) listEl.innerHTML = `<div class="muted small" style="padding:16px;text-align:center;">Fehler: ${htmlEscape(e.message || String(e))}</div>`
  }
}

export default {
  id: 'referral-leaderboard',
  title: 'Top Inviter',
  category: 'growth',

  async mount(container) {
    // FIX: State außerhalb refresh() damit CSV-Export sauber resettet
    let _board = null

    try {
      container.innerHTML = `
        <style>
          .panel-shell{padding:24px;display:flex;flex-direction:column;gap:20px}
          .panel-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap}
          .panel-head h2{margin:0;font-size:24px;font-weight:600;letter-spacing:-0.02em}
          .panel-head .sub{color:var(--text-muted,#888);font-size:13px;margin-top:4px}
          .toolbar{display:flex;gap:8px;flex-wrap:wrap}
          .toolbar button{display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:10px;border:1px solid var(--border,#2a2a2e);background:var(--bg-soft,#161618);color:var(--text,#eee);font-size:13px;cursor:pointer;transition:all .15s}
          .toolbar button:hover{background:var(--bg-hover,#1f1f23);transform:translateY(-1px)}
          .hero-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px}
          .podium{display:grid;grid-template-columns:1fr 1.15fr 1fr;gap:16px;align-items:end;margin-top:12px}
          .podium-card{padding:22px 16px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:8px;cursor:pointer;transition:all .25s ease;border-radius:18px;position:relative;overflow:hidden}
          .podium-card:hover{transform:translateY(-4px);box-shadow:0 12px 36px rgba(0,0,0,.35)}
          .podium-1{background:linear-gradient(160deg,rgba(255,215,0,.18),rgba(255,215,0,.04));border:1px solid rgba(255,215,0,.35);min-height:280px}
          .podium-2{background:linear-gradient(160deg,rgba(192,192,192,.16),rgba(192,192,192,.04));border:1px solid rgba(192,192,192,.3);min-height:240px}
          .podium-3{background:linear-gradient(160deg,rgba(205,127,50,.18),rgba(205,127,50,.04));border:1px solid rgba(205,127,50,.32);min-height:220px}
          .podium-medal{font-size:34px;line-height:1}
          .podium-avatar img,.podium-avatar .avatar-fallback{width:64px;height:64px;border-radius:50%;object-fit:cover;border:2px solid rgba(255,255,255,.15)}
          .avatar-fallback{display:inline-flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#6366f1,#a855f7);color:#fff;font-weight:600}
          .podium-name{font-weight:600;font-size:15px;display:flex;align-items:center;gap:6px;justify-content:center}
          .podium-username{color:var(--text-muted,#888);font-size:12px}
          .podium-count{font-size:36px;font-weight:700;letter-spacing:-0.03em;background:linear-gradient(135deg,#fff,#bbb);-webkit-background-clip:text;background-clip:text;color:transparent}
          .podium-sub{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--text-muted,#888)}
          .podium-meta{display:flex;gap:8px;font-size:11px;color:var(--text-muted,#888);margin-top:4px}
          .verified-badge{display:inline-block;background:#1da1f2;color:#fff;font-size:10px;font-weight:700;width:16px;height:16px;border-radius:50%;text-align:center;line-height:16px}
          .grid-2{display:grid;grid-template-columns:1.4fr 1fr;gap:20px}
          @media (max-width:900px){.grid-2{grid-template-columns:1fr}.podium{grid-template-columns:1fr}}
          .glass-card{background:linear-gradient(160deg,rgba(255,255,255,.04),rgba(255,255,255,.01));border:1px solid rgba(255,255,255,.06);border-radius:16px;backdrop-filter:blur(20px);padding:18px}
          .section-title{font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:var(--text-muted,#888);margin:18px 0 10px}
          .data-table{width:100%;border-collapse:collapse}
          .data-table th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted,#888);padding:10px 12px;border-bottom:1px solid var(--border,#2a2a2e)}
          .data-table td{padding:12px;border-bottom:1px solid rgba(255,255,255,.04);font-size:13px}
          .data-table tr.lb-row{cursor:pointer;transition:background .15s}
          .data-table tr.lb-row:hover{background:rgba(255,255,255,.04)}
          .rank-cell{font-weight:600;color:var(--text-muted,#888);width:50px}
          .num-cell{text-align:right;font-variant-numeric:tabular-nums}
          .user-cell{display:flex;align-items:center;gap:10px}
          .row-avatar{width:34px;height:34px;border-radius:50%;object-fit:cover}
          .row-avatar.sm{width:28px;height:28px}.row-avatar.lg{width:54px;height:54px}
          .user-name{font-weight:500;display:flex;align-items:center;gap:6px}
          .user-sub{font-size:11px;color:var(--text-muted,#888)}
          .muted{color:var(--text-muted,#888)}
          .small{font-size:11px}
          .btn-ghost{background:transparent;border:1px solid transparent;color:var(--text,#eee);padding:6px 10px;border-radius:8px;cursor:pointer}
          .btn-ghost:hover{background:rgba(255,255,255,.06)}
          .btn-sm{font-size:12px}
          .btn-primary{background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;border:none;padding:10px 18px;border-radius:10px;cursor:pointer;font-weight:500;font-size:13px}
          .btn-primary:hover{filter:brightness(1.1)}
          .btn-secondary{background:rgba(255,255,255,.06);color:var(--text,#eee);border:1px solid rgba(255,255,255,.08);padding:10px 18px;border-radius:10px;cursor:pointer;font-size:13px}
          .empty-state,.error-state{text-align:center;padding:48px 24px;display:flex;flex-direction:column;align-items:center;gap:10px}
          .empty-icon{font-size:42px}
          .drawer-inviter .drawer-head{display:flex;flex-direction:column;gap:14px;margin-bottom:8px}
          .drawer-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
          .drawer-stats>div{background:rgba(255,255,255,.04);border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:2px}
          .drawer-stats strong{font-size:18px;font-variant-numeric:tabular-nums}
          .drawer-actions{display:flex;gap:8px;flex-wrap:wrap}
          .referred-list{display:flex;flex-direction:column;gap:6px}
          .referred-row{display:flex;align-items:center;gap:10px;padding:10px;border-radius:10px;background:rgba(255,255,255,.03);transition:background .15s}
          .referred-row:hover{background:rgba(255,255,255,.06)}
          .referred-meta{flex:1;min-width:0}
          .chart-wrap{height:220px}
        </style>
        <div class="panel-shell">
          <div class="panel-head">
            <div>
              <h2>🏆 Top Inviter</h2>
              <div class="sub">Wer bringt die meisten neuen Podfluencer in die App</div>
            </div>
            <div class="toolbar">
              <button id="btn-refresh">🔄 Aktualisieren</button>
              <button id="btn-pdf">📄 PDF</button>
              <button id="btn-csv">💾 CSV</button>
            </div>
          </div>
          <div id="body"></div>
        </div>
      `

      if (typeof fadeIn === 'function') fadeIn(container)

      const bodyEl = container.querySelector('#body')

      const skeletonHtml = () => `
        <div class="hero-row">
          ${[1,2,3,4].map(()=>'<div class="glass-card" style="height:96px">'+(typeof skeletonLoader==='function'?skeletonLoader({rows:2}):SKELETON_FALLBACK)+'</div>').join('')}
        </div>
        <div class="podium" style="margin-top:24px">
          ${[0,1,2].map(i => `<div class="glass-card podium-${i+1}" style="opacity:.5">${typeof skeletonLoader==='function'?skeletonLoader({rows:4}):(typeof spinnerHtml==='function'?spinnerHtml():SKELETON_FALLBACK)}</div>`).join('')}
        </div>
      `

      const refresh = async () => {
        _board = null
        bodyEl.innerHTML = skeletonHtml()
        try {
          const [board, ts] = await Promise.all([fetchLeaderboard(), fetchReferralTimeseries()])

          if (!board.length) {
            bodyEl.innerHTML = emptyState()
            bodyEl.querySelector('#empty-retry')?.addEventListener('click', refresh)
            return
          }

          const totalInvites = board.reduce((s, r) => s + r.total, 0)
          const last30 = board.reduce((s, r) => s + (r.last_30d || 0), 0)
          const activeInviters = board.filter(r => (r.last_30d || 0) > 0).length
          const topPct = board[0] && totalInvites ? Math.round((board[0].total / totalInvites) * 100) : 0

          const top3 = board.slice(0, 3)
          const rest = board.slice(3, 20)

          bodyEl.innerHTML = `
            <div class="hero-row">
              <div class="glass-card"><div class="muted small">EINLADUNGEN GESAMT</div><div class="hero-val" data-c="${totalInvites}" style="font-size:30px;font-weight:700;letter-spacing:-0.02em">0</div></div>
              <div class="glass-card"><div class="muted small">LETZTE 30 TAGE</div><div class="hero-val" data-c="${last30}" style="font-size:30px;font-weight:700;letter-spacing:-0.02em">0</div></div>
              <div class="glass-card"><div class="muted small">AKTIVE INVITER</div><div class="hero-val" data-c="${activeInviters}" style="font-size:30px;font-weight:700;letter-spacing:-0.02em">0</div></div>
              <div class="glass-card"><div class="muted small">TOP-1 ANTEIL</div><div class="hero-val" data-c="${topPct}" data-suffix="%" style="font-size:30px;font-weight:700;letter-spacing:-0.02em">0%</div></div>
            </div>

            <div class="section-title">Podium</div>
            <div class="podium">
              ${top3[1] ? podiumCard(top3[1], 1) : '<div></div>'}
              ${top3[0] ? podiumCard(top3[0], 0) : '<div></div>'}
              ${top3[2] ? podiumCard(top3[2], 2) : '<div></div>'}
            </div>

            <div class="grid-2" style="margin-top:24px">
              <div class="glass-card">
                <div class="section-title" style="margin-top:0">Einladungen · letzte 30 Tage</div>
                <div class="chart-wrap" id="chart-area"></div>
              </div>
              <div class="glass-card">
                <div class="section-title" style="margin-top:0">Top 5 Verteilung</div>
                <div class="chart-wrap" id="chart-donut"></div>
              </div>
            </div>

            <div class="section-title">Rangliste 4 – ${3 + rest.length}</div>
            <div class="glass-card" style="padding:0;overflow:hidden">
              ${rest.length ? `
                <table class="data-table">
                  <thead>
                    <tr>
                      <th>Rang</th>
                      <th>User</th>
                      <th class="num-cell">Gesamt</th>
                      <th class="num-cell">30 Tage</th>
                      <th>Zuletzt</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    ${rest.map((r, i) => listRow(r, i + 4)).join('')}
                  </tbody>
                </table>
              ` : `<div class="muted small" style="padding:32px;text-align:center">Nur Top-3 vorhanden.</div>`}
            </div>
          `

          bodyEl.querySelectorAll('.hero-val').forEach(el => {
            const target = Number(el.dataset.c) || 0
            const suffix = el.dataset.suffix || ''
            if (typeof countUp === 'function') countUp(el, target, { duration: 900, suffix })
            else el.textContent = fmtNumber(target) + suffix
          })
          bodyEl.querySelectorAll('.podium-count').forEach(el => {
            const target = Number(el.dataset.count) || 0
            if (typeof countUp === 'function') countUp(el, target, { duration: 1100 })
            else el.textContent = fmtNumber(target)
          })

          try {
            const areaEl = bodyEl.querySelector('#chart-area')
            if (areaEl && ts.length && typeof makeAreaChart === 'function') {
              const chart = makeAreaChart({
                categories: ts.map(t => t.date),
                series: [{ name: 'Einladungen', data: ts.map(t => t.count) }],
                colors: ['#8b5cf6'],
                height: 220,
              })
              if (chart instanceof Element) { areaEl.innerHTML = ''; areaEl.appendChild(chart) }
              else if (typeof chart === 'string') { areaEl.innerHTML = chart }
            }
            const donutEl = bodyEl.querySelector('#chart-donut')
            if (donutEl && typeof makeDonutChart === 'function') {
              const top5 = board.slice(0, 5)
              const others = board.slice(5).reduce((s, r) => s + r.total, 0)
              const labels = top5.map(r => r.display_name || ('@' + (r.username || '—')))
              const values = top5.map(r => r.total)
              if (others > 0) { labels.push('Übrige'); values.push(others) }
              const chart = makeDonutChart({
                labels,
                values,
                colors: ['#8b5cf6', '#6366f1', '#a855f7', '#ec4899', '#f59e0b', '#64748b'],
                height: 220,
              })
              if (chart instanceof Element) { donutEl.innerHTML = ''; donutEl.appendChild(chart) }
              else if (typeof chart === 'string') { donutEl.innerHTML = chart }
            }
          } catch (chartErr) {
            console.warn('[referral-leaderboard] Chart render failed', chartErr)
          }

          bodyEl.querySelectorAll('.podium-card').forEach(card => {
            card.addEventListener('click', () => {
              const uid = card.dataset.uid
              const row = board.find(r => r.inviter_id === uid)
              if (row) openInviterDrawer(row)
            })
          })
          bodyEl.querySelectorAll('tr.lb-row').forEach(tr => {
            tr.addEventListener('click', () => {
              const uid = tr.dataset.uid
              const row = board.find(r => r.inviter_id === uid)
              if (row) openInviterDrawer(row)
            })
          })

          _board = board
        } catch (e) {
          bodyEl.innerHTML = errorState(e.message || String(e))
          bodyEl.querySelector('#err-retry')?.addEventListener('click', refresh)
        }
      }

      container.querySelector('#btn-refresh')?.addEventListener('click', () => {
        refresh()
        toast('Aktualisiert', { type: 'success' })
      })
      container.querySelector('#btn-pdf')?.addEventListener('click', async () => {
        try {
          await exportPanelAsPdf(container, { title: 'Top Inviter — Leaderboard' })
        } catch (e) { toast('PDF fehlgeschlagen: ' + (e.message || e), { type: 'error' }) }
      })
      container.querySelector('#btn-csv')?.addEventListener('click', () => {
        const board = _board || []
        if (!board.length) return toast('Keine Daten', { type: 'info' })
        try {
          exportCsv(board.map((r, i) => ({
            rang: i + 1,
            user_id: r.inviter_id,
            name: r.display_name || '',
            username: r.username || '',
            einladungen_gesamt: r.total,
            einladungen_30d: r.last_30d || 0,
            letzte_einladung: r.last_referral_at || '',
          })), 'top-inviter.csv')
        } catch (e) {
          toast('CSV-Export fehlgeschlagen: ' + (e.message || e), { type: 'error' })
        }
      })

      refresh()
    } catch (mountErr) {
      container.innerHTML = `
        <div style="padding:24px">
          <div class="error-state" style="background:linear-gradient(160deg,rgba(255,80,80,.08),rgba(255,80,80,.02));border:1px solid rgba(255,80,80,.25);border-radius:16px;padding:32px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:10px;color:#eee">
            <div style="font-size:42px">⚠️</div>
            <h3 style="margin:0">Panel konnte nicht initialisiert werden</h3>
            <p style="color:#888;margin:0">${(mountErr && mountErr.message) ? String(mountErr.message).replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c])) : 'Unbekannter Fehler'}</p>
          </div>
        </div>
      `
      try { console.error('[referral-leaderboard] mount failed', mountErr) } catch (_) {}
    }
  },
}
