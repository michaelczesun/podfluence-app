// Moderation — spiegelt die App-Admin-Meldungen ins CRM (app/admin/moderation.tsx,
// lib/moderation.ts). Offene/erledigte Meldungen, angereichert mit Melder + Ziel-Inhalt,
// Aktionen Verwerfen / Verbergen / Nutzer sperren. Direkter Tabellenzugriff (RLS gated Admins).
// Tabellen: reports, updates, comments, voice_comments, users.
import { sb } from '/lib/supabase.js?v=20260610q'
import { fmtNumber, iconHtml, htmlEscape, fmtRelativeTime, toast } from '/lib/ui.js?v=20260610q'

let _status = 'open' // 'open' | 'reviewed'

const TARGET_LABEL = {
  user: 'Nutzer', update: 'Beitrag', comment: 'Kommentar',
  chat_message: 'Chat', voice_comment: 'Sprachnachricht',
}
const STATUS_BADGE = {
  open: ['#F59E0B', 'Offen'], dismissed: ['#9CA3AF', 'Verworfen'],
  hidden: ['#EF4444', 'Verborgen'], suspended: ['#EF4444', 'Gesperrt'],
}

function truncate(t, max = 140) {
  if (!t) return ''
  const s = String(t).trim()
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

// Port von lib/moderation.ts fetchOpenReports — Meldungen + Melder + Ziel-Kontext.
async function fetchData() {
  let q = sb.from('reports').select('*').order('created_at', { ascending: false }).limit(100)
  q = _status === 'open' ? q.eq('status', 'open') : q.neq('status', 'open')
  const { data: reports, error } = await q
  if (error) throw error
  const rows = reports || []
  if (!rows.length) return { rows: [], openCount: await openCount() }

  // Melder
  const reporterIds = [...new Set(rows.map(r => r.reporter_id).filter(Boolean))]
  const reporterMap = new Map()
  if (reporterIds.length) {
    const { data } = await sb.from('users').select('id, username, full_name').in('id', reporterIds)
    for (const u of (data || [])) reporterMap.set(u.id, u)
  }

  // Ziel-IDs nach Typ gruppieren
  const byType = { user: [], update: [], comment: [], chat_message: [], voice_comment: [] }
  for (const r of rows) if (r.target_id && byType[r.target_type]) byType[r.target_type].push(r.target_id)

  const updateMap = new Map(), commentMap = new Map(), voiceMap = new Map(), chatMap = new Map()
  if (byType.update.length) {
    const { data } = await sb.from('updates').select('id, content, user_id, is_hidden').in('id', byType.update)
    for (const u of (data || [])) updateMap.set(u.id, u)
  }
  if (byType.comment.length) {
    const { data } = await sb.from('comments').select('id, content, user_id, is_hidden').in('id', byType.comment)
    for (const c of (data || [])) commentMap.set(c.id, c)
  }
  if (byType.voice_comment.length) {
    try {
      const { data } = await sb.from('voice_comments').select('id, duration_sec, user_id').in('id', byType.voice_comment)
      for (const v of (data || [])) voiceMap.set(v.id, v)
    } catch (_) {}
  }
  if (byType.chat_message.length) {
    try {
      const { data } = await sb.from('chat_messages').select('id, content, user_id').in('id', byType.chat_message)
      for (const m of (data || [])) chatMap.set(m.id, m)
    } catch (_) {}
  }

  // Autoren
  const authorIds = new Set(byType.user)
  for (const v of updateMap.values()) if (v.user_id) authorIds.add(v.user_id)
  for (const v of commentMap.values()) if (v.user_id) authorIds.add(v.user_id)
  for (const v of voiceMap.values()) if (v.user_id) authorIds.add(v.user_id)
  for (const v of chatMap.values()) if (v.user_id) authorIds.add(v.user_id)
  const authorMap = new Map()
  if (authorIds.size) {
    const { data } = await sb.from('users').select('id, username, full_name, is_suspended').in('id', [...authorIds])
    for (const u of (data || [])) authorMap.set(u.id, u)
  }

  const enriched = rows.map(r => {
    let preview = '', authorId = null, hidden = false
    if (r.target_type === 'update') { const u = updateMap.get(r.target_id); preview = truncate(u?.content); authorId = u?.user_id || null; hidden = !!u?.is_hidden }
    else if (r.target_type === 'comment') { const c = commentMap.get(r.target_id); preview = truncate(c?.content); authorId = c?.user_id || null; hidden = !!c?.is_hidden }
    else if (r.target_type === 'voice_comment') { const v = voiceMap.get(r.target_id); preview = v ? `Sprachnachricht · ${v.duration_sec || 0}s` : 'Sprachnachricht'; authorId = v?.user_id || null }
    else if (r.target_type === 'chat_message') { const m = chatMap.get(r.target_id); preview = truncate(m?.content); authorId = m?.user_id || null }
    else if (r.target_type === 'user') { const a = authorMap.get(r.target_id); preview = a?.full_name || a?.username || '(unbekannt)'; authorId = r.target_id }
    const author = authorId ? authorMap.get(authorId) : null
    return {
      ...r,
      reporter: reporterMap.get(r.reporter_id) || null,
      preview: preview || '(kein Inhalt)',
      author_username: author?.username || null,
      author_id: authorId,
      author_suspended: !!author?.is_suspended,
      content_hidden: hidden,
    }
  })
  return { rows: enriched, openCount: await openCount() }
}

async function openCount() {
  try {
    const { count } = await sb.from('reports').select('id', { count: 'exact', head: true }).eq('status', 'open')
    return count || 0
  } catch (_) { return 0 }
}

function card(r) {
  const [sc, sl] = STATUS_BADGE[r.status] || ['#9CA3AF', r.status]
  const tl = TARGET_LABEL[r.target_type] || r.target_type
  const canHide = (r.target_type === 'update' || r.target_type === 'comment' || r.target_type === 'voice_comment') && !r.content_hidden
  return `<div class="panel-section" style="margin-bottom:10px" data-report="${htmlEscape(r.id)}">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:7px;flex-wrap:wrap">
      <span style="font-size:10.5px;padding:2px 8px;border-radius:999px;background:rgba(255,255,255,.07);color:var(--text-muted,#9CA3AF)">${htmlEscape(tl)}</span>
      <span style="font-size:10.5px;padding:2px 8px;border-radius:999px;background:${sc}22;color:${sc}">${htmlEscape(sl)}</span>
      ${r.content_hidden ? '<span style="font-size:10.5px;padding:2px 8px;border-radius:999px;background:rgba(239,68,68,.14);color:#f87171">bereits verborgen</span>' : ''}
      ${r.author_suspended ? '<span style="font-size:10.5px;padding:2px 8px;border-radius:999px;background:rgba(239,68,68,.14);color:#f87171">Autor gesperrt</span>' : ''}
      <span style="margin-left:auto;font-size:11px;color:var(--text-muted,#9CA3AF)">${htmlEscape(fmtRelativeTime(r.created_at))}</span>
    </div>
    <div style="font-size:13.5px;color:var(--text,#fff);line-height:1.45;background:rgba(255,255,255,.03);border-radius:8px;padding:9px 11px">${htmlEscape(r.preview)}</div>
    <div style="font-size:11.5px;color:var(--text-muted,#9CA3AF);margin-top:7px">
      ${r.author_username ? `Autor: <strong style="color:#b9a6ff">@${htmlEscape(r.author_username)}</strong> · ` : ''}Gemeldet von ${r.reporter ? '@' + htmlEscape(r.reporter.username || '?') : 'unbekannt'}${r.reason ? ` · Grund: „${htmlEscape(r.reason)}"` : ''}
    </div>
    ${r.status === 'open' ? `<div style="display:flex;gap:8px;margin-top:11px;flex-wrap:wrap">
      <button class="btn btn-ghost" data-act="dismiss" style="padding:6px 13px;font-size:12.5px">Verwerfen</button>
      ${canHide ? `<button class="btn btn-ghost" data-act="hide" style="padding:6px 13px;font-size:12.5px;color:#F59E0B">Inhalt verbergen</button>` : ''}
      ${r.author_id && !r.author_suspended ? `<button class="btn btn-ghost" data-act="suspend" style="padding:6px 13px;font-size:12.5px;color:#EF4444">Nutzer sperren</button>` : ''}
    </div>` : ''}
  </div>`
}

function render(container, d) {
  container.innerHTML = `
    <div class="panel-head">
      <div class="panel-head-left">
        <div class="panel-title">Moderation</div>
        <div class="panel-sub">Gemeldete Inhalte prüfen — wie in der App-Admin, jetzt im CRM</div>
      </div>
      <div style="display:flex;gap:8px"><button class="btn btn-ghost" id="mod-refresh">${iconHtml('refresh')}</button></div>
    </div>

    <div class="hero-row">
      <div class="stat-hero"><div class="stat-value" style="color:${d.openCount ? '#F59E0B' : '#22C55E'}">${fmtNumber(d.openCount)}</div><div class="stat-label">offen</div></div>
    </div>

    <div style="display:flex;gap:8px;margin:4px 0 14px">
      <button class="btn ${_status === 'open' ? '' : 'btn-ghost'}" id="mod-tab-open" style="${_status === 'open' ? 'background:#7C5CFF;color:#fff;border:none' : ''}">Offen</button>
      <button class="btn ${_status === 'reviewed' ? '' : 'btn-ghost'}" id="mod-tab-rev" style="${_status === 'reviewed' ? 'background:#7C5CFF;color:#fff;border:none' : ''}">Erledigt</button>
    </div>

    ${d.rows.length ? d.rows.map(card).join('') : `<div class="panel-section" style="text-align:center;padding:34px;color:var(--text-muted,#9CA3AF)">${_status === 'open' ? 'Keine offenen Meldungen — alles sauber. ✓' : 'Keine erledigten Meldungen.'}</div>`}
  `

  container.querySelector('#mod-refresh')?.addEventListener('click', () => load(container))
  container.querySelector('#mod-tab-open')?.addEventListener('click', () => { _status = 'open'; load(container) })
  container.querySelector('#mod-tab-rev')?.addEventListener('click', () => { _status = 'reviewed'; load(container) })

  container.querySelectorAll('[data-report]').forEach(el => {
    const id = el.getAttribute('data-report')
    const r = d.rows.find(x => String(x.id) === id)
    el.querySelector('[data-act="dismiss"]')?.addEventListener('click', () => act(container, r, 'dismiss'))
    el.querySelector('[data-act="hide"]')?.addEventListener('click', () => act(container, r, 'hide'))
    el.querySelector('[data-act="suspend"]')?.addEventListener('click', () => act(container, r, 'suspend'))
  })
}

// Port von lib/moderation.ts reviewReport — dismiss/hide/suspend + Report schließen.
async function act(container, r, action) {
  if (action === 'suspend' && !window.confirm(`Nutzer @${r.author_username || '?'} wirklich sperren?`)) return
  try {
    let newStatus = 'dismissed'
    if (action === 'hide') {
      newStatus = 'hidden'
      if (r.target_type === 'update') {
        const { error } = await sb.from('updates').update({ is_hidden: true }).eq('id', r.target_id); if (error) throw error
      } else if (r.target_type === 'comment') {
        const { error } = await sb.from('comments').update({ is_hidden: true }).eq('id', r.target_id); if (error) throw error
      } else if (r.target_type === 'voice_comment') {
        const { error } = await sb.rpc('voice_comment_set_hidden', { p_voice_comment_id: r.target_id, p_hidden: true, p_reason: 'Admin-Moderation' }); if (error) throw error
      }
    } else if (action === 'suspend') {
      newStatus = 'suspended'
      if (r.author_id) { const { error } = await sb.from('users').update({ is_suspended: true }).eq('id', r.author_id); if (error) throw error }
    }
    let reviewer = null
    try { const { data } = await sb.auth.getUser(); reviewer = data?.user?.id || null } catch (_) {}
    const { error } = await sb.from('reports').update({
      status: newStatus, reviewed_at: new Date().toISOString(), reviewed_by: reviewer,
    }).eq('id', r.id)
    if (error) throw error
    toast(action === 'dismiss' ? 'Meldung verworfen' : action === 'hide' ? 'Inhalt verborgen' : 'Nutzer gesperrt', 'success')
    await load(container)
  } catch (e) { toast('Aktion fehlgeschlagen: ' + (e?.message || e), 'error') }
}

async function load(container) {
  container.innerHTML = `<div class="panel-section" style="text-align:center;padding:40px;color:var(--text-muted,#9CA3AF)">Lädt Meldungen…</div>`
  try {
    render(container, await fetchData())
  } catch (e) {
    console.error('[moderation]', e)
    const msg = (e && e.message) || 'Fehler'
    container.innerHTML = `<div class="panel-section" style="text-align:center;padding:40px;color:#EF4444">
      Meldungen konnten nicht geladen werden.<br><span style="font-size:12px;color:var(--text-muted,#9CA3AF)">${htmlEscape(msg)}</span></div>`
    toast('Moderation: ' + msg, 'error')
  }
}

export default {
  id: 'moderation',
  title: 'Moderation',
  icon: 'shield-check',
  async mount(container) {
    _status = 'open'
    await load(container)
  }
}
