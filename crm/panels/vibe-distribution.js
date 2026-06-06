import { sb } from '/lib/supabase.js'

const VIBE_META = {
  fire:    { label: 'Fire',    emoji: '🔥', color: '#F97316' },
  insight: { label: 'Insight', emoji: '💡', color: '#FACC15' },
  funny:   { label: 'Funny',   emoji: '😂', color: '#22D3EE' },
  deep:    { label: 'Deep',    emoji: '🌊', color: '#8B5CF6' },
  warm:    { label: 'Warm',    emoji: '🤗', color: '#F472B6' },
  slow:    { label: 'Slow',    emoji: '🐢', color: '#34D399' }
}

const FALLBACK_COLORS = ['#8B5CF6', '#F97316', '#22D3EE', '#FACC15', '#F472B6', '#34D399', '#60A5FA', '#FB7185']

function metaFor(vibe, idx) {
  return VIBE_META[vibe] || { label: vibe || 'Unbekannt', emoji: '•', color: FALLBACK_COLORS[idx % FALLBACK_COLORS.length] }
}

function showToast(container, msg) {
  const toast = document.createElement('div')
  toast.className = 'toast'
  toast.textContent = msg
  toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#2A2A33;color:#fff;padding:10px 16px;border-radius:12px;border:1px solid #8B5CF6;z-index:9999;'
  container.appendChild(toast)
  setTimeout(() => toast.remove(), 2200)
}

function renderDonut(slices, total) {
  const size = 220
  const cx = size / 2
  const cy = size / 2
  const r = 90
  const inner = 58
  let angle = -Math.PI / 2
  let paths = ''
  slices.forEach((s) => {
    const frac = total > 0 ? s.count / total : 0
    const a2 = angle + frac * Math.PI * 2
    const large = frac > 0.5 ? 1 : 0
    const x1 = cx + r * Math.cos(angle)
    const y1 = cy + r * Math.sin(angle)
    const x2 = cx + r * Math.cos(a2)
    const y2 = cy + r * Math.sin(a2)
    const x3 = cx + inner * Math.cos(a2)
    const y3 = cy + inner * Math.sin(a2)
    const x4 = cx + inner * Math.cos(angle)
    const y4 = cy + inner * Math.sin(angle)
    paths += `<path d="M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} L ${x3} ${y3} A ${inner} ${inner} 0 ${large} 0 ${x4} ${y4} Z" fill="${s.color}" stroke="#16161D" stroke-width="2"></path>`
    angle = a2
  })
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" style="display:block;margin:0 auto;">
    ${paths}
    <text x="${cx}" y="${cy - 4}" text-anchor="middle" fill="#fff" font-size="22" font-weight="700">${total}</text>
    <text x="${cx}" y="${cy + 16}" text-anchor="middle" fill="#9CA3AF" font-size="11">Reactions</text>
  </svg>`
}

function renderLegend(slices, total) {
  return `<div style="display:flex;flex-direction:column;gap:8px;min-width:200px;">
    ${slices.map((s) => {
      const pct = total > 0 ? ((s.count / total) * 100).toFixed(1) : '0.0'
      return `<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 10px;background:#1F1F27;border:1px solid #2A2A33;border-radius:12px;">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="width:12px;height:12px;border-radius:3px;background:${s.color};display:inline-block;"></span>
          <span style="color:#fff;font-size:13px;">${s.emoji} ${s.label}</span>
        </div>
        <div style="color:#9CA3AF;font-size:12px;"><span style="color:#fff;font-weight:600;">${s.count}</span> · ${pct}%</div>
      </div>`
    }).join('')}
  </div>`
}

export default {
  id: 'vibe-distribution',
  title: 'Vibe-Verteilung',
  category: 'listening',
  summary: 'Globale Verteilung der Episode-Reactions.',
  async mount(container) {
    container.innerHTML = `<div class="panel-shell" style="background:#16161D;border:1px solid #2A2A33;border-radius:12px;padding:16px;color:#fff;">
      <div class="panel-head" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
        <h2 style="margin:0;font-size:18px;color:#fff;">Vibe-Verteilung</h2>
        <button class="refresh-btn" style="background:#8B5CF6;color:#fff;border:none;border-radius:12px;padding:8px 14px;cursor:pointer;font-size:13px;">Aktualisieren</button>
      </div>
      <div class="panel-body"><div class="loading">Lädt…</div></div>
    </div>`
    const body = container.querySelector('.panel-body')

    const refresh = async () => {
      body.innerHTML = '<div class="loading">Lädt…</div>'
      try {
        const { data, error } = await sb
          .from('episode_vibes')
          .select('vibe')
          .limit(10000)
        if (error) throw error

        const counts = new Map()
        for (const row of (data || [])) {
          const k = row.vibe || 'unknown'
          counts.set(k, (counts.get(k) || 0) + 1)
        }

        if (counts.size === 0) {
          body.innerHTML = '<div class="empty" style="padding:24px;text-align:center;color:#9CA3AF;background:#1F1F27;border:1px solid #2A2A33;border-radius:12px;">Noch keine Vibes erfasst.</div>'
          return
        }

        const slices = Array.from(counts.entries())
          .map(([vibe, count], idx) => ({ vibe, count, ...metaFor(vibe, idx) }))
          .sort((a, b) => b.count - a.count)
        const total = slices.reduce((s, x) => s + x.count, 0)
        const top = slices[0]

        body.innerHTML = `
          <div style="display:flex;flex-wrap:wrap;gap:20px;align-items:center;justify-content:center;">
            <div>${renderDonut(slices, total)}</div>
            ${renderLegend(slices, total)}
          </div>
          <div style="margin-top:14px;padding:10px 12px;background:#1F1F27;border:1px solid #2A2A33;border-radius:12px;color:#9CA3AF;font-size:12px;">
            Top-Vibe: <span style="color:#fff;font-weight:600;">${top.emoji} ${top.label}</span> mit ${top.count} Reactions
            (${((top.count / total) * 100).toFixed(1)}%) · ${slices.length} unterschiedliche Vibes
          </div>
        `
      } catch (e) {
        body.innerHTML = '<div class="empty" style="padding:24px;text-align:center;color:#9CA3AF;background:#1F1F27;border:1px solid #2A2A33;border-radius:12px;">Daten kommen bald: ' + (e?.message || 'unbekannt') + '</div>'
      }
    }

    container.querySelector('.refresh-btn').addEventListener('click', refresh)
    await refresh()
  }
}
