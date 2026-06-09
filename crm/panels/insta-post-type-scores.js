import { sb } from '/lib/supabase.js?v=20260608l'
import { toast, fmtNumber, fmtRelativeTime, htmlEscape, iconHtml } from '/lib/ui.js?v=20260608l'
import { makeAreaChart, makeBarChart, makeDonutChart } from '/lib/charts.js?v=20260608l'
import { exportPanelAsPdf, exportCsv } from '/lib/export.js?v=20260608l'
import { countUp, fadeIn, skeletonLoader } from '/lib/animations.js?v=20260608l'
import { drawer, segmentedControl, statHero } from '/lib/layout-extras.js?v=20260608l'
import { showUserDetailModal } from '/lib/panel-actions.js?v=20260608l'

// HINWEIS: Datenquelle insta_posts_queue ist eine TOTE Tabelle (siehe Schema-Audit).
// Es existiert KEINE produktive Quelle für IG-Post-Performance-Daten und kein passendes Admin-RPC.
// Panel zeigt daher einen klaren Deaktivierungs-Status. Sobald ein RPC wie
// admin_insta_post_performance bereitsteht, kann die Logik unten aktiviert werden.

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

function computeScore(p) {
  const likes  = Number(p.like_count || p.likes || 0)
  const cmts   = Number(p.comments_count || p.comments || 0)
  const views  = Number(p.view_count || p.plays || p.video_views || 0)
  const saves  = Number(p.save_count || p.saves || 0)
  const shares = Number(p.share_count || p.shares || 0)
  const rawReach = Number(p.reach || p.impressions || 0)
  const engage = likes + 2 * cmts + 3 * saves + 4 * shares
  if (rawReach === 0 && views === 0) {
    return { score: null, is_estimated: true, engage, reach: 0, views, likes, cmts, saves, shares }
  }
  const reach = rawReach > 0 ? rawReach : views
  const score = (engage / Math.max(1, reach)) * 1000 + Math.log10(1 + views) * 5
  return { score: +score.toFixed(2), is_estimated: false, engage, reach, views, likes, cmts, saves, shares }
}

function aggregate(posts) {
  const byType = new Map()
  for (const p of posts) {
    const t = (p.post_type || p.media_type || 'unknown').toLowerCase()
    if (!byType.has(t)) byType.set(t, { type: t, count: 0, scoreSum: 0, scoreCount: 0, engageSum: 0, reachSum: 0, viewsSum: 0, estimatedCount: 0, posts: [] })
    const row = byType.get(t)
    const m = computeScore(p)
    row.count++
    if (m.score !== null) { row.scoreSum += m.score; row.scoreCount++ }
    if (m.is_estimated) row.estimatedCount++
    row.engageSum += m.engage
    row.reachSum  += m.reach
    row.viewsSum  += m.views
    row.posts.push({ ...p, _metrics: m })
  }
  const rows = [...byType.values()].map(r => ({
    ...r,
    avgScore:  r.scoreCount > 0 ? +(r.scoreSum / r.scoreCount).toFixed(2) : null,
    avgEngage: Math.round(r.engageSum / Math.max(1, r.count)),
    avgReach:  Math.round(r.reachSum  / Math.max(1, r.count)),
  })).sort((a, b) => {
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
      container.innerHTML = `
        <div class="panel-shell">
          <div class="panel-head">
            <div>
              <h2>${iconHtml('bar-chart-3')} IG-Post-Typ Scoring</h2>
              <div class="panel-sub" style="color:var(--text-muted);">Welcher Content-Typ performt? Performance-Score pro Post-Format.</div>
            </div>
          </div>
          <div class="panel-body">
            <div class="empty-state" style="padding:48px 24px;text-align:center;color:var(--text);background:var(--bg-glass);border-radius:12px;">
              <div class="empty-icon" style="font-size:48px;opacity:0.6;">${iconHtml('plug')}</div>
              <h3 style="color:var(--text);margin:12px 0 6px;">Panel derzeit ohne Datenquelle</h3>
              <p style="color:var(--text-muted);max-width:560px;margin:0 auto;">
                Die bisherige Quelle <code>insta_posts_queue</code> existiert nicht mehr im aktuellen Schema.
                Sobald ein Admin-RPC für Instagram-Post-Performance (z. B. <code>admin_insta_post_performance</code>) bereitgestellt ist,
                wird dieses Panel automatisch wieder aktiv.
              </p>
            </div>
          </div>
        </div>
      `
      // Unused-imports markieren als referenziert um Linter-Warnungen zu vermeiden, ohne Side-Effects
      void [sb, toast, fmtNumber, fmtRelativeTime, htmlEscape, makeAreaChart, makeBarChart, makeDonutChart,
            exportPanelAsPdf, exportCsv, countUp, fadeIn, skeletonLoader, drawer, segmentedControl, statHero,
            showUserDetailModal, metaFor, aggregate, computeScore, POST_TYPE_META]
    } catch (mountErr) {
      console.error('[insta-post-type-scores] mount failed', mountErr)
      container.textContent = 'Panel konnte nicht initialisiert werden: ' + (mountErr?.message || mountErr)
    }
  }
}
