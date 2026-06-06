import { sb } from '/lib/supabase.js'

export default {
  id: 'referral-overview',
  title: 'Referral-Conversion',
  category: 'growth',
  summary: "Invites, Signups, Conversion-Rate.",
  async mount(container) {
    container.innerHTML = `<div class="panel-shell">
      <div class="panel-head"><h2>Referral-Conversion</h2><button class="refresh-btn">Aktualisieren</button></div>
      <div class="panel-body"><div class="loading">Lädt…</div></div>
    </div>`
    const body = container.querySelector('.panel-body')

    const fmtNum = (n) => {
      if (n === null || n === undefined) return '–'
      const num = Number(n)
      if (!isFinite(num)) return '–'
      return num.toLocaleString('de-DE')
    }
    const fmtPct = (n) => {
      if (n === null || n === undefined) return '–'
      const num = Number(n)
      if (!isFinite(num)) return '–'
      return num.toFixed(1).replace('.', ',') + ' %'
    }

    const pickNum = (obj, keys) => {
      for (const k of keys) {
        if (obj && obj[k] !== undefined && obj[k] !== null) return Number(obj[k])
      }
      return null
    }

    const refresh = async () => {
      body.innerHTML = '<div class="loading">Lädt…</div>'
      try {
        const { data, error } = await sb.rpc('referral_overview')
        if (error) throw error

        let row = data
        if (Array.isArray(data)) row = data[0] || {}
        if (!row || typeof row !== 'object') row = {}

        const totalInvites = pickNum(row, ['total_invites', 'invites_total', 'invites', 'total'])
        const totalSignups = pickNum(row, ['total_signups', 'signups_total', 'signups', 'converted', 'total_conversions'])
        const pendingInvites = pickNum(row, ['pending_invites', 'open_invites', 'unused_invites'])
        let conversion = pickNum(row, ['conversion_rate', 'conversion', 'rate', 'conversion_pct'])
        if (conversion !== null && conversion <= 1) conversion = conversion * 100
        if (conversion === null && totalInvites && totalSignups !== null) {
          conversion = totalInvites > 0 ? (totalSignups / totalInvites) * 100 : 0
        }

        const tiles = [
          { label: 'Invites gesamt', value: fmtNum(totalInvites), hint: 'Versendete Einladungen' },
          { label: 'Signups', value: fmtNum(totalSignups), hint: 'Registrierungen via Referral' },
          { label: 'Conversion-Rate', value: fmtPct(conversion), hint: 'Signups / Invites' },
          { label: 'Offen', value: fmtNum(pendingInvites !== null ? pendingInvites : (totalInvites !== null && totalSignups !== null ? Math.max(0, totalInvites - totalSignups) : null)), hint: 'Noch nicht eingelöst' }
        ]

        body.innerHTML = `<div class="kpi-grid">
          ${tiles.map(t => `<div class="kpi-tile">
            <div class="kpi-label">${t.label}</div>
            <div class="kpi-value">${t.value}</div>
            <div class="kpi-hint">${t.hint}</div>
          </div>`).join('')}
        </div>`
      } catch (e) {
        body.innerHTML = '<div class="empty">Daten kommen bald: ' + (e?.message || 'unbekannt') + '</div>'
      }
    }
    container.querySelector('.refresh-btn').addEventListener('click', refresh)
    await refresh()
  }
}
