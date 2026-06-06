import { sb } from '/lib/supabase.js'

const PAGE_SIZE = 25

export default {
  id: 'users-list',
  title: 'Nutzer-Liste',
  category: 'users',
  summary: 'Paginierte Vollliste aller User mit Flags und Build-Version.',
  async mount(container) {
    container.innerHTML = `<div class="panel-shell">
      <div class="panel-head">
        <h2>Nutzer-Liste</h2>
        <button class="refresh-btn">Aktualisieren</button>
      </div>
      <div class="panel-body"><div class="loading">Lädt…</div></div>
    </div>`

    const body = container.querySelector('.panel-body')
    let page = 0

    const showToast = (msg) => {
      const t = document.createElement('div')
      t.className = 'toast'
      t.textContent = msg
      container.appendChild(t)
      setTimeout(() => t.remove(), 2200)
    }

    const fmt = (v) => {
      if (v === null || v === undefined || v === '') return '—'
      return String(v)
    }

    const flagChips = (row) => {
      const chips = []
      if (row.is_verified) chips.push('<span class="chips" style="background:#8B5CF6;color:#fff;padding:2px 8px;border-radius:8px;font-size:11px;margin-right:4px;">verified</span>')
      if (row.is_premium) chips.push('<span class="chips" style="background:#F59E0B;color:#fff;padding:2px 8px;border-radius:8px;font-size:11px;margin-right:4px;">premium</span>')
      if (row.is_app_admin) chips.push('<span class="chips" style="background:#EF4444;color:#fff;padding:2px 8px;border-radius:8px;font-size:11px;margin-right:4px;">admin</span>')
      return chips.join('') || '<span style="color:#666;">—</span>'
    }

    const render = (rows, pageNum) => {
      const hasNext = rows.length === PAGE_SIZE
      const hasPrev = pageNum > 0

      const rowsHtml = rows.map((r, i) => `
        <tr>
          <td style="color:#666;">${pageNum * PAGE_SIZE + i + 1}</td>
          <td><strong>${fmt(r.username)}</strong></td>
          <td>${fmt(r.full_name)}</td>
          <td style="color:#aaa;">${fmt(r.email)}</td>
          <td>${fmt(r.type)}</td>
          <td>${fmt(r.country)}</td>
          <td>${flagChips(r)}</td>
          <td style="text-align:right;">${fmt(r.followers_count)}</td>
          <td style="text-align:right;">${fmt(r.following_count)}</td>
          <td style="color:#8B5CF6;">${fmt(r.client_build_version)}</td>
          <td style="color:#888;font-size:11px;">${r.last_seen_at ? new Date(r.last_seen_at).toLocaleString('de-DE') : '—'}</td>
        </tr>
      `).join('')

      body.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
          <div style="color:#aaa;font-size:13px;">Seite ${pageNum + 1} · ${rows.length} Einträge</div>
          <div style="display:flex;gap:8px;">
            <button class="prev-btn" ${hasPrev ? '' : 'disabled'} style="background:#2A2A33;color:#fff;border:1px solid #2A2A33;border-radius:8px;padding:6px 12px;cursor:${hasPrev ? 'pointer' : 'not-allowed'};opacity:${hasPrev ? '1' : '0.4'};">← Zurück</button>
            <button class="next-btn" ${hasNext ? '' : 'disabled'} style="background:#8B5CF6;color:#fff;border:none;border-radius:8px;padding:6px 12px;cursor:${hasNext ? 'pointer' : 'not-allowed'};opacity:${hasNext ? '1' : '0.4'};">Weiter →</button>
          </div>
        </div>
        <div style="overflow-x:auto;border:1px solid #2A2A33;border-radius:12px;">
          <table class="data-table" style="width:100%;border-collapse:collapse;color:#fff;font-size:13px;">
            <thead>
              <tr style="background:#1E1E27;text-align:left;">
                <th style="padding:10px;color:#888;font-weight:500;">#</th>
                <th style="padding:10px;color:#888;font-weight:500;">Username</th>
                <th style="padding:10px;color:#888;font-weight:500;">Name</th>
                <th style="padding:10px;color:#888;font-weight:500;">E-Mail</th>
                <th style="padding:10px;color:#888;font-weight:500;">Typ</th>
                <th style="padding:10px;color:#888;font-weight:500;">Land</th>
                <th style="padding:10px;color:#888;font-weight:500;">Flags</th>
                <th style="padding:10px;color:#888;font-weight:500;text-align:right;">Follower</th>
                <th style="padding:10px;color:#888;font-weight:500;text-align:right;">Folgt</th>
                <th style="padding:10px;color:#888;font-weight:500;">Build</th>
                <th style="padding:10px;color:#888;font-weight:500;">Last seen</th>
              </tr>
            </thead>
            <tbody>${rowsHtml || '<tr><td colspan="11" style="padding:24px;text-align:center;color:#666;">Keine Einträge</td></tr>'}</tbody>
          </table>
        </div>
      `

      const prev = body.querySelector('.prev-btn')
      const next = body.querySelector('.next-btn')
      if (prev) prev.addEventListener('click', () => { if (hasPrev) { page--; refresh() } })
      if (next) next.addEventListener('click', () => { if (hasNext) { page++; refresh() } })
    }

    const refresh = async () => {
      body.innerHTML = '<div class="loading">Lädt…</div>'
      try {
        const { data, error } = await sb.rpc('admin_list_users_full', {
          p_limit: PAGE_SIZE,
          p_offset: page * PAGE_SIZE
        })
        if (error) throw error
        const rows = Array.isArray(data) ? data : []
        render(rows, page)
      } catch (e) {
        body.innerHTML = '<div class="empty">Daten kommen bald: ' + (e?.message || 'unbekannt') + '</div>'
      }
    }

    container.querySelector('.refresh-btn').addEventListener('click', () => { page = 0; refresh() })
    await refresh()
  }
}
