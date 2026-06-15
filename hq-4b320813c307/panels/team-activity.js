// TEAM-AKTIVITÄT — Live-Karte der Agenten-Läufe (Telegram-/auftrag + CRM-Bridge).
// Michael 15.6.: "die Teams die für hozd zuständig sind, eine Karte wo ich sehe
// was die letzten Tasks waren, live wenn sie an Aufgaben arbeiten." Quelle:
// public.agent_runs (von den Bridges via Edge-Fn agent-run-ingest gespiegelt).
// Realtime: abonniert agent_runs → laufende Tasks aktualisieren sich live.
import { sb } from '/lib/supabase.js?v=20260610q'
import { iconHtml, htmlEscape, fmtRelativeTime, fmtDateTime, toast } from '/lib/ui.js?v=20260610q'

const COL = { running: '#8B5CF6', done: '#22C55E', error: '#EF4444', queued: '#9CA3AF' }
const STATUS_LABEL = { running: 'läuft', done: 'fertig', error: 'Fehler', queued: 'wartet' }
const esc = (s) => htmlEscape(String(s ?? ''))

let _channel = null
let _onlyHozd = true

async function fetchRuns() {
  let q = sb.from('agent_runs').select('*').order('updated_at', { ascending: false }).limit(40)
  if (_onlyHozd) q = q.eq('is_hozd', true)
  const { data, error } = await q
  if (error) return { rows: [], error }
  return { rows: data || [], error: null }
}

function statusBadge(s) {
  const c = COL[s] || COL.queued
  const pulse = s === 'running' ? ' ta-pulse' : ''
  return `<span class="ta-badge${pulse}" style="color:${c};border-color:${c}55;background:${c}1a">${esc(STATUS_LABEL[s] || s)}</span>`
}

function runRow(r) {
  const c = COL[r.status] || COL.queued
  const when = r.status === 'done' || r.status === 'error'
    ? fmtRelativeTime(r.finished_at || r.updated_at)
    : fmtRelativeTime(r.started_at || r.updated_at)
  const prog = r.status === 'running'
    ? `<div class="ta-prog"><div class="ta-prog-fill" style="width:${Math.max(6, r.progress || 10)}%"></div></div>`
    : ''
  const sub = [r.progress_text, r.team].filter(Boolean).map(esc).join(' · ')
  const vault = r.vault_ref ? `<span class="ta-vault" title="${esc(r.vault_ref)}">📓</span>` : ''
  return `
    <div class="ta-row" data-id="${esc(r.id)}" style="border-left:3px solid ${c}">
      <div class="ta-row-top">
        <span class="ta-agent">${esc(r.agent_name || r.agent_slug)}</span>
        ${statusBadge(r.status)}
        ${r.is_hozd ? '<span class="ta-tag-hozd">hozd</span>' : ''}
        <span class="ta-when">${esc(when)}</span>
      </div>
      <div class="ta-task">${esc(r.task_text || '(ohne Beschreibung)')}</div>
      ${prog}
      ${sub ? `<div class="ta-meta">${sub} ${vault}</div>` : (vault ? `<div class="ta-meta">${vault}</div>` : '')}
    </div>`
}

function render(container, rows, error) {
  const running = rows.filter(r => r.status === 'running')
  const since = Date.now() - 864e5
  const doneToday = rows.filter(r => r.status === 'done' && new Date(r.finished_at || r.updated_at).getTime() > since).length
  const errToday = rows.filter(r => r.status === 'error' && new Date(r.updated_at).getTime() > since).length
  const agents = new Set(rows.map(r => r.agent_slug)).size

  const hero = `
    <div class="hero-row" style="grid-template-columns:repeat(4,1fr)">
      <div class="stat-hero"><div class="stat-value" style="color:${COL.running}">${running.length}</div><div class="stat-label">läuft gerade</div></div>
      <div class="stat-hero"><div class="stat-value" style="color:${COL.done}">${doneToday}</div><div class="stat-label">fertig (24h)</div></div>
      <div class="stat-hero"><div class="stat-value" style="color:${errToday ? COL.error : 'inherit'}">${errToday}</div><div class="stat-label">Fehler (24h)</div></div>
      <div class="stat-hero"><div class="stat-value">${agents}</div><div class="stat-label">Agenten</div></div>
    </div>`

  const runningBlock = running.length ? `
    <div class="panel-section">
      <div class="panel-section-title">${iconHtml('activity')} Arbeitet gerade</div>
      ${running.map(runRow).join('')}
    </div>` : ''

  const recent = rows.filter(r => r.status !== 'running')
  const recentBlock = `
    <div class="panel-section">
      <div class="panel-section-title">Letzte Tasks</div>
      ${recent.length ? recent.map(runRow).join('') : `<div class="ta-empty">${error ? 'Tabelle agent_runs noch nicht angelegt oder keine Rechte.' : 'Noch keine Läufe aufgezeichnet. Sobald ein Agent eine Aufgabe übernimmt, erscheint sie hier live.'}</div>`}
    </div>`

  container.querySelector('.ta-body').innerHTML = hero + runningBlock + recentBlock
}

export default {
  id: 'team-activity',
  title: 'Team-Aktivität',
  icon: 'user',
  async mount(container) {
    container.innerHTML = `
      <style>
        .ta-badge{font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;border:1px solid;letter-spacing:.2px}
        .ta-pulse{animation:taPulse 1.4s ease-in-out infinite}
        @keyframes taPulse{0%,100%{opacity:1}50%{opacity:.45}}
        .ta-row{padding:11px 13px;margin:8px 0;border-radius:10px;background:rgba(255,255,255,.025)}
        .ta-row-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
        .ta-agent{font-weight:700;font-size:13.5px}
        .ta-tag-hozd{font-size:10px;font-weight:800;color:#8B5CF6;background:#8B5CF61a;border:1px solid #8B5CF655;border-radius:6px;padding:1px 6px;text-transform:uppercase;letter-spacing:.4px}
        .ta-when{margin-left:auto;font-size:11.5px;color:#9CA3AF}
        .ta-task{font-size:13px;line-height:1.4;margin-top:5px;color:#D1D5DB;overflow-wrap:anywhere}
        .ta-meta{font-size:11.5px;color:#9CA3AF;margin-top:5px;display:flex;align-items:center;gap:6px}
        .ta-vault{cursor:help}
        .ta-prog{height:5px;border-radius:999px;background:rgba(255,255,255,.08);margin-top:8px;overflow:hidden}
        .ta-prog-fill{height:100%;background:linear-gradient(90deg,#8B5CF6,#A78BFA);border-radius:999px;transition:width .6s ease}
        .ta-empty{font-size:13px;color:#9CA3AF;padding:18px 4px;text-align:center}
        .ta-seg{display:flex;gap:6px}
        .ta-seg button{font-size:12px;padding:5px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.12);background:transparent;color:#9CA3AF;cursor:pointer}
        .ta-seg button.on{background:#8B5CF61a;border-color:#8B5CF6;color:#fff}
      </style>
      <div class="panel-shell">
        <div class="panel-head">
          <div class="panel-head-left">
            <div class="panel-title">Team-Aktivität</div>
            <div class="panel-sub">Was deine Agenten gerade & zuletzt für hozd erledigen — live</div>
          </div>
          <div class="ta-seg">
            <button data-f="hozd" class="on">nur hozd</button>
            <button data-f="all">alle</button>
          </div>
        </div>
        <div class="ta-body"><div class="ta-empty">Lädt…</div></div>
      </div>`

    const refresh = async () => {
      const { rows, error } = await fetchRuns()
      render(container, rows, error)
    }

    container.querySelectorAll('.ta-seg button').forEach(btn => {
      btn.addEventListener('click', () => {
        _onlyHozd = btn.dataset.f === 'hozd'
        container.querySelectorAll('.ta-seg button').forEach(b => b.classList.toggle('on', b === btn))
        refresh()
      })
    })

    await refresh()

    // Realtime: jede Änderung an agent_runs → neu laden (debounced).
    try {
      let t = null
      _channel = sb.channel('agent_runs_live')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'agent_runs' }, () => {
          clearTimeout(t); t = setTimeout(refresh, 400)
        })
        .subscribe()
    } catch (_) { /* Realtime optional — Polling-Fallback unten */ }

    // Sanfter Polling-Fallback (10s) falls Realtime nicht greift.
    this._poll = setInterval(refresh, 10000)
  },
  unmount() {
    try { if (_channel) sb.removeChannel(_channel) } catch (_) {}
    _channel = null
    if (this._poll) { clearInterval(this._poll); this._poll = null }
  }
}
