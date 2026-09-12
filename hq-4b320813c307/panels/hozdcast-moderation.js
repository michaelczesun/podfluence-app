// hozd-cast: Moderation — 2026-09-12, Paket F (CRM).
// Vertrag: expo/docs/hozdcast-contract.md Abschnitt 18.5 (admin_hozdcast_moderate,
// p_action in hide/unhide/purge) + 18.1 (admin_hozdcast_sessions p_status='published').
// Zeigt veroeffentlichte hozd-casts, verbirgt/loescht. "Verborgen" landet laut
// 11 (hozdcast_unpublish) auf status='ready' + visibility='private' — es gibt
// keinen eigenen Status dafuer, deshalb ist die zweite Liste eine Best-Effort-
// Naeherung (ready-Sessions mit einem 'moderation_hide' in hozdcast_purge_queue
// waeren die exakte Antwort; ohne eigene RPC dafuer zeigen wir hier nur die
// zuletzt in DIESER Sitzung selbst verborgenen IDs, siehe open_for_integration).
import { sb } from '/lib/supabase.js?v=20260610q'
import { fmtNumber, iconHtml, htmlEscape, promptDialog, toast } from '/lib/ui.js?v=20260610q'

let _q = ''
const _hiddenThisSession = new Map() // session_id -> row-snapshot, nur fuer Unhide in dieser Sitzung

function participantChips(parts) {
  if (!parts || !parts.length) return ''
  return parts.map(p => `<span style="font-size:11px;padding:2px 8px;border-radius:999px;background:rgba(255,255,255,.06);color:var(--text-muted,#9CA3AF);margin-right:4px">
    @${htmlEscape(p.username || p.display_name || '?')}${p.role === 'host' ? ' · Host' : ''}</span>`).join('')
}

function card(s) {
  return `<div class="panel-section" style="margin-bottom:10px" data-session="${htmlEscape(s.session_id)}">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:7px;flex-wrap:wrap">
      <code style="font-size:12px;color:#b9a6ff">${htmlEscape(s.code || '—')}</code>
      <span style="font-size:13.5px;color:var(--text,#fff);font-weight:600">${htmlEscape(s.title || '(ohne Titel)')}</span>
      <span style="font-size:10.5px;padding:2px 8px;border-radius:999px;background:rgba(34,197,94,.14);color:#4ade80">${htmlEscape(s.visibility || 'hozdcast')}</span>
      <span style="margin-left:auto;font-size:11px;color:var(--text-muted,#9CA3AF)">veröffentlicht ${s.published_at ? htmlEscape(new Date(s.published_at).toLocaleString('de-AT')) : '—'}</span>
    </div>
    <div style="margin-bottom:8px">${participantChips(s.participants)}</div>
    <div style="font-size:12px;color:var(--text-muted,#9CA3AF);margin-bottom:10px">
      Dauer ${fmtNumber(Math.round((s.duration_sec || 0) / 60))} Min · Modus ${htmlEscape(s.mode || 'audio')}
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn btn-ghost" data-act="hide" style="padding:6px 13px;font-size:12.5px;color:#F59E0B">${iconHtml('shield-check')} Verbergen</button>
      <button class="btn btn-ghost" data-act="purge" style="padding:6px 13px;font-size:12.5px;color:#EF4444">Endgültig löschen</button>
    </div>
  </div>`
}

function hiddenCard(s) {
  return `<div class="panel-section" style="margin-bottom:10px" data-session="${htmlEscape(s.session_id)}">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:7px;flex-wrap:wrap">
      <code style="font-size:12px;color:#b9a6ff">${htmlEscape(s.code || '—')}</code>
      <span style="font-size:13.5px;color:var(--text,#fff);font-weight:600">${htmlEscape(s.title || '(ohne Titel)')}</span>
      <span style="font-size:10.5px;padding:2px 8px;border-radius:999px;background:rgba(239,68,68,.14);color:#f87171">verborgen (diese Sitzung)</span>
    </div>
    <div style="display:flex;gap:8px">
      <button class="btn btn-ghost" data-act="unhide" style="padding:6px 13px;font-size:12.5px;color:#22C55E">Wieder freigeben</button>
    </div>
  </div>`
}

function render(container, published) {
  const hidden = [..._hiddenThisSession.values()]
  container.innerHTML = `
    <div class="panel-head">
      <div class="panel-head-left">
        <div class="panel-title">hozd-cast — Moderation</div>
        <div class="panel-sub">Veröffentlichte Collabs verbergen / löschen</div>
      </div>
      <button class="btn btn-ghost" id="hcm-refresh">${iconHtml('refresh')} Aktualisieren</button>
    </div>

    <div class="hero-row">
      <div class="stat-hero"><div class="stat-value">${fmtNumber(published.total || 0)}</div><div class="stat-label">veröffentlicht</div></div>
      <div class="stat-hero"><div class="stat-value" style="color:${hidden.length ? '#F59E0B' : undefined}">${fmtNumber(hidden.length)}</div><div class="stat-label">gerade verborgen</div></div>
    </div>

    <div style="margin:10px 0 14px">
      <input id="hcm-q" type="text" placeholder="Suche Titel / Code / Teilnehmer…" value="${htmlEscape(_q)}"
        style="width:100%;max-width:420px;padding:8px 12px;border-radius:8px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:var(--text,#fff);font-size:13px">
    </div>

    <div class="card-header" style="margin-bottom:6px"><strong>Veröffentlicht</strong></div>
    ${published.rows && published.rows.length ? published.rows.map(card).join('') : `<div class="panel-section" style="text-align:center;padding:24px;color:var(--text-muted,#9CA3AF)">Keine veröffentlichten hozd-casts${_q ? ' für diese Suche' : ''}.</div>`}

    ${hidden.length ? `<div class="card-header" style="margin:18px 0 6px"><strong>Gerade verborgen</strong><span class="card-sub">nur diese Sitzung — Server-Wahrheit ist status='ready'</span></div>${hidden.map(hiddenCard).join('')}` : ''}
  `

  container.querySelector('#hcm-refresh')?.addEventListener('click', () => load(container))
  const qInput = container.querySelector('#hcm-q')
  let qTimer = null
  qInput?.addEventListener('input', () => {
    clearTimeout(qTimer)
    qTimer = setTimeout(() => { _q = qInput.value.trim(); load(container) }, 350)
  })

  container.querySelectorAll('[data-session]').forEach(el => {
    const id = el.getAttribute('data-session')
    const s = (published.rows || []).find(x => x.session_id === id) || _hiddenThisSession.get(id)
    if (!s) return
    el.querySelector('[data-act="hide"]')?.addEventListener('click', () => hide(container, s))
    el.querySelector('[data-act="unhide"]')?.addEventListener('click', () => unhide(container, s))
    el.querySelector('[data-act="purge"]')?.addEventListener('click', () => purge(container, s))
  })
}

async function hide(container, s) {
  const reason = await promptDialog({ title: 'Verbergen', message: `Grund für „${s.title || s.code}" (Pflicht):` })
  if (!reason || !reason.trim()) { toast('Abgebrochen — Grund ist Pflicht', 'info'); return }
  try {
    const { data, error } = await sb.rpc('admin_hozdcast_moderate', { p_session: s.session_id, p_action: 'hide', p_reason: reason.trim() })
    if (error) throw error
    if (data && data.ok === false) throw new Error(data.error || 'hide fehlgeschlagen')
    _hiddenThisSession.set(s.session_id, s)
    toast('hozd-cast verborgen', 'success')
    await load(container)
  } catch (e) { toast('Verbergen fehlgeschlagen: ' + (e?.message || e), 'error') }
}

async function unhide(container, s) {
  if (!window.confirm(`„${s.title || s.code}" wirklich wieder freigeben?`)) return
  try {
    const { data, error } = await sb.rpc('admin_hozdcast_moderate', { p_session: s.session_id, p_action: 'unhide' })
    if (error) throw error
    if (data && data.ok === false) throw new Error(data.error || 'unhide fehlgeschlagen')
    _hiddenThisSession.delete(s.session_id)
    toast('hozd-cast wieder freigegeben', 'success')
    await load(container)
  } catch (e) { toast('Freigeben fehlgeschlagen: ' + (e?.message || e), 'error') }
}

async function purge(container, s) {
  const reason = await promptDialog({ title: 'Endgültig löschen', message: `Grund für „${s.title || s.code}" (min. 10 Zeichen, Pflicht — Rechtsverstoß):` })
  if (!reason || reason.trim().length < 10) { toast('Abgebrochen — Grund braucht mind. 10 Zeichen', 'info'); return }
  if (!window.confirm(`WIRKLICH endgültig löschen (ohne 30-Tage-Schonfrist)? „${s.title || s.code}"`)) return
  try {
    const { data, error } = await sb.rpc('admin_hozdcast_moderate', { p_session: s.session_id, p_action: 'purge', p_reason: reason.trim() })
    if (error) throw error
    if (data && data.ok === false) throw new Error(data.error || 'purge fehlgeschlagen')
    _hiddenThisSession.delete(s.session_id)
    toast('hozd-cast endgültig gelöscht', 'success')
    await load(container)
  } catch (e) { toast('Löschen fehlgeschlagen: ' + (e?.message || e), 'error') }
}

async function load(container) {
  container.innerHTML = `<div class="panel-section" style="text-align:center;padding:40px;color:var(--text-muted,#9CA3AF)">Lädt veröffentlichte hozd-casts…</div>`
  try {
    const { data, error } = await sb.rpc('admin_hozdcast_sessions', { p_status: 'published', p_q: _q || null, p_limit: 100, p_offset: 0 })
    if (error) throw error
    const published = data || { total: 0, rows: [] }
    render(container, published)
  } catch (e) {
    console.error('[hozdcast-moderation]', e)
    const msg = (e && e.message) || 'Fehler'
    container.innerHTML = `<div class="panel-section" style="text-align:center;padding:40px;color:#EF4444">
      Moderation konnte nicht geladen werden.<br><span style="font-size:12px;color:var(--text-muted,#9CA3AF)">${htmlEscape(msg)}</span></div>`
    toast('hozd-cast Moderation: ' + msg, 'error')
  }
}

export default {
  id: 'hozdcast-moderation',
  title: 'hozd-cast Moderation',
  icon: 'shield-check',
  async mount(container) {
    _q = ''
    await load(container)
  }
}
