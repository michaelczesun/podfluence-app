import { sb } from '/lib/supabase.js'

export default {
  id: 'onboarding-funnel',
  title: 'Onboarding-Funnel',
  category: 'users',
  summary: 'Signup vs. abgeschlossenes Onboarding.',
  async mount(container) {
    container.innerHTML = `<div class="panel-shell">
      <div class="panel-head"><h2>Onboarding-Funnel</h2><button class="refresh-btn">Aktualisieren</button></div>
      <div class="panel-body"><div class="loading">Lädt…</div></div>
    </div>`
    const body = container.querySelector('.panel-body')

    const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]))

    const renderBars = (bars) => {
      const W = 520, H = 280, padL = 50, padR = 20, padT = 20, padB = 50
      const innerW = W - padL - padR
      const innerH = H - padT - padB
      const maxV = Math.max(1, ...bars.map(b => b.value))
      const bw = innerW / bars.length * 0.55
      const gap = innerW / bars.length
      const yTicks = 4
      let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="background:#1B1B22;border:1px solid #2A2A33;border-radius:12px;">`
      for (let i = 0; i <= yTicks; i++) {
        const y = padT + (innerH * i / yTicks)
        const v = Math.round(maxV - (maxV * i / yTicks))
        svg += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="#2A2A33" stroke-width="1"/>`
        svg += `<text x="${padL - 8}" y="${y + 4}" fill="#8a8a99" font-size="10" text-anchor="end">${v}</text>`
      }
      bars.forEach((b, i) => {
        const cx = padL + gap * i + gap / 2
        const h = (b.value / maxV) * innerH
        const x = cx - bw / 2
        const y = padT + innerH - h
        svg += `<rect x="${x}" y="${y}" width="${bw}" height="${h}" rx="6" fill="#8B5CF6"/>`
        svg += `<text x="${cx}" y="${y - 6}" fill="#fff" font-size="12" text-anchor="middle" font-weight="600">${b.value}</text>`
        svg += `<text x="${cx}" y="${padT + innerH + 18}" fill="#cfcfdd" font-size="11" text-anchor="middle">${escapeHtml(b.label)}</text>`
      })
      svg += `</svg>`
      return svg
    }

    const refresh = async () => {
      body.innerHTML = '<div class="loading">Lädt…</div>'
      try {
        const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

        const { count: signups, error: e1 } = await sb
          .from('users')
          .select('id', { count: 'exact', head: true })
          .gte('created_at', since)
        if (e1) throw e1

        const { count: completed, error: e2 } = await sb
          .from('users')
          .select('id', { count: 'exact', head: true })
          .gte('created_at', since)
          .not('onboarding_completed_at', 'is', null)
        if (e2) throw e2

        const s = signups || 0
        const c = completed || 0
        const dropoff = Math.max(0, s - c)
        const rate = s > 0 ? ((c / s) * 100).toFixed(1) : '0.0'

        const bars = [
          { label: 'Signups', value: s },
          { label: 'Onboarded', value: c },
          { label: 'Drop-off', value: dropoff }
        ]

        body.innerHTML = `
          <div class="kpi-grid">
            <div class="kpi-tile"><div class="kpi-label">Signups (30T)</div><div class="kpi-value">${s}</div><div class="kpi-hint">Neuregistrierungen</div></div>
            <div class="kpi-tile"><div class="kpi-label">Abgeschlossen</div><div class="kpi-value">${c}</div><div class="kpi-hint">Onboarding fertig</div></div>
            <div class="kpi-tile"><div class="kpi-label">Drop-off</div><div class="kpi-value">${dropoff}</div><div class="kpi-hint">noch offen</div></div>
            <div class="kpi-tile"><div class="kpi-label">Conversion</div><div class="kpi-value">${rate}%</div><div class="kpi-hint">Completion-Rate</div></div>
          </div>
          <div style="margin-top:16px;">${renderBars(bars)}</div>
        `
      } catch (e) {
        body.innerHTML = '<div class="empty">Daten kommen bald: ' + escapeHtml(e?.message || 'unbekannt') + '</div>'
      }
    }
    container.querySelector('.refresh-btn').addEventListener('click', refresh)
    await refresh()
  }
}
