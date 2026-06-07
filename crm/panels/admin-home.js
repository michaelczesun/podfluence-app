import { sb } from '/lib/supabase.js?v=20260608e'
import { toast, fmtNumber, fmtDateTime, fmtRelativeTime, htmlEscape, iconHtml, debounce, confirmDialog } from '/lib/ui.js?v=20260608e'
import { makeSparkline, makeAreaChart } from '/lib/charts.js?v=20260608e'
import { countUp, fadeIn, pulse } from '/lib/animations.js?v=20260608e'
import { glassCard } from '/lib/layout-extras.js?v=20260608e'

// Schema-Truth: siehe CLAUDE-Memory. Diese Datei nutzt NUR existierende Tabellen/Felder:
//  - users(id,email,is_premium,is_verified,is_admin,created_at,display_name,avatar_url,is_banned)
//  - updates(id,user_id,created_at) — author_id meist NULL, user_id ist echter Author
//  - podcasts(id,title,cover_image,author_id,is_owner_verified,is_featured,created_at)
//  - listening_activity(listener_id,podcaster_id,listened_ms,created_at)
//  - bug_reports(id,status,created_at,title,description,user_id)
//  - admin_audit_log via RPC admin_audit_recent
//  - app_opens(device_fp,created_at) — KEIN user_id

const REFRESH_MS = 45_000
const REALTIME_DEBOUNCE_MS = 800

const KPI_DEFS = [
  { key: 'total_users',      label: 'User gesamt',     icon: 'users',      color: '#7C5CFF', fmt: 'int',   sparkMetric: 'signups' },
  { key: 'active_24h',       label: 'Aktiv (24h)',     icon: 'activity',   color: '#22D3EE', fmt: 'int',   sparkMetric: 'app_opens' },
  { key: 'posts_24h',        label: 'Beiträge (24h)',  icon: 'message',    color: '#F59E0B', fmt: 'int',   sparkMetric: 'posts' },
  { key: 'listening_hours',  label: 'Hörstunden (24h)',icon: 'headphones', color: '#10B981', fmt: 'hours', sparkMetric: 'listening_hours' }
]

const SPARK_DAYS = 7
const GROWTH_DAYS = 14

// ---------- DATA ----------

function pctChange(curr, prev) {
  if (!prev || prev === 0) return curr > 0 ? 100 : 0
  return ((curr - prev) / prev) * 100
}

function formatValue(val, fmt) {
  if (fmt === 'hours') return fmtNumber(val) + ' h'
  return fmtNumber(val)
}

async function fetchHeroStats() {
  // RPC zuerst — definitiv vorhanden laut Schema
  try {
    const { data, error } = await sb.rpc('admin_db_live_stats')
    if (!error && data) {
      const r = Array.isArray(data) ? data[0] : data
      if (r && (r.total_users != null || r.active_24h != null)) {
        const norm = {}
        for (const def of KPI_DEFS) {
          const v = r[def.key]
          if (v && typeof v === 'object' && 'value' in v) {
            norm[def.key] = { value: Number(v.value) || 0, prev: Number(v.prev) || 0 }
          } else {
            norm[def.key] = {
              value: Number(r[def.key]) || 0,
              prev: Number(r[`${def.key}_prev`] ?? r[`${def.key}_yday`]) || 0
            }
          }
        }
        return norm
      }
    }
  } catch (_) {}

  // Fallback: direkt zusammenzählen
  const since24h = new Date(Date.now() - 86_400_000).toISOString()
  const since48h = new Date(Date.now() - 2 * 86_400_000).toISOString()
  const safe = (p) => p.then(r => r).catch(() => ({ count: 0, data: null }))
  const [usersC, postsT, postsY, openT, openY, listenT, listenY] = await Promise.all([
    safe(sb.from('users').select('id', { count: 'exact', head: true })),
    safe(sb.from('updates').select('id', { count: 'exact', head: true }).gte('created_at', since24h)),
    safe(sb.from('updates').select('id', { count: 'exact', head: true }).gte('created_at', since48h).lt('created_at', since24h)),
    safe(sb.from('app_opens').select('id', { count: 'exact', head: true }).gte('created_at', since24h)),
    safe(sb.from('app_opens').select('id', { count: 'exact', head: true }).gte('created_at', since48h).lt('created_at', since24h)),
    safe(sb.from('listening_activity').select('listened_ms,created_at').gte('created_at', since24h).limit(5000)),
    safe(sb.from('listening_activity').select('listened_ms,created_at').gte('created_at', since48h).lt('created_at', since24h).limit(5000))
  ])
  const sumMs = (rows) => (rows || []).reduce((a, r) => a + Number(r.listened_ms || 0), 0)
  return {
    total_users:     { value: usersC.count ?? 0, prev: usersC.count ?? 0 },
    active_24h:      { value: openT.count ?? 0,  prev: openY.count ?? 0 },
    posts_24h:       { value: postsT.count ?? 0, prev: postsY.count ?? 0 },
    listening_hours: {
      value: Math.round(sumMs(listenT?.data) / 3600000),
      prev:  Math.round(sumMs(listenY?.data) / 3600000)
    }
  }
}

async function fetchSpark(def) {
  const since = new Date(Date.now() - SPARK_DAYS * 86_400_000).toISOString()
  try {
    if (def.sparkMetric === 'app_opens') {
      const { data } = await sb.from('app_opens').select('created_at').gte('created_at', since).limit(5000)
      return bucketByDay(data || [], 'created_at', SPARK_DAYS).map(r => r.value)
    }
    if (def.sparkMetric === 'listening_hours') {
      const { data } = await sb.from('listening_activity').select('created_at,listened_ms').gte('created_at', since).limit(5000)
      return bucketByDay(data || [], 'created_at', SPARK_DAYS, r => Number(r.listened_ms || 0) / 3600000).map(r => r.value)
    }
    const { data } = await sb.rpc('admin_daily_series', { p_metric: def.sparkMetric, p_days: SPARK_DAYS })
    return (data || []).map(d => Number(d.value) || 0)
  } catch (_) { return [] }
}

function bucketByDay(rows, dateField, days, valueFn) {
  const buckets = new Map()
  const today = new Date(); today.setHours(0,0,0,0)
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86_400_000)
    buckets.set(d.toISOString().slice(0,10), 0)
  }
  for (const r of rows) {
    const k = (r[dateField] || '').slice(0,10)
    if (!buckets.has(k)) continue
    buckets.set(k, buckets.get(k) + (valueFn ? valueFn(r) : 1))
  }
  return [...buckets.entries()].map(([date, value]) => ({ date, value: valueFn ? value : Math.round(value) }))
}

// ---------- SMART ALERTS ----------

async function fetchAlerts() {
  const since1h  = new Date(Date.now() - 3600_000).toISOString()
  const since24h = new Date(Date.now() - 86_400_000).toISOString()
  const since3d  = new Date(Date.now() - 3 * 86_400_000).toISOString()

  const safe = (p) => p.then(r => r).catch(() => ({ data: null, count: 0, error: true }))

  const [bugsRes, postsBurstRes, podcastsRes, signupsRes] = await Promise.all([
    // 1) Offene Bug-Reports (24h)
    safe(sb.from('bug_reports')
      .select('id,title,created_at,status', { count: 'exact' })
      .eq('status', 'open')
      .gte('created_at', since24h)
      .order('created_at', { ascending: false })
      .limit(8)),

    // 2) Posts der letzten 24h — clientseitig nach user_id gruppieren für Spam-Verdacht
    safe(sb.from('updates')
      .select('id,user_id,created_at')
      .gte('created_at', since24h)
      .not('user_id', 'is', null)
      .limit(2000)),

    // 3) Podcasts is_owner_verified=false älter als 3 Tage
    safe(sb.from('podcasts')
      .select('id,title,cover_image,author_id,created_at,is_owner_verified', { count: 'exact' })
      .eq('is_owner_verified', false)
      .lt('created_at', since3d)
      .order('created_at', { ascending: false })
      .limit(8)),

    // 4) Neue Anmeldungen letzte Stunde
    safe(sb.from('users')
      .select('id,display_name,email,avatar_url,created_at', { count: 'exact' })
      .gte('created_at', since1h)
      .order('created_at', { ascending: false })
      .limit(10))
  ])

  // Spam-Verdacht: User mit 10+ Posts in 24h
  const postCounts = new Map()
  for (const row of (postsBurstRes.data || [])) {
    const uid = row.user_id
    if (!uid) continue
    postCounts.set(uid, (postCounts.get(uid) || 0) + 1)
  }
  const spamSuspects = [...postCounts.entries()]
    .filter(([_, c]) => c >= 10)
    .sort((a,b) => b[1] - a[1])
    .slice(0, 10)

  // Namen für Spam-Suspects nachladen
  let spamDetails = []
  if (spamSuspects.length) {
    try {
      const ids = spamSuspects.map(([uid]) => uid)
      const { data } = await sb.from('users').select('id,display_name,email,avatar_url').in('id', ids)
      const byId = new Map((data || []).map(u => [u.id, u]))
      spamDetails = spamSuspects.map(([uid, count]) => ({
        id: uid,
        count,
        display_name: byId.get(uid)?.display_name || '(unbekannt)',
        email: byId.get(uid)?.email || '',
        avatar_url: byId.get(uid)?.avatar_url || null
      }))
    } catch (_) {
      spamDetails = spamSuspects.map(([uid, count]) => ({ id: uid, count, display_name: '(unbekannt)', email: '' }))
    }
  }

  return {
    bugs:          { items: bugsRes.data || [],     count: bugsRes.count ?? (bugsRes.data?.length || 0) },
    spam:          { items: spamDetails,            count: spamDetails.length },
    unverified:    { items: podcastsRes.data || [], count: podcastsRes.count ?? (podcastsRes.data?.length || 0) },
    signups:       { items: signupsRes.data || [],  count: signupsRes.count ?? (signupsRes.data?.length || 0) }
  }
}

// ---------- AUDIT ----------

async function fetchRecentAdminActions(limit = 5) {
  try {
    const { data, error } = await sb.rpc('admin_audit_recent', { p_limit: limit, p_offset: 0 })
    if (error) return []
    return data || []
  } catch (_) { return [] }
}

// ---------- GROWTH ----------

async function fetchGrowthSeries() {
  try {
    const [signups, posts, listens] = await Promise.all([
      sb.rpc('admin_daily_series', { p_metric: 'signups', p_days: GROWTH_DAYS }),
      sb.rpc('admin_daily_series', { p_metric: 'posts',   p_days: GROWTH_DAYS }),
      sb.rpc('admin_daily_series', { p_metric: 'listens', p_days: GROWTH_DAYS })
    ])
    const labels = (signups.data || []).map(d => d.date.slice(5))
    return {
      labels,
      signups: (signups.data || []).map(d => Number(d.value) || 0),
      posts:   (posts.data   || []).map(d => Number(d.value) || 0),
      listens: (listens.data || []).map(d => Number(d.value) || 0)
    }
  } catch (_) {
    return { labels: [], signups: [], posts: [], listens: [] }
  }
}

// ---------- ACTIONS ----------

async function actionBulkVerify(container) {
  try {
    const since3d = new Date(Date.now() - 3 * 86_400_000).toISOString()
    const { data, error } = await sb.from('podcasts')
      .select('id', { count: 'exact', head: true })
      .eq('is_owner_verified', false)
      .lt('created_at', since3d)
    if (error) throw error
    const n = data?.length ?? 0
    // count via head
    const { count } = await sb.from('podcasts')
      .select('id', { count: 'exact', head: true })
      .eq('is_owner_verified', false)
      .lt('created_at', since3d)
    const target = count ?? n
    const ok = await confirmDialog({
      title: 'Bulk-Verify wartende Podcasts',
      message: `${target} Podcasts (3+ Tage unverifiziert) werden auf is_owner_verified=true gesetzt.\n\nFortfahren?`,
      confirmText: 'Verifizieren',
      danger: false
    })
    if (!ok) return
    const { error: bvErr } = await sb.rpc('admin_bulk_verify')
    if (bvErr) throw bvErr
    try { await sb.rpc('admin_log_action', { p_action: 'bulk_verify', p_target_type: 'podcast', p_target_id: null, p_meta: { count: target } }) } catch (_) {}
    toast(`${target} Podcasts verifiziert`, 'success')
    return true
  } catch (e) {
    toast('Bulk-Verify fehlgeschlagen: ' + (e?.message || ''), 'error')
    return false
  }
}

function actionOpenPanel(id) {
  location.hash = '#' + id
}

// ---------- RENDER ----------

function renderHeroGrid(totals) {
  return `<div class="hero-grid" id="hero-grid">
    ${KPI_DEFS.map(def => {
      const t = totals[def.key] || { value: 0, prev: 0 }
      const change = pctChange(t.value, t.prev)
      const up = change >= 0
      return `
      <div class="stat-hero glass-card kpi-card" data-kpi="${def.key}" role="button" tabindex="0" style="--accent:${def.color}">
        <div class="kpi-card-head">
          <span class="kpi-icon" style="background:${def.color}22;color:${def.color}">${iconHtml(def.icon)}</span>
          <span class="kpi-label">${htmlEscape(def.label)}</span>
        </div>
        <div class="kpi-value" id="ah-val-${def.key}" data-fmt="${def.fmt}">${formatValue(t.value, def.fmt)}</div>
        <div class="kpi-spark" id="ah-spark-${def.key}"></div>
        <div class="kpi-change ${up ? 'up' : 'down'}">
          ${iconHtml(up ? 'trending-up' : 'trending-down')}
          <span>${up ? '+' : ''}${change.toFixed(1)}%</span>
          <span class="kpi-change-sub">vs gestern</span>
        </div>
      </div>`
    }).join('')}
  </div>`
}

function renderAlertsFeed(alerts) {
  const items = []

  if (alerts.bugs.count > 0) {
    items.push({
      severity: 'critical',
      icon: 'alert-triangle',
      color: '#EF4444',
      title: `${alerts.bugs.count} offene Bug-Reports (24h)`,
      sub: alerts.bugs.items.slice(0,3).map(b => htmlEscape(b.title || '(ohne Titel)')).join(' · ') || 'Keine Details',
      action: 'open-bugs',
      actionLabel: 'Triage öffnen'
    })
  }
  if (alerts.spam.count > 0) {
    items.push({
      severity: 'warn',
      icon: 'alert',
      color: '#F59E0B',
      title: `${alerts.spam.count} User mit 10+ Posts in 24h (Spam-Verdacht)`,
      sub: alerts.spam.items.slice(0,3).map(s => `${htmlEscape(s.display_name)} (${s.count})`).join(' · '),
      action: 'open-users',
      actionLabel: 'User prüfen'
    })
  }
  if (alerts.unverified.count > 0) {
    items.push({
      severity: 'info',
      icon: 'check-circle',
      color: '#22D3EE',
      title: `${alerts.unverified.count} Podcasts unverifiziert (3+ Tage)`,
      sub: alerts.unverified.items.slice(0,3).map(p => htmlEscape(p.title || '(unbenannt)')).join(' · '),
      action: 'open-verify',
      actionLabel: 'Queue öffnen'
    })
  }
  if (alerts.signups.count > 0) {
    items.push({
      severity: 'good',
      icon: 'user-plus',
      color: '#10B981',
      title: `${alerts.signups.count} neue Anmeldungen letzte Stunde`,
      sub: alerts.signups.items.slice(0,3).map(u => htmlEscape(u.display_name || u.email || '?')).join(' · '),
      action: 'open-signups',
      actionLabel: 'Neue User'
    })
  }

  if (!items.length) {
    return `<div class="empty-state">
      <div class="icon">${iconHtml('check-circle')}</div>
      <h3>Alles ruhig</h3>
      <p>Keine offenen Alerts. Gute Zeit, Kaffee zu holen.</p>
    </div>`
  }

  return `<div class="alerts-list">
    ${items.map(it => `
      <div class="alert-card alert-${it.severity}" style="--alert:${it.color}">
        <div class="alert-icon" style="background:${it.color}22;color:${it.color}">${iconHtml(it.icon)}</div>
        <div class="alert-body">
          <div class="alert-title">${htmlEscape(it.title)}</div>
          <div class="alert-sub">${it.sub}</div>
        </div>
        <button class="alert-btn" data-action="${it.action}">${it.actionLabel} ${iconHtml('chevron-right')}</button>
      </div>`).join('')}
  </div>`
}

function renderQuickActions() {
  return `<div class="quick-actions">
    <button class="qa-btn" data-qa="bulk-verify">
      ${iconHtml('check-circle')}
      <div><div class="qa-title">Bulk-Verify wartende</div><div class="qa-sub">Alle Podcasts &gt;3d</div></div>
    </button>
    <button class="qa-btn" data-qa="push-premium">
      ${iconHtml('send')}
      <div><div class="qa-title">Push an Premium</div><div class="qa-sub">Broadcast öffnen</div></div>
    </button>
    <button class="qa-btn" data-qa="audit">
      ${iconHtml('file-text')}
      <div><div class="qa-title">Audit-Log</div><div class="qa-sub">Letzte Admin-Aktionen</div></div>
    </button>
  </div>`
}

function renderAuditList(rows) {
  if (!rows.length) {
    return `<div class="audit-empty" style="text-align:center;padding:24px 16px;color:var(--text-muted)">
      <div style="font-size:28px;opacity:.45;margin-bottom:6px">${iconHtml('file-text')}</div>
      <div style="font-weight:600;color:var(--text);margin-bottom:4px">Noch keine Admin-Aktionen</div>
      <div style="font-size:12px;line-height:1.4">Sobald du User verifizierst, bannst oder Premium vergibst, taucht's hier auf — inklusive Wer/Wann/Was.</div>
    </div>`
  }
  return `<ul class="audit-list">
    ${rows.map(r => {
      const when = r.created_at ? fmtRelativeTime(r.created_at) : ''
      const admin = htmlEscape(r.admin_email || r.admin_id || 'Admin')
      const action = htmlEscape(r.action || 'aktion')
      const target = r.target_type ? `${htmlEscape(r.target_type)}${r.target_id ? ':' + htmlEscape(String(r.target_id).slice(0,8)) : ''}` : ''
      return `<li class="audit-item">
        <div class="audit-dot"></div>
        <div class="audit-body">
          <div class="audit-action"><strong>${admin}</strong> · ${action}${target ? ` <span class="audit-target">→ ${target}</span>` : ''}</div>
          <div class="audit-time">${htmlEscape(when)}</div>
        </div>
      </li>`
    }).join('')}
  </ul>`
}

function renderGrowthCard(series) {
  return `<div class="growth-card glass-card">
    <div class="growth-head">
      <h3>Wachstum (${GROWTH_DAYS} Tage)</h3>
      <div class="growth-legend">
        <span><i style="background:#7C5CFF"></i>Signups</span>
        <span><i style="background:#F59E0B"></i>Posts</span>
        <span><i style="background:#10B981"></i>Listens</span>
      </div>
    </div>
    <div class="growth-rows">
      <div class="growth-row"><div class="growth-label">Signups</div><div class="growth-spark" id="growth-signups"></div><div class="growth-sum">${fmtNumber((series.signups||[]).reduce((a,b)=>a+b,0))}</div></div>
      <div class="growth-row"><div class="growth-label">Posts</div><div class="growth-spark" id="growth-posts"></div><div class="growth-sum">${fmtNumber((series.posts||[]).reduce((a,b)=>a+b,0))}</div></div>
      <div class="growth-row"><div class="growth-label">Listens</div><div class="growth-spark" id="growth-listens"></div><div class="growth-sum">${fmtNumber((series.listens||[]).reduce((a,b)=>a+b,0))}</div></div>
    </div>
  </div>`
}

function styles() {
  return `<style>
    .ah-shell { display:flex; flex-direction:column; gap:22px; padding:20px; }
    .ah-head { display:flex; justify-content:space-between; align-items:center; gap:16px; flex-wrap:wrap; }
    .ah-head h2 { font-size:24px; font-weight:700; margin:0; letter-spacing:-0.02em; }
    .ah-head .sub { font-size:13px; color:var(--text-muted,#8b8b9a); margin-top:4px; }

    .toolbar { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
    .toolbar button { display:inline-flex; align-items:center; gap:6px; padding:8px 14px;
      border-radius:10px; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08);
      color:inherit; font-size:13px; font-weight:500; cursor:pointer; transition:all .15s; }
    .toolbar button:hover { background:rgba(255,255,255,0.08); transform:translateY(-1px); }
    .live-dot { display:inline-flex; align-items:center; gap:6px; padding:6px 10px;
      border-radius:999px; background:rgba(34,197,94,0.1); color:#22c55e; font-size:12px; font-weight:600; }
    .live-dot::before { content:''; width:7px; height:7px; border-radius:50%;
      background:#22c55e; box-shadow:0 0 8px #22c55e; animation:livepulse 1.4s ease-in-out infinite; }
    @keyframes livepulse { 0%,100%{opacity:1} 50%{opacity:0.3} }

    /* Hero KPIs */
    .hero-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(230px, 1fr)); gap:16px; }
    .kpi-card { padding:20px; border-radius:16px; cursor:pointer; position:relative; overflow:hidden;
      transition:transform .2s ease, box-shadow .2s ease;
      background:linear-gradient(140deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01));
      border:1px solid rgba(255,255,255,0.06); }
    .kpi-card::before { content:''; position:absolute; top:0; left:0; right:0; height:3px; background:var(--accent); opacity:0.85; }
    .kpi-card:hover { transform:translateY(-2px); box-shadow:0 10px 32px rgba(0,0,0,0.3), 0 0 0 1px var(--accent); }
    .kpi-card.pulsing { animation:kpipulse 1.2s ease-out; }
    @keyframes kpipulse { 0%{box-shadow:0 0 0 0 var(--accent)} 50%{box-shadow:0 0 0 12px transparent} 100%{box-shadow:0 0 0 0 transparent} }
    .kpi-card-head { display:flex; align-items:center; gap:10px; margin-bottom:12px; }
    .kpi-icon { display:inline-flex; width:32px; height:32px; border-radius:9px; align-items:center; justify-content:center; }
    .kpi-label { font-size:12px; font-weight:500; color:var(--text-muted,#9ca3af); }
    .kpi-value { font-size:34px; font-weight:700; letter-spacing:-0.03em; line-height:1.1; font-variant-numeric:tabular-nums; margin-bottom:8px; }
    .kpi-spark { height:26px; min-height:26px; margin-bottom:8px; }
    .kpi-spark:empty { display:none; }
    .kpi-change { display:inline-flex; align-items:center; gap:6px; font-size:12px; font-weight:600; }
    .kpi-change.up { color:#22c55e; }
    .kpi-change.down { color:#ef4444; }
    .kpi-change-sub { color:var(--text-muted,#9ca3af); font-weight:400; margin-left:4px; }

    /* Two-column layout below */
    .ah-grid { display:grid; grid-template-columns:1.4fr 1fr; gap:20px; }
    @media (max-width:980px) { .ah-grid { grid-template-columns:1fr; } }

    .section { background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.06); border-radius:18px; padding:18px; }
    .section h3 { font-size:16px; margin:0 0 14px; font-weight:600; }
    .section .head { display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; }
    .section .head h3 { margin:0; }
    .section .head .badge { font-size:11px; padding:3px 8px; border-radius:999px; background:rgba(255,255,255,0.06); color:var(--text-muted,#9ca3af); }

    /* Alerts */
    .alerts-list { display:flex; flex-direction:column; gap:10px; }
    .alert-card { display:flex; align-items:center; gap:14px; padding:14px 16px; border-radius:14px;
      background:linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01));
      border:1px solid rgba(255,255,255,0.06);
      border-left:3px solid var(--alert);
      transition:transform .15s; }
    .alert-card:hover { transform:translateX(2px); }
    .alert-icon { width:38px; height:38px; border-radius:11px; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
    .alert-body { flex:1; min-width:0; }
    .alert-title { font-weight:600; font-size:14px; margin-bottom:3px; }
    .alert-sub { font-size:12px; color:var(--text-muted,#9ca3af); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .alert-btn { display:inline-flex; align-items:center; gap:4px; padding:7px 12px; border-radius:9px;
      background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.08); color:inherit;
      font-size:12px; font-weight:600; cursor:pointer; transition:all .15s; flex-shrink:0; }
    .alert-btn:hover { background:rgba(255,255,255,0.12); }

    /* Quick actions */
    .quick-actions { display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:10px; }
    .qa-btn { display:flex; align-items:center; gap:12px; padding:14px 16px; border-radius:12px;
      background:linear-gradient(135deg, rgba(124,92,255,0.08), rgba(34,211,238,0.04));
      border:1px solid rgba(255,255,255,0.08); color:inherit; cursor:pointer; text-align:left;
      transition:all .15s; }
    .qa-btn:hover { transform:translateY(-2px); border-color:rgba(124,92,255,0.4); }
    .qa-btn svg { width:22px; height:22px; flex-shrink:0; color:#7C5CFF; }
    .qa-title { font-weight:600; font-size:13px; }
    .qa-sub { font-size:11px; color:var(--text-muted,#9ca3af); margin-top:2px; }

    /* Audit */
    .audit-list { list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:10px; }
    .audit-item { display:flex; align-items:flex-start; gap:10px; padding:10px 0; border-bottom:1px solid rgba(255,255,255,0.04); }
    .audit-item:last-child { border-bottom:none; }
    .audit-dot { width:8px; height:8px; border-radius:50%; background:#7C5CFF; margin-top:6px; flex-shrink:0; box-shadow:0 0 8px #7C5CFF; }
    .audit-action { font-size:13px; }
    .audit-target { color:var(--text-muted,#9ca3af); font-family:ui-monospace,monospace; font-size:11px; }
    .audit-time { font-size:11px; color:var(--text-muted,#9ca3af); margin-top:2px; }
    .audit-empty { font-size:13px; color:var(--text-muted,#9ca3af); text-align:center; padding:20px; }
    .audit-new { animation:auditflash 1.2s ease-out; }
    @keyframes auditflash { 0%{background:rgba(124,92,255,0.18)} 100%{background:transparent} }

    /* Growth */
    .growth-card { padding:18px; border-radius:18px;
      background:linear-gradient(140deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01));
      border:1px solid rgba(255,255,255,0.06); }
    .growth-head { display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; }
    .growth-head h3 { margin:0; font-size:15px; }
    .growth-legend { display:flex; gap:12px; font-size:11px; color:var(--text-muted,#9ca3af); }
    .growth-legend i { display:inline-block; width:8px; height:8px; border-radius:2px; margin-right:4px; vertical-align:middle; }
    .growth-rows { display:flex; flex-direction:column; gap:10px; }
    .growth-row { display:grid; grid-template-columns:80px 1fr 60px; align-items:center; gap:12px; }
    .growth-label { font-size:12px; color:var(--text-muted,#9ca3af); }
    .growth-spark { height:28px; }
    .growth-sum { font-size:13px; font-weight:600; text-align:right; font-variant-numeric:tabular-nums; }

    .skel-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(230px, 1fr)); gap:16px; }
    .skel-card { height:160px; border-radius:16px;
      background:linear-gradient(90deg, rgba(255,255,255,0.04), rgba(255,255,255,0.08), rgba(255,255,255,0.04));
      background-size:200% 100%; animation:shimmer 1.6s linear infinite; }
    @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }

    .empty-state { text-align:center; padding:40px 20px;
      background:rgba(255,255,255,0.02); border-radius:14px; border:1px dashed rgba(255,255,255,0.08); }
    .empty-state .icon { font-size:32px; opacity:0.5; margin-bottom:10px; }
    .empty-state h3 { font-size:15px; margin:0 0 6px; }
    .empty-state p { color:var(--text-muted,#9ca3af); margin:0; font-size:13px; }
  </style>`
}

export default {
  id: 'admin-home',
  title: 'Admin-Home',
  category: 'overview',

  async mount(container) {
    container.innerHTML = `${styles()}
      <div class="ah-shell">
        <div class="ah-head">
          <div>
            <h2>Admin-Home</h2>
            <div class="sub" id="ah-last-updated">Lädt …</div>
          </div>
          <div class="toolbar">
            <span class="live-dot" id="ah-live">Live</span>
            <button id="ah-refresh">${iconHtml('refresh')} Aktualisieren</button>
          </div>
        </div>

        <div id="ah-hero">
          <div class="skel-grid">
            ${[1,2,3,4].map(()=>`<div class="skel-card"></div>`).join('')}
          </div>
        </div>

        <div class="ah-grid">
          <div class="section" id="ah-alerts-section">
            <div class="head"><h3>Smart-Alerts</h3><span class="badge" id="ah-alerts-count">…</span></div>
            <div id="ah-alerts"><div class="skel-card" style="height:120px"></div></div>
          </div>
          <div class="section">
            <h3>Quick-Actions</h3>
            <div id="ah-quick">${renderQuickActions()}</div>
          </div>
        </div>

        <div class="ah-grid">
          <div class="section">
            <div class="head"><h3>Letzte Admin-Aktionen</h3><span class="badge">Live</span></div>
            <div id="ah-audit"><div class="skel-card" style="height:120px"></div></div>
          </div>
          <div id="ah-growth"><div class="skel-card" style="height:200px; border-radius:18px"></div></div>
        </div>
      </div>`

    try { fadeIn(container) } catch (_) {}

    let currentTotals = null
    let refreshTimer = null
    let realtimeChan = null
    const lastUpd = container.querySelector('#ah-last-updated')

    // ---- Hero ----
    const renderHero = async () => {
      try {
        const totals = await fetchHeroStats()
        const prev = currentTotals
        currentTotals = totals
        const heroEl = container.querySelector('#ah-hero')
        if (!heroEl.querySelector('#hero-grid')) {
          heroEl.innerHTML = renderHeroGrid(totals)
          KPI_DEFS.forEach(def => {
            const el = container.querySelector(`#ah-val-${def.key}`)
            if (el) {
              try { countUp(el, { from: 0, to: totals[def.key].value, duration: 1100, format: n => formatValue(Math.round(n), def.fmt) }) }
              catch (_) { el.textContent = formatValue(totals[def.key].value, def.fmt) }
            }
          })
          // Sparklines
          KPI_DEFS.forEach(async def => {
            const el = container.querySelector(`#ah-spark-${def.key}`)
            if (!el) return
            try {
              const vals = await fetchSpark(def)
              if (vals.length) makeSparkline(el, vals, { color: def.color, height: 26 })
            } catch (_) {}
          })
          // Click handlers
          container.querySelectorAll('.kpi-card').forEach(card => {
            card.addEventListener('click', () => {
              const k = card.dataset.kpi
              if (k === 'total_users') location.hash = '#users-list'
              else if (k === 'posts_24h') location.hash = '#posts-per-day'
              else if (k === 'listening_hours') location.hash = '#listens-per-day'
              else if (k === 'active_24h') location.hash = '#dau-trend'
            })
          })
        } else {
          for (const def of KPI_DEFS) {
            const el = container.querySelector(`#ah-val-${def.key}`)
            const t = totals[def.key]
            const p = prev?.[def.key] || { value: 0 }
            if (el && p.value !== t.value) {
              try { countUp(el, { from: p.value, to: t.value, duration: 800, format: n => formatValue(Math.round(n), def.fmt) }) }
              catch (_) { el.textContent = formatValue(t.value, def.fmt) }
              const card = container.querySelector(`.kpi-card[data-kpi="${def.key}"]`)
              if (card) { card.classList.add('pulsing'); setTimeout(()=>card.classList.remove('pulsing'), 1300); try { pulse(card) } catch(_){} }
            }
            const card = container.querySelector(`.kpi-card[data-kpi="${def.key}"]`)
            if (card) {
              const change = pctChange(t.value, t.prev)
              const up = change >= 0
              const ch = card.querySelector('.kpi-change')
              if (ch) {
                ch.className = `kpi-change ${up ? 'up' : 'down'}`
                ch.innerHTML = `${iconHtml(up ? 'trending-up' : 'trending-down')}<span>${up?'+':''}${change.toFixed(1)}%</span><span class="kpi-change-sub">vs gestern</span>`
              }
            }
          }
        }
      } catch (e) {
        console.error('[admin-home] hero', e)
      }
    }

    // ---- Alerts ----
    const renderAlerts = async () => {
      try {
        const alerts = await fetchAlerts()
        const el = container.querySelector('#ah-alerts')
        const cnt = container.querySelector('#ah-alerts-count')
        const total = alerts.bugs.count + alerts.spam.count + alerts.unverified.count + alerts.signups.count
        if (cnt) cnt.textContent = total === 0 ? 'Alles gut' : `${total} Signale`
        if (el) el.innerHTML = renderAlertsFeed(alerts)
        // Wire alert buttons
        el?.querySelectorAll('.alert-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            const act = btn.dataset.action
            if (act === 'open-bugs') location.hash = '#bug-reports-triage'
            else if (act === 'open-verify') location.hash = '#podcast-verification-queue'
            else if (act === 'open-users') location.hash = '#users-list'
            else if (act === 'open-signups') location.hash = '#new-signups-7d'
          })
        })
      } catch (e) {
        const el = container.querySelector('#ah-alerts')
        if (el) el.innerHTML = `<div class="empty-state"><div class="icon">${iconHtml('alert-triangle')}</div><h3>Alerts nicht ladbar</h3><p>${htmlEscape(e?.message||'')}</p></div>`
      }
    }

    // ---- Audit ----
    let lastAuditIds = new Set()
    const renderAudit = async (markNew = false) => {
      try {
        const rows = await fetchRecentAdminActions(5)
        const el = container.querySelector('#ah-audit')
        if (!el) return
        el.innerHTML = renderAuditList(rows)
        if (markNew) {
          el.querySelectorAll('.audit-item').forEach((li, idx) => {
            const id = rows[idx]?.id
            if (id && !lastAuditIds.has(id)) li.classList.add('audit-new')
          })
        }
        lastAuditIds = new Set(rows.map(r => r.id).filter(Boolean))
      } catch (e) {
        const el = container.querySelector('#ah-audit')
        if (el) el.innerHTML = `<div class="audit-empty">Audit-Log nicht ladbar.</div>`
      }
    }

    // ---- Growth ----
    const renderGrowth = async () => {
      try {
        const series = await fetchGrowthSeries()
        const el = container.querySelector('#ah-growth')
        if (!el) return
        el.innerHTML = renderGrowthCard(series)
        try { makeSparkline(el.querySelector('#growth-signups'), series.signups, { color:'#7C5CFF', height: 28 }) } catch (_) {}
        try { makeSparkline(el.querySelector('#growth-posts'),   series.posts,   { color:'#F59E0B', height: 28 }) } catch (_) {}
        try { makeSparkline(el.querySelector('#growth-listens'), series.listens, { color:'#10B981', height: 28 }) } catch (_) {}
      } catch (e) {
        const el = container.querySelector('#ah-growth')
        if (el) el.innerHTML = `<div class="section"><h3>Wachstum</h3><div class="audit-empty">Nicht ladbar.</div></div>`
      }
    }

    // ---- Quick actions ----
    container.querySelectorAll('.qa-btn').forEach(b => {
      b.addEventListener('click', async () => {
        const qa = b.dataset.qa
        if (qa === 'bulk-verify') {
          const ok = await actionBulkVerify(container)
          if (ok) { await renderAlerts(); await renderAudit(true) }
        } else if (qa === 'push-premium') {
          actionOpenPanel('push-broadcast')
        } else if (qa === 'audit') {
          actionOpenPanel('audit-log')
        }
      })
    })

    // ---- Refresh button ----
    const debouncedRefresh = debounce(async () => {
      await Promise.all([renderHero(), renderAlerts(), renderAudit(false), renderGrowth()])
      if (lastUpd) lastUpd.textContent = `Aktualisiert: ${fmtDateTime(new Date())} · Auto 45s`
      try { toast('Admin-Home aktualisiert', 'success') } catch (_) {}
    }, 300)
    container.querySelector('#ah-refresh')?.addEventListener('click', debouncedRefresh)

    // ---- Initial load ----
    await Promise.all([renderHero(), renderAlerts(), renderAudit(false), renderGrowth()])
    if (lastUpd) lastUpd.textContent = `Aktualisiert: ${fmtDateTime(new Date())} · Auto 45s`

    // ---- Realtime: Audit-Log Live-Updates ----
    const debouncedAuditRefresh = debounce(() => renderAudit(true), REALTIME_DEBOUNCE_MS)
    try {
      realtimeChan = sb.channel('admin-home-audit')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'admin_audit_log' }, () => debouncedAuditRefresh())
        .subscribe()
    } catch (_) {}

    // ---- Interval ----
    refreshTimer = setInterval(async () => {
      await Promise.all([renderHero(), renderAlerts(), renderAudit(false), renderGrowth()])
      if (lastUpd) lastUpd.textContent = `Aktualisiert: ${fmtDateTime(new Date())} · Auto 45s`
    }, REFRESH_MS)

    return () => {
      if (refreshTimer) clearInterval(refreshTimer)
      if (realtimeChan) { try { sb.removeChannel(realtimeChan) } catch (_) {} }
    }
  }
}
