import { sb } from '/lib/supabase.js'

export default {
  id: 'kpi-live-totals',
  title: 'Live-Kennzahlen',
  category: 'overview',
  summary: "Gesamtzahlen User, Posts, Listens, Podcasts auf einen Blick.",
  async mount(container) {
    container.innerHTML = `<div class="panel-shell">
      <div class="panel-head"><h2>Live-Kennzahlen</h2><button class="refresh-btn">Aktualisieren</button></div>
      <div class="panel-body"><div class="loading">Lädt…</div></div>
    </div>`
    const body = container.querySelector('.panel-body')

    const fmt = (n) => {
      if (n === null || n === undefined) return '–'
      const num = Number(n)
      if (Number.isNaN(num)) return String(n)
      return num.toLocaleString('de-DE')
    }

    const pick = (obj, keys) => {
      if (!obj || typeof obj !== 'object') return null
      for (const k of keys) {
        if (obj[k] !== undefined && obj[k] !== null) return obj[k]
      }
      return null
    }

    const refresh = async () => {
      body.innerHTML = '<div class="loading">Lädt…</div>'
      try {
        const { data, error } = await sb.rpc('admin_db_live_stats')
        if (error) throw error

        let row = Array.isArray(data) ? (data[0] || {}) : (data || {})

        const users = pick(row, ['users', 'users_total', 'total_users', 'user_count', 'users_count'])
        const posts = pick(row, ['posts', 'posts_total', 'total_posts', 'updates', 'updates_total', 'post_count'])
        const listens = pick(row, ['listens', 'listens_total', 'total_listens', 'listening_activity', 'listen_count'])
        const podcasts = pick(row, ['podcasts', 'podcasts_total', 'total_podcasts', 'podcast_count'])

        const tiles = [
          { label: 'User', value: fmt(users), hint: 'Registrierte Accounts' },
          { label: 'Posts', value: fmt(posts), hint: 'Updates im Feed' },
          { label: 'Listens', value: fmt(listens), hint: 'Episode-Plays gesamt' },
          { label: 'Podcasts', value: fmt(podcasts), hint: 'Verknüpfte Shows' }
        ]

        const allEmpty = tiles.every(t => t.value === '–')
        if (allEmpty) {
          // Fallback: nimm rohe Felder als Tiles, sofern vorhanden
          const keys = Object.keys(row || {})
          if (keys.length === 0) {
            body.innerHTML = '<div class="empty">Keine Live-Daten verfügbar.</div>'
            return
          }
          const dynTiles = keys.slice(0, 5).map(k => ({
            label: k,
            value: fmt(row[k]),
            hint: ''
          }))
          body.innerHTML = `<div class="kpi-grid">${dynTiles.map(t => `
            <div class="kpi-tile">
              <div class="kpi-label">${t.label}</div>
              <div class="kpi-value">${t.value}</div>
              <div class="kpi-hint">${t.hint}</div>
            </div>`).join('')}</div>`
          return
        }

        body.innerHTML = `<div class="kpi-grid">${tiles.map(t => `
          <div class="kpi-tile">
            <div class="kpi-label">${t.label}</div>
            <div class="kpi-value">${t.value}</div>
            <div class="kpi-hint">${t.hint}</div>
          </div>`).join('')}</div>`
      } catch (e) {
        body.innerHTML = '<div class="empty">Daten kommen bald: ' + (e?.message || 'unbekannt') + '</div>'
      }
    }
    container.querySelector('.refresh-btn').addEventListener('click', refresh)
    await refresh()
  }
}
