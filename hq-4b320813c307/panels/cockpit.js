// COCKPIT — das Founder-Hauptdashboard. Aggregiert die wichtigsten KPIs +
// System-Health auf EINEN Blick und verlinkt in die Detail-Panels (dopplet
// keine Logik). Datenquellen parallel: admin_health_overview (Actions/Push/Cron/
// DB/Security/DeepL), admin_db_live_stats (KPIs), admin_ai_usage_overview +
// admin_ai_media_overview (KI/Render), admin_cost_overview (Storage/DB), admin_follower_growth.
import { sb } from '/lib/supabase.js?v=20260610q'
import { fmtNumber, iconHtml, htmlEscape, fmtRelativeTime, toast } from '/lib/ui.js?v=20260610q'

// Sprungziele = #tab/subtab (robuste Hash-Route, vom index.html-Router verstanden).
const JUMP = {
  verify: 'content/podcasts', moderation: 'content/reports', bugs: 'content/reports',
  botfb: 'content/bot', events: 'content/events', leads: 'people/leads', tasks: 'system/tasks',
  push: 'system/push', media: 'system/ki-medien', kiusage: 'system/ki-usage',
  cost: 'system/kosten', dbsec: 'system/api-health', growth: 'growth/dau', users: 'people/users',
}
const go = (key) => { if (JUMP[key]) location.hash = '#' + JUMP[key] }

const safe = (p) => p.then(r => (r && !r.error ? (r.data ?? r) : null)).catch(() => null)
const num = (v) => (v == null || isNaN(Number(v)) ? null : Number(v))
const COL = { green: '#22C55E', amber: '#F59E0B', red: '#EF4444', grey: '#9CA3AF' }

async function fetchAll() {
  const [health, stats, kiUsage, media, cost, follow] = await Promise.all([
    safe(sb.rpc('admin_health_overview')),
    safe(sb.rpc('admin_db_live_stats')),
    safe(sb.rpc('admin_ai_usage_overview')),
    safe(sb.rpc('admin_ai_media_overview')),
    safe(sb.rpc('admin_cost_overview')),
    safe(sb.rpc('admin_follower_growth', { p_limit: 5 })),
  ])
  // Fallback-Counts ohne Gate (falls live_stats fehlt)
  let usersTotal = num(stats?.total_users ?? stats?.users_total)
  if (usersTotal == null) {
    try { const { count } = await sb.from('users').select('id', { count: 'exact', head: true }).is('deleted_at', null); usersTotal = count } catch (_) {}
  }
  let posts24 = num(stats?.posts_24h)
  if (posts24 == null) {
    try { const since = new Date(Date.now() - 864e5).toISOString(); const { count } = await sb.from('updates').select('id', { count: 'exact', head: true }).gte('created_at', since); posts24 = count } catch (_) {}
  }
  return { health, stats, kiUsage, media, cost, follow, usersTotal, posts24 }
}

// ---- Health-Ampel-Logik (Schwellen aus dem Discovery-Spec) ----------------
function evalHealth(d) {
  const h = d.health || {}, push = h.push || {}, cron = h.cron || {}, sec = h.security || {}, deepl = h.deepl || {}
  const ki = d.kiUsage || {}, media = d.media || {}, cost = d.cost || {}
  const out = []

  // Push-Zustellung
  {
    const fresh = num(push.fresh_pending), pend = num(push.total_pending), last = push.last_sent_at
    let lvl = 'grey', detail = 'keine Daten'
    if (push.error) { detail = 'Quelle fehlt' }
    else if (pend != null) {
      const lastMin = last ? (Date.now() - new Date(last).getTime()) / 60000 : Infinity
      if (pend === 0 || lastMin <= 5) { lvl = 'green'; detail = `${fmtNumber(pend)} wartend · zuletzt ${last ? fmtRelativeTime(last) : 'nie'}` }
      else if ((fresh || 0) <= 50 && lastMin <= 30) { lvl = 'amber'; detail = `${fmtNumber(fresh)} frisch wartend · zuletzt ${fmtRelativeTime(last)}` }
      else { lvl = 'red'; detail = `${fmtNumber(pend)} wartend, ${last ? 'zuletzt ' + fmtRelativeTime(last) : 'NIE gesendet'} — Worker steht` }
    }
    out.push({ key: 'push', label: 'Push-Zustellung', lvl, detail, jump: 'push' })
  }
  // Render-Jobs
  {
    const r = media.renders || {}, stuck = (r.stuck || []).length, bs = r.by_status || {}
    const err = (bs.error || 0) + (bs.failed || 0), total = Object.values(bs).reduce((s, n) => s + n, 0) || 0
    let lvl = 'grey', detail = 'keine Daten'
    if (media && media.renders) {
      if (stuck >= 3 || (total && err / total >= 0.1)) { lvl = 'red'; detail = `${stuck} hängen, ${err} Fehler` }
      else if (stuck >= 1 || err > 0) { lvl = 'amber'; detail = `${stuck} hängen, ${err} Fehler` }
      else { lvl = 'green'; detail = `${bs.done || 0} fertig, 0 hängen` }
    }
    out.push({ key: 'media', label: 'Render-Jobs', lvl, detail, jump: 'media' })
  }
  // KI / Groq-Whisper (Requests + Cache-Stale)
  {
    const today = num(ki.today_requests), lim = num(ki.groq_req_per_day) || 2000
    const c = media.cache || {}, stale = num(c.stale), entries = num(c.entries)
    let lvl = 'grey', detail = 'keine Daten'
    if (today != null) {
      const p = (today / lim) * 100
      const stalePct = (entries && stale != null) ? (stale / entries) * 100 : null
      const reqLvl = p > 95 ? 'red' : p > 80 ? 'amber' : 'green'
      const staleLvl = stalePct == null ? 'green' : stalePct > 60 ? 'red' : stalePct > 30 ? 'amber' : 'green'
      lvl = ['red', 'amber', 'green'].find(L => reqLvl === L || staleLvl === L)
      detail = `${fmtNumber(today)}/${fmtNumber(lim)} Req (${Math.round(p)}%)${stalePct != null ? ` · ${Math.round(stalePct)}% Cache stale` : ''}`
    }
    out.push({ key: 'ki', label: 'KI / Groq-Whisper', lvl, detail, jump: 'media' })
  }
  // Storage & DB
  {
    const sb_ = num(cost.storage_bytes), dbb = num(cost.db_size_bytes ?? (d.health?.db?.size_bytes))
    const GB = 1024 ** 3
    let lvl = 'grey', detail = 'keine Daten'
    if (sb_ != null || dbb != null) {
      const sp = sb_ != null ? (sb_ / (100 * GB)) * 100 : 0
      const dp = dbb != null ? (dbb / (8 * GB)) * 100 : 0
      const worst = Math.max(sp, dp)
      lvl = worst > 90 ? 'red' : worst > 70 ? 'amber' : 'green'
      detail = `Storage ${sp.toFixed(1)}% · DB ${dp.toFixed(1)}%`
    }
    out.push({ key: 'storage', label: 'Storage & DB', lvl, detail, jump: 'cost' })
  }
  // DB-Security (RLS / Views)
  {
    const noRls = Array.isArray(sec.tables_without_rls) ? sec.tables_without_rls : null
    const dViews = Array.isArray(sec.definer_views) ? sec.definer_views : null
    let lvl = 'grey', detail = 'keine Daten'
    if (noRls != null || dViews != null) {
      const nr = (noRls || []).length, dv = (dViews || []).length
      lvl = nr >= 3 ? 'red' : (nr >= 1 || dv >= 1) ? 'amber' : 'green'
      detail = `${nr} Tabellen ohne RLS · ${dv} DEFINER-Views`
    }
    out.push({ key: 'dbsec', label: 'DB-Security (RLS)', lvl, detail, jump: 'dbsec' })
  }
  // Cron / Background-Jobs (push-outbox-worker im Fokus)
  {
    let lvl = 'grey', detail = 'keine Daten'
    if (Array.isArray(cron.jobs)) {
      const active = num(cron.active_count) || 0
      const worker = cron.jobs.find(j => /push.?outbox/i.test(j.jobname || ''))
      const wMin = worker?.last_run ? (Date.now() - new Date(worker.last_run).getTime()) / 60000 : Infinity
      const wFailed = worker && worker.last_status && /fail|error/i.test(worker.last_status)
      if (!worker || wMin > 10 || wFailed) { lvl = 'red'; detail = `${active} Jobs aktiv · push-Worker ${worker ? (wFailed ? 'FEHLER' : 'still seit ' + (isFinite(wMin) ? Math.round(wMin) + 'min' : 'nie')) : 'fehlt'}` }
      else { lvl = 'green'; detail = `${active} Jobs aktiv · push-Worker ok` }
    } else if (cron.error) { detail = 'cron-Schema nicht lesbar' }
    out.push({ key: 'cron', label: 'Cron / Jobs', lvl, detail, jump: 'dbsec' })
  }
  // DeepL-Quota
  {
    const used = num(deepl.chars_used), lim = num(deepl.limit) || 480000
    let lvl = 'grey', detail = 'keine Daten'
    if (used != null) {
      const p = (used / lim) * 100
      lvl = p >= 90 ? 'red' : p >= 60 ? 'amber' : 'green'
      detail = `${fmtNumber(used)}/${fmtNumber(lim)} Zeichen (${p.toFixed(1)}%)`
    }
    out.push({ key: 'deepl', label: 'DeepL-Quota', lvl, detail, jump: 'cost' })
  }
  return out
}

function healthTile(t) {
  const c = COL[t.lvl] || COL.grey
  const dot = `<span style="width:9px;height:9px;border-radius:50%;background:${c};box-shadow:0 0 8px ${c}80;flex-shrink:0"></span>`
  return `<div data-jump="${t.jump}" style="cursor:pointer;background:rgba(255,255,255,.03);border:1px solid ${t.lvl === 'red' ? c + '66' : 'rgba(255,255,255,.07)'};border-radius:14px;padding:13px 14px;${t.lvl === 'red' ? `box-shadow:0 0 0 1px ${c}33` : ''}">
    <div style="display:flex;align-items:center;gap:9px;margin-bottom:5px">${dot}<span style="font-size:13px;font-weight:600;color:var(--text,#fff)">${htmlEscape(t.label)}</span><span style="margin-left:auto;font-size:11px;font-weight:700;text-transform:uppercase;color:${c}">${t.lvl === 'grey' ? '?' : t.lvl}</span></div>
    <div style="font-size:11.5px;color:var(--text-muted,#9CA3AF);line-height:1.4">${htmlEscape(t.detail)}</div>
  </div>`
}

function actionRow(a) {
  const has = a.count != null && a.count > 0
  const c = has ? (a.urgent ? COL.red : COL.amber) : COL.green
  return `<div data-jump="${a.jump}" style="cursor:pointer;display:flex;align-items:center;gap:12px;padding:11px 0;border-bottom:1px solid rgba(255,255,255,0.05)">
    <span style="min-width:42px;text-align:right;font-size:19px;font-weight:800;color:${has ? c : COL.grey}">${a.count == null ? '—' : fmtNumber(a.count)}</span>
    <span style="flex:1;font-size:13.5px;color:var(--text,#fff)">${htmlEscape(a.label)}${a.overdue ? ` <span style="color:${COL.red};font-size:11px">(${fmtNumber(a.overdue)} überfällig)</span>` : ''}</span>
    <span style="color:var(--text-muted,#9CA3AF);font-size:18px">›</span>
  </div>`
}

function render(container, d) {
  const h = d.health || {}, act = h.actions || {}, st = d.stats || {}, fol = d.follow || {}
  const totalActions = num(act.total)
  const health = evalHealth(d)
  const reds = health.filter(x => x.lvl === 'red').length
  const deg = !d.health // health RPC fehlte ganz

  // KPIs für Hero
  const active24 = num(st.active_24h)
  const listenH = num(st.listening_hours ?? st.listening_hours_24h)
  const new7 = num(fol.new_7d)

  const actions = [
    { label: 'Podcasts wartend auf Verifizierung', count: num(act.podcasts_pending), jump: 'verify', urgent: true },
    { label: 'Gemeldete Inhalte (Moderation)', count: num(act.reports_open), jump: 'moderation', urgent: true },
    { label: 'Offene Bug-Reports', count: num(act.bugs_open), jump: 'bugs' },
    { label: 'Neues Bot-Feedback', count: num(act.bot_feedback_new), jump: 'botfb' },
    { label: 'Events wartend auf Freigabe', count: num(act.events_pending), jump: 'events' },
    { label: 'Offene Leads', count: num(act.leads_open), overdue: num(act.leads_overdue), jump: 'leads' },
    { label: 'Offene Team-Aufgaben', count: num(act.tasks_open), overdue: num(act.tasks_overdue), jump: 'tasks' },
  ].sort((a, b) => (b.count || 0) - (a.count || 0))

  const heroTile = (label, val, sub, accent, jump) =>
    `<div class="stat-hero"${jump ? ` data-jump="${jump}" style="cursor:pointer"` : ''}>
      <div class="stat-value"${accent ? ` style="color:${accent}"` : ''}>${val}</div>
      <div class="stat-label">${htmlEscape(label)}</div>
      ${sub ? `<div class="stat-label" style="opacity:.65">${htmlEscape(sub)}</div>` : ''}
    </div>`

  container.innerHTML = `
    <div class="panel-head">
      <div class="panel-head-left">
        <div class="panel-title">Cockpit</div>
        <div class="panel-sub">Alles Wichtige auf einen Blick${h.generated_at ? ` · Stand ${new Date(h.generated_at).toLocaleString('de-AT', { dateStyle: 'short', timeStyle: 'short' })}` : ''}</div>
      </div>
      <button class="btn btn-ghost" id="cp-refresh">${iconHtml('refresh')} Aktualisieren</button>
    </div>

    ${reds ? `<div class="panel-section" style="border:1px solid ${COL.red}55;background:${COL.red}11;display:flex;align-items:center;gap:12px">
      <span style="font-size:22px">🚨</span>
      <div style="flex:1"><div style="font-size:14px;font-weight:700;color:${COL.red}">${reds} System${reds > 1 ? 'e' : ''} im roten Bereich</div>
      <div style="font-size:12px;color:var(--text-muted,#9CA3AF)">${health.filter(x => x.lvl === 'red').map(x => htmlEscape(x.label)).join(' · ')} — unten antippen für Details.</div></div>
    </div>` : ''}
    ${deg ? `<div class="panel-section" style="border:1px solid ${COL.amber}44;background:${COL.amber}0d;font-size:12.5px;color:${COL.amber}">Health-Daten teilweise nicht erreichbar (admin_health_overview). KPIs ggf. unvollständig.</div>` : ''}

    <div class="hero-row">
      ${heroTile('Offene Aktionen', totalActions == null ? '—' : fmtNumber(totalActions), 'brauchen dich', totalActions ? COL.amber : COL.green)}
      ${heroTile('User gesamt', d.usersTotal == null ? '—' : fmtNumber(d.usersTotal), null, null, 'users')}
      ${heroTile('Beiträge 24h', d.posts24 == null ? '—' : fmtNumber(d.posts24), null, null, 'growth')}
      ${heroTile('Aktiv 24h', active24 == null ? '—' : fmtNumber(active24), 'Engagement', null, 'growth')}
      ${heroTile('Hörstunden 24h', listenH == null ? '—' : fmtNumber(Math.round(listenH)), null, null, 'growth')}
      ${heroTile('Neue Follows 7d', new7 == null ? '—' : fmtNumber(new7), `${fmtNumber(num(fol.total_follows) || 0)} gesamt`, null, 'growth')}
    </div>

    <div class="grid-2">
      <div class="panel-section">
        <div class="card-header"><strong>Aktionen — was braucht dich</strong>${totalActions ? `<span class="card-sub">${fmtNumber(totalActions)} offen</span>` : '<span class="card-sub" style="color:' + COL.green + '">alles erledigt ✓</span>'}</div>
        ${actions.map(actionRow).join('')}
      </div>

      <div class="panel-section">
        <div class="card-header"><strong>System-Health</strong><span class="card-sub">${reds ? reds + ' rot' : 'alles grün ✓'}</span></div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin-top:4px">
          ${health.map(healthTile).join('')}
          <div data-ext="sentry" style="cursor:pointer;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:14px;padding:13px 14px">
            <div style="display:flex;align-items:center;gap:9px;margin-bottom:5px"><span style="width:9px;height:9px;border-radius:50%;background:${COL.grey};flex-shrink:0"></span><span style="font-size:13px;font-weight:600;color:var(--text,#fff)">Crashes (Sentry)</span><span style="margin-left:auto;font-size:11px;color:#7C5CFF">↗ extern</span></div>
            <div style="font-size:11.5px;color:var(--text-muted,#9CA3AF)">Im CRM noch blind — Sentry-Dashboard öffnen (Baseline ~45/Tag).</div>
          </div>
        </div>
      </div>
    </div>

    <div class="panel-section">
      <div class="card-header" style="display:flex;justify-content:space-between;align-items:center">
        <strong>Wachstum</strong>
        <button class="btn btn-ghost" data-jump="growth" style="padding:5px 12px;font-size:12px">Details →</button>
      </div>
      <div style="display:flex;gap:22px;flex-wrap:wrap;margin-top:6px">
        <div><div style="font-size:20px;font-weight:700">${fmtNumber(num(fol.total_follows) || 0)}</div><div style="font-size:11px;color:var(--text-muted,#9CA3AF)">Follows gesamt</div></div>
        <div><div style="font-size:20px;font-weight:700;color:${COL.green}">+${fmtNumber(new7 || 0)}</div><div style="font-size:11px;color:var(--text-muted,#9CA3AF)">neue Follows 7d</div></div>
        <div><div style="font-size:20px;font-weight:700">${fmtNumber(num(st.total_posts) || d.posts24 || 0)}</div><div style="font-size:11px;color:var(--text-muted,#9CA3AF)">Beiträge gesamt</div></div>
        <div><div style="font-size:20px;font-weight:700">${fmtNumber(num(st.total_podcasts) || 0)}</div><div style="font-size:11px;color:var(--text-muted,#9CA3AF)">Podcasts</div></div>
      </div>
      ${Array.isArray(fol.top_7d) && fol.top_7d.length ? `<div style="margin-top:12px"><div style="font-size:11px;color:var(--text-muted,#9CA3AF);margin-bottom:5px">Top-Gainer 7d</div>${fol.top_7d.slice(0, 5).map(u => `<span style="display:inline-block;margin:0 6px 6px 0;padding:4px 10px;border-radius:999px;background:rgba(124,92,255,.14);color:#b9a6ff;font-size:12px">@${htmlEscape(u.username || '?')} +${fmtNumber(u.gained || u.new_followers || 0)}</span>`).join('')}</div>` : ''}
    </div>
  `

  container.querySelector('#cp-refresh')?.addEventListener('click', () => load(container))
  container.querySelectorAll('[data-jump]').forEach(el => el.addEventListener('click', () => go(el.getAttribute('data-jump'))))
  container.querySelector('[data-ext="sentry"]')?.addEventListener('click', () => window.open('https://michael-czesun-das-geht.sentry.io/issues/?project=react-native', '_blank'))
}

async function load(container) {
  container.innerHTML = `<div class="panel-section" style="text-align:center;padding:48px;color:var(--text-muted,#9CA3AF)">Lädt Cockpit…</div>`
  try {
    render(container, await fetchAll())
  } catch (e) {
    console.error('[cockpit]', e)
    const msg = (e && e.message) || 'Fehler'
    container.innerHTML = `<div class="panel-section" style="text-align:center;padding:40px;color:#EF4444">
      Cockpit konnte nicht geladen werden.<br><span style="font-size:12px;color:var(--text-muted,#9CA3AF)">${htmlEscape(msg)}</span></div>`
    toast('Cockpit: ' + msg, 'error')
  }
}

export default {
  id: 'cockpit',
  title: 'Cockpit',
  icon: 'gauge',
  async mount(container) {
    await load(container)
  }
}
