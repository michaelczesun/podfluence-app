import { sb } from '/lib/supabase.js'

export default {
  id: 'new-signups-7d',
  title: 'Neue Anmeldungen (7 Tage)',
  category: 'overview',
  summary: 'Tägliche Signups der letzten Woche.',
  async mount(container) {
    container.innerHTML = `<div class="panel-shell">
      <div class="panel-head"><h2>Neue Anmeldungen (7 Tage)</h2><button class="refresh-btn">Aktualisieren</button></div>
      <div class="panel-body"><div class="loading">Lädt…</div></div>
    </div>`
    const body = container.querySelector('.panel-body')

    const fmtDay = (d) => {
      const dd = new Date(d)
      return dd.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })
    }

    const refresh = async () => {
      body.innerHTML = '<div class="loading">Lädt…</div>'
      try {
        const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
        const sinceIso = since.toISOString()

        const { data, error } = await sb
          .from('users')
          .select('created_at')
          .gte('created_at', sinceIso)
          .order('created_at', { ascending: true })

        if (error) throw error

        // Bucket pro Tag (letzte 7 Tage inkl. heute)
        const buckets = []
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        for (let i = 6; i >= 0; i--) {
          const d = new Date(today)
          d.setDate(d.getDate() - i)
          buckets.push({ day: d, count: 0 })
        }
        const keyOf = (d) => {
          const x = new Date(d)
          x.setHours(0, 0, 0, 0)
          return x.getTime()
        }
        const map = new Map(buckets.map((b) => [keyOf(b.day), b]))
        for (const row of data || []) {
          const k = keyOf(row.created_at)
          const b = map.get(k)
          if (b) b.count++
        }

        const total = buckets.reduce((a, b) => a + b.count, 0)
        const max = Math.max(1, ...buckets.map((b) => b.count))
        const avg = Math.round((total / 7) * 10) / 10
        const peak = buckets.reduce((a, b) => (b.count > a.count ? b : a), buckets[0])

        // Inline SVG bar chart
        const W = 560
        const H = 220
        const padL = 36
        const padR = 12
        const padT = 16
        const padB = 36
        const innerW = W - padL - padR
        const innerH = H - padT - padB
        const bw = innerW / buckets.length
        const barW = Math.max(8, bw * 0.6)

        let bars = ''
        let labels = ''
        buckets.forEach((b, i) => {
          const h = (b.count / max) * innerH
          const x = padL + i * bw + (bw - barW) / 2
          const y = padT + innerH - h
          bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="6" ry="6" fill="#8B5CF6"></rect>`
          bars += `<text x="${(x + barW / 2).toFixed(1)}" y="${(y - 6).toFixed(1)}" text-anchor="middle" font-size="11" fill="#fff">${b.count}</text>`
          labels += `<text x="${(padL + i * bw + bw / 2).toFixed(1)}" y="${(H - 12).toFixed(1)}" text-anchor="middle" font-size="11" fill="#9b9bab">${fmtDay(b.day)}</text>`
        })

        const baseline = `<line x1="${padL}" y1="${padT + innerH}" x2="${W - padR}" y2="${padT + innerH}" stroke="#2A2A33" stroke-width="1"></line>`

        body.innerHTML = `
          <div class="kpi-grid">
            <div class="kpi-tile"><div class="label">Gesamt (7T)</div><div class="value">${total}</div><div class="hint">Neue User</div></div>
            <div class="kpi-tile"><div class="label">Ø pro Tag</div><div class="value">${avg}</div><div class="hint">Schnitt 7 Tage</div></div>
            <div class="kpi-tile"><div class="label">Peak-Tag</div><div class="value">${peak.count}</div><div class="hint">${fmtDay(peak.day)}</div></div>
          </div>
          <div style="margin-top:16px; background:#16161D; border:1px solid #2A2A33; border-radius:12px; padding:12px;">
            <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="xMidYMid meet">
              ${baseline}
              ${bars}
              ${labels}
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
