// hozd-cast: Speicher + Kosten — 2026-09-12, Paket F (CRM).
// Vertrag: expo/docs/hozdcast-contract.md Abschnitt 18.3 (admin_hozdcast_storage).
// Zeigt Bytes je Bucket/Praefix, Cloud-Run-Minuten, Schaetzung EUR, R2-Schwellen,
// Purge-Queue. Reines Lese-Panel, keine Aktionen.
import { sb } from '/lib/supabase.js?v=20260610q'
import { fmtNumber, iconHtml, htmlEscape, fmtDateTime, toast } from '/lib/ui.js?v=20260610q'

function fmtBytes(n) {
  if (!n || n < 0) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0, v = n
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${u[i]}`
}
function pct(used, total) {
  if (!total) return 0
  return Math.min(100, Math.round((used / total) * 1000) / 10)
}
function barColor(p) {
  if (p >= 85) return '#EF4444'
  if (p >= 60) return '#F59E0B'
  return '#22C55E'
}
function statTile(label, value, sub) {
  return `<div class="stat-hero">
    <div class="stat-value">${value}</div>
    <div class="stat-label">${htmlEscape(label)}</div>
    ${sub ? `<div class="stat-label" style="opacity:.7">${htmlEscape(sub)}</div>` : ''}
  </div>`
}
function meter(label, usedText, p, freeText) {
  const col = barColor(p)
  return `<div style="margin-bottom:14px">
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:5px">
      <span style="font-size:13px;color:var(--text,#fff)">${htmlEscape(label)}</span>
      <span style="font-size:12px;color:var(--text-muted,#9CA3AF)">${htmlEscape(usedText)}</span>
    </div>
    <div style="height:8px;border-radius:6px;background:rgba(255,255,255,0.08);overflow:hidden">
      <div style="height:100%;width:${p}%;background:${col};border-radius:6px;transition:width .5s"></div>
    </div>
    <div style="display:flex;justify-content:space-between;margin-top:4px">
      <span style="font-size:11px;color:${col};font-weight:600">${p}% genutzt</span>
      <span style="font-size:11px;color:var(--text-muted,#9CA3AF)">${htmlEscape(freeText)}</span>
    </div>
  </div>`
}
function breakdownRows(items, keyName = 'prefix') {
  if (!items || !items.length) return '<div class="card-sub">Keine Daten</div>'
  const max = Math.max(...items.map(i => i.bytes || 0), 1)
  return items.map(i => {
    const w = Math.max(2, Math.round(((i.bytes || 0) / max) * 100))
    const label = i[keyName] || i.bucket || i.name || '—'
    const extra = i.objects != null ? ` · ${fmtNumber(i.objects)} Obj.` : ''
    return `<div style="margin-bottom:9px">
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">
        <span style="color:var(--text,#fff)">${htmlEscape(label)}</span>
        <span style="color:var(--text-muted,#9CA3AF)">${fmtBytes(i.bytes || 0)}${extra}</span>
      </div>
      <div style="height:5px;border-radius:4px;background:rgba(255,255,255,0.06)">
        <div style="height:100%;width:${w}%;background:#7C5CFF;border-radius:4px"></div>
      </div>
    </div>`
  }).join('')
}
function flagChip(active, label) {
  const bg = active ? 'rgba(239,68,68,.16)' : 'rgba(34,197,94,.14)'
  const fg = active ? '#f87171' : '#4ade80'
  return `<span style="font-size:11px;padding:3px 9px;border-radius:999px;background:${bg};color:${fg};margin-right:6px;display:inline-block;margin-bottom:6px">
    ${active ? '⚠' : '✓'} ${htmlEscape(label)}</span>`
}

function render(container, d) {
  const q = d.quota || {}
  const cr = d.cloud_run || {}
  const rt = d.r2_thresholds || {}
  const pq = d.purge_queue || {}
  const stP = pct(q.storage_used_bytes || 0, q.storage_limit_bytes || 1)
  const egressUsed = q.egress_month_bytes
  const egressP = egressUsed != null ? pct(egressUsed, q.egress_limit_bytes || 1) : null
  const crP = pct(cr.vcpu_seconds_month || 0, cr.vcpu_free || 1)

  container.innerHTML = `
    <div class="panel-head">
      <div class="panel-head-left">
        <div class="panel-title">hozd-cast — Speicher &amp; Kosten</div>
        <div class="panel-sub">Stand ${htmlEscape(fmtDateTime ? fmtDateTime(d.generated_at) : new Date(d.generated_at).toLocaleString('de-AT'))}</div>
      </div>
      <button class="btn btn-ghost" id="hcs-refresh">${iconHtml('refresh')} Aktualisieren</button>
    </div>

    <div class="hero-row">
      ${statTile('Storage gesamt', fmtBytes(q.storage_used_bytes || 0))}
      ${statTile('Cloud-Run vCPU-Sek (Monat)', fmtNumber(cr.vcpu_seconds_month || 0))}
      ${statTile('Cloud-Run GiB-Sek (Monat)', fmtNumber(cr.gib_seconds_month || 0))}
      ${statTile('Schaetzung EUR', `${(cr.eur_estimate ?? 0).toFixed(2)} €`, 'Free-Tier solange 0')}
    </div>

    <div class="panel-section">
      <div class="card-header"><strong>Quoten</strong><span class="card-sub">grün = viel Luft, rot = eng</span></div>
      ${meter('Storage (Bucket hozdcast + hozdcast-public)', `${fmtBytes(q.storage_used_bytes || 0)} / ${fmtBytes(q.storage_limit_bytes || 0)}`, stP, `${fmtBytes(Math.max(0, (q.storage_limit_bytes || 0) - (q.storage_used_bytes || 0)))} frei`)}
      ${egressUsed != null
        ? meter('Egress (Monat)', `${fmtBytes(egressUsed)} / ${fmtBytes(q.egress_limit_bytes || 0)}`, egressP, `${fmtBytes(Math.max(0, (q.egress_limit_bytes || 0) - egressUsed))} frei`)
        : `<div style="font-size:12.5px;color:var(--text-muted,#9CA3AF);padding:6px 0 14px">Egress — vom Supabase-Dashboard nachtragen (nicht per API abfragbar).</div>`}
      ${meter('Cloud-Run vCPU-Sekunden (Free-Tier)', `${fmtNumber(cr.vcpu_seconds_month || 0)} / ${fmtNumber(cr.vcpu_free || 0)}`, crP, `${fmtNumber(Math.max(0, (cr.vcpu_free || 0) - (cr.vcpu_seconds_month || 0)))} frei`)}
    </div>

    <div class="panel-section">
      <div class="card-header"><strong>R2-Schwellen</strong><span class="card-sub">fruehwarnung fuer Storage-Backend-Wechsel</span></div>
      <div>
        ${flagChip(!!rt.egress_60pct_hit, 'Egress > 60 % des Kontingents')}
        ${flagChip(!!rt.video_bytes_over_40gb, 'Video-Bytes gesamt > 40 GB')}
        ${flagChip(!!rt.single_session_over_200_views, 'einzelne Session > 200 Views')}
      </div>
    </div>

    <div class="grid-2">
      <div class="panel-section">
        <div class="card-header"><strong>Nach Praefix</strong><span class="card-sub">raw / out / stem / tmp</span></div>
        ${breakdownRows(d.by_prefix, 'prefix')}
      </div>
      <div class="panel-section">
        <div class="card-header"><strong>Nach Bucket</strong></div>
        ${breakdownRows(d.by_bucket, 'bucket')}
      </div>
    </div>

    <div class="panel-section">
      <div class="card-header"><strong>Groesste Sessions</strong><span class="card-sub">Top ${d.top_sessions ? d.top_sessions.length : 0}</span></div>
      ${(d.top_sessions && d.top_sessions.length) ? `
        <div style="overflow-x:auto">
        <table class="data-table" style="width:100%;font-size:12.5px">
          <thead><tr><th>Code</th><th>Titel</th><th>Status</th><th>Bytes</th><th>Raw ablaeuft</th><th>Out ablaeuft</th></tr></thead>
          <tbody>
            ${d.top_sessions.map(s => `<tr>
              <td><code>${htmlEscape(s.code || '—')}</code></td>
              <td>${htmlEscape(s.title || '(ohne Titel)')}</td>
              <td>${htmlEscape(s.status || '—')}</td>
              <td>${fmtBytes(s.bytes || 0)}</td>
              <td>${s.expires_raw_at ? htmlEscape(new Date(s.expires_raw_at).toLocaleString('de-AT')) : '—'}</td>
              <td>${s.expires_out_at ? htmlEscape(new Date(s.expires_out_at).toLocaleString('de-AT')) : '—'}</td>
            </tr>`).join('')}
          </tbody>
        </table>
        </div>` : '<div class="card-sub">Keine Sessions</div>'}
    </div>

    <div class="grid-2">
      <div class="panel-section">
        <div class="card-header"><strong>Retention — naechste Aktionen</strong></div>
        ${(d.retention_next && d.retention_next.length) ? d.retention_next.map(r => `
          <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.05);font-size:12.5px">
            <span>${htmlEscape(r.what)} · <code>${htmlEscape((r.session_id || '').slice(0, 8))}</code></span>
            <span style="color:var(--text-muted,#9CA3AF)">${htmlEscape(new Date(r.at).toLocaleString('de-AT'))}</span>
          </div>`).join('') : '<div class="card-sub">Nichts anstehend</div>'}
      </div>
      <div class="panel-section">
        <div class="card-header"><strong>Purge-Queue</strong></div>
        ${statTile('offen', fmtNumber(pq.open || 0))}
        ${statTile('fehlgeschlagen', fmtNumber(pq.failed || 0))}
      </div>
    </div>
  `

  container.querySelector('#hcs-refresh')?.addEventListener('click', () => load(container))
}

async function load(container) {
  container.innerHTML = `<div class="panel-section" style="text-align:center;padding:40px;color:var(--text-muted,#9CA3AF)">Lädt hozd-cast Speicher &amp; Kosten…</div>`
  try {
    const { data, error } = await sb.rpc('admin_hozdcast_storage', { p_top: 20 })
    if (error) throw error
    if (!data) throw new Error('Keine Daten')
    render(container, data)
  } catch (e) {
    console.error('[hozdcast-storage]', e)
    const msg = (e && e.message) || 'Fehler'
    container.innerHTML = `<div class="panel-section" style="text-align:center;padding:40px;color:#EF4444">
      hozd-cast-Speicherdaten konnten nicht geladen werden.<br><span style="font-size:12px;color:var(--text-muted,#9CA3AF)">${htmlEscape(msg)}</span></div>`
    toast('hozd-cast Speicher: ' + msg, 'error')
  }
}

export default {
  id: 'hozdcast-storage',
  title: 'hozd-cast Speicher & Kosten',
  icon: 'bar-chart',
  async mount(container) {
    await load(container)
  }
}
