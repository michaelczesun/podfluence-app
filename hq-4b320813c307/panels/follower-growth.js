// Follower-Growth — wer gerade zieht. Top-Gainer (neue Follower 7d/30d) als
// Leaderboard → Basis für Spotlight/Outreach. Daten: admin_follower_growth().
import { sb } from '/lib/supabase.js?v=20260610q'
import { fmtNumber, iconHtml, htmlEscape, toast } from '/lib/ui.js?v=20260610q'

let _mode = '7d' // '7d' | '30d'

function initials(name) {
  return (name || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()
}

function statTile(label, value, sub) {
  return `<div class="stat-hero"><div class="stat-value">${value}</div><div class="stat-label">${htmlEscape(label)}</div>${sub ? `<div class="stat-label" style="opacity:.7">${htmlEscape(sub)}</div>` : ''}</div>`
}

function rows(list) {
  if (!list || !list.length) return '<div class="card-sub" style="padding:14px">Keine neuen Follower im Zeitraum.</div>'
  const max = Math.max(...list.map(r => r.gained || 0), 1)
  return list.map((r, i) => {
    const w = Math.max(4, Math.round((r.gained || 0) / max * 100))
    const av = r.avatar
      ? `<img src="${htmlEscape(r.avatar)}" alt="" style="width:36px;height:36px;border-radius:50%;object-fit:cover;flex-shrink:0">`
      : `<div style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#7C5CFF,#5b3fd6);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;flex-shrink:0">${htmlEscape(initials(r.name))}</div>`
    const rank = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `<span style="color:var(--text-dim,#6B7280);font-size:13px;width:20px;display:inline-block;text-align:center">${i + 1}</span>`
    return `<div style="display:flex;align-items:center;gap:12px;padding:9px 0;border-bottom:1px solid rgba(255,255,255,0.05)">
      <span style="width:24px;text-align:center;font-size:15px">${rank}</span>
      ${av}
      <div style="min-width:0;flex:1">
        <div style="font-size:13.5px;color:var(--text,#fff);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${htmlEscape(r.name || r.username || '—')}</div>
        <div style="font-size:11.5px;color:var(--text-muted,#9CA3AF)">@${htmlEscape(r.username || '—')} · ${fmtNumber(r.total || 0)} Follower gesamt</div>
      </div>
      <div style="min-width:120px;display:flex;align-items:center;gap:8px">
        <div style="flex:1;height:6px;border-radius:4px;background:rgba(255,255,255,0.06)"><div style="height:100%;width:${w}%;background:#22C55E;border-radius:4px"></div></div>
        <span style="font-size:13px;font-weight:700;color:#22C55E;white-space:nowrap">+${fmtNumber(r.gained || 0)}</span>
      </div>
    </div>`
  }).join('')
}

function render(container, d) {
  const list = _mode === '30d' ? (d.top_30d || []) : (d.top_7d || [])
  const newCount = _mode === '30d' ? (d.new_30d || 0) : (d.new_7d || 0)

  container.innerHTML = `
    <div class="panel-head">
      <div class="panel-head-left">
        <div class="panel-title">Follower-Growth</div>
        <div class="panel-sub">Wer gerade zieht — Top-Gainer für Spotlight/Outreach · Stand ${new Date(d.generated_at).toLocaleString('de-AT', { dateStyle: 'short', timeStyle: 'short' })}</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <div style="display:inline-flex;background:rgba(255,255,255,.04);border-radius:10px;padding:3px">
          <button class="btn btn-ghost" id="fg-7d" style="padding:5px 11px;border-radius:8px;${_mode === '7d' ? 'background:rgba(124,92,255,.2)' : ''}">7 Tage</button>
          <button class="btn btn-ghost" id="fg-30d" style="padding:5px 11px;border-radius:8px;${_mode === '30d' ? 'background:rgba(124,92,255,.2)' : ''}">30 Tage</button>
        </div>
        <button class="btn btn-ghost" id="fg-refresh">${iconHtml('refresh')}</button>
      </div>
    </div>

    <div class="hero-row">
      ${statTile('Follows gesamt', fmtNumber(d.total_follows || 0))}
      ${statTile(`Neu (${_mode === '30d' ? '30 T' : '7 T'})`, fmtNumber(newCount), 'neue Follows im Zeitraum')}
      ${statTile('Top-Gainer', list.length ? `@${htmlEscape((list[0].username || '—'))}` : '—', list.length ? `+${fmtNumber(list[0].gained)} Follower` : '')}
    </div>

    <div class="panel-section">
      <div class="card-header"><strong>Top-Gainer (${_mode === '30d' ? '30 Tage' : '7 Tage'})</strong><span class="card-sub">neue Follower</span></div>
      ${rows(list)}
    </div>
  `

  container.querySelector('#fg-refresh')?.addEventListener('click', () => load(container))
  container.querySelector('#fg-7d')?.addEventListener('click', () => { _mode = '7d'; render(container, d) })
  container.querySelector('#fg-30d')?.addEventListener('click', () => { _mode = '30d'; render(container, d) })
}

async function load(container) {
  container.innerHTML = `<div class="panel-section" style="text-align:center;padding:40px;color:var(--text-muted,#9CA3AF)">Lädt Follower-Growth…</div>`
  try {
    const { data, error } = await sb.rpc('admin_follower_growth', { p_limit: 15 })
    if (error) throw error
    if (!data) throw new Error('Keine Daten')
    render(container, data)
  } catch (e) {
    console.error('[follower-growth]', e)
    const msg = (e && e.message) || 'Fehler'
    container.innerHTML = `<div class="panel-section" style="text-align:center;padding:40px;color:#EF4444">
      Follower-Growth konnte nicht geladen werden.<br><span style="font-size:12px;color:var(--text-muted,#9CA3AF)">${htmlEscape(msg)}</span><br>
      <span style="font-size:11px;color:var(--text-muted,#9CA3AF)">(Migration 20260614050000 deployt?)</span></div>`
    toast('Follower-Growth: ' + msg, 'error')
  }
}

export default {
  id: 'follower-growth',
  title: 'Follower-Growth',
  icon: 'trending-up',
  async mount(container) {
    await load(container)
  }
}
