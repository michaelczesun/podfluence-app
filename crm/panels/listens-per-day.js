import { sb } from '/lib/supabase.js'

export default {
  id: 'listens-per-day',
  title: 'Listens pro Tag',
  category: 'listening',
  summary: 'Anzahl markierter Episoden pro Tag.',
  async mount(container) {
    container.innerHTML = `<div class="panel-shell">
      <div class="panel-head"><h2>Listens pro Tag</h2><button class="refresh-btn">Aktualisieren</button></div>
      <div class="panel-body"><div class="loading">Lädt…</div></div>
    </div>`
    const body = container.querySelector('.panel-body')

    const refresh = async () => {
      body.innerHTML = '<div class="loading">Lädt…</div>'
      try {
        const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
        const { data, error } = await sb
          .from('listening_activity')
          .select('created_at')
          .gte('created_at', since)
          .order('created_at', { ascending: true })
        if (error) throw error

        const buckets = new Map()
        for (let i = 29; i >= 0; i--) {
          const d = new Date()
          d.setUTCHours(0, 0, 0, 0)
          d.setUTCDate(d.getUTCDate() - i)
          buckets.set(d.toISOString().slice(0, 10), 0)
        }
        for (const row of data || []) {
          const key = (row.created_at || '').slice(0, 10)
          if (buckets.has(key)) buckets.set(key, buckets.get(key) + 1)
        }

        const entries = [...buckets.entries()]
        const values = entries.map(([, v]) => v)
        const total = values.reduce((a, b) => a + b, 0)
        const max = Math.max(1, ...values)
        const avg = Math.round((total / Math.max(1, values.length)) * 10) / 10
        const peak = entries.reduce((acc, cur) => (cur[1] > acc[1] ? cur : acc), entries[0] || ['-', 0])

        const W = 720, H = 240, PAD_L = 36, PAD_R = 12, PAD_T = 16, PAD_B = 28
        const innerW = W - PAD_L - PAD_R
        const innerH = H - PAD_T - PAD_B
        const step = entries.length > 1 ? innerW / (entries.length - 1) : 0
        const points = entries.map(([, v], i) => {
          const x = PAD_L + i * step
          const y = PAD_T + innerH - (v / max) * innerH
          return [x, y]
        })
        const path = points.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')
        const area = path + ` L${(PAD_L + innerW).toFixed(1)},${(PAD_T + innerH).toFixed(1)} L${PAD_L.toFixed(1)},${(PAD_T + innerH).toFixed(1)} Z`

        const grid = [0, 0.25, 0.5, 0.75, 1].map(t => {
          const y = PAD_T + innerH * (1 - t)
          const label = Math.round(max * t)
          return `<line x1="${PAD_L}" y1="${y}" x2="${PAD_L + innerW}" y2="${y}" stroke="#2A2A33" stroke-width="1"/>
                  <text x="${PAD_L - 6}" y="${y + 4}" text-anchor="end" font-size="10" fill="#7a7a85">${label}</text>`
        }).join('')

        const xTicks = entries.map(([d], i) => {
          if (i % 5 !== 0 && i !== entries.length - 1) return ''
          const x = PAD_L + i * step
          const label = d.slice(5)
          return `<text x="${x}" y="${H - 8}" text-anchor="middle" font-size="10" fill="#7a7a85">${label}</text>`
        }).join('')

        const dots = points.map((p, i) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3" fill="#8B5CF6"><title>${entries[i][0]}: ${entries[i][1]}</title></circle>`).join('')

        body.innerHTML = `
          <div class="kpi-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:14px;">
            <div class="kpi-tile" style="background:#16161D;border:1px solid #2A2A33;border-radius:12px;padding:12px;">
              <div style="font-size:11px;color:#7a7a85;text-transform:uppercase;letter-spacing:.5px;">Gesamt (30T)</div>
              <div style="font-size:22px;color:#fff;font-weight:600;margin-top:4px;">${total}</div>
              <div style="font-size:11px;color:#7a7a85;margin-top:2px;">markierte Episoden</div>
            </div>
            <div class="kpi-tile" style="background:#16161D;border:1px solid #2A2A33;border-radius:12px;padding:12px;">
              <div style="font-size:11px;color:#7a7a85;text-transform:uppercase;letter-spacing:.5px;">Ø pro Tag</div>
              <div style="font-size:22px;color:#fff;font-weight:600;margin-top:4px;">${avg}</div>
              <div style="font-size:11px;color:#7a7a85;margin-top:2px;">30-Tage-Schnitt</div>
            </div>
            <div class="kpi-tile" style="background:#16161D;border:1px solid #2A2A33;border-radius:12px;padding:12px;">
              <div style="font-size:11px;color:#7a7a85;text-transform:uppercase;letter-spacing:.5px;">Peak-Tag</div>
              <div style="font-size:22px;color:#fff;font-weight:600;margin-top:4px;">${peak[1]}</div>
              <div style="font-size:11px;color:#7a7a85;margin-top:2px;">${peak[0]}</div>
            </div>
          </div>
          <div style="background:#16161D;border:1px solid #2A2A33;border-radius:12px;padding:12px;">
            <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;">
              <defs>
                <linearGradient id="lpdGrad" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stop-color="#8B5CF6" stop-opacity="0.35"/>
                  <stop offset="100%" stop-color="#8B5CF6" stop-opacity="0"/>
                </linearGradient>
              </defs>
              ${grid}
              <path d="${area}" fill="url(#lpdGrad)"/>
              <path d="${path}" fill="none" stroke="#8B5CF6" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
              ${dots}
              ${xTicks}
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
