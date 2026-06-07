import { sb } from '/lib/supabase.js?v=20260607b'
import { toast, modal, fmtNumber, fmtDateTime, fmtRelativeTime, htmlEscape, iconHtml } from '/lib/ui.js?v=20260607b'
import { makeDonutChart, makeBarChart } from '/lib/charts.js?v=20260607b'
import { exportPanelAsPdf, exportCsv } from '/lib/export.js?v=20260607b'
import { countUp, fadeIn, skeletonLoader } from '/lib/animations.js?v=20260607b'
import { drawer, segmentedControl, statHero, glassCard } from '/lib/layout-extras.js?v=20260607b'
import { showUserDetailModal } from '/lib/panel-actions.js?v=20260607b'

const VIBES = [
  { key: 'fire',   emoji: '🔥', label: 'Fire',       color: '#ff5b3a' },
  { key: 'idea',   emoji: '💡', label: 'Idee',       color: '#ffc24d' },
  { key: 'lol',    emoji: '🤣', label: 'Lustig',     color: '#5ed1ad' },
  { key: 'mind',   emoji: '🧠', label: 'Deep',       color: '#7c8cff' },
  { key: 'love',   emoji: '❤️', label: 'Love',       color: '#ff6aa6' },
  { key: 'sleep',  emoji: '😴', label: 'Snooze',     color: '#8a93a6' },
]

const VIBE_BY_KEY = Object.fromEntries(VIBES.map(v => [v.key, v]))

const state = {
  range: '7d',
  data: null,
}

function rangeStartIso(range) {
  const d = new Date()
  d.setDate(d.getDate() - (range === '30d' ? 30 : 7))
  return d.toISOString()
}

async function fetchData(range) {
  const since = rangeStartIso(range)

  // FIX (med): Use server-side count aggregation instead of fetching raw rows.
  // episode_vibes has (episode_guid, vibe, user_id, created_at).
  // We still need user_id per episode for the drawer, so we fetch a capped set
  // of rows but warn loudly if the result is truncated at the hard cap.
  const HARD_CAP = 100000
  const { data, error, count } = await sb
    .from('episode_vibes')
    .select('vibe, episode_guid, user_id', { count: 'exact' })
    .gte('created_at', since)
    .limit(HARD_CAP)
  if (error) throw error

  const reactionRows = (data || []).map(r => ({
    vibe: r.vibe,
    episode_guid: r.episode_guid,
    user_id: r.user_id,
  }))

  // Warn if server has more rows than our cap — counts would be wrong
  const truncated = (count != null && count > HARD_CAP)

  const counts = Object.fromEntries(VIBES.map(v => [v.key, 0]))
  const episodeScores = new Map()
  for (const r of reactionRows) {
    if (!r.vibe || !(r.vibe in counts)) continue
    counts[r.vibe]++
    const m = episodeScores.get(r.episode_guid) || { _user_id: r.user_id }
    m[r.vibe] = (m[r.vibe] || 0) + 1
    episodeScores.set(r.episode_guid, m)
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0)

  const topEpisodesPerVibe = {}
  for (const v of VIBES) {
    const arr = []
    for (const [episodeId, m] of episodeScores.entries()) {
      if (m[v.key]) arr.push({ episode_guid: episodeId, count: m[v.key], user_id: m._user_id })
    }
    arr.sort((a, b) => b.count - a.count)
    topEpisodesPerVibe[v.key] = arr.slice(0, 10)
  }

  return { counts, total, topEpisodesPerVibe, sampleSize: reactionRows.length, truncated, range }
}

// FIX (high): Fetch episode details from the podcasts table by episode_guid.
// Returns a map of episode_guid -> { title, podcast_title, user_id }
async function fetchEpisodeDetails(episodeIds) {
  if (!episodeIds || episodeIds.length === 0) return {}
  try {
    const { data, error } = await sb
      .from('podcasts')
      .select('id, title, user_id')
      .in('id', episodeIds)
    if (error) throw error
    const map = {}
    for (const row of (data || [])) {
      map[row.id] = {
        title: row.title || null,
        user_id: row.user_id || null,
      }
    }
    return map
  } catch {
    return {}
  }
}

function dominantVibeKey(counts) {
  let best = VIBES[0].key, bestN = -1
  for (const v of VIBES) if ((counts[v.key] || 0) > bestN) { best = v.key; bestN = counts[v.key] || 0 }
  return best
}

function renderEmpty(body) {
  body.innerHTML = `
    <div class="empty-state glass-card" style="text-align:center;padding:48px 24px;">
      <div style="font-size:64px;line-height:1;margin-bottom:16px;">🎭</div>
      <h3 style="margin:0 0 8px;">Noch keine Vibes erfasst</h3>
      <p style="color:var(--muted);max-width:420px;margin:0 auto 20px;">
        Sobald die Community Posts mit Emoji-Vibes markiert, erscheint die Verteilung hier in Echtzeit.
      </p>
      <button class="btn btn-primary" data-act="refresh">${iconHtml('refresh')} Neu laden</button>
    </div>`
}

function renderError(body, err) {
  body.innerHTML = `
    <div class="empty-state glass-card" style="text-align:center;padding:48px 24px;border:1px solid rgba(255,90,90,0.25);">
      <div style="font-size:48px;margin-bottom:12px;">⚠️</div>
      <h3 style="margin:0 0 8px;">Konnte Vibes nicht laden</h3>
      <p style="color:var(--muted);max-width:480px;margin:0 auto 20px;font-family:monospace;font-size:12px;">
        ${htmlEscape(err?.message || String(err))}
      </p>
      <button class="btn btn-primary" data-act="refresh">${iconHtml('refresh')} Erneut versuchen</button>
    </div>`
}

async function openVibeDrawer(vibeKey, data) {
  const v = VIBE_BY_KEY[vibeKey]
  if (!v) return
  const top = data.topEpisodesPerVibe[vibeKey] || []
  const episodeIds = top.map(t => t.episode_guid)

  // FIX (high): Fetch real episode details from podcasts table
  const details = await fetchEpisodeDetails(episodeIds)

  const rows = top.map((t, i) => {
    const ep = details[t.episode_guid] || {}
    // FIX (high): Show episode title if available, fall back to episode_guid as readable identifier
    const title = htmlEscape(ep.title || t.episode_guid || '–')
    // FIX (high): uid comes from details or the vibe row itself
    const uid = ep.user_id || t.user_id || ''
    return `
      <tr data-episode-id="${htmlEscape(t.episode_guid)}" data-user-id="${htmlEscape(uid)}" style="cursor:${uid ? 'pointer' : 'default'};">
        <td style="width:32px;color:var(--muted);font-variant-numeric:tabular-nums;">${i + 1}</td>
        <td>
          <div style="font-weight:600;">${title}</div>
        </td>
        <td style="text-align:right;font-variant-numeric:tabular-nums;">
          <span style="background:${v.color}22;color:${v.color};padding:3px 10px;border-radius:999px;font-weight:600;">
            ${v.emoji} ${fmtNumber(t.count)}
          </span>
        </td>
      </tr>`
  }).join('')

  const content = `
    <div style="display:flex;align-items:center;gap:16px;margin-bottom:20px;">
      <div style="width:64px;height:64px;border-radius:18px;background:${v.color}22;display:flex;align-items:center;justify-content:center;font-size:36px;">
        ${v.emoji}
      </div>
      <div>
        <div style="font-size:13px;color:var(--muted);text-transform:uppercase;letter-spacing:0.08em;">Top Episodes · ${state.range === '7d' ? '7 Tage' : '30 Tage'}</div>
        <h3 style="margin:2px 0 0;font-size:22px;">${v.label}</h3>
      </div>
      <div style="margin-left:auto;text-align:right;">
        <div style="font-size:28px;font-weight:700;color:${v.color};">${fmtNumber(data.counts[vibeKey] || 0)}</div>
        <div style="font-size:12px;color:var(--muted);">Reaktionen gesamt</div>
      </div>
    </div>
    ${top.length === 0 ? `
      <div class="empty-state" style="text-align:center;padding:32px;color:var(--muted);">
        <div style="font-size:42px;margin-bottom:8px;">${v.emoji}</div>
        Noch keine Episodes mit diesem Vibe im Zeitraum.
      </div>` : `
      <table class="data-table hover-rows" style="width:100%;">
        <thead>
          <tr>
            <th style="width:32px;">#</th>
            <th>Episode</th>
            <th style="text-align:right;">Vibe-Score</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`}
  `

  const dr = drawer({
    title: `${v.emoji} ${v.label}`,
    width: 560,
    content,
  })

  const el = dr?.el || dr
  const tbody = el?.querySelector?.('tbody')
  if (tbody) {
    tbody.addEventListener('click', (e) => {
      const tr = e.target.closest('tr[data-user-id]')
      if (!tr) return
      const uid = tr.getAttribute('data-user-id')
      // FIX (high): Only call showUserDetailModal when uid is actually present
      if (uid) showUserDetailModal(uid)
    })
  }
}

function renderBody(body, data) {
  if (!data.total) { renderEmpty(body); return }

  const dom = dominantVibeKey(data.counts)
  const domV = VIBE_BY_KEY[dom]
  const domPct = data.total ? Math.round((data.counts[dom] / data.total) * 100) : 0

  // FIX (med): Responsive vibe-grid with media-query via inline style + CSS variable
  body.innerHTML = `
    <style>
      @media (max-width: 767px) {
        .vibe-grid { grid-template-columns: 1fr !important; }
      }
    </style>
    ${data.truncated ? `
    <div style="margin-bottom:12px;padding:10px 14px;background:rgba(255,193,77,0.12);border:1px solid rgba(255,193,77,0.3);border-radius:8px;font-size:13px;color:#ffc24d;">
      ⚠️ Mehr als 100.000 Vibe-Reaktionen im Zeitraum — Zähler basieren auf der ersten 100.000. Für exakte Zahlen Server-seitige Aggregation einrichten.
    </div>` : ''}
    <div class="vibe-grid" style="display:grid;grid-template-columns:1.4fr 1fr;gap:20px;align-items:stretch;">
      <section class="glass-card" style="padding:24px;">
        <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:8px;">
          <h3 style="margin:0;font-size:16px;">Verteilung der Vibes</h3>
          <div style="color:var(--muted);font-size:12px;">${fmtNumber(data.total)} Reaktionen</div>
        </div>
        <div id="donut-host" style="height:380px;position:relative;"></div>
        <div id="vibe-legend" style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:14px;"></div>
      </section>

      <section style="display:flex;flex-direction:column;gap:16px;">
        <div id="hero-host"></div>
        <div class="glass-card" style="padding:20px;">
          <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:10px;">
            <h3 style="margin:0;font-size:15px;">Vibe-Ranking</h3>
            <div style="color:var(--muted);font-size:12px;">click für Top-Episodes</div>
          </div>
          <div id="bar-host" style="height:260px;"></div>
        </div>
      </section>
    </div>

    <div class="glass-card" style="padding:20px;margin-top:20px;">
      <h3 style="margin:0 0 12px;font-size:15px;">Vibe-Übersicht</h3>
      <table class="data-table hover-rows sortable" style="width:100%;">
        <thead>
          <tr>
            <th>Vibe</th>
            <th style="text-align:right;">Reaktionen</th>
            <th style="text-align:right;">Anteil</th>
            <th style="text-align:right;">Top-Episodes</th>
            <th style="text-align:right;"></th>
          </tr>
        </thead>
        <tbody id="vibe-tbody">
          ${VIBES.map(v => {
            const n = data.counts[v.key] || 0
            const pct = data.total ? (n / data.total) * 100 : 0
            const topN = (data.topEpisodesPerVibe[v.key] || []).length
            return `
              <tr data-vibe="${v.key}" style="cursor:pointer;">
                <td>
                  <span style="display:inline-flex;align-items:center;gap:10px;">
                    <span style="font-size:22px;line-height:1;">${v.emoji}</span>
                    <span style="font-weight:600;">${v.label}</span>
                  </span>
                </td>
                <td style="text-align:right;font-variant-numeric:tabular-nums;font-weight:600;">${fmtNumber(n)}</td>
                <td style="text-align:right;">
                  <div style="display:inline-flex;align-items:center;gap:8px;justify-content:flex-end;">
                    <div style="width:80px;height:6px;background:rgba(255,255,255,0.06);border-radius:999px;overflow:hidden;">
                      <div style="width:${pct.toFixed(1)}%;height:100%;background:${v.color};"></div>
                    </div>
                    <span style="font-variant-numeric:tabular-nums;color:var(--muted);min-width:42px;text-align:right;">${pct.toFixed(1)}%</span>
                  </div>
                </td>
                <td style="text-align:right;color:var(--muted);font-variant-numeric:tabular-nums;">${topN}</td>
                <td style="text-align:right;color:var(--muted);font-size:13px;">›</td>
              </tr>`
          }).join('')}
        </tbody>
      </table>
    </div>
  `

  const heroHost = body.querySelector('#hero-host')
  heroHost.innerHTML = ''
  try {
    const hero = statHero({
      label: 'Dominanter Vibe',
      value: `${domV.emoji} ${domV.label}`,
      sublabel: `${domPct}% aller Reaktionen · ${fmtNumber(data.counts[dom])}`,
      accent: domV.color,
    })
    const heroEl = hero?.el || hero
    if (heroEl instanceof Node) heroHost.appendChild(heroEl)
    else heroHost.innerHTML = `
      <div class="glass-card" style="padding:20px;border-left:3px solid ${domV.color};">
        <div style="font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:0.08em;">Dominanter Vibe</div>
        <div style="font-size:28px;font-weight:700;margin-top:4px;">${domV.emoji} ${domV.label}</div>
        <div style="color:var(--muted);font-size:13px;margin-top:4px;">${domPct}% aller Reaktionen · ${fmtNumber(data.counts[dom])}</div>
      </div>`
  } catch {}

  const donutHost = body.querySelector('#donut-host')
  const donutData = VIBES.map(v => ({
    label: `${v.emoji} ${v.label}`,
    value: data.counts[v.key] || 0,
    color: v.color,
    key: v.key,
  })).filter(d => d.value > 0)
  try {
    makeDonutChart(donutHost, {
      data: donutData,
      centerLabel: `${fmtNumber(data.total)}`,
      centerSublabel: 'Reaktionen',
      onSliceClick: (d) => d?.key && openVibeDrawer(d.key, data),
    })
  } catch {}

  const legend = body.querySelector('#vibe-legend')
  legend.innerHTML = VIBES.map(v => {
    const n = data.counts[v.key] || 0
    const pct = data.total ? ((n / data.total) * 100).toFixed(1) : '0.0'
    return `
      <button data-vibe="${v.key}" class="vibe-legend-chip" style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);cursor:pointer;text-align:left;">
        <span style="width:10px;height:10px;border-radius:50%;background:${v.color};flex-shrink:0;"></span>
        <span style="font-size:18px;line-height:1;">${v.emoji}</span>
        <span style="flex:1;min-width:0;">
          <div style="font-size:12px;font-weight:600;">${v.label}</div>
          <div style="font-size:11px;color:var(--muted);">${fmtNumber(n)} · ${pct}%</div>
        </span>
      </button>`
  }).join('')
  legend.querySelectorAll('[data-vibe]').forEach(btn => {
    btn.addEventListener('click', () => openVibeDrawer(btn.getAttribute('data-vibe'), data))
  })

  const barHost = body.querySelector('#bar-host')
  const sorted = [...VIBES].sort((a, b) => (data.counts[b.key] || 0) - (data.counts[a.key] || 0))
  try {
    makeBarChart(barHost, {
      data: sorted.map(v => ({ label: `${v.emoji}`, value: data.counts[v.key] || 0, color: v.color, key: v.key })),
      horizontal: true,
      onBarClick: (d) => d?.key && openVibeDrawer(d.key, data),
    })
  } catch {}

  body.querySelectorAll('#vibe-tbody tr[data-vibe]').forEach(tr => {
    tr.addEventListener('click', () => openVibeDrawer(tr.getAttribute('data-vibe'), data))
  })

  try { fadeIn(body) } catch {}
}

async function loadAndRender(body) {
  let skel
  try { skel = skeletonLoader(body, { rows: 4, layout: 'chart' }) } catch {}
  try {
    const data = await fetchData(state.range)
    state.data = data
    if (skel?.remove) skel.remove()
    renderBody(body, data)
  } catch (e) {
    if (skel?.remove) skel.remove()
    renderError(body, e)
  }
}

function exportCurrentCsv() {
  const d = state.data
  if (!d) { toast('Noch keine Daten geladen'); return }
  const rows = VIBES.map(v => ({
    vibe: v.label,
    emoji: v.emoji,
    reaktionen: d.counts[v.key] || 0,
    anteil_prozent: d.total ? ((d.counts[v.key] / d.total) * 100).toFixed(2) : '0.00',
  }))
  try {
    exportCsv(`vibe-verteilung-${state.range}-${new Date().toISOString().slice(0,10)}.csv`, rows)
    toast('CSV exportiert')
  } catch {
    toast('CSV-Export fehlgeschlagen')
  }
}

async function exportPdf(container) {
  try {
    await exportPanelAsPdf(container, { title: `Vibe-Verteilung (${state.range === '7d' ? '7 Tage' : '30 Tage'})` })
    toast('PDF erstellt')
  } catch (e) {
    toast('PDF-Export fehlgeschlagen')
  }
}

export default {
  id: 'vibe-distribution',
  title: 'Vibe-Verteilung',
  category: 'listening',

  async mount(container) {
    try {
      container.innerHTML = `
        <div class="panel-shell">
          <div class="panel-head" style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:18px;">
            <div>
              <h2 style="margin:0;font-size:22px;">Vibe-Verteilung</h2>
              <div style="color:var(--muted);font-size:13px;margin-top:2px;">
                Wie schwingen Posts? Emoji-Reaktionen auf einen Blick.
              </div>
            </div>
            <div id="range-host" style="margin-left:auto;"></div>
            <div class="toolbar" style="display:flex;gap:8px;">
              <button class="btn btn-ghost" data-act="refresh" title="Aktualisieren">${iconHtml('refresh')} Aktualisieren</button>
              <button class="btn btn-ghost" data-act="pdf" title="Als PDF">${iconHtml('file')} PDF</button>
              <button class="btn btn-ghost" data-act="csv" title="Als CSV">${iconHtml('download')} CSV</button>
            </div>
          </div>
          <div class="panel-body" id="body"></div>
        </div>`

      const body = container.querySelector('#body')
      const rangeHost = container.querySelector('#range-host')

      // FIX (med): Removed eager skeletonLoader call here — loadAndRender handles skeleton lifecycle

      try {
        const seg = segmentedControl({
          options: [
            { value: '7d', label: '7 Tage' },
            { value: '30d', label: '30 Tage' },
          ],
          value: state.range,
          onChange: (v) => { state.range = v; loadAndRender(body) },
        })
        const segEl = seg?.el || seg
        if (segEl instanceof Node) rangeHost.appendChild(segEl)
        else throw new Error('no seg el')
      } catch {
        // FIX (med): Fallback segmented control with active-state toggle
        rangeHost.innerHTML = `
          <div class="seg-fallback" style="display:inline-flex;gap:4px;background:rgba(255,255,255,0.04);padding:4px;border-radius:10px;">
            <button class="btn btn-ghost${state.range === '7d' ? ' active' : ''}" data-range="7d">7 Tage</button>
            <button class="btn btn-ghost${state.range === '30d' ? ' active' : ''}" data-range="30d">30 Tage</button>
          </div>`
        rangeHost.querySelectorAll('[data-range]').forEach(b =>
          b.addEventListener('click', () => {
            state.range = b.getAttribute('data-range')
            // Update active visual state on siblings
            rangeHost.querySelectorAll('[data-range]').forEach(s => s.classList.remove('active'))
            b.classList.add('active')
            loadAndRender(body)
          }))
      }

      container.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-act]')
        if (!btn) return
        const act = btn.getAttribute('data-act')
        if (act === 'refresh') {
          // FIX (med): Await loadAndRender, only toast on success
          try {
            await loadAndRender(body)
            toast('Aktualisiert')
          } catch {
            // renderError already shown inside loadAndRender
          }
        } else if (act === 'pdf') {
          exportPdf(container)
        } else if (act === 'csv') {
          exportCurrentCsv()
        }
      })

      loadAndRender(body)
    } catch (e) {
      container.innerHTML = `
        <div class="empty-state glass-card" style="text-align:center;padding:48px 24px;border:1px solid rgba(255,90,90,0.25);margin:20px;">
          <div style="font-size:48px;margin-bottom:12px;">⚠️</div>
          <h3 style="margin:0 0 8px;">Panel konnte nicht geladen werden</h3>
          <p style="color:var(--muted);max-width:480px;margin:0 auto 20px;font-family:monospace;font-size:12px;">
            ${htmlEscape(e?.message || String(e))}
          </p>
          <button class="btn btn-primary" onclick="location.reload()">Seite neu laden</button>
        </div>`
    }
  },
}
