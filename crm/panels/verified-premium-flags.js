import { sb } from '/lib/supabase.js'

export default {
  id: 'verified-premium-flags',
  title: 'Verifiziert & Premium',
  category: 'users',
  summary: "Anteil verifizierter und Premium-User.",
  async mount(container) {
    container.innerHTML = `<div class="panel-shell">
      <div class="panel-head"><h2>Verifiziert &amp; Premium</h2><button class="refresh-btn">Aktualisieren</button></div>
      <div class="panel-body"><div class="loading">Lädt…</div></div>
    </div>`
    const body = container.querySelector('.panel-body')
    const refresh = async () => {
      body.innerHTML = '<div class="loading">Lädt…</div>'
      try {
        const [verifiedRes, premiumRes, adminRes, totalRes] = await Promise.all([
          sb.from('users').select('id', { count: 'exact', head: true }).eq('is_verified', true),
          sb.from('users').select('id', { count: 'exact', head: true }).eq('is_premium', true),
          sb.from('users').select('id', { count: 'exact', head: true }).eq('is_app_admin', true),
          sb.from('users').select('id', { count: 'exact', head: true }),
        ])

        if (verifiedRes.error) throw verifiedRes.error
        if (premiumRes.error) throw premiumRes.error
        if (adminRes.error) throw adminRes.error
        if (totalRes.error) throw totalRes.error

        const verified = verifiedRes.count || 0
        const premium = premiumRes.count || 0
        const admins = adminRes.count || 0
        const total = totalRes.count || 0

        const pct = (n) => total > 0 ? ((n / total) * 100).toFixed(1) + '%' : '0%'
        const fmt = (n) => n.toLocaleString('de-DE')

        const tiles = [
          { label: 'User gesamt', value: fmt(total), hint: '100%' },
          { label: 'Verifiziert', value: fmt(verified), hint: pct(verified) + ' der User' },
          { label: 'Premium', value: fmt(premium), hint: pct(premium) + ' der User' },
          { label: 'App-Admins', value: fmt(admins), hint: pct(admins) + ' der User' },
        ]

        body.innerHTML = `<div class="kpi-grid">${tiles.map(t => `
          <div class="kpi-tile">
            <div style="font-size:12px;color:#9CA3AF;text-transform:uppercase;letter-spacing:0.5px;">${t.label}</div>
            <div style="font-size:28px;font-weight:700;color:#fff;margin-top:6px;">${t.value}</div>
            <div style="font-size:12px;color:#8B5CF6;margin-top:4px;">${t.hint}</div>
          </div>
        `).join('')}</div>`
      } catch (e) {
        body.innerHTML = '<div class="empty">Daten kommen bald: ' + (e?.message || 'unbekannt') + '</div>'
      }
    }
    container.querySelector('.refresh-btn').addEventListener('click', refresh)
    await refresh()
  }
}
