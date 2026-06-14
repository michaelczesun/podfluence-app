// KI & Medien — Task #204: KI-Cache-Wiring + KI-Usage-Seite + Video-Cleanup + Self-Heal.
// Zeigt Whisper/Groq-Nutzung (heute + 14-Tage-Serie), whisper_cache-Status mit
// Versions-Breakdown (alte turbo/ohne-language Eintraege = stale → re-transkribieren
// automatisch), Render-Job-Gesundheit, haengende Jobs (Self-Heal-Button) und
// Video-Cleanup-Kandidaten. Daten: RPC admin_ai_media_overview() (admin-gated).
import { sb } from '/lib/supabase.js?v=20260610q'
import { fmtNumber, iconHtml, htmlEscape, toast } from '/lib/ui.js?v=20260610q'

const GROQ_DAILY = 2000

function barColor(p) {
  if (p >= 85) return '#EF4444'
  if (p >= 60) return '#F59E0B'
  return '#22C55E'
}
function pct(used, total) {
  if (!total) return 0
  return Math.min(100, Math.round((used / total) * 1000) / 10)
}
function fmtSecs(s) {
  if (s == null) return '—'
  return s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${(+s).toFixed(s < 10 ? 1 : 0)}s`
}
function relDays(d) {
  if (d == null) return ''
  if (d < 1) return 'heute'
  if (d < 2) return 'gestern'
  return `vor ${Math.round(d)} T`
}

function statTile(label, value, sub, accent) {
  return `<div class="stat-hero">
    <div class="stat-value"${accent ? ` style="color:${accent}"` : ''}>${value}</div>
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
      <div style="height:100%;width:${p}%;background:${col};border-radius:6px"></div>
    </div>
    <div style="display:flex;justify-content:space-between;margin-top:4px">
      <span style="font-size:11px;color:${col};font-weight:600">${p}% genutzt</span>
      <span style="font-size:11px;color:var(--text-muted,#9CA3AF)">${htmlEscape(freeText)}</span>
    </div>
  </div>`
}

// Mini-Balken-Sparkline (14 Tage Whisper-Nutzung)
function sparkline(series) {
  if (!series || !series.length) return '<div class="card-sub">Noch keine Nutzung</div>'
  const max = Math.max(...series.map(d => d.count || 0), 1)
  const bars = series.map(d => {
    const h = Math.max(3, Math.round(((d.count || 0) / max) * 64))
    const day = (d.day || '').slice(5) // MM-DD
    const col = (d.count || 0) >= GROQ_DAILY * 0.6 ? '#F59E0B' : '#7C5CFF'
    return `<div style="display:flex;flex-direction:column;align-items:center;gap:4px;flex:1;min-width:0">
      <div style="font-size:9px;color:var(--text-muted,#9CA3AF);font-variant-numeric:tabular-nums">${d.count || 0}</div>
      <div title="${htmlEscape(day)}: ${fmtNumber(d.count || 0)} Anfragen · ${d.users || 0} User"
           style="width:100%;max-width:22px;height:${h}px;background:${col};border-radius:4px 4px 2px 2px"></div>
      <div style="font-size:9px;color:var(--text-dim,#6B7280);white-space:nowrap">${htmlEscape(day)}</div>
    </div>`
  }).join('')
  return `<div style="display:flex;align-items:flex-end;gap:5px;height:96px;padding-top:6px">${bars}</div>`
}

function versionRows(versions, current) {
  if (!versions || !versions.length) return '<div class="card-sub">Kein Cache</div>'
  const total = versions.reduce((s, v) => s + (v.count || 0), 0) || 1
  return versions.map(v => {
    const isCur = v.version === current
    const w = Math.max(2, Math.round(((v.count || 0) / total) * 100))
    return `<div style="margin-bottom:9px">
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">
        <span style="color:var(--text,#fff);font-family:'SF Mono',monospace">${htmlEscape(v.version)}${isCur ? ' <span style="color:#22C55E;font-weight:700">● aktuell</span>' : ' <span style="color:#F59E0B">stale</span>'}</span>
        <span style="color:var(--text-muted,#9CA3AF)">${fmtNumber(v.count || 0)}</span>
      </div>
      <div style="height:5px;border-radius:4px;background:rgba(255,255,255,0.06)">
        <div style="height:100%;width:${w}%;background:${isCur ? '#22C55E' : '#F59E0B'};border-radius:4px"></div>
      </div>
    </div>`
  }).join('')
}

function statusPill(status) {
  const map = {
    done: ['#22C55E', 'rgba(34,197,94,.16)'],
    error: ['#fca5a5', 'rgba(248,113,113,.16)'],
    failed: ['#fca5a5', 'rgba(248,113,113,.16)'],
    processing: ['#fbbf24', 'rgba(251,191,36,.16)'],
    queued: ['#fbbf24', 'rgba(251,191,36,.16)'],
  }
  const [c, bg] = map[status] || ['#9CA3AF', 'rgba(255,255,255,.08)']
  return `<span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:10.5px;font-weight:600;color:${c};background:${bg}">${htmlEscape(status || '?')}</span>`
}

function recentRows(recent) {
  if (!recent || !recent.length) return '<div class="card-sub">Keine Render-Jobs</div>'
  return recent.map(r => {
    const slug = (r.slug || '').replace(/\.mp4$/, '').replace(/-/g, ' ').slice(0, 42) || '—'
    return `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,0.05)">
      <div style="min-width:0;flex:1">
        <div style="font-size:12.5px;color:var(--text,#fff);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${htmlEscape(slug)}</div>
        <div style="font-size:11px;color:var(--text-muted,#9CA3AF)">${htmlEscape(r.kind || '')}${r.seconds != null ? ` · ${fmtSecs(r.seconds)}` : ''}${r.error ? ` · <span style="color:#fca5a5">${htmlEscape(String(r.error).slice(0, 40))}</span>` : ''}</div>
      </div>
      ${statusPill(r.status)}
    </div>`
  }).join('')
}

function cleanupRows(items) {
  if (!items || !items.length) return '<div class="card-sub" style="color:#22C55E">Nichts aufzuräumen — alles sauber ✓</div>'
  return items.slice(0, 30).map(c => `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.04)">
      <div style="min-width:0;flex:1">
        <div style="font-size:12px;color:var(--text,#fff);font-family:'SF Mono',monospace">${htmlEscape(String(c.id).slice(0, 8))}…</div>
        <div style="font-size:11px;color:var(--text-muted,#9CA3AF)">${htmlEscape(c.reason || '')} · ${relDays(c.age_days)}${c.has_url ? '' : ' · keine Datei'}</div>
      </div>
      ${statusPill(c.status)}
    </div>`).join('')
}

function render(container, d) {
  const w = d.whisper || {}, c = d.cache || {}, r = d.renders || {}, v = d.videos || {}
  const grP = pct(w.today || 0, w.limit || GROQ_DAILY)
  const byStatus = r.by_status || {}
  const stuck = r.stuck || []
  const errCount = (byStatus.error || 0) + (byStatus.failed || 0)

  container.innerHTML = `
    <div class="panel-head">
      <div class="panel-head-left">
        <div class="panel-title">KI &amp; Medien</div>
        <div class="panel-sub">Whisper-Transkription, Cache-Status, Render-Jobs &amp; Video-Cleanup — Stand ${new Date(d.generated_at).toLocaleString('de-AT', { dateStyle: 'short', timeStyle: 'short' })}</div>
      </div>
      <button class="btn btn-ghost" id="aim-refresh">${iconHtml('refresh')} Aktualisieren</button>
    </div>

    <div class="hero-row">
      ${statTile('Whisper heute', `${fmtNumber(w.today || 0)}`, `von ${fmtNumber(w.limit || GROQ_DAILY)} · ${w.users_today || 0} User`, grP >= 85 ? '#EF4444' : null)}
      ${statTile('Cache-Einträge', fmtNumber(c.entries || 0), `${fmtNumber(c.current || 0)} aktuell · ${fmtNumber(c.stale || 0)} stale`, (c.stale || 0) > 0 ? '#F59E0B' : '#22C55E')}
      ${statTile('Render-Jobs', fmtNumber(r.total || 0), `${fmtNumber(r.last_24h || 0)} in 24h · ⌀ ${fmtSecs(r.avg_seconds)}`)}
      ${statTile('Hängende Jobs', fmtNumber(stuck.length), stuck.length ? 'Self-Heal empfohlen' : 'alles flüssig', stuck.length ? '#EF4444' : '#22C55E')}
    </div>

    <div class="grid-2">
      <div class="panel-section">
        <div class="card-header"><strong>Whisper-Nutzung (14 Tage)</strong></div>
        ${meter('Groq Whisper heute (Free-Tier 2.000/Tag)', `${fmtNumber(w.today || 0)} / ${fmtNumber(w.limit || GROQ_DAILY)}`, grP, `${fmtNumber((w.limit || GROQ_DAILY) - (w.today || 0))} heute frei`)}
        ${sparkline(w.last14)}
        <div style="font-size:11px;color:var(--text-muted,#9CA3AF);margin-top:10px">30-Tage-Summe: ${fmtNumber(w.total_30d || 0)} Transkriptionen</div>
      </div>

      <div class="panel-section">
        <div class="card-header"><strong>Transkript-Cache</strong><span class="card-sub">${fmtNumber(c.entries || 0)} · ⌀ ${fmtNumber(c.avg_words || 0)} Wörter</span></div>
        ${versionRows(c.versions, d.current_version)}
        ${(c.stale || 0) > 0 ? `<div style="font-size:11.5px;color:#F59E0B;margin-top:8px;line-height:1.5">${fmtNumber(c.stale)} alte Einträge (turbo / ohne <code>language=de</code>) werden beim nächsten Abruf automatisch neu transkribiert.</div>` : '<div style="font-size:11.5px;color:#22C55E;margin-top:8px">Alle Transkripte auf aktueller Version ✓</div>'}
      </div>
    </div>

    <div class="grid-2">
      <div class="panel-section">
        <div class="card-header"><strong>Render-Status</strong><span class="card-sub">${errCount ? `${fmtNumber(errCount)} fehlgeschlagen` : 'gesund'}</span></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
          ${Object.entries(byStatus).map(([s, n]) => `<div style="display:flex;align-items:center;gap:6px;padding:6px 11px;border-radius:10px;background:rgba(255,255,255,.04)">${statusPill(s)} <strong style="font-size:13px">${fmtNumber(n)}</strong></div>`).join('') || '<span class="card-sub">Keine Jobs</span>'}
        </div>
        ${stuck.length ? `
          <div style="padding:12px;border-radius:12px;background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.2);margin-bottom:8px">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
              <div style="font-size:12.5px;color:#fca5a5"><strong>${stuck.length}</strong> Job(s) hängen seit ≥10 Min (Renderer abgebrochen)</div>
              <button class="btn" id="aim-heal" style="background:#EF4444;color:#fff;border:none">${iconHtml('refresh')} Self-Heal</button>
            </div>
            <div style="font-size:11px;color:var(--text-muted,#9CA3AF);margin-top:6px">Markiert hängende Jobs als Fehler → kein Dauer-Spinner, User kann neu rendern.</div>
          </div>` : ''}
      </div>

      <div class="panel-section">
        <div class="card-header"><strong>Letzte Render-Jobs</strong></div>
        ${recentRows(r.recent)}
      </div>
    </div>

    <div class="panel-section">
      <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
        <span><strong>Video-Cleanup-Kandidaten</strong> <span class="card-sub">${fmtNumber(v.cleanup_count || 0)} · fehlgeschlagen oder >60 Tage</span></span>
        ${(v.cleanup_count || 0) > 0 ? `<button class="btn" id="aim-cleanup" style="background:#EF4444;color:#fff;border:none">${iconHtml('trash')} ${fmtNumber(v.cleanup_count)} aufräumen</button>` : ''}
      </div>
      <div style="font-size:11.5px;color:var(--text-muted,#9CA3AF);margin-bottom:10px">${fmtNumber(v.done || 0)} fertige Videos im Storage (<code>updates-images/audiogram-videos</code>). „Aufräumen" löscht fehlgeschlagene + sehr alte Videos (Datei + Job-Eintrag) — nach Rückfrage.</div>
      ${cleanupRows(v.cleanup_candidates)}
    </div>
  `

  const btn = container.querySelector('#aim-refresh')
  if (btn) btn.addEventListener('click', () => load(container))

  const heal = container.querySelector('#aim-heal')
  if (heal) heal.addEventListener('click', async () => {
    heal.disabled = true
    heal.innerHTML = '⏳ Heile…'
    try {
      const { data, error } = await sb.rpc('admin_requeue_stuck_renders')
      if (error) throw error
      toast(`${data || 0} hängende Job(s) bereinigt`, 'success')
      await load(container)
    } catch (e) {
      toast('Self-Heal fehlgeschlagen: ' + (e?.message || e), 'error')
      heal.disabled = false
      heal.innerHTML = `${iconHtml('refresh')} Self-Heal`
    }
  })

  const cleanup = container.querySelector('#aim-cleanup')
  if (cleanup) cleanup.addEventListener('click', async () => {
    const n = (d.videos?.cleanup_count) || 0
    if (!window.confirm(`${n} fehlgeschlagene/alte Video(s) endgültig löschen (Datei + Job-Eintrag)? Kann nicht rückgängig gemacht werden.`)) return
    cleanup.disabled = true
    cleanup.innerHTML = '⏳ Räume auf…'
    try {
      const { data, error } = await sb.functions.invoke('cleanup-renders', { body: { mode: 'execute' } })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      toast(`${data?.deleted_rows ?? 0} Job(s) + ${data?.deleted_files ?? 0} Datei(en) gelöscht`, 'success')
      await load(container)
    } catch (e) {
      toast('Cleanup fehlgeschlagen: ' + (e?.message || e), 'error')
      cleanup.disabled = false
      cleanup.innerHTML = `${iconHtml('trash')} ${n} aufräumen`
    }
  })
}

async function load(container) {
  container.innerHTML = `<div class="panel-section" style="text-align:center;padding:40px;color:var(--text-muted,#9CA3AF)">Lädt KI- &amp; Medien-Daten…</div>`
  try {
    const { data, error } = await sb.rpc('admin_ai_media_overview')
    if (error) throw error
    if (!data) throw new Error('Keine Daten')
    render(container, data)
  } catch (e) {
    console.error('[ai-media-ops]', e)
    const msg = (e && e.message) || 'Fehler'
    container.innerHTML = `<div class="panel-section" style="text-align:center;padding:40px;color:#EF4444">
      KI- &amp; Medien-Daten konnten nicht geladen werden.<br><span style="font-size:12px;color:var(--text-muted,#9CA3AF)">${htmlEscape(msg)}</span></div>`
    toast('KI-Panel: ' + msg, 'error')
  }
}

export default {
  id: 'ai-media-ops',
  title: 'KI & Medien',
  icon: 'sparkles',
  async mount(container) {
    await load(container)
  }
}
