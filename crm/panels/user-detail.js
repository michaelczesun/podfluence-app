// /crm/panels/user-detail.js
// Voll-funktionale Admin-Aktionen-Modal für einen User.
// Sektionen: Header · Rolle · Status (Verified/Premium) · Moderation (Ban/Unban) · Reset · Footer-Stats.
//
// Export: showUserDetailV2(userId) -> Promise<void>
//
// Style: glassmorph, max-width 480px, mobile-fullscreen.
// KAV: Modal-Container ist visualViewport-aware — Buttons bleiben über der Tastatur sichtbar
// (Memory-Regel: TextInputs in Modals niemals hinter Tastatur).
// Close: X-Button, Escape, Backdrop-Click.

import { sb } from '/lib/supabase.js?v=20260608l'
import { toast, htmlEscape } from '/lib/ui.js?v=20260608l'
import { openModal } from '/crm/lib/modal.js?v=20260608l'

// ---------------------------------------------------------------------------
// One-time style injection
// ---------------------------------------------------------------------------
const STYLE_ID = '__pf_user_detail_v2_styles__'
function injectStyles() {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID)) return
  const s = document.createElement('style')
  s.id = STYLE_ID
  s.textContent = `
  .udv2-overlay {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.62);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
    display: flex; align-items: center; justify-content: center;
    z-index: 10050;
    animation: udv2FadeIn .18s ease-out;
    padding: 16px;
    box-sizing: border-box;
  }
  .udv2-modal {
    width: 480px;
    max-width: 100%;
    max-height: calc(100vh - 32px);
    /* KAV: dynamisch via visualViewport.height begrenzt — JS pflegt --udv2-vh */
    max-height: var(--udv2-vh, calc(100vh - 32px));
    background: rgba(22,22,29,0.82);
    backdrop-filter: blur(22px) saturate(160%);
    -webkit-backdrop-filter: blur(22px) saturate(160%);
    border: 1px solid rgba(139,92,246,0.22);
    border-radius: 18px;
    box-shadow: 0 24px 70px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04) inset;
    display: flex; flex-direction: column;
    overflow: hidden;
    color: #E4E4E7;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", system-ui, sans-serif;
    animation: udv2SlideUp .22s cubic-bezier(.2,.8,.2,1);
  }
  @media (max-width: 560px) {
    .udv2-overlay { padding: 0; }
    .udv2-modal {
      width: 100%; height: 100vh; max-height: var(--udv2-vh, 100vh);
      border-radius: 0;
      border-left: none; border-right: none; border-bottom: none;
    }
  }

  .udv2-header {
    display: flex; align-items: center; gap: 14px;
    padding: 18px 20px;
    border-bottom: 1px solid rgba(255,255,255,0.06);
    background: linear-gradient(180deg, rgba(139,92,246,0.08), transparent);
  }
  .udv2-avatar {
    width: 56px; height: 56px; border-radius: 50%;
    object-fit: cover; background: #2A2A33;
    border: 1px solid rgba(255,255,255,0.08);
    flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    font-size: 22px; color: #9CA3AF; font-weight: 600;
  }
  .udv2-header-text { flex: 1; min-width: 0; }
  .udv2-name {
    font-size: 17px; font-weight: 700; color: #fff;
    display: flex; align-items: center; gap: 6px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .udv2-badge { font-size: 11px; padding: 2px 6px; border-radius: 10px; font-weight: 600; }
  .udv2-badge.verified { background: rgba(62,166,255,0.18); color: #7CC2FF; }
  .udv2-badge.premium { background: rgba(241,196,15,0.18); color: #F1C40F; }
  .udv2-badge.banned { background: rgba(248,113,113,0.18); color: #F87171; }
  .udv2-meta { font-size: 12px; color: #9CA3AF; margin-top: 2px; }
  .udv2-meta a { color: #A78BFA; }
  .udv2-close {
    background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.08);
    color: #E4E4E7; width: 32px; height: 32px; border-radius: 10px;
    font-size: 18px; line-height: 1; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: all .15s;
  }
  .udv2-close:hover { background: rgba(248,113,113,0.18); border-color: rgba(248,113,113,0.4); color: #F87171; }

  .udv2-body {
    flex: 1; overflow-y: auto; -webkit-overflow-scrolling: touch;
    padding: 16px 20px 20px;
    display: flex; flex-direction: column; gap: 18px;
  }
  .udv2-section {
    background: rgba(255,255,255,0.025);
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 14px;
    padding: 14px 16px;
  }
  .udv2-section-title {
    font-size: 11px; text-transform: uppercase; letter-spacing: 1.2px;
    color: #9CA3AF; font-weight: 600;
    margin: 0 0 10px;
    display: flex; align-items: center; gap: 6px;
  }
  .udv2-row {
    display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  }
  .udv2-row + .udv2-row { margin-top: 10px; }
  .udv2-select, .udv2-input, .udv2-date {
    background: #0F0F14; color: #E4E4E7;
    border: 1px solid #2A2A33; border-radius: 10px;
    padding: 9px 12px; font-size: 13px; outline: none;
    transition: border-color .12s;
    font-family: inherit;
    flex: 1; min-width: 0;
  }
  .udv2-select:focus, .udv2-input:focus, .udv2-date:focus,
  .udv2-textarea:focus { border-color: #8B5CF6; }
  .udv2-textarea {
    background: #0F0F14; color: #E4E4E7;
    border: 1px solid #2A2A33; border-radius: 10px;
    padding: 9px 12px; font-size: 13px; outline: none;
    font-family: inherit; width: 100%; box-sizing: border-box;
    resize: vertical; min-height: 70px;
  }
  .udv2-check {
    display: inline-flex; align-items: center; gap: 8px;
    font-size: 13px; color: #E4E4E7; cursor: pointer;
    user-select: none;
  }
  .udv2-check input { width: 16px; height: 16px; accent-color: #8B5CF6; cursor: pointer; }

  .udv2-btn {
    background: rgba(255,255,255,0.06);
    color: #E4E4E7; border: 1px solid rgba(255,255,255,0.1);
    border-radius: 10px; padding: 9px 14px;
    font-size: 13px; font-weight: 500;
    cursor: pointer; transition: all .15s;
    display: inline-flex; align-items: center; gap: 6px;
    font-family: inherit;
    white-space: nowrap;
  }
  .udv2-btn:hover:not(:disabled) {
    background: rgba(139,92,246,0.15); border-color: rgba(139,92,246,0.4);
  }
  .udv2-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .udv2-btn.primary {
    background: linear-gradient(135deg, #8B5CF6, #7C3AED);
    border-color: transparent; color: #fff;
  }
  .udv2-btn.primary:hover:not(:disabled) { filter: brightness(1.1); }
  .udv2-btn.danger { color: #F87171; border-color: rgba(248,113,113,0.35); }
  .udv2-btn.danger:hover:not(:disabled) {
    background: rgba(248,113,113,0.15); border-color: rgba(248,113,113,0.55);
  }
  .udv2-btn.success { color: #34D399; border-color: rgba(52,211,153,0.35); }
  .udv2-btn.success:hover:not(:disabled) {
    background: rgba(52,211,153,0.12); border-color: rgba(52,211,153,0.55);
  }
  .udv2-btn .udv2-spinner {
    width: 12px; height: 12px;
    border: 2px solid rgba(255,255,255,0.25); border-top-color: #fff;
    border-radius: 50%; animation: udv2Spin .8s linear infinite;
  }
  @keyframes udv2Spin { to { transform: rotate(360deg); } }

  .udv2-footer {
    border-top: 1px solid rgba(255,255,255,0.06);
    padding: 12px 20px;
    display: flex; align-items: center; justify-content: space-between;
    gap: 12px; font-size: 12px; color: #9CA3AF;
    background: rgba(11,11,15,0.4);
    flex-wrap: wrap;
  }
  .udv2-stats { display: flex; gap: 14px; flex-wrap: wrap; }
  .udv2-stats b { color: #E4E4E7; font-weight: 600; }

  .udv2-skeleton {
    height: 14px; background: linear-gradient(90deg, rgba(255,255,255,.03), rgba(255,255,255,.09), rgba(255,255,255,.03));
    background-size: 200% 100%; animation: udv2Shimmer 1.4s infinite;
    border-radius: 6px;
  }
  @keyframes udv2Shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
  @keyframes udv2FadeIn { from { opacity: 0; } to { opacity: 1; } }
  @keyframes udv2SlideUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
  `
  document.head.appendChild(s)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const esc = (s) => htmlEscape(s == null ? '' : String(s))
function fmtDate(d) {
  if (!d) return '–'
  try { return new Date(d).toLocaleString('de-DE') } catch { return String(d) }
}
function fmtRelative(d) {
  if (!d) return '–'
  const t = new Date(d).getTime()
  if (isNaN(t)) return '–'
  const diff = Math.round((Date.now() - t) / 1000)
  if (diff < 60) return 'gerade eben'
  if (diff < 3600) return `vor ${Math.floor(diff/60)} Min`
  if (diff < 86400) return `vor ${Math.floor(diff/3600)} Std`
  if (diff < 86400*30) return `vor ${Math.floor(diff/86400)} Tagen`
  return fmtDate(d)
}
function toDateInputValue(d) {
  if (!d) return ''
  const dt = new Date(d)
  if (isNaN(dt.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())}`
}
function daysUntil(dateStr) {
  if (!dateStr) return 0
  const target = new Date(dateStr + 'T23:59:59')
  if (isNaN(target.getTime())) return 0
  const ms = target.getTime() - Date.now()
  return Math.max(1, Math.ceil(ms / 86400000))
}

async function rpc(name, args = {}) {
  const { data, error } = await sb.rpc(name, args)
  if (error) {
    console.error(`[user-detail-v2] RPC ${name} failed`, error)
    throw error
  }
  return data
}

// ---------------------------------------------------------------------------
// Sub-Modal: Ban (Reason + bis-Datum)
// ---------------------------------------------------------------------------
function showBanModal(currentUser) {
  // Sub-Modal "User bannen" — zentralisierte Modal-Lib.
  return new Promise((resolve) => {
    const body = document.createElement('div')
    body.innerHTML = `
      <div class="udv2-section">
        <div class="udv2-section-title">Grund</div>
        <textarea class="udv2-textarea" id="ban-reason" rows="3" placeholder="z.B. Spam, Hate-Speech, ToS-Verstoß …"></textarea>
      </div>
      <div class="udv2-section">
        <div class="udv2-section-title">Bann bis (optional)</div>
        <div class="udv2-row">
          <input type="date" class="udv2-date" id="ban-until" />
          <button class="udv2-btn" data-act="clear-until" type="button">Permanent</button>
        </div>
      </div>
    `
    body.querySelector('[data-act="clear-until"]').addEventListener('click', () => {
      const inp = body.querySelector('#ban-until')
      if (inp) inp.value = ''
    })

    let settled = false
    const settle = (v) => { if (!settled) { settled = true; resolve(v) } }

    openModal({
      title: `User bannen · @${esc(currentUser.username || '–')}`,
      body,
      width: 420,
      onClose: () => settle(null),
      footerActions: [
        { label: 'Abbrechen', variant: 'ghost', onClick: () => settle(null) },
        {
          label: 'User bannen',
          variant: 'danger',
          closeOnClick: false,
          onClick: (api) => {
            const reason = (body.querySelector('#ban-reason')?.value || '').trim()
            if (!reason) { toast('Bitte Grund angeben.', 'error'); return }
            const until = body.querySelector('#ban-until')?.value || null
            settle({ reason, until })
            api.close(true)
          }
        }
      ]
    })
  })
}

// ---------------------------------------------------------------------------
// Main: showUserDetailV2
// ---------------------------------------------------------------------------
const ROLE_OPTIONS = ['owner', 'admin', 'manager', 'support', 'mod', 'marketing', 'member', 'none']

export async function showUserDetailV2(userId) {
  if (!userId) throw new Error('userId required')
  injectStyles()

  // ----- Modal via zentralisierte Lib (Escape/Backdrop/KAV/Focus-Trap/Scroll-Lock) -----
  // Wir nutzen noHeader: das ursprüngliche udv2-Layout liefert eigene Header-Struktur
  // im selben Element, das vorher ".udv2-modal" hieß. modalEl ist hier der card-Container.
  const modalApi = openModal({
    body: `
      <div class="udv2-header">
        <div class="udv2-avatar">…</div>
        <div class="udv2-header-text" style="flex:1;">
          <div class="udv2-skeleton" style="width:60%;margin-bottom:6px;"></div>
          <div class="udv2-skeleton" style="width:40%;height:10px;"></div>
        </div>
        <button class="udv2-close" data-act="close" aria-label="Schließen">&times;</button>
      </div>
      <div class="udv2-body">
        <div class="udv2-skeleton" style="height:90px;"></div>
        <div class="udv2-skeleton" style="height:60px;"></div>
        <div class="udv2-skeleton" style="height:60px;"></div>
      </div>
    `,
    width: 480,
    noHeader: true,
    className: 'udv2-modal'
  })
  const modalEl = modalApi.body // alle Selektoren laufen weiter über modalEl
  const close = () => modalApi.close(true)
  // X-Button im skeleton wiring
  modalEl.querySelector('[data-act="close"]')?.addEventListener('click', close)

  // ----- Daten laden -----
  let u
  try {
    const res = await rpc('admin_get_user_full', { p_user_id: userId })
    u = Array.isArray(res) ? res[0] : res
  } catch (e) {
    toast(`User konnte nicht geladen werden: ${e.message || e}`, 'error')
    close()
    return
  }
  if (!u) {
    toast('User nicht gefunden.', 'error')
    close()
    return
  }

  // ----- Render full UI -----
  const avatarHtml = u.avatar_url
    ? `<img class="udv2-avatar" src="${esc(u.avatar_url)}" alt="" />`
    : `<div class="udv2-avatar">${esc(((u.display_name || u.username || '?')[0] || '?').toUpperCase())}</div>`

  const badges = []
  if (u.is_verified) badges.push('<span class="udv2-badge verified">Verified</span>')
  if (u.is_premium) badges.push('<span class="udv2-badge premium">Premium</span>')
  if (u.is_banned) badges.push('<span class="udv2-badge banned">Banned</span>')

  const currentRole = (u.role || 'none').toLowerCase()
  const roleOptionsHtml = ROLE_OPTIONS
    .map(r => `<option value="${r}" ${r === currentRole ? 'selected' : ''}>${r}</option>`)
    .join('')

  modalEl.innerHTML = `
    <div class="udv2-header">
      ${avatarHtml}
      <div class="udv2-header-text">
        <div class="udv2-name">
          ${esc(u.display_name || u.username || 'Unbenannt')}
          ${badges.join('')}
        </div>
        <div class="udv2-meta">
          @${esc(u.username || '–')} · ${esc(u.email || '–')}
        </div>
      </div>
      <button class="udv2-close" data-act="close" aria-label="Schließen">&times;</button>
    </div>

    <div class="udv2-body">
      <!-- ROLLE -->
      <div class="udv2-section">
        <div class="udv2-section-title">Rolle</div>
        <div class="udv2-row">
          <select class="udv2-select" id="udv2-role">${roleOptionsHtml}</select>
          <button class="udv2-btn primary" data-act="save-role">Speichern</button>
        </div>
      </div>

      <!-- STATUS -->
      <div class="udv2-section">
        <div class="udv2-section-title">Status</div>
        <div class="udv2-row">
          <label class="udv2-check">
            <input type="checkbox" id="udv2-verified" ${u.is_verified ? 'checked' : ''}>
            <span>Verifiziert</span>
          </label>
          <button class="udv2-btn" data-act="save-verified">Übernehmen</button>
        </div>
        <div class="udv2-row" style="margin-top:14px;">
          <label class="udv2-check">
            <input type="checkbox" id="udv2-premium" ${u.is_premium ? 'checked' : ''}>
            <span>Premium</span>
          </label>
          <input type="date" class="udv2-date" id="udv2-premium-until"
            value="${esc(toDateInputValue(u.premium_until))}"
            style="max-width:160px;" />
          <button class="udv2-btn" data-act="save-premium">Übernehmen</button>
        </div>
      </div>

      <!-- MODERATION -->
      <div class="udv2-section">
        <div class="udv2-section-title">Moderation</div>
        <div class="udv2-row">
          ${u.is_banned
            ? `<button class="udv2-btn success" data-act="unban">Bann aufheben</button>
               <span style="font-size:12px;color:#9CA3AF;">
                 Grund: ${esc(u.ban_reason || '–')}
               </span>`
            : `<button class="udv2-btn danger" data-act="ban">User bannen …</button>`
          }
        </div>
      </div>

      <!-- RESET -->
      <div class="udv2-section">
        <div class="udv2-section-title">Reset</div>
        <div class="udv2-row">
          <button class="udv2-btn" data-act="reset-password">Passwort-Reset-Mail senden</button>
        </div>
      </div>
    </div>

    <div class="udv2-footer">
      <div>
        Letzte Aktivität: <b>${esc(fmtRelative(u.last_seen_at))}</b>
      </div>
      <div class="udv2-stats">
        <span><b>${esc(u.post_count ?? 0)}</b> Posts</span>
        <span><b>${esc(u.comment_count ?? u.comments_count ?? 0)}</b> Comments</span>
        <span><b>${esc(u.follower_count ?? 0)}</b> Follower</span>
      </div>
    </div>
  `

  // Close-Button re-bind (UI wurde ersetzt)
  modalEl.querySelector('[data-act="close"]').addEventListener('click', close)

  // ----- Action-Handlers -----
  function setBtnLoading(btn, loading, originalText) {
    if (!btn) return
    if (loading) {
      btn.dataset._txt = originalText || btn.textContent
      btn.disabled = true
      btn.innerHTML = `<span class="udv2-spinner"></span>${btn.dataset._txt}`
    } else {
      btn.disabled = false
      btn.textContent = btn.dataset._txt || originalText || btn.textContent
    }
  }

  async function withLoading(btn, fn) {
    const orig = btn ? btn.textContent : ''
    setBtnLoading(btn, true, orig)
    try { await fn() }
    catch (e) {
      console.error('[user-detail-v2]', e)
      toast(`Fehler: ${e.message || e}`, 'error')
    } finally {
      setBtnLoading(btn, false, orig)
    }
  }

  // Rolle speichern
  modalEl.querySelector('[data-act="save-role"]').addEventListener('click', async (ev) => {
    const btn = ev.currentTarget
    const newRole = modalEl.querySelector('#udv2-role').value
    if (newRole === currentRole) {
      toast('Rolle unverändert.', 'info')
      return
    }
    await withLoading(btn, async () => {
      await rpc('admin_set_user_role', { p_user_id: userId, p_role: newRole })
      toast(`Rolle gesetzt: ${newRole}`, 'success')
      u.role = newRole
    })
  })

  // Verifiziert
  modalEl.querySelector('[data-act="save-verified"]').addEventListener('click', async (ev) => {
    const btn = ev.currentTarget
    const want = !!modalEl.querySelector('#udv2-verified').checked
    if (want === !!u.is_verified) {
      toast('Status unverändert.', 'info')
      return
    }
    await withLoading(btn, async () => {
      await rpc('admin_set_user_verified', { p_user_id: userId, p_verified: want })
      toast(want ? 'User verifiziert.' : 'Verified entzogen.', 'success')
      u.is_verified = want
    })
  })

  // Premium
  modalEl.querySelector('[data-act="save-premium"]').addEventListener('click', async (ev) => {
    const btn = ev.currentTarget
    const want = !!modalEl.querySelector('#udv2-premium').checked
    const untilStr = modalEl.querySelector('#udv2-premium-until').value || null
    await withLoading(btn, async () => {
      if (!want) {
        // Premium entziehen
        await rpc('admin_revoke_premium', { p_user_id: userId })
        toast('Premium entzogen.', 'success')
        u.is_premium = false
        u.premium_until = null
      } else {
        // Premium gewähren — days berechnen aus Datum, sonst 30 Default
        const days = untilStr ? daysUntil(untilStr) : 30
        if (!untilStr) {
          toast('Kein Datum gesetzt — gewähre 30 Tage Premium.', 'info')
        }
        await rpc('admin_grant_premium', { p_user_id: userId, p_days: days })
        toast(`Premium gewährt (${days} Tage).`, 'success')
        u.is_premium = true
        u.premium_until = new Date(Date.now() + days * 86400000).toISOString()
      }
    })
  })

  // Ban / Unban — als re-bindbare Handler (Section wird nach Aktion neu gerendert)
  async function handleBan(btn) {
    const res = await showBanModal(u)
    if (!res) return
    await withLoading(btn, async () => {
      try {
        await rpc('admin_ban_user', {
          p_user_id: userId,
          p_reason: res.reason,
          p_until: res.until ? new Date(res.until + 'T23:59:59').toISOString() : null,
        })
      } catch (e) {
        if (String(e.message || '').match(/p_until|argument/i)) {
          await rpc('admin_ban_user', { p_user_id: userId, p_reason: res.reason })
        } else { throw e }
      }
      toast('User gebannt.', 'success')
      u.is_banned = true
      u.ban_reason = res.reason
      rerenderModerationSection()
    })
  }
  async function handleUnban(btn) {
    await withLoading(btn, async () => {
      await rpc('admin_unban_user', { p_user_id: userId })
      toast('Bann aufgehoben.', 'success')
      u.is_banned = false
      u.ban_reason = null
      rerenderModerationSection()
    })
  }
  function bindModerationButtons() {
    const b = modalEl.querySelector('[data-act="ban"]')
    const ub = modalEl.querySelector('[data-act="unban"]')
    if (b) b.addEventListener('click', (e) => handleBan(e.currentTarget))
    if (ub) ub.addEventListener('click', (e) => handleUnban(e.currentTarget))
  }
  bindModerationButtons()

  // Reset-Mail
  modalEl.querySelector('[data-act="reset-password"]').addEventListener('click', async (ev) => {
    const btn = ev.currentTarget
    if (!u.username && !u.email) {
      toast('Weder Username noch E-Mail vorhanden.', 'error')
      return
    }
    await withLoading(btn, async () => {
      // Bevorzugt: RPC by username (existiert im CRM, siehe cmdk-actions)
      if (u.username) {
        await rpc('crm_send_password_reset_by_username', { p_username: u.username })
      } else {
        // Fallback per Edge-Function falls vorhanden
        const { error } = await sb.functions.invoke('send-password-reset', { body: { email: u.email } })
        if (error) throw error
      }
      toast('Reset-Mail gesendet.', 'success')
    })
  })

  function rerenderModerationSection() {
    const sections = modalEl.querySelectorAll('.udv2-section')
    // Index 2: Rolle, Status, Moderation, Reset
    const modSection = sections[2]
    if (!modSection) return
    modSection.innerHTML = `
      <div class="udv2-section-title">Moderation</div>
      <div class="udv2-row">
        ${u.is_banned
          ? `<button class="udv2-btn success" data-act="unban">Bann aufheben</button>
             <span style="font-size:12px;color:#9CA3AF;">Grund: ${esc(u.ban_reason || '–')}</span>`
          : `<button class="udv2-btn danger" data-act="ban">User bannen …</button>`
        }
      </div>
    `
    bindModerationButtons()
  }
}

// Default-Export für convenience
export default showUserDetailV2
