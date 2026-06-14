// Ankündigungen — spiegelt die App-Admin-Ankündigungen ins CRM (app/admin/announcements.tsx,
// lib/moderation.ts). Anlegen, Liste, Aktiv-Toggle, Löschen, optionales Ablaufdatum.
// Direkter Tabellenzugriff (RLS gated Admins, wie die App). Tabelle: announcements (+ announcement_reads für Read-Count).
import { sb } from '/lib/supabase.js?v=20260610q'
import { fmtNumber, iconHtml, htmlEscape, fmtDateTime, fmtRelativeTime, toast } from '/lib/ui.js?v=20260610q'

let _showForm = false

const AUDIENCE = [
  { value: 'all', label: 'Alle' },
  { value: 'podcaster', label: 'Podcaster' },
  { value: 'listener', label: 'Hörer:innen' },
  { value: 'newsletter', label: 'Newsletter' },
]
const audLabel = a => (AUDIENCE.find(o => o.value === a)?.label || a)

async function fetchData() {
  const { data: items, error } = await sb
    .from('announcements')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) throw error
  // Read-Counts pro Ankündigung (optional — Tabelle kann fehlen)
  const reads = {}
  try {
    const { data: rd } = await sb.from('announcement_reads').select('announcement_id')
    for (const r of (rd || [])) reads[r.announcement_id] = (reads[r.announcement_id] || 0) + 1
  } catch (_) { /* reads optional */ }
  return { items: items || [], reads }
}

function isExpired(a) {
  return a.expires_at && new Date(a.expires_at).getTime() < Date.now()
}

function row(a, reads) {
  const expired = isExpired(a)
  const live = a.is_active && !expired
  const statusColor = live ? '#22C55E' : '#9CA3AF'
  const statusLabel = expired ? '○ Abgelaufen' : (a.is_active ? '● Aktiv' : '○ Inaktiv')
  return `<div style="padding:13px 0;border-bottom:1px solid rgba(255,255,255,0.05)" data-ann="${htmlEscape(a.id)}">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px">
      <span style="font-size:10.5px;padding:2px 8px;border-radius:999px;background:rgba(124,92,255,.16);color:#b9a6ff">${htmlEscape(audLabel(a.audience))}</span>
      <span style="font-size:11px;color:var(--text-muted,#9CA3AF)">${htmlEscape(fmtRelativeTime(a.created_at))}</span>
      ${a.expires_at ? `<span style="font-size:10.5px;color:${expired ? '#EF4444' : 'var(--text-muted,#9CA3AF)'}">⏱ ${htmlEscape(fmtDateTime(a.expires_at))}</span>` : ''}
      <span style="margin-left:auto;font-size:11px;color:var(--text-muted,#9CA3AF)">${iconHtml('eye')} ${fmtNumber(reads)} gelesen</span>
    </div>
    <div style="display:flex;align-items:flex-start;gap:13px">
      <div style="min-width:0;flex:1">
        <div style="font-size:14px;color:var(--text,#fff);font-weight:600">${htmlEscape(a.title || '—')}</div>
        <div style="font-size:12.5px;color:var(--text-muted,#9CA3AF);line-height:1.45;margin-top:2px;white-space:pre-wrap">${htmlEscape((a.body || '').slice(0, 240))}${(a.body || '').length > 240 ? '…' : ''}</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0">
        <button class="btn btn-ghost" data-act="toggle" style="padding:5px 11px;font-size:12px;color:${statusColor}">${statusLabel}</button>
        <button class="btn btn-ghost" data-act="del" style="padding:5px 11px;font-size:12px;color:#EF4444">Löschen</button>
      </div>
    </div>
  </div>`
}

function createForm() {
  return `<div class="panel-section" id="ann-form" style="border:1px solid rgba(124,92,255,.25)">
    <div class="card-header"><strong>Neue Ankündigung</strong></div>
    <div style="display:grid;gap:12px">
      <label style="font-size:12px;color:var(--text-muted)">Titel*<input id="ann-title" type="text" maxlength="120" placeholder="z.B. Neue Funktion verfügbar" style="width:100%;margin-top:4px;padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04);color:inherit"></label>
      <label style="font-size:12px;color:var(--text-muted)">Inhalt*<textarea id="ann-body" rows="4" maxlength="2000" placeholder="Was möchtest du teilen?" style="width:100%;margin-top:4px;padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04);color:inherit;resize:vertical;font-family:inherit"></textarea></label>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px">
        <label style="font-size:12px;color:var(--text-muted)">Zielgruppe<select id="ann-aud" style="width:100%;margin-top:4px;padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04);color:inherit">${AUDIENCE.map(o => `<option value="${o.value}">${o.label}</option>`).join('')}</select></label>
        <label style="font-size:12px;color:var(--text-muted)">Läuft ab am (optional)<input id="ann-exp" type="datetime-local" style="width:100%;margin-top:4px;padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04);color:inherit"></label>
      </div>
    </div>
    <div style="display:flex;gap:10px;margin-top:14px">
      <button class="btn" id="ann-save" style="background:#7C5CFF;color:#fff;border:none">Senden (aktiv)</button>
      <button class="btn btn-ghost" id="ann-cancel">Abbrechen</button>
    </div>
  </div>`
}

function render(container, d) {
  const live = d.items.filter(a => a.is_active && !isExpired(a)).length
  const totalReads = Object.values(d.reads).reduce((s, n) => s + n, 0)

  container.innerHTML = `
    <div class="panel-head">
      <div class="panel-head-left">
        <div class="panel-title">Ankündigungen</div>
        <div class="panel-sub">Banner an die Community senden — wie in der App-Admin, jetzt im CRM</div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn" id="ann-new" style="background:#7C5CFF;color:#fff;border:none">${iconHtml('plus')} Neue</button>
        <button class="btn btn-ghost" id="ann-refresh">${iconHtml('refresh')}</button>
      </div>
    </div>

    <div class="hero-row">
      <div class="stat-hero"><div class="stat-value">${fmtNumber(d.items.length)}</div><div class="stat-label">gesamt</div></div>
      <div class="stat-hero"><div class="stat-value" style="color:${live ? '#22C55E' : '#9CA3AF'}">${fmtNumber(live)}</div><div class="stat-label">live</div></div>
      <div class="stat-hero"><div class="stat-value">${fmtNumber(totalReads)}</div><div class="stat-label">Lesungen gesamt</div></div>
    </div>

    ${_showForm ? createForm() : ''}

    <div class="panel-section">
      <div class="card-header"><strong>Alle Ankündigungen</strong></div>
      ${d.items.length ? d.items.map(a => row(a, d.reads[a.id] || 0)).join('') : '<div class="card-sub" style="padding:18px;text-align:center">Noch keine Ankündigungen — über „Neue" anlegen.</div>'}
    </div>
  `

  container.querySelector('#ann-refresh')?.addEventListener('click', () => load(container))
  container.querySelector('#ann-new')?.addEventListener('click', () => { _showForm = true; render(container, d) })
  container.querySelector('#ann-cancel')?.addEventListener('click', () => { _showForm = false; render(container, d) })
  container.querySelector('#ann-save')?.addEventListener('click', () => save(container))

  container.querySelectorAll('[data-ann]').forEach(rowEl => {
    const id = rowEl.getAttribute('data-ann')
    const a = d.items.find(x => String(x.id) === id)
    rowEl.querySelector('[data-act="toggle"]')?.addEventListener('click', () => toggle(container, a))
    rowEl.querySelector('[data-act="del"]')?.addEventListener('click', () => del(container, a))
  })
}

async function toggle(container, a) {
  try {
    const { error } = await sb.from('announcements').update({ is_active: !a.is_active }).eq('id', a.id)
    if (error) throw error
    toast(`Ankündigung ${!a.is_active ? 'aktiviert' : 'deaktiviert'}`, 'success')
    await load(container)
  } catch (e) { toast('Toggle fehlgeschlagen: ' + (e?.message || e), 'error') }
}

async function del(container, a) {
  if (!window.confirm(`Ankündigung "${a.title}" unwiderruflich löschen?`)) return
  try {
    const { error } = await sb.from('announcements').delete().eq('id', a.id)
    if (error) throw error
    toast('Gelöscht', 'success')
    await load(container)
  } catch (e) { toast('Löschen fehlgeschlagen: ' + (e?.message || e), 'error') }
}

async function save(container) {
  const g = id => container.querySelector(id)
  const title = g('#ann-title')?.value.trim()
  const body = g('#ann-body')?.value.trim()
  if (!title || !body) { toast('Titel und Inhalt sind Pflicht', 'error'); return }
  const audience = g('#ann-aud')?.value || 'all'
  const expRaw = g('#ann-exp')?.value
  const expires_at = expRaw ? new Date(expRaw).toISOString() : null
  let created_by = null
  try { const { data } = await sb.auth.getUser(); created_by = data?.user?.id || null } catch (_) {}
  try {
    const { error } = await sb.from('announcements').insert({
      title, body, audience, is_active: true, created_by, expires_at,
    })
    if (error) throw error
    toast('Ankündigung gesendet + aktiv', 'success')
    _showForm = false
    await load(container)
  } catch (e) { toast('Senden fehlgeschlagen: ' + (e?.message || e), 'error') }
}

async function load(container) {
  container.innerHTML = `<div class="panel-section" style="text-align:center;padding:40px;color:var(--text-muted,#9CA3AF)">Lädt Ankündigungen…</div>`
  try {
    render(container, await fetchData())
  } catch (e) {
    console.error('[announcements]', e)
    const msg = (e && e.message) || 'Fehler'
    container.innerHTML = `<div class="panel-section" style="text-align:center;padding:40px;color:#EF4444">
      Ankündigungen konnten nicht geladen werden.<br><span style="font-size:12px;color:var(--text-muted,#9CA3AF)">${htmlEscape(msg)}</span></div>`
    toast('Ankündigungen: ' + msg, 'error')
  }
}

export default {
  id: 'announcements',
  title: 'Ankündigungen',
  icon: 'bell',
  async mount(container) {
    _showForm = false
    await load(container)
  }
}
