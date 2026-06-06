import { sb } from '/lib/supabase.js'

export default {
  id: 'trending-podcasters',
  title: 'Trending Podcaster',
  category: 'engagement',
  summary: 'Aktuell trendende Podcaster.',
  async mount(container) {
    container.innerHTML = `<div class="panel-shell">
      <div class="panel-head"><h2>Trending Podcaster</h2><button class="refresh-btn">Aktualisieren</button></div>
      <div class="panel-body"><div class="loading">Lädt…</div></div>
    </div>`
    const body = container.querySelector('.panel-body')

    const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]))

    const fmtNum = (n) => {
      const num = Number(n)
      if (!isFinite(num)) return '–'
      if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M'
      if (num >= 1_000) return (num / 1_000).toFixed(1) + 'k'
      return String(num)
    }

    const refresh = async () => {
      body.innerHTML = '<div class="loading">Lädt…</div>'
      try {
        const { data, error } = await sb
          .from('trending_podcasters')
          .select('*')
          .limit(20)
        if (error) throw error

        const rows = Array.isArray(data) ? data : []
        if (rows.length === 0) {
          body.innerHTML = '<div class="empty">Noch keine Trending-Podcaster verfügbar.</div>'
          return
        }

        const first = rows[0]
        const cols = Object.keys(first)
        const nameKey = cols.find((c) => ['host_display_name', 'display_name', 'name', 'username', 'full_name', 'title'].includes(c)) || cols[0]
        const scoreKey = cols.find((c) => ['score', 'engagement_score', 'trend_score', 'rank_score'].includes(c))
          || cols.find((c) => typeof first[c] === 'number' && c !== nameKey)
          || cols[1]
        const followersKey = cols.find((c) => ['followers_count', 'followers'].includes(c))
        const episodesKey = cols.find((c) => ['episodes_total', 'episodes_count', 'episodes'].includes(c))

        const totalScore = rows.reduce((s, r) => s + (Number(r[scoreKey]) || 0), 0)
        const avgScore = totalScore / rows.length
        const topName = first[nameKey] || '–'
        const totalFollowers = followersKey ? rows.reduce((s, r) => s + (Number(r[followersKey]) || 0), 0) : null

        const kpis = [
          { label: 'Trending #1', value: escapeHtml(topName), hint: scoreKey + ': ' + fmtNum(first[scoreKey]) },
          { label: 'Einträge', value: rows.length, hint: 'TOP-Liste' },
          { label: 'Ø Score', value: fmtNum(avgScore.toFixed(1)), hint: scoreKey }
        ]
        if (totalFollowers !== null) {
          kpis.push({ label: 'Σ Follower', value: fmtNum(totalFollowers), hint: 'aller Top-20' })
        }

        const kpiHtml = `<div class="kpi-grid">${kpis.map((k) => `
          <div class="kpi-tile">
            <div class="kpi-label">${escapeHtml(k.label)}</div>
            <div class="kpi-value">${escapeHtml(k.value)}</div>
            <div class="kpi-hint">${escapeHtml(k.hint)}</div>
          </div>`).join('')}</div>`

        const tableHtml = `<table class="data-table leaderboard">
          <thead><tr>
            <th style="width:48px">#</th>
            <th>Podcaster</th>
            <th style="text-align:right">${escapeHtml(scoreKey)}</th>
            ${followersKey ? `<th style="text-align:right">Follower</th>` : ''}
            ${episodesKey ? `<th style="text-align:right">Episoden</th>` : ''}
          </tr></thead>
          <tbody>
            ${rows.map((r, i) => `<tr>
              <td><strong style="color:#8B5CF6">${i + 1}</strong></td>
              <td>${escapeHtml(r[nameKey] || '–')}</td>
              <td style="text-align:right">${escapeHtml(fmtNum(r[scoreKey]))}</td>
              ${followersKey ? `<td style="text-align:right">${escapeHtml(fmtNum(r[followersKey]))}</td>` : ''}
              ${episodesKey ? `<td style="text-align:right">${escapeHtml(fmtNum(r[episodesKey]))}</td>` : ''}
            </tr>`).join('')}
          </tbody>
        </table>`

        body.innerHTML = `
          <div style="display:flex;flex-direction:column;gap:16px">
            ${kpiHtml}
            <div style="background:#1C1C24;border:1px solid #2A2A33;border-radius:12px;padding:12px">
              ${tableHtml}
            </div>
          </div>`
      } catch (e) {
        body.innerHTML = '<div class="empty">Daten kommen bald: ' + escapeHtml(e?.message || 'unbekannt') + '</div>'
      }
    }

    container.querySelector('.refresh-btn').addEventListener('click', refresh)
    await refresh()
  }
}
