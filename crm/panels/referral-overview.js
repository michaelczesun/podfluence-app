import { sb } from '/lib/supabase.js?v=20260607b'
import { toast, fmtNumber, fmtDateTime, htmlEscape, iconHtml } from '/lib/ui.js?v=20260607b'
import { makeAreaChart, makeDonutChart } from '/lib/charts.js?v=20260607b'
import { exportPanelAsPdf, exportCsv } from '/lib/export.js?v=20260607b'
import { countUp, fadeIn, skeletonLoader } from '/lib/animations.js?v=20260607b'
import { drawer, segmentedControl, statHero } from '/lib/layout-extras.js?v=20260607b'
import { showUserDetailModal } from '/lib/panel-actions.js?v=20260607b'

const RANGES = {
  '7d':  { label: '7 Tage',  days: 7 },
  '30d': { label: '30 Tage', days: 30 },
  '90d': { label: '90 Tage', days: 90 },
  // FIX(med): use a fixed epoch start instead of relative 365 days to avoid silently capping data
  'all': { label: 'Gesamt',  since: '2020-01-01' }
}

let state = {
  range: '30d',
  funnel: null,
  trend: [],
  topReferrers: [],
  recentSignups: []
}

// FIX(high): replace hardcoded stub with real DB query against the `referrals` table.
// Schema: referrals(id, inviter_id, invitee_id, created_at)
// We derive funnel-like metrics from this table:
//   generated  = users who have ever referred someone (distinct inviter_id count)
//   used       = total referral rows (codes used)
//   signedUp   = distinct new users who came via referral
//   shared     = approximated as same as generated (no share-tracking column exists)
async function loadData(range) {
  const cfg = RANGES[range] || RANGES['30d']
  let since
  if (cfg.since) {
    since = cfg.since
  } else {
    const d = new Date()
    d.setDate(d.getDate() - cfg.days)
    since = d.toISOString().slice(0, 10)
  }

  // Fetch referral rows in the time window
  const { data: rows, error } = await sb
    .from('referrals')
    .select('id, inviter_id, invitee_id, created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)

  const total = rows.length
  const uniqueReferrers = new Set(rows.map(r => r.inviter_id)).size
  const uniqueReferred  = new Set(rows.map(r => r.invitee_id)).size

  const funnel = {
    generated: uniqueReferrers, // users who referred at least once
    shared:    uniqueReferrers, // no separate share-tracking; same as generated
    used:      total,           // each row = a referral code used
    signedUp:  uniqueReferred   // distinct users who joined via referral
  }

  // Daily trend: group by date → { date, generated, signups, rate }
  const byDate = {}
  rows.forEach(r => {
    const day = r.created_at.slice(0, 10)
    if (!byDate[day]) byDate[day] = { date: day, generated: 0, signups: 0 }
    byDate[day].signups++
    byDate[day].generated++
  })
  const trend = Object.values(byDate)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(d => ({ ...d, rate: d.generated ? (d.signups / d.generated) * 100 : 0 }))

  // Top referrers: count by inviter_id, fetch profiles
  const countMap = {}
  rows.forEach(r => { countMap[r.inviter_id] = (countMap[r.inviter_id] || 0) + 1 })
  const sortedReferrers = Object.entries(countMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)

  let topReferrers = []
  if (sortedReferrers.length) {
    const ids = sortedReferrers.map(([id]) => id)
    const { data: profiles } = await sb
      .from('users')
      .select('id, full_name, username, avatar_url')
      .in('id', ids)
    const profileMap = {}
    ;(profiles || []).forEach(p => { profileMap[p.id] = p })
    topReferrers = sortedReferrers.map(([id, count]) => ({
      id,
      count,
      profile: profileMap[id] || null
    }))
  }

  // Recent signups: last 50 rows with referrer+referred profile
  const recent50 = rows.slice(0, 50)
  let recentSignups = []
  if (recent50.length) {
    const allIds = [...new Set(recent50.flatMap(r => [r.inviter_id, r.invitee_id]).filter(Boolean))]
    const { data: profiles2 } = await sb
      .from('users')
      .select('id, full_name, username, avatar_url')
      .in('id', allIds)
    const pmap = {}
    ;(profiles2 || []).forEach(p => { pmap[p.id] = p })
    recentSignups = recent50.map(r => ({
      ...r,
      new_user_id: r.invitee_id,
      referrer: pmap[r.inviter_id] || null,
      newUser:  pmap[r.invitee_id] || null
    }))
  }

  return { funnel, trend, topReferrers, recentSignups }
}

function pct(num, denom) {
  if (!denom) return 0
  return (num / denom) * 100
}

function renderFunnel(funnel) {
  const steps = [
    { key: 'generated', label: 'Code generiert', value: funnel.generated, icon: 'zap', color: '#6366f1' },
    { key: 'shared', label: 'Code geteilt', value: funnel.shared, icon: 'share-2', color: '#8b5cf6' },
    { key: 'used', label: 'Code verwendet', value: funnel.used, icon: 'mouse-pointer-click', color: '#ec4899' },
    { key: 'signedUp', label: 'User registriert', value: funnel.signedUp, icon: 'user-check', color: '#10b981' }
  ]
  const max = Math.max(...steps.map(s => s.value), 1)
  return steps.map((s, i) => {
    const widthPct = (s.value / max) * 100
    const prev = i > 0 ? steps[i - 1].value : null
    const dropoff = prev !== null && prev > 0 ? ((prev - s.value) / prev) * 100 : null
    const convFromPrev = prev !== null && prev > 0 ? (s.value / prev) * 100 : null
    return `
      <div class="funnel-step" data-step="${s.key}">
        <div class="funnel-step-head">
          <div class="funnel-step-label">
            <span class="funnel-icon" style="background:${s.color}22;color:${s.color}">${iconHtml(s.icon)}</span>
            <span>${s.label}</span>
          </div>
          <div class="funnel-step-value" data-count="${s.value}">${fmtNumber(s.value)}</div>
        </div>
        <div class="funnel-bar-wrap">
          <div class="funnel-bar" style="width:${widthPct}%;background:linear-gradient(90deg,${s.color}cc,${s.color})"></div>
        </div>
        <div class="funnel-step-meta">
          ${convFromPrev !== null ? `<span class="meta-pill meta-pill-good">${convFromPrev.toFixed(1)}% Conversion</span>` : '<span class="meta-pill meta-pill-base">Top of Funnel</span>'}
          ${dropoff !== null && dropoff > 0 ? `<span class="meta-pill meta-pill-warn">−${dropoff.toFixed(1)}% Drop-off</span>` : ''}
        </div>
      </div>
    `
  }).join('')
}

function renderTopReferrers(list) {
  if (!list.length) {
    return `<div class="empty-state-mini">
      <div class="empty-icon">${iconHtml('users')}</div>
      <div>Noch keine Top-Referrer in diesem Zeitraum.</div>
    </div>`
  }
  const max = list[0]?.count || 1
  return `<div class="referrer-list">${list.map((r, i) => {
    const name = r.profile?.display_name || r.profile?.username || 'Unbekannt'
    const w = (r.count / max) * 100
    return `
      <div class="referrer-row" data-user="${htmlEscape(r.id)}">
        <div class="referrer-rank">#${i + 1}</div>
        <div class="referrer-avatar">${r.profile?.avatar_url ? `<img src="${htmlEscape(r.profile.avatar_url)}" alt="">` : iconHtml('user')}</div>
        <div class="referrer-main">
          <div class="referrer-name">${htmlEscape(name)}</div>
          <div class="referrer-bar"><div class="referrer-bar-fill" style="width:${w}%"></div></div>
        </div>
        <div class="referrer-count"><strong>${fmtNumber(r.count)}</strong><span>Signups</span></div>
      </div>
    `
  }).join('')}</div>`
}

function renderRecentTable(rows) {
  if (!rows.length) {
    return `<div class="empty-state-mini">
      <div class="empty-icon">${iconHtml('inbox')}</div>
      <div>Keine Referral-Signups in diesem Zeitraum.</div>
    </div>`
  }
  return `
    <table class="data-table hover sortable">
      <thead>
        <tr>
          <th>Neuer User</th>
          <th>Eingeladen von</th>
          <th>Zeitpunkt</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => {
          const newName = r.newUser?.display_name || r.newUser?.username || '—'
          const refName = r.referrer?.display_name || r.referrer?.username || '—'
          return `
            <tr>
              <td><strong>${htmlEscape(newName)}</strong></td>
              <td>${htmlEscape(refName)}</td>
              <td class="muted">${fmtDateTime(r.created_at)}</td>
              <td class="row-actions">
                ${r.new_user_id ? `<button class="btn-tiny" data-action="user" data-id="${htmlEscape(r.new_user_id)}">${iconHtml('eye')} Details</button>` : ''}
              </td>
            </tr>
          `
        }).join('')}
      </tbody>
    </table>
  `
}

function panelStyles() {
  return `
    <style>
      .ref-grid { display:grid; grid-template-columns: repeat(12, 1fr); gap:16px; }
      .ref-grid .col-12{grid-column:span 12} .ref-grid .col-8{grid-column:span 8} .ref-grid .col-6{grid-column:span 6} .ref-grid .col-4{grid-column:span 4}
      @media (max-width: 1100px){ .ref-grid .col-8,.ref-grid .col-6,.ref-grid .col-4{grid-column:span 12} }
      .hero-row{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:18px}
      @media (max-width: 900px){.hero-row{grid-template-columns:repeat(2,1fr)}}
      .section-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
      .section-head h3{margin:0;font-size:15px;font-weight:600;letter-spacing:-0.01em}
      .section-head .hint{font-size:12px;color:var(--text-muted,#94a3b8)}
      .funnel-list{display:flex;flex-direction:column;gap:14px}
      .funnel-step{padding:14px 16px;border-radius:14px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);transition:all .2s}
      .funnel-step:hover{background:rgba(255,255,255,0.04);transform:translateX(2px)}
      .funnel-step-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
      .funnel-step-label{display:flex;align-items:center;gap:10px;font-weight:500;font-size:14px}
      .funnel-icon{width:32px;height:32px;border-radius:8px;display:inline-flex;align-items:center;justify-content:center}
      .funnel-icon svg{width:16px;height:16px}
      .funnel-step-value{font-size:20px;font-weight:600;font-variant-numeric:tabular-nums;letter-spacing:-0.02em}
      .funnel-bar-wrap{height:8px;background:rgba(255,255,255,0.04);border-radius:6px;overflow:hidden;margin-bottom:8px}
      .funnel-bar{height:100%;border-radius:6px;transition:width .6s cubic-bezier(.2,.8,.2,1)}
      .funnel-step-meta{display:flex;gap:6px;flex-wrap:wrap}
      .meta-pill{font-size:11px;padding:3px 8px;border-radius:6px;font-weight:500}
      .meta-pill-good{background:rgba(16,185,129,0.12);color:#10b981}
      .meta-pill-warn{background:rgba(245,158,11,0.12);color:#f59e0b}
      .meta-pill-base{background:rgba(99,102,241,0.12);color:#6366f1}
      .referrer-list{display:flex;flex-direction:column;gap:8px}
      .referrer-row{display:grid;grid-template-columns:30px 36px 1fr auto;gap:12px;align-items:center;padding:10px;border-radius:10px;cursor:pointer;transition:background .15s}
      .referrer-row:hover{background:rgba(255,255,255,0.04)}
      .referrer-rank{font-size:12px;color:var(--text-muted,#94a3b8);font-weight:600;text-align:center}
      .referrer-avatar{width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,0.06);display:flex;align-items:center;justify-content:center;overflow:hidden}
      .referrer-avatar img{width:100%;height:100%;object-fit:cover}
      .referrer-avatar svg{width:16px;height:16px;opacity:.6}
      .referrer-name{font-size:13px;font-weight:500;margin-bottom:4px}
      .referrer-bar{height:4px;background:rgba(255,255,255,0.04);border-radius:3px;overflow:hidden}
      .referrer-bar-fill{height:100%;background:linear-gradient(90deg,#6366f1,#8b5cf6);border-radius:3px}
      .referrer-count{text-align:right;font-size:11px;color:var(--text-muted,#94a3b8)}
      .referrer-count strong{display:block;font-size:15px;color:var(--text,#fff);font-variant-numeric:tabular-nums}
      .empty-state-mini{padding:32px;text-align:center;color:var(--text-muted,#94a3b8);font-size:13px}
      .empty-state-mini .empty-icon{width:48px;height:48px;margin:0 auto 12px;border-radius:12px;background:rgba(255,255,255,0.04);display:flex;align-items:center;justify-content:center}
      .empty-state-mini .empty-icon svg{width:22px;height:22px;opacity:.5}
      .empty-state-big{padding:60px 24px;text-align:center}
      .empty-state-big .ic{width:72px;height:72px;margin:0 auto 18px;border-radius:18px;background:linear-gradient(135deg,rgba(99,102,241,0.15),rgba(139,92,246,0.15));display:flex;align-items:center;justify-content:center}
      .empty-state-big .ic svg{width:32px;height:32px;color:#8b5cf6}
      .empty-state-big h3{margin:0 0 6px;font-size:17px}
      .empty-state-big p{margin:0;color:var(--text-muted,#94a3b8);font-size:13px;max-width:380px;margin-inline:auto}
      .error-state{padding:48px 24px;text-align:center}
      .error-state .ic{width:56px;height:56px;margin:0 auto 14px;border-radius:14px;background:rgba(239,68,68,0.12);display:flex;align-items:center;justify-content:center;color:#ef4444}
      .btn-tiny{font-size:11px;padding:4px 8px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:6px;cursor:pointer;color:inherit;display:inline-flex;gap:4px;align-items:center}
      .btn-tiny:hover{background:rgba(255,255,255,0.08)}
      .btn-tiny svg{width:11px;height:11px}
      .toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
      .toolbar .tb-btn{display:inline-flex;align-items:center;gap:6px;padding:7px 12px;font-size:12px;border-radius:8px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);cursor:pointer;color:inherit;transition:all .15s}
      .toolbar .tb-btn:hover{background:rgba(255,255,255,0.08);border-color:rgba(255,255,255,0.14)}
      .toolbar .tb-btn svg{width:13px;height:13px}
      .ref-summary-strip{display:flex;align-items:center;gap:14px;padding:10px 14px;border-radius:12px;background:linear-gradient(90deg,rgba(99,102,241,0.08),rgba(16,185,129,0.06));border:1px solid rgba(255,255,255,0.06);margin-bottom:18px;font-size:13px}
      .ref-summary-strip strong{color:#10b981;font-variant-numeric:tabular-nums}
    </style>
  `
}

function buildToolbar() {
  return `
    <div class="toolbar">
      <div id="range-picker"></div>
      <button class="tb-btn" data-tb="refresh">${iconHtml('refresh-cw')} Aktualisieren</button>
      <button class="tb-btn" data-tb="pdf">${iconHtml('file-text')} PDF</button>
      <button class="tb-btn" data-tb="csv">${iconHtml('download')} CSV</button>
    </div>
  `
}

function renderBody(body, data) {
  const overallConv = pct(data.funnel.signedUp, data.funnel.generated)
  const avgConv = data.trend.length ? data.trend.reduce((s, t) => s + t.rate, 0) / data.trend.length : 0
  // FIX(med): pre-format conversion string since statHero.countUp does not support suffix/decimals params
  const convStr = overallConv.toFixed(1) + '%'

  body.innerHTML = `
    ${panelStyles()}
    <div class="ref-summary-strip">
      ${iconHtml('trending-up')}
      <div>Im gewählten Zeitraum wurden <strong>${fmtNumber(data.funnel.generated)}</strong> Codes generiert und <strong>${fmtNumber(data.funnel.signedUp)}</strong> neue User registriert — Gesamt-Conversion <strong>${overallConv.toFixed(1)}%</strong>.</div>
    </div>

    <div class="hero-row" id="hero-row"></div>

    <div class="ref-grid">
      <div class="col-6 glass-card" style="padding:20px">
        <div class="section-head">
          <h3>Conversion-Funnel</h3>
          <span class="hint">Schrittweise Drop-off</span>
        </div>
        <div class="funnel-list">${renderFunnel(data.funnel)}</div>
      </div>

      <div class="col-6 glass-card" style="padding:20px">
        <div class="section-head">
          <h3>Funnel-Verteilung</h3>
          <span class="hint">Anteil pro Stufe</span>
        </div>
        <div id="funnel-donut" style="height:280px"></div>
      </div>

      <div class="col-12 glass-card" style="padding:20px">
        <div class="section-head">
          <h3>Conversion-Rate Trend</h3>
          <span class="hint">Ø ${avgConv.toFixed(1)}% • tägliche Rate (Signups / Codes)</span>
        </div>
        <div id="trend-chart" style="height:300px"></div>
      </div>

      <div class="col-6 glass-card" style="padding:20px">
        <div class="section-head">
          <h3>Top-Referrer</h3>
          <span class="hint">Erfolgreichste Einlader</span>
        </div>
        <div id="top-referrers">${renderTopReferrers(data.topReferrers)}</div>
      </div>

      <div class="col-6 glass-card" style="padding:20px">
        <div class="section-head">
          <h3>Letzte Referral-Signups</h3>
          <button class="btn-tiny" data-tb="view-all">${iconHtml('list')} Alle anzeigen</button>
        </div>
        <div id="recent-table">${renderRecentTable(data.recentSignups)}</div>
      </div>
    </div>
  `

  const hero = body.querySelector('#hero-row')
  try {
    hero.appendChild(statHero({ label: 'Codes generiert', value: data.funnel.generated, icon: 'zap', accent: '#6366f1' }))
    hero.appendChild(statHero({ label: 'Codes verwendet', value: data.funnel.used, icon: 'mouse-pointer-click', accent: '#ec4899' }))
    hero.appendChild(statHero({ label: 'Neue User', value: data.funnel.signedUp, icon: 'user-check', accent: '#10b981' }))
    // FIX(med): statHero.countUp derives format from the value; pass pre-formatted string so it renders as "14.3%"
    hero.appendChild(statHero({ label: 'Conversion', value: convStr, icon: 'target', accent: '#f59e0b' }))
  } catch (e) {
    console.warn('[referral-overview] statHero failed', e)
  }

  body.querySelectorAll('.funnel-step-value').forEach(el => {
    const target = parseInt(el.dataset.count || '0', 10)
    try { countUp(el, 0, target, 900) } catch (_) {}
  })

  const trendEl = body.querySelector('#trend-chart')
  if (data.trend.length) {
    try {
      makeAreaChart(trendEl, {
        data: data.trend,
        x: 'date',
        y: 'rate',
        ySuffix: '%',
        color: '#10b981',
        gradient: true,
        smooth: true,
        tooltipLabel: 'Conversion-Rate'
      })
    } catch (e) {
      trendEl.innerHTML = `<div class="empty-state-mini"><div class="empty-icon">${iconHtml('activity')}</div><div>Chart konnte nicht gerendert werden.</div></div>`
    }
  } else {
    trendEl.innerHTML = `<div class="empty-state-mini"><div class="empty-icon">${iconHtml('activity')}</div><div>Keine Trend-Daten verfügbar.</div></div>`
  }

  const donutEl = body.querySelector('#funnel-donut')
  try {
    makeDonutChart(donutEl, {
      data: [
        { label: 'Generiert', value: Math.max(data.funnel.generated - data.funnel.shared, 0), color: '#6366f1' },
        { label: 'Geteilt', value: Math.max(data.funnel.shared - data.funnel.used, 0), color: '#8b5cf6' },
        { label: 'Verwendet', value: Math.max(data.funnel.used - data.funnel.signedUp, 0), color: '#ec4899' },
        { label: 'Registriert', value: data.funnel.signedUp, color: '#10b981' }
      ],
      centerLabel: 'Funnel',
      centerValue: fmtNumber(data.funnel.generated)
    })
  } catch (e) {
    donutEl.innerHTML = `<div class="empty-state-mini"><div class="empty-icon">${iconHtml('pie-chart')}</div><div>Donut konnte nicht gerendert werden.</div></div>`
  }
}

function renderEmpty(body) {
  body.innerHTML = `
    ${panelStyles()}
    <div class="empty-state-big glass-card">
      <div class="ic">${iconHtml('share-2')}</div>
      <h3>Noch keine Referral-Daten</h3>
      <p>Sobald User Einladungs-Codes generieren und teilen, erscheinen hier Funnel und Conversion-Trend.</p>
    </div>
  `
}

function renderError(body, err, retry) {
  body.innerHTML = `
    ${panelStyles()}
    <div class="error-state glass-card">
      <div class="ic">${iconHtml('alert-triangle')}</div>
      <h3 style="margin:0 0 6px">Daten konnten nicht geladen werden</h3>
      <p style="color:var(--text-muted,#94a3b8);font-size:13px;margin:0 0 14px">Fehler: ${htmlEscape(err?.message || 'Unbekannter Fehler')}</p>
      <button class="tb-btn" id="retry-btn">${iconHtml('refresh-cw')} Erneut versuchen</button>
    </div>
  `
  body.querySelector('#retry-btn')?.addEventListener('click', retry)
}

export default {
  id: 'referral-overview',
  title: 'Referral-Conversion',
  category: 'growth',

  async mount(container) {
    try {
      container.innerHTML = `
        <div class="panel-shell">
          <div class="panel-head">
            <div>
              <h2 style="margin:0">Referral-Conversion</h2>
              <div style="font-size:12px;color:var(--text-muted,#94a3b8);margin-top:2px">Funnel von Code-Generation bis Registrierung</div>
            </div>
            <div id="toolbar-slot">${buildToolbar()}</div>
          </div>
          <div class="panel-body" id="body"></div>
        </div>
      `

      const body = container.querySelector('#body')

      // Initial skeleton SOFORT zeigen, bevor irgendein await läuft
      try { skeletonLoader(body, { rows: 6, height: 80 }) } catch (_) {}

      // FIX(high): openReferrerDrawer and openAllSignupsDrawer must be declared before wireBody
      // which references them, and wireBody must be declared before refresh which calls it.
      // All three must be declared before segmentedControl instantiation to avoid TDZ.

      const openReferrerDrawer = (userId) => {
        const ref = state.topReferrers.find(r => r.id === userId)
        const name = ref?.profile?.display_name || ref?.profile?.username || 'Referrer'
        try {
          drawer({
            title: name,
            subtitle: `${fmtNumber(ref?.count || 0)} erfolgreiche Einladungen`,
            width: 480,
            html: `
              <div style="padding:20px">
                <div style="display:flex;gap:14px;align-items:center;margin-bottom:20px">
                  <div style="width:56px;height:56px;border-radius:50%;background:rgba(255,255,255,0.06);overflow:hidden;display:flex;align-items:center;justify-content:center">
                    ${ref?.profile?.avatar_url ? `<img src="${htmlEscape(ref.profile.avatar_url)}" style="width:100%;height:100%;object-fit:cover">` : iconHtml('user')}
                  </div>
                  <div>
                    <div style="font-size:16px;font-weight:600">${htmlEscape(name)}</div>
                    <div style="font-size:12px;color:var(--text-muted,#94a3b8)">@${htmlEscape(ref?.profile?.username || '—')}</div>
                  </div>
                </div>
                <button class="tb-btn" id="open-user-detail">${iconHtml('external-link')} Vollständiges Profil öffnen</button>
              </div>
            `,
            onMount: (el) => {
              el.querySelector('#open-user-detail')?.addEventListener('click', () => showUserDetailModal(userId))
            }
          })
        } catch (e) {
          showUserDetailModal(userId)
        }
      }

      const openAllSignupsDrawer = () => {
        try {
          drawer({
            title: 'Alle Referral-Signups',
            subtitle: `${fmtNumber(state.recentSignups.length)} im Zeitraum`,
            width: 720,
            html: `<div style="padding:16px">${renderRecentTable(state.recentSignups)}</div>`,
            onMount: (el) => {
              el.querySelectorAll('[data-action="user"]').forEach(btn => {
                btn.addEventListener('click', () => {
                  const id = btn.dataset.id
                  if (id) showUserDetailModal(id)
                })
              })
            }
          })
        } catch (e) {
          toast('Drawer konnte nicht geöffnet werden', 'error')
        }
      }

      const wireBody = (root) => {
        root.querySelectorAll('[data-action="user"]').forEach(btn => {
          btn.addEventListener('click', () => {
            const id = btn.dataset.id
            if (id) showUserDetailModal(id)
          })
        })
        root.querySelectorAll('.referrer-row').forEach(row => {
          row.addEventListener('click', () => {
            const uid = row.dataset.user
            if (uid) openReferrerDrawer(uid)
          })
        })
        root.querySelector('[data-tb="view-all"]')?.addEventListener('click', openAllSignupsDrawer)
      }

      // FIX(high): refresh declared after wireBody/openReferrerDrawer/openAllSignupsDrawer
      // so all captured references are fully assigned before segmentedControl onChange can call refresh
      const refresh = async () => {
        body.innerHTML = ''
        try { skeletonLoader(body, { rows: 6, height: 80 }) } catch (_) {}
        try {
          const data = await loadData(state.range)
          state.funnel = data.funnel
          state.trend = data.trend
          state.topReferrers = data.topReferrers
          state.recentSignups = data.recentSignups

          if (data.funnel.generated === 0 && data.funnel.signedUp === 0) {
            renderEmpty(body)
            return
          }
          renderBody(body, data)
          wireBody(body)
        } catch (err) {
          console.error('[referral-overview] load failed', err)
          renderError(body, err, refresh)
        }
      }

      // segmentedControl instantiated AFTER refresh is defined — no TDZ risk
      const rangeSlot = container.querySelector('#range-picker')
      try {
        rangeSlot.appendChild(segmentedControl({
          options: Object.entries(RANGES).map(([k, v]) => ({ value: k, label: v.label })),
          value: state.range,
          onChange: (val) => { state.range = val; refresh() }
        }))
      } catch (e) {
        console.warn('[referral-overview] segmentedControl failed', e)
      }

      try { fadeIn(container, 250) } catch (_) {}

      container.querySelector('[data-tb="refresh"]')?.addEventListener('click', () => {
        refresh().then(() => toast('Daten aktualisiert', 'success'))
      })
      container.querySelector('[data-tb="pdf"]')?.addEventListener('click', () => {
        try {
          exportPanelAsPdf(container, { filename: `referral-conversion-${state.range}.pdf`, title: 'Referral-Conversion' })
        } catch (e) {
          toast('PDF-Export fehlgeschlagen', 'error')
        }
      })
      container.querySelector('[data-tb="csv"]')?.addEventListener('click', () => {
        if (!state.trend.length) { toast('Keine Daten zum Exportieren', 'warning'); return }
        try {
          exportCsv({
            filename: `referral-trend-${state.range}.csv`,
            rows: state.trend.map(t => ({
              date: t.date,
              codes_generated: t.generated,
              signups: t.signups,
              conversion_rate_pct: t.rate.toFixed(2)
            }))
          })
        } catch (e) {
          toast('CSV-Export fehlgeschlagen', 'error')
        }
      })

      await refresh()
    } catch (mountErr) {
      console.error('[referral-overview] mount failed', mountErr)
      // FIX(low): use htmlEscape consistently instead of inline regex sanitization
      container.innerHTML = `
        <div style="padding:48px 24px;text-align:center">
          <div style="width:56px;height:56px;margin:0 auto 14px;border-radius:14px;background:rgba(239,68,68,0.12);display:flex;align-items:center;justify-content:center;color:#ef4444">!</div>
          <h3 style="margin:0 0 6px">Panel konnte nicht geladen werden</h3>
          <p style="color:#94a3b8;font-size:13px;margin:0">Fehler: ${htmlEscape(mountErr?.message || 'Unbekannter Mount-Fehler')}</p>
        </div>
      `
    }
  }
}
