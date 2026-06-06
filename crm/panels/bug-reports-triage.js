import { sb } from '/lib/supabase.js'

const ADMIN_ACTIONS = ['mark_bug_resolved', 'add_admin_note', 'reply_to_reporter']

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]))
}

function showToast(container, msg) {
  const t = document.createElement('div')
  t.className = 'toast'
  t.textContent = msg
  t.style.cssText = 'position:fixed;bottom:24px;right:24px;background:#8B5CF6;color:#fff;padding:12px 18px;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.4);z-index:9999;font-size:14px;'
  document.body.appendChild(t)
  setTimeout(() => t.remove(), 2400)
}

export default {
  id: 'bug-reports-triage',
  title: 'Bug-Reports Triage',
  category: 'admin_actions',
  summary: 'Bugmeldungen sichten, Status setzen, Admin-Notiz hinterlegen.',
  async mount(container) {
    container.innerHTML = `<div class="panel-shell" style="background:#16161D;border:1px solid #2A2A33;border-radius:12px;padding:18px;color:#fff;">
      <div class="panel-head" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
        <h2 style="margin:0;font-size:18px;">Bug-Reports Triage</h2>
        <button class="refresh-btn" style="background:#8B5CF6;color:#fff;border:none;border-radius:12px;padding:8px 14px;cursor:pointer;font-size:13px;">Aktualisieren</button>
      </div>
      <div class="panel-body"><div class="loading" style="color:#8B5CF6;">Lädt…</div></div>
    </div>`

    const body = container.querySelector('.panel-body')

    const refresh = async () => {
      body.innerHTML = '<div class="loading" style="color:#8B5CF6;">Lädt…</div>'
      try {
        const { data, error } = await sb
          .from('bug_reports')
          .select('id,user_id,description,platform,app_version,status,admin_note,created_at,resolved_at')
          .order('created_at', { ascending: false })
          .limit(50)

        if (error) throw error

        const rows = data || []
        const total = rows.length
        const open = rows.filter((r) => !r.status || r.status === 'open' || r.status === 'new').length
        const resolved = rows.filter((r) => r.status === 'resolved' || r.resolved_at).length
        const withNote = rows.filter((r) => r.admin_note && String(r.admin_note).trim()).length

        const kpiHtml = `
          <div class="kpi-grid" style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px;">
            <div class="kpi-tile" style="background:#1E1E27;border:1px solid #2A2A33;border-radius:12px;padding:12px;">
              <div style="font-size:12px;color:#9CA3AF;">Gesamt (letzte 50)</div>
              <div style="font-size:22px;color:#fff;font-weight:600;">${total}</div>
              <div style="font-size:11px;color:#6B7280;">aktuell geladen</div>
            </div>
            <div class="kpi-tile" style="background:#1E1E27;border:1px solid #2A2A33;border-radius:12px;padding:12px;">
              <div style="font-size:12px;color:#9CA3AF;">Offen</div>
              <div style="font-size:22px;color:#8B5CF6;font-weight:600;">${open}</div>
              <div style="font-size:11px;color:#6B7280;">unbearbeitet</div>
            </div>
            <div class="kpi-tile" style="background:#1E1E27;border:1px solid #2A2A33;border-radius:12px;padding:12px;">
              <div style="font-size:12px;color:#9CA3AF;">Gelöst</div>
              <div style="font-size:22px;color:#fff;font-weight:600;">${resolved}</div>
              <div style="font-size:11px;color:#6B7280;">resolved</div>
            </div>
            <div class="kpi-tile" style="background:#1E1E27;border:1px solid #2A2A33;border-radius:12px;padding:12px;">
              <div style="font-size:12px;color:#9CA3AF;">Mit Admin-Notiz</div>
              <div style="font-size:22px;color:#fff;font-weight:600;">${withNote}</div>
              <div style="font-size:11px;color:#6B7280;">kommentiert</div>
            </div>
          </div>`

        const actionsHtml = `
          <div class="chips" style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;">
            ${ADMIN_ACTIONS.map((a) => `<button data-action="${a}" style="background:#1E1E27;border:1px solid #8B5CF6;color:#8B5CF6;border-radius:12px;padding:8px 14px;cursor:pointer;font-size:13px;">${escapeHtml(a)}</button>`).join('')}
          </div>`

        const formHtml = `
          <form class="triage-form" style="background:#1E1E27;border:1px solid #2A2A33;border-radius:12px;padding:14px;margin-bottom:16px;">
            <div style="font-size:13px;color:#9CA3AF;margin-bottom:10px;">Schnell-Triage</div>
            <div style="display:grid;grid-template-columns:1fr 1fr 2fr auto;gap:8px;align-items:center;">
              <input name="bug_id" placeholder="Bug-ID" style="background:#16161D;border:1px solid #2A2A33;border-radius:12px;padding:8px 10px;color:#fff;font-size:13px;" />
              <select name="status" style="background:#16161D;border:1px solid #2A2A33;border-radius:12px;padding:8px 10px;color:#fff;font-size:13px;">
                <option value="open">open</option>
                <option value="in_progress">in_progress</option>
                <option value="resolved">resolved</option>
                <option value="wontfix">wontfix</option>
              </select>
              <input name="admin_note" placeholder="Admin-Notiz…" style="background:#16161D;border:1px solid #2A2A33;border-radius:12px;padding:8px 10px;color:#fff;font-size:13px;" />
              <button type="submit" style="background:#8B5CF6;color:#fff;border:none;border-radius:12px;padding:8px 14px;cursor:pointer;font-size:13px;">Speichern</button>
            </div>
          </form>`

        const tableHtml = rows.length
          ? `<div style="overflow-x:auto;">
              <table class="data-table" style="width:100%;border-collapse:collapse;font-size:13px;">
                <thead>
                  <tr style="text-align:left;color:#9CA3AF;border-bottom:1px solid #2A2A33;">
                    <th style="padding:8px;">ID</th>
                    <th style="padding:8px;">Beschreibung</th>
                    <th style="padding:8px;">Plattform</th>
                    <th style="padding:8px;">Version</th>
                    <th style="padding:8px;">Status</th>
                    <th style="padding:8px;">Notiz</th>
                    <th style="padding:8px;">Erstellt</th>
                  </tr>
                </thead>
                <tbody>
                  ${rows.map((r) => `
                    <tr style="border-bottom:1px solid #2A2A33;">
                      <td style="padding:8px;color:#8B5CF6;font-family:monospace;">${escapeHtml(String(r.id).slice(0, 8))}</td>
                      <td style="padding:8px;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(r.description)}</td>
                      <td style="padding:8px;">${escapeHtml(r.platform)}</td>
                      <td style="padding:8px;">${escapeHtml(r.app_version)}</td>
                      <td style="padding:8px;">${escapeHtml(r.status || 'open')}</td>
                      <td style="padding:8px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(r.admin_note || '')}</td>
                      <td style="padding:8px;color:#9CA3AF;">${r.created_at ? new Date(r.created_at).toLocaleString('de-DE') : ''}</td>
                    </tr>`).join('')}
                </tbody>
              </table>
            </div>`
          : '<div class="empty" style="color:#9CA3AF;padding:20px;text-align:center;">Keine Bug-Reports gefunden.</div>'

        body.innerHTML = kpiHtml + actionsHtml + formHtml + tableHtml

        body.querySelectorAll('button[data-action]').forEach((btn) => {
          btn.addEventListener('click', (e) => {
            e.preventDefault()
            showToast(container, 'Aktion: ' + btn.getAttribute('data-action'))
          })
        })

        const form = body.querySelector('.triage-form')
        if (form) {
          form.addEventListener('submit', (e) => {
            e.preventDefault()
            showToast(container, 'Aktion: triage_submit (Stub)')
          })
        }
      } catch (e) {
        body.innerHTML = '<div class="empty" style="color:#9CA3AF;padding:20px;text-align:center;">Daten kommen bald: ' + escapeHtml(e?.message || 'unbekannt') + '</div>'
      }
    }

    container.querySelector('.refresh-btn').addEventListener('click', refresh)
    await refresh()
  }
}
