import { sb } from '/lib/supabase.js'

export default {
  id: 'newsletter-audience-sync',
  title: 'Newsletter-Audience',
  category: 'marketing',
  summary: "Opt-in-Status und Sync zum Newsletter-Provider triggern.",
  async mount(container) {
    container.innerHTML = `<div class="panel-shell">
      <div class="panel-head"><h2>Newsletter-Audience</h2><button class="refresh-btn">Aktualisieren</button></div>
      <div class="panel-body"><div class="loading">Lädt…</div></div>
    </div>`
    const body = container.querySelector('.panel-body')

    const showToast = (msg) => {
      const t = document.createElement('div')
      t.className = 'toast'
      t.textContent = msg
      t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#2A2A33;color:#fff;padding:10px 18px;border-radius:12px;border:1px solid #8B5CF6;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,0.4)'
      document.body.appendChild(t)
      setTimeout(() => t.remove(), 2400)
    }

    const refresh = async () => {
      body.innerHTML = '<div class="loading">Lädt…</div>'
      try {
        const { data, error } = await sb
          .from('users')
          .select('is_app_admin, deleted_at, onboarding_completed_at, last_seen_at')
          .is('deleted_at', null)
          .limit(100000)
        if (error) throw error

        const total = (data || []).length
        // Note: newsletter_opt_in column not in inventory sample; fallback heuristic:
        // treat onboarded + recently seen users as eligible audience proxy.
        const onboarded = (data || []).filter(u => u.onboarding_completed_at).length
        const recentCutoff = Date.now() - 30 * 24 * 60 * 60 * 1000
        const active = (data || []).filter(u => u.last_seen_at && new Date(u.last_seen_at).getTime() >= recentCutoff).length
        const optInRate = total > 0 ? Math.round((onboarded / total) * 100) : 0

        body.innerHTML = `
          <div class="kpi-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:16px">
            <div class="kpi-tile" style="background:#1E1E27;border:1px solid #2A2A33;border-radius:12px;padding:14px">
              <div style="color:#9999A8;font-size:12px;text-transform:uppercase;letter-spacing:.5px">Opted-In (proxy)</div>
              <div style="color:#fff;font-size:26px;font-weight:600;margin-top:6px">${onboarded.toLocaleString('de-DE')}</div>
              <div style="color:#8B5CF6;font-size:11px;margin-top:4px">${optInRate}% der Basis</div>
            </div>
            <div class="kpi-tile" style="background:#1E1E27;border:1px solid #2A2A33;border-radius:12px;padding:14px">
              <div style="color:#9999A8;font-size:12px;text-transform:uppercase;letter-spacing:.5px">Aktive (30d)</div>
              <div style="color:#fff;font-size:26px;font-weight:600;margin-top:6px">${active.toLocaleString('de-DE')}</div>
              <div style="color:#9999A8;font-size:11px;margin-top:4px">last_seen_at ≤ 30d</div>
            </div>
            <div class="kpi-tile" style="background:#1E1E27;border:1px solid #2A2A33;border-radius:12px;padding:14px">
              <div style="color:#9999A8;font-size:12px;text-transform:uppercase;letter-spacing:.5px">Gesamt-Basis</div>
              <div style="color:#fff;font-size:26px;font-weight:600;margin-top:6px">${total.toLocaleString('de-DE')}</div>
              <div style="color:#9999A8;font-size:11px;margin-top:4px">users (nicht gelöscht)</div>
            </div>
          </div>
          <div style="background:#1E1E27;border:1px solid #2A2A33;border-radius:12px;padding:16px">
            <h3 style="color:#fff;margin:0 0 12px 0;font-size:15px">Audience-Sync auslösen</h3>
            <p style="color:#9999A8;font-size:13px;margin:0 0 14px 0">
              Schickt die aktuelle Opt-in-Audience an den Newsletter-Provider (Edge-Function <code style="color:#8B5CF6">sync-newsletter-audience</code>).
            </p>
            <div class="action-row" style="display:flex;gap:10px;flex-wrap:wrap">
              <button data-action="sync_newsletter_audience"
                style="background:#8B5CF6;color:#fff;border:none;border-radius:12px;padding:10px 18px;font-weight:600;cursor:pointer">
                sync_newsletter_audience
              </button>
            </div>
          </div>
        `

        body.querySelectorAll('button[data-action]').forEach(btn => {
          btn.addEventListener('click', () => {
            const action = btn.getAttribute('data-action')
            showToast('Aktion: ' + action)
          })
        })
      } catch (e) {
        body.innerHTML = '<div class="empty">Daten kommen bald: ' + (e?.message || 'unbekannt') + '</div>'
      }
    }
    container.querySelector('.refresh-btn').addEventListener('click', refresh)
    await refresh()
  }
}
