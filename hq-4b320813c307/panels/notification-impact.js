// Notification-Wirkung — welche Push-/Notif-Typen ziehen (gelesen) vs. nerven
// (ignoriert). Produktsignal für Drossel-Entscheidungen: z.B. at_all ~48% gelesen
// (Kandidat zum Drosseln) vs. like/comment ~98%. Daten: admin_notification_read_rates().
import { sb } from '/lib/supabase.js?v=20260610q'
import { fmtNumber, iconHtml, htmlEscape, toast } from '/lib/ui.js?v=20260610q'

const TYPE_LABEL = {
  like: 'Like', comment: 'Kommentar', comment_like: 'Kommentar-Like', reply: 'Antwort',
  follow: 'Follow', new_post: 'Neuer Beitrag', new_episode: 'Neue Folge', at_all: '@all-Broadcast',
  chat_message: 'Chat-Nachricht', chat_reaction: 'Chat-Reaktion', bubble: 'Bubble',
  mention: 'Erwähnung', achievement: 'Achievement', repost: 'Repost', voice_comment: 'Sprach-Kommentar',
  co_host_suggest: 'Co-Host-Vorschlag', podcast_favorite: 'Podcast-Favorit',
}
function label(t) { return TYPE_LABEL[t] || t }

let _mode = 'all' // 'all' | '30d'

function readColor(pct) {
  if (pct >= 80) return '#22C55E'
  if (pct >= 60) return '#F59E0B'
  return '#EF4444'
}

function rateRows(rows) {
  if (!rows || !rows.length) return '<div class="card-sub">Keine Daten</div>'
  const maxVol = Math.max(...rows.map(r => r.total || 0), 1)
  return rows.map(r => {
    const pct = r.read_pct ?? 0
    const col = readColor(pct)
    const volW = Math.max(3, Math.round(((r.total || 0) / maxVol) * 100))
    const flag = pct < 60 ? ' <span style="color:#EF4444;font-size:10.5px;font-weight:600">⚠ Drossel-Kandidat</span>' : ''
    return `<div style="margin-bottom:13px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin-bottom:4px">
        <span style="font-size:13px;color:var(--text,#fff)">${htmlEscape(label(r.type))}${flag}</span>
        <span style="font-size:12px;color:var(--text-muted,#9CA3AF)">${fmtNumber(r.total || 0)} · <strong style="color:${col}">${pct}% gelesen</strong></span>
      </div>
      <div style="position:relative;height:8px;border-radius:6px;background:rgba(255,255,255,0.06);overflow:hidden">
        <div title="Volumen" style="position:absolute;inset:0;width:${volW}%;background:rgba(255,255,255,0.07)"></div>
        <div title="gelesen %" style="position:absolute;inset:0;width:${Math.min(100, pct)}%;background:${col};border-radius:6px;opacity:.92"></div>
      </div>
    </div>`
  }).join('')
}

function render(container, d) {
  const rows = _mode === '30d' ? (d.by_type_30d || []) : (d.by_type || [])
  const totalShown = _mode === '30d' ? (d.total_30d || 0) : (d.total || 0)
  const lowReaders = rows.filter(r => (r.read_pct ?? 0) < 60).sort((a, b) => (b.total || 0) - (a.total || 0))

  container.innerHTML = `
    <div class="panel-head">
      <div class="panel-head-left">
        <div class="panel-title">Notification-Wirkung</div>
        <div class="panel-sub">Welche Typen gelesen werden vs. ignoriert — Drossel-Signal · Stand ${new Date(d.generated_at).toLocaleString('de-AT', { dateStyle: 'short', timeStyle: 'short' })}</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <div style="display:inline-flex;background:rgba(255,255,255,.04);border-radius:10px;padding:3px">
          <button class="btn btn-ghost" id="ni-all" style="padding:5px 11px;border-radius:8px;${_mode === 'all' ? 'background:rgba(124,92,255,.2)' : ''}">Gesamt</button>
          <button class="btn btn-ghost" id="ni-30d" style="padding:5px 11px;border-radius:8px;${_mode === '30d' ? 'background:rgba(124,92,255,.2)' : ''}">30 Tage</button>
        </div>
        <button class="btn btn-ghost" id="ni-refresh">${iconHtml('refresh')}</button>
      </div>
    </div>

    <div class="hero-row">
      <div class="stat-hero"><div class="stat-value">${fmtNumber(totalShown)}</div><div class="stat-label">Notifications${_mode === '30d' ? ' (30 T)' : ' gesamt'}</div></div>
      <div class="stat-hero"><div class="stat-value" style="color:${readColor(d.read_pct_overall || 0)}">${d.read_pct_overall || 0}%</div><div class="stat-label">gelesen gesamt</div></div>
      <div class="stat-hero"><div class="stat-value" style="color:${lowReaders.length ? '#EF4444' : '#22C55E'}">${lowReaders.length}</div><div class="stat-label">Drossel-Kandidaten (&lt;60%)</div></div>
    </div>

    ${lowReaders.length ? `<div class="panel-section" style="border:1px solid rgba(245,158,11,.25);background:rgba(245,158,11,.06)">
      <div style="font-size:13px;color:#FbBf24"><strong>Drossel-Kandidaten:</strong> ${lowReaders.slice(0, 5).map(r => `${htmlEscape(label(r.type))} (${r.read_pct}%, ${fmtNumber(r.total)}×)`).join(' · ')}</div>
      <div style="font-size:11.5px;color:var(--text-muted,#9CA3AF);margin-top:5px">Niedrige Lese-Quote bei hohem Volumen = nervt eher als zu ziehen. Kandidat für seltener-senden / zusammenfassen.</div>
    </div>` : ''}

    <div class="panel-section">
      <div class="card-header"><strong>Lese-Quote pro Typ</strong><span class="card-sub">nach Volumen · farbiger Balken = gelesen %, grauer = Volumen</span></div>
      ${rateRows(rows)}
    </div>
  `

  const refresh = container.querySelector('#ni-refresh')
  if (refresh) refresh.addEventListener('click', () => load(container))
  container.querySelector('#ni-all')?.addEventListener('click', () => { _mode = 'all'; render(container, d) })
  container.querySelector('#ni-30d')?.addEventListener('click', () => { _mode = '30d'; render(container, d) })
}

async function load(container) {
  container.innerHTML = `<div class="panel-section" style="text-align:center;padding:40px;color:var(--text-muted,#9CA3AF)">Lädt Notification-Wirkung…</div>`
  try {
    const { data, error } = await sb.rpc('admin_notification_read_rates')
    if (error) throw error
    if (!data) throw new Error('Keine Daten')
    render(container, data)
  } catch (e) {
    console.error('[notification-impact]', e)
    const msg = (e && e.message) || 'Fehler'
    container.innerHTML = `<div class="panel-section" style="text-align:center;padding:40px;color:#EF4444">
      Notification-Daten konnten nicht geladen werden.<br><span style="font-size:12px;color:var(--text-muted,#9CA3AF)">${htmlEscape(msg)}</span><br>
      <span style="font-size:11px;color:var(--text-muted,#9CA3AF)">(Migration 20260614040000 deployt?)</span></div>`
    toast('Notification-Panel: ' + msg, 'error')
  }
}

export default {
  id: 'notification-impact',
  title: 'Notification-Wirkung',
  icon: 'bell',
  async mount(container) {
    await load(container)
  }
}
