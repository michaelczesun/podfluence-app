import { sb } from '/lib/supabase.js'

export default {
  id: 'client-build-versions',
  title: 'App-Versionen im Feld',
  category: 'users',
  summary: 'Verteilung der client_build_version unter aktiven Usern.',
  async mount(container) {
    container.innerHTML = `<div class="panel-shell">
      <div class="panel-head"><h2>App-Versionen im Feld</h2><button class="refresh-btn">Aktualisieren</button></div>
      <div class="panel-body"><div class="loading">Lädt…</div></div>
    </div>`
    const body = container.querySelector('.panel-body')

    const refresh = async () => {
      body.innerHTML = '<div class="loading">Lädt…</div>'
      try {
        const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()
        const { data, error } = await sb
          .from('users')
          .select('client_build_version, last_seen_at')
          .gt('last_seen_at', since)
          .is('deleted_at', null)
          .limit(50000)
        if (error) throw error

        const counts = new Map()
        for (const row of (data || [])) {
          const v = row.client_build_version || 'unbekannt'
          counts.set(v, (counts.get(v) || 0) + 1)
        }
        const entries = [...counts.entries()].sort((a, b) => b[1] - a[1])

        if (entries.length === 0) {
          body.innerHTML = '<div class="empty">Keine aktiven User in den letzten 14 Tagen.</div>'
          return
        }

        const total = entries.reduce((s, [, n]) => s + n, 0)
        const max = entries[0][1]
        const top = entries.slice(0, 12)

        const W = 720, H = 280, PAD_L = 40, PAD_B = 60, PAD_T = 16, PAD_R = 16
        const innerW = W - PAD_L - PAD_R
        const innerH = H - PAD_T - PAD_B
        const barW = Math.max(8, innerW / top.length - 10)

        const bars = top.map(([v, n], i) => {
          const x = PAD_L + i * (innerW / top.length) + 5
          const h = max > 0 ? (n / max) * innerH : 0
          const y = PAD_T + innerH - h
          const label = String(v).length > 10 ? String(v).slice(0, 10) + '…' : String(v)
          return `
            <g>
              <rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="6" fill="#8B5CF6"></rect>
              <text x="${x + barW / 2}" y="${y - 6}" text-anchor="middle" fill="#fff" font-size="11" font-family="system-ui">${n}</text>
              <text x="${x + barW / 2}" y="${PAD_T + innerH + 16}" text-anchor="middle" fill="#bbb" font-size="11" font-family="system-ui">${label}</text>
            </g>`
        }).join('')

        const rows = entries.map(([v, n], i) => `
          <tr>
            <td>${i + 1}</td>
            <td>${escapeHtml(String(v))}</td>
            <td>${n}</td>
            <td>${((n / total) * 100).toFixed(1)} %</td>
          </tr>`).join('')

        body.innerHTML = `
          <div class="kpi-grid">
            <div class="kpi-tile"><div class="label">Aktive User (14d)</div><div class="value">${total}</div><div class="hint">last_seen_at &gt; now()-14d</div></div>
            <div class="kpi-tile"><div class="label">Distinct Versionen</div><div class="value">${entries.length}</div><div class="hint">inkl. unbekannt</div></div>
            <div class="kpi-tile"><div class="label">Top-Version</div><div class="value">${escapeHtml(String(entries[0][0]))}</div><div class="hint">${entries[0][1]} User · ${((entries[0][1] / total) * 100).toFixed(1)} %</div></div>
          </div>
          <div style="background:#16161D;border:1px solid #2A2A33;border-radius:12px;padding:12px;margin-top:12px;">
            <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" style="display:block;">
              <line x1="${PAD_L}" y1="${PAD_T + innerH}" x2="${W - PAD_R}" y2="${PAD_T + innerH}" stroke="#2A2A33" stroke-width="1"></line>
              ${bars}
            </svg>
          </div>
          <table class="data-table" style="margin-top:12px;">
            <thead><tr><th>#</th><th>Build-Version</th><th>User</th><th>Anteil</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        `
      } catch (e) {
        body.innerHTML = '<div class="empty">Daten kommen bald: ' + (e?.message || 'unbekannt') + '</div>'
      }
    }

    container.querySelector('.refresh-btn').addEventListener('click', refresh)
    await refresh()
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}
