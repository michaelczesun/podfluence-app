// Ads-Manager — spiegelt die App-Admin-Ads-Verwaltung ins CRM (app/admin/ads.tsx
// + ads-create.tsx). Liste, Impressions, Aktiv-Toggle, Löschen, Anlegen.
// Direkter Tabellenzugriff (RLS gated Admins, wie die App). Tabellen: ads, ad_impressions.
import { sb } from '/lib/supabase.js?v=20260610q'
import { fmtNumber, iconHtml, htmlEscape, toast } from '/lib/ui.js?v=20260610q'

let _showForm = false

const UTYPE_LABEL = { podcaster: 'Podcaster', listener: 'Hörer', '': 'Alle' }

async function fetchData() {
  const { data: ads, error } = await sb.from('ads').select('*').order('created_at', { ascending: false })
  if (error) throw error
  // Impressions pro Ad zählen (ad_impressions.ad_id)
  const counts = {}
  try {
    const { data: imps } = await sb.from('ad_impressions').select('ad_id')
    for (const r of (imps || [])) counts[r.ad_id] = (counts[r.ad_id] || 0) + 1
  } catch (_) { /* impressions optional */ }
  return { ads: ads || [], counts }
}

function adRow(a, imps) {
  const ut = a.target_user_type || ''
  const utBadge = `<span style="font-size:10.5px;padding:2px 8px;border-radius:999px;background:rgba(124,92,255,.16);color:#b9a6ff">${htmlEscape(UTYPE_LABEL[ut] || ut)}</span>`
  const capParts = []
  if (a.max_impressions_total) capParts.push(`max ${fmtNumber(a.max_impressions_total)}`)
  if (a.max_impressions_per_user) capParts.push(`${a.max_impressions_per_user}/User`)
  if (a.frequency_every_n) capParts.push(`jede ${a.frequency_every_n}.`)
  const thumb = a.media_url
    ? `<img src="${htmlEscape(a.media_url)}" alt="" style="width:54px;height:54px;border-radius:10px;object-fit:cover;flex-shrink:0;background:rgba(255,255,255,.05)">`
    : `<div style="width:54px;height:54px;border-radius:10px;background:rgba(255,255,255,.06);display:flex;align-items:center;justify-content:center;flex-shrink:0">${iconHtml('image')}</div>`
  return `<div style="display:flex;align-items:center;gap:13px;padding:12px 0;border-bottom:1px solid rgba(255,255,255,0.05)" data-ad="${htmlEscape(a.id)}">
    ${thumb}
    <div style="min-width:0;flex:1">
      <div style="font-size:13.5px;color:var(--text,#fff);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${htmlEscape(a.title || '—')}</div>
      <div style="font-size:11.5px;color:var(--text-muted,#9CA3AF);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${utBadge} · ${htmlEscape(a.placement || '—')}${capParts.length ? ' · ' + htmlEscape(capParts.join(' · ')) : ''}</div>
      ${a.target_url ? `<div style="font-size:11px;color:#7C5CFF;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">→ ${htmlEscape(a.target_url)}</div>` : ''}
    </div>
    <div style="text-align:right;flex-shrink:0">
      <div style="font-size:15px;font-weight:700;color:var(--text,#fff)">${fmtNumber(imps)}</div>
      <div style="font-size:10.5px;color:var(--text-muted,#9CA3AF)">Impressions</div>
    </div>
    <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0">
      <button class="btn btn-ghost" data-act="toggle" style="padding:5px 11px;font-size:12px;${a.is_active ? 'color:#22C55E' : 'color:#9CA3AF'}">${a.is_active ? '● Aktiv' : '○ Pausiert'}</button>
      <button class="btn btn-ghost" data-act="del" style="padding:5px 11px;font-size:12px;color:#EF4444">Löschen</button>
    </div>
  </div>`
}

function createForm() {
  return `<div class="panel-section" id="ads-form" style="border:1px solid rgba(124,92,255,.25)">
    <div class="card-header"><strong>Neue Ad anlegen</strong></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px">
      <label style="font-size:12px;color:var(--text-muted)">Titel*<input id="ad-title" type="text" placeholder="Anzeigentitel" style="width:100%;margin-top:4px;padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04);color:inherit"></label>
      <label style="font-size:12px;color:var(--text-muted)">Bild-URL* (Upload via App oder URL)<input id="ad-media" type="text" placeholder="https://…" style="width:100%;margin-top:4px;padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04);color:inherit"></label>
      <label style="font-size:12px;color:var(--text-muted)">Ziel-URL*<input id="ad-target" type="text" placeholder="https://…" style="width:100%;margin-top:4px;padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04);color:inherit"></label>
      <label style="font-size:12px;color:var(--text-muted)">Caption<input id="ad-caption" type="text" placeholder="optionaler Untertitel" style="width:100%;margin-top:4px;padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04);color:inherit"></label>
      <label style="font-size:12px;color:var(--text-muted)">Zielgruppe<select id="ad-utype" style="width:100%;margin-top:4px;padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04);color:inherit"><option value="">Alle</option><option value="podcaster">Podcaster</option><option value="listener">Hörer</option></select></label>
      <label style="font-size:12px;color:var(--text-muted)">Platzierung<input id="ad-placement" type="text" value="home_feed" style="width:100%;margin-top:4px;padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04);color:inherit"></label>
      <label style="font-size:12px;color:var(--text-muted)">Jede N-te Position<input id="ad-everyn" type="number" value="4" min="1" style="width:100%;margin-top:4px;padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04);color:inherit"></label>
      <label style="font-size:12px;color:var(--text-muted)">Chance %<input id="ad-chance" type="number" value="100" min="0" max="100" style="width:100%;margin-top:4px;padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04);color:inherit"></label>
      <label style="font-size:12px;color:var(--text-muted)">Max Impressions gesamt<input id="ad-maxtotal" type="number" placeholder="leer = ∞" min="0" style="width:100%;margin-top:4px;padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04);color:inherit"></label>
      <label style="font-size:12px;color:var(--text-muted)">Max pro User<input id="ad-maxuser" type="number" placeholder="leer = ∞" min="0" style="width:100%;margin-top:4px;padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04);color:inherit"></label>
    </div>
    <div style="display:flex;gap:10px;margin-top:14px">
      <button class="btn" id="ad-save" style="background:#7C5CFF;color:#fff;border:none">Ad anlegen (aktiv)</button>
      <button class="btn btn-ghost" id="ad-cancel">Abbrechen</button>
    </div>
  </div>`
}

function render(container, d) {
  const active = d.ads.filter(a => a.is_active).length
  const totalImps = Object.values(d.counts).reduce((s, n) => s + n, 0)

  container.innerHTML = `
    <div class="panel-head">
      <div class="panel-head-left">
        <div class="panel-title">Ads-Manager</div>
        <div class="panel-sub">Anzeigen verwalten — wie in der App-Admin, jetzt im CRM</div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn" id="ads-new" style="background:#7C5CFF;color:#fff;border:none">${iconHtml('plus')} Neue Ad</button>
        <button class="btn btn-ghost" id="ads-refresh">${iconHtml('refresh')}</button>
      </div>
    </div>

    <div class="hero-row">
      <div class="stat-hero"><div class="stat-value">${fmtNumber(d.ads.length)}</div><div class="stat-label">Ads gesamt</div></div>
      <div class="stat-hero"><div class="stat-value" style="color:${active ? '#22C55E' : '#9CA3AF'}">${fmtNumber(active)}</div><div class="stat-label">aktiv</div></div>
      <div class="stat-hero"><div class="stat-value">${fmtNumber(totalImps)}</div><div class="stat-label">Impressions gesamt</div></div>
    </div>

    ${_showForm ? createForm() : ''}

    <div class="panel-section">
      <div class="card-header"><strong>Alle Ads</strong></div>
      ${d.ads.length ? d.ads.map(a => adRow(a, d.counts[a.id] || 0)).join('') : '<div class="card-sub" style="padding:18px;text-align:center">Noch keine Ads — über „Neue Ad" anlegen.</div>'}
    </div>
  `

  container.querySelector('#ads-refresh')?.addEventListener('click', () => load(container))
  container.querySelector('#ads-new')?.addEventListener('click', () => { _showForm = true; render(container, d) })
  container.querySelector('#ad-cancel')?.addEventListener('click', () => { _showForm = false; render(container, d) })
  container.querySelector('#ad-save')?.addEventListener('click', () => saveAd(container))

  container.querySelectorAll('[data-ad]').forEach(rowEl => {
    const id = rowEl.getAttribute('data-ad')
    const ad = d.ads.find(a => String(a.id) === id)
    rowEl.querySelector('[data-act="toggle"]')?.addEventListener('click', () => toggleAd(container, ad))
    rowEl.querySelector('[data-act="del"]')?.addEventListener('click', () => deleteAd(container, ad))
  })
}

async function toggleAd(container, ad) {
  try {
    const { error } = await sb.from('ads').update({ is_active: !ad.is_active }).eq('id', ad.id)
    if (error) throw error
    toast(`Ad ${!ad.is_active ? 'aktiviert' : 'pausiert'}`, 'success')
    await load(container)
  } catch (e) { toast('Toggle fehlgeschlagen: ' + (e?.message || e), 'error') }
}

async function deleteAd(container, ad) {
  if (!window.confirm(`Ad "${ad.title}" unwiderruflich löschen?`)) return
  try {
    const { error } = await sb.from('ads').delete().eq('id', ad.id)
    if (error) throw error
    toast('Ad gelöscht', 'success')
    await load(container)
  } catch (e) { toast('Löschen fehlgeschlagen: ' + (e?.message || e), 'error') }
}

async function saveAd(container) {
  const g = id => container.querySelector(id)
  const title = g('#ad-title')?.value.trim()
  const media = g('#ad-media')?.value.trim()
  const target = g('#ad-target')?.value.trim()
  if (!title || !media || !target) { toast('Titel, Bild-URL und Ziel-URL sind Pflicht', 'error'); return }
  const ut = g('#ad-utype')?.value || ''
  const everyN = parseInt(g('#ad-everyn')?.value || '4', 10)
  const chance = Math.max(0, Math.min(1, (parseInt(g('#ad-chance')?.value || '100', 10)) / 100))
  const maxTotal = g('#ad-maxtotal')?.value ? parseInt(g('#ad-maxtotal').value, 10) : null
  const maxUser = g('#ad-maxuser')?.value ? parseInt(g('#ad-maxuser').value, 10) : null
  let createdBy = null
  try { const { data } = await sb.auth.getUser(); createdBy = data?.user?.id || null } catch (_) {}
  const payload = {
    title, caption: g('#ad-caption')?.value.trim() || null,
    media_url: media, media_type: 'image', target_url: target,
    target_user_type: ut || null,
    frequency_every_n: everyN, frequency_chance: chance,
    max_impressions_total: maxTotal, max_impressions_per_user: maxUser,
    placement: g('#ad-placement')?.value.trim() || 'home_feed',
    is_active: true, created_by: createdBy,
  }
  try {
    const { error } = await sb.from('ads').insert(payload)
    if (error) throw error
    toast('Ad angelegt + aktiv', 'success')
    _showForm = false
    await load(container)
  } catch (e) { toast('Anlegen fehlgeschlagen: ' + (e?.message || e), 'error') }
}

async function load(container) {
  container.innerHTML = `<div class="panel-section" style="text-align:center;padding:40px;color:var(--text-muted,#9CA3AF)">Lädt Ads…</div>`
  try {
    const d = await fetchData()
    render(container, d)
  } catch (e) {
    console.error('[ads-manager]', e)
    const msg = (e && e.message) || 'Fehler'
    container.innerHTML = `<div class="panel-section" style="text-align:center;padding:40px;color:#EF4444">
      Ads konnten nicht geladen werden.<br><span style="font-size:12px;color:var(--text-muted,#9CA3AF)">${htmlEscape(msg)}</span></div>`
    toast('Ads-Manager: ' + msg, 'error')
  }
}

export default {
  id: 'ads-manager',
  title: 'Ads',
  icon: 'megaphone',
  async mount(container) {
    _showForm = false
    await load(container)
  }
}
