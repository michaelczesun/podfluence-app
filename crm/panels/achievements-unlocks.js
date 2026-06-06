import { sb } from '/lib/supabase.js'

export default {
  id: 'achievements-unlocks',
  title: 'Achievement-Unlocks',
  category: 'engagement',
  summary: "Wie oft welches Achievement freigeschaltet wurde.",
  async mount(container) {
    container.innerHTML = `<div class="panel-shell">
      <div class="panel-head"><h2>Achievement-Unlocks</h2><button class="refresh-btn">Aktualisieren</button></div>
      <div class="panel-body"><div class="loading">Lädt…</div></div>
    </div>`
    const body = container.querySelector('.panel-body')

    const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]))

    const renderBars = (rows) => {
      if (!rows || rows.length === 0) {
        body.innerHTML = '<div class="empty">Noch keine Achievement-Unlocks.</div>'
        return
      }
      const maxVal = Math.max(...rows.map(r => r.c), 1)
      const W = 720
      const H = 320
      const padL = 40, padR = 20, padT = 20, padB = 80
      const innerW = W - padL - padR
      const innerH = H - padT - padB
      const barW = Math.max(8, (innerW / rows.length) - 12)
      const gap = (innerW - barW * rows.length) / (rows.length + 1)

      const bars = rows.map((r, i) => {
        const h = (r.c / maxVal) * innerH
        const x = padL + gap + i * (barW + gap)
        const y = padT + innerH - h
        const labelShort = String(r.label || '').length > 14
          ? String(r.label).slice(0, 13) + '…'
          : String(r.label || '')
        return `
          <g>
            <rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="6" ry="6" fill="#8B5CF6" />
            <text x="${x + barW / 2}" y="${y - 6}" fill="#fff" font-size="11" text-anchor="middle">${r.c}</text>
            <text x="${x + barW / 2}" y="${padT + innerH + 16}" fill="#cfcfd6" font-size="11" text-anchor="middle"
              transform="rotate(35 ${x + barW / 2} ${padT + innerH + 16})">${escapeHtml(labelShort)}</text>
          </g>
        `
      }).join('')

      const axis = `<line x1="${padL}" y1="${padT + innerH}" x2="${W - padR}" y2="${padT + innerH}" stroke="#2A2A33" stroke-width="1" />`

      body.innerHTML = `
        <div style="background:#16161D;border:1px solid #2A2A33;border-radius:12px;padding:16px;">
          <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" style="display:block;">
            ${axis}
            ${bars}
          </svg>
        </div>
        <div style="margin-top:12px;">
          <table class="data-table" style="width:100%;border-collapse:collapse;">
            <thead>
              <tr style="text-align:left;color:#cfcfd6;border-bottom:1px solid #2A2A33;">
                <th style="padding:8px;">Achievement</th>
                <th style="padding:8px;text-align:right;">Unlocks</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(r => `
                <tr style="border-bottom:1px solid #2A2A33;color:#fff;">
                  <td style="padding:8px;">${escapeHtml(r.label)}</td>
                  <td style="padding:8px;text-align:right;">${r.c}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `
    }

    const refresh = async () => {
      body.innerHTML = '<div class="loading">Lädt…</div>'
      try {
        const { data: achievements, error: aErr } = await sb
          .from('achievements')
          .select('key,label,sort_order')
        if (aErr) throw aErr

        const { data: unlocks, error: uErr } = await sb
          .from('user_achievements')
          .select('achievement_key')
        if (uErr) throw uErr

        const counts = new Map()
        for (const u of (unlocks || [])) {
          const k = u.achievement_key
          counts.set(k, (counts.get(k) || 0) + 1)
        }

        const rows = (achievements || []).map(a => ({
          key: a.key,
          label: a.label || a.key,
          c: counts.get(a.key) || 0
        })).sort((x, y) => y.c - x.c)

        renderBars(rows)
      } catch (e) {
        body.innerHTML = '<div class="empty">Daten kommen bald: ' + escapeHtml(e?.message || 'unbekannt') + '</div>'
      }
    }
    container.querySelector('.refresh-btn').addEventListener('click', refresh)
    await refresh()
  }
}
