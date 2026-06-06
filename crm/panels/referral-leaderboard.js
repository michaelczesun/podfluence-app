import { sb } from '/lib/supabase.js'

export default {
  id: 'referral-leaderboard',
  title: 'Top Inviter',
  category: 'growth',
  summary: "Wer hat die meisten User gebracht.",
  async mount(container) {
    container.innerHTML = `<div class="panel-shell">
      <div class="panel-head"><h2>Top Inviter</h2><button class="refresh-btn">Aktualisieren</button></div>
      <div class="panel-body"><div class="loading">Lädt…</div></div>
    </div>`
    const body = container.querySelector('.panel-body')

    const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]))

    const refresh = async () => {
      body.innerHTML = '<div class="loading">Lädt…</div>'
      try {
        const { data, error } = await sb.rpc('referral_leaderboard')
        if (error) throw error
        const rows = Array.isArray(data) ? data : []
        if (rows.length === 0) {
          body.innerHTML = '<div class="empty">Noch keine Referrals.</div>'
          return
        }

        const getName = (r) => r.username || r.full_name || r.inviter_username || r.inviter_name || r.name || r.email || r.inviter_id || 'Unbekannt'
        const getCount = (r) => r.referral_count ?? r.count ?? r.invites ?? r.total ?? r.referrals ?? 0

        const normalized = rows.map((r) => ({
          name: getName(r),
          count: Number(getCount(r)) || 0
        })).sort((a, b) => b.count - a.count)

        const total = normalized.reduce((s, r) => s + r.count, 0)
        const top = normalized[0]
        const activeInviters = normalized.filter(r => r.count > 0).length
        const avg = activeInviters > 0 ? (total / activeInviters).toFixed(1) : '0'

        const kpiHtml = `<div class="kpi-grid">
          <div class="kpi-tile"><div class="label">Inviter gesamt</div><div class="value">${normalized.length}</div><div class="hint">aktiv: ${activeInviters}</div></div>
          <div class="kpi-tile"><div class="label">Referrals gesamt</div><div class="value">${total}</div><div class="hint">über alle Inviter</div></div>
          <div class="kpi-tile"><div class="label">Top-Inviter</div><div class="value">${escapeHtml(top.name)}</div><div class="hint">${top.count} Einladungen</div></div>
          <div class="kpi-tile"><div class="label">Ø pro Inviter</div><div class="value">${avg}</div><div class="hint">aktive Inviter</div></div>
        </div>`

        const top50 = normalized.slice(0, 50)
        const rowsHtml = top50.map((r, i) => `<tr>
          <td style="width:48px;color:#8B5CF6;font-weight:600">#${i + 1}</td>
          <td>${escapeHtml(r.name)}</td>
          <td style="text-align:right;font-variant-numeric:tabular-nums">${r.count}</td>
        </tr>`).join('')

        const tableHtml = `<div class="leaderboard" style="margin-top:16px">
          <table class="data-table" style="width:100%;border-collapse:collapse">
            <thead><tr style="border-bottom:1px solid #2A2A33;text-align:left">
              <th style="padding:8px">Rang</th>
              <th style="padding:8px">Inviter</th>
              <th style="padding:8px;text-align:right">Referrals</th>
            </tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>`

        body.innerHTML = kpiHtml + tableHtml
      } catch (e) {
        body.innerHTML = '<div class="empty">Daten kommen bald: ' + escapeHtml(e?.message || 'unbekannt') + '</div>'
      }
    }
    container.querySelector('.refresh-btn').addEventListener('click', refresh)
    await refresh()
  }
}
