import { sb } from '/lib/supabase.js'

export default {
  id: 'invite-codes-usage',
  title: 'Invite-Codes Nutzung',
  category: 'growth',
  summary: "Ausgestellte vs. eingelöste Invite-Codes.",
  async mount(container) {
    container.innerHTML = `<div class="panel-shell">
      <div class="panel-head"><h2>Invite-Codes Nutzung</h2><button class="refresh-btn">Aktualisieren</button></div>
      <div class="panel-body"><div class="loading">Lädt…</div></div>
    </div>`
    const body = container.querySelector('.panel-body')

    const renderBars = (data) => {
      const max = Math.max(1, ...data.map(d => d.value))
      const W = 480, H = 240, pad = 32, bw = (W - pad * 2) / data.length - 16
      const bars = data.map((d, i) => {
        const x = pad + i * ((W - pad * 2) / data.length) + 8
        const h = Math.round((d.value / max) * (H - pad * 2))
        const y = H - pad - h
        return `
          <rect x="${x}" y="${y}" width="${bw}" height="${h}" rx="6" fill="#8B5CF6"/>
          <text x="${x + bw / 2}" y="${y - 6}" text-anchor="middle" fill="#fff" font-size="13" font-weight="600">${d.value}</text>
          <text x="${x + bw / 2}" y="${H - pad + 18}" text-anchor="middle" fill="#9CA3AF" font-size="12">${d.label}</text>
        `
      }).join('')
      return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:560px;display:block;margin:0 auto;background:#16161D;border:1px solid #2A2A33;border-radius:12px;padding:8px">
        <line x1="${pad}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" stroke="#2A2A33" stroke-width="1"/>
        ${bars}
      </svg>`
    }

    const refresh = async () => {
      body.innerHTML = '<div class="loading">Lädt…</div>'
      try {
        const nowIso = new Date().toISOString()

        const [issuedRes, usedRes, expiredRes] = await Promise.all([
          sb.from('invites').select('id', { count: 'exact', head: true }),
          sb.from('invites').select('id', { count: 'exact', head: true }).not('used_at', 'is', null),
          sb.from('invites').select('id', { count: 'exact', head: true })
            .is('used_at', null).lt('expires_at', nowIso)
        ])

        if (issuedRes.error) throw issuedRes.error
        if (usedRes.error) throw usedRes.error
        if (expiredRes.error) throw expiredRes.error

        const issued = issuedRes.count || 0
        const used = usedRes.count || 0
        const expired = expiredRes.count || 0
        const open = Math.max(0, issued - used - expired)
        const rate = issued > 0 ? Math.round((used / issued) * 100) : 0

        const data = [
          { label: 'Ausgestellt', value: issued },
          { label: 'Eingelöst', value: used },
          { label: 'Offen', value: open },
          { label: 'Abgelaufen', value: expired }
        ]

        body.innerHTML = `
          <div class="kpi-grid" style="margin-bottom:16px">
            <div class="kpi-tile"><div style="color:#9CA3AF;font-size:12px">Ausgestellt</div><div style="font-size:24px;font-weight:700;color:#fff">${issued}</div><div style="color:#9CA3AF;font-size:11px">Gesamt erzeugt</div></div>
            <div class="kpi-tile"><div style="color:#9CA3AF;font-size:12px">Eingelöst</div><div style="font-size:24px;font-weight:700;color:#8B5CF6">${used}</div><div style="color:#9CA3AF;font-size:11px">${rate}% Conversion</div></div>
            <div class="kpi-tile"><div style="color:#9CA3AF;font-size:12px">Offen</div><div style="font-size:24px;font-weight:700;color:#fff">${open}</div><div style="color:#9CA3AF;font-size:11px">Noch nutzbar</div></div>
            <div class="kpi-tile"><div style="color:#9CA3AF;font-size:12px">Abgelaufen</div><div style="font-size:24px;font-weight:700;color:#fff">${expired}</div><div style="color:#9CA3AF;font-size:11px">Ohne Einlösung</div></div>
          </div>
          ${renderBars(data)}
        `
      } catch (e) {
        body.innerHTML = '<div class="empty">Daten kommen bald: ' + (e?.message || 'unbekannt') + '</div>'
      }
    }
    container.querySelector('.refresh-btn').addEventListener('click', refresh)
    await refresh()
  }
}
