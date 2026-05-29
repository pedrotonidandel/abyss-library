import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'

interface AuthUser {
  id: number
  username: string
  isAdmin: boolean
}

interface AuthState {
  user: AuthUser | null
  token: string | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Restore session from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('abyss-lib-token')
    if (!saved) { setLoading(false); return }
    // Validate token
    fetch('/api/auth/me', { headers: { Authorization: `Bearer ${saved}` } })
      .then(r => r.ok ? r.json() : null)
      .then((u: AuthUser | null) => {
        if (u) { setToken(saved); setUser(u) }
        else localStorage.removeItem('abyss-lib-token')
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const login = async (email: string, password: string) => {
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    if (!r.ok) {
      const err = await r.json() as { error?: string }
      throw new Error(err.error ?? 'Erro ao fazer login')
    }
    const data = await r.json() as { token: string; user: AuthUser }
    setToken(data.token)
    setUser(data.user)
    localStorage.setItem('abyss-lib-token', data.token)
  }

  const logout = () => {
    setToken(null); setUser(null)
    localStorage.removeItem('abyss-lib-token')
  }

  return (
    <AuthContext.Provider value={{ user, token, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
