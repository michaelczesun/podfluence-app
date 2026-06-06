import { sb } from '/lib/supabase.js'

export default {
  id: 'user-type-split',
  title: 'Listener vs. Podcaster',
  category: 'users',
  summary: 'Verteilung der User-Typen.',
  async mount(container) {
    container.innerHTML = `<div class="panel-shell">
      <div class="panel-head"><h2>Listener vs. Podcaster</h2><button class="refresh-btn">Aktualisieren</button></div>
      <div class="panel-body"><div class="loading">Lädt…</div></div>
    </div>`
    const body = container.querySelector('.panel-body')

    const COLORS = ['#8B5CF6', '#22D3EE', '#F472B6', '#34D399', '#FBBF24', '#F87171']

    const renderPie = (rows) => {
      const total = rows.reduce((s, r) => s + r.value, 0)
      if (!total) {
        body.innerHTML = '<div class="empty">Keine Daten.</div>'
        return
      }
      const size = 220
      const cx = size / 2
      const cy = size / 2
      const r = 90
      const rInner = 55
      let acc = 0
      const slices = rows.map((row, i) => {
        const frac = row.value / total
        const start = acc * 2 * Math.PI - Math.PI / 2
        acc += frac
        const end = acc * 2 * Math.PI - Math.PI / 2
        const large = frac > 0.5 ? 1 : 0
        const x1 = cx + r * Math.cos(start)
        const y1 = cy + r * Math.sin(start)
        const x2 = cx + r * Math.cos(end)
        const y2 = cy + r * Math.sin(end)
        const xi1 = cx + rInner * Math.cos(end)
        const yi1 = cy + rInner * Math.sin(end)
        const xi2 = cx + rInner * Math.cos(start)
        const yi2 = cy + rInner * Math.sin(start)
        const color = COLORS[i % COLORS.length]
        const d = [
          `M ${x1} ${y1}`,
          `A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`,
          `L ${xi1} ${yi1}`,
          `A ${rInner} ${rInner} 0 ${large} 0 ${xi2} ${yi2}`,
          'Z'
        ].join(' ')
        return `<path d="${d}" fill="${color}" stroke="#16161D" stroke-width="2"/>`
      }).join('')

      const legend = rows.map((row, i) => {
        const pct = ((row.value / total) * 100).toFixed(1)
        const color = COLORS[i % COLORS.length]
        return `<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;border:1px solid #2A2A33;border-radius:12px;background:#1E1E26;margin-bottom:8px;">
          <span style="width:14px;height:14px;border-radius:4px;background:${color};display:inline-block;"></span>
          <span style="color:#fff;font-weight:600;flex:1;">${row.label}</span>
          <span style="color:#aaa;">${row.value.toLocaleString('de-DE')}</span>
          <span style="color:#8B5CF6;font-weight:600;min-width:56px;text-align:right;">${pct}%</span>
        </div>`
      }).join('')

      body.innerHTML = `<div style="display:flex;gap:24px;flex-wrap:wrap;align-items:center;justify-content:center;padding:12px;">
        <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
          ${slices}
          <text x="${cx}" y="${cy - 4}" text-anchor="middle" fill="#fff" font-size="14" font-weight="600">Gesamt</text>
          <text x="${cx}" y="${cy + 16}" text-anchor="middle" fill="#8B5CF6" font-size="18" font-weight="700">${total.toLocaleString('de-DE')}</text>
        </svg>
        <div style="flex:1;min-width:240px;">${legend}</div>
      </div>`
    }

    const refresh = async () => {
      body.innerHTML = '<div class="loading">Lädt…</div>'
      try {
        const { data, error } = await sb
          .from('users')
          .select('type')
          .is('deleted_at', null)
        if (error) throw error
        const counts = new Map()
        for (const row of (data || [])) {
          const t = row.type || 'unbekannt'
          counts.set(t, (counts.get(t) || 0) + 1)
        }
        const rows = Array.from(counts.entries())
          .map(([label, value]) => ({ label, value }))
          .sort((a, b) => b.value - a.value)
        if (!rows.length) {
          body.innerHTML = '<div class="empty">Keine User gefunden.</div>'
          return
        }
        renderPie(rows)
      } catch (e) {
        body.innerHTML = '<div class="empty">Daten kommen bald: ' + (e?.message || 'unbekannt') + '</div>'
      }
    }

    container.querySelector('.refresh-btn').addEventListener('click', refresh)
    await refresh()
  }
}
