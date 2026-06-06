import { sb } from '/lib/supabase.js'

export default {
  id: 'insta-post-type-scores',
  title: 'IG-Post-Typ Scoring',
  category: 'marketing',
  summary: 'Welche Content-Typen schneiden im IG-Picker am besten ab.',
  async mount(container) {
    container.innerHTML = `<div class="panel-shell">
      <div class="panel-head"><h2>IG-Post-Typ Scoring</h2><button class="refresh-btn">Aktualisieren</button></div>
      <div class="panel-body"><div class="loading">Lädt…</div></div>
    </div>`
    const body = container.querySelector('.panel-body')

    const showToast = (msg) => {
      const t = document.createElement('div')
      t.className = 'toast'
      t.textContent = msg
      document.body.appendChild(t)
      setTimeout(() => t.remove(), 2400)
    }

    const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]))

    const renderBarChart = (rows) => {
      if (!rows || rows.length === 0) {
        body.innerHTML = '<div class="empty">Noch keine Daten.</div>'
        return
      }

      const labelKey = ['post_type', 'type', 'name', 'label', 'category'].find((k) => k in rows[0]) || Object.keys(rows[0])[0]
      const valueKey = ['score', 'value', 'count', 'avg_score', 'total'].find((k) => k in rows[0] && typeof rows[0][k] === 'number') || Object.keys(rows[0]).find((k) => typeof rows[0][k] === 'number') || Object.keys(rows[0])[1]

      const data = rows.map((r) => ({
        label: String(r[labelKey] ?? '—'),
        value: Number(r[valueKey] ?? 0)
      }))

      const maxVal = Math.max(...data.map((d) => d.value), 1)
      const width = 720
      const height = 320
      const padL = 48
      const padR = 16
      const padT = 24
      const padB = 60
      const innerW = width - padL - padR
      const innerH = height - padT - padB
      const barW = Math.max(12, Math.min(64, innerW / data.length - 16))
      const gap = (innerW - barW * data.length) / Math.max(1, data.length)

      const bars = data.map((d, i) => {
        const h = (d.value / maxVal) * innerH
        const x = padL + gap / 2 + i * (barW + gap)
        const y = padT + innerH - h
        return `
          <g>
            <rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="6" ry="6" fill="#8B5CF6"></rect>
            <text x="${x + barW / 2}" y="${y - 6}" text-anchor="middle" font-size="11" fill="#fff">${escapeHtml(d.value.toFixed(2))}</text>
            <text x="${x + barW / 2}" y="${padT + innerH + 16}" text-anchor="middle" font-size="11" fill="#bbb">${escapeHtml(d.label.slice(0, 14))}</text>
          </g>
        `
      }).join('')

      const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => {
        const y = padT + innerH - t * innerH
        const v = (t * maxVal).toFixed(1)
        return `
          <line x1="${padL}" y1="${y}" x2="${padL + innerW}" y2="${y}" stroke="#2A2A33" stroke-width="1"></line>
          <text x="${padL - 8}" y="${y + 4}" text-anchor="end" font-size="10" fill="#888">${v}</text>
        `
      }).join('')

      body.innerHTML = `
        <div style="background:#16161D;border:1px solid #2A2A33;border-radius:12px;padding:16px;">
          <svg viewBox="0 0 ${width} ${height}" width="100%" style="display:block;">
            ${yTicks}
            ${bars}
          </svg>
        </div>
        <div style="margin-top:16px;">
          <table class="data-table" style="width:100%;border-collapse:collapse;">
            <thead>
              <tr style="text-align:left;color:#bbb;">
                <th style="padding:8px;border-bottom:1px solid #2A2A33;">Rang</th>
                <th style="padding:8px;border-bottom:1px solid #2A2A33;">Post-Typ</th>
                <th style="padding:8px;border-bottom:1px solid #2A2A33;">Score</th>
              </tr>
            </thead>
            <tbody>
              ${data.map((d, i) => `
                <tr>
                  <td style="padding:8px;border-bottom:1px solid #2A2A33;color:#8B5CF6;font-weight:600;">#${i + 1}</td>
                  <td style="padding:8px;border-bottom:1px solid #2A2A33;color:#fff;">${escapeHtml(d.label)}</td>
                  <td style="padding:8px;border-bottom:1px solid #2A2A33;color:#fff;">${escapeHtml(d.value.toFixed(3))}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `
    }

    const refresh = async () => {
      body.innerHTML = '<div class="loading">Lädt…</div>'
      try {
        const { data, error } = await sb
          .from('insta_post_type_scores')
          .select('*')
          .order('score', { ascending: false })
        if (error) throw error
        renderBarChart(data || [])
      } catch (e) {
        body.innerHTML = '<div class="empty">Daten kommen bald: ' + escapeHtml(e?.message || 'unbekannt') + '</div>'
      }
    }

    container.querySelector('.refresh-btn').addEventListener('click', refresh)
    await refresh()
  }
}
