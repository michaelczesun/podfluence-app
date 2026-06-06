import { sb } from '/lib/supabase.js'

export default {
  id: 'open-bug-reports',
  title: 'Offene Bug-Reports',
  category: 'overview',
  summary: 'Aktuelle, unbearbeitete In-App-Bugmeldungen.',
  async mount(container) {
    container.innerHTML = `<div class="panel-shell">
      <div class="panel-head"><h2>Offene Bug-Reports</h2><button class="refresh-btn">Aktualisieren</button></div>
      <div class="panel-body"><div class="loading">Lädt…</div></div>
    </div>`
    const body = container.querySelector('.panel-body')

    const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]))

    const fmtDate = (iso) => {
      if (!iso) return '—'
      try {
        const d = new Date(iso)
        return d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      } catch { return iso }
    }

    const statusColor = (status) => {
      const s = String(status || '').toLowerCase()
      if (s === 'open' || s === 'new' || s === '') return '#8B5CF6'
      if (s === 'in_progress' || s === 'investigating') return '#F59E0B'
      if (s === 'wontfix' || s === 'duplicate') return '#6B7280'
      return '#8B5CF6'
    }

    const refresh = async () => {
      body.innerHTML = '<div class="loading">Lädt…</div>'
      try {
        const { data, error } = await sb
          .from('bug_reports')
          .select('id, user_id, description, screenshot_url, platform, app_version, device_info, status, admin_note, created_at, resolved_at')
          .neq('status', 'resolved')
          .order('created_at', { ascending: false })
          .limit(20)

        if (error) throw error

        if (!data || data.length === 0) {
          body.innerHTML = '<div class="empty">Keine offenen Bug-Reports — alles sauber.</div>'
          return
        }

        const cards = data.map((b) => {
          const desc = escapeHtml(b.description || '(keine Beschreibung)')
          const plat = escapeHtml(b.platform || '—')
          const ver = escapeHtml(b.app_version || '—')
          const dev = escapeHtml(b.device_info || '')
          const status = escapeHtml(b.status || 'open')
          const note = b.admin_note ? `<div style="margin-top:8px;padding:8px;background:#1F1F28;border-left:3px solid #8B5CF6;border-radius:6px;font-size:12px;color:#C4B5FD;">Admin: ${escapeHtml(b.admin_note)}</div>` : ''
          const shot = b.screenshot_url
            ? `<a href="${escapeHtml(b.screenshot_url)}" target="_blank" rel="noopener" style="display:inline-block;margin-top:8px;padding:4px 10px;border:1px solid #2A2A33;border-radius:8px;color:#8B5CF6;text-decoration:none;font-size:12px;">Screenshot ansehen</a>`
            : ''
          const uid = b.user_id ? escapeHtml(String(b.user_id).slice(0, 8)) : '—'

          return `<div style="background:#1B1B23;border:1px solid #2A2A33;border-radius:12px;padding:14px;margin-bottom:10px;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">
              <div style="font-size:14px;color:#fff;line-height:1.4;flex:1;">${desc}</div>
              <span style="background:${statusColor(b.status)};color:#fff;padding:3px 9px;border-radius:999px;font-size:11px;font-weight:600;white-space:nowrap;">${status}</span>
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;font-size:11px;color:#9CA3AF;">
              <span style="background:#16161D;border:1px solid #2A2A33;padding:3px 8px;border-radius:6px;">${plat}</span>
              <span style="background:#16161D;border:1px solid #2A2A33;padding:3px 8px;border-radius:6px;">v${ver}</span>
              ${dev ? `<span style="background:#16161D;border:1px solid #2A2A33;padding:3px 8px;border-radius:6px;">${dev}</span>` : ''}
              <span style="background:#16161D;border:1px solid #2A2A33;padding:3px 8px;border-radius:6px;">User: ${uid}</span>
              <span style="margin-left:auto;color:#6B7280;">${fmtDate(b.created_at)}</span>
            </div>
            ${shot}
            ${note}
          </div>`
        }).join('')

        body.innerHTML = `<div style="font-size:12px;color:#9CA3AF;margin-bottom:10px;">${data.length} offene Meldung${data.length === 1 ? '' : 'en'}</div>${cards}`
      } catch (e) {
        body.innerHTML = '<div class="empty">Daten kommen bald: ' + escapeHtml(e?.message || 'unbekannt') + '</div>'
      }
    }

    container.querySelector('.refresh-btn').addEventListener('click', refresh)
    await refresh()
  }
}
