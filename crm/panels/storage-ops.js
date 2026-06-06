import { sb } from '/lib/supabase.js'

export default {
  id: 'storage-ops',
  title: 'Storage & Cleanup',
  category: 'admin_actions',
  summary: 'Speichernutzung pro Bucket und Cleanup-Job auslösen.',
  async mount(container) {
    container.innerHTML = `<div class="panel-shell" style="background:#16161D;border:1px solid #2A2A33;border-radius:12px;color:#fff;padding:16px;">
      <div class="panel-head" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <div>
          <h2 style="margin:0;font-size:18px;color:#fff;">Storage & Cleanup</h2>
          <div style="font-size:12px;color:#9CA3AF;margin-top:4px;">Speichernutzung pro Bucket und Cleanup-Job auslösen.</div>
        </div>
        <button class="refresh-btn" style="background:#8B5CF6;color:#fff;border:none;border-radius:8px;padding:8px 14px;cursor:pointer;font-size:13px;">Aktualisieren</button>
      </div>
      <div class="panel-body"><div class="loading">Lädt…</div></div>
    </div>`

    const body = container.querySelector('.panel-body')

    const showToast = (msg) => {
      const t = document.createElement('div')
      t.className = 'toast'
      t.textContent = msg
      t.style.cssText = 'position:fixed;bottom:24px;right:24px;background:#8B5CF6;color:#fff;padding:10px 16px;border-radius:8px;font-size:13px;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,0.4);'
      document.body.appendChild(t)
      setTimeout(() => t.remove(), 2500)
    }

    const fmtBytes = (b) => {
      if (b == null) return '–'
      const n = Number(b)
      if (!isFinite(n)) return String(b)
      if (n < 1024) return n + ' B'
      if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
      if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MB'
      return (n / (1024 * 1024 * 1024)).toFixed(2) + ' GB'
    }

    const fmtNum = (n) => {
      if (n == null) return '–'
      return Number(n).toLocaleString('de-DE')
    }

    const refresh = async () => {
      body.innerHTML = '<div class="loading" style="color:#9CA3AF;padding:24px;text-align:center;">Lädt…</div>'
      try {
        const [summaryRes, bucketRes] = await Promise.all([
          sb.rpc('admin_storage_summary'),
          sb.rpc('admin_storage_bucket_stats')
        ])

        if (summaryRes.error) throw summaryRes.error
        if (bucketRes.error) throw bucketRes.error

        const summary = Array.isArray(summaryRes.data) ? (summaryRes.data[0] || {}) : (summaryRes.data || {})
        const buckets = Array.isArray(bucketRes.data) ? bucketRes.data : []

        const totalBytes = summary.total_bytes ?? summary.size_bytes ?? summary.total_size ?? buckets.reduce((s, b) => s + Number(b.size_bytes || b.bytes || 0), 0)
        const totalFiles = summary.total_files ?? summary.file_count ?? buckets.reduce((s, b) => s + Number(b.file_count || b.files || 0), 0)
        const bucketCount = summary.bucket_count ?? buckets.length
        const quota = summary.quota_bytes ?? (1024 * 1024 * 1024)
        const usagePct = quota ? Math.min(100, Math.round((Number(totalBytes) / Number(quota)) * 100)) : null

        const maxBucketBytes = Math.max(1, ...buckets.map(b => Number(b.size_bytes || b.bytes || 0)))

        const kpiHtml = `
          <div class="kpi-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:20px;">
            <div class="kpi-tile" style="background:#1E1E26;border:1px solid #2A2A33;border-radius:12px;padding:14px;">
              <div style="font-size:11px;color:#9CA3AF;text-transform:uppercase;letter-spacing:0.5px;">Gesamt</div>
              <div style="font-size:22px;color:#fff;font-weight:600;margin-top:6px;">${fmtBytes(totalBytes)}</div>
              <div style="font-size:11px;color:#8B5CF6;margin-top:4px;">${usagePct != null ? usagePct + '% von ' + fmtBytes(quota) : 'Speicher'}</div>
            </div>
            <div class="kpi-tile" style="background:#1E1E26;border:1px solid #2A2A33;border-radius:12px;padding:14px;">
              <div style="font-size:11px;color:#9CA3AF;text-transform:uppercase;letter-spacing:0.5px;">Dateien</div>
              <div style="font-size:22px;color:#fff;font-weight:600;margin-top:6px;">${fmtNum(totalFiles)}</div>
              <div style="font-size:11px;color:#9CA3AF;margin-top:4px;">Objekte gesamt</div>
            </div>
            <div class="kpi-tile" style="background:#1E1E26;border:1px solid #2A2A33;border-radius:12px;padding:14px;">
              <div style="font-size:11px;color:#9CA3AF;text-transform:uppercase;letter-spacing:0.5px;">Buckets</div>
              <div style="font-size:22px;color:#fff;font-weight:600;margin-top:6px;">${fmtNum(bucketCount)}</div>
              <div style="font-size:11px;color:#9CA3AF;margin-top:4px;">aktive Buckets</div>
            </div>
          </div>`

        const rowsHtml = buckets.length ? buckets.map(b => {
          const name = b.bucket_id || b.name || b.bucket || '–'
          const bytes = Number(b.size_bytes || b.bytes || 0)
          const files = b.file_count ?? b.files ?? '–'
          const pct = Math.round((bytes / maxBucketBytes) * 100)
          return `<tr style="border-top:1px solid #2A2A33;">
            <td style="padding:10px;color:#fff;font-size:13px;">${name}</td>
            <td style="padding:10px;color:#fff;font-size:13px;">${fmtBytes(bytes)}</td>
            <td style="padding:10px;color:#9CA3AF;font-size:13px;">${fmtNum(files)}</td>
            <td style="padding:10px;width:40%;">
              <div style="background:#2A2A33;border-radius:6px;height:8px;overflow:hidden;">
                <div style="background:#8B5CF6;height:100%;width:${pct}%;"></div>
              </div>
            </td>
          </tr>`
        }).join('') : '<tr><td colspan="4" style="padding:14px;color:#9CA3AF;text-align:center;">Keine Buckets gefunden</td></tr>'

        const tableHtml = `
          <div style="margin-bottom:20px;">
            <div style="font-size:13px;color:#9CA3AF;margin-bottom:8px;">Buckets</div>
            <table class="data-table" style="width:100%;border-collapse:collapse;background:#1E1E26;border:1px solid #2A2A33;border-radius:12px;overflow:hidden;">
              <thead>
                <tr style="background:#16161D;">
                  <th style="padding:10px;text-align:left;font-size:11px;color:#9CA3AF;text-transform:uppercase;">Bucket</th>
                  <th style="padding:10px;text-align:left;font-size:11px;color:#9CA3AF;text-transform:uppercase;">Größe</th>
                  <th style="padding:10px;text-align:left;font-size:11px;color:#9CA3AF;text-transform:uppercase;">Dateien</th>
                  <th style="padding:10px;text-align:left;font-size:11px;color:#9CA3AF;text-transform:uppercase;">Anteil</th>
                </tr>
              </thead>
              <tbody>${rowsHtml}</tbody>
            </table>
          </div>`

        const actionsHtml = `
          <div style="background:#1E1E26;border:1px solid #2A2A33;border-radius:12px;padding:14px;">
            <div style="font-size:13px;color:#fff;font-weight:600;margin-bottom:4px;">Aktionen</div>
            <div style="font-size:12px;color:#9CA3AF;margin-bottom:12px;">Triggert die Edge-Function <code style="color:#8B5CF6;">cleanup-old-data</code>.</div>
            <button class="action-btn" data-action="run_cleanup_old_data" style="background:#8B5CF6;color:#fff;border:none;border-radius:8px;padding:10px 16px;cursor:pointer;font-size:13px;font-weight:500;">Cleanup Old Data ausführen</button>
          </div>`

        body.innerHTML = kpiHtml + tableHtml + actionsHtml

        body.querySelectorAll('.action-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            const action = btn.getAttribute('data-action')
            showToast('Aktion: ' + action)
          })
        })
      } catch (e) {
        body.innerHTML = '<div class="empty" style="padding:24px;color:#9CA3AF;text-align:center;background:#1E1E26;border:1px solid #2A2A33;border-radius:12px;">Daten kommen bald: ' + (e?.message || 'unbekannt') + '</div>'
      }
    }

    container.querySelector('.refresh-btn').addEventListener('click', refresh)
    await refresh()
  }
}
