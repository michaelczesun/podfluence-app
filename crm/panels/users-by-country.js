import { sb } from '/lib/supabase.js'

export default {
  id: 'users-by-country',
  title: 'User-Weltkarte',
  category: 'growth',
  summary: 'User-Verteilung nach Ländern als Karte.',
  async mount(container) {
    container.innerHTML = `<div class="panel-shell">
      <div class="panel-head"><h2>User-Weltkarte</h2><button class="refresh-btn">Aktualisieren</button></div>
      <div class="panel-body"><div class="loading">Lädt…</div></div>
    </div>`
    const body = container.querySelector('.panel-body')

    const showToast = (msg) => {
      const t = document.createElement('div')
      t.className = 'toast'
      t.textContent = msg
      container.appendChild(t)
      setTimeout(() => t.remove(), 2400)
    }

    const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c])

    const countryName = (code) => {
      if (!code) return 'Unbekannt'
      const c = String(code).trim().toUpperCase()
      try {
        const dn = new Intl.DisplayNames(['de'], { type: 'region' })
        return dn.of(c) || c
      } catch {
        return c
      }
    }

    const flagEmoji = (code) => {
      if (!code) return '🏳️'
      const c = String(code).trim().toUpperCase()
      if (c.length !== 2) return '🏳️'
      const A = 0x1F1E6
      return String.fromCodePoint(A + (c.charCodeAt(0) - 65), A + (c.charCodeAt(1) - 65))
    }

    const fetchData = async () => {
      const { data, error } = await sb.rpc('admin_users_by_country')
      if (error) throw error
      if (Array.isArray(data) && data.length) return data
      const { data: vData, error: vErr } = await sb.from('users_by_country').select('*')
      if (vErr) throw vErr
      return vData || []
    }

    const normalize = (rows) => {
      return (rows || [])
        .map((r) => {
          const country = r.country ?? r.country_code ?? r.code ?? r.iso ?? null
          const count = Number(
            r.user_count ?? r.users_count ?? r.count ?? r.total ?? r.n ?? 0
          ) || 0
          return { country, count }
        })
        .filter((r) => r.count > 0)
        .sort((a, b) => b.count - a.count)
    }

    const intensity = (value, max) => {
      if (!max) return 0
      const t = Math.pow(value / max, 0.55)
      return Math.max(0.08, Math.min(1, t))
    }

    const render = (rows) => {
      const total = rows.reduce((s, r) => s + r.count, 0)
      const topCountries = rows.length
      const top = rows[0]
      const top5Sum = rows.slice(0, 5).reduce((s, r) => s + r.count, 0)
      const top5Share = total ? Math.round((top5Sum / total) * 100) : 0

      const max = top ? top.count : 0

      const kpis = `
        <div class="kpi-grid">
          <div class="kpi-tile">
            <div class="kpi-label">User gesamt</div>
            <div class="kpi-value">${total.toLocaleString('de-DE')}</div>
            <div class="kpi-hint">über alle Länder</div>
          </div>
          <div class="kpi-tile">
            <div class="kpi-label">Länder</div>
            <div class="kpi-value">${topCountries}</div>
            <div class="kpi-hint">mit ≥ 1 User</div>
          </div>
          <div class="kpi-tile">
            <div class="kpi-label">Top-Land</div>
            <div class="kpi-value">${top ? flagEmoji(top.country) + ' ' + escapeHtml(countryName(top.country)) : '–'}</div>
            <div class="kpi-hint">${top ? top.count.toLocaleString('de-DE') + ' User' : 'keine Daten'}</div>
          </div>
          <div class="kpi-tile">
            <div class="kpi-label">Top-5 Anteil</div>
            <div class="kpi-value">${top5Share}%</div>
            <div class="kpi-hint">der Gesamt-User</div>
          </div>
        </div>
      `

      const heatRows = rows.slice(0, 48)
      const heatCells = heatRows.map((r) => {
        const a = intensity(r.count, max)
        const bg = `rgba(139, 92, 246, ${a.toFixed(3)})`
        const border = `rgba(139, 92, 246, ${Math.min(1, a + 0.25).toFixed(3)})`
        return `
          <div class="heat-cell" style="
            background:${bg};
            border:1px solid ${border};
            border-radius:10px;
            padding:10px 8px;
            min-height:64px;
            display:flex;
            flex-direction:column;
            justify-content:space-between;
            color:#fff;
          " title="${escapeHtml(countryName(r.country))}: ${r.count.toLocaleString('de-DE')} User">
            <div style="font-size:18px;line-height:1">${flagEmoji(r.country)}</div>
            <div style="font-size:11px;opacity:.85;font-weight:600;letter-spacing:.3px">${escapeHtml(String(r.country || '??').toUpperCase())}</div>
            <div style="font-size:13px;font-weight:700">${r.count.toLocaleString('de-DE')}</div>
          </div>
        `
      }).join('')

      const heatmap = `
        <div style="
          background:#16161D;
          border:1px solid #2A2A33;
          border-radius:12px;
          padding:14px;
          margin-top:14px;
        ">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
            <div style="color:#fff;font-weight:600">Heatmap nach Land</div>
            <div style="display:flex;align-items:center;gap:8px;font-size:11px;color:#9a9aa6">
              <span>wenig</span>
              <span style="display:inline-block;width:80px;height:8px;border-radius:4px;background:linear-gradient(90deg, rgba(139,92,246,0.12), rgba(139,92,246,1));border:1px solid #2A2A33"></span>
              <span>viel</span>
            </div>
          </div>
          <div style="
            display:grid;
            grid-template-columns:repeat(auto-fill, minmax(86px, 1fr));
            gap:8px;
          ">
            ${heatCells || '<div class="empty">Keine Länder-Daten</div>'}
          </div>
        </div>
      `

      const tableRows = rows.slice(0, 25).map((r, i) => `
        <tr>
          <td style="color:#9a9aa6">${i + 1}</td>
          <td>${flagEmoji(r.country)} ${escapeHtml(countryName(r.country))}</td>
          <td style="color:#9a9aa6;font-family:ui-monospace,monospace">${escapeHtml(String(r.country || '??').toUpperCase())}</td>
          <td style="text-align:right;font-weight:600">${r.count.toLocaleString('de-DE')}</td>
          <td style="text-align:right;color:#9a9aa6">${total ? ((r.count / total) * 100).toFixed(1) : '0.0'}%</td>
        </tr>
      `).join('')

      const table = `
        <div style="margin-top:14px">
          <div style="color:#fff;font-weight:600;margin-bottom:8px">Top Länder</div>
          <table class="data-table" style="width:100%;border-collapse:collapse">
            <thead>
              <tr style="color:#9a9aa6;text-align:left">
                <th style="padding:6px 8px">#</th>
                <th style="padding:6px 8px">Land</th>
                <th style="padding:6px 8px">Code</th>
                <th style="padding:6px 8px;text-align:right">User</th>
                <th style="padding:6px 8px;text-align:right">Anteil</th>
              </tr>
            </thead>
            <tbody>${tableRows || '<tr><td colspan="5" class="empty">Keine Daten</td></tr>'}</tbody>
          </table>
        </div>
      `

      body.innerHTML = kpis + heatmap + table
    }

    const refresh = async () => {
      body.innerHTML = '<div class="loading">Lädt…</div>'
      try {
        const raw = await fetchData()
        const rows = normalize(raw)
        if (!rows.length) {
          body.innerHTML = '<div class="empty">Noch keine Länder-Daten.</div>'
          return
        }
        render(rows)
      } catch (e) {
        body.innerHTML = '<div class="empty">Daten kommen bald: ' + escapeHtml(e?.message || 'unbekannt') + '</div>'
      }
    }

    container.querySelector('.refresh-btn').addEventListener('click', refresh)
    await refresh()
  }
}
