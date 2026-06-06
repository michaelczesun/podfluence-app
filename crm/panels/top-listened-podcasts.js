import { sb } from '/lib/supabase.js'

export default {
  id: 'top-listened-podcasts',
  title: 'Top gehörte Podcasts',
  category: 'listening',
  summary: 'Podcasts mit den meisten Listens insgesamt.',
  async mount(container) {
    container.innerHTML = `<div class="panel-shell">
      <div class="panel-head"><h2>Top gehörte Podcasts</h2><button class="refresh-btn">Aktualisieren</button></div>
      <div class="panel-body"><div class="loading">Lädt…</div></div>
    </div>`
    const body = container.querySelector('.panel-body')

    const showToast = (msg) => {
      const t = document.createElement('div')
      t.className = 'toast'
      t.textContent = msg
      document.body.appendChild(t)
      setTimeout(() => t.remove(), 2500)
    }

    const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]))

    const refresh = async () => {
      body.innerHTML = '<div class="loading">Lädt…</div>'
      try {
        const { data: rows, error } = await sb
          .from('listening_activity')
          .select('podcast_id')
          .not('podcast_id', 'is', null)
          .limit(50000)
        if (error) throw error

        const counts = new Map()
        for (const r of rows || []) {
          const id = r.podcast_id
          if (!id) continue
          counts.set(id, (counts.get(id) || 0) + 1)
        }
        const top = [...counts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 20)

        if (top.length === 0) {
          body.innerHTML = '<div class="empty">Noch keine Listens.</div>'
          return
        }

        const ids = top.map(([id]) => id)
        const { data: pods, error: pErr } = await sb
          .from('podcasts')
          .select('id, host_display_name, owner_name, followers_count')
          .in('id', ids)
        if (pErr) throw pErr

        const pMap = new Map((pods || []).map((p) => [p.id, p]))

        const totalListens = top.reduce((a, [, c]) => a + c, 0)
        const topListens = top[0][1]
        const topPod = pMap.get(top[0][0])
        const topName = topPod?.host_display_name || topPod?.owner_name || top[0][0]

        const kpiHtml = `
          <div class="kpi-grid">
            <div class="kpi-tile"><div class="label">Podcasts im Ranking</div><div class="value">${top.length}</div><div class="hint">Top-20</div></div>
            <div class="kpi-tile"><div class="label">Listens (Top-20)</div><div class="value">${totalListens.toLocaleString('de-DE')}</div><div class="hint">Summe</div></div>
            <div class="kpi-tile"><div class="label">Spitzenreiter</div><div class="value">${escapeHtml(topName)}</div><div class="hint">${topListens.toLocaleString('de-DE')} Listens</div></div>
          </div>
        `

        const rowsHtml = top.map(([id, c], i) => {
          const p = pMap.get(id)
          const name = p?.host_display_name || p?.owner_name || id
          const followers = p?.followers_count ?? '–'
          return `<tr>
            <td>${i + 1}</td>
            <td>${escapeHtml(name)}</td>
            <td>${typeof followers === 'number' ? followers.toLocaleString('de-DE') : followers}</td>
            <td><strong>${c.toLocaleString('de-DE')}</strong></td>
          </tr>`
        }).join('')

        body.innerHTML = `
          ${kpiHtml}
          <table class="data-table leaderboard">
            <thead><tr><th>#</th><th>Podcast</th><th>Follower</th><th>Listens</th></tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        `
      } catch (e) {
        body.innerHTML = '<div class="empty">Daten kommen bald: ' + escapeHtml(e?.message || 'unbekannt') + '</div>'
      }
    }

    container.querySelector('.refresh-btn').addEventListener('click', refresh)
    await refresh()
  }
}
