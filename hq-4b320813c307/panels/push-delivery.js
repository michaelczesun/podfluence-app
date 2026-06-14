// Push-Zustellung — Monitor der Batch-Push-Queue (push_outbox).
// Zeigt: Status-Split, frische vs. verwaiste (stale) pending Rows, Versand 24h,
// Worker-Health (frische pending + kein recent sent = Cron/Worker tot), was
// haengt (pro kind) und Top-Fehler. Read-only. Daten: admin_push_outbox_stats().
// Die 2341 Backfill-Altlasten (08:32) sind als "stale" markiert und werden vom
// Worker dank Alters-Schranke (claim_push_outbox, 30min) NIE gesendet.
import { sb } from '/lib/supabase.js?v=20260610q'
import { fmtNumber, iconHtml, htmlEscape, toast } from '/lib/ui.js?v=20260610q'

function minsSince(iso) {
  if (!iso) return null
  return Math.round((Date.now() - new Date(iso).getTime()) / 60000)
}
function fmtAge(min) {
  if (min == null) return '—'
  if (min < 60) return `${min} min`
  if (min < 1440) return `${Math.round(min / 60)} h`
  return `${Math.round(min / 1440)} T`
}

function statTile(label, value, sub, accent) {
  return `<div class="stat-hero">
    <div class="stat-value"${accent ? ` style="color:${accent}"` : ''}>${value}</div>
    <div class="stat-label">${htmlEscape(label)}</div>
    ${sub ? `<div class="stat-label" style="opacity:.7">${htmlEscape(sub)}</div>` : ''}
  </div>`
}

function statusPill(status, n) {
  const map = {
    sent: ['#22C55E', 'rgba(34,197,94,.16)'],
    failed: ['#fca5a5', 'rgba(248,113,113,.16)'],
    pending: ['#fbbf24', 'rgba(251,191,36,.16)'],
    processing: ['#7C5CFF', 'rgba(124,92,255,.16)'],
  }
  const [c, bg] = map[status] || ['#9CA3AF', 'rgba(255,255,255,.08)']
  return `<div style="display:flex;align-items:center;gap:7px;padding:6px 12px;border-radius:10px;background:${bg}">
    <span style="font-size:11px;font-weight:600;color:${c};text-transform:uppercase;letter-spacing:.05em">${htmlEscape(status)}</span>
    <strong style="font-size:14px;color:#fff">${fmtNumber(n)}</strong></div>`
}

function barRows(items, key, color) {
  if (!items || !items.length) return '<div class="card-sub">Keine</div>'
  const max = Math.max(...items.map(i => i.count || 0), 1)
  return items.map(i => {
    const w = Math.max(2, Math.round(((i.count || 0) / max) * 100))
    return `<div style="margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">
        <span style="color:var(--text,#fff);font-family:'SF Mono',monospace">${htmlEscape(String(i[key] || '?'))}</span>
        <span style="color:var(--text-muted,#9CA3AF)">${fmtNumber(i.count || 0)}</span>
      </div>
      <div style="height:5px;border-radius:4px;background:rgba(255,255,255,0.06)">
        <div style="height:100%;width:${w}%;background:${color};border-radius:4px"></div>
      </div></div>`
  }).join('')
}

function render(container, d) {
  const st = d.by_status || {}
  const fresh = d.fresh_pending || 0
  const stale = d.stale_pending || 0
  const lastSentMin = minsSince(d.last_sent_at)
  const oldestMin = minsSince(d.oldest_pending)
  // Worker gilt als tot, wenn frische pending Rows liegen UND lange nichts gesendet wurde.
  const workerDown = fresh > 0 && (lastSentMin == null || lastSentMin > 5)
  const healthy = fresh === 0 || (lastSentMin != null && lastSentMin <= 5)

  container.innerHTML = `
    <div class="panel-head">
      <div class="panel-head-left">
        <div class="panel-title">Push-Zustellung</div>
        <div class="panel-sub">Batch-Queue push_outbox — Worker-Health &amp; Versand · Stand ${new Date(d.generated_at).toLocaleString('de-AT', { dateStyle: 'short', timeStyle: 'short' })}</div>
      </div>
      <button class="btn btn-ghost" id="pd-refresh">${iconHtml('refresh')} Aktualisieren</button>
    </div>

    ${workerDown ? `
      <div class="panel-section" style="border:1px solid rgba(239,68,68,.3);background:rgba(239,68,68,.07)">
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-size:22px">🚨</span>
          <div>
            <div style="font-size:14px;font-weight:700;color:#fca5a5">Worker offenbar tot</div>
            <div style="font-size:12px;color:var(--text-muted,#9CA3AF)">${fmtNumber(fresh)} frische Push(es) warten, letzter Versand vor ${fmtAge(lastSentMin)}. pg_cron-Job 'push-outbox-worker' prüfen (Migration 20260614030000).</div>
          </div>
        </div>
      </div>` : `
      <div class="panel-section" style="border:1px solid rgba(34,197,94,.25);background:rgba(34,197,94,.06)">
        <div style="font-size:13px;color:#4ade80">✓ Worker gesund — keine frischen Pushes gestaut${lastSentMin != null ? `, letzter Versand vor ${fmtAge(lastSentMin)}` : ''}.</div>
      </div>`}

    <div class="hero-row">
      ${statTile('Frisch wartend', fmtNumber(fresh), '<30 Min · Worker-Backlog', fresh > 0 ? '#fbbf24' : '#22C55E')}
      ${statTile('Versandt (24h)', fmtNumber(d.sent_24h || 0), `${fmtNumber(d.failed_24h || 0)} fehlgeschlagen`)}
      ${statTile('Verwaiste Altlast', fmtNumber(stale), 'alter Backfill, wird ignoriert', stale > 0 ? '#9CA3AF' : '#22C55E')}
      ${statTile('Queue gesamt', fmtNumber(d.total || 0), `ältester pending: ${fmtAge(oldestMin)}`)}
    </div>

    <div class="panel-section">
      <div class="card-header"><strong>Status</strong></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${Object.entries(st).map(([s, n]) => statusPill(s, n)).join('') || '<span class="card-sub">Queue leer</span>'}
      </div>
    </div>

    <div class="grid-2">
      <div class="panel-section">
        <div class="card-header"><strong>Wartend nach Typ</strong></div>
        ${barRows(d.pending_by_kind, 'kind', '#fbbf24')}
      </div>
      <div class="panel-section">
        <div class="card-header"><strong>Top-Fehler</strong></div>
        ${barRows(d.top_errors, 'error', '#EF4444')}
      </div>
    </div>

    ${stale > 0 ? `<div style="font-size:11.5px;color:var(--text-muted,#9CA3AF);padding:4px 2px">ℹ️ ${fmtNumber(stale)} verwaiste Rows (Backfill 14.6. 08:32) bleiben absichtlich liegen — die Alters-Schranke im Worker (30 Min) sendet sie nie. Bewusst nicht verworfen.</div>` : ''}
  `

  const btn = container.querySelector('#pd-refresh')
  if (btn) btn.addEventListener('click', () => load(container))
}

async function load(container) {
  container.innerHTML = `<div class="panel-section" style="text-align:center;padding:40px;color:var(--text-muted,#9CA3AF)">Lädt Push-Zustellungs-Daten…</div>`
  try {
    const { data, error } = await sb.rpc('admin_push_outbox_stats')
    if (error) throw error
    if (!data) throw new Error('Keine Daten')
    render(container, data)
  } catch (e) {
    console.error('[push-delivery]', e)
    const msg = (e && e.message) || 'Fehler'
    container.innerHTML = `<div class="panel-section" style="text-align:center;padding:40px;color:#EF4444">
      Push-Zustellungs-Daten konnten nicht geladen werden.<br><span style="font-size:12px;color:var(--text-muted,#9CA3AF)">${htmlEscape(msg)}</span><br>
      <span style="font-size:11px;color:var(--text-muted,#9CA3AF)">(Migration 20260614030000 deployt?)</span></div>`
    toast('Push-Panel: ' + msg, 'error')
  }
}

export default {
  id: 'push-delivery',
  title: 'Push-Zustellung',
  icon: 'bell',
  async mount(container) {
    await load(container)
  }
}
