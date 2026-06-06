import { sb } from '/lib/supabase.js'

export default {
  id: 'top-listeners',
  title: 'Aktivste Hörer',
  category: 'listening',
  summary: "User mit den meisten Listening-Einträgen.",
  async mount(container) {
    container.innerHTML = `<div class="panel-shell">
      <div class="panel-head"><h2>Aktivste Hörer</h2><button class="refresh-btn">Aktualisieren</button></div>
      <div class="panel-body"><div class="loading">Lädt…</div></div>
    </div>`
    const body = container.querySelector('.panel-body')

    const refresh = async () => {
      body.innerHTML = '<div class="loading">Lädt…</div>'
      try {
        const { data: rows, error } = await sb
          .from('listening_activity')
          .select('listener_id')
          .limit(5000)
        if (error) throw error

        const counts = new Map()
        for (const r of (rows || [])) {
          if (!r.listener_id) continue
          counts.set(r.listener_id, (counts.get(r.listener_id) || 0) + 1)
        }
        const top = [...counts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 20)

        if (top.length === 0) {
          body.innerHTML = '<div class="empty">Noch keine Listening-Einträge.</div>'
          return
        }

        const ids = top.map(([id]) => id)
        const { data: users, error: uerr } = await sb
          .from('users')
          .select('id, username, full_name, country')
          .in('id', ids)
        if (uerr) throw uerr

        const umap = new Map((users || []).map(u => [u.id, u]))

        const totalEntries = [...counts.values()].reduce((a, b) => a + b, 0)
        const uniqueListeners = counts.size
        const topVal = top[0][1]
        const avgTop = Math.round(top.reduce((a, [, v]) => a + v, 0) / top.length)

        let html = ''
        html += '<div class="kpi-grid">'
        html += `<div class="kpi-tile"><div class="label">Top-Hörer (Einträge)</div><div class="value">${topVal}</div><div class="hint">Spitzenreiter</div></div>`
        html += `<div class="kpi-tile"><div class="label">Ø Top 20</div><div class="value">${avgTop}</div><div class="hint">pro Hörer</div></div>`
        html += `<div class="kpi-tile"><div class="label">Aktive Hörer</div><div class="value">${uniqueListeners}</div><div class="hint">in Sample</div></div>`
        html += `<div class="kpi-tile"><div class="label">Einträge gesamt</div><div class="value">${totalEntries}</div><div class="hint">Sample (5k)</div></div>`
        html += '</div>'

        html += '<table class="data-table leaderboard" style="margin-top:16px;width:100%;border-collapse:collapse;">'
        html += '<thead><tr><th style="text-align:left;padding:8px;border-bottom:1px solid #2A2A33;">#</th><th style="text-align:left;padding:8px;border-bottom:1px solid #2A2A33;">User</th><th style="text-align:left;padding:8px;border-bottom:1px solid #2A2A33;">Name</th><th style="text-align:left;padding:8px;border-bottom:1px solid #2A2A33;">Land</th><th style="text-align:right;padding:8px;border-bottom:1px solid #2A2A33;">Einträge</th></tr></thead><tbody>'
        top.forEach(([id, c], i) => {
          const u = umap.get(id) || {}
          const uname = u.username ? '@' + u.username : (id.slice(0, 8) + '…')
          const name = u.full_name || '—'
          const country = u.country || '—'
          const rankColor = i === 0 ? '#8B5CF6' : (i < 3 ? '#A78BFA' : '#fff')
          const barW = Math.max(4, Math.round((c / topVal) * 100))
          html += `<tr>
            <td style="padding:8px;border-bottom:1px solid #2A2A33;color:${rankColor};font-weight:600;">${i + 1}</td>
            <td style="padding:8px;border-bottom:1px solid #2A2A33;">${escapeHtml(uname)}</td>
            <td style="padding:8px;border-bottom:1px solid #2A2A33;">${escapeHtml(name)}</td>
            <td style="padding:8px;border-bottom:1px solid #2A2A33;">${escapeHtml(country)}</td>
            <td style="padding:8px;border-bottom:1px solid #2A2A33;text-align:right;">
              <div style="display:inline-flex;align-items:center;gap:8px;justify-content:flex-end;">
                <div style="background:#2A2A33;width:80px;height:6px;border-radius:3px;overflow:hidden;">
                  <div style="background:#8B5CF6;width:${barW}%;height:100%;"></div>
                </div>
                <span style="min-width:32px;text-align:right;color:#fff;">${c}</span>
              </div>
            </td>
          </tr>`
        })
        html += '</tbody></table>'

        body.innerHTML = html
      } catch (e) {
        body.innerHTML = '<div class="empty">Daten kommen bald: ' + (e?.message || 'unbekannt') + '</div>'
      }
    }

    function escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
    }

    container.querySelector('.refresh-btn').addEventListener('click', refresh)
    await refresh()
  }
}
