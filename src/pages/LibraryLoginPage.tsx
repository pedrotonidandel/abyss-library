import { useState } from 'react'
import { useAuth } from '../context/AuthContext'

export function LibraryLoginPage() {
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(email, password)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg)', padding: '24px',
    }}>
      {/* Background orbs */}
      <div style={{ position: 'fixed', top: '-10%', left: '50%', transform: 'translateX(-50%)', width: 500, height: 500, borderRadius: '50%', pointerEvents: 'none', background: 'radial-gradient(circle, rgba(0,150,255,0.07) 0%, transparent 70%)' }} />
      <div style={{ position: 'fixed', bottom: '-5%', right: '-5%', width: 400, height: 400, borderRadius: '50%', pointerEvents: 'none', background: 'radial-gradient(circle, oklch(0.85 0.17 90 / 0.06) 0%, transparent 70%)' }} />

      <div style={{ width: '100%', maxWidth: 380, position: 'relative', zIndex: 1 }}>
        {/* Logo + wordmark */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div
            style={{
              width: 56, height: 56, borderRadius: 16, margin: '0 auto 16px',
              background: 'var(--accent)', display: 'flex', alignItems: 'center',
              justifyContent: 'center', fontSize: 28, fontWeight: 800, color: '#0a0a0a',
              fontFamily: "'Poppins', sans-serif",
            }}
          >
            A
          </div>
          <h1 style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 700, fontSize: 32, color: '#fff', margin: 0, letterSpacing: '-0.5px' }}>
            abyss library
          </h1>
          <p style={{ color: 'var(--muted)', fontSize: 14, margin: '8px 0 0' }}>
            Entre com sua conta Abyss para continuar
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Email ou usuário
            </label>
            <input
              type="text"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              placeholder="email@exemplo.com ou @usuario"
              style={{
                width: '100%', padding: '12px 16px', boxSizing: 'border-box',
                background: 'var(--panel-2)', border: '1.5px solid var(--border)',
                borderRadius: 12, color: 'var(--text)', fontSize: 15, outline: 'none',
              }}
              onFocus={e => { (e.target as HTMLInputElement).style.borderColor = 'rgba(0,180,255,0.4)' }}
              onBlur={e  => { (e.target as HTMLInputElement).style.borderColor = 'var(--border)' }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Senha
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              placeholder="••••••••"
              style={{
                width: '100%', padding: '12px 16px', boxSizing: 'border-box',
                background: 'var(--panel-2)', border: '1.5px solid var(--border)',
                borderRadius: 12, color: 'var(--text)', fontSize: 15, outline: 'none',
              }}
              onFocus={e => { (e.target as HTMLInputElement).style.borderColor = 'rgba(0,180,255,0.4)' }}
              onBlur={e  => { (e.target as HTMLInputElement).style.borderColor = 'var(--border)' }}
            />
          </div>

          {error && (
            <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)' }}>
              <p style={{ margin: 0, fontSize: 13, color: '#fca5a5' }}>{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%', padding: '14px 0', marginTop: 4,
              borderRadius: 12, border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
              background: loading ? 'var(--accent-dim)' : 'var(--accent)',
              color: '#0a0a0a', fontSize: 16, fontWeight: 700,
              fontFamily: "'Poppins', sans-serif",
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  )
}
