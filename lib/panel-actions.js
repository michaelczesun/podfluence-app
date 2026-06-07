// lib/panel-actions.js
// Vorgefertigte Action-Handlers für Admin-Panels.
// Importiert UI-Helper (toast, modal, confirmDialog, prompt) und Supabase-Client.

import { sb } from './supabase.js';
import { toast, modal, confirmDialog, promptDialog } from './ui.js';

// ---------------------------------------------------------------------------
// Kleine Helfer
// ---------------------------------------------------------------------------

function _escape(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function _fmtDate(d) {
  if (!d) return '–';
  try {
    return new Date(d).toLocaleString('de-DE');
  } catch {
    return String(d);
  }
}

async function _rpc(name, args = {}, { successMsg, errorMsg } = {}) {
  const { data, error } = await sb.rpc(name, args);
  if (error) {
    console.error(`[panel-actions] RPC ${name} failed`, error);
    toast(errorMsg || `Fehler: ${error.message}`, 'error');
    throw error;
  }
  if (successMsg) toast(successMsg, 'success');
  return data;
}

async function _invoke(fnName, body = {}, { successMsg, errorMsg } = {}) {
  const { data, error } = await sb.functions.invoke(fnName, { body });
  if (error) {
    console.error(`[panel-actions] Edge fn ${fnName} failed`, error);
    toast(errorMsg || `Fehler: ${error.message}`, 'error');
    throw error;
  }
  if (successMsg) toast(successMsg, 'success');
  return data;
}

// ---------------------------------------------------------------------------
// USER ACTIONS
// ---------------------------------------------------------------------------

export async function verifyUser(userId) {
  if (!userId) throw new Error('userId required');
  const ok = await confirmDialog({
    title: 'User verifizieren?',
    message: 'Dieser User erhält den Verified-Status.',
    confirmText: 'Verifizieren',
    danger: false,
  });
  if (!ok) return null;
  return _rpc('admin_set_user_verified', { p_user_id: userId, p_verified: true }, {
    successMsg: 'User verifiziert.',
    errorMsg: 'Konnte User nicht verifizieren.',
  });
}

export async function unverifyUser(userId) {
  if (!userId) throw new Error('userId required');
  const ok = await confirmDialog({
    title: 'Verified-Status entziehen?',
    message: 'Der Verified-Haken wird entfernt.',
    confirmText: 'Entziehen',
    danger: true,
  });
  if (!ok) return null;
  return _rpc('admin_set_user_verified', { p_user_id: userId, p_verified: false }, {
    successMsg: 'Verified-Status entzogen.',
    errorMsg: 'Konnte Status nicht entziehen.',
  });
}

export async function banUser(userId, reason) {
  if (!userId) throw new Error('userId required');
  let r = reason;
  if (!r) {
    r = await promptDialog({
      title: 'User bannen',
      message: 'Grund für den Bann (wird im Audit-Log gespeichert):',
      placeholder: 'z. B. Spam, Hate-Speech …',
      required: true,
    });
  }
  if (!r) return null;
  const ok = await confirmDialog({
    title: 'User wirklich bannen?',
    message: `Grund: ${r}\n\nDer User kann sich nicht mehr einloggen.`,
    confirmText: 'Bannen',
    danger: true,
  });
  if (!ok) return null;
  return _rpc('admin_ban_user', { p_user_id: userId, p_reason: r }, {
    successMsg: 'User gebannt.',
    errorMsg: 'Konnte User nicht bannen.',
  });
}

export async function unbanUser(userId) {
  if (!userId) throw new Error('userId required');
  const ok = await confirmDialog({
    title: 'Bann aufheben?',
    message: 'Der User kann sich wieder einloggen.',
    confirmText: 'Bann aufheben',
    danger: false,
  });
  if (!ok) return null;
  return _rpc('admin_unban_user', { p_user_id: userId }, {
    successMsg: 'Bann aufgehoben.',
    errorMsg: 'Konnte Bann nicht aufheben.',
  });
}

export async function setUserRole(userId, role) {
  if (!userId) throw new Error('userId required');
  let r = role;
  if (!r) {
    r = await promptDialog({
      title: 'Rolle setzen',
      message: 'Neue Rolle (user, moderator, admin, jury):',
      placeholder: 'user',
      required: true,
    });
  }
  if (!r) return null;
  const allowed = ['user', 'moderator', 'admin', 'jury'];
  if (!allowed.includes(r)) {
    toast(`Ungültige Rolle: ${r}`, 'error');
    return null;
  }
  const ok = await confirmDialog({
    title: 'Rolle ändern?',
    message: `Neue Rolle: ${r}`,
    confirmText: 'Setzen',
    danger: r === 'admin',
  });
  if (!ok) return null;
  return _rpc('admin_set_user_role', { p_user_id: userId, p_role: r }, {
    successMsg: `Rolle gesetzt: ${r}`,
    errorMsg: 'Konnte Rolle nicht setzen.',
  });
}

// ---------------------------------------------------------------------------
// POST ACTIONS
// ---------------------------------------------------------------------------

export async function deletePost(updateId) {
  if (!updateId) throw new Error('updateId required');
  const ok = await confirmDialog({
    title: 'Post wirklich löschen?',
    message: 'Diese Aktion ist endgültig. Der Post und alle Reaktionen werden entfernt.',
    confirmText: 'Endgültig löschen',
    danger: true,
  });
  if (!ok) return null;
  return _rpc('admin_delete_update', { p_update_id: updateId }, {
    successMsg: 'Post gelöscht.',
    errorMsg: 'Konnte Post nicht löschen.',
  });
}

// ---------------------------------------------------------------------------
// PUSH / NOTIFICATIONS
// ---------------------------------------------------------------------------

export async function sendTestPush(userId) {
  if (!userId) throw new Error('userId required');
  const title = await promptDialog({
    title: 'Test-Push: Titel',
    message: 'Titel der Push-Nachricht:',
    placeholder: 'z. B. Hallo!',
    required: true,
  });
  if (!title) return null;
  const body = await promptDialog({
    title: 'Test-Push: Body',
    message: 'Inhalt der Push-Nachricht:',
    placeholder: 'z. B. Das ist ein Test.',
    required: true,
    multiline: true,
  });
  if (!body) return null;
  return _invoke('send-test-push', { user_id: userId, title, body }, {
    successMsg: 'Push gesendet.',
    errorMsg: 'Konnte Push nicht senden.',
  });
}

export async function sendBroadcastPush(audience, title, body) {
  // Multi-Step Modal wenn Args fehlen.
  let aud = audience;
  let t = title;
  let b = body;

  if (!aud) {
    aud = await new Promise((resolve) => {
      modal({
        title: 'Broadcast-Push (1/3): Zielgruppe',
        bodyHtml: `
          <p>An wen soll die Push gehen?</p>
          <div style="display:flex;flex-direction:column;gap:8px;margin-top:12px;">
            <label><input type="radio" name="aud" value="all" checked> Alle aktiven User</label>
            <label><input type="radio" name="aud" value="verified"> Nur Verified</label>
            <label><input type="radio" name="aud" value="premium"> Nur Premium</label>
            <label><input type="radio" name="aud" value="inactive_7d"> Inaktiv >7 Tage</label>
          </div>
        `,
        buttons: [
          { label: 'Abbrechen', onClick: (close) => { close(); resolve(null); } },
          {
            label: 'Weiter',
            primary: true,
            onClick: (close, root) => {
              const picked = root.querySelector('input[name="aud"]:checked')?.value;
              close();
              resolve(picked || 'all');
            },
          },
        ],
      });
    });
    if (!aud) return null;
  }

  if (!t) {
    t = await promptDialog({
      title: 'Broadcast-Push (2/3): Titel',
      message: 'Titel der Push-Nachricht:',
      placeholder: 'z. B. Neue Folge ist live!',
      required: true,
    });
    if (!t) return null;
  }

  if (!b) {
    b = await promptDialog({
      title: 'Broadcast-Push (3/3): Body',
      message: 'Inhalt der Push-Nachricht:',
      placeholder: 'Worum geht es?',
      required: true,
      multiline: true,
    });
    if (!b) return null;
  }

  const ok = await confirmDialog({
    title: 'Broadcast wirklich senden?',
    message: `Zielgruppe: ${aud}\nTitel: ${t}\n\n${b}`,
    confirmText: 'Senden',
    danger: true,
  });
  if (!ok) return null;

  return _invoke('send-broadcast-push', { audience: aud, title: t, body: b }, {
    successMsg: 'Broadcast gestartet.',
    errorMsg: 'Konnte Broadcast nicht starten.',
  });
}

// ---------------------------------------------------------------------------
// BUG REPORTS
// ---------------------------------------------------------------------------

export async function resolveBugReport(reportId) {
  if (!reportId) throw new Error('reportId required');
  const note = await promptDialog({
    title: 'Bug-Report schließen',
    message: 'Optionale Notiz (was wurde gefixt / warum geschlossen):',
    placeholder: 'z. B. Fix in 1.4.1 OTA',
    required: false,
    multiline: true,
  });
  // note darf leer sein, aber Abbruch (null) respektieren
  if (note === null) return null;
  return _rpc('admin_resolve_bug_report', { p_report_id: reportId, p_note: note || null }, {
    successMsg: 'Bug-Report geschlossen.',
    errorMsg: 'Konnte Report nicht schließen.',
  });
}

// ---------------------------------------------------------------------------
// PODCAST ACTIONS
// ---------------------------------------------------------------------------

export async function forceVerifyPodcast(podcastId) {
  if (!podcastId) throw new Error('podcastId required');
  const ok = await confirmDialog({
    title: 'Podcast manuell verifizieren?',
    message: 'Der RSS-Ownership-Check wird übersprungen. Nur nutzen wenn manuell geprüft.',
    confirmText: 'Manuell verifizieren',
    danger: true,
  });
  if (!ok) return null;
  return _rpc('admin_force_verify_podcast', { p_podcast_id: podcastId }, {
    successMsg: 'Podcast verifiziert.',
    errorMsg: 'Konnte Podcast nicht verifizieren.',
  });
}

// ---------------------------------------------------------------------------
// INVITES & PREMIUM
// ---------------------------------------------------------------------------

export async function assignInviteCodes(userId, count) {
  if (!userId) throw new Error('userId required');
  let c = count;
  if (c == null) {
    const raw = await promptDialog({
      title: 'Invite-Codes vergeben',
      message: 'Wie viele Codes sollen erzeugt werden?',
      placeholder: '5',
      required: true,
    });
    if (!raw) return null;
    c = parseInt(raw, 10);
  }
  if (!Number.isFinite(c) || c <= 0 || c > 500) {
    toast('Ungültige Anzahl (1–500).', 'error');
    return null;
  }
  return _rpc('admin_assign_invite_codes', { p_user_id: userId, p_count: c }, {
    successMsg: `${c} Codes vergeben.`,
    errorMsg: 'Konnte Codes nicht vergeben.',
  });
}

export async function grantPremium(userId, days) {
  if (!userId) throw new Error('userId required');
  let d = days;
  if (d == null) {
    const raw = await promptDialog({
      title: 'Premium gewähren',
      message: 'Für wie viele Tage?',
      placeholder: '30',
      required: true,
    });
    if (!raw) return null;
    d = parseInt(raw, 10);
  }
  if (!Number.isFinite(d) || d <= 0 || d > 3650) {
    toast('Ungültige Tageszahl (1–3650).', 'error');
    return null;
  }
  const ok = await confirmDialog({
    title: 'Premium gewähren?',
    message: `Premium für ${d} Tage aktivieren.`,
    confirmText: 'Gewähren',
    danger: false,
  });
  if (!ok) return null;
  return _rpc('admin_grant_premium', { p_user_id: userId, p_days: d }, {
    successMsg: `Premium für ${d} Tage gewährt.`,
    errorMsg: 'Konnte Premium nicht gewähren.',
  });
}

export async function revokePremium(userId) {
  if (!userId) throw new Error('userId required');
  const ok = await confirmDialog({
    title: 'Premium entziehen?',
    message: 'Der User verliert sofort den Premium-Status.',
    confirmText: 'Entziehen',
    danger: true,
  });
  if (!ok) return null;
  return _rpc('admin_revoke_premium', { p_user_id: userId }, {
    successMsg: 'Premium entzogen.',
    errorMsg: 'Konnte Premium nicht entziehen.',
  });
}

// ---------------------------------------------------------------------------
// DETAIL MODALS
// ---------------------------------------------------------------------------

export async function showUserDetailModal(userId) {
  if (!userId) throw new Error('userId required');

  // Daten laden
  let user;
  try {
    user = await _rpc('admin_get_user_full', { p_user_id: userId });
  } catch {
    return null;
  }
  if (!user) {
    toast('User nicht gefunden.', 'error');
    return null;
  }

  const u = Array.isArray(user) ? user[0] : user;

  const bodyHtml = `
    <div style="display:flex;gap:16px;align-items:flex-start;margin-bottom:16px;">
      ${u.avatar_url
        ? `<img src="${_escape(u.avatar_url)}" alt="" style="width:72px;height:72px;border-radius:50%;object-fit:cover;">`
        : `<div style="width:72px;height:72px;border-radius:50%;background:#333;display:flex;align-items:center;justify-content:center;font-size:28px;color:#aaa;">${_escape((u.display_name || u.username || '?')[0])}</div>`}
      <div style="flex:1;">
        <div style="font-size:18px;font-weight:600;">
          ${_escape(u.display_name || u.username || 'Unbenannt')}
          ${u.is_verified ? '<span title="Verified" style="color:#3ea6ff;">&#10004;</span>' : ''}
          ${u.is_banned ? '<span title="Banned" style="color:#ff4d4f;">&#9888;</span>' : ''}
          ${u.is_premium ? '<span title="Premium" style="color:#f1c40f;">&#9733;</span>' : ''}
        </div>
        <div style="color:#888;font-size:13px;">@${_escape(u.username || '–')}</div>
        <div style="color:#888;font-size:13px;">${_escape(u.email || '–')}</div>
      </div>
    </div>

    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <tbody>
        <tr><td style="padding:4px 8px;color:#888;">ID</td><td style="padding:4px 8px;font-family:monospace;">${_escape(u.id)}</td></tr>
        <tr><td style="padding:4px 8px;color:#888;">Rolle</td><td style="padding:4px 8px;">${_escape(u.role || 'user')}</td></tr>
        <tr><td style="padding:4px 8px;color:#888;">Registriert</td><td style="padding:4px 8px;">${_fmtDate(u.created_at)}</td></tr>
        <tr><td style="padding:4px 8px;color:#888;">Zuletzt aktiv</td><td style="padding:4px 8px;">${_fmtDate(u.last_seen_at)}</td></tr>
        <tr><td style="padding:4px 8px;color:#888;">Posts</td><td style="padding:4px 8px;">${u.post_count ?? 0}</td></tr>
        <tr><td style="padding:4px 8px;color:#888;">Follower</td><td style="padding:4px 8px;">${u.follower_count ?? 0}</td></tr>
        <tr><td style="padding:4px 8px;color:#888;">Premium bis</td><td style="padding:4px 8px;">${_fmtDate(u.premium_until)}</td></tr>
        <tr><td style="padding:4px 8px;color:#888;">Invite-Codes verfügbar</td><td style="padding:4px 8px;">${u.invite_codes_left ?? 0}</td></tr>
        ${u.ban_reason ? `<tr><td style="padding:4px 8px;color:#ff4d4f;">Ban-Grund</td><td style="padding:4px 8px;">${_escape(u.ban_reason)}</td></tr>` : ''}
      </tbody>
    </table>

    <div style="margin-top:16px;padding-top:12px;border-top:1px solid #2a2a2a;">
      <div style="font-size:12px;color:#888;margin-bottom:8px;">Aktionen</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;" id="pa-user-actions">
        ${u.is_verified
          ? `<button data-act="unverify" class="btn btn-secondary">Unverify</button>`
          : `<button data-act="verify" class="btn btn-primary">Verify</button>`}
        ${u.is_banned
          ? `<button data-act="unban" class="btn btn-secondary">Bann aufheben</button>`
          : `<button data-act="ban" class="btn btn-danger">Bannen</button>`}
        <button data-act="role" class="btn btn-secondary">Rolle setzen</button>
        ${u.is_premium
          ? `<button data-act="revoke-premium" class="btn btn-secondary">Premium entziehen</button>`
          : `<button data-act="grant-premium" class="btn btn-secondary">Premium gewähren</button>`}
        <button data-act="invite-codes" class="btn btn-secondary">Invite-Codes</button>
        <button data-act="test-push" class="btn btn-secondary">Test-Push</button>
      </div>
    </div>
  `;

  return new Promise((resolve) => {
    modal({
      title: 'User-Details',
      bodyHtml,
      width: 520,
      onMount: (root, close) => {
        root.querySelectorAll('#pa-user-actions button[data-act]').forEach((btn) => {
          btn.addEventListener('click', async () => {
            const act = btn.dataset.act;
            try {
              switch (act) {
                case 'verify': await verifyUser(userId); break;
                case 'unverify': await unverifyUser(userId); break;
                case 'ban': await banUser(userId); break;
                case 'unban': await unbanUser(userId); break;
                case 'role': await setUserRole(userId); break;
                case 'grant-premium': await grantPremium(userId); break;
                case 'revoke-premium': await revokePremium(userId); break;
                case 'invite-codes': await assignInviteCodes(userId); break;
                case 'test-push': await sendTestPush(userId); break;
              }
              // Modal schließen + Caller resolved mit dem User
              close();
              resolve(u);
            } catch (e) {
              // Toast schon gezeigt — Modal offen lassen
            }
          });
        });
      },
      buttons: [
        { label: 'Schließen', onClick: (close) => { close(); resolve(u); } },
      ],
    });
  });
}

export async function showPostDetailModal(updateId) {
  if (!updateId) throw new Error('updateId required');

  let post;
  try {
    post = await _rpc('admin_get_update_full', { p_update_id: updateId });
  } catch {
    return null;
  }
  if (!post) {
    toast('Post nicht gefunden.', 'error');
    return null;
  }
  const p = Array.isArray(post) ? post[0] : post;

  const bodyHtml = `
    <div style="display:flex;gap:12px;align-items:center;margin-bottom:12px;">
      ${p.author_avatar_url
        ? `<img src="${_escape(p.author_avatar_url)}" style="width:40px;height:40px;border-radius:50%;object-fit:cover;">`
        : ''}
      <div>
        <div style="font-weight:600;">${_escape(p.author_display_name || p.author_username || '–')}</div>
        <div style="color:#888;font-size:12px;">${_fmtDate(p.created_at)}</div>
      </div>
    </div>

    <div style="background:#1a1a1a;padding:12px;border-radius:8px;white-space:pre-wrap;font-size:14px;line-height:1.4;margin-bottom:12px;" id="pa-post-text">
      ${_escape(p.content || p.text || '')}
    </div>

    ${p.image_url
      ? `<img src="${_escape(p.image_url)}" style="max-width:100%;border-radius:8px;margin-bottom:12px;">`
      : ''}

    <table style="width:100%;font-size:13px;">
      <tbody>
        <tr><td style="padding:3px 6px;color:#888;">ID</td><td style="padding:3px 6px;font-family:monospace;">${_escape(p.id)}</td></tr>
        <tr><td style="padding:3px 6px;color:#888;">Likes</td><td style="padding:3px 6px;">${p.like_count ?? 0}</td></tr>
        <tr><td style="padding:3px 6px;color:#888;">Kommentare</td><td style="padding:3px 6px;">${p.comment_count ?? 0}</td></tr>
        <tr><td style="padding:3px 6px;color:#888;">Reports</td><td style="padding:3px 6px;color:${p.report_count ? '#ff4d4f' : 'inherit'};">${p.report_count ?? 0}</td></tr>
        ${p.flagged_reason ? `<tr><td style="padding:3px 6px;color:#ff4d4f;">Flag-Grund</td><td style="padding:3px 6px;">${_escape(p.flagged_reason)}</td></tr>` : ''}
      </tbody>
    </table>

    <div style="margin-top:16px;padding-top:12px;border-top:1px solid #2a2a2a;display:flex;gap:8px;flex-wrap:wrap;" id="pa-post-actions">
      <button data-act="edit" class="btn btn-secondary">Text bearbeiten</button>
      <button data-act="delete" class="btn btn-danger">Löschen</button>
      <button data-act="open-author" class="btn btn-secondary">Autor öffnen</button>
    </div>
  `;

  return new Promise((resolve) => {
    modal({
      title: 'Post-Details',
      bodyHtml,
      width: 560,
      onMount: (root, close) => {
        root.querySelectorAll('#pa-post-actions button[data-act]').forEach((btn) => {
          btn.addEventListener('click', async () => {
            const act = btn.dataset.act;
            try {
              if (act === 'delete') {
                await deletePost(updateId);
                close();
                resolve({ ...p, _deleted: true });
              } else if (act === 'edit') {
                const newText = await promptDialog({
                  title: 'Post-Text bearbeiten',
                  message: 'Neuer Text:',
                  defaultValue: p.content || p.text || '',
                  required: true,
                  multiline: true,
                });
                if (newText && newText !== (p.content || p.text)) {
                  await _rpc('admin_edit_update_text', { p_update_id: updateId, p_text: newText }, {
                    successMsg: 'Post aktualisiert.',
                    errorMsg: 'Konnte Post nicht ändern.',
                  });
                  close();
                  resolve({ ...p, content: newText, _edited: true });
                }
              } else if (act === 'open-author' && p.user_id) {
                close();
                const r = await showUserDetailModal(p.user_id);
                resolve(r);
              }
            } catch (e) {
              // Toast wurde schon gezeigt
            }
          });
        });
      },
      buttons: [
        { label: 'Schließen', onClick: (close) => { close(); resolve(p); } },
      ],
    });
  });
}

// ---------------------------------------------------------------------------
// Default-Export-Sammlung — bequeme Verwendung in Panels
// ---------------------------------------------------------------------------

export default {
  verifyUser,
  unverifyUser,
  banUser,
  unbanUser,
  setUserRole,
  deletePost,
  sendTestPush,
  resolveBugReport,
  forceVerifyPodcast,
  assignInviteCodes,
  grantPremium,
  revokePremium,
  showUserDetailModal,
  showPostDetailModal,
  sendBroadcastPush,
};
