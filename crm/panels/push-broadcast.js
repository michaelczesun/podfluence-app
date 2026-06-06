import { sb } from '/lib/supabase.js'

export default {
  id: 'push-broadcast',
  title: 'Push-Broadcast senden',
  category: 'admin_actions',
  summary: 'Push-Nachricht an Zielgruppe via send-push.',
  async mount(container) {
    container.innerHTML = `<div class="panel-shell">
      <div class="panel-head"><h2>Push-Broadcast senden</h2><button class="refresh-btn">Aktualisieren</button></div>
      <div class="panel-body"><div class="loading">Lädt…</div></div>
    </div>`
    const body = container.querySelector('.panel-body')

    const showToast = (msg) => {
      const toast = document.createElement('div')
      toast.className = 'toast'
      toast.textContent = msg
      toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#8B5CF6;color:#fff;padding:12px 20px;border-radius:12px;z-index:9999;box-shadow:0 6px 20px rgba(0,0,0,0.4);'
      document.body.appendChild(toast)
      setTimeout(() => toast.remove(), 2400)
    }

    const refresh = async () => {
      body.innerHTML = '<div class="loading">Lädt…</div>'
      try {
        // KPIs zur Zielgruppe laden
        const [totalRes, podcasterRes, listenerRes, premiumRes, verifiedRes] = await Promise.all([
          sb.from('users').select('id', { count: 'exact', head: true }).is('deleted_at', null),
          sb.from('users').select('id', { count: 'exact', head: true }).eq('type', 'podcaster').is('deleted_at', null),
          sb.from('users').select('id', { count: 'exact', head: true }).eq('type', 'listener').is('deleted_at', null),
          sb.from('users').select('id', { count: 'exact', head: true }).eq('is_premium', true).is('deleted_at', null),
          sb.from('users').select('id', { count: 'exact', head: true }).eq('is_verified', true).is('deleted_at', null),
        ])

        const total = totalRes.count ?? 0
        const podcasters = podcasterRes.count ?? 0
        const listeners = listenerRes.count ?? 0
        const premium = premiumRes.count ?? 0
        const verified = verifiedRes.count ?? 0

        // Regionen aus users sample ziehen (für Region-Select)
        const { data: regionRows } = await sb
          .from('users')
          .select('region')
          .not('region', 'is', null)
          .limit(500)
        const regions = Array.from(new Set((regionRows || []).map(r => r.region).filter(Boolean))).sort()

        body.innerHTML = `
          <div class="kpi-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:16px;">
            <div class="kpi-tile" style="background:#1E1E26;border:1px solid #2A2A33;border-radius:12px;padding:14px;">
              <div style="font-size:11px;color:#9CA3AF;text-transform:uppercase;letter-spacing:0.5px;">Gesamt</div>
              <div style="font-size:24px;color:#fff;font-weight:700;margin-top:4px;">${total.toLocaleString('de-DE')}</div>
              <div style="font-size:11px;color:#6B7280;margin-top:2px;">aktive User</div>
            </div>
            <div class="kpi-tile" style="background:#1E1E26;border:1px solid #2A2A33;border-radius:12px;padding:14px;">
              <div style="font-size:11px;color:#9CA3AF;text-transform:uppercase;letter-spacing:0.5px;">Podcaster</div>
              <div style="font-size:24px;color:#8B5CF6;font-weight:700;margin-top:4px;">${podcasters.toLocaleString('de-DE')}</div>
              <div style="font-size:11px;color:#6B7280;margin-top:2px;">Typ podcaster</div>
            </div>
            <div class="kpi-tile" style="background:#1E1E26;border:1px solid #2A2A33;border-radius:12px;padding:14px;">
              <div style="font-size:11px;color:#9CA3AF;text-transform:uppercase;letter-spacing:0.5px;">Listener</div>
              <div style="font-size:24px;color:#fff;font-weight:700;margin-top:4px;">${listeners.toLocaleString('de-DE')}</div>
              <div style="font-size:11px;color:#6B7280;margin-top:2px;">Typ listener</div>
            </div>
            <div class="kpi-tile" style="background:#1E1E26;border:1px solid #2A2A33;border-radius:12px;padding:14px;">
              <div style="font-size:11px;color:#9CA3AF;text-transform:uppercase;letter-spacing:0.5px;">Premium</div>
              <div style="font-size:24px;color:#8B5CF6;font-weight:700;margin-top:4px;">${premium.toLocaleString('de-DE')}</div>
              <div style="font-size:11px;color:#6B7280;margin-top:2px;">is_premium</div>
            </div>
            <div class="kpi-tile" style="background:#1E1E26;border:1px solid #2A2A33;border-radius:12px;padding:14px;">
              <div style="font-size:11px;color:#9CA3AF;text-transform:uppercase;letter-spacing:0.5px;">Verifiziert</div>
              <div style="font-size:24px;color:#fff;font-weight:700;margin-top:4px;">${verified.toLocaleString('de-DE')}</div>
              <div style="font-size:11px;color:#6B7280;margin-top:2px;">is_verified</div>
            </div>
          </div>

          <form class="broadcast-form" style="background:#1E1E26;border:1px solid #2A2A33;border-radius:12px;padding:18px;display:flex;flex-direction:column;gap:14px;">
            <h3 style="margin:0 0 4px 0;color:#fff;font-size:16px;">Zielgruppe wählen</h3>

            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;">
              <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;color:#9CA3AF;">
                <span>Typ</span>
                <select name="type" style="background:#16161D;color:#fff;border:1px solid #2A2A33;border-radius:8px;padding:10px;font-size:14px;">
                  <option value="">Alle</option>
                  <option value="podcaster">Podcaster</option>
                  <option value="listener">Listener</option>
                </select>
              </label>

              <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;color:#9CA3AF;">
                <span>Region</span>
                <select name="region" style="background:#16161D;color:#fff;border:1px solid #2A2A33;border-radius:8px;padding:10px;font-size:14px;">
                  <option value="">Alle Regionen</option>
                  ${regions.map(r => `<option value="${r}">${r}</option>`).join('')}
                </select>
              </label>

              <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;color:#9CA3AF;">
                <span>Premium</span>
                <select name="is_premium" style="background:#16161D;color:#fff;border:1px solid #2A2A33;border-radius:8px;padding:10px;font-size:14px;">
                  <option value="">Alle</option>
                  <option value="true">Nur Premium</option>
                  <option value="false">Nur Free</option>
                </select>
              </label>

              <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;color:#9CA3AF;">
                <span>Verifiziert</span>
                <select name="is_verified" style="background:#16161D;color:#fff;border:1px solid #2A2A33;border-radius:8px;padding:10px;font-size:14px;">
                  <option value="">Alle</option>
                  <option value="true">Nur verifiziert</option>
                  <option value="false">Nur unverifiziert</option>
                </select>
              </label>
            </div>

            <h3 style="margin:8px 0 4px 0;color:#fff;font-size:16px;">Push-Inhalt</h3>

            <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;color:#9CA3AF;">
              <span>Titel</span>
              <input name="title" type="text" maxlength="60" placeholder="z.B. Neue Episode entdeckt" style="background:#16161D;color:#fff;border:1px solid #2A2A33;border-radius:8px;padding:10px;font-size:14px;" />
            </label>

            <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;color:#9CA3AF;">
              <span>Nachricht</span>
              <textarea name="message" rows="3" maxlength="200" placeholder="Kurzer Body…" style="background:#16161D;color:#fff;border:1px solid #2A2A33;border-radius:8px;padding:10px;font-size:14px;resize:vertical;"></textarea>
            </label>

            <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;color:#9CA3AF;">
              <span>Deeplink (optional)</span>
              <input name="deeplink" type="text" placeholder="podfluence://feed" style="background:#16161D;color:#fff;border:1px solid #2A2A33;border-radius:8px;padding:10px;font-size:14px;" />
            </label>

            <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:6px;">
              <button type="button" class="action-btn" data-action="send_broadcast" style="background:#8B5CF6;color:#fff;border:none;border-radius:12px;padding:12px 20px;font-size:14px;font-weight:600;cursor:pointer;">Broadcast senden</button>
            </div>

            <div style="font-size:11px;color:#6B7280;margin-top:4px;">Ruft Edge Function <code style="color:#8B5CF6;">send-push</code> mit Filter-Kriterien aus users auf.</div>
          </form>
        `

        body.querySelectorAll('.action-btn').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.preventDefault()
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
