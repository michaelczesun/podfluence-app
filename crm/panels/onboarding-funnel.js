import { sb } from '/lib/supabase.js?v=20260608e'
import { toast, modal, fmtNumber, fmtDateTime, fmtRelativeTime, htmlEscape, iconHtml, confirmDialog } from '/lib/ui.js?v=20260608e'
import { makeAreaChart, makeBarChart, makeDonutChart } from '/lib/charts.js?v=20260608e'
import { exportPanelAsPdf, exportCsv } from '/lib/export.js?v=20260608e'
import { countUp, fadeIn, skeletonLoader } from '/lib/animations.js?v=20260608e'
import { drawer, statHero, glassCard, segmentedControl } from '/lib/layout-extras.js?v=20260608e'
import { showUserDetailModal } from '/lib/panel-actions.js?v=20260608e'

const STAGES = [
  { key: 'signup',  label: 'Signup',          desc: 'Account erstellt',            icon: 'user-plus',   color: '#6366f1' },
  { key: 'profile', label: 'Profil gefüllt',  desc: 'Avatar + Bio gesetzt',        icon: 'user-check',  color: '#8b5cf6' },
  { key: 'listen',  label: 'First Listen',    desc: 'Erste Folge angehört',        icon: 'headphones',  color: '#ec4899' },
  { key: 'active',  label: 'Active',          desc: 'Zuletzt aktiv ≤ 7 Tage',      icon: 'zap',         color: '#10b981' }
]

// Range → days. 'all' = effectively Lifetime (10y)
function rangeToDays(range) {
  if (range === '7d')  return 7
  if (range === '30d') return 30
  if (range === '90d') return 90
  if (range === 'all') return 3650
  return 90
}

async function fetchFunnel(range = '90d') {
  const days = rangeToDays(range)
  // Try dedicated RPC first
  try {
    const { data, error } = await sb.rpc('onboarding_funnel_stats', { p_days: days })
    if (!error && data) return normalizeRpc(data)
    // RPC not available — fall through to manual build
    console.warn('[onboarding-funnel] onboarding_funnel_stats nicht verfügbar, nutze Fallback')
  } catch (_) {
    console.warn('[onboarding-funnel] onboarding_funnel_stats nicht verfügbar, nutze Fallback')
  }

  // Build from available RPCs: admin_users_list_full + admin_daily_series + listening_activity
  const sinceRange = new Date(Date.now() - days * 86400000).toISOString()
  // 'Active' bleibt 7 Tage egal welcher Range — Definition von 'aktiv ≤ 7 Tage'
  const since7  = new Date(Date.now() - 7  * 86400000).toISOString()

  // admin_daily_series ist auf 'episodes'-Metrik begrenzt — clampen wenn All Time
  const seriesDays = Math.min(days, 365)

  // RPC-Param-Namen sind p_limit/p_offset/p_search bzw. p_metric/p_days
  const [usersRes, signupSeriesRes, listensRes] = await Promise.all([
    sb.rpc('admin_users_list_full', { p_limit: 5000, p_offset: 0, p_search: '' }),
    sb.rpc('admin_daily_series', { p_metric: 'signups', p_days: seriesDays }),
    sb.from('listening_activity')
      .select('listener_id')
      .gte('created_at', sinceRange)
      .limit(20000)
  ])

  if (usersRes.error) throw usersRes.error

  const all = usersRes.data || []
  if (listensRes.error) {
    console.warn('[onboarding-funnel] listening_activity query failed:', listensRes.error.message)
  }
  const listenSet = new Set((listensRes.data || []).map(l => l.listener_id))

  // Signup = Users innerhalb des Zeitraums registriert (bzw. all bei 'all')
  const signupMembers = range === 'all'
    ? all
    : all.filter(u => u.created_at && u.created_at >= sinceRange)

  // FIX (math): cascade stages so each next stage is a subset of the previous.
  // Verhindert >100% Conversion und negative Drop-offs.
  // Profile filled = has avatar_url OR bio (best proxy available)
  const profileMembers = signupMembers.filter(u => u.avatar_url || u.bio)

  // First listen — Teilmenge aus profileMembers
  const listenMembers = profileMembers.filter(u => listenSet.has(u.id))

  // Active — Teilmenge aus listenMembers (last_seen_at innerhalb 7d)
  const activeMembers = listenMembers.filter(u => u.last_seen_at && u.last_seen_at >= since7)

  const members = {
    signup: signupMembers,
    profile: profileMembers,
    listen: listenMembers,
    active: activeMembers
  }

  // Use admin_daily_series for the sparkline (more accurate than counting created_at from RPC)
  const rawSeries = (signupSeriesRes.data || [])
  const series = rawSeries.map(p => ({ x: p.date, y: p.value }))

  return {
    counts: {
      signup:  signupMembers.length,
      profile: profileMembers.length,
      listen:  listenMembers.length,
      active:  activeMembers.length
    },
    members,
    series
  }
}

function normalizeRpc(d) {
  return {
    counts: {
      signup:  d.signup  || 0,
      profile: d.profile || 0,
      listen:  d.listen  || 0,
      active:  d.active  || 0
    },
    members: d.members || { signup: [], profile: [], listen: [], active: [] },
    series: d.series || []
  }
}

function dropOffUsers(data, stageKey) {
  const idx = STAGES.findIndex(s => s.key === stageKey)
  if (idx <= 0) return []
  const prev = data.members[STAGES[idx - 1].key] || []
  const curr = new Set((data.members[stageKey] || []).map(u => u.id))
  return prev.filter(u => !curr.has(u.id))
}

function injectStyles() {
  if (document.getElementById('onboarding-funnel-styles')) return
  const s = document.createElement('style')
  s.id = 'onboarding-funnel-styles'
  s.textContent = `
    .of-wrap { display:flex; flex-direction:column; gap:20px; }
    .of-hero-row { display:grid; grid-template-columns:repeat(4,1fr); gap:14px; }
    @media(max-width:900px){ .of-hero-row{ grid-template-columns:repeat(2,1fr); } }
    .of-funnel { display:flex; flex-direction:column; gap:14px; padding:24px; }
    .of-stage { position:relative; cursor:pointer; border-radius:14px; padding:18px 22px; color:#fff;
      transition:transform .18s ease, box-shadow .18s ease, filter .18s ease;
      display:flex; align-items:center; justify-content:space-between; gap:18px;
      box-shadow:0 4px 18px rgba(0,0,0,.08);
    }
    .of-stage:hover { transform:translateY(-2px); filter:brightness(1.05); box-shadow:0 8px 28px rgba(0,0,0,.18); }
    .of-stage .of-left { display:flex; align-items:center; gap:14px; min-width:0; }
    .of-stage .of-icon { width:44px; height:44px; border-radius:12px; background:rgba(255,255,255,.18);
      display:flex; align-items:center; justify-content:center; flex-shrink:0; }
    .of-stage .of-icon svg { width:22px; height:22px; }
    .of-stage h3 { margin:0; font-size:17px; font-weight:600; color:#fff; }
    .of-stage .of-desc { margin:2px 0 0; font-size:12px; opacity:.85; }
    .of-stage .of-right { text-align:right; flex-shrink:0; }
    .of-stage .of-count { font-size:26px; font-weight:700; line-height:1; }
    .of-stage .of-pct { font-size:12px; opacity:.85; margin-top:4px; }
    .of-arrow { display:flex; align-items:center; justify-content:center; gap:10px; color:var(--text-secondary,#6b7280); font-size:13px; }
    .of-arrow .of-drop { color:#ef4444; font-weight:600; }
    .of-arrow .of-conv { color:#10b981; font-weight:600; }
    .of-charts { display:grid; grid-template-columns:1.6fr 1fr; gap:16px; }
    @media(max-width:900px){ .of-charts{ grid-template-columns:1fr; } }
    .of-section-title { font-size:13px; font-weight:600; color:var(--text-secondary,#6b7280); text-transform:uppercase; letter-spacing:.5px; margin:0 0 10px; }
    .of-drop-toolbar { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:14px 16px; border-bottom:1px solid var(--border,#e5e7eb); position:sticky; top:0; background:var(--bg,#fff); z-index:2; }
    .of-drop-list { padding:8px 0; }
    .of-drop-row { display:flex; align-items:center; gap:12px; padding:10px 16px; border-bottom:1px solid var(--border-light,#f3f4f6); cursor:pointer; transition:background .12s; }
    .of-drop-row:hover { background:var(--hover,#f9fafb); }
    .of-drop-row input[type=checkbox] { width:18px; height:18px; cursor:pointer; }
    .of-avatar { width:36px; height:36px; border-radius:50%; background:linear-gradient(135deg,#6366f1,#8b5cf6); color:#fff; display:flex; align-items:center; justify-content:center; font-weight:600; font-size:14px; flex-shrink:0; }
    .of-meta { flex:1; min-width:0; }
    .of-meta .of-name { font-weight:600; font-size:14px; color:var(--text,#111); }
    .of-meta .of-sub  { font-size:12px; color:var(--text-secondary,#6b7280); }
    .of-empty { text-align:center; padding:60px 20px; color:var(--text-secondary,#6b7280); }
    .of-empty svg { width:48px; height:48px; opacity:.5; margin-bottom:12px; }
    .of-btn-primary { background:linear-gradient(135deg,#6366f1,#8b5cf6); color:#fff; border:0; padding:10px 16px; border-radius:10px; font-weight:600; cursor:pointer; display:inline-flex; align-items:center; gap:8px; }
    .of-btn-primary:hover { filter:brightness(1.08); }
    .of-btn-primary:disabled { opacity:.5; cursor:not-allowed; }
    @keyframes of-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
    .of-shimmer { background:linear-gradient(90deg,#eee,#f6f6f6,#eee); background-size:200% 100%; animation:of-shimmer 1.4s linear infinite; }
  `
  document.head.appendChild(s)
}

function appendSkeleton(host, opts) {
  try {
    const sk = skeletonLoader(opts)
    if (sk instanceof Node) { host.appendChild(sk); return }
    if (typeof sk === 'string') { host.insertAdjacentHTML('beforeend', sk); return }
  } catch (_) { /* fallthrough */ }
  const div = document.createElement('div')
  div.className = 'of-shimmer'
  div.style.cssText = `height:${opts?.height || 80}px; border-radius:${opts?.radius || 14}px;`
  host.appendChild(div)
}

function renderFunnelHTML(data) {
  if (data._missingTables) {
    return `
      <div class="glass-card" style="padding:32px; text-align:center; color:var(--text-secondary,#6b7280);">
        ${iconHtml('alert')}
        <div style="margin-top:12px; font-size:14px;">Daten kommen sobald die Tabelle <strong>users</strong> oder das RPC <strong>onboarding_funnel_stats</strong> angelegt ist</div>
      </div>
    `
  }
  const counts = data.counts
  const top = counts.signup || 1
  let html = '<div class="of-funnel">'
  STAGES.forEach((s, i) => {
    const c = counts[s.key] || 0
    const widthPct = Math.max(35, Math.round((c / top) * 100))
    const overallPct = top ? Math.round((c / top) * 100) : 0
    html += `
      <div class="of-stage" data-stage="${s.key}" style="background:linear-gradient(135deg,${s.color},${s.color}cc); width:${widthPct}%; margin-left:${(100 - widthPct) / 2}%;">
        <div class="of-left">
          <div class="of-icon">${iconHtml(s.icon)}</div>
          <div><h3>${htmlEscape(s.label)}</h3><div class="of-desc">${htmlEscape(s.desc)}</div></div>
        </div>
        <div class="of-right">
          <div class="of-count" data-count="${c}">${fmtNumber(c)}</div>
          <div class="of-pct">${overallPct}% von Signup</div>
        </div>
      </div>
    `
    if (i < STAGES.length - 1) {
      const next = counts[STAGES[i + 1].key] || 0
      // FIX (math-impossible-values): clamp conversion to max 100% and drop-off to min 0.
      // Wenn next > c (z.B. weil eine Stufe einen strengeren Filter hat als die nächste),
      // sind 242% Conversion und negative Drop-offs Unsinn. max(0, prev-curr) für Drop,
      // min(100, curr/prev*100) für Conversion. Wenn drop=0 wird "−0" nicht angezeigt.
      const conv = c ? Math.min(100, Math.round((next / c) * 100)) : 0
      const drop = Math.max(0, c - next)
      html += `
        <div class="of-arrow">
          ${iconHtml('arrow-down')}
          <span class="of-conv">${conv}% Conversion</span>
          <span>·</span>
          <span class="of-drop">${drop > 0 ? '−' : ''}${fmtNumber(drop)} Drop-off</span>
        </div>
      `
    }
  })
  html += '</div>'
  return html
}

function renderHeroes(host, data, rangeLabel) {
  const c = data.counts
  const total = c.signup || 1
  // FIX (math-impossible-values): Gesamt-Conversion auf 100% clampen.
  const overallConv = Math.min(100, Math.round((c.active / total) * 100))
  let worst = { idx: 1, rate: 100 }
  for (let i = 1; i < STAGES.length; i++) {
    const prev = c[STAGES[i - 1].key] || 1
    const cur = c[STAGES[i].key] || 0
    // Rate clampen, sonst kann "Größter Drop-off" negativ werden (242% → -142%)
    const r = Math.min(100, Math.round((cur / prev) * 100))
    if (r < worst.rate) worst = { idx: i, rate: r }
  }

  host.innerHTML = ''
  // FIX (rendering): statHero akzeptiert nur {label, value, change, icon}.
  // icon MUSS via iconHtml() SVG-string sein, sonst wird "user-plus" als Text gerendert.
  // suffix/sublabel/color/countUp werden vom Helper nicht unterstützt → in label/value einbetten.
  host.appendChild(statHero({ label: `Signups (${rangeLabel || '90d'})`, value: fmtNumber(c.signup),  icon: iconHtml('user-plus') }))
  host.appendChild(statHero({ label: 'Aktive Nutzer',     value: fmtNumber(c.active),  icon: iconHtml('zap') }))
  host.appendChild(statHero({ label: 'Gesamt-Conversion', value: `${overallConv}%`, icon: iconHtml('trending-up') }))
  host.appendChild(statHero({
    label: `Größter Drop-off (${STAGES[worst.idx - 1]?.label || ''} → ${STAGES[worst.idx]?.label || ''})`,
    value: `${100 - worst.rate}%`,
    icon: iconHtml('alert-triangle')
  }))
}

function renderCharts(host, data) {
  host.innerHTML = `
    <div class="glass-card" style="padding:18px;">
      <div class="of-section-title">Signups · letzte 30 Tage</div>
      <div id="of-area" style="height:240px;"></div>
    </div>
    <div class="glass-card" style="padding:18px;">
      <div class="of-section-title">Verteilung pro Stufe</div>
      <div id="of-donut" style="height:240px;"></div>
    </div>
  `
  const area = host.querySelector('#of-area')
  const donut = host.querySelector('#of-donut')

  if (data.series && data.series.length) {
    // FIX (data): korrekte Shape {categories, series:[{name,data}], colors, height}
    try {
      makeAreaChart(area, {
        categories: data.series.map(p => p.x),
        series: [{ name: 'Signups', data: data.series.map(p => p.y) }],
        colors: ['#6366f1'],
        height: 240
      })
    } catch (e) { area.innerHTML = `<div class="of-empty">${iconHtml('alert-triangle')}<div>Chart-Fehler: ${htmlEscape(e.message || '')}</div></div>` }
  } else {
    area.innerHTML = `<div class="of-empty">${iconHtml('bar-chart')}<div style="font-weight:600; margin-bottom:4px;">Keine Signups</div><div style="font-size:12px;">Im gewählten Zeitraum wurden keine neuen Accounts erstellt.</div></div>`
  }

  // FIX (data): Donut-Shape {labels, values, colors, height} statt {data:[...]}
  const donutValues = STAGES.map(s => data.counts[s.key] || 0)
  const donutHasData = donutValues.some(v => v > 0)
  if (donutHasData) {
    try {
      makeDonutChart(donut, {
        labels: STAGES.map(s => s.label),
        values: donutValues,
        colors: STAGES.map(s => s.color),
        height: 240
      })
    } catch (e) {
      donut.innerHTML = `<div class="of-empty">${iconHtml('alert-triangle')}<div>Chart-Fehler: ${htmlEscape(e.message || '')}</div></div>`
    }
  } else {
    donut.innerHTML = `<div class="of-empty">${iconHtml('pie-chart')}<div style="font-weight:600; margin-bottom:4px;">Noch keine Daten</div><div style="font-size:12px;">Sobald User durch den Funnel laufen, erscheint die Verteilung hier.</div></div>`
  }
}

async function sendReactivationMails(userIds) {
  if (!userIds.length) return
  const confirmed = await confirmDialog({
    title: 'Reactivation-Mail senden',
    message: `Möchtest du wirklich an ${userIds.length} Nutzer:innen eine Reactivation-Mail schicken?`,
    confirmText: 'Senden',
    danger: false
  })
  if (!confirmed) return

  // FIX (med): Edge Function send-reactivation-mail deployment status unknown.
  // Show clear error to admin instead of silent catch.
  try {
    const { error } = await sb.functions.invoke('send-reactivation-mail', { body: { user_ids: userIds } })
    if (error) throw error
    toast(`Reactivation-Mail an ${userIds.length} Nutzer:innen versendet`, 'success')
  } catch (e) {
    console.error('[onboarding-funnel] send-reactivation-mail Edge Function Fehler:', e)
    toast('Versand fehlgeschlagen: ' + (e.message || 'Edge Function nicht erreichbar — bitte prüfen ob send-reactivation-mail deployed ist'), 'error')
  }
}

function openDropoffDrawer(data, stageKey) {
  const stageIdx = STAGES.findIndex(s => s.key === stageKey)
  if (stageIdx <= 0) {
    toast('Signup ist die erste Stufe — kein Drop-off davor.', 'info')
    return
  }
  const fromStage = STAGES[stageIdx - 1]
  const toStage = STAGES[stageIdx]
  const users = dropOffUsers(data, stageKey)

  const body = document.createElement('div')
  body.innerHTML = `
    <div class="of-drop-toolbar">
      <div>
        <div style="font-size:12px; color:var(--text-secondary,#6b7280); text-transform:uppercase; letter-spacing:.5px;">Drop-off</div>
        <div style="font-weight:600; font-size:15px;">${htmlEscape(fromStage.label)} → ${htmlEscape(toStage.label)} · ${fmtNumber(users.length)} Nutzer</div>
      </div>
      <div style="display:flex; gap:8px;">
        <button class="btn-secondary" id="of-select-all">Alle</button>
        <button class="of-btn-primary" id="of-send-mail" disabled>${iconHtml('mail')}<span>Reactivation (<span id="of-sel-count">0</span>)</span></button>
      </div>
    </div>
    <div class="of-drop-list" id="of-drop-list"></div>
  `

  const list = body.querySelector('#of-drop-list')
  if (!users.length) {
    list.innerHTML = `
      <div class="of-empty">
        ${iconHtml('check-circle')}
        <div style="font-weight:600; margin-bottom:4px;">Kein Drop-off!</div>
        <div>Alle Nutzer dieser Vorstufe sind auf diese Stufe weitergekommen.</div>
      </div>
    `
  } else {
    list.innerHTML = users.map(u => {
      const name = u.username || u.full_name || u.email || (u.id ? String(u.id).slice(0, 8) : 'Unbekannt')
      const initial = (name[0] || '?').toUpperCase()
      const sub = u.email
        ? htmlEscape(u.email)
        : (u.last_seen_at ? `zuletzt ${fmtRelativeTime(u.last_seen_at)}` : `seit ${fmtDateTime(u.created_at)}`)
      const uid = htmlEscape(String(u.id || ''))
      return `
        <label class="of-drop-row" data-uid="${uid}">
          <input type="checkbox" class="of-cb" value="${uid}"/>
          <div class="of-avatar">${htmlEscape(initial)}</div>
          <div class="of-meta">
            <div class="of-name">${htmlEscape(name)}</div>
            <div class="of-sub">${sub}</div>
          </div>
          <button class="btn-ghost of-detail" data-uid="${uid}" title="Details">${iconHtml('external-link')}</button>
        </label>
      `
    }).join('')
  }

  const cbAll = () => body.querySelectorAll('.of-cb')
  const selCount = body.querySelector('#of-sel-count')
  const sendBtn = body.querySelector('#of-send-mail')
  const updateSel = () => {
    const sel = [...cbAll()].filter(x => x.checked).length
    if (selCount) selCount.textContent = sel
    if (sendBtn) sendBtn.disabled = sel === 0
  }

  body.addEventListener('change', e => {
    if (e.target.classList && e.target.classList.contains('of-cb')) updateSel()
  })
  body.querySelector('#of-select-all')?.addEventListener('click', () => {
    const all = [...cbAll()]
    const allChecked = all.length && all.every(x => x.checked)
    all.forEach(x => { x.checked = !allChecked })
    updateSel()
  })
  body.addEventListener('click', e => {
    const det = e.target.closest && e.target.closest('.of-detail')
    if (det) {
      e.preventDefault(); e.stopPropagation()
      try { showUserDetailModal(det.dataset.uid) }
      catch (err) { toast('User-Detail konnte nicht geöffnet werden', 'error') }
    }
  })
  // FIX (low): e.preventDefault + e.stopPropagation to avoid double-click from label wrapping
  sendBtn?.addEventListener('click', async (e) => {
    e.preventDefault()
    e.stopPropagation()
    const ids = [...cbAll()].filter(x => x.checked).map(x => x.value)
    await sendReactivationMails(ids)
  })

  drawer({
    title: `Drop-off: ${fromStage.label} → ${toStage.label}`,
    width: 560,
    content: body
  })
}

function renderError(host, err, retry) {
  host.innerHTML = `
    <div class="of-empty">
      ${iconHtml('alert-triangle')}
      <div style="font-weight:600; margin-bottom:4px;">Daten konnten nicht geladen werden</div>
      <div style="margin-bottom:14px; color:var(--text-secondary,#6b7280);">${htmlEscape(err?.message || 'Unbekannter Fehler')}</div>
      <button class="of-btn-primary" id="of-retry">${iconHtml('refresh-cw')}<span>Erneut versuchen</span></button>
    </div>
  `
  host.querySelector('#of-retry')?.addEventListener('click', retry)
}

function renderMountError(container, err, retry) {
  container.innerHTML = `
    <div class="panel-shell" style="padding:24px;">
      <div style="border:1px solid #fecaca; background:#fef2f2; color:#991b1b; border-radius:12px; padding:20px;">
        <div style="display:flex; align-items:center; gap:10px; font-weight:700; font-size:16px; margin-bottom:8px;">
          ${iconHtml('alert-triangle')}
          <span>Panel konnte nicht geladen werden</span>
        </div>
        <div style="font-family:ui-monospace,monospace; font-size:13px; margin-bottom:14px; white-space:pre-wrap;">${htmlEscape(err?.stack || err?.message || String(err))}</div>
        <button class="of-btn-primary" id="of-mount-retry">${iconHtml('refresh-cw')}<span>Erneut versuchen</span></button>
      </div>
    </div>
  `
  container.querySelector('#of-mount-retry')?.addEventListener('click', retry)
}

export default {
  id: 'onboarding-funnel',
  title: 'Onboarding-Funnel',
  category: 'users',

  async mount(container) {
    const doMount = async () => {
      try {
        injectStyles()

        container.innerHTML = `
          <div class="panel-shell of-wrap">
            <div class="panel-head" style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;">
              <div>
                <h2 style="margin:0;">Onboarding-Funnel</h2>
                <div id="of-subtitle" style="font-size:13px; color:var(--text-secondary,#6b7280); margin-top:2px;">Signup → Profil → First Listen → Active</div>
              </div>
              <div class="toolbar" style="display:flex; gap:8px; align-items:center;">
                <div id="of-range-seg"></div>
                <button class="btn-secondary" id="of-refresh" title="Aktualisieren">${iconHtml('refresh-cw')}<span>Aktualisieren</span></button>
                <button class="btn-secondary" id="of-pdf" title="PDF exportieren">${iconHtml('file-text')}<span>PDF</span></button>
                <button class="btn-secondary" id="of-csv" title="CSV exportieren">${iconHtml('download')}<span>CSV</span></button>
              </div>
            </div>

            <div id="of-heroes" class="of-hero-row"></div>

            <div class="glass-card" id="of-funnel-wrap" style="padding:8px;">
              <div style="padding:16px 22px 0;">
                <div class="of-section-title">Funnel</div>
                <div style="font-size:12px; color:var(--text-secondary,#6b7280); margin-top:-6px;">Klicke auf eine Stufe, um die Drop-off-Nutzer zu sehen.</div>
              </div>
              <div id="of-funnel"></div>
            </div>

            <div id="of-charts" class="of-charts"></div>
          </div>
        `

        const heroes = container.querySelector('#of-heroes')
        const funnelHost = container.querySelector('#of-funnel')
        const chartsHost = container.querySelector('#of-charts')

        // Skeleton — sofort sichtbar
        heroes.innerHTML = ''
        for (let i = 0; i < 4; i++) appendSkeleton(heroes, { height: 100, radius: 14 })

        funnelHost.innerHTML = '<div style="padding:24px; display:flex; flex-direction:column; gap:10px;">' +
          STAGES.map(() => '<div class="of-shimmer" style="height:60px; border-radius:12px;"></div>').join('') +
          '</div>'

        chartsHost.innerHTML = `
          <div class="glass-card of-shimmer" style="padding:18px; height:280px; border-radius:14px;"></div>
          <div class="glass-card of-shimmer" style="padding:18px; height:280px; border-radius:14px;"></div>
        `

        let data = null
        const state = { range: '90d', segRef: null }

        const RANGE_LABELS = { '7d': '7d', '30d': '30d', '90d': '90d', 'all': 'All Time' }

        // Smart-Default: bei <50 Total-Usern auf 90d bleiben (Default), aber wenn
        // im 30d-Fenster <10 Signups → default schon auf 90d (bereits set). Logik:
        // wir machen einen leichten Pre-Check; bei sehr wenig Users → All Time.
        const smartDefault = async () => {
          try {
            const { data: stats } = await sb.rpc('admin_db_live_stats')
            const total = stats?.users_total || stats?.total_users || 0
            if (total > 0 && total < 50) return 'all'
            return '90d'
          } catch (_) {
            return '90d'
          }
        }

        const load = async () => {
          try {
            data = await fetchFunnel(state.range)
            renderHeroes(heroes, data, RANGE_LABELS[state.range])
            const sub = container.querySelector('#of-subtitle')
            if (sub) {
              const rl = state.range === 'all' ? 'gesamt' : `letzte ${RANGE_LABELS[state.range]}`
              sub.textContent = `Signup → Profil → First Listen → Active · ${rl}`
            }
            funnelHost.innerHTML = renderFunnelHTML(data)
            renderCharts(chartsHost, data)

            funnelHost.querySelectorAll('.of-stage').forEach(el => {
              el.addEventListener('click', () => openDropoffDrawer(data, el.dataset.stage))
            })

            funnelHost.querySelectorAll('.of-count').forEach(el => {
              const v = parseInt(el.dataset.count, 10) || 0
              try { countUp(el, { from: 0, to: v, duration: 800, format: fmtNumber }) }
              catch (_) { el.textContent = fmtNumber(v) }
            })

            try { fadeIn(container) } catch (_) {}
          } catch (err) {
            console.error('[onboarding-funnel] load failed:', err)
            renderError(funnelHost, err, load)
            heroes.innerHTML = `<div class="of-empty" style="grid-column:1/-1;">${iconHtml('alert-triangle')}<div>Fehler: ${htmlEscape(err?.message || 'Unbekannter Fehler')}</div></div>`
            // FIX (low): show error UI in charts area too instead of leaving it empty
            chartsHost.innerHTML = `<div class="glass-card" style="padding:32px; text-align:center; color:var(--text-secondary,#6b7280); grid-column:1/-1;">${iconHtml('alert-triangle')}<div style="margin-top:8px;">Charts konnten nicht geladen werden</div></div>`
          }
        }

        // Apply smart-default before first load (kann durch User-Klick überschrieben werden)
        state.range = await smartDefault()

        // Range-Toggle: 30d | 90d | All Time
        const segHost = container.querySelector('#of-range-seg')
        if (segHost) {
          state.segRef = segmentedControl(segHost, [
            { key: '30d', label: '30T' },
            { key: '90d', label: '90T' },
            { key: 'all', label: 'All Time' },
          ], state.range, async (key) => {
            state.range = key
            await load()
          })
        }

        container.querySelector('#of-refresh')?.addEventListener('click', async () => {
          toast('Aktualisiere…', 'info')
          await load()
        })

        container.querySelector('#of-pdf')?.addEventListener('click', () => {
          try {
            exportPanelAsPdf(container, { title: 'Onboarding-Funnel', filename: 'onboarding-funnel.pdf' })
          } catch (e) {
            toast('PDF-Export fehlgeschlagen: ' + (e.message || ''), 'error')
          }
        })

        container.querySelector('#of-csv')?.addEventListener('click', () => {
          if (!data) { toast('Keine Daten zum Export', 'info'); return }
          try {
            const rows = STAGES.map((s, i) => {
              const c = data.counts[s.key] || 0
              const prev = i === 0 ? c : (data.counts[STAGES[i - 1].key] || 0)
              // FIX (math-impossible-values): clamp auf max 100%
              const conv = prev ? Math.min(100, Math.round((c / prev) * 100)) : 0
              const overall = data.counts.signup ? Math.min(100, Math.round((c / data.counts.signup) * 100)) : 0
              return {
                Stufe: s.label,
                Beschreibung: s.desc,
                Nutzer: c,
                'Conversion ab Vorstufe (%)': conv,
                'Gesamt-Conversion ab Signup (%)': overall
              }
            })
            exportCsv(rows, 'onboarding-funnel.csv')
          } catch (e) {
            toast('CSV-Export fehlgeschlagen: ' + (e.message || ''), 'error')
          }
        })

        await load()
      } catch (err) {
        console.error('[onboarding-funnel] mount failed:', err)
        renderMountError(container, err, doMount)
      }
    }

    await doMount()
  }
}
