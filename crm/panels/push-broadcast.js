import { sb } from '/lib/supabase.js?v=20260610q'
import { toast, confirmDialog, fmtNumber, fmtDateTime, fmtRelativeTime, htmlEscape, iconHtml, debounce } from '/lib/ui.js?v=20260610q'
import { makeAreaChart, makeDonutChart } from '/lib/charts.js?v=20260610q'
import { exportPanelAsPdf, exportCsv } from '/lib/export.js?v=20260610q'
import { drawer, statHero } from '/lib/layout-extras.js?v=20260610q'

// ─── Audience-Segmente ────────────────────────────────────────────────────────
//
// Neue Segmente (Stand 9.6.26):
//   all          → komplette User-Basis
//   verified     → users.is_verified = true
//   podcaster    → user_type IN ('podcaster','both')
//   active_7d    → users.last_seen_at >= now() - 7d
//   custom       → explizite User-IDs aus Custom-Search
//
// Backend-Mapping (mit graceful Fallback):
//   1. admin_push_to_segment(segment, title, body, deep_link)  ← bevorzugt
//   2. admin_push_to_users(user_ids, title, body, deep_link)   ← für custom + test-an-mich
//   3. send_broadcast_push(title, body, audience, deep_link)   ← Legacy-Fallback
//      (Legacy kennt nur 'all'/'podcaster'/'listener'/'beta' — verified/active_7d
//       fallen dort auf 'all' zurück.)
const AUDIENCES = [
  { value: 'all',       label: 'Alle' },
  { value: 'verified',  label: 'Verifizierte' },
  { value: 'podcaster', label: 'Podcaster' },
  { value: 'active_7d', label: 'Aktive 7d' },
  { value: 'custom',    label: 'Custom' }
]

// Mapping audience → Legacy-Audience für send_broadcast_push-Fallback.
// verified/active_7d kennt das Legacy-RPC nicht → 'all'.
const LEGACY_AUDIENCE_MAP = {
  all:       'all',
  verified:  'all',
  podcaster: 'podcaster',
  active_7d: 'all',
  custom:    'all'  // wird nur als Fallback verwendet, wenn admin_push_to_users fehlt
}

function audienceLabel(v) {
  return AUDIENCES.find(a => a.value === v)?.label || v || '—'
}

// ─── Audience-Counts ──────────────────────────────────────────────────────────

async function fetchAudienceCounts() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 864e5).toISOString()
  const [totalRes, verifiedRes, podcasterRes, active7Res] = await Promise.all([
    sb.from('users').select('id', { count: 'exact', head: true }),
    sb.from('users').select('id', { count: 'exact', head: true }).eq('is_verified', true),
    sb.from('users').select('id', { count: 'exact', head: true }).in('user_type', ['podcaster', 'both']),
    sb.from('users').select('id', { count: 'exact', head: true }).gte('last_seen_at', sevenDaysAgo)
  ])
  return {
    all:       totalRes.count     || 0,
    verified:  verifiedRes.count  || 0,
    podcaster: podcasterRes.count || 0,
    active_7d: active7Res.count   || 0,
    custom:    0
  }
}

// ─── User-Search für Custom-Audience ──────────────────────────────────────────

async function searchUsers(q) {
  if (!q || q.trim().length < 2) return []
  // Bevorzugt RPC, sonst direkte Tabellenabfrage als Fallback.
  try {
    const { data, error } = await sb.rpc('crm_search_users', { q: q.trim(), limit: 20 })
    if (!error && Array.isArray(data)) {
      return data.map(u => ({
        id: u.id,
        username: u.username || '',
        full_name: u.full_name || u.display_name || '',
        avatar_url: u.avatar_url || null
      }))
    }
  } catch (_) { /* RPC nicht vorhanden → Fallback */ }
  try {
    const term = `%${q.trim()}%`
    const { data, error } = await sb
      .from('users')
      .select('id, username, full_name, avatar_url')
      .or(`username.ilike.${term},full_name.ilike.${term},email.ilike.${term}`)
      .limit(20)
    if (error) return []
    return data || []
  } catch (_) { return [] }
}

// ─── History aus admin_audit_log ──────────────────────────────────────────────
//
// Quelle laut Spec: admin_audit_log WHERE action='admin_broadcast'.
// Da RLS direktes SELECT auf admin_audit_log meist blockt, lesen wir via
// admin_audit_recent-RPC und filtern client-side. Fallback: email_broadcasts.

function normaliseAuditRow(row) {
  const meta = row.meta || row.payload || {}
  return {
    id:         row.id,
    title:      meta.title       || meta.subject || '(ohne Titel)',
    body:       meta.body        || meta.message || '',
    audience:   meta.audience    || meta.segment || (Array.isArray(meta.user_ids) ? 'custom' : 'all'),
    deep_link:  meta.deep_link   || meta.deeplink || '',
    sent_at:    row.created_at,
    actor_id:   row.actor_id     || row.admin_id || null,
    actor_name: row.admin_full_name || row.admin_username || '',
    recipients: meta.recipient_count ?? meta.recipients ?? (Array.isArray(meta.user_ids) ? meta.user_ids.length : 0),
    delivered:  meta.delivered_count ?? meta.delivered ?? 0,
    opened:     meta.opened_count    ?? meta.opened    ?? 0,
    source:     'audit_log'
  }
}

function normaliseEmailBroadcast(row) {
  return {
    id:         row.id,
    title:      row.subject || row.title || '(ohne Titel)',
    body:       row.body || row.message || '',
    audience:   row.audience || row.segment || 'all',
    deep_link:  row.deep_link || row.deeplink || '',
    sent_at:    row.sent_at || row.created_at,
    actor_id:   null,
    actor_name: '',
    recipients: row.recipient_count ?? row.recipients ?? 0,
    delivered:  row.delivered_count ?? row.delivered ?? 0,
    opened:     row.opened_count    ?? row.opened    ?? 0,
    source:     'email_broadcasts'
  }
}

async function fetchHistory() {
  // Versuch 1: admin_audit_log via RPC.
  try {
    const { data, error } = await sb.rpc('admin_audit_recent', { p_limit: 200, p_offset: 0 })
    if (!error && Array.isArray(data)) {
      const broadcasts = data
        .filter(r => r.action === 'admin_broadcast' || r.action === 'broadcast_push' || r.action === 'push_broadcast')
        .slice(0, 10)
        .map(normaliseAuditRow)
      if (broadcasts.length) return broadcasts
    }
  } catch (err) {
    console.warn('[push-broadcast] audit RPC error:', err)
  }
  // Versuch 2: email_broadcasts (Legacy-Fallback).
  try {
    const { data, error } = await sb
      .from('email_broadcasts')
      .select('*')
      .order('sent_at', { ascending: false })
      .limit(10)
    if (!error && data) return data.map(normaliseEmailBroadcast)
  } catch (err) {
    console.warn('[push-broadcast] email_broadcasts fallback error:', err)
  }
  return []
}

// ─── Send-Wrapper mit RPC-Fallback ────────────────────────────────────────────

async function sendToSegment({ segment, title, body, deepLink }) {
  // 1. admin_push_to_segment
  try {
    const params = { segment, title, body }
    if (deepLink && deepLink.trim()) params.deep_link = deepLink.trim()
    const { data, error } = await sb.rpc('admin_push_to_segment', params)
    if (!error) return { data, via: 'admin_push_to_segment' }
    if (error.code !== '42883' && !/does not exist|not found|could not find/i.test(error.message || '')) {
      throw new Error(error.message || 'admin_push_to_segment fehlgeschlagen')
    }
  } catch (e) {
    if (e.message && !/does not exist|not found|could not find/i.test(e.message)) throw e
  }
  // 2. Legacy: send_broadcast_push
  const legacyAudience = LEGACY_AUDIENCE_MAP[segment] || 'all'
  const params = { p_title: title, p_body: body, p_audience: legacyAudience }
  if (deepLink && deepLink.trim()) params.p_deep_link = deepLink.trim()
  const { data, error } = await sb.rpc('send_broadcast_push', params)
  if (error) throw new Error(error.message || 'send_broadcast_push fehlgeschlagen')
  return { data, via: 'send_broadcast_push' }
}

async function sendToUsers({ userIds, title, body, deepLink }) {
  if (!userIds || !userIds.length) throw new Error('Keine Ziel-User')
  // 1. admin_push_to_users
  try {
    const params = { p_user_ids: userIds, p_title: title, p_message: body }
    const { data, error } = await sb.rpc('admin_push_to_users', params)
    if (!error) return { data, via: 'admin_push_to_users' }
    if (error.code !== '42883' && !/does not exist|not found|could not find/i.test(error.message || '')) {
      throw new Error(error.message || 'admin_push_to_users fehlgeschlagen')
    }
  } catch (e) {
    if (e.message && !/does not exist|not found|could not find/i.test(e.message)) throw e
  }
  // Kein Fallback möglich: send_broadcast_push kennt keine User-IDs.
  throw new Error('Backend-RPC admin_push_to_users existiert nicht — Custom/Test-Sends nicht möglich.')
}

// ─── Render-Helper ────────────────────────────────────────────────────────────

function renderHero(history, totalUsers) {
  const cutoff = Date.now() - 7 * 864e5
  const last7  = history.filter(h => new Date(h.sent_at) > cutoff)
  const totalDelivered = history.reduce((s, h) => s + (h.delivered || 0), 0)
  const totalOpened    = history.reduce((s, h) => s + (h.opened    || 0), 0)
  const openRate = totalDelivered ? (totalOpened / totalDelivered * 100) : 0

  return `<div class="hero-row">
    ${statHero({ label: 'Erreichbare User',  value: fmtNumber(totalUsers),     icon: iconHtml('users') })}
    ${statHero({ label: 'Broadcasts (7T)',   value: fmtNumber(last7.length),   icon: iconHtml('send') })}
    ${statHero({ label: 'Zugestellt gesamt', value: fmtNumber(totalDelivered), icon: iconHtml('check') })}
    ${statHero({ label: 'Open-Rate',         value: openRate.toFixed(1) + '%', icon: iconHtml('eye') })}
  </div>`
}

function renderForm(counts) {
  return `<div class="glass-card broadcast-form">
    <div class="form-head">
      <h3>${iconHtml('send')} Neue Push-Nachricht</h3>
      <p class="form-sub">Wird sofort an die ausgewählte Audience zugestellt.</p>
    </div>
    <div class="form-grid">
      <div class="form-row">
        <label class="form-label">Audience</label>
        <div class="seg-control" id="audience-seg">
          ${AUDIENCES.map((a, i) => `
            <button class="seg-btn${i === 0 ? ' active' : ''}" data-v="${a.value}">
              ${htmlEscape(a.label)}
              <span class="seg-count">${a.value === 'custom' ? '0' : fmtNumber(counts[a.value] || 0)}</span>
            </button>`).join('')}
        </div>
        <div class="audience-count">
          <span class="count-pill">
            <strong id="audience-count">${fmtNumber(counts['all'] || 0)}</strong>
            User werden erreicht
          </span>
        </div>
      </div>

      <div class="form-row custom-row" id="custom-row" style="display:none;">
        <label class="form-label" for="bc-user-search">Custom User-Auswahl</label>
        <input id="bc-user-search" class="input" type="text" placeholder="User suchen (Name oder @handle)…" />
        <div id="bc-user-suggest" class="user-suggest"></div>
        <div id="bc-user-chips" class="user-chips"></div>
      </div>

      <div class="form-row">
        <label class="form-label" for="bc-title">Titel <span class="label-hint">(max. 60)</span></label>
        <input id="bc-title" class="input" type="text" maxlength="60"
               placeholder="z.B. Neue Episode ist live 🎙️" />
        <div class="char-counter"><span id="title-count">0</span>/60</div>
      </div>

      <div class="form-row">
        <label class="form-label" for="bc-body">Nachricht <span class="label-hint">(max. 180)</span></label>
        <textarea id="bc-body" class="input textarea" maxlength="180" rows="3"
                  placeholder="Kurz, prägnant, mit einem Hook…"></textarea>
        <div class="char-counter"><span id="body-count">0</span>/180</div>
      </div>

      <div class="form-row">
        <label class="form-label" for="bc-link">Deep-Link <span class="label-hint">(optional)</span></label>
        <input id="bc-link" class="input" type="text"
               placeholder="podfluence://episode/123 oder https://…" />
      </div>

      <div class="preview-block">
        <div class="form-label">Live-Preview</div>
        <div class="push-preview-wrap">
          <div class="push-preview ios-look">
            <div class="push-preview-icon">
              <img src="/i/icon-180.png" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='grid';" />
              <div class="icon-fallback" style="display:none;">${iconHtml('bell')}</div>
            </div>
            <div class="push-preview-body">
              <div class="pp-app">
                <span>PODFLUENCE</span>
                <span class="pp-time">jetzt</span>
              </div>
              <div class="pp-title" id="pp-title">Titel deiner Push</div>
              <div class="pp-text"  id="pp-text">Hier erscheint dein Nachrichtentext.</div>
            </div>
          </div>
        </div>
      </div>

      <div class="form-actions">
        <button class="btn btn-ghost" id="btn-test" title="Sendet einen Test-Push nur an dein eigenes Konto.">
          ${iconHtml('user')} Test an mich
        </button>
        <button class="btn btn-primary btn-lg" id="btn-send" disabled>
          ${iconHtml('send')} An <span id="send-count">${fmtNumber(counts['all'] || 0)}</span> User senden
        </button>
      </div>
    </div>
  </div>`
}

function historyRow(h) {
  const deliveryRate = h.recipients ? Math.round((h.delivered || 0) / h.recipients * 100) : 0
  const openRate     = h.delivered  ? Math.round((h.opened    || 0) / h.delivered  * 100) : 0
  return `<tr data-id="${htmlEscape(String(h.id))}" class="row-clickable">
    <td>
      <div class="cell-title">${htmlEscape(h.title || '(ohne Titel)')}</div>
      <div class="cell-sub">${htmlEscape((h.body || '').slice(0, 80))}${(h.body || '').length > 80 ? '…' : ''}</div>
    </td>
    <td><span class="chip chip-soft">${htmlEscape(audienceLabel(h.audience))}</span></td>
    <td class="num">${fmtNumber(h.recipients || 0)}</td>
    <td class="num">
      ${h.delivered ? `<div class="bar-cell">
        <div class="bar-cell-fill" style="width:${deliveryRate}%;background:#34d399"></div>
        <span>${fmtNumber(h.delivered)} · ${deliveryRate}%</span>
      </div>` : `<span class="muted">—</span>`}
    </td>
    <td class="num">
      ${h.opened ? `<div class="bar-cell">
        <div class="bar-cell-fill" style="width:${openRate}%;background:#fbbf24"></div>
        <span>${fmtNumber(h.opened)} · ${openRate}%</span>
      </div>` : `<span class="muted">—</span>`}
    </td>
    <td class="muted" title="${htmlEscape(fmtDateTime(h.sent_at))}">${htmlEscape(fmtRelativeTime(h.sent_at))}</td>
  </tr>`
}

function renderHistory(history) {
  if (!history.length) {
    return `<div class="glass-card">
      <h3 class="card-head-h3">${iconHtml('clock')} Letzte Broadcasts</h3>
      <div class="history-empty">
        ${iconHtml('info')} Noch keine Broadcasts versendet.
      </div>
    </div>`
  }
  const sourceNote = history[0]?.source === 'audit_log'
    ? 'admin_audit_log · action=admin_broadcast'
    : 'email_broadcasts (Fallback)'
  return `<div class="glass-card">
    <div class="card-head">
      <h3>${iconHtml('clock')} Letzte ${history.length} Broadcasts
        <span class="muted" style="font-size:11px;font-weight:400;">(Quelle: ${htmlEscape(sourceNote)})</span>
      </h3>
    </div>
    <div class="table-wrap">
      <table class="data-table data-table-hover">
        <thead>
          <tr>
            <th>Nachricht</th>
            <th>Audience</th>
            <th class="num">Empfänger</th>
            <th class="num">Zugestellt</th>
            <th class="num">Geöffnet</th>
            <th>Gesendet</th>
          </tr>
        </thead>
        <tbody>${history.map(historyRow).join('')}</tbody>
      </table>
    </div>
  </div>`
}

function renderCharts(history) {
  const byDay = {}
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 864e5)
    byDay[d.toISOString().slice(0, 10)] = { sent: 0, delivered: 0, opened: 0 }
  }
  for (const h of history) {
    const k = (h.sent_at || '').slice(0, 10)
    if (byDay[k]) {
      byDay[k].sent      += 1
      byDay[k].delivered += h.delivered || 0
      byDay[k].opened    += h.opened    || 0
    }
  }
  const labels    = Object.keys(byDay)
  const delivered = labels.map(l => byDay[l].delivered)
  const opened    = labels.map(l => byDay[l].opened)

  const audAgg = {}
  for (const h of history) {
    const key = h.audience || 'unknown'
    audAgg[key] = (audAgg[key] || 0) + (h.recipients || 0)
  }
  const audLabels = Object.keys(audAgg).map(audienceLabel)
  const audValues = Object.values(audAgg)

  return `<div class="chart-row">
    <div class="glass-card chart-card">
      <div class="card-head"><h3>${iconHtml('activity')} Zustellung & Öffnungen (14T)</h3></div>
      <div id="chart-deliver" class="chart-box"></div>
    </div>
    <div class="glass-card chart-card chart-card-sm">
      <div class="card-head"><h3>${iconHtml('pie-chart')} Audience-Verteilung</h3></div>
      <div id="chart-audience" class="chart-box"></div>
    </div>
  </div>
  <script type="application/json" id="chart-data">${JSON.stringify({ labels, delivered, opened, audLabels, audValues })}<\/script>`
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function styles() {
  return `<style>
    .panel-shell { display:flex; flex-direction:column; gap:20px; padding:20px 24px 40px; }
    .panel-head  { display:flex; justify-content:space-between; align-items:center; gap:16px; flex-wrap:wrap; }
    .panel-head h2 { margin:0; font-size:24px; font-weight:600; letter-spacing:-0.02em; display:flex; align-items:center; gap:10px; }
    .toolbar { display:flex; gap:8px; }
    .toolbar .btn { padding:8px 14px; }

    .hero-row { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:14px; }

    .broadcast-form .form-head h3 { margin:0 0 4px; font-size:18px; font-weight:600; display:flex; align-items:center; gap:8px; }
    .broadcast-form { padding:24px; }
    .form-sub  { margin:4px 0 0; color:var(--text-muted,#8a8a93); font-size:13px; }
    .form-grid { display:grid; gap:22px; margin-top:20px; }
    .form-row  { display:flex; flex-direction:column; gap:8px; position:relative; }
    .form-label { font-size:13px; font-weight:500; color:var(--text-secondary,#c0c0c8); }
    .label-hint { color:var(--text-muted,#8a8a93); font-weight:400; }

    .input { background:var(--input-bg,rgba(255,255,255,0.04)); border:1px solid var(--border,rgba(255,255,255,0.08)); color:var(--text,#fff); border-radius:10px; padding:11px 14px; font-size:14px; font-family:inherit; transition:border-color .15s,background .15s; width:100%; box-sizing:border-box; }
    .input:focus { outline:none; border-color:var(--accent,#7c5cff); background:rgba(255,255,255,0.06); }
    .textarea { resize:vertical; min-height:80px; line-height:1.5; }
    .char-counter { position:absolute; right:4px; bottom:-18px; font-size:11px; color:var(--text-muted,#8a8a93); }

    .seg-control { display:inline-flex; flex-wrap:wrap; background:rgba(255,255,255,0.04); border:1px solid var(--border,rgba(255,255,255,0.08)); border-radius:10px; padding:3px; gap:2px; }
    .seg-btn { background:transparent; border:none; color:var(--text-secondary,#c0c0c8); padding:7px 13px; border-radius:7px; font-size:13px; cursor:pointer; transition:all .15s; font-family:inherit; display:inline-flex; align-items:center; gap:5px; }
    .seg-btn:hover { color:#fff; background:rgba(255,255,255,0.04); }
    .seg-btn.active { background:var(--accent,#7c5cff); color:#fff; }
    .seg-count { font-size:11px; opacity:0.75; }

    .audience-count { margin-top:8px; }
    .count-pill { background:rgba(124,92,255,0.12); border:1px solid rgba(124,92,255,0.25); color:var(--accent,#a48dff); padding:6px 14px; border-radius:999px; font-size:13px; display:inline-flex; align-items:center; gap:4px; }
    .count-pill strong { font-weight:600; color:#fff; }

    /* user search */
    .user-suggest { position:relative; background:rgba(15,15,20,0.96); border:1px solid var(--border,rgba(255,255,255,0.08)); border-radius:10px; margin-top:-2px; max-height:240px; overflow-y:auto; display:none; }
    .user-suggest.open { display:block; }
    .user-suggest-item { display:flex; align-items:center; gap:10px; padding:8px 12px; cursor:pointer; border-bottom:1px solid rgba(255,255,255,0.04); }
    .user-suggest-item:hover { background:rgba(255,255,255,0.05); }
    .user-suggest-item:last-child { border-bottom:none; }
    .user-suggest-avatar { width:28px; height:28px; border-radius:50%; background:rgba(255,255,255,0.06); display:grid; place-items:center; color:#c0c0c8; font-size:11px; overflow:hidden; flex-shrink:0; }
    .user-suggest-avatar img { width:100%; height:100%; object-fit:cover; }
    .user-suggest-name { font-size:13px; color:#fff; }
    .user-suggest-handle { font-size:12px; color:var(--text-muted,#8a8a93); }
    .user-suggest-empty { padding:14px; text-align:center; color:var(--text-muted,#8a8a93); font-size:12px; }

    .user-chips { display:flex; flex-wrap:wrap; gap:6px; margin-top:6px; min-height:8px; }
    .user-chip { display:inline-flex; align-items:center; gap:6px; background:rgba(124,92,255,0.15); border:1px solid rgba(124,92,255,0.35); color:#fff; padding:4px 10px; border-radius:999px; font-size:12px; }
    .user-chip-x { cursor:pointer; opacity:0.6; font-weight:700; padding:0 2px; }
    .user-chip-x:hover { opacity:1; }

    /* iOS-style live preview */
    .preview-block { margin-top:4px; }
    .push-preview-wrap { display:flex; justify-content:center; padding:8px 0; }
    .push-preview { background:rgba(40,40,46,0.92); backdrop-filter:blur(20px); border:1px solid rgba(255,255,255,0.08); border-radius:18px; padding:12px 14px; display:flex; gap:11px; align-items:flex-start; max-width:380px; width:100%; box-shadow:0 12px 36px rgba(0,0,0,0.45); }
    .push-preview-icon { width:38px; height:38px; border-radius:9px; background:linear-gradient(135deg,#7c5cff,#ff5cc8); display:grid; place-items:center; flex-shrink:0; color:white; overflow:hidden; position:relative; }
    .push-preview-icon img { width:100%; height:100%; object-fit:cover; }
    .push-preview-icon .icon-fallback { position:absolute; inset:0; display:grid; place-items:center; }
    .push-preview-body { flex:1; min-width:0; }
    .pp-app   { font-size:11px; font-weight:500; color:rgba(255,255,255,0.7); display:flex; justify-content:space-between; gap:8px; margin-bottom:2px; }
    .pp-time  { font-weight:400; color:rgba(255,255,255,0.55); }
    .pp-title { font-size:14px; font-weight:600; color:#fff; margin-bottom:2px; word-break:break-word; line-height:1.25; }
    .pp-text  { font-size:13px; color:rgba(255,255,255,0.78); line-height:1.35; word-break:break-word; }

    .form-actions { display:flex; gap:10px; justify-content:flex-end; padding-top:12px; border-top:1px solid var(--border,rgba(255,255,255,0.06)); flex-wrap:wrap; }

    .btn { display:inline-flex; align-items:center; gap:6px; border-radius:10px; padding:9px 16px; font-size:14px; font-weight:500; cursor:pointer; border:1px solid transparent; transition:all .15s; font-family:inherit; }
    .btn:disabled { opacity:0.45; cursor:not-allowed; pointer-events:none; }
    .btn-ghost   { background:transparent; border-color:var(--border,rgba(255,255,255,0.1)); color:var(--text,#fff); }
    .btn-ghost:hover { background:rgba(255,255,255,0.05); }
    .btn-primary { background:linear-gradient(135deg,#7c5cff,#5b3eff); color:white; box-shadow:0 4px 14px rgba(124,92,255,0.35); }
    .btn-primary:hover:not([disabled]) { transform:translateY(-1px); box-shadow:0 6px 20px rgba(124,92,255,0.45); }
    .btn-lg { padding:11px 22px; font-size:15px; }

    .chart-row { display:grid; grid-template-columns:2fr 1fr; gap:16px; }
    @media (max-width:900px) { .chart-row { grid-template-columns:1fr; } }
    .chart-card { padding:20px; }
    .chart-box  { height:220px; }
    .card-head h3, .card-head-h3 { margin:0 0 14px; font-size:15px; font-weight:600; display:flex; align-items:center; gap:8px; }

    .table-wrap   { overflow-x:auto; }
    .data-table   { width:100%; border-collapse:collapse; font-size:13px; }
    .data-table th { text-align:left; font-weight:500; color:var(--text-muted,#8a8a93); padding:10px 12px; border-bottom:1px solid var(--border,rgba(255,255,255,0.08)); font-size:12px; text-transform:uppercase; letter-spacing:0.04em; }
    .data-table td { padding:12px; border-bottom:1px solid rgba(255,255,255,0.04); vertical-align:middle; }
    .data-table .num { text-align:right; }
    .data-table-hover tbody tr { transition:background .12s; cursor:pointer; }
    .data-table-hover tbody tr:hover { background:rgba(255,255,255,0.03); }
    .cell-title { font-weight:500; color:#fff; margin-bottom:2px; }
    .cell-sub   { font-size:12px; color:var(--text-muted,#8a8a93); }
    .chip       { display:inline-block; padding:3px 10px; border-radius:999px; font-size:11px; font-weight:500; }
    .chip-soft  { background:rgba(255,255,255,0.06); color:var(--text-secondary,#c0c0c8); }
    .bar-cell   { position:relative; min-width:110px; padding:4px 0; }
    .bar-cell-fill { position:absolute; left:0; top:0; bottom:0; opacity:0.18; border-radius:4px; transition:width .4s; }
    .bar-cell span { position:relative; z-index:1; font-variant-numeric:tabular-nums; }
    .muted { color:var(--text-muted,#8a8a93); }
    .history-empty { padding:28px 0; text-align:center; color:var(--text-muted,#8a8a93); font-size:13px; }
    .loading-wrap { padding:40px; text-align:center; color:var(--text-muted,#8a8a93); }
    .error-state { padding:24px; text-align:center; color:var(--text-muted,#8a8a93); }
  </style>`
}

// ─── Main export ──────────────────────────────────────────────────────────────

export default {
  id:       'push-broadcast',
  title:    'Push-Broadcast Composer',
  category: 'admin_actions',

  async mount(container) {
    container.innerHTML = `${styles()}
      <div class="panel-shell">
        <div class="panel-head">
          <h2>${iconHtml('send')} Push-Broadcast Composer</h2>
          <div class="toolbar">
            <button class="btn btn-ghost" id="btn-refresh">${iconHtml('refresh-cw')} Aktualisieren</button>
            <button class="btn btn-ghost" id="btn-pdf">${iconHtml('file-text')} PDF</button>
            <button class="btn btn-ghost" id="btn-csv">${iconHtml('download')} CSV</button>
          </div>
        </div>
        <div id="body"><div class="loading-wrap">${iconHtml('loader')} Lädt…</div></div>
      </div>`

    const bodyEl = container.querySelector('#body')

    const renderAll = async () => {
      bodyEl.innerHTML = `<div class="loading-wrap">${iconHtml('loader')} Lädt…</div>`

      let counts, history
      try {
        const [c, h] = await Promise.all([fetchAudienceCounts(), fetchHistory()])
        counts  = c
        history = h
      } catch (e) {
        bodyEl.innerHTML = `<div class="glass-card error-state">
          ${iconHtml('alert-triangle')} Daten konnten nicht geladen werden: ${htmlEscape(e?.message || 'Unbekannter Fehler')}
          <br><button class="btn btn-ghost" id="retry" style="margin-top:12px">Erneut versuchen</button>
        </div>`
        bodyEl.querySelector('#retry').onclick = renderAll
        return
      }

      bodyEl.innerHTML = `
        ${renderHero(history, counts['all'] || 0)}
        ${renderForm(counts)}
        ${renderCharts(history)}
        ${renderHistory(history)}
      `

      // ── charts ──
      try {
        const chartDataEl = bodyEl.querySelector('#chart-data')
        if (chartDataEl) {
          const cd = JSON.parse(chartDataEl.textContent)
          makeAreaChart(bodyEl.querySelector('#chart-deliver'), {
            categories: cd.labels,
            series: [
              { name: 'Zugestellt', data: cd.delivered },
              { name: 'Geöffnet',   data: cd.opened }
            ],
            colors: ['#34d399', '#fbbf24'],
            height: 220
          })
          if (cd.audValues.length) {
            makeDonutChart(bodyEl.querySelector('#chart-audience'), {
              labels: cd.audLabels,
              values: cd.audValues
            })
          } else {
            bodyEl.querySelector('#chart-audience').innerHTML =
              `<div class="history-empty" style="padding:24px 16px;">
                <div style="font-size:24px;opacity:.45;margin-bottom:6px">${iconHtml('pie-chart')}</div>
                <div style="font-weight:600;color:var(--text);margin-bottom:2px">Noch keine Audience-Verteilung</div>
                <div style="font-size:12px;line-height:1.4">Sobald Broadcasts versendet wurden, erscheint hier die Aufteilung.</div>
              </div>`
          }
        }
      } catch (chartErr) {
        console.warn('[push-broadcast] chart init error:', chartErr)
      }

      // ── form state ──
      const state = {
        audience:    'all',
        title:       '',
        body:        '',
        deepLink:    '',
        customUsers: []   // [{id, username, full_name, avatar_url}]
      }

      const titleInput    = bodyEl.querySelector('#bc-title')
      const bodyInput     = bodyEl.querySelector('#bc-body')
      const linkInput     = bodyEl.querySelector('#bc-link')
      const titleCountEl  = bodyEl.querySelector('#title-count')
      const bodyCountEl   = bodyEl.querySelector('#body-count')
      const ppTitleEl     = bodyEl.querySelector('#pp-title')
      const ppTextEl      = bodyEl.querySelector('#pp-text')
      const audienceCount = bodyEl.querySelector('#audience-count')
      const sendCountEl   = bodyEl.querySelector('#send-count')
      const btnSend       = bodyEl.querySelector('#btn-send')
      const btnTest       = bodyEl.querySelector('#btn-test')
      const customRow     = bodyEl.querySelector('#custom-row')
      const userSearch    = bodyEl.querySelector('#bc-user-search')
      const userSuggest   = bodyEl.querySelector('#bc-user-suggest')
      const userChipsEl   = bodyEl.querySelector('#bc-user-chips')

      const currentCount = () => state.audience === 'custom' ? state.customUsers.length : (counts[state.audience] || 0)

      const updateUI = () => {
        const hasContent = state.title.trim().length > 0 && state.body.trim().length > 0
        const target = currentCount()
        const ok = hasContent && (state.audience !== 'custom' || target > 0)
        btnSend.disabled = !ok
        ppTitleEl.textContent = state.title || 'Titel deiner Push'
        ppTextEl.textContent  = state.body  || 'Hier erscheint dein Nachrichtentext.'
        audienceCount.textContent = fmtNumber(target)
        sendCountEl.textContent   = fmtNumber(target)
      }

      const renderChips = () => {
        userChipsEl.innerHTML = state.customUsers.map(u => `
          <span class="user-chip" data-uid="${htmlEscape(u.id)}">
            ${htmlEscape(u.full_name || u.username || '?')}
            <span class="user-chip-x" data-uid="${htmlEscape(u.id)}">×</span>
          </span>`).join('')
        userChipsEl.querySelectorAll('.user-chip-x').forEach(x => {
          x.onclick = () => {
            state.customUsers = state.customUsers.filter(u => u.id !== x.dataset.uid)
            renderChips()
            // Auch Counter im Audience-Tab updaten
            const customBtn = bodyEl.querySelector('.seg-btn[data-v="custom"] .seg-count')
            if (customBtn) customBtn.textContent = fmtNumber(state.customUsers.length)
            updateUI()
          }
        })
      }

      // Audience segmented control
      bodyEl.querySelectorAll('.seg-btn').forEach(btn => {
        btn.onclick = () => {
          bodyEl.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'))
          btn.classList.add('active')
          state.audience = btn.dataset.v
          customRow.style.display = state.audience === 'custom' ? 'flex' : 'none'
          updateUI()
        }
      })

      titleInput.oninput = () => {
        state.title = titleInput.value
        titleCountEl.textContent = state.title.length
        updateUI()
      }
      bodyInput.oninput = () => {
        state.body = bodyInput.value
        bodyCountEl.textContent = state.body.length
        updateUI()
      }
      linkInput.oninput = () => { state.deepLink = linkInput.value }

      // ── User-Search (Custom) ──
      const doSearch = debounce(async () => {
        const q = userSearch.value.trim()
        if (q.length < 2) { userSuggest.classList.remove('open'); userSuggest.innerHTML = ''; return }
        userSuggest.innerHTML = `<div class="user-suggest-empty">${iconHtml('loader')} Suche…</div>`
        userSuggest.classList.add('open')
        const results = await searchUsers(q)
        if (!results.length) {
          userSuggest.innerHTML = `<div class="user-suggest-empty">Keine Treffer für "${htmlEscape(q)}"</div>`
          return
        }
        userSuggest.innerHTML = results.map(u => {
          const already = state.customUsers.some(c => c.id === u.id)
          const initials = (u.full_name || u.username || '?').slice(0, 2).toUpperCase()
          return `<div class="user-suggest-item" data-uid="${htmlEscape(u.id)}" data-name="${htmlEscape(u.full_name || '')}" data-handle="${htmlEscape(u.username || '')}" data-avatar="${htmlEscape(u.avatar_url || '')}" style="${already ? 'opacity:0.4;pointer-events:none;' : ''}">
            <div class="user-suggest-avatar">${u.avatar_url ? `<img src="${htmlEscape(u.avatar_url)}" alt="">` : htmlEscape(initials)}</div>
            <div style="flex:1;min-width:0;">
              <div class="user-suggest-name">${htmlEscape(u.full_name || u.username || '?')}</div>
              ${u.username ? `<div class="user-suggest-handle">@${htmlEscape(u.username)}</div>` : ''}
            </div>
            ${already ? `<span class="muted" style="font-size:11px;">bereits gewählt</span>` : `<span style="font-size:11px;color:var(--accent,#a48dff);">+ hinzufügen</span>`}
          </div>`
        }).join('')
        userSuggest.querySelectorAll('.user-suggest-item').forEach(it => {
          it.onclick = () => {
            const uid = it.dataset.uid
            if (state.customUsers.some(c => c.id === uid)) return
            state.customUsers.push({
              id: uid,
              username: it.dataset.handle,
              full_name: it.dataset.name,
              avatar_url: it.dataset.avatar || null
            })
            userSearch.value = ''
            userSuggest.classList.remove('open')
            userSuggest.innerHTML = ''
            renderChips()
            const customBtn = bodyEl.querySelector('.seg-btn[data-v="custom"] .seg-count')
            if (customBtn) customBtn.textContent = fmtNumber(state.customUsers.length)
            updateUI()
          }
        })
      }, 250)
      userSearch.oninput = doSearch
      document.addEventListener('click', (e) => {
        if (!customRow.contains(e.target)) userSuggest.classList.remove('open')
      })

      updateUI()

      // ── Test an mich ──
      btnTest.onclick = async () => {
        if (!state.title.trim() || !state.body.trim()) {
          toast('Titel und Nachricht ausfüllen', 'warn')
          return
        }
        const { data: { session } } = await sb.auth.getSession()
        const myUid = session?.user?.id
        if (!myUid) { toast('Nicht eingeloggt', 'error'); return }
        btnTest.disabled = true
        const origLabel = btnTest.innerHTML
        btnTest.innerHTML = `${iconHtml('loader')} Sende…`
        try {
          await sendToUsers({
            userIds:  [myUid],
            title:    '[TEST] ' + state.title,
            body:     state.body,
            deepLink: state.deepLink
          })
          toast('Test-Push an dich versendet', 'success')
        } catch (e) {
          toast('Fehler: ' + (e.message || 'unbekannt'), 'error')
        }
        btnTest.disabled = false
        btnTest.innerHTML = origLabel
      }

      // ── Echter Broadcast ──
      btnSend.onclick = async () => {
        const target = currentCount()
        if (!state.title.trim() || !state.body.trim()) {
          toast('Titel und Nachricht sind Pflichtfelder', 'warn')
          return
        }
        if (state.audience === 'custom' && !state.customUsers.length) {
          toast('Mindestens einen User auswählen', 'warn')
          return
        }
        const audienceText = state.audience === 'custom'
          ? `${state.customUsers.length} ausgewählte User`
          : `${fmtNumber(target)} User (Audience „${audienceLabel(state.audience)}")`
        const ok = await confirmDialog({
          title: 'Broadcast versenden?',
          body: `Push wird an ${audienceText} zugestellt.\n\nTitel: „${state.title}"\n\nDiese Aktion lässt sich nicht rückgängig machen.`,
          confirmLabel: `An ${fmtNumber(target)} senden`,
          danger: true
        })
        if (!ok) return

        const origLabel = btnSend.innerHTML
        btnSend.disabled = true
        btnSend.innerHTML = `${iconHtml('loader')} Wird versendet…`

        try {
          if (state.audience === 'custom') {
            await sendToUsers({
              userIds:  state.customUsers.map(u => u.id),
              title:    state.title,
              body:     state.body,
              deepLink: state.deepLink
            })
          } else {
            await sendToSegment({
              segment:  state.audience,
              title:    state.title,
              body:     state.body,
              deepLink: state.deepLink
            })
          }
          toast(`Broadcast an ${fmtNumber(target)} User gestartet`, 'success')
          titleInput.value = ''
          bodyInput.value  = ''
          linkInput.value  = ''
          state.title = ''; state.body = ''; state.deepLink = ''
          state.customUsers = []
          renderChips()
          setTimeout(renderAll, 1500)
        } catch (e) {
          toast('Fehler beim Versenden: ' + (e.message || 'unbekannt'), 'error')
          btnSend.disabled = false
          btnSend.innerHTML = origLabel
        }
      }

      // ── History row click → drawer ──
      bodyEl.querySelectorAll('tbody tr.row-clickable').forEach(tr => {
        tr.onclick = () => {
          const id = tr.dataset.id
          const h  = history.find(x => String(x.id) === String(id))
          if (!h) return
          const deliveryRate = h.recipients ? Math.round((h.delivered || 0) / h.recipients * 100) : 0
          const openRate     = h.delivered  ? Math.round((h.opened    || 0) / h.delivered  * 100) : 0
          drawer({
            title:  'Broadcast-Details',
            width:  480,
            content: `
              <div style="display:flex;flex-direction:column;gap:18px;">
                <div>
                  <div class="form-label">Titel</div>
                  <div style="font-size:16px;font-weight:600;margin-top:4px;">${htmlEscape(h.title || '')}</div>
                </div>
                <div>
                  <div class="form-label">Nachricht</div>
                  <div style="margin-top:4px;line-height:1.5;">${htmlEscape(h.body || '')}</div>
                </div>
                ${h.deep_link ? `<div>
                  <div class="form-label">Deep-Link</div>
                  <code style="display:block;margin-top:4px;padding:8px;background:rgba(255,255,255,0.04);border-radius:6px;font-size:12px;word-break:break-all;">${htmlEscape(h.deep_link)}</code>
                </div>` : ''}
                <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;">
                  <div class="glass-card" style="padding:14px;text-align:center;">
                    <div style="font-size:11px;color:var(--text-muted,#8a8a93);text-transform:uppercase;margin-bottom:4px;">Empfänger</div>
                    <div style="font-size:22px;font-weight:600;">${fmtNumber(h.recipients || 0)}</div>
                  </div>
                  <div class="glass-card" style="padding:14px;text-align:center;">
                    <div style="font-size:11px;color:var(--text-muted,#8a8a93);text-transform:uppercase;margin-bottom:4px;">Zugestellt</div>
                    <div style="font-size:22px;font-weight:600;color:#34d399;">${fmtNumber(h.delivered || 0)}</div>
                    <div style="font-size:11px;color:var(--text-muted,#8a8a93);">${deliveryRate}%</div>
                  </div>
                  <div class="glass-card" style="padding:14px;text-align:center;">
                    <div style="font-size:11px;color:var(--text-muted,#8a8a93);text-transform:uppercase;margin-bottom:4px;">Geöffnet</div>
                    <div style="font-size:22px;font-weight:600;color:#fbbf24;">${fmtNumber(h.opened || 0)}</div>
                    <div style="font-size:11px;color:var(--text-muted,#8a8a93);">${openRate}%</div>
                  </div>
                </div>
                <div>
                  <div class="form-label">Audience</div>
                  <div style="margin-top:6px;"><span class="chip chip-soft">${htmlEscape(audienceLabel(h.audience))}</span></div>
                </div>
                ${h.actor_name ? `<div>
                  <div class="form-label">Versendet von</div>
                  <div style="margin-top:4px;">${htmlEscape(h.actor_name)}</div>
                </div>` : ''}
                <div>
                  <div class="form-label">Gesendet</div>
                  <div style="margin-top:4px;">${fmtDateTime(h.sent_at)}</div>
                </div>
              </div>
            `
          })
        }
      })
    }

    // toolbar
    container.querySelector('#btn-refresh').onclick = renderAll
    container.querySelector('#btn-pdf').onclick = () =>
      exportPanelAsPdf(container, { title: 'Push-Broadcasts' })
    container.querySelector('#btn-csv').onclick = async () => {
      const hist = await fetchHistory()
      exportCsv('push-broadcasts.csv', hist.map(h => ({
        sent_at:    h.sent_at,
        audience:   audienceLabel(h.audience),
        title:      h.title,
        body:       h.body,
        deep_link:  h.deep_link || '',
        recipients: h.recipients || 0,
        delivered:  h.delivered  || 0,
        opened:     h.opened     || 0,
        actor:      h.actor_name || ''
      })))
    }

    await renderAll()
  }
}
