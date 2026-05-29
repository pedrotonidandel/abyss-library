import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'

interface PendingAddon {
  _id: string
  name: string
  description: string
  category: string
  itemCount: number
  submittedAt: string
  submittedBy: string
  downloads: unknown[]
}

export function AdminQueuePage({ onBack }: { onBack: () => void }) {
  const { token } = useAuth()
  const [items, setItems] = useState<PendingAddon[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<PendingAddon | null>(null)

  useEffect(() => {
    fetch('/api/addons/pending', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => setItems(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [token])

  const approve = async (id: string) => {
    const r = await fetch(`/api/addons/pending/${id}/approve`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
    if (!r.ok) { alert('Erro ao aprovar addon'); return }
    setItems(i => i.filter(x => x._id !== id))
    if (selected?._id === id) setSelected(null)
  }

  const reject = async (id: string) => {
    if (!confirm('Rejeitar este addon?')) return
    const r = await fetch(`/api/addons/pending/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
    if (!r.ok) { alert('Erro ao rejeitar addon'); return }
    setItems(i => i.filter(x => x._id !== id))
    if (selected?._id === id) setSelected(null)
  }

  return (
    <div style={{ padding: '40px 24px', maxWidth: 1100, margin: '0 auto' }}>
      <button
        onClick={onBack}
        className="text-xs mb-6 flex items-center gap-1.5 transition-colors"
        style={{ color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
        onMouseEnter={e => (e.currentTarget.style.color = 'var(--text)')}
        onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted)')}
      >
        ← Voltar
      </button>
      <h2 style={{ color: 'var(--text)', fontWeight: 800, fontSize: 28, marginBottom: 8, letterSpacing: '-0.5px' }}>
        Fila de Revisao
      </h2>
      <p style={{ color: 'var(--muted)', marginBottom: 32, fontSize: 14 }}>
        {items.length} addon{items.length !== 1 ? 's' : ''} aguardando aprovacao
      </p>

      {loading ? (
        <p style={{ color: 'var(--muted)' }}>Carregando...</p>
      ) : items.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px 0' }}>
          <p style={{ fontSize: 40, marginBottom: 12 }}>✅</p>
          <p style={{ color: 'var(--muted)', fontSize: 16 }}>Nenhum addon aguardando revisao</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 1fr' : '1fr', gap: 16 }}>
          {/* List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {items.map(item => (
              <div key={item._id} style={{
                background: selected?._id === item._id ? 'var(--panel-2)' : 'var(--panel)',
                border: `1px solid ${selected?._id === item._id ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: 14, padding: '16px 20px',
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontWeight: 700, color: 'var(--text)', margin: '0 0 4px', fontSize: 15 }}>{item.name}</p>
                    <p style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 8px' }}>
                      por @{item.submittedBy} · {item.itemCount} itens · {new Date(item.submittedAt).toLocaleDateString('pt-BR')}
                    </p>
                    {item.description && <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0 }}>{item.description}</p>}
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button
                      onClick={() => setSelected(selected?._id === item._id ? null : item)}
                      style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--panel-2)', color: 'var(--muted)', cursor: 'pointer', fontSize: 12 }}
                    >
                      👁 Ver JSON
                    </button>
                    <button
                      onClick={() => approve(item._id)}
                      style={{ padding: '6px 12px', borderRadius: 8, border: 'none', background: 'rgba(34,197,94,0.12)', color: '#22c55e', cursor: 'pointer', fontSize: 12 }}
                    >
                      ✓ Aprovar
                    </button>
                    <button
                      onClick={() => reject(item._id)}
                      style={{ padding: '6px 12px', borderRadius: 8, border: 'none', background: 'rgba(239,68,68,0.10)', color: '#ef4444', cursor: 'pointer', fontSize: 12 }}
                    >
                      ✕ Rejeitar
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* JSON preview */}
          {selected && (
            <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden', position: 'sticky', top: 80, maxHeight: '70vh' }}>
              <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <p style={{ margin: 0, fontWeight: 600, color: 'var(--text)', fontSize: 13 }}>Preview JSON — {selected.name}</p>
                <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer' }}>✕</button>
              </div>
              <pre style={{ margin: 0, padding: '16px', overflowY: 'auto', maxHeight: 'calc(70vh - 48px)', fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace', lineHeight: 1.5 }}>
                {JSON.stringify({ name: selected.name, downloads: selected.downloads }, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
