// hozd-cast: Sessions — 2026-09-12, Paket F (CRM).
// Vertrag: expo/docs/hozdcast-contract.md Abschnitt 18.1 (admin_hozdcast_sessions)
// + 18.4 (admin_hozdcast_mail_log, in der Detail-Ansicht). Filter Status/Suche,
// Tabelle, Klick auf Zeile oeffnet Detail mit Teilnehmern/Segmenten/Render-Stand
// + Mail-Log dieser Session.
import { sb } from '/lib/supabase.js?v=20260610q'
import { fmtNumber, iconHtml, htmlEscape, modal, toast } from '/lib/ui.js?v=20260610q'

const STATUS_OPTIONS = [
  ['', 'Alle'], ['draft', 'Entwurf'], ['invited', 'Eingeladen'], ['lobby', 'Lobby'],
  ['live', 'Live'], ['recorded', 'Aufgenommen'], ['uploading', 'Uploadet'], ['queued', 'Wartet'],
  ['rendering', 'Rendert'], ['audio_ready', 'Audio fertig'], ['ready', 'Fertig'],
  ['published', 'Veröffentlicht'], ['error', 'Fehler'], ['deleted', 'Gelöscht'],
]
const STATUS_COLOR = {
  draft: '#9CA3AF', invited: '#60A5FA', lobby: '#60A5FA', live: '#F59E0B',
  recorded: '#F59E0B', uploading: '#F59E0B', queued: '#9CA3AF', rendering: '#F59E0B',
  audio_ready: '#22C55E', ready: '#22C55E', published: '#22C55E', error: '#EF4444', deleted: '#6B7280',
}

let _status = ''
let _q = ''
let _page = 0
const PAGE_SIZE = 50

function fmtBytes(n) {
  if (!n || n < 0) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB']
  let i = 0, v = n
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${u[i]}`
}
function fmtDur(sec) {
  if (!sec) return '—'
  const m = Math.floor(sec / 60), s = Math.round(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}
function statusBadge(status) {
  const c = STATUS_COLOR[status] || '#9CA3AF'
  const label = (STATUS_OPTIONS.find(o => o[0] === status) || [status, status])[1]
  return `<span style="font-size:10.5px;padding:2px 8px;border-radius:999px;background:${c}22;color:${c}">${htmlEscape(label)}</span>`
}

function tableRow(s) {
  const names = (s.participants || []).map(p => '@' + (p.username || p.display_name || '?')).join(' · ')
  return `<tr data-session="${htmlEscape(s.session_id)}" style="cursor:pointer">
    <td><code style="font-size:11.5px">${htmlEscape(s.code || '—')}</code></td>
    <td>${htmlEscape(s.title || '(ohne Titel)')}</td>
    <td>${htmlEscape(names || '—')}</td>
    <td>${statusBadge(s.status)}</td>
    <td>${htmlEscape(s.mode || 'audio')}</td>
    <td>${fmtDur(s.duration_sec)}</td>
    <td>${fmtBytes(s.bytes_raw)} / ${fmtBytes(s.bytes_out)}</td>
    <td>${s.error ? `<span style="color:#f87171" title="${htmlEscape(s.error)}">${htmlEscape(s.error_class || 'error')}</span>` : '—'}</td>
    <td style="white-space:nowrap;font-size:11px;color:var(--text-muted,#9CA3AF)">${htmlEscape(new Date(s.created_at).toLocaleString('de-AT'))}</td>
  </tr>`
}

function render(container, d) {
  const totalPages = Math.max(1, Math.ceil((d.total || 0) / PAGE_SIZE))
  container.innerHTML = `
    <div class="panel-head">
      <div class="panel-head-left">
        <div class="panel-title">hozd-cast — Sessions</div>
        <div class="panel-sub">${fmtNumber(d.total || 0)} Sessions gesamt</div>
      </div>
      <button class="btn btn-ghost" id="hcses-refresh">${iconHtml('refresh')} Aktualisieren</button>
    </div>

    <div style="display:flex;gap:10px;margin:10px 0 14px;flex-wrap:wrap;align-items:center">
      <select id="hcses-status" style="padding:7px 10px;border-radius:8px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:var(--text,#fff);font-size:13px">
        ${STATUS_OPTIONS.map(([v, l]) => `<option value="${v}" ${v === _status ? 'selected' : ''}>${htmlEscape(l)}</option>`).join('')}
      </select>
      <input id="hcses-q" type="text" placeholder="Suche Titel / Code / Teilnehmer…" value="${htmlEscape(_q)}"
        style="flex:1;min-width:220px;max-width:420px;padding:7px 12px;border-radius:8px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:var(--text,#fff);font-size:13px">
    </div>

    <div class="panel-section" style="padding:0;overflow-x:auto">
      <table class="data-table" style="width:100%;font-size:12.5px;border-collapse:collapse">
        <thead><tr style="text-align:left">
          <th style="padding:8px">Code</th><th style="padding:8px">Titel</th><th style="padding:8px">Teilnehmer</th>
          <th style="padding:8px">Status</th><th style="padding:8px">Modus</th><th style="padding:8px">Dauer</th>
          <th style="padding:8px">Bytes (raw/out)</th><th style="padding:8px">Fehler</th><th style="padding:8px">Erstellt</th>
        </tr></thead>
        <tbody>${d.rows && d.rows.length ? d.rows.map(tableRow).join('') : `<tr><td colspan="9" style="text-align:center;padding:30px;color:var(--text-muted,#9CA3AF)">Keine Sessions für diesen Filter.</td></tr>`}</tbody>
      </table>
    </div>

    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px">
      <span style="font-size:12px;color:var(--text-muted,#9CA3AF)">Seite ${_page + 1} / ${totalPages}</span>
      <div style="display:flex;gap:8px">
        <button class="btn btn-ghost" id="hcses-prev" ${_page <= 0 ? 'disabled' : ''}>← Zurück</button>
        <button class="btn btn-ghost" id="hcses-next" ${_page + 1 >= totalPages ? 'disabled' : ''}>Weiter →</button>
      </div>
    </div>
  `

  container.querySelector('#hcses-refresh')?.addEventListener('click', () => load(container))
  container.querySelector('#hcses-status')?.addEventListener('change', (e) => { _status = e.target.value; _page = 0; load(container) })
  const qInput = container.querySelector('#hcses-q')
  let qTimer = null
  qInput?.addEventListener('input', () => {
    clearTimeout(qTimer)
    qTimer = setTimeout(() => { _q = qInput.value.trim(); _page = 0; load(container) }, 350)
  })
  container.querySelector('#hcses-prev')?.addEventListener('click', () => { if (_page > 0) { _page--; load(container) } })
  container.querySelector('#hcses-next')?.addEventListener('click', () => { if (_page + 1 < totalPages) { _page++; load(container) } })

  container.querySelectorAll('tr[data-session]').forEach(tr => {
    const id = tr.getAttribute('data-session')
    const s = (d.rows || []).find(x => x.session_id === id)
    if (s) tr.addEventListener('click', () => openDetail(s))
  })
}

function participantRow(p) {
  return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.05);font-size:12.5px">
    <div>
      <strong>@${htmlEscape(p.username || p.display_name || '?')}</strong>
      <span style="color:var(--text-muted,#9CA3AF)"> · ${htmlEscape(p.role)} · Slot ${p.slot}</span>
      ${p.podcast_title ? `<div style="color:var(--text-muted,#9CA3AF);font-size:11px">${htmlEscape(p.podcast_title)}</div>` : ''}
      ${p.input_label ? `<div style="color:var(--text-muted,#9CA3AF);font-size:11px">Input: ${htmlEscape(p.input_label)} (${htmlEscape(p.input_kind || '?')})</div>` : ''}
    </div>
    <div style="text-align:right;font-size:11px;color:var(--text-muted,#9CA3AF)">
      <div>${p.segments_uploaded ?? 0}/${p.segments_expected_audio ?? 0} Segmente</div>
      <div>${p.consent_record_at ? '✓ Aufnahme' : '— Aufnahme'} · ${p.consent_publish_at ? '✓ Veröffentl.' : '— Veröffentl.'}</div>
    </div>
  </div>`
}

function mailRow(m) {
  const stateColor = { sent: '#22C55E', failed: '#EF4444', queued: '#9CA3AF', expired: '#6B7280' }[m.state] || '#9CA3AF'
  return `<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid rgba(255,255,255,.05);font-size:12px">
    <div>
      <span style="color:${stateColor};font-weight:600">${htmlEscape(m.state)}</span>
      · ${htmlEscape(m.kind)} · ${htmlEscape(m.email)} · ${m.asset_count ?? 0} Dateien
      ${m.error ? `<div style="color:#f87171;font-size:11px">${htmlEscape(m.error)}</div>` : ''}
    </div>
    <span style="color:var(--text-muted,#9CA3AF)">${htmlEscape(new Date(m.created_at).toLocaleString('de-AT'))}</span>
  </div>`
}

async function openDetail(s) {
  const body = document.createElement('div')
  body.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-muted,#9CA3AF)">Lädt Details…</div>`
  modal({
    title: `${s.code || ''} — ${s.title || '(ohne Titel)'}`,
    content: body,
    width: 680,
  })

  try {
    const { data: mailData, error: mailErr } = await sb.rpc('admin_hozdcast_mail_log', { p_session: s.session_id, p_limit: 50 })
    if (mailErr) throw mailErr
    const mails = (mailData && mailData.rows) || []

    body.innerHTML = `
      <div style="margin-bottom:14px;display:flex;gap:8px;flex-wrap:wrap">
        ${statusBadge(s.status)}
        <span style="font-size:11px;color:var(--text-muted,#9CA3AF)">Modus ${htmlEscape(s.mode || 'audio')} · Sync ${htmlEscape(s.sync_confidence || '—')} (${s.sync_offset_ms ?? '—'}ms)</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:16px;font-size:12.5px">
        <div>Dauer: <strong>${fmtDur(s.duration_sec)}</strong></div>
        <div>Cut entfernt: <strong>${fmtDur(s.cut_removed_sec)}</strong></div>
        <div>Bytes raw/out: <strong>${fmtBytes(s.bytes_raw)} / ${fmtBytes(s.bytes_out)}</strong></div>
        <div>Render-Stufe: <strong>${htmlEscape(s.stage || '—')}</strong> (Versuch ${s.attempt ?? 0})</div>
        <div>Video erwartet: <strong>${s.video_expected ? 'ja' : 'nein'}</strong></div>
        <div>Video fertig: <strong>${s.video_ready ? 'ja' : 'nein'}</strong></div>
        <div>Raw läuft ab: <strong>${s.expires_raw_at ? htmlEscape(new Date(s.expires_raw_at).toLocaleString('de-AT')) : '—'}</strong></div>
        <div>Raw gelöscht: <strong>${s.raw_purged_at ? htmlEscape(new Date(s.raw_purged_at).toLocaleString('de-AT')) : 'nein'}</strong></div>
      </div>
      ${s.error ? `<div style="font-size:12.5px;color:#f87171;background:rgba(239,68,68,.08);border-radius:6px;padding:8px 11px;margin-bottom:14px">${htmlEscape(s.error_class || 'error')}: ${htmlEscape(s.error)}</div>` : ''}

      <div class="card-header" style="margin-bottom:4px"><strong>Teilnehmer</strong></div>
      ${(s.participants && s.participants.length) ? s.participants.map(participantRow).join('') : '<div class="card-sub">Keine Teilnehmer</div>'}
      <div style="margin-top:10px;font-size:11.5px;color:var(--text-muted,#9CA3AF)">
        Segmente: ${s.segments ? `${s.segments.audio ?? 0} Audio · ${s.segments.video ?? 0} Video · ${s.segments.ref ?? 0} Ref` : '—'}
      </div>

      <div class="card-header" style="margin:16px 0 4px"><strong>Mail-Log</strong></div>
      ${mails.length ? mails.map(mailRow).join('') : '<div class="card-sub">Keine Downloads angefordert</div>'}
    `
  } catch (e) {
    body.innerHTML = `<div style="padding:20px;color:#EF4444">Detail konnte nicht geladen werden: ${htmlEscape(e?.message || String(e))}</div>`
    toast('Session-Detail: ' + (e?.message || e), 'error')
  }
}

async function load(container) {
  container.innerHTML = `<div class="panel-section" style="text-align:center;padding:40px;color:var(--text-muted,#9CA3AF)">Lädt hozd-cast Sessions…</div>`
  try {
    const { data, error } = await sb.rpc('admin_hozdcast_sessions', {
      p_status: _status || null,
      p_q: _q || null,
      p_podcast: null,
      p_limit: PAGE_SIZE,
      p_offset: _page * PAGE_SIZE,
    })
    if (error) throw error
    if (!data) throw new Error('Keine Daten')
    render(container, data)
  } catch (e) {
    console.error('[hozdcast-sessions]', e)
    const msg = (e && e.message) || 'Fehler'
    container.innerHTML = `<div class="panel-section" style="text-align:center;padding:40px;color:#EF4444">
      Sessions konnten nicht geladen werden.<br><span style="font-size:12px;color:var(--text-muted,#9CA3AF)">${htmlEscape(msg)}</span></div>`
    toast('hozd-cast Sessions: ' + msg, 'error')
  }
}

export default {
  id: 'hozdcast-sessions',
  title: 'hozd-cast Sessions',
  icon: 'inbox',
  async mount(container) {
    _status = ''
    _q = ''
    _page = 0
    await load(container)
  }
}
