// Podcast-Resolver — spiegelt das App-Admin-Tool ins CRM (app/admin/podcast-resolver.tsx).
// URL (Apple/Spotify/RSS/Letscast/Anchor/Podigee…) → Edge-Fn resolve-podcast-url →
// Cover/Titel/Author/RSS → bei gewähltem Podcast übernehmen (admin_update_podcast_meta RPC).
// Am Desktop deutlich angenehmer (URL pasten). Tabelle: podcasts. (Kein App-Cache zu busten.)
import { sb } from '/lib/supabase.js?v=20260610q'
import { iconHtml, htmlEscape, toast } from '/lib/ui.js?v=20260610q'

let _resolved = null      // { ok, rssUrl, title, coverImage, author, source, error, hint }
let _selectedId = null    // gewählter Podcast
let _podcasts = []        // Picker-Liste
let _search = ''

async function loadPodcasts(search) {
  const q = (search || '').trim()
  let query = sb.from('podcasts')
    .select('id, title, rss_url, cover_image, author_id, author:users!podcasts_author_id_fkey(username, full_name)')
    .order('created_at', { ascending: false }).limit(50)
  if (q) {
    // Titel-Match + Autor-Match (zwei Queries, gemerged + dedupe) — wie die App.
    const [byTitle, userRes] = await Promise.all([
      sb.from('podcasts').select('id, title, rss_url, cover_image, author_id, author:users!podcasts_author_id_fkey(username, full_name)').ilike('title', `%${q}%`).limit(50),
      sb.from('users').select('id').or(`username.ilike.%${q}%,full_name.ilike.%${q}%`).limit(50),
    ])
    const titleRows = byTitle.data || []
    let userPodcasts = []
    const userIds = (userRes.data || []).map(u => u.id)
    if (userIds.length) {
      const { data } = await sb.from('podcasts').select('id, title, rss_url, cover_image, author_id, author:users!podcasts_author_id_fkey(username, full_name)').in('author_id', userIds).limit(50)
      userPodcasts = data || []
    }
    const seen = new Set()
    _podcasts = [...titleRows, ...userPodcasts].filter(r => { if (seen.has(r.id)) return false; seen.add(r.id); return true })
      .map(r => ({ ...r, author: Array.isArray(r.author) ? r.author[0] : r.author }))
    return
  }
  const { data } = await query
  _podcasts = (data || []).map(r => ({ ...r, author: Array.isArray(r.author) ? r.author[0] : r.author }))
}

async function resolveUrl(container) {
  const url = container.querySelector('#pr-url')?.value.trim()
  if (!url) { toast('Bitte URL eingeben', 'error'); return }
  _resolved = null; _selectedId = null
  setBusy(container, true)
  try {
    // Edge-Fn via supabase-js (nutzt Session-Token automatisch).
    const { data, error } = await sb.functions.invoke('resolve-podcast-url', { body: { url } })
    if (error && !data) throw error
    _resolved = data || { ok: false, error: 'Keine Antwort' }
    if (_resolved.ok) await loadPodcasts('')
  } catch (e) {
    _resolved = { ok: false, error: e?.message || String(e) }
  }
  render(container)
}

function setBusy(container, busy) {
  const b = container.querySelector('#pr-resolve')
  if (b) { b.disabled = busy; b.textContent = busy ? 'Löst auf…' : 'Auflösen' }
}

async function apply(container) {
  if (!_selectedId || !_resolved?.ok || !_resolved.rssUrl) { toast('Podcast wählen + gültige URL auflösen', 'error'); return }
  const btn = container.querySelector('#pr-apply')
  if (btn) btn.disabled = true
  try {
    const { error } = await sb.rpc('admin_update_podcast_meta', {
      p_podcast_id: _selectedId,
      p_rss_url: _resolved.rssUrl,
      p_title: _resolved.title || null,
      p_cover_image: _resolved.coverImage || null,
    })
    if (error) throw error
    const p = _podcasts.find(x => x.id === _selectedId)
    toast(`Übernommen bei @${p?.author?.username || 'Podcast'} — RSS + Titel + Cover gesetzt`, 'success')
    _resolved = null; _selectedId = null
    const inp = container.querySelector('#pr-url'); if (inp) inp.value = ''
    render(container)
  } catch (e) {
    toast('Übernehmen fehlgeschlagen: ' + (e?.message || e), 'error')
    if (btn) btn.disabled = false
  }
}

function resolvedCard() {
  const r = _resolved
  if (!r) return ''
  if (!r.ok) {
    return `<div class="panel-section" style="border:1px solid rgba(239,68,68,.3)">
      <div style="color:#f87171;font-weight:600;font-size:13.5px">${iconHtml('alert-triangle')} ${htmlEscape(r.error || 'Nicht aufgelöst')}</div>
      ${r.hint ? `<div style="font-size:12px;color:var(--text-muted,#9CA3AF);margin-top:5px">${htmlEscape(r.hint)}</div>` : ''}
    </div>`
  }
  const cover = r.coverImage
    ? `<img src="${htmlEscape(r.coverImage)}" alt="" style="width:72px;height:72px;border-radius:10px;object-fit:cover;flex-shrink:0;background:rgba(255,255,255,.05)">`
    : `<div style="width:72px;height:72px;border-radius:10px;background:rgba(255,255,255,.06);flex-shrink:0"></div>`
  return `<div class="panel-section" style="border:1px solid rgba(34,197,94,.25)">
    <div style="color:#22C55E;font-weight:600;font-size:13px;margin-bottom:9px">${iconHtml('shield-check')} Gefunden via ${htmlEscape(r.source || '?')}</div>
    <div style="display:flex;gap:13px">
      ${cover}
      <div style="min-width:0;flex:1">
        <div style="font-size:15px;color:var(--text,#fff);font-weight:700">${htmlEscape(r.title || '—')}</div>
        <div style="font-size:12.5px;color:var(--text-muted,#9CA3AF)">von ${htmlEscape(r.author || '—')}</div>
        ${r.rssUrl ? `<div style="font-size:11px;color:var(--text-muted,#9CA3AF);margin-top:5px;word-break:break-all">${htmlEscape(r.rssUrl)}</div>` : '<div style="font-size:12px;color:#F59E0B;margin-top:5px">⚠️ Kein RSS-Feed dazu</div>'}
      </div>
    </div>
  </div>`
}

function pickerCard() {
  if (!_resolved?.ok || !_resolved.rssUrl) return ''
  const rows = _podcasts.map(p => {
    const sel = _selectedId === p.id
    const cov = p.cover_image
      ? `<img src="${htmlEscape(p.cover_image)}" alt="" style="width:40px;height:40px;border-radius:7px;object-fit:cover;flex-shrink:0;background:rgba(255,255,255,.05)">`
      : `<div style="width:40px;height:40px;border-radius:7px;background:rgba(255,255,255,.06);flex-shrink:0"></div>`
    return `<div data-pod="${htmlEscape(p.id)}" style="display:flex;align-items:center;gap:10px;padding:8px;border-radius:9px;cursor:pointer;${sel ? 'background:rgba(34,197,94,.12)' : ''}">
      ${cov}
      <div style="min-width:0;flex:1">
        <div style="font-size:13px;color:var(--text,#fff);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${htmlEscape(p.title || '(ohne Titel)')}</div>
        <div style="font-size:11px;color:var(--text-muted,#9CA3AF)">von @${htmlEscape(p.author?.username || '?')}</div>
        <div style="font-size:10px;color:var(--text-muted,#9CA3AF);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p.rss_url ? 'RSS: ' + htmlEscape(p.rss_url.replace(/^https?:\/\//, '').slice(0, 60)) : '⚠️ kein RSS gesetzt'}</div>
      </div>
      ${sel ? '<span style="color:#22C55E;flex-shrink:0">✓</span>' : ''}
    </div>`
  }).join('')
  return `<div class="panel-section">
    <div class="card-header"><strong>Bei welchem Podcast übernehmen?</strong></div>
    <div class="card-sub" style="margin-bottom:8px">RSS + Titel + Cover werden überschrieben. Suche greift auf Titel + @username + Name.</div>
    <input id="pr-search" type="text" value="${htmlEscape(_search)}" placeholder="Suchen nach @username oder Podcast-Titel…" style="width:100%;padding:9px;border-radius:9px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04);color:inherit;margin-bottom:8px">
    <div style="max-height:360px;overflow-y:auto">${rows || '<div class="card-sub" style="padding:14px;text-align:center">Keine Podcasts gefunden.</div>'}</div>
    <button class="btn" id="pr-apply" style="margin-top:12px;background:#7C5CFF;color:#fff;border:none${_selectedId ? '' : ';opacity:.5'}"${_selectedId ? '' : ' disabled'}>Bei ausgewähltem Podcast übernehmen</button>
  </div>`
}

function render(container) {
  container.innerHTML = `
    <div class="panel-head">
      <div class="panel-head-left">
        <div class="panel-title">Podcast-Resolver</div>
        <div class="panel-sub">URL auflösen + RSS/Titel/Cover setzen — wie in der App-Admin, jetzt im CRM</div>
      </div>
    </div>

    <div class="panel-section">
      <div class="card-header"><strong>URL eingeben</strong></div>
      <div class="card-sub" style="margin-bottom:8px">Apple-Podcasts, Spotify, RSS direkt, Letscast, Anchor, Podigee…</div>
      <div style="display:flex;gap:8px">
        <input id="pr-url" type="text" placeholder="https://podcasts.apple.com/… oder https://open.spotify.com/show/…" style="flex:1;padding:9px;border-radius:9px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04);color:inherit">
        <button class="btn" id="pr-resolve" style="background:#7C5CFF;color:#fff;border:none;flex-shrink:0">Auflösen</button>
      </div>
    </div>

    ${resolvedCard()}
    ${pickerCard()}
  `

  const urlInp = container.querySelector('#pr-url')
  container.querySelector('#pr-resolve')?.addEventListener('click', () => resolveUrl(container))
  urlInp?.addEventListener('keydown', ev => { if (ev.key === 'Enter') resolveUrl(container) })

  const searchInp = container.querySelector('#pr-search')
  if (searchInp) {
    let t
    searchInp.addEventListener('input', ev => {
      _search = ev.target.value
      clearTimeout(t)
      t = setTimeout(async () => { await loadPodcasts(_search); render(container); container.querySelector('#pr-search')?.focus() }, 300)
    })
  }
  container.querySelectorAll('[data-pod]').forEach(el => {
    el.addEventListener('click', () => { _selectedId = el.getAttribute('data-pod'); render(container) })
  })
  container.querySelector('#pr-apply')?.addEventListener('click', () => apply(container))
}

export default {
  id: 'podcast-resolver',
  title: 'Podcast-Resolver',
  icon: 'link',
  async mount(container) {
    _resolved = null; _selectedId = null; _podcasts = []; _search = ''
    render(container)
  }
}
