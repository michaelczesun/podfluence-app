import { sb } from '/lib/supabase.js?v=20260608c'
import { toast, fmtNumber, fmtRelativeTime, htmlEscape, iconHtml } from '/lib/ui.js?v=20260608c'
import { makeAreaChart, makeBarChart, makeDonutChart } from '/lib/charts.js?v=20260608c'
import { exportPanelAsPdf, exportCsv } from '/lib/export.js?v=20260608c'
import { countUp, fadeIn, skeletonLoader } from '/lib/animations.js?v=20260608c'
import { drawer, segmentedControl, statHero } from '/lib/layout-extras.js?v=20260608c'
import { showUserDetailModal } from '/lib/panel-actions.js?v=20260608c'

// Ungenutzte Imports entfernt: modal, fmtDateTime, debounce, glassCard, tabs

const POST_TYPE_META = {
  reel:     { label: 'Reel',     icon: 'video',    color: '#A855F7' },
  carousel: { label: 'Carousel', icon: 'layers',   color: '#3B82F6' },
  image:    { label: 'Bild',     icon: 'image',    color: '#10B981' },
  story:    { label: 'Story',    icon: 'circle',   color: '#F59E0B' },
  igtv:     { label: 'IGTV',     icon: 'tv',       color: '#EC4899' },
  live:     { label: 'Live',     icon: 'radio',    color: '#EF4444' },
  unknown:  { label: 'Unbekannt',icon: 'help-circle', color: '#6B7280' },
}

function metaFor(type) {
  const key = (type || 'unknown').toLowerCase()
  return POST_TYPE_META[key] || { label: type || 'Unbekannt', icon: 'square', color: '#64748B' }
}

// FIX (med): Wenn kein echter Reach/Impressions/Views vorhanden → score=null + is_estimated=true
// statt synthetischem likes*10-Denominator der verzerrte Scores erzeugt.
function computeScore(p) {
  const likes  = Number(p.like_count || p.likes || 0)
  const cmts   = Number(p.comments_count || p.comments || 0)
  const views  = Number(p.view_count || p.plays || p.video_views || 0)
  const saves  = Number(p.save_count || p.saves || 0)
  const shares = Number(p.share_count || p.shares || 0)
  const rawReach = Number(p.reach || p.impressions || 0)
  const engage = likes + 2 * cmts + 3 * saves + 4 * shares

  // Kein echter Reach/Impressions und kein View-Wert → Score nicht berechenbar
  if (rawReach === 0 && views === 0) {
    return { score: null, is_estimated: true, engage, reach: 0, views, likes, cmts, saves, shares }
  }

  const reach = rawReach > 0 ? rawReach : views
  const score = (engage / Math.max(1, reach)) * 1000 + Math.log10(1 + views) * 5
  return { score: +score.toFixed(2), is_estimated: false, engage, reach, views, likes, cmts, saves, shares }
}

// FIX (high): insta_post_performance ist NICHT in der Tabellen-Whitelist und hat kein RLS-Bypass.
// Stattdessen: insta_posts_queue verwenden (steht in der Whitelist).
// Wenn zukünftig ein admin_insta_post_performance-RPC angelegt wird, hier eintauschen.
async function fetchPosts(range) {
  const since = new Date(Date.now() - range * 24 * 3600 * 1000).toISOString()
  const { data, error } = await sb
    .from('insta_posts_queue')
    .select('*')
    .gte('posted_at', since)
    .order('posted_at', { ascending: false })
    .limit(2000)
  if (error) throw error
  // FIX (low): Hinweis wenn Daten möglicherweise abgeschnitten (limit getroffen)
  const posts = data || []
  if (posts.length === 2000) {
    toast('Daten auf 2.000 Posts begrenzt — ältere Einträge ggf. nicht berücksichtigt.', 'warn')
  }
  return posts
}

function aggregate(posts) {
  const byType = new Map()
  let allUnknown = true

  for (const p of posts) {
    const t = (p.post_type || p.media_type || 'unknown').toLowerCase()
    if (t !== 'unknown') allUnknown = false
    if (!byType.has(t)) byType.set(t, { type: t, count: 0, scoreSum: 0, scoreCount: 0, engageSum: 0, reachSum: 0, viewsSum: 0, estimatedCount: 0, posts: [] })
    const row = byType.get(t)
    const m = computeScore(p)
    row.count++
    if (m.score !== null) {
      row.scoreSum += m.score
      row.scoreCount++
    }
    if (m.is_estimated) row.estimatedCount++
    row.engageSum += m.engage
    row.reachSum  += m.reach
    row.viewsSum  += m.views
    row.posts.push({ ...p, _metrics: m })
  }

  // FIX (low): Hinweis wenn alle Posts als 'unknown' aggregiert werden
  if (allUnknown && posts.length > 0) {
    console.warn('[insta-post-type-scores] Alle Posts haben unbekannten post_type/media_type — Spalte fehlt oder nicht befüllt.')
  }

  const rows = [...byType.values()].map(r => ({
    ...r,
    avgScore:  r.scoreCount > 0 ? +(r.scoreSum / r.scoreCount).toFixed(2) : null,
    avgEngage: Math.round(r.engageSum / Math.max(1, r.count)),
    avgReach:  Math.round(r.reachSum  / Math.max(1, r.count)),
  })).sort((a, b) => {
    // null-Scores ans Ende
    if (a.avgScore === null && b.avgScore === null) return 0
    if (a.avgScore === null) return 1
    if (b.avgScore === null) return -1
    return b.avgScore - a.avgScore
  })
  return rows
}

export default {
  id: 'insta-post-type-scores',
  title: 'IG-Post-Typ Scoring',
  category: 'marketing',

  async mount(container) {
    try {
      let currentRange = 30
      let currentRows = []
      let currentPosts = []

      container.innerHTML = `
        <div class="panel-shell" id="ig-pts-shell">
          <div class="panel-head">
            <div>
              <h2>${iconHtml('bar-chart-3')} IG-Post-Typ Scoring</h2>
              <div class="panel-sub">Welcher Content-Typ performt? Performance-Score pro Post-Format.</div>
            </div>
            <div class="toolbar" id="ig-pts-toolbar"></div>
          </div>
          <div class="panel-body" id="ig-pts-body"></div>
        </div>
      `

      const toolbar = container.querySelector('#ig-pts-toolbar')
      const body    = container.querySelector('#ig-pts-body')

      // Sofort Skeleton anzeigen, damit kein weißer Screen während Fetch
      renderSkeleton()

      toolbar.innerHTML = `
        <div id="range-seg"></div>
        <button class="btn btn-ghost" id="btn-refresh" title="Aktualisieren">${iconHtml('refresh-cw')}</button>
        <button class="btn btn-ghost" id="btn-pdf" title="Als PDF exportieren">${iconHtml('file-text')}</button>
        <button class="btn btn-ghost" id="btn-csv" title="CSV exportieren">${iconHtml('download')}</button>
      `
      try {
        segmentedControl(toolbar.querySelector('#range-seg'), {
          options: [
            { value: 7,   label: '7T' },
            { value: 30,  label: '30T' },
            { value: 90,  label: '90T' },
            { value: 365, label: '1J' },
          ],
          value: currentRange,
          // FIX (low): Number(v)-Cast ist defensiv korrekt da segmentedControl value als String zurückgeben kann
          onChange: (v) => { currentRange = Number(v); load() }
        })
      } catch (e) {
        console.warn('[insta-post-type-scores] segmentedControl failed', e)
      }

      toolbar.querySelector('#btn-refresh').onclick = () => load()
      toolbar.querySelector('#btn-pdf').onclick = () => {
        try {
          exportPanelAsPdf(container, { filename: 'ig-post-type-scores.pdf', title: 'IG-Post-Typ Scoring' })
        } catch (e) {
          toast('PDF-Export fehlgeschlagen: ' + (e?.message || e), 'error')
        }
      }
      toolbar.querySelector('#btn-csv').onclick = () => {
        if (!currentRows.length) return toast('Keine Daten zum Exportieren', 'warn')
        try {
          exportCsv(currentRows.map(r => ({
            Typ: metaFor(r.type).label,
            Posts: r.count,
            Score_Avg: r.avgScore ?? '',
            Engagement_Avg: r.avgEngage,
            Reach_Avg: r.avgReach,
            Views_Gesamt: r.viewsSum,
          })), 'ig-post-type-scores.csv')
        } catch (e) {
          toast('CSV-Export fehlgeschlagen: ' + (e?.message || e), 'error')
        }
      }

      function renderSkeleton() {
        body.innerHTML = `
          <div class="hero-row" id="hero-skel"></div>
          <div class="grid-2" style="margin-top:16px;">
            <div class="glass-card" id="chart-skel" style="height:340px;"></div>
            <div class="glass-card" id="donut-skel" style="height:340px;"></div>
          </div>
          <div class="glass-card" id="table-skel" style="height:260px;margin-top:16px;"></div>
        `
        try { skeletonLoader(body.querySelector('#hero-skel'), { lines: 1, height: 96 }) } catch (_) {}
        try { skeletonLoader(body.querySelector('#chart-skel'), { lines: 6 }) } catch (_) {}
        try { skeletonLoader(body.querySelector('#donut-skel'), { lines: 6 }) } catch (_) {}
        try { skeletonLoader(body.querySelector('#table-skel'), { lines: 5 }) } catch (_) {}
      }

      function renderError(err) {
        body.innerHTML = `
          <div class="empty-state error-state">
            <div class="empty-icon">${iconHtml('alert-triangle')}</div>
            <h3>Fehler beim Laden</h3>
            <p>${htmlEscape(err?.message || 'Unbekannter Fehler')}</p>
            <button class="btn btn-primary" id="retry">${iconHtml('refresh-cw')} Erneut versuchen</button>
          </div>
        `
        body.querySelector('#retry').onclick = () => load()
      }

      function renderEmpty() {
        body.innerHTML = `
          <div class="empty-state">
            <div class="empty-icon">${iconHtml('image-off')}</div>
            <h3>Noch keine IG-Posts im Zeitraum</h3>
            <p>Sobald Instagram-Posts synchronisiert sind, erscheinen hier Performance-Scores nach Format.</p>
            <button class="btn btn-ghost" id="retry-empty">${iconHtml('refresh-cw')} Neu laden</button>
          </div>
        `
        body.querySelector('#retry-empty').onclick = () => load()
      }

      function renderMain(rows, posts) {
        const totalPosts  = posts.length
        const bestType    = rows.find(r => r.avgScore !== null) || rows[0]
        const scoredRows  = rows.filter(r => r.avgScore !== null)
        const avgScoreAll = scoredRows.length ? +(scoredRows.reduce((s,r)=>s+r.avgScore,0)/scoredRows.length).toFixed(2) : null
        const totalReach  = rows.reduce((s,r)=>s+r.reachSum,0)

        // FIX (low): Hinweis wenn alle Posts 'unknown' (kein post_type/media_type in Daten)
        const hasUnknownOnly = rows.length === 1 && rows[0].type === 'unknown'

        body.innerHTML = `
          <div class="hero-row" id="heroes"></div>
          ${hasUnknownOnly ? `<div class="alert alert-warn" style="margin:8px 0;">${iconHtml('alert-triangle')} Alle Posts haben keinen erkannten Format-Typ (post_type/media_type fehlt). Scoring nach Typ ist eingeschränkt.</div>` : ''}

          <div class="grid-2" style="margin-top:16px;">
            <div class="glass-card chart-card" id="bar-wrap">
              <div class="card-head">
                <h3>${iconHtml('bar-chart-3')} Score pro Post-Typ (Ø)</h3>
                <span class="hint">Klick auf Balken &rarr; historische Posts</span>
              </div>
              <div id="bar-chart" style="height:300px;"></div>
            </div>
            <div class="glass-card chart-card" id="donut-wrap">
              <div class="card-head">
                <h3>${iconHtml('pie-chart')} Verteilung der Posts</h3>
              </div>
              <div id="donut-chart" style="height:300px;"></div>
            </div>
          </div>

          <div class="glass-card" style="margin-top:16px;">
            <div class="card-head">
              <h3>${iconHtml('table')} Ranking nach Post-Typ</h3>
              <span class="hint">${rows.length} Formate &middot; ${fmtNumber(totalPosts)} Posts gesamt</span>
            </div>
            <div class="table-wrap">
              <table class="data-table sortable hoverable">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Post-Typ</th>
                    <th class="num">Posts</th>
                    <th class="num">Score (Ø)</th>
                    <th class="num">Engagement (Ø)</th>
                    <th class="num">Reach (Ø)</th>
                    <th class="num">Views</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody id="rows-body"></tbody>
              </table>
            </div>
          </div>
        `

        const heroes = body.querySelector('#heroes')
        const h1 = document.createElement('div'); heroes.appendChild(h1)
        const h2 = document.createElement('div'); heroes.appendChild(h2)
        const h3 = document.createElement('div'); heroes.appendChild(h3)
        const h4 = document.createElement('div'); heroes.appendChild(h4)

        // FIX (med): statHero aufrufen, dann querySelector('.hero-value') — mit Null-Check
        // und Fallback wenn statHero kein .hero-value-Element rendert.
        try {
          statHero(h1, { label: 'Posts analysiert', value: 0, icon: 'image', accent: '#3B82F6' })
          statHero(h2, { label: 'Bester Typ', value: bestType ? metaFor(bestType.type).label : '—', icon: 'award', accent: bestType ? metaFor(bestType.type).color : '#64748B', isText: true })
          statHero(h3, { label: 'Score gesamt (Ø)', value: avgScoreAll ?? '—', icon: 'activity', accent: '#10B981', isText: avgScoreAll === null })
          statHero(h4, { label: 'Gesamt-Reach', value: 0, icon: 'radio', accent: '#F59E0B' })
        } catch (e) {
          console.warn('[insta-post-type-scores] statHero failed', e)
        }

        const v1 = h1.querySelector('.hero-value')
        const v3 = h3.querySelector('.hero-value')
        const v4 = h4.querySelector('.hero-value')

        if (v1) {
          try { countUp(v1, totalPosts) } catch { v1.textContent = fmtNumber(totalPosts) }
        } else {
          h1.textContent = fmtNumber(totalPosts)
        }
        if (v3 && avgScoreAll !== null) {
          try { countUp(v3, avgScoreAll, { decimals: 2 }) } catch { v3.textContent = fmtNumber(avgScoreAll) }
        }
        if (v4) {
          try { countUp(v4, totalReach) } catch { v4.textContent = fmtNumber(totalReach) }
        } else {
          h4.textContent = fmtNumber(totalReach)
        }

        // FIX (med): makeBarChart onClick — API möglicherweise nicht unterstützt.
        // Manuellen click-Listener auf SVG-Bars als Fallback setzen.
        const barData = rows
          .filter(r => r.avgScore !== null)
          .map(r => ({
            label: metaFor(r.type).label,
            value: r.avgScore,
            color: metaFor(r.type).color,
            _type: r.type,
          }))
        const barEl = body.querySelector('#bar-chart')
        if (!barData.length) {
          barEl.innerHTML = `<div class="empty-state mini"><p>Keine Score-Daten verfügbar (fehlende Reach/Impressions).</p></div>`
        } else {
          try {
            makeBarChart(barEl, {
              data: barData,
              valueLabel: 'Score (Ø)',
              onClick: (item) => openTypeDrawer(item._type),
            })
            // Fallback: Falls makeBarChart onClick nicht unterstützt, manuell auf Bars lauschen
            barEl.querySelectorAll('[data-index]').forEach(el => {
              el.style.cursor = 'pointer'
              el.addEventListener('click', () => {
                const idx = Number(el.dataset.index)
                const item = barData[idx]
                if (item) openTypeDrawer(item._type)
              })
            })
          } catch (e) {
            barEl.innerHTML = `<div class="empty-state mini"><p>Chart konnte nicht gerendert werden.</p></div>`
          }
        }

        const donutData = rows.map(r => ({
          label: metaFor(r.type).label,
          value: r.count,
          color: metaFor(r.type).color,
        }))
        try {
          makeDonutChart(body.querySelector('#donut-chart'), { data: donutData })
        } catch (e) {
          body.querySelector('#donut-chart').innerHTML = `<div class="empty-state mini"><p>Chart konnte nicht gerendert werden.</p></div>`
        }

        const tbody = body.querySelector('#rows-body')
        tbody.innerHTML = rows.map((r, i) => {
          const m = metaFor(r.type)
          const badge = i === 0 ? '<span class="badge badge-gold">Top</span>' : ''
          const scoreDisplay = r.avgScore !== null
            ? `<strong>${fmtNumber(r.avgScore)}</strong>`
            : `<span class="muted" title="Kein Reach/Impressions vorhanden">—</span>`
          const estimatedNote = r.estimatedCount > 0
            ? ` <span class="hint" title="${r.estimatedCount} Posts ohne messbaren Reach">~${r.estimatedCount} gesch.</span>`
            : ''
          return `
            <tr data-type="${htmlEscape(r.type)}" class="row-clickable">
              <td class="rank">${i + 1}</td>
              <td>
                <div class="cell-with-icon">
                  <span class="type-dot" style="background:${m.color}"></span>
                  <strong>${htmlEscape(m.label)}</strong> ${badge}${estimatedNote}
                </div>
              </td>
              <td class="num">${fmtNumber(r.count)}</td>
              <td class="num">${scoreDisplay}</td>
              <td class="num">${fmtNumber(r.avgEngage)}</td>
              <td class="num">${fmtNumber(r.avgReach)}</td>
              <td class="num">${fmtNumber(r.viewsSum)}</td>
              <td><button class="btn btn-sm btn-ghost" data-action="open" data-type="${htmlEscape(r.type)}">${iconHtml('chevron-right')}</button></td>
            </tr>
          `
        }).join('')

        tbody.querySelectorAll('tr.row-clickable').forEach(tr => {
          tr.addEventListener('click', (e) => {
            if (e.target.closest('button')) return
            openTypeDrawer(tr.dataset.type)
          })
        })
        tbody.querySelectorAll('button[data-action="open"]').forEach(b => {
          b.addEventListener('click', () => openTypeDrawer(b.dataset.type))
        })

        try { fadeIn(body) } catch (_) {}
      }

      // FIX (low): IDs in Drawer-Content mit Unique-Suffix versehen um Kollisionen bei
      // mehrfachem Öffnen zu vermeiden (drawer-area-{type}, drawer-rows-{type}).
      // FIX (med): drawer() content ist HTML-String. Falls drawer() den String nicht als innerHTML
      // setzt, explizit dr.el.innerHTML setzen als Fallback.
      function openTypeDrawer(type) {
        const row = currentRows.find(r => r.type === type)
        if (!row) return toast('Keine Posts für diesen Typ', 'warn')
        const meta = metaFor(type)
        const sorted = [...row.posts].sort((a, b) => {
          const sa = a._metrics.score ?? -Infinity
          const sb_ = b._metrics.score ?? -Infinity
          return sb_ - sa
        })

        // Scoped IDs mit type-Suffix
        const areaId = `drawer-area-${type}`
        const rowsId = `drawer-rows-${type}`

        const content = `
          <div class="drawer-head">
            <div class="cell-with-icon">
              <span class="type-dot" style="background:${meta.color};width:14px;height:14px;"></span>
              <h2 style="margin:0;">${htmlEscape(meta.label)} – Historie</h2>
            </div>
            <div class="hint">${fmtNumber(row.count)} Posts &middot; Score (Ø) ${row.avgScore !== null ? fmtNumber(row.avgScore) : '—'}</div>
          </div>
          <div class="drawer-stats" style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:16px 0;">
            <div class="glass-card mini-stat"><div class="mini-label">Engagement (Ø)</div><div class="mini-value">${fmtNumber(row.avgEngage)}</div></div>
            <div class="glass-card mini-stat"><div class="mini-label">Reach (Ø)</div><div class="mini-value">${fmtNumber(row.avgReach)}</div></div>
            <div class="glass-card mini-stat"><div class="mini-label">Views gesamt</div><div class="mini-value">${fmtNumber(row.viewsSum)}</div></div>
          </div>
          <div class="glass-card" style="margin-bottom:12px;">
            <div class="card-head"><h3>${iconHtml('trending-up')} Score-Verlauf</h3></div>
            <div id="${areaId}" style="height:200px;"></div>
          </div>
          <div class="glass-card">
            <div class="card-head"><h3>${iconHtml('list')} Top-Posts</h3></div>
            <div class="table-wrap">
              <table class="data-table hoverable">
                <thead><tr>
                  <th></th><th>Caption</th><th>User</th><th class="num">Score</th><th class="num">Likes</th><th class="num">Komm.</th><th>Gepostet</th><th></th>
                </tr></thead>
                <tbody id="${rowsId}"></tbody>
              </table>
            </div>
          </div>
        `

        let dr
        try {
          dr = drawer({ title: `${meta.label} Historie`, width: 920, content })
        } catch (e) {
          toast('Drawer konnte nicht geöffnet werden', 'error')
          return
        }
        if (!dr || !dr.el) return

        // FIX (med): Falls drawer() content HTML-String nicht als innerHTML gesetzt hat → Fallback
        const hasAreaEl = !!dr.el.querySelector(`#${areaId}`)
        if (!hasAreaEl) {
          try {
            const contentWrap = dr.el.querySelector('.drawer-content') || dr.el
            contentWrap.innerHTML = content
          } catch (e) {
            console.warn('[insta-post-type-scores] Drawer content fallback failed', e)
          }
        }

        const byDay = new Map()
        for (const p of row.posts) {
          const d = (p.posted_at || p.created_at || '').slice(0, 10)
          if (!d || p._metrics.score === null) continue
          if (!byDay.has(d)) byDay.set(d, { x: d, sum: 0, n: 0 })
          const e = byDay.get(d); e.sum += p._metrics.score; e.n++
        }
        const series = [...byDay.values()].sort((a,b)=>a.x.localeCompare(b.x)).map(e => ({ x: e.x, y: +(e.sum/e.n).toFixed(2) }))
        const areaEl = dr.el.querySelector(`#${areaId}`)
        if (areaEl) {
          if (series.length >= 2) {
            try {
              makeAreaChart(areaEl, { data: series, color: meta.color, valueLabel: 'Score (Ø)' })
            } catch (e) {
              areaEl.innerHTML = `<div class="empty-state mini"><p>Verlaufsgrafik konnte nicht gerendert werden.</p></div>`
            }
          } else {
            areaEl.innerHTML = `<div class="empty-state mini"><div class="empty-icon">${iconHtml('line-chart')}</div><p>Zu wenig Datenpunkte für Verlauf.</p></div>`
          }
        }

        const rowsBody = dr.el.querySelector(`#${rowsId}`)
        if (!rowsBody) return
        rowsBody.innerHTML = sorted.slice(0, 100).map(p => {
          const cap = htmlEscape((p.caption || '').slice(0, 80))
          const user = htmlEscape(p.username || (p.user_id ? String(p.user_id).slice(0,8) : '—'))
          const thumb = p.thumbnail_url
            ? `<img src="${htmlEscape(p.thumbnail_url)}" class="thumb-sm" loading="lazy" alt="">`
            : `<div class="thumb-sm thumb-placeholder">${iconHtml(meta.icon)}</div>`
          const scoreCell = p._metrics.score !== null
            ? `<strong>${fmtNumber(p._metrics.score)}</strong>`
            : `<span class="muted" title="Kein Reach/Impressions">—</span>`
          return `
            <tr>
              <td>${thumb}</td>
              <td class="caption-cell">${cap || '<span class="muted">— ohne Caption —</span>'}</td>
              <td>${p.user_id
                ? `<a href="#" data-uid="${htmlEscape(p.user_id)}" class="user-link">${user}</a>`
                : `<span class="muted">${user}</span>`}</td>
              <td class="num">${scoreCell}</td>
              <td class="num">${fmtNumber(p._metrics.likes)}</td>
              <td class="num">${fmtNumber(p._metrics.cmts)}</td>
              <td title="${htmlEscape(p.posted_at || '')}">${p.posted_at ? fmtRelativeTime(p.posted_at) : '—'}</td>
              <td>${p.permalink ? `<a class="btn btn-sm btn-ghost" href="${htmlEscape(p.permalink)}" target="_blank" rel="noopener">${iconHtml('external-link')}</a>` : ''}</td>
            </tr>
          `
        }).join('')

        rowsBody.querySelectorAll('a.user-link').forEach(a => {
          a.addEventListener('click', (e) => {
            e.preventDefault()
            try {
              showUserDetailModal(a.dataset.uid)
            } catch (err) {
              toast('User-Details konnten nicht geladen werden', 'error')
            }
          })
        })
      }

      async function load() {
        renderSkeleton()
        try {
          const posts = await fetchPosts(currentRange)
          if (!posts.length) return renderEmpty()
          const rows = aggregate(posts)
          currentPosts = posts
          currentRows = rows
          renderMain(rows, posts)
        } catch (err) {
          console.error('[insta-post-type-scores]', err)
          renderError(err)
        }
      }

      // Data-Fetch im Hintergrund (Skeleton ist schon sichtbar)
      load()
    } catch (mountErr) {
      console.error('[insta-post-type-scores] mount failed', mountErr)
      try {
        container.innerHTML = `
          <div class="panel-shell">
            <div class="empty-state error-state" style="padding:32px;">
              <div class="empty-icon">${iconHtml('alert-octagon')}</div>
              <h3>Panel konnte nicht initialisiert werden</h3>
              <p>${htmlEscape(mountErr?.message || String(mountErr))}</p>
            </div>
          </div>
        `
      } catch (_) {
        container.textContent = 'Panel konnte nicht initialisiert werden: ' + (mountErr?.message || mountErr)
      }
    }
  }
}
