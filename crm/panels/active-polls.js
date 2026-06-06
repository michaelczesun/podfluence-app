import { sb } from '/lib/supabase.js'

export default {
  id: 'active-polls',
  title: 'Aktive Umfragen',
  category: 'content',
  summary: 'Laufende Polls mit Optionen und Votes.',
  async mount(container) {
    container.innerHTML = `<div class="panel-shell">
      <div class="panel-head"><h2>Aktive Umfragen</h2><button class="refresh-btn">Aktualisieren</button></div>
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
      } catch { return String(iso) }
    }

    const refresh = async () => {
      body.innerHTML = '<div class="loading">Lädt…</div>'
      try {
        const nowIso = new Date().toISOString()
        const { data: polls, error: pollsErr } = await sb
          .from('polls')
          .select('id, question, closes_at, created_at')
          .gt('closes_at', nowIso)
          .order('closes_at', { ascending: true })
          .limit(200)
        if (pollsErr) throw pollsErr

        if (!polls || polls.length === 0) {
          body.innerHTML = '<div class="empty">Keine aktiven Umfragen.</div>'
          return
        }

        const pollIds = polls.map(p => p.id)
        const { data: options, error: optsErr } = await sb
          .from('poll_options')
          .select('id, poll_id, label, ord, votes_count')
          .in('poll_id', pollIds)
          .order('ord', { ascending: true })
        if (optsErr) throw optsErr

        const optsByPoll = new Map()
        for (const o of (options || [])) {
          if (!optsByPoll.has(o.poll_id)) optsByPoll.set(o.poll_id, [])
          optsByPoll.get(o.poll_id).push(o)
        }

        let rows = ''
        let totalVotesAll = 0
        let totalOptionsAll = 0
        for (const p of polls) {
          const opts = optsByPoll.get(p.id) || []
          const total = opts.reduce((s, o) => s + (Number(o.votes_count) || 0), 0)
          totalVotesAll += total
          totalOptionsAll += opts.length
          const optChips = opts.length
            ? `<div class="chips" style="display:flex;flex-wrap:wrap;gap:6px;">${opts.map(o => {
                const v = Number(o.votes_count) || 0
                const pct = total > 0 ? Math.round((v / total) * 100) : 0
                return `<span style="background:#1F1F28;border:1px solid #2A2A33;border-radius:999px;padding:4px 10px;font-size:12px;color:#fff;">
                  ${escapeHtml(o.label)} · <span style="color:#8B5CF6;font-weight:600;">${v}</span> <span style="color:#6b7280;">(${pct}%)</span>
                </span>`
              }).join('')}</div>`
            : '<span style="color:#6b7280;font-size:12px;">keine Optionen</span>'

          rows += `<tr>
            <td style="vertical-align:top;padding:10px;border-bottom:1px solid #2A2A33;color:#fff;max-width:340px;">${escapeHtml(p.question)}</td>
            <td style="vertical-align:top;padding:10px;border-bottom:1px solid #2A2A33;color:#cbd5e1;white-space:nowrap;">${fmtDate(p.closes_at)}</td>
            <td style="vertical-align:top;padding:10px;border-bottom:1px solid #2A2A33;">${optChips}</td>
            <td style="vertical-align:top;padding:10px;border-bottom:1px solid #2A2A33;color:#fff;font-weight:600;text-align:right;">${total}</td>
          </tr>`
        }

        const kpis = `
          <div class="kpi-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:16px;">
            <div class="kpi-tile" style="background:#16161D;border:1px solid #2A2A33;border-radius:12px;padding:14px;">
              <div style="color:#6b7280;font-size:12px;">Aktive Polls</div>
              <div style="color:#fff;font-size:22px;font-weight:700;">${polls.length}</div>
              <div style="color:#8B5CF6;font-size:11px;">laufend</div>
            </div>
            <div class="kpi-tile" style="background:#16161D;border:1px solid #2A2A33;border-radius:12px;padding:14px;">
              <div style="color:#6b7280;font-size:12px;">Optionen gesamt</div>
              <div style="color:#fff;font-size:22px;font-weight:700;">${totalOptionsAll}</div>
              <div style="color:#8B5CF6;font-size:11px;">über alle Polls</div>
            </div>
            <div class="kpi-tile" style="background:#16161D;border:1px solid #2A2A33;border-radius:12px;padding:14px;">
              <div style="color:#6b7280;font-size:12px;">Votes gesamt</div>
              <div style="color:#fff;font-size:22px;font-weight:700;">${totalVotesAll}</div>
              <div style="color:#8B5CF6;font-size:11px;">aktive Polls</div>
            </div>
            <div class="kpi-tile" style="background:#16161D;border:1px solid #2A2A33;border-radius:12px;padding:14px;">
              <div style="color:#6b7280;font-size:12px;">Ø Votes / Poll</div>
              <div style="color:#fff;font-size:22px;font-weight:700;">${polls.length ? Math.round(totalVotesAll / polls.length) : 0}</div>
              <div style="color:#8B5CF6;font-size:11px;">Durchschnitt</div>
            </div>
          </div>`

        body.innerHTML = `
          ${kpis}
          <div style="background:#16161D;border:1px solid #2A2A33;border-radius:12px;overflow:hidden;">
            <table class="data-table" style="width:100%;border-collapse:collapse;font-size:13px;">
              <thead>
                <tr style="background:#1F1F28;">
                  <th style="text-align:left;padding:10px;color:#8B5CF6;border-bottom:1px solid #2A2A33;">Frage</th>
                  <th style="text-align:left;padding:10px;color:#8B5CF6;border-bottom:1px solid #2A2A33;">Schließt</th>
                  <th style="text-align:left;padding:10px;color:#8B5CF6;border-bottom:1px solid #2A2A33;">Optionen</th>
                  <th style="text-align:right;padding:10px;color:#8B5CF6;border-bottom:1px solid #2A2A33;">Votes</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>`
      } catch (e) {
        body.innerHTML = '<div class="empty">Daten kommen bald: ' + escapeHtml(e?.message || 'unbekannt') + '</div>'
      }
    }
    container.querySelector('.refresh-btn').addEventListener('click', refresh)
    await refresh()
  }
}
