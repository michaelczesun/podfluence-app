import { sb } from '/lib/supabase.js'

export default {
  id: 'crash-rate',
  title: 'Stabilität / Crash-Rate',
  category: 'overview',
  summary: 'Crashes pro Tag und betroffene App-Versionen.',
  async mount(container) {
    container.innerHTML = `<div class="panel-shell">
      <div class="panel-head"><h2>Stabilität / Crash-Rate</h2><button class="refresh-btn">Aktualisieren</button></div>
      <div class="panel-body"><div class="loading">Lädt…</div></div>
    </div>`
    const body = container.querySelector('.panel-body')

    const refresh = async () => {
      body.innerHTML = '<div class="loading">Lädt…</div>'
      try {
        const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()
        const { data, error } = await sb
          .from('crash_logs')
          .select('created_at, app_version')
          .gte('created_at', since)
          .order('created_at', { ascending: true })
        if (error) throw error

        const rows = data || []
        if (rows.length === 0) {
          body.innerHTML = '<div class="empty">Keine Crashes in den letzten 14 Tagen. 🎉</div>'
          return
        }

        // Aggregation: pro Tag, pro Version
        const dayMap = new Map() // dayKey -> Map(version -> count)
        const versionTotals = new Map()
        const allDays = []

        // 14 Tage initialisieren
        for (let i = 13; i >= 0; i--) {
          const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000)
          const key = d.toISOString().slice(0, 10)
          dayMap.set(key, new Map())
          allDays.push(key)
        }

        for (const r of rows) {
          const key = (r.created_at || '').slice(0, 10)
          const ver = r.app_version || 'unbekannt'
          if (!dayMap.has(key)) {
            dayMap.set(key, new Map())
            allDays.push(key)
          }
          const vm = dayMap.get(key)
          vm.set(ver, (vm.get(ver) || 0) + 1)
          versionTotals.set(ver, (versionTotals.get(ver) || 0) + 1)
        }

        // Top 4 Versionen
        const topVersions = [...versionTotals.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 4)
          .map(([v]) => v)

        const colors = ['#8B5CF6', '#22D3EE', '#F59E0B', '#EF4444']

        // KPIs
        const total = rows.length
        const today = allDays[allDays.length - 1]
        const todayCount = [...(dayMap.get(today)?.values() || [])].reduce((a, b) => a + b, 0)
        const avgPerDay = (total / 14).toFixed(1)
        const versionsCount = versionTotals.size

        // Line-Chart Daten pro Version
        const W = 720, H = 240, PAD_L = 36, PAD_R = 12, PAD_T = 16, PAD_B = 28
        const innerW = W - PAD_L - PAD_R
        const innerH = H - PAD_T - PAD_B

        let maxY = 0
        for (const day of allDays) {
          const vm = dayMap.get(day) || new Map()
          for (const v of topVersions) {
            maxY = Math.max(maxY, vm.get(v) || 0)
          }
          // auch Gesamtmax über alle
          const sum = [...vm.values()].reduce((a, b) => a + b, 0)
          maxY = Math.max(maxY, sum)
        }
        if (maxY < 1) maxY = 1

        const xFor = (i) => PAD_L + (allDays.length === 1 ? innerW / 2 : (i * innerW) / (allDays.length - 1))
        const yFor = (val) => PAD_T + innerH - (val / maxY) * innerH

        // X-Labels (jeder 2. Tag)
        let xLabels = ''
        allDays.forEach((d, i) => {
          if (i % 2 === 0 || i === allDays.length - 1) {
            const lbl = d.slice(5)
            xLabels += `<text x="${xFor(i)}" y="${H - 8}" fill="#9CA3AF" font-size="10" text-anchor="middle">${lbl}</text>`
          }
        })

        // Y-Gridlines
        let grid = ''
        const yTicks = 4
        for (let t = 0; t <= yTicks; t++) {
          const yv = Math.round((maxY * t) / yTicks)
          const y = yFor(yv)
          grid += `<line x1="${PAD_L}" y1="${y}" x2="${W - PAD_R}" y2="${y}" stroke="#2A2A33" stroke-width="1"/>`
          grid += `<text x="${PAD_L - 6}" y="${y + 3}" fill="#9CA3AF" font-size="10" text-anchor="end">${yv}</text>`
        }

        // Lines + Points pro Top-Version
        let series = ''
        topVersions.forEach((ver, idx) => {
          const color = colors[idx % colors.length]
          const pts = allDays.map((d, i) => {
            const vm = dayMap.get(d) || new Map()
            const val = vm.get(ver) || 0
            return [xFor(i), yFor(val), val]
          })
          const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
          series += `<path d="${path}" fill="none" stroke="${color}" stroke-width="2"/>`
          pts.forEach(([x, y, v]) => {
            series += `<circle cx="${x}" cy="${y}" r="3" fill="${color}"><title>${ver}: ${v}</title></circle>`
          })
        })

        const legend = topVersions
          .map((v, i) => `<span class="chip" style="display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border:1px solid #2A2A33;border-radius:999px;margin-right:6px;font-size:12px;color:#fff;background:#1C1C24"><span style="width:10px;height:10px;border-radius:50%;background:${colors[i % colors.length]};display:inline-block"></span>${v} (${versionTotals.get(v)})</span>`)
          .join('')

        body.innerHTML = `
          <div class="kpi-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:16px">
            <div class="kpi-tile" style="background:#1C1C24;border:1px solid #2A2A33;border-radius:12px;padding:14px">
              <div style="color:#9CA3AF;font-size:12px">Crashes gesamt (14T)</div>
              <div style="color:#fff;font-size:24px;font-weight:600;margin-top:4px">${total}</div>
              <div style="color:#9CA3AF;font-size:11px;margin-top:2px">Letzte 14 Tage</div>
            </div>
            <div class="kpi-tile" style="background:#1C1C24;border:1px solid #2A2A33;border-radius:12px;padding:14px">
              <div style="color:#9CA3AF;font-size:12px">Heute</div>
              <div style="color:#fff;font-size:24px;font-weight:600;margin-top:4px">${todayCount}</div>
              <div style="color:#9CA3AF;font-size:11px;margin-top:2px">Crashes heute</div>
            </div>
            <div class="kpi-tile" style="background:#1C1C24;border:1px solid #2A2A33;border-radius:12px;padding:14px">
              <div style="color:#9CA3AF;font-size:12px">Ø pro Tag</div>
              <div style="color:#fff;font-size:24px;font-weight:600;margin-top:4px">${avgPerDay}</div>
              <div style="color:#9CA3AF;font-size:11px;margin-top:2px">Schnitt 14T</div>
            </div>
            <div class="kpi-tile" style="background:#1C1C24;border:1px solid #2A2A33;border-radius:12px;padding:14px">
              <div style="color:#9CA3AF;font-size:12px">Betroffene Versionen</div>
              <div style="color:#fff;font-size:24px;font-weight:600;margin-top:4px">${versionsCount}</div>
              <div style="color:#9CA3AF;font-size:11px;margin-top:2px">App-Builds</div>
            </div>
          </div>

          <div style="background:#16161D;border:1px solid #2A2A33;border-radius:12px;padding:14px;margin-bottom:16px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
              <div style="color:#fff;font-weight:600">Crashes pro Tag (Top-Versionen)</div>
              <div class="chips">${legend}</div>
            </div>
            <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block">
              ${grid}
              ${series}
              ${xLabels}
            </svg>
          </div>

          <div style="background:#16161D;border:1px solid #2A2A33;border-radius:12px;padding:14px">
            <div style="color:#fff;font-weight:600;margin-bottom:10px">Crashes nach App-Version</div>
            <table class="data-table" style="width:100%;border-collapse:collapse;color:#fff;font-size:13px">
              <thead>
                <tr style="color:#9CA3AF;text-align:left">
                  <th style="padding:8px;border-bottom:1px solid #2A2A33">App-Version</th>
                  <th style="padding:8px;border-bottom:1px solid #2A2A33;text-align:right">Crashes</th>
                  <th style="padding:8px;border-bottom:1px solid #2A2A33;text-align:right">Anteil</th>
                </tr>
              </thead>
              <tbody>
                ${[...versionTotals.entries()]
                  .sort((a, b) => b[1] - a[1])
                  .map(([ver, cnt]) => {
                    const pct = total > 0 ? ((cnt / total) * 100).toFixed(1) : '0.0'
                    return `<tr>
                      <td style="padding:8px;border-bottom:1px solid #2A2A33">${ver}</td>
                      <td style="padding:8px;border-bottom:1px solid #2A2A33;text-align:right">${cnt}</td>
                      <td style="padding:8px;border-bottom:1px solid #2A2A33;text-align:right;color:#8B5CF6">${pct}%</td>
                    </tr>`
                  })
                  .join('')}
              </tbody>
            </table>
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
