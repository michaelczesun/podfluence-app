// Discover-Steuerpult — Featured-Podcasts verwalten
// Subtab unter Content-Tab. Listet ALLE Podcasts, erlaubt Featured-Toggle.
//
// Verifizierte Fakten (Stand 12.6.26, alles geprobt):
//  - podcasts-Spalten: id, title, cover_image, is_featured, author_id, created_at
//  - Host-Name via FK-Join users:author_id(id, username, full_name)
//  - RPC admin_set_podcast_featured(p_podcast_id, p_featured) existiert + gated (P0001 admin_required)
//  - is_featured wirkt AKTUELL nur auf die CRM-Trending-Podcaster-Sortierung
//    (crm_trending_podcasters ORDER BY is_featured DESC). Die App-eigene
//    Discover/Trending-Seite (app/discover/trending.tsx) liest is_featured NOCH NICHT.
//
// CACHE-BUST: ?v=20260612a

import { sb } from '/lib/supabase.js?v=20260612a'
import {
  toast, htmlEscape, confirmDialog, iconHtml, fmtRelativeTime, fmtNumber, debounce
} from '/lib/ui.js?v=20260612a'
import { exportCsv } from '/lib/export.js?v=20260612a'
import { fadeIn } from '/lib/animations.js?v=20260612a'

// Ehrliche Info-Zeile: was bewirkt Featured aktuell wirklich.
const FEATURED_INFO =
  'Featured beeinflusst aktuell nur die Sortierung im CRM-Panel „Trending Podcaster" ' +
  '(featured zuerst). Die App-eigene Discover/Trending-Seite liest dieses Flag noch nicht — ' +
  'dort entscheidet weiterhin der Trending-Score.'

// ---------- Daten laden ----------
async function fetchPodcasts() {
  // Host-Name via FK-Embed. Spalten exakt geprobt.
  const { data, error } = await sb
    .from('podcasts')
    .select('id, title, cover_image, is_featured, author_id, created_at, users:author_id(id, username, full_name)')
    .order('is_featured', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

function hostName(p) {
  const u = p.users || {}
  return u.full_name || u.username || '—'
}

// ---------- Row-HTML ----------
function rowHtml(p) {
  const cover = p.cover_image
    ? `<img class="podcast-cover" src="${htmlEscape(p.cover_image)}" alt="" loading="lazy">`
    : `<div class="podcast-cover-fallback">${htmlEscape((p.title || '?').charAt(0).toUpperCase())}</div>`
  const created = p.created_at ? fmtRelativeTime(p.created_at) : '—'
  const featured = p.is_featured === true
  const star = featured
    ? `<span class="chip chip--amber" title="Featured">${iconHtml('star')} Featured</span>`
    : `<span class="chip" style="opacity:.6;">Nicht featured</span>`
  const btnLabel = featured ? 'Entfernen' : 'Featuren'
  const btnIcon = featured ? iconHtml('x-circle') : iconHtml('star')

  return `
    <div class="dc-row glass-card" data-id="${htmlEscape(p.id)}" data-featured="${featured ? '1' : '0'}"
         style="display:flex;align-items:center;gap:12px;padding:12px 14px;">
      ${cover}
      <div style="flex:1;min-width:0;">
        <div style="font-weight:600;color:var(--text,#fff);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
          ${htmlEscape(p.title || 'Ohne Titel')}
        </div>
        <div class="panel-sub" style="display:flex;align-items:center;gap:6px;font-size:12px;">
          ${iconHtml('mic')}<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${htmlEscape(hostName(p))}</span>
          <span style="opacity:.5;">·</span>
          <span style="white-space:nowrap;">${htmlEscape(created)}</span>
        </div>
      </div>
      <div style="flex:0 0 auto;display:flex;align-items:center;gap:10px;">
        ${star}
        <button class="btn--ghost dc-toggle" data-id="${htmlEscape(p.id)}"
                style="display:inline-flex;align-items:center;gap:6px;white-space:nowrap;">
          ${btnIcon}<span>${btnLabel}</span>
        </button>
      </div>
    </div>`
}

function skeletonRows(n = 6) {
  return Array.from({ length: n })
    .map(() => `<div class="pf-skeleton" style="height:68px;border-radius:12px;"></div>`)
    .join('')
}

// ---------- Panel ----------
export default {
  id: 'discover-control',
  title: 'Discover-Steuerpult',
  category: 'content',

  async mount(container) {
    let all = []          // alle Podcasts (Quelle der Wahrheit)
    let search = ''       // Suchstring
    let filter = 'all'    // 'all' | 'featured'

    container.innerHTML = `
      <div class="panel-shell" style="display:flex;flex-direction:column;gap:16px;">
        <div class="panel-head glass-card" style="padding:16px;">
          <div class="panel-head-left">
            <h2 class="panel-title">⭐ Discover-Steuerpult</h2>
            <p class="panel-sub">Podcasts featuren und aus dem Discover hervorheben.</p>
          </div>
        </div>

        <div class="glass-card" style="padding:12px 14px;display:flex;align-items:flex-start;gap:10px;">
          <span style="color:var(--text-muted,#9CA3AF);flex:0 0 auto;margin-top:1px;">${iconHtml('info')}</span>
          <div class="panel-sub" id="dc-info" style="font-size:12.5px;line-height:1.5;"></div>
        </div>

        <div class="glass-card" style="padding:12px 14px;display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;">
          <div style="position:relative;flex:1;min-width:220px;max-width:420px;">
            <span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--text-muted,#9CA3AF);pointer-events:none;">${iconHtml('search')}</span>
            <input id="dc-search" class="input--search" type="text" placeholder="Podcast oder Host suchen…" style="padding-left:34px;">
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <button class="filter-pill is-active" data-filter="all">${iconHtml('filter')} Alle</button>
            <button class="filter-pill" data-filter="featured">${iconHtml('star')} Featured</button>
            <button id="dc-refresh" class="btn--ghost" style="display:inline-flex;align-items:center;gap:6px;">${iconHtml('refresh-cw')} Aktualisieren</button>
            <button id="dc-csv" class="btn--ghost" style="display:inline-flex;align-items:center;gap:6px;">${iconHtml('download')} CSV</button>
          </div>
        </div>

        <div class="glass-card" style="padding:10px 14px;display:flex;gap:18px;align-items:center;flex-wrap:wrap;">
          <span class="panel-sub" style="font-size:12px;">Gesamt: <strong id="dc-count-total" style="color:var(--text,#fff);">–</strong></span>
          <span class="panel-sub" style="font-size:12px;">Featured: <strong id="dc-count-featured" style="color:#F59E0B;">–</strong></span>
          <span class="panel-sub" id="dc-count-shown" style="font-size:12px;margin-left:auto;"></span>
        </div>

        <div id="dc-list" style="display:flex;flex-direction:column;gap:10px;min-height:120px;">
          ${skeletonRows()}
        </div>
      </div>
    `

    const infoEl = container.querySelector('#dc-info')
    if (infoEl) infoEl.textContent = FEATURED_INFO

    const listEl = container.querySelector('#dc-list')
    const searchEl = container.querySelector('#dc-search')
    const totalEl = container.querySelector('#dc-count-total')
    const featuredEl = container.querySelector('#dc-count-featured')
    const shownEl = container.querySelector('#dc-count-shown')

    function applyFilter() {
      const q = search.trim().toLowerCase()
      return all.filter(p => {
        if (filter === 'featured' && p.is_featured !== true) return false
        if (!q) return true
        const hay = `${p.title || ''} ${hostName(p)}`.toLowerCase()
        return hay.includes(q)
      })
    }

    function renderCounts() {
      const featuredCount = all.filter(p => p.is_featured === true).length
      if (totalEl) totalEl.textContent = fmtNumber(all.length)
      if (featuredEl) featuredEl.textContent = fmtNumber(featuredCount)
    }

    function renderList() {
      const rows = applyFilter()
      if (shownEl) shownEl.textContent = `${fmtNumber(rows.length)} angezeigt`
      if (!rows.length) {
        listEl.innerHTML = `
          <div style="padding:48px 20px;text-align:center;">
            <div class="empty-state__icon">${iconHtml('search')}</div>
            <div class="empty-state__title">Keine Podcasts gefunden</div>
            <div class="empty-state__text">${filter === 'featured'
              ? 'Aktuell ist kein Podcast als Featured markiert.'
              : 'Für diese Suche gibt es keine Treffer.'}</div>
          </div>`
        return
      }
      listEl.innerHTML = rows.map(rowHtml).join('')
      wireRows()
      try { fadeIn(listEl, 200) } catch (_) {}
    }

    function wireRows() {
      listEl.querySelectorAll('.dc-toggle').forEach(btn => {
        btn.onclick = () => toggleFeatured(btn.dataset.id)
      })
    }

    async function toggleFeatured(id) {
      const p = all.find(x => x.id === id)
      if (!p) return
      const next = !(p.is_featured === true)
      const ok = await confirmDialog(
        next ? 'Podcast featuren?' : 'Featured entfernen?',
        next
          ? `„${htmlEscape(p.title || '')}" wird im Discover hervorgehoben (featured zuerst im Trending-Panel).`
          : `„${htmlEscape(p.title || '')}" wird nicht mehr hervorgehoben.`,
        next ? 'Featuren' : 'Entfernen',
        !next
      )
      if (!ok) return

      // Optimistisch togglen, bei Fehler zurückrollen.
      p.is_featured = next
      renderCounts()
      renderList()
      try {
        const { error } = await sb.rpc('admin_set_podcast_featured', {
          p_podcast_id: id,
          p_featured: next
        })
        if (error) throw error
        toast(next ? 'Podcast ist jetzt Featured' : 'Featured entfernt', 'success')
      } catch (e) {
        p.is_featured = !next // rollback
        renderCounts()
        renderList()
        const msg = (e && e.message) ? e.message : 'Unbekannter Fehler'
        toast('Fehler: ' + msg, 'error')
      }
    }

    async function load() {
      listEl.innerHTML = skeletonRows()
      try {
        all = await fetchPodcasts()
        renderCounts()
        renderList()
      } catch (e) {
        console.error('[discover-control] load failed', e)
        listEl.innerHTML = `
          <div style="padding:40px 20px;text-align:center;">
            <div class="empty-state__icon">⚠️</div>
            <div class="empty-state__title" style="color:#F87171;">Podcasts konnten nicht geladen werden</div>
            <div class="empty-state__text">${htmlEscape((e && e.message) ? e.message : String(e))}</div>
          </div>`
      }
    }

    // ---- Events ----
    const onSearch = debounce(() => { search = searchEl.value || ''; renderList() }, 200)
    searchEl.addEventListener('input', onSearch)

    container.querySelectorAll('.filter-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        filter = pill.dataset.filter
        container.querySelectorAll('.filter-pill').forEach(p => p.classList.toggle('is-active', p === pill))
        renderList()
      })
    })

    container.querySelector('#dc-refresh').onclick = () => { toast('Aktualisiere…'); load() }

    container.querySelector('#dc-csv').onclick = () => {
      try {
        exportCsv(
          all.map(p => ({
            title: p.title || '',
            host: hostName(p),
            is_featured: p.is_featured === true ? 'ja' : 'nein',
            created_at: p.created_at || '',
            id: p.id
          })),
          null,
          `discover-podcasts-${new Date().toISOString().slice(0, 10)}.csv`
        )
      } catch (e) {
        toast('CSV-Export fehlgeschlagen', 'error')
      }
    }

    try { fadeIn(container, 300) } catch (_) {}
    load()
  },

  async unmount() {
    // keine offenen Subscriptions/Timer — nichts zu räumen
  }
}
