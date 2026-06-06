import { sb } from '/lib/supabase.js'

export default {
  id: 'podcaster-engagement-7d',
  title: 'Podcaster-Engagement (7 Tage)',
  category: 'engagement',
  summary: 'Top Podcaster nach 7-Tage-Engagement.',
  async mount(container) {
    container.innerHTML = `<div class="panel-shell">
      <div class="panel-head"><h2>Podcaster-Engagement (7 Tage)</h2><button class="refresh-btn">Aktualisieren</button></div>
      <div class="panel-body"><div class="loading">Lädt…</div></div>
    </div>`
    const body = container.querySelector('.panel-body')

    const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]))

    const fmt = (n) => {
      if (n === null || n === undefined) return '–'
      const num = Number(n)
      if (Number.isNaN(num)) return String(n)
      return num.toLocaleString('de-DE')
    }

    const refresh = async () => {
      body.innerHTML = '<div class="loading">Lädt…</div>'
      try {
        const { data, error } = await sb
          .from('podcaster_engagement_7d')
          .select('*')
          .order('engagement_score', { ascending: false })
          .limit(25)

        if (error) throw error

        if (!data || data.length === 0) {
          body.innerHTML = '<div class="empty">Keine Daten in den letzten 7 Tagen.</div>'
          return
        }

        const sample = data[0]
        const preferredCols = [
          'username', 'full_name', 'host_display_name', 'podcaster_name', 'name',
          'posts', 'posts_count', 'updates_count',
          'comments', 'comments_count',
          'listens', 'listens_count',
          'vibes', 'vibes_count',
          'engagement_score', 'score'
        ]
        const cols = preferredCols.filter((c) => c in sample)
        const fallbackCols = Object.keys(sample).filter((k) => k !== 'id' && k !== 'podcaster_id' && !cols.includes(k))
        const finalCols = cols.length > 0 ? cols : fallbackCols.slice(0, 6)

        const headerLabels = {
          username: 'Username',
          full_name: 'Name',
          host_display_name: 'Host',
          podcaster_name: 'Podcaster',
          name: 'Name',
          posts: 'Posts',
          posts_count: 'Posts',
          updates_count: 'Updates',
          comments: 'Kommentare',
          comments_count: 'Kommentare',
          listens: 'Listens',
          listens_count: 'Listens',
          vibes: 'Vibes',
          vibes_count: 'Vibes',
          engagement_score: 'Score',
          score: 'Score'
        }

        const thead = '<tr><th>#</th>' + finalCols.map((c) => `<th>${escapeHtml(headerLabels[c] || c)}</th>`).join('') + '</tr>'
        const rows = data.map((row, i) => {
          const tds = finalCols.map((c) => {
            const v = row[c]
            const isNum = typeof v === 'number'
            return `<td>${isNum ? fmt(v) : escapeHtml(v)}</td>`
          }).join('')
          return `<tr><td>${i + 1}</td>${tds}</tr>`
        }).join('')

        body.innerHTML = `
          <div style="overflow-x:auto;">
            <table class="data-table leaderboard" style="width:100%;border-collapse:collapse;color:#fff;">
              <thead style="background:#1F1F28;color:#8B5CF6;">${thead}</thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        `
      } catch (e) {
        body.innerHTML = '<div class="empty">Daten kommen bald: ' + escapeHtml(e?.message || 'unbekannt') + '</div>'
      }
    }

    container.querySelector('.refresh-btn').addEventListener('click', refresh)
    await refresh()
  }
}
