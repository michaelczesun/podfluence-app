import { sb } from '/lib/supabase.js'

export default {
  id: 'recent-updates-feed',
  title: 'Aktuelle Posts',
  category: 'content',
  summary: "Letzte User-Updates im Feed-Stil.",
  async mount(container) {
    container.innerHTML = `<div class="panel-shell">
      <div class="panel-head"><h2>Aktuelle Posts</h2><button class="refresh-btn">Aktualisieren</button></div>
      <div class="panel-body"><div class="loading">Lädt…</div></div>
    </div>`
    const body = container.querySelector('.panel-body')

    const escapeHtml = (s) => String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')

    const formatDate = (iso) => {
      if (!iso) return ''
      try {
        const d = new Date(iso)
        const now = new Date()
        const diffMs = now - d
        const diffMin = Math.floor(diffMs / 60000)
        if (diffMin < 1) return 'gerade eben'
        if (diffMin < 60) return `vor ${diffMin} Min.`
        const diffH = Math.floor(diffMin / 60)
        if (diffH < 24) return `vor ${diffH} Std.`
        const diffD = Math.floor(diffH / 24)
        if (diffD < 7) return `vor ${diffD} T.`
        return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
      } catch {
        return iso
      }
    }

    const refresh = async () => {
      body.innerHTML = '<div class="loading">Lädt…</div>'
      try {
        const { data, error } = await sb
          .from('updates')
          .select('id, content, created_at, user_id, users:user_id(username)')
          .order('created_at', { ascending: false })
          .limit(25)

        if (error) throw error

        const rows = Array.isArray(data) ? data : []

        if (rows.length === 0) {
          body.innerHTML = '<div class="empty">Keine Posts gefunden.</div>'
          return
        }

        const cards = rows.map(r => {
          const username = r.users?.username || 'unbekannt'
          const content = r.content || ''
          const when = formatDate(r.created_at)
          return `
            <div style="background:#1C1C24;border:1px solid #2A2A33;border-radius:12px;padding:14px 16px;margin-bottom:10px;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                <div style="color:#8B5CF6;font-weight:600;font-size:14px;">@${escapeHtml(username)}</div>
                <div style="color:#888;font-size:12px;">${escapeHtml(when)}</div>
              </div>
              <div style="color:#fff;font-size:14px;line-height:1.5;white-space:pre-wrap;word-break:break-word;">${escapeHtml(content)}</div>
            </div>
          `
        }).join('')

        body.innerHTML = `<div class="feed" style="display:flex;flex-direction:column;">${cards}</div>`
      } catch (e) {
        body.innerHTML = '<div class="empty">Daten kommen bald: ' + escapeHtml(e?.message || 'unbekannt') + '</div>'
      }
    }
    container.querySelector('.refresh-btn').addEventListener('click', refresh)
    await refresh()
  }
}
