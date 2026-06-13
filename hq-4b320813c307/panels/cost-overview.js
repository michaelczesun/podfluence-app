// Kosten & Free-Tier — Michael 13.6.: "im CRM sehen wieviele Leute es nutzen,
// die Kosten, und wieviel vom Free-Tier ueberall noch frei ist".
// Daten: RPC admin_cost_overview() (admin-gated, SECURITY DEFINER) liefert User,
// DB-Groesse, Storage pro Bucket, groesste Tabellen, Groq- + Render-Nutzung.
// Die statischen Limits + Preise stehen hier (nicht serverseitig abfragbar).
import { sb } from '/lib/supabase.js?v=20260610q'
import { fmtNumber, iconHtml, htmlEscape, toast } from '/lib/ui.js?v=20260610q'

// --- Statische Limits / Preise (Stand 13.6.26) ---
const GB = 1024 * 1024 * 1024
const LIMITS = {
  supaDb: 8 * GB,        // Supabase Pro: 8 GB DB inklusive, danach Overage
  supaStorage: 100 * GB, // Supabase Pro: 100 GB Storage inklusive
  supaEgress: 250 * GB,  // Supabase Pro: 250 GB Egress/Monat
  groqDaily: 2000,       // Groq Free-Tier: 2.000 Whisper-Requests/Tag
  cloudRunVideosMo: 5400 // Cloud Run Free-Tier reicht fuer ~5.400 Videos/Monat
}
// Fixkosten pro Monat (USD). EAS-Builds sind pay-as-you-go (nicht abfragbar).
const COSTS = [
  { name: 'Supabase Pro', usd: 25, note: 'Basis (DB, Storage, Auth, Realtime)' },
  { name: 'Groq Whisper', usd: 0, note: 'Free-Tier, 2.000/Tag' },
  { name: 'Cloud Run (Audiogramm-Video)', usd: 0, note: 'Free-Tier' },
  { name: 'Sentry', usd: 0, note: 'Free-Tier' },
  { name: 'EAS Builds', usd: null, note: 'pay-as-you-go, Reset Monatserster' }
]

function fmtBytes(n) {
  if (!n || n < 0) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0, v = n
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${u[i]}`
}
function pct(used, total) {
  if (!total) return 0
  return Math.min(100, Math.round((used / total) * 1000) / 10)
}
function barColor(p) {
  if (p >= 85) return '#EF4444'
  if (p >= 60) return '#F59E0B'
  return '#22C55E'
}

function statTile(label, value, sub) {
  return `<div class="stat-hero">
    <div class="stat-value">${value}</div>
    <div class="stat-label">${htmlEscape(label)}</div>
    ${sub ? `<div class="stat-label" style="opacity:.7">${htmlEscape(sub)}</div>` : ''}
  </div>`
}

function meter(label, usedText, p, freeText) {
  const col = barColor(p)
  return `<div style="margin-bottom:14px">
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:5px">
      <span style="font-size:13px;color:var(--text,#fff)">${htmlEscape(label)}</span>
      <span style="font-size:12px;color:var(--text-muted,#9CA3AF)">${htmlEscape(usedText)}</span>
    </div>
    <div style="height:8px;border-radius:6px;background:rgba(255,255,255,0.08);overflow:hidden">
      <div style="height:100%;width:${p}%;background:${col};border-radius:6px"></div>
    </div>
    <div style="display:flex;justify-content:space-between;margin-top:4px">
      <span style="font-size:11px;color:${col};font-weight:600">${p}% genutzt</span>
      <span style="font-size:11px;color:var(--text-muted,#9CA3AF)">${htmlEscape(freeText)}</span>
    </div>
  </div>`
}

function breakdownRows(items, totalBytes) {
  if (!items || !items.length) return '<div class="card-sub">Keine Daten</div>'
  const max = Math.max(...items.map(i => i.bytes || 0), 1)
  return items.map(i => {
    const w = Math.max(2, Math.round(((i.bytes || 0) / max) * 100))
    const label = i.bucket || i.name || '—'
    const extra = i.objects != null ? ` · ${fmtNumber(i.objects)} Obj.` : ''
    return `<div style="margin-bottom:9px">
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">
        <span style="color:var(--text,#fff)">${htmlEscape(label)}</span>
        <span style="color:var(--text-muted,#9CA3AF)">${fmtBytes(i.bytes || 0)}${extra}</span>
      </div>
      <div style="height:5px;border-radius:4px;background:rgba(255,255,255,0.06)">
        <div style="height:100%;width:${w}%;background:#7C5CFF;border-radius:4px"></div>
      </div>
    </div>`
  }).join('')
}

function render(container, d) {
  const monthly = COSTS.reduce((s, c) => s + (c.usd || 0), 0)
  const costRows = COSTS.map(c => `
    <div style="display:flex;justify-content:space-between;align-items:baseline;padding:7px 0;border-bottom:1px solid rgba(255,255,255,0.05)">
      <div><div style="font-size:13px;color:var(--text,#fff)">${htmlEscape(c.name)}</div>
      <div style="font-size:11px;color:var(--text-muted,#9CA3AF)">${htmlEscape(c.note)}</div></div>
      <div style="font-size:14px;font-weight:700;color:${c.usd ? 'var(--text,#fff)' : '#22C55E'}">${c.usd == null ? 'variabel' : c.usd === 0 ? '0 $' : '$' + c.usd}</div>
    </div>`).join('')

  const dbP = pct(d.db_size_bytes, LIMITS.supaDb)
  const stP = pct(d.storage_bytes, LIMITS.supaStorage)
  const grP = pct(d.whisper_today, LIMITS.groqDaily)
  const crP = pct(d.render_jobs_30d, LIMITS.cloudRunVideosMo)

  container.innerHTML = `
    <div class="panel-head">
      <div class="panel-head-left">
        <div class="panel-title">Kosten & Free-Tier</div>
        <div class="panel-sub">Wer nutzt es, was kostet es, wieviel ist noch frei — Stand ${new Date(d.generated_at).toLocaleString('de-AT', { dateStyle: 'short', timeStyle: 'short' })}</div>
      </div>
      <button class="btn btn-ghost" id="cost-refresh">${iconHtml('refresh')} Aktualisieren</button>
    </div>

    <div class="hero-row">
      ${statTile('User gesamt', fmtNumber(d.users_total), `${fmtNumber(d.users_verified)} verifiziert`)}
      ${statTile('Aktiv (30 Tage)', fmtNumber(d.active_30d), `${fmtNumber(d.signups_7d)} neu (7 T)`)}
      ${statTile('Premium', fmtNumber(d.users_premium), 'zahlende User')}
      ${statTile('Podcasts', fmtNumber(d.podcasts_total), `${fmtNumber(d.posts_total)} Beiträge`)}
    </div>

    <div class="grid-2">
      <div class="panel-section">
        <div class="card-header"><strong>Free-Tier Auslastung</strong></div>
        ${meter('Supabase DB (Pro: 8 GB inkl.)', `${fmtBytes(d.db_size_bytes)} / 8 GB`, dbP, `${fmtBytes(LIMITS.supaDb - d.db_size_bytes)} frei`)}
        ${meter('Supabase Storage (Pro: 100 GB inkl.)', `${fmtBytes(d.storage_bytes)} / 100 GB`, stP, `${fmtBytes(LIMITS.supaStorage - d.storage_bytes)} frei`)}
        ${meter('Groq Whisper (heute)', `${fmtNumber(d.whisper_today)} / ${fmtNumber(LIMITS.groqDaily)} Anfragen`, grP, `${fmtNumber(LIMITS.groqDaily - d.whisper_today)} heute frei`)}
        ${meter('Cloud Run Videos (30 Tage)', `${fmtNumber(d.render_jobs_30d)} / ~${fmtNumber(LIMITS.cloudRunVideosMo)} Videos`, crP, `Free-Tier reicht locker`)}
      </div>

      <div class="panel-section">
        <div class="card-header"><strong>Laufende Kosten / Monat</strong></div>
        ${costRows}
        <div style="display:flex;justify-content:space-between;align-items:baseline;padding-top:10px;margin-top:4px">
          <span style="font-size:14px;font-weight:600;color:var(--text,#fff)">Fix-Summe</span>
          <span style="font-size:20px;font-weight:800;color:var(--text,#fff)">~$${monthly}/Mon</span>
        </div>
        <div style="font-size:11px;color:var(--text-muted,#9CA3AF);margin-top:6px">+ EAS-Builds nach Bedarf (pay-as-you-go). Groq, Cloud Run, Sentry laufen im Free-Tier.</div>
      </div>
    </div>

    <div class="grid-2">
      <div class="panel-section">
        <div class="card-header"><strong>Storage pro Bucket</strong><span class="card-sub">${fmtBytes(d.storage_bytes)} · ${fmtNumber(d.storage_objects)} Objekte</span></div>
        ${breakdownRows(d.storage_by_bucket)}
      </div>
      <div class="panel-section">
        <div class="card-header"><strong>Größte Tabellen</strong><span class="card-sub">DB ${fmtBytes(d.db_size_bytes)}</span></div>
        ${breakdownRows(d.top_tables)}
      </div>
    </div>
  `

  const btn = container.querySelector('#cost-refresh')
  if (btn) btn.addEventListener('click', () => load(container))
}

async function load(container) {
  container.innerHTML = `<div class="panel-section" style="text-align:center;padding:40px;color:var(--text-muted,#9CA3AF)">Lädt Kosten- und Nutzungsdaten…</div>`
  try {
    const { data, error } = await sb.rpc('admin_cost_overview')
    if (error) throw error
    if (!data) throw new Error('Keine Daten')
    render(container, data)
  } catch (e) {
    console.error('[cost-overview]', e)
    const msg = (e && e.message) || 'Fehler'
    container.innerHTML = `<div class="panel-section" style="text-align:center;padding:40px;color:#EF4444">
      Kosten-Daten konnten nicht geladen werden.<br><span style="font-size:12px;color:var(--text-muted,#9CA3AF)">${htmlEscape(msg)}</span></div>`
    toast('Kosten-Panel: ' + msg, 'error')
  }
}

export default {
  id: 'cost-overview',
  title: 'Kosten & Free-Tier',
  icon: 'bar-chart',
  async mount(container) {
    await load(container)
  }
}
