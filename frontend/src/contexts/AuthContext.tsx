import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../lib/api'

type User = { id: number; email: string; plan: string }

type AuthContextValue = {
  user: User | null
  token: string | null
  login: (email: string, password: string) => Promise<void>
  signup: (email: string, password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const navigate = useNavigate()
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('token'))
  const [user, setUser] = useState<User | null>(null)

  useEffect(() => {
    if (!token) return
    const hydrate = async () => {
      try {
        const r = await api.get<User>('/auth/me')
        setUser(r.data)
      } catch (e) {
        localStorage.removeItem('token')
        setToken(null)
        setUser(null)
      }
    }
    hydrate()
  }, [token])

  const login = useCallback(async (email: string, password: string) => {
    const r = await api.post<{ access_token: string }>('/auth/login', { email, password })
    const t = r.data.access_token
    localStorage.setItem('token', t)
    setToken(t)
    const me = await api.get<User>('/auth/me')
    setUser(me.data)
    navigate('/app')
  }, [navigate])

  const signup = useCallback(async (email: string, password: string) => {
    await api.post('/auth/register', { email, password })
    await login(email, password)
  }, [login])

  const logout = useCallback(() => {
    localStorage.removeItem('token')
    setToken(null)
    setUser(null)
    navigate('/login')
  }, [navigate])

  const value = useMemo(() => ({ user, token, login, signup, logout }), [user, token, login, signup, logout])
  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  )
}

export const useAuth = () => {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

export const ProtectedRoute = ({ children }: { children: JSX.Element }) => {
  const { token } = useAuth()
  if (!token) {
    return <div className="p-6 text-center">You must be logged in. <a href="/login" className="text-blue-600 underline">Go to login</a></div>
  }
  return children
}


