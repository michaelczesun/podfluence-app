// hozd-cast: Render-Queue — 2026-09-12, Paket F (CRM).
// Vertrag: expo/docs/hozdcast-contract.md Abschnitt 18.2 (admin_hozdcast_renders)
// + 18.5 (admin_hozdcast_moderate, p_action='retry'). Ampel wird SERVERSEITIG
// berechnet (lamp aus der RPC) — das Panel zeigt sie nur an, siehe 18.2.
import { sb } from '/lib/supabase.js?v=20260610q'
import { fmtNumber, iconHtml, htmlEscape, toast } from '/lib/ui.js?v=20260610q'

let _state = 'open' // 'open' | 'queued' | 'rendering' | 'failed' | 'done' | 'all'

const STATE_LABEL = { open: 'Offen', queued: 'Wartend', rendering: 'Rendert', failed: 'Fehlgeschlagen', done: 'Fertig', all: 'Alle' }
const STAGE_BADGE = {
  queued: ['#9CA3AF', 'wartend'], analyzing: ['#60A5FA', 'analysiert'],
  rendering: ['#F59E0B', 'rendert'], audio_ready: ['#22C55E', 'audio fertig'],
  done: ['#22C55E', 'fertig'], failed: ['#EF4444', 'fehlgeschlagen'],
}
const LAMP_COLOR = { green: '#22C55E', yellow: '#F59E0B', red: '#EF4444' }

function fmtDur(sec) {
  if (sec == null) return '—'
  sec = Math.max(0, Math.round(sec))
  if (sec < 60) return `${sec}s`
  const m = Math.floor(sec / 60), s = sec % 60
  if (m < 60) return `${m}m ${s}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

function row(r) {
  const [sc, sl] = STAGE_BADGE[r.stage] || ['#9CA3AF', r.stage]
  const canRetry = r.stage === 'failed' || (r.deadline_at && new Date(r.deadline_at) < new Date())
  return `<div class="panel-section" style="margin-bottom:10px" data-render="${htmlEscape(r.render_id)}" data-session="${htmlEscape(r.session_id)}">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:7px;flex-wrap:wrap">
      <code style="font-size:12px;color:#b9a6ff">${htmlEscape(r.code || '—')}</code>
      <span style="font-size:13.5px;color:var(--text,#fff);font-weight:600">${htmlEscape(r.title || '(ohne Titel)')}</span>
      <span style="font-size:10.5px;padding:2px 8px;border-radius:999px;background:rgba(255,255,255,.07);color:var(--text-muted,#9CA3AF)">${htmlEscape(r.mode || 'audio')}</span>
      <span style="font-size:10.5px;padding:2px 8px;border-radius:999px;background:${sc}22;color:${sc}">${htmlEscape(sl)}</span>
      ${r.attempt ? `<span style="font-size:10.5px;padding:2px 8px;border-radius:999px;background:rgba(255,255,255,.07);color:var(--text-muted,#9CA3AF)">Versuch ${r.attempt}</span>` : ''}
      <span style="margin-left:auto;font-size:11px;color:var(--text-muted,#9CA3AF)">${htmlEscape(new Date(r.updated_at).toLocaleString('de-AT'))}</span>
    </div>
    <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:12px;color:var(--text-muted,#9CA3AF);margin-bottom:8px">
      <span>Fortschritt: <strong style="color:var(--text,#fff)">${r.progress ?? 0}%</strong></span>
      ${r.chunk_total ? `<span>Chunk ${r.chunk_index ?? 0}/${r.chunk_total}</span>` : ''}
      <span>Wartet: ${fmtDur(r.waiting_sec)}</span>
      <span>Laeuft: ${fmtDur(r.running_sec)}</span>
      ${r.vcpu_seconds != null ? `<span>vCPU-Sek: ${fmtNumber(r.vcpu_seconds)}</span>` : ''}
      ${r.job_execution ? `<span title="${htmlEscape(r.job_execution)}">Job: ${htmlEscape(r.job_execution.split('/').pop() || r.job_execution)}</span>` : ''}
    </div>
    ${(r.progress != null) ? `<div style="height:6px;border-radius:4px;background:rgba(255,255,255,.07);margin-bottom:8px;overflow:hidden">
      <div style="height:100%;width:${Math.min(100, Math.max(0, r.progress))}%;background:${sc};border-radius:4px"></div></div>` : ''}
    ${r.error ? `<div style="font-size:12px;color:#f87171;background:rgba(239,68,68,.08);border-radius:6px;padding:7px 10px;margin-bottom:8px">
      ${htmlEscape(r.error_class || 'error')}: ${htmlEscape(r.error)}</div>` : ''}
    ${canRetry ? `<div style="display:flex;gap:8px"><button class="btn btn-ghost" data-act="retry" style="padding:6px 13px;font-size:12.5px;color:#F59E0B">${iconHtml('refresh')} Neu starten</button></div>` : ''}
  </div>`
}

function render(container, d) {
  const s = d.summary || {}
  const lampColor = LAMP_COLOR[s.lamp] || '#9CA3AF'
  container.innerHTML = `
    <div class="panel-head">
      <div class="panel-head-left">
        <div class="panel-title">hozd-cast — Render-Queue</div>
        <div class="panel-sub">Ampel: <span style="color:${lampColor};font-weight:700">${htmlEscape((s.lamp || '—').toUpperCase())}</span> · aus der RPC, nicht im Browser berechnet</div>
      </div>
      <button class="btn btn-ghost" id="hcr-refresh">${iconHtml('refresh')} Aktualisieren</button>
    </div>

    <div class="hero-row">
      <div class="stat-hero"><div class="stat-value">${fmtNumber(s.queued || 0)}</div><div class="stat-label">wartend</div></div>
      <div class="stat-hero"><div class="stat-value">${fmtNumber(s.rendering || 0)}</div><div class="stat-label">rendert</div></div>
      <div class="stat-hero"><div class="stat-value" style="color:${s.failed ? '#EF4444' : undefined}">${fmtNumber(s.failed || 0)}</div><div class="stat-label">fehlgeschlagen</div></div>
      <div class="stat-hero"><div class="stat-value">${fmtDur(s.oldest_queued_sec)}</div><div class="stat-label">aeltestes Warten</div></div>
    </div>

    <div style="display:flex;gap:8px;margin:4px 0 14px;flex-wrap:wrap">
      ${['open', 'queued', 'rendering', 'failed', 'done', 'all'].map(k => `
        <button class="btn ${_state === k ? '' : 'btn-ghost'}" data-state="${k}" style="${_state === k ? 'background:#7C5CFF;color:#fff;border:none' : ''}">${STATE_LABEL[k]}</button>
      `).join('')}
    </div>

    ${d.rows && d.rows.length ? d.rows.map(row).join('') : `<div class="panel-section" style="text-align:center;padding:34px;color:var(--text-muted,#9CA3AF)">Keine Renders in diesem Filter.</div>`}
  `

  container.querySelector('#hcr-refresh')?.addEventListener('click', () => load(container))
  container.querySelectorAll('[data-state]').forEach(btn => {
    btn.addEventListener('click', () => { _state = btn.getAttribute('data-state'); load(container) })
  })
  container.querySelectorAll('[data-render]').forEach(el => {
    const renderId = el.getAttribute('data-render')
    const sessionId = el.getAttribute('data-session')
    const rrow = (d.rows || []).find(x => String(x.render_id) === renderId)
    el.querySelector('[data-act="retry"]')?.addEventListener('click', () => retry(container, sessionId, rrow))
  })
}

async function retry(container, sessionId, r) {
  const label = r ? `„${r.title || r.code || sessionId}"` : sessionId
  if (!window.confirm(`Render fuer ${label} wirklich neu starten?`)) return
  try {
    const { data, error } = await sb.rpc('admin_hozdcast_moderate', { p_session: sessionId, p_action: 'retry' })
    if (error) throw error
    if (data && data.ok === false) throw new Error(data.error || 'retry fehlgeschlagen')
    toast('Render neu gestartet', 'success')
    await load(container)
  } catch (e) {
    toast('Retry fehlgeschlagen: ' + (e?.message || e), 'error')
  }
}

async function load(container) {
  container.innerHTML = `<div class="panel-section" style="text-align:center;padding:40px;color:var(--text-muted,#9CA3AF)">Lädt Render-Queue…</div>`
  try {
    const { data, error } = await sb.rpc('admin_hozdcast_renders', { p_state: _state, p_limit: 50 })
    if (error) throw error
    if (!data) throw new Error('Keine Daten')
    render(container, data)
  } catch (e) {
    console.error('[hozdcast-render-queue]', e)
    const msg = (e && e.message) || 'Fehler'
    container.innerHTML = `<div class="panel-section" style="text-align:center;padding:40px;color:#EF4444">
      Render-Queue konnte nicht geladen werden.<br><span style="font-size:12px;color:var(--text-muted,#9CA3AF)">${htmlEscape(msg)}</span></div>`
    toast('Render-Queue: ' + msg, 'error')
  }
}

export default {
  id: 'hozdcast-render-queue',
  title: 'hozd-cast Render-Queue',
  icon: 'refresh-cw',
  async mount(container) {
    _state = 'open'
    await load(container)
  }
}
