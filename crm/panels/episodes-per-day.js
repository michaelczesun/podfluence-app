import { sb } from '/lib/supabase.js'

export default {
  id: 'episodes-per-day',
  title: 'Neue Episoden pro Tag',
  category: 'content',
  summary: "Tägliche Anzahl neuer Podcast-Episoden.",
  async mount(container) {
    container.innerHTML = `<div class="panel-shell">
      <div class="panel-head"><h2>Neue Episoden pro Tag</h2><button class="refresh-btn">Aktualisieren</button></div>
      <div class="panel-body"><div class="loading">Lädt…</div></div>
    </div>`
    const body = container.querySelector('.panel-body')

    const renderBars = (rows) => {
      if (!rows || rows.length === 0) {
        body.innerHTML = '<div class="empty">Noch keine Episoden-Daten.</div>'
        return
      }
      const W = 720, H = 260, PAD_L = 40, PAD_B = 36, PAD_T = 16, PAD_R = 16
      const innerW = W - PAD_L - PAD_R
      const innerH = H - PAD_T - PAD_B
      const max = Math.max(1, ...rows.map(r => Number(r.count) || 0))
      const n = rows.length
      const gap = 4
      const barW = Math.max(2, (innerW - gap * (n - 1)) / n)
      const fmtDay = (d) => {
        try {
          const dt = new Date(d)
          return String(dt.getDate()).padStart(2, '0') + '.' + String(dt.getMonth() + 1).padStart(2, '0')
        } catch { return String(d) }
      }
      const total = rows.reduce((a, r) => a + (Number(r.count) || 0), 0)
      const avg = total / rows.length
      const peak = rows.reduce((acc, r) => (Number(r.count) > Number(acc.count) ? r : acc), rows[0])

      const bars = rows.map((r, i) => {
        const v = Number(r.count) || 0
        const h = (v / max) * innerH
        const x = PAD_L + i * (barW + gap)
        const y = PAD_T + (innerH - h)
        return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barW.toFixed(2)}" height="${h.toFixed(2)}" rx="3" fill="#8B5CF6"><title>${fmtDay(r.day)}: ${v}</title></rect>`
      }).join('')

      const ticks = 4
      const gridLines = Array.from({ length: ticks + 1 }, (_, i) => {
        const y = PAD_T + (innerH / ticks) * i
        const val = Math.round(max - (max / ticks) * i)
        return `<line x1="${PAD_L}" y1="${y}" x2="${W - PAD_R}" y2="${y}" stroke="#2A2A33" stroke-width="1"/>
                <text x="${PAD_L - 6}" y="${y + 4}" text-anchor="end" font-size="10" fill="#9CA3AF">${val}</text>`
      }).join('')

      const labelStep = Math.max(1, Math.ceil(n / 10))
      const xLabels = rows.map((r, i) => {
        if (i % labelStep !== 0 && i !== n - 1) return ''
        const x = PAD_L + i * (barW + gap) + barW / 2
        return `<text x="${x.toFixed(2)}" y="${H - PAD_B + 16}" text-anchor="middle" font-size="10" fill="#9CA3AF">${fmtDay(r.day)}</text>`
      }).join('')

      body.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi-tile"><div class="kpi-label">Gesamt (Zeitraum)</div><div class="kpi-value">${total}</div><div class="kpi-hint">${rows.length} Tage</div></div>
          <div class="kpi-tile"><div class="kpi-label">Ø pro Tag</div><div class="kpi-value">${avg.toFixed(1)}</div><div class="kpi-hint">Durchschnitt</div></div>
          <div class="kpi-tile"><div class="kpi-label">Spitzentag</div><div class="kpi-value">${Number(peak.count) || 0}</div><div class="kpi-hint">${fmtDay(peak.day)}</div></div>
        </div>
        <div style="margin-top:16px;background:#16161D;border:1px solid #2A2A33;border-radius:12px;padding:12px;">
          <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="xMidYMid meet">
            ${gridLines}
            ${bars}
            ${xLabels}
          </svg>
        </div>`
    }

    const refresh = async () => {
      body.innerHTML = '<div class="loading">Lädt…</div>'
      try {
        const { data, error } = await sb.rpc('admin_episodes_per_day')
        if (error) throw error
        const rows = (Array.isArray(data) ? data : []).map(r => ({
          day: r.day ?? r.date ?? r.bucket ?? r.d,
          count: r.count ?? r.episodes ?? r.n ?? r.total ?? 0
        })).filter(r => r.day != null)
        rows.sort((a, b) => new Date(a.day) - new Date(b.day))
        renderBars(rows)
      } catch (e) {
        body.innerHTML = '<div class="empty">Daten kommen bald: ' + (e?.message || 'unbekannt') + '</div>'
      }
    }
    container.querySelector('.refresh-btn').addEventListener('click', refresh)
    await refresh()
  }
}
