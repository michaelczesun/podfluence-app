// KI-Usage — net-new CRM-Wert (kein App-Spiegel). Whisper/Groq-Nutzung + Quota-Headroom
// + Transkript-Cache + Cleanup. Adressiert Michaels Groq-Quota-Schmerz (ASPD-Limit,
// "KI nicht erreichbar"). RPCs: admin_ai_usage_overview, admin_purge_whisper_cache.
import { sb } from '/lib/supabase.js?v=20260610q'
import { fmtNumber, iconHtml, htmlEscape, fmtRelativeTime, toast } from '/lib/ui.js?v=20260610q'

async function fetchData() {
  const { data, error } = await sb.rpc('admin_ai_usage_overview')
  if (error) throw error
  return data || {}
}

function bar7(days) {
  const max = Math.max(1, ...days.map(d => d.count))
  return `<div style="display:flex;align-items:flex-end;gap:6px;height:90px;margin-top:6px">
    ${days.map(d => {
      const h = Math.round((d.count / max) * 78) + 2
      const lbl = d.day.slice(5) // MM-DD
      return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px">
        <div style="font-size:10px;color:var(--text-muted,#9CA3AF)">${d.count}</div>
        <div style="width:100%;height:${h}px;border-radius:5px 5px 0 0;background:linear-gradient(180deg,#7C5CFF,#5B3Fd1)"></div>
        <div style="font-size:9.5px;color:var(--text-muted,#9CA3AF)">${htmlEscape(lbl)}</div>
      </div>`
    }).join('')}
  </div>`
}

function render(container, d) {
  const today = Number(d.today_requests || 0)
  const reqLimit = Number(d.groq_req_per_day || 2000)
  const aspd = Number(d.groq_audio_sec_per_day || 28800)
  const reqPct = Math.min(100, Math.round((today / reqLimit) * 100))
  const cacheTotal = Number(d.cache_total || 0)
  const freeLimit = d.free_daily_limit != null ? Number(d.free_daily_limit) : null
  const perUser = Array.isArray(d.per_user_today) ? d.per_user_today : []
  const last7 = Array.isArray(d.last_7_days) ? d.last_7_days : []
  // Heaviest user heute (Quota-Burn-Warnung)
  const top = perUser[0]
  const burnWarn = top && Number(top.count) >= 8

  container.innerHTML = `
    <div class="panel-head">
      <div class="panel-head-left">
        <div class="panel-title">KI-Usage (Whisper/Groq)</div>
        <div class="panel-sub">Transkriptions-Nutzung, Quota-Headroom + Cache — net-new im CRM</div>
      </div>
      <div style="display:flex;gap:8px"><button class="btn btn-ghost" id="ai-refresh">${iconHtml('refresh')}</button></div>
    </div>

    <div class="hero-row">
      <div class="stat-hero"><div class="stat-value">${fmtNumber(today)}</div><div class="stat-label">Transkriptionen heute</div></div>
      <div class="stat-hero"><div class="stat-value" style="color:${reqPct > 80 ? '#EF4444' : reqPct > 50 ? '#F59E0B' : '#22C55E'}">${reqPct}%</div><div class="stat-label">von ${fmtNumber(reqLimit)} Req/Tag</div></div>
      <div class="stat-hero"><div class="stat-value">${fmtNumber(cacheTotal)}</div><div class="stat-label">cached (Hits gratis)</div></div>
      <div class="stat-hero"><div class="stat-value">${freeLimit != null ? freeLimit : '—'}</div><div class="stat-label">Free-Limit/Tag/User</div></div>
    </div>

    ${burnWarn ? `<div class="panel-section" style="border:1px solid rgba(245,158,11,.35);background:rgba(245,158,11,.06)">
      <div style="font-size:13px;color:#F59E0B">⚠️ <strong>@${htmlEscape(top.username)}</strong> hat heute ${fmtNumber(top.count)} Transkriptionen ausgelöst — auf Quota-Burn achten (Groq-ASPD ${fmtNumber(aspd)} Audio-Sek/Tag, NICHT bulk re-transkribieren).</div>
    </div>` : ''}

    <div class="panel-section">
      <div class="card-header"><strong>Echte Groq-Requests (Cache-Hits zählen NICHT)</strong></div>
      <div style="margin-top:8px">
        <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-muted,#9CA3AF);margin-bottom:5px">
          <span>Heute: ${fmtNumber(today)}</span><span>Limit: ${fmtNumber(reqLimit)}/Tag</span>
        </div>
        <div style="height:9px;border-radius:999px;background:rgba(255,255,255,.07);overflow:hidden">
          <div style="height:100%;width:${reqPct}%;background:${reqPct > 80 ? '#EF4444' : reqPct > 50 ? '#F59E0B' : '#22C55E'}"></div>
        </div>
        <div style="font-size:11px;color:var(--text-muted,#9CA3AF);margin-top:6px">Gestern: ${fmtNumber(d.yesterday_requests || 0)} · Zweites hartes Groq-Limit: <strong>${fmtNumber(aspd)} Audio-Sekunden/Tag (ASPD)</strong> — app-seitig nicht gezählt, daher nie bulk re-transkribieren.</div>
      </div>
    </div>

    <div class="panel-section">
      <div class="card-header"><strong>7-Tage-Trend</strong></div>
      ${last7.length ? bar7(last7) : '<div class="card-sub" style="padding:14px;text-align:center">Keine Daten.</div>'}
    </div>

    <div class="panel-section">
      <div class="card-header"><strong>Top-Nutzer heute</strong></div>
      ${perUser.length ? perUser.slice(0, 12).map(u => `<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid rgba(255,255,255,0.05)">
        <span style="font-size:13px;color:var(--text,#fff)">@${htmlEscape(u.username)}${u.full_name ? ` <span style="color:var(--text-muted,#9CA3AF);font-size:11px">${htmlEscape(u.full_name)}</span>` : ''}</span>
        <span style="font-size:13px;font-weight:700;color:${Number(u.count) >= 8 ? '#F59E0B' : 'var(--text,#fff)'}">${fmtNumber(u.count)}</span>
      </div>`).join('') : '<div class="card-sub" style="padding:14px;text-align:center">Heute noch keine KI-Nutzung.</div>'}
    </div>

    <div class="panel-section">
      <div class="card-header"><strong>Transkript-Cache</strong></div>
      <div class="card-sub" style="margin:6px 0">
        ${fmtNumber(cacheTotal)} Einträge${d.cache_oldest ? ` · ältester ${htmlEscape(fmtRelativeTime(d.cache_oldest))}` : ''}${d.cache_newest ? ` · neuester ${htmlEscape(fmtRelativeTime(d.cache_newest))}` : ''}.
        Jeder Cache-Hit spart einen Groq-Call (gratis).
      </div>
      <button class="btn btn-ghost" id="ai-purge" style="color:#EF4444">Cache-Einträge älter als 90 Tage löschen</button>
    </div>
  `

  container.querySelector('#ai-refresh')?.addEventListener('click', () => load(container))
  container.querySelector('#ai-purge')?.addEventListener('click', () => purge(container))
}

async function purge(container) {
  if (!window.confirm('Alle Transkript-Cache-Einträge älter als 90 Tage löschen? (Spart Storage, kostet beim nächsten Abspielen 1 Groq-Call pro betroffener Episode.)')) return
  try {
    const { data, error } = await sb.rpc('admin_purge_whisper_cache', { p_older_than_days: 90 })
    if (error) throw error
    toast(`${Number(data) || 0} Cache-Einträge gelöscht`, 'success')
    await load(container)
  } catch (e) { toast('Cache-Purge fehlgeschlagen: ' + (e?.message || e), 'error') }
}

async function load(container) {
  container.innerHTML = `<div class="panel-section" style="text-align:center;padding:40px;color:var(--text-muted,#9CA3AF)">Lädt KI-Usage…</div>`
  try {
    render(container, await fetchData())
  } catch (e) {
    console.error('[ai-usage]', e)
    const msg = (e && e.message) || 'Fehler'
    container.innerHTML = `<div class="panel-section" style="text-align:center;padding:40px;color:#EF4444">
      KI-Usage konnte nicht geladen werden.<br><span style="font-size:12px;color:var(--text-muted,#9CA3AF)">${htmlEscape(msg)}</span></div>`
    toast('KI-Usage: ' + msg, 'error')
  }
}

export default {
  id: 'ai-usage',
  title: 'KI-Usage',
  icon: 'activity',
  async mount(container) {
    await load(container)
  }
}
