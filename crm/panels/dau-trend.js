import { sb } from '/lib/supabase.js'

export default {
  id: 'dau-trend',
  title: 'Tägliche aktive Nutzer (30 Tage)',
  category: 'overview',
  summary: 'App-Opens / DAU als Zeitreihe der letzten 30 Tage.',
  async mount(container) {
    container.innerHTML = `<div class="panel-shell">
      <div class="panel-head"><h2>Tägliche aktive Nutzer (30 Tage)</h2><button class="refresh-btn">Aktualisieren</button></div>
      <div class="panel-body"><div class="loading">Lädt…</div></div>
    </div>`
    const body = container.querySelector('.panel-body')

    const fmtDate = (d) => {
      const dt = (d instanceof Date) ? d : new Date(d)
      const dd = String(dt.getDate()).padStart(2, '0')
      const mm = String(dt.getMonth() + 1).padStart(2, '0')
      return `${dd}.${mm}`
    }

    const fetchSeries = async () => {
      // 1) Try RPC admin_app_opens_stats
      try {
        const { data, error } = await sb.rpc('admin_app_opens_stats', { days: 30 })
        if (!error && Array.isArray(data) && data.length) {
          return data
            .map((r) => ({
              day: r.day || r.date || r.bucket || r.d,
              count: Number(r.count ?? r.dau ?? r.opens ?? r.value ?? 0),
            }))
            .filter((r) => r.day)
            .sort((a, b) => new Date(a.day) - new Date(b.day))
        }
      } catch (_) { /* fallthrough */ }

      // 2) Fallback: aggregate from daily_activity client-side
      const since = new Date()
      since.setUTCHours(0, 0, 0, 0)
      since.setUTCDate(since.getUTCDate() - 29)
      const sinceIso = since.toISOString().slice(0, 10)
      const { data, error } = await sb
        .from('daily_activity')
        .select('user_id, day')
        .gte('day', sinceIso)
      if (error) throw error
      const counts = new Map()
      for (let i = 0; i < 30; i++) {
        const d = new Date(since)
        d.setUTCDate(since.getUTCDate() + i)
        counts.set(d.toISOString().slice(0, 10), 0)
      }
      for (const row of (data || [])) {
        const key = String(row.day).slice(0, 10)
        if (counts.has(key)) counts.set(key, counts.get(key) + 1)
      }
      return Array.from(counts.entries()).map(([day, count]) => ({ day, count }))
    }

    const render = (series) => {
      if (!series.length) {
        body.innerHTML = '<div class="empty">Keine DAU-Daten verfügbar.</div>'
        return
      }
      const W = 760, H = 280, padL = 40, padR = 16, padT = 20, padB = 32
      const innerW = W - padL - padR
      const innerH = H - padT - padB
      const values = series.map((s) => s.count)
      const maxV = Math.max(1, ...values)
      const minV = 0
      const n = series.length
      const xFor = (i) => padL + (n === 1 ? innerW / 2 : (innerW * i) / (n - 1))
      const yFor = (v) => padT + innerH - ((v - minV) / (maxV - minV)) * innerH

      const points = series.map((s, i) => `${xFor(i).toFixed(1)},${yFor(s.count).toFixed(1)}`).join(' ')
      const areaPath = `M ${xFor(0).toFixed(1)},${(padT + innerH).toFixed(1)} L ${points.split(' ').join(' L ')} L ${xFor(n - 1).toFixed(1)},${(padT + innerH).toFixed(1)} Z`

      const gridLines = []
      for (let g = 0; g <= 4; g++) {
        const y = padT + (innerH * g) / 4
        const val = Math.round(maxV - (maxV * g) / 4)
        gridLines.push(`<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="#2A2A33" stroke-width="1"/>`)
        gridLines.push(`<text x="${padL - 6}" y="${y + 4}" text-anchor="end" font-size="10" fill="#8a8a98">${val}</text>`)
      }

      const xLabels = []
      const labelEvery = Math.max(1, Math.floor(n / 6))
      series.forEach((s, i) => {
        if (i % labelEvery === 0 || i === n - 1) {
          xLabels.push(`<text x="${xFor(i)}" y="${H - 10}" text-anchor="middle" font-size="10" fill="#8a8a98">${fmtDate(s.day)}</text>`)
        }
      })

      const dots = series.map((s, i) => `<circle cx="${xFor(i).toFixed(1)}" cy="${yFor(s.count).toFixed(1)}" r="3" fill="#8B5CF6"><title>${fmtDate(s.day)}: ${s.count}</title></circle>`).join('')

      const total = values.reduce((a, b) => a + b, 0)
      const avg = Math.round(total / n)
      const peak = Math.max(...values)
      const peakIdx = values.indexOf(peak)
      const last7 = values.slice(-7)
      const prev7 = values.slice(-14, -7)
      const avg7 = last7.length ? Math.round(last7.reduce((a, b) => a + b, 0) / last7.length) : 0
      const avgPrev7 = prev7.length ? Math.round(prev7.reduce((a, b) => a + b, 0) / prev7.length) : 0
      const wow = avgPrev7 > 0 ? Math.round(((avg7 - avgPrev7) / avgPrev7) * 100) : 0
      const wowStr = (wow >= 0 ? '+' : '') + wow + '%'

      body.innerHTML = `
        <div class="kpi-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:16px;">
          <div class="kpi-tile" style="background:#16161D;border:1px solid #2A2A33;border-radius:12px;padding:12px;">
            <div style="color:#8a8a98;font-size:11px;text-transform:uppercase;">Ø DAU (30T)</div>
            <div style="color:#fff;font-size:22px;font-weight:600;margin-top:4px;">${avg}</div>
            <div style="color:#8a8a98;font-size:11px;margin-top:2px;">Aktive Nutzer/Tag</div>
          </div>
          <div class="kpi-tile" style="background:#16161D;border:1px solid #2A2A33;border-radius:12px;padding:12px;">
            <div style="color:#8a8a98;font-size:11px;text-transform:uppercase;">Peak</div>
            <div style="color:#fff;font-size:22px;font-weight:600;margin-top:4px;">${peak}</div>
            <div style="color:#8a8a98;font-size:11px;margin-top:2px;">${fmtDate(series[peakIdx].day)}</div>
          </div>
          <div class="kpi-tile" style="background:#16161D;border:1px solid #2A2A33;border-radius:12px;padding:12px;">
            <div style="color:#8a8a98;font-size:11px;text-transform:uppercase;">Ø DAU (7T)</div>
            <div style="color:#fff;font-size:22px;font-weight:600;margin-top:4px;">${avg7}</div>
            <div style="color:${wow >= 0 ? '#8B5CF6' : '#ef4444'};font-size:11px;margin-top:2px;">${wowStr} vs. Vorwoche</div>
          </div>
          <div class="kpi-tile" style="background:#16161D;border:1px solid #2A2A33;border-radius:12px;padding:12px;">
            <div style="color:#8a8a98;font-size:11px;text-transform:uppercase;">Heute</div>
            <div style="color:#fff;font-size:22px;font-weight:600;margin-top:4px;">${values[values.length - 1]}</div>
            <div style="color:#8a8a98;font-size:11px;margin-top:2px;">${fmtDate(series[series.length - 1].day)}</div>
          </div>
        </div>
        <div style="background:#16161D;border:1px solid #2A2A33;border-radius:12px;padding:12px;">
          <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="xMidYMid meet" style="display:block;">
            <defs>
              <linearGradient id="dauGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#8B5CF6" stop-opacity="0.4"/>
                <stop offset="100%" stop-color="#8B5CF6" stop-opacity="0"/>
              </linearGradient>
            </defs>
            ${gridLines.join('')}
            <path d="${areaPath}" fill="url(#dauGrad)" stroke="none"/>
            <polyline fill="none" stroke="#8B5CF6" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="${points}"/>
            ${dots}
            ${xLabels.join('')}
          </svg>
        </div>
      `
    }

    const refresh = async () => {
      body.innerHTML = '<div class="loading">Lädt…</div>'
      try {
        const series = await fetchSeries()
        render(series)
      } catch (e) {
        body.innerHTML = '<div class="empty">Daten kommen bald: ' + (e?.message || 'unbekannt') + '</div>'
      }
    }
    container.querySelector('.refresh-btn').addEventListener('click', refresh)
    await refresh()
  }
}
