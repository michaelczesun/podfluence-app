import { sb } from '/lib/supabase.js'

export default {
  id: 'posts-per-day',
  title: 'Posts pro Tag',
  category: 'content',
  summary: "Volumen neuer Updates über die Zeit.",
  async mount(container) {
    container.innerHTML = `<div class="panel-shell">
      <div class="panel-head"><h2>Posts pro Tag</h2><button class="refresh-btn">Aktualisieren</button></div>
      <div class="panel-body"><div class="loading">Lädt…</div></div>
    </div>`
    const body = container.querySelector('.panel-body')

    const refresh = async () => {
      body.innerHTML = '<div class="loading">Lädt…</div>'
      try {
        const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
        const { data, error } = await sb
          .from('updates')
          .select('created_at')
          .gte('created_at', since)
          .order('created_at', { ascending: true })
        if (error) throw error

        // Bucket per day
        const buckets = new Map()
        for (let i = 29; i >= 0; i--) {
          const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000)
          const key = d.toISOString().slice(0, 10)
          buckets.set(key, 0)
        }
        for (const row of data || []) {
          const key = (row.created_at || '').slice(0, 10)
          if (buckets.has(key)) buckets.set(key, buckets.get(key) + 1)
        }

        const points = Array.from(buckets.entries()).map(([day, count]) => ({ day, count }))
        const total = points.reduce((s, p) => s + p.count, 0)
        const avg = points.length ? (total / points.length) : 0
        const peak = points.reduce((m, p) => p.count > m.count ? p : m, { day: '-', count: 0 })
        const last7 = points.slice(-7).reduce((s, p) => s + p.count, 0)

        // SVG line chart
        const W = 720, H = 240, padL = 40, padR = 16, padT = 16, padB = 28
        const innerW = W - padL - padR
        const innerH = H - padT - padB
        const maxY = Math.max(1, ...points.map(p => p.count))
        const step = points.length > 1 ? innerW / (points.length - 1) : 0
        const xy = points.map((p, i) => {
          const x = padL + i * step
          const y = padT + innerH - (p.count / maxY) * innerH
          return { x, y, ...p }
        })
        const path = xy.map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(' ')
        const areaPath = `${path} L${xy[xy.length - 1].x.toFixed(1)},${(padT + innerH).toFixed(1)} L${xy[0].x.toFixed(1)},${(padT + innerH).toFixed(1)} Z`

        const yTicks = 4
        const yAxis = []
        for (let i = 0; i <= yTicks; i++) {
          const val = Math.round((maxY / yTicks) * i)
          const y = padT + innerH - (i / yTicks) * innerH
          yAxis.push(`<line x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}" stroke="#2A2A33" stroke-width="1"/>
            <text x="${padL - 6}" y="${y + 4}" fill="#8a8a96" font-size="10" text-anchor="end">${val}</text>`)
        }

        const xLabelEvery = Math.ceil(points.length / 6)
        const xAxis = xy.map((pt, i) => {
          if (i % xLabelEvery !== 0 && i !== xy.length - 1) return ''
          const lbl = pt.day.slice(5)
          return `<text x="${pt.x}" y="${H - padB + 16}" fill="#8a8a96" font-size="10" text-anchor="middle">${lbl}</text>`
        }).join('')

        const dots = xy.map(pt =>
          `<circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="3" fill="#8B5CF6"><title>${pt.day}: ${pt.count}</title></circle>`
        ).join('')

        body.innerHTML = `
          <div class="kpi-grid">
            <div class="kpi-tile"><div style="color:#8a8a96;font-size:12px">Posts (30d)</div><div style="font-size:22px;font-weight:600;color:#fff">${total}</div><div style="color:#8a8a96;font-size:11px">Gesamt</div></div>
            <div class="kpi-tile"><div style="color:#8a8a96;font-size:12px">Ø pro Tag</div><div style="font-size:22px;font-weight:600;color:#fff">${avg.toFixed(1)}</div><div style="color:#8a8a96;font-size:11px">Durchschnitt</div></div>
            <div class="kpi-tile"><div style="color:#8a8a96;font-size:12px">Peak</div><div style="font-size:22px;font-weight:600;color:#fff">${peak.count}</div><div style="color:#8a8a96;font-size:11px">${peak.day}</div></div>
            <div class="kpi-tile"><div style="color:#8a8a96;font-size:12px">Letzte 7d</div><div style="font-size:22px;font-weight:600;color:#fff">${last7}</div><div style="color:#8a8a96;font-size:11px">Posts</div></div>
          </div>
          <div style="margin-top:16px;background:#16161D;border:1px solid #2A2A33;border-radius:12px;padding:12px">
            <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="none" style="display:block">
              <defs>
                <linearGradient id="ppd-area" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stop-color="#8B5CF6" stop-opacity="0.35"/>
                  <stop offset="100%" stop-color="#8B5CF6" stop-opacity="0"/>
                </linearGradient>
              </defs>
              ${yAxis.join('')}
              <path d="${areaPath}" fill="url(#ppd-area)" stroke="none"/>
              <path d="${path}" fill="none" stroke="#8B5CF6" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
              ${dots}
              ${xAxis}
            </svg>
          </div>
        `
      } catch (e) {
        body.innerHTML = '<div class="empty">Daten kommen bald: ' + (e?.message || 'unbekannt') + '</div>'
      }
    }

    container.querySelector('.refresh-btn').addEventListener('click', refresh)
    await refresh()
  }
}
