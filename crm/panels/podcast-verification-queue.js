import { sb } from '/lib/supabase.js'

export default {
  id: 'podcast-verification-queue',
  title: 'Podcast-Verifizierung',
  category: 'admin_actions',
  summary: "Offene RSS-Owner-Verifizierungen prüfen und Mail erneut senden.",
  async mount(container) {
    container.innerHTML = `<div class="panel-shell">
      <div class="panel-head"><h2>Podcast-Verifizierung</h2><button class="refresh-btn">Aktualisieren</button></div>
      <div class="panel-body"><div class="loading">Lädt…</div></div>
    </div>`
    const body = container.querySelector('.panel-body')

    const showToast = (msg) => {
      const t = document.createElement('div')
      t.className = 'toast'
      t.textContent = msg
      Object.assign(t.style, {
        position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
        background: '#8B5CF6', color: 'white', padding: '10px 18px', borderRadius: '12px',
        zIndex: 9999, boxShadow: '0 4px 16px rgba(0,0,0,.4)'
      })
      document.body.appendChild(t)
      setTimeout(() => t.remove(), 2200)
    }

    const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]))

    const refresh = async () => {
      body.innerHTML = '<div class="loading">Lädt…</div>'
      try {
        const { data, error } = await sb
          .from('podcast_verifications')
          .select('id, podcast_id, user_id, rss_url, owner_email, code, expires_at, created_at, podcasts(host_display_name)')
          .gt('expires_at', new Date().toISOString())
          .order('created_at', { ascending: false })
          .limit(100)

        if (error) throw error

        const rows = data || []
        const total = rows.length
        const now = Date.now()
        const expiringSoon = rows.filter(r => new Date(r.expires_at).getTime() - now < 24 * 3600 * 1000).length
        const uniquePodcasts = new Set(rows.map(r => r.podcast_id)).size

        const kpis = `
          <div class="kpi-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:16px;">
            <div class="kpi-tile" style="background:#16161D;border:1px solid #2A2A33;border-radius:12px;padding:14px;">
              <div style="color:#8B5CF6;font-size:11px;text-transform:uppercase;letter-spacing:.5px;">Offen gesamt</div>
              <div style="color:white;font-size:24px;font-weight:600;margin-top:4px;">${total}</div>
              <div style="color:#888;font-size:11px;">aktive Codes</div>
            </div>
            <div class="kpi-tile" style="background:#16161D;border:1px solid #2A2A33;border-radius:12px;padding:14px;">
              <div style="color:#8B5CF6;font-size:11px;text-transform:uppercase;letter-spacing:.5px;">Bald abgelaufen</div>
              <div style="color:white;font-size:24px;font-weight:600;margin-top:4px;">${expiringSoon}</div>
              <div style="color:#888;font-size:11px;">&lt; 24h verbleibend</div>
            </div>
            <div class="kpi-tile" style="background:#16161D;border:1px solid #2A2A33;border-radius:12px;padding:14px;">
              <div style="color:#8B5CF6;font-size:11px;text-transform:uppercase;letter-spacing:.5px;">Podcasts</div>
              <div style="color:white;font-size:24px;font-weight:600;margin-top:4px;">${uniquePodcasts}</div>
              <div style="color:#888;font-size:11px;">eindeutig</div>
            </div>
          </div>`

        const actions = `
          <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;">
            <button class="action-btn" data-action="resend_verification_mail" style="background:#8B5CF6;color:white;border:none;border-radius:12px;padding:10px 16px;cursor:pointer;font-weight:500;">Mail erneut senden</button>
            <button class="action-btn" data-action="force_verify_owner" style="background:#2A2A33;color:white;border:1px solid #2A2A33;border-radius:12px;padding:10px 16px;cursor:pointer;font-weight:500;">Owner force-verifizieren</button>
          </div>`

        let tableHtml
        if (!rows.length) {
          tableHtml = '<div class="empty" style="padding:24px;text-align:center;color:#888;">Keine offenen Verifizierungen.</div>'
        } else {
          tableHtml = `
            <table class="data-table" style="width:100%;border-collapse:collapse;background:#16161D;border:1px solid #2A2A33;border-radius:12px;overflow:hidden;">
              <thead>
                <tr style="background:#1f1f28;">
                  <th style="text-align:left;padding:10px;color:#8B5CF6;font-size:11px;text-transform:uppercase;">Podcast</th>
                  <th style="text-align:left;padding:10px;color:#8B5CF6;font-size:11px;text-transform:uppercase;">Owner-Mail</th>
                  <th style="text-align:left;padding:10px;color:#8B5CF6;font-size:11px;text-transform:uppercase;">Code</th>
                  <th style="text-align:left;padding:10px;color:#8B5CF6;font-size:11px;text-transform:uppercase;">Läuft ab</th>
                  <th style="text-align:left;padding:10px;color:#8B5CF6;font-size:11px;text-transform:uppercase;">Aktion</th>
                </tr>
              </thead>
              <tbody>
                ${rows.map(r => {
                  const name = r.podcasts?.host_display_name || '—'
                  const exp = new Date(r.expires_at)
                  const expStr = exp.toLocaleString('de-DE')
                  return `<tr style="border-top:1px solid #2A2A33;">
                    <td style="padding:10px;color:white;">${escapeHtml(name)}</td>
                    <td style="padding:10px;color:#ccc;">${escapeHtml(r.owner_email || '—')}</td>
                    <td style="padding:10px;color:#ccc;font-family:monospace;">${escapeHtml(r.code || '')}</td>
                    <td style="padding:10px;color:#ccc;">${escapeHtml(expStr)}</td>
                    <td style="padding:10px;">
                      <button class="row-resend" data-id="${escapeHtml(r.id)}" style="background:#8B5CF6;color:white;border:none;border-radius:8px;padding:6px 12px;cursor:pointer;font-size:12px;margin-right:4px;">Resend</button>
                      <button class="row-force" data-id="${escapeHtml(r.id)}" style="background:#2A2A33;color:white;border:1px solid #2A2A33;border-radius:8px;padding:6px 12px;cursor:pointer;font-size:12px;">Force</button>
                    </td>
                  </tr>`
                }).join('')}
              </tbody>
            </table>`
        }

        body.innerHTML = kpis + actions + tableHtml

        body.querySelectorAll('.action-btn').forEach(btn => {
          btn.addEventListener('click', () => showToast('Aktion: ' + btn.dataset.action))
        })
        body.querySelectorAll('.row-resend').forEach(btn => {
          btn.addEventListener('click', () => showToast('Aktion: resend_verification_mail (' + btn.dataset.id + ')'))
        })
        body.querySelectorAll('.row-force').forEach(btn => {
          btn.addEventListener('click', () => showToast('Aktion: force_verify_owner (' + btn.dataset.id + ')'))
        })
      } catch (e) {
        body.innerHTML = '<div class="empty">Daten kommen bald: ' + (e?.message || 'unbekannt') + '</div>'
      }
    }
    container.querySelector('.refresh-btn').addEventListener('click', refresh)
    await refresh()
  }
}
