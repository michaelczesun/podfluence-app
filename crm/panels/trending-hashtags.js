import { sb } from '/lib/supabase.js'

export default {
  id: 'trending-hashtags',
  title: 'Trending Hashtags (30 Tage)',
  category: 'content',
  summary: "Meistgenutzte Hashtags im Monat.",
  async mount(container) {
    container.innerHTML = `<div class="panel-shell">
      <div class="panel-head"><h2>Trending Hashtags (30 Tage)</h2><button class="refresh-btn">Aktualisieren</button></div>
      <div class="panel-body"><div class="loading">Lädt…</div></div>
    </div>`
    const body = container.querySelector('.panel-body')

    const escape = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]))

    const pickTag = (row) => {
      const candidates = ['hashtag', 'tag', 'name', 'label', 'term', 'token']
      for (const k of candidates) {
        if (row[k] != null && row[k] !== '') return String(row[k])
      }
      for (const k of Object.keys(row)) {
        if (typeof row[k] === 'string' && row[k].length < 80) return row[k]
      }
      return '–'
    }

    const pickCount = (row) => {
      const candidates = ['uses', 'count', 'usage_count', 'total', 'score', 'n', 'mentions', 'cnt']
      for (const k of candidates) {
        if (typeof row[k] === 'number') return row[k]
      }
      for (const k of Object.keys(row)) {
        if (typeof row[k] === 'number') return row[k]
      }
      return 0
    }

    const refresh = async () => {
      body.innerHTML = '<div class="loading">Lädt…</div>'
      try {
        const { data, error } = await sb
          .from('trending_hashtags_30d')
          .select('*')
          .limit(20)
        if (error) throw error
        const rows = (data || []).map((r) => ({
          tag: pickTag(r),
          count: pickCount(r)
        }))

        if (rows.length === 0) {
          body.innerHTML = '<div class="empty">Keine Hashtags im Zeitraum.</div>'
          return
        }

        rows.sort((a, b) => b.count - a.count)
        const max = Math.max(1, ...rows.map((r) => r.count))
        const total = rows.reduce((s, r) => s + r.count, 0)
        const top = rows[0]

        const kpis = `
          <div class="kpi-grid">
            <div class="kpi-tile"><div style="font-size:11px;color:#9CA3AF;text-transform:uppercase;letter-spacing:.5px">Tags gesamt</div><div style="font-size:24px;font-weight:700;color:#fff;margin-top:4px">${rows.length}</div><div style="font-size:11px;color:#9CA3AF;margin-top:2px">in Top 20</div></div>
            <div class="kpi-tile"><div style="font-size:11px;color:#9CA3AF;text-transform:uppercase;letter-spacing:.5px">Erwähnungen</div><div style="font-size:24px;font-weight:700;color:#fff;margin-top:4px">${total.toLocaleString('de-DE')}</div><div style="font-size:11px;color:#9CA3AF;margin-top:2px">Summe</div></div>
            <div class="kpi-tile"><div style="font-size:11px;color:#9CA3AF;text-transform:uppercase;letter-spacing:.5px">Top-Tag</div><div style="font-size:20px;font-weight:700;color:#8B5CF6;margin-top:4px">#${escape(top.tag.replace(/^#/, ''))}</div><div style="font-size:11px;color:#9CA3AF;margin-top:2px">${top.count.toLocaleString('de-DE')} Erwähnungen</div></div>
          </div>
        `

        const tableRows = rows.map((r, i) => {
          const pct = Math.round((r.count / max) * 100)
          const rankColor = i === 0 ? '#8B5CF6' : i < 3 ? '#A78BFA' : '#9CA3AF'
          return `<tr>
            <td style="width:48px;color:${rankColor};font-weight:700">#${i + 1}</td>
            <td style="color:#fff;font-weight:600">#${escape(r.tag.replace(/^#/, ''))}</td>
            <td style="width:50%">
              <div style="background:#2A2A33;border-radius:6px;height:10px;overflow:hidden">
                <div style="background:#8B5CF6;height:100%;width:${pct}%"></div>
              </div>
            </td>
            <td style="width:80px;text-align:right;color:#fff;font-variant-numeric:tabular-nums">${r.count.toLocaleString('de-DE')}</td>
          </tr>`
        }).join('')

        body.innerHTML = `
          ${kpis}
          <div style="margin-top:16px">
            <table class="data-table leaderboard" style="width:100%;border-collapse:collapse">
              <thead>
                <tr style="border-bottom:1px solid #2A2A33;color:#9CA3AF;font-size:11px;text-transform:uppercase;letter-spacing:.5px">
                  <th style="text-align:left;padding:8px 4px">Rang</th>
                  <th style="text-align:left;padding:8px 4px">Hashtag</th>
                  <th style="text-align:left;padding:8px 4px">Verteilung</th>
                  <th style="text-align:right;padding:8px 4px">Anzahl</th>
                </tr>
              </thead>
              <tbody>${tableRows}</tbody>
            </table>
          </div>
        `
      } catch (e) {
        body.innerHTML = '<div class="empty">Daten kommen bald: ' + escape(e?.message || 'unbekannt') + '</div>'
      }
    }
    container.querySelector('.refresh-btn').addEventListener('click', refresh)
    await refresh()
  }
}
