// Bot-Feedback — spiegelt die App-Admin-Queue ins CRM (app/admin/bot-feedback.tsx).
// Fragen/Wünsche/Bugs die der Bot mitschnitt aber nicht selbst beantworten konnte.
// Aktionen: "An Claude" (strukturierten Prompt in Zwischenablage + Status sent_to_claude),
// Erledigt (fixed), Wontfix. RPCs: admin_list_bot_feedback, admin_set_bot_feedback_status.
import { sb } from '/lib/supabase.js?v=20260610q'
import { iconHtml, htmlEscape, fmtRelativeTime, toast } from '/lib/ui.js?v=20260610q'

let _tab = 'new' // new | sent_to_claude | fixed | all

const TABS = [
  { value: 'new', label: 'Neu' },
  { value: 'sent_to_claude', label: 'An Claude' },
  { value: 'fixed', label: 'Erledigt' },
  { value: 'all', label: 'Alle' },
]
const CAT = {
  bug: ['#EF4444', 'Bug'],
  feature_wish: ['#F59E0B', 'Wunsch'],
  how_to_unknown: ['#A78BFA', 'Unbekanntes How-To'],
  other: ['#9CA3AF', 'Sonstiges'],
}

async function fetchData() {
  const { data, error } = await sb.rpc('admin_list_bot_feedback', {
    p_status: _tab === 'all' ? null : _tab,
    p_limit: 100,
  })
  if (error) throw error
  const rows = (data || []).map(r => ({ ...r, id: r.feedback_id ?? r.id }))
  // Neu-Count separat für Hero
  let newCount = 0
  try {
    const { data: nd } = await sb.rpc('admin_list_bot_feedback', { p_status: 'new', p_limit: 500 })
    newCount = (nd || []).length
  } catch (_) {}
  return { rows, newCount }
}

function buildClaudePrompt(r) {
  const cat = (CAT[r.category] || CAT.other)[1]
  const userLine = r.username ? `@${r.username}` : (r.full_name || 'anon')
  const ctx = r.context || {}
  const ctxStr = Object.entries(ctx)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `- ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join('\n')
  return `Bot-Feedback aus hozd (${cat}):

User: ${userLine}
Datum: ${new Date(r.created_at).toLocaleString('de-DE')}

Frage / Wunsch / Problem:
"${r.raw_question}"

Kontext:
${ctxStr || '(keiner)'}

→ Bitte umsetzen oder Empfehlung, wie's gelöst werden kann.`
}

function card(r) {
  const [cc, cl] = CAT[r.category] || CAT.other
  const src = r.context?.source
  return `<div class="panel-section" style="margin-bottom:10px" data-fb="${htmlEscape(r.id)}">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:7px">
      <span style="font-size:10.5px;padding:2px 9px;border-radius:999px;border:1px solid ${cc};color:${cc}">${htmlEscape(cl)}</span>
      <span style="font-size:11px;color:var(--text-muted,#9CA3AF)">${r.username ? '@' + htmlEscape(r.username) : 'anon'} · ${htmlEscape(fmtRelativeTime(r.created_at))}</span>
    </div>
    <div style="font-size:13.5px;color:var(--text,#fff);line-height:1.5;background:rgba(255,255,255,.03);border-radius:8px;padding:10px 12px;white-space:pre-wrap">${htmlEscape(r.raw_question || '')}</div>
    ${src ? `<div style="font-size:11px;color:var(--text-muted,#9CA3AF);margin-top:6px">Quelle: ${htmlEscape(src === 'comment' ? 'Kommentar' : src === 'dm' ? 'DM' : src)}${r.context?.update_id ? ` (Beitrag ${htmlEscape(String(r.context.update_id).slice(0, 8))}…)` : ''}</div>` : ''}
    <div style="display:flex;gap:8px;margin-top:11px;flex-wrap:wrap">
      <button class="btn" data-act="claude" style="padding:6px 13px;font-size:12.5px;background:#7C5CFF;color:#fff;border:none">${iconHtml('copy') || ''} An Claude</button>
      <button class="btn btn-ghost" data-act="fixed" style="padding:6px 13px;font-size:12.5px;color:#22C55E">Erledigt</button>
      <button class="btn btn-ghost" data-act="wontfix" style="padding:6px 13px;font-size:12.5px;color:var(--text-muted,#9CA3AF)">Wontfix</button>
    </div>
  </div>`
}

function render(container, d) {
  container.innerHTML = `
    <div class="panel-head">
      <div class="panel-head-left">
        <div class="panel-title">Bot-Feedback</div>
        <div class="panel-sub">Was der Bot nicht beantworten konnte — wie in der App-Admin, jetzt im CRM</div>
      </div>
      <div style="display:flex;gap:8px"><button class="btn btn-ghost" id="bf-refresh">${iconHtml('refresh')}</button></div>
    </div>

    <div class="hero-row">
      <div class="stat-hero"><div class="stat-value" style="color:${d.newCount ? '#F59E0B' : '#22C55E'}">${d.newCount}</div><div class="stat-label">neu</div></div>
    </div>

    <div style="display:flex;gap:8px;margin:4px 0 14px;flex-wrap:wrap">
      ${TABS.map(t => `<button class="btn ${_tab === t.value ? '' : 'btn-ghost'}" data-tab="${t.value}" style="${_tab === t.value ? 'background:#7C5CFF;color:#fff;border:none' : ''}">${t.label}</button>`).join('')}
    </div>

    ${d.rows.length ? d.rows.map(card).join('') : `<div class="panel-section" style="text-align:center;padding:34px;color:var(--text-muted,#9CA3AF)">${_tab === 'new' ? 'Nichts Neues. 🎉' : 'Nichts in dieser Kategorie.'}<br><span style="font-size:12px">Bot loggt hier automatisch unbekannte How-Tos, Bugs und Wünsche aus Kommentaren + DMs.</span></div>`}
  `

  container.querySelector('#bf-refresh')?.addEventListener('click', () => load(container))
  container.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => { _tab = b.getAttribute('data-tab'); load(container) }))
  container.querySelectorAll('[data-fb]').forEach(el => {
    const id = el.getAttribute('data-fb')
    const r = d.rows.find(x => String(x.id) === id)
    el.querySelector('[data-act="claude"]')?.addEventListener('click', () => sendToClaude(container, r))
    el.querySelector('[data-act="fixed"]')?.addEventListener('click', () => setStatus(container, r, 'fixed'))
    el.querySelector('[data-act="wontfix"]')?.addEventListener('click', () => setStatus(container, r, 'wontfix'))
  })
}

async function sendToClaude(container, r) {
  const prompt = buildClaudePrompt(r)
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(prompt)
    else throw new Error('clipboard nicht verfügbar')
    toast('Prompt in Zwischenablage — in Claude-Chat pasten', 'success')
    await setStatus(container, r, 'sent_to_claude', true)
  } catch (e) {
    // Fallback: Prompt in window.prompt zum manuellen Kopieren anzeigen
    window.prompt('Kopieren (Cmd+C):', prompt)
    await setStatus(container, r, 'sent_to_claude', true)
  }
}

async function setStatus(container, r, status, silent) {
  try {
    const { error } = await sb.rpc('admin_set_bot_feedback_status', { p_id: r.id, p_status: status })
    if (error) throw error
    if (!silent) toast(status === 'fixed' ? 'Als erledigt markiert' : status === 'wontfix' ? 'Als Wontfix markiert' : 'Status gesetzt', 'success')
    await load(container)
  } catch (e) { toast('Status fehlgeschlagen: ' + (e?.message || e), 'error') }
}

async function load(container) {
  container.innerHTML = `<div class="panel-section" style="text-align:center;padding:40px;color:var(--text-muted,#9CA3AF)">Lädt Feedback…</div>`
  try {
    render(container, await fetchData())
  } catch (e) {
    console.error('[bot-feedback]', e)
    const msg = (e && e.message) || 'Fehler'
    container.innerHTML = `<div class="panel-section" style="text-align:center;padding:40px;color:#EF4444">
      Bot-Feedback konnte nicht geladen werden.<br><span style="font-size:12px;color:var(--text-muted,#9CA3AF)">${htmlEscape(msg)}</span></div>`
    toast('Bot-Feedback: ' + msg, 'error')
  }
}

export default {
  id: 'bot-feedback',
  title: 'Bot-Feedback',
  icon: 'message-square',
  async mount(container) {
    _tab = 'new'
    await load(container)
  }
}
