// Event-Moderation — spiegelt die App-Admin-Events ins CRM (app/admin/events.tsx).
// Listet podcast_events (pending/alle), Freigeben/Ablehnen/Zurückziehen via publish_event RPC.
// Direkter Tabellenzugriff (RLS gated Admins). Tabelle: podcast_events.
import { sb } from '/lib/supabase.js?v=20260610q'
import { fmtNumber, iconHtml, htmlEscape, fmtDateTime, toast } from '/lib/ui.js?v=20260610q'

let _filter = 'pending' // 'pending' | 'all'

async function fetchData() {
  let q = sb.from('podcast_events')
    .select('id, title, description, starts_at, ends_at, is_virtual, location, location_url, ticket_url, cover_image, is_published, rejected_reason, event_type, host:users!podcast_events_host_user_id_fkey(id, username, full_name, is_verified)')
    .order('created_at', { ascending: false })
    .limit(200)
  if (_filter === 'pending') q = q.eq('is_published', false)
  const { data, error } = await q
  if (error) throw error
  const rows = (data || []).map(r => ({ ...r, host: Array.isArray(r.host) ? r.host[0] : r.host }))
  // Pending-Count separat (für Hero, unabhängig vom Filter)
  let pending = 0
  try {
    const { count } = await sb.from('podcast_events').select('id', { count: 'exact', head: true }).eq('is_published', false)
    pending = count || 0
  } catch (_) {}
  return { rows, pending }
}

function card(e) {
  const host = e.host || {}
  const when = e.starts_at ? fmtDateTime(e.starts_at) : '—'
  const loc = e.is_virtual ? `🌐 Online${e.location ? ' · ' + htmlEscape(e.location) : ''}` : `📍 ${htmlEscape(e.location || '—')}`
  const cover = e.cover_image
    ? `<img src="${htmlEscape(e.cover_image)}" alt="" style="width:64px;height:64px;border-radius:10px;object-fit:cover;flex-shrink:0;background:rgba(255,255,255,.05)">`
    : `<div style="width:64px;height:64px;border-radius:10px;background:rgba(124,92,255,.12);display:flex;align-items:center;justify-content:center;flex-shrink:0">${iconHtml('calendar') || '📅'}</div>`
  const link = e.location_url || e.ticket_url
  return `<div class="panel-section" style="margin-bottom:10px" data-event="${htmlEscape(e.id)}">
    <div style="display:flex;gap:12px">
      ${cover}
      <div style="min-width:0;flex:1">
        <div style="font-size:14px;color:var(--text,#fff);font-weight:700;line-height:1.3">${htmlEscape(e.title || '—')}</div>
        <div style="font-size:12px;color:var(--text-muted,#9CA3AF);margin-top:3px">${htmlEscape(when)}</div>
        <div style="font-size:12px;color:var(--text-muted,#9CA3AF)">${loc}</div>
        <div style="font-size:11.5px;color:var(--text-muted,#9CA3AF);margin-top:2px">von ${host.full_name ? htmlEscape(host.full_name) : '@' + htmlEscape(host.username || '?')}${host.is_verified ? ' <span style="color:#22C55E">✓</span>' : ''}${e.event_type ? ` · ${htmlEscape(e.event_type)}` : ''}</div>
        ${link ? `<div style="font-size:11px;color:#7C5CFF;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px">→ ${htmlEscape(link)}</div>` : ''}
        ${e.rejected_reason ? `<div style="font-size:11px;color:#f87171;margin-top:2px">Abgelehnt: ${htmlEscape(e.rejected_reason)}</div>` : ''}
      </div>
      <div style="flex-shrink:0">${e.is_published ? '<span style="font-size:10.5px;padding:3px 9px;border-radius:999px;background:rgba(34,197,94,.16);color:#22C55E">Freigegeben</span>' : '<span style="font-size:10.5px;padding:3px 9px;border-radius:999px;background:rgba(245,158,11,.16);color:#F59E0B">Pending</span>'}</div>
    </div>
    <div style="display:flex;gap:8px;margin-top:11px">
      ${e.is_published
        ? `<button class="btn btn-ghost" data-act="withdraw" style="padding:6px 13px;font-size:12.5px;color:#EF4444">Zurückziehen</button>`
        : `<button class="btn" data-act="publish" style="padding:6px 14px;font-size:12.5px;background:#22C55E;color:#fff;border:none">Freigeben</button>
           <button class="btn btn-ghost" data-act="reject" style="padding:6px 13px;font-size:12.5px;color:#EF4444">Ablehnen</button>`}
    </div>
  </div>`
}

function render(container, d) {
  container.innerHTML = `
    <div class="panel-head">
      <div class="panel-head-left">
        <div class="panel-title">Event-Moderation</div>
        <div class="panel-sub">Veranstaltungen freigeben — wie in der App-Admin, jetzt im CRM</div>
      </div>
      <div style="display:flex;gap:8px"><button class="btn btn-ghost" id="ev-refresh">${iconHtml('refresh')}</button></div>
    </div>

    <div class="hero-row">
      <div class="stat-hero"><div class="stat-value" style="color:${d.pending ? '#F59E0B' : '#22C55E'}">${fmtNumber(d.pending)}</div><div class="stat-label">pending</div></div>
    </div>

    <div style="display:flex;gap:8px;margin:4px 0 14px">
      <button class="btn ${_filter === 'pending' ? '' : 'btn-ghost'}" id="ev-tab-pending" style="${_filter === 'pending' ? 'background:#7C5CFF;color:#fff;border:none' : ''}">Pending</button>
      <button class="btn ${_filter === 'all' ? '' : 'btn-ghost'}" id="ev-tab-all" style="${_filter === 'all' ? 'background:#7C5CFF;color:#fff;border:none' : ''}">Alle</button>
    </div>

    ${d.rows.length ? d.rows.map(card).join('') : `<div class="panel-section" style="text-align:center;padding:34px;color:var(--text-muted,#9CA3AF)">${_filter === 'pending' ? 'Nichts zu moderieren. 🎉' : 'Keine Events.'}</div>`}
  `

  container.querySelector('#ev-refresh')?.addEventListener('click', () => load(container))
  container.querySelector('#ev-tab-pending')?.addEventListener('click', () => { _filter = 'pending'; load(container) })
  container.querySelector('#ev-tab-all')?.addEventListener('click', () => { _filter = 'all'; load(container) })

  container.querySelectorAll('[data-event]').forEach(el => {
    const id = el.getAttribute('data-event')
    const e = d.rows.find(x => String(x.id) === id)
    el.querySelector('[data-act="publish"]')?.addEventListener('click', () => action(container, e, true))
    el.querySelector('[data-act="reject"]')?.addEventListener('click', () => action(container, e, false))
    el.querySelector('[data-act="withdraw"]')?.addEventListener('click', () => action(container, e, false))
  })
}

async function action(container, e, publish) {
  let reason = null
  if (!publish) {
    reason = window.prompt('Grund (optional, sichtbar für Host):', 'Manuell abgelehnt')
    if (reason === null) return // abgebrochen
  }
  try {
    const { error } = await sb.rpc('publish_event', { p_event_id: e.id, p_publish: publish, p_reason: reason || null })
    if (error) throw error
    toast(publish ? 'Event freigegeben' : 'Event abgelehnt/zurückgezogen', 'success')
    await load(container)
  } catch (err) { toast('Aktion fehlgeschlagen: ' + (err?.message || err), 'error') }
}

async function load(container) {
  container.innerHTML = `<div class="panel-section" style="text-align:center;padding:40px;color:var(--text-muted,#9CA3AF)">Lädt Events…</div>`
  try {
    render(container, await fetchData())
  } catch (e) {
    console.error('[events]', e)
    const msg = (e && e.message) || 'Fehler'
    container.innerHTML = `<div class="panel-section" style="text-align:center;padding:40px;color:#EF4444">
      Events konnten nicht geladen werden.<br><span style="font-size:12px;color:var(--text-muted,#9CA3AF)">${htmlEscape(msg)}</span></div>`
    toast('Events: ' + msg, 'error')
  }
}

export default {
  id: 'events',
  title: 'Event-Moderation',
  icon: 'calendar',
  async mount(container) {
    _filter = 'pending'
    await load(container)
  }
}
